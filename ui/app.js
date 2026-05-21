/**
 * CharCardStudio v4.0.0 — ui/app.js
 * App shell: popup lifecycle, tab switching, session integration, mobile detection
 */

import {
    getSession, loadSession, clearCurrentSession, saveSession,
    setMode, setPhase, updateSession, onSessionChange, hashString,
    swapModeHistory,
} from '../core/session.js';
import { acquireLock, releaseLock, isLocked, onLockConflict } from '../core/multi-tab.js';
import { calculateProgress, getSubProgress, addWorldPillar, removeWorldPillar } from '../core/pillars.js';
import { getLorebookEntries, getLorebookTokenBudget, detectRecursion, listWorldInfoBooks, createWorldInfoBook } from '../core/lorebook.js';
import { calculateStarRating, renderStarHtml } from '../core/validators.js';
import { cancelAllGenerations, isGenerating } from '../core/silent-generation.js';
import { countTokensSync, countTokensForFields } from '../core/token-utils.js';
import { adaptPanelForMode, getWelcomeForMode, getChipsForMode, isModeBlocked } from './mode-panel.js';
import { showToast } from './toast.js';
import { openSettings } from './settings-modal.js';
import { saveFieldDirect } from '../core/tools.js';
import { getFieldHistory, buildFieldDiffHtml } from '../core/field-history.js';
import { sendMessage, triggerAIReview } from './chat.js';
import { openPromptInspector } from './prompt-inspector.js';
import { runCoherenceAudit } from '../core/coherence-audit.js';

// ─── State ───────────────────────────────────────────────────────────────────

let _isOpen = false;
let _isMobile = false;
let _activeTab = 'concept';
let _activeMobileTab = 'chat';
let _defaultWelcomeHtml = null;
const MOBILE_BREAKPOINT = 768;

// ─── DOM Helpers ─────────────────────────────────────────────────────────────

function el(id) {
    return document.getElementById(id);
}

// ─── Open / Close ────────────────────────────────────────────────────────────

/**
 * Open the studio popup. Loads session for the current ST character.
 */
export async function openStudio() {
    if (_isOpen) {
        // Already open — just bring to focus
        el('ccs_window')?.style.setProperty('display', 'flex');
        return;
    }

    const window_el = el('ccs_window');
    if (!window_el) {
        console.error('[CCS] Window template not found. Was it injected?');
        showToast('Studio failed to open — template missing.', 'error');
        return;
    }

    // Detect current ST character
    const ctx = SillyTavern?.getContext?.();
    const character = ctx?.characters?.[ctx?.characterId];
    const avatar = character?.avatar || null;
    const name = character?.name || 'Unknown Character';

    // Load (or create) session for this character
    if (avatar) {
        await loadSession(avatar, name);

        // Multi-tab lock
        const locked = acquireLock(avatar);
        if (!locked) {
            // Show read-only banner
            const banner = el('ccs_readonly_banner');
            if (banner) banner.style.display = 'flex';
        }
    }

    // Show window
    window_el.style.display = 'flex';
    _isOpen = true;

    // Detect mobile on open
    _detectMobile();

    // Render initial state
    const session = getSession();
    const mode = session?.mode || 'studio';

    _renderTopBar();
    _renderTabs();
    adaptPanelForMode(mode);
    await _updateModeUI(mode);

    // Import and trigger chat render
    try {
        const { renderMessages } = await import('./chat.js');
        renderMessages();
    } catch (e) {
        console.warn('[CCS] chat.js not yet loaded:', e.message);
    }

    // Import and render right panel tabs
    _renderRightPanel();
}

/**
 * Close the studio popup.
 */
export function closeStudio() {
    const window_el = el('ccs_window');
    if (window_el) window_el.style.display = 'none';
    _isOpen = false;

    // Force-save session before closing
    saveSession(true);

    // Release multi-tab lock
    releaseLock();

    // Reset read-only banner
    const banner = el('ccs_readonly_banner');
    if (banner) banner.style.display = 'none';
}

export function isOpen() {
    return _isOpen;
}

// ─── Top Bar ─────────────────────────────────────────────────────────────────

function _renderTopBar() {
    const session = getSession();

    // Character name
    const nameEl = el('ccs_char_name');
    if (nameEl) {
        nameEl.textContent = session?.characterName || 'No character';
    }

    // Mode selector
    const modeEl = el('ccs_mode_select');
    if (modeEl && session?.mode) {
        modeEl.value = session.mode;
    }

    // Progress
    _updateProgress();
}

export function updateCharacterName(name) {
    const nameEl = el('ccs_char_name');
    if (nameEl) nameEl.textContent = name || 'No character';
}

export function updateProgress(percent, label) {
    const fill = el('ccs_progress_fill');
    const labelEl = el('ccs_progress_label');
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    if (labelEl) labelEl.textContent = label ?? `${Math.round(percent)}%`;
}

function _updateProgress() {
    const session = getSession();
    if (!session?.pillarStates?.length) {
        updateProgress(0, '0%');
        return;
    }

    const progress = calculateProgress(session.pillarStates);
    updateProgress(progress.percent, `${progress.done}/${progress.total - progress.skipped}`);
}

// ─── Tab Management ──────────────────────────────────────────────────────────

export function switchTab(tabName) {
    _activeTab = tabName;
    _renderTabs();
}

/**
 * Sync the context bar pills to match current session state.
 */
export function syncContextBar() {
    const session = getSession();
    if (!session) return;

    const bar = el('ccs_context_bar');
    if (!bar) return;

    // Format pills
    bar.querySelectorAll('.ccs-context-pill[data-format]').forEach(pill => {
        pill.classList.toggle('active', pill.dataset.format === (session.cardFormat || 'prose'));
    });

    // Phase pills
    bar.querySelectorAll('.ccs-context-pill[data-phase]').forEach(pill => {
        pill.classList.toggle('active', pill.dataset.phase === (session.phase || 'ideate'));
    });
}

function _renderTabs() {
    // Desktop tab headers
    const tabBtns = document.querySelectorAll('#ccs_tabs .ccs-tab-btn');
    const tabPanels = document.querySelectorAll('#ccs_tab_content .ccs-tab-panel');

    tabBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === _activeTab);
    });
    tabPanels.forEach(panel => {
        panel.classList.toggle('active', panel.dataset.tabPanel === _activeTab);
    });

    // Mobile tab bar
    const mobileBtns = document.querySelectorAll('#ccs_mobile_tabs .ccs-mobile-tab-btn');
    mobileBtns.forEach(btn => {
        if (btn.dataset.mobileTab !== 'chat') {
            btn.classList.toggle('active', btn.dataset.mobileTab === _activeTab);
        }
    });
}

// ─── Mobile ──────────────────────────────────────────────────────────────────

function _detectMobile() {
    const wasMobile = _isMobile;
    _isMobile = window.innerWidth < MOBILE_BREAKPOINT;

    const app = el('ccs_app');
    if (!app) return;

    app.classList.toggle('ccs-mobile', _isMobile);

    if (_isMobile && !wasMobile) {
        // Switched to mobile — show chat panel by default
        _setMobilePanel('chat');
    } else if (!_isMobile && wasMobile) {
        // Switched back to desktop — remove panel-active class
        app.classList.remove('ccs-mobile-panel-active');
    }
}

function _setMobilePanel(panel) {
    _activeMobileTab = panel;
    const app = el('ccs_app');
    if (!app) return;

    // Use class-based toggling — CSS media queries handle display rules
    // We only need to manage the panel-active state class
    if (panel === 'chat') {
        app.classList.remove('ccs-mobile-panel-active');
    } else {
        app.classList.add('ccs-mobile-panel-active');
        switchTab(panel);
    }

    // Update mobile tab buttons
    const mobileBtns = document.querySelectorAll('#ccs_mobile_tabs .ccs-mobile-tab-btn');
    mobileBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mobileTab === panel);
    });
}

// ─── Right Panel ─────────────────────────────────────────────────────────────

async function _renderRightPanel() {
    _renderConceptTab();
    _renderCardTab();
    _renderLoreTab();
    _syncScratchpad();
}

let _pillarListenerBound = false;

function _renderConceptTab() {
    const session = getSession();
    const listEl = el('ccs_pillar_list');
    const countEl = el('ccs_pillar_count');
    if (!listEl) return;

    const pillars = session?.pillarStates || [];
    const phase = session?.phase || 'ideate';

    if (!pillars.length) {
        // Show concept quickstart when in ideate phase with no pillars yet
        if (phase === 'ideate') {
            listEl.innerHTML = `
            <div class="ccs-concept-paths">
                <div class="ccs-concept-paths-header"><i class="fa-solid fa-lightbulb"></i> Concept Quickstart</div>
                <p class="ccs-concept-paths-desc">Click a path to begin, or just start chatting.</p>
                <div class="ccs-concept-paths-chips">
                    <button class="ccs-concept-chip" data-prompt="Brainstorm 3-5 unique character concepts for me. Show variety — different archetypes, tones, genres.">💡 Brainstorm</button>
                    <button class="ccs-concept-chip" data-prompt="I want to design a morally complex villain. Let's explore their backstory and motivations.">🦹 Villain</button>
                    <button class="ccs-concept-chip" data-prompt="Help me design a loyal companion character — someone who joins the protagonist on their journey.">🤝 Companion</button>
                    <button class="ccs-concept-chip" data-prompt="Let's create a mysterious mentor or wise sage. What secrets do they hold? What's their purpose?">🧙 Mentor</button>
                    <button class="ccs-concept-chip" data-prompt="I want an AI or android character. Help me explore how they think and what makes them uniquely non-human.">🤖 AI/Android</button>
                    <button class="ccs-concept-chip" data-prompt="Give me 3 completely unexpected, subversive takes on a classic character archetype. Surprise me.">✨ What If?</button>
                </div>
            </div>`;
        } else {
            listEl.innerHTML = '<p class="ccs-empty-state">Start a conversation to define your character\'s core pillars.</p>';
        }
        if (countEl) countEl.textContent = '0/0';
        return;
    }

    const progress = calculateProgress(pillars);
    const sub = getSubProgress(pillars);
    if (countEl) countEl.textContent = `${progress.done}/${progress.total - progress.skipped}`;

    const STATUS_ICONS = {
        done: '<i class="fa-solid fa-check" style="color: var(--ccs-success)"></i>',
        in_progress: '<i class="fa-solid fa-spinner fa-spin" style="color: var(--ccs-accent)"></i>',
        skipped: '<i class="fa-solid fa-forward" style="color: var(--ccs-text-muted)"></i>',
        pending: '<i class="fa-regular fa-circle" style="color: var(--ccs-text-secondary)"></i>',
    };

    const structural = pillars.filter(p => p.category === 'structural');
    const world = pillars.filter(p => p.category === 'world');

    let html = '';

    // AI Scorecard
    if (session?.aiReview) {
        const rev = session.aiReview;
        html += `<div class="ccs-scorecard">
            <div class="ccs-scorecard-header">
                <div class="ccs-scorecard-title"><i class="fa-solid fa-star-half-stroke"></i> AI Scorecard</div>
                <div class="ccs-scorecard-stars">${renderStarHtml(rev.rating)}</div>
            </div>
            <div class="ccs-scorecard-grid">
                ${(rev.categories || []).map(cat => `
                    <div class="ccs-scorecard-item">
                        <div class="ccs-scorecard-item-label" title="${escapeHtml(cat.name)}">${escapeHtml(cat.name)}</div>
                        <div class="ccs-scorecard-bar-container">
                            <div class="ccs-scorecard-bar-fill" style="width: ${(cat.score / Math.max(1, cat.max)) * 100}%;"></div>
                        </div>
                        <div class="ccs-scorecard-item-score">${cat.score}/${cat.max}</div>
                    </div>
                `).join('')}
            </div>
            ${(rev.suggestions?.length > 0 || rev.weaknesses?.length > 0) ? `
                <details class="ccs-scorecard-advice">
                    <summary><i class="fa-solid fa-lightbulb"></i> View AI Suggestions</summary>
                    <div class="ccs-scorecard-advice-content">
                        ${rev.strengths?.length ? `<h4>Strengths</h4><ul>${rev.strengths.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>` : ''}
                        ${rev.weaknesses?.length ? `<h4>Weaknesses</h4><ul>${rev.weaknesses.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : ''}
                        ${rev.suggestions?.length ? `<h4>Suggestions</h4><ul>${rev.suggestions.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>` : ''}
                    </div>
                </details>
            ` : ''}
        </div>`;
    } else {
        html += `<div class="ccs-scorecard" style="text-align: center; padding: 24px 16px;">
            <div style="color: var(--ccs-text-muted); font-size: 0.8rem; margin-bottom: 8px;">No AI Scorecard generated yet</div>
            <div style="font-size: 0.75rem; color: var(--ccs-text-secondary);">Run an AI Review to evaluate your card's depth, uniqueness, and get actionable suggestions.</div>
        </div>`;
    }

    // Audit & Review actions
    html += `<div style="margin-bottom: 16px; display: flex; gap: 8px; justify-content: center;">
        <button class="ccs-btn ccs-btn--secondary" id="ccs_audit_btn"><i class="fa-solid fa-shield-halved"></i> Run Coherence Audit</button>
        <button class="ccs-btn ccs-btn--accent" id="ccs_review_btn"><i class="fa-solid fa-star-half-stroke"></i> Run AI Review</button>
    </div>`;

    // Structural pillars section
    html += `<div class="ccs-pillar-section">`;
    html += `<div class="ccs-pillar-section-header">Structural Fields <span class="ccs-pillar-section-count">${sub.structural.done}/${sub.structural.total - sub.structural.skipped}</span></div>`;
    html += structural.map(p => _renderPillarItem(p, STATUS_ICONS)).join('');
    html += `</div>`;

    // World pillars section (only if any exist)
    if (world.length > 0) {
        html += `<div class="ccs-pillar-section">`;
        html += `<div class="ccs-pillar-section-header">World Concepts <span class="ccs-pillar-section-count">${sub.world.done}/${sub.world.total - sub.world.skipped}</span></div>`;
        html += world.map(p => _renderPillarItem(p, STATUS_ICONS, true)).join('');
        html += `</div>`;
    }

    // Add Custom Pillar button
    html += `<button class="ccs-add-pillar-btn" id="ccs_add_pillar_btn"><i class="fa-solid fa-plus"></i> Add Concept Pillar</button>`;

    // Conflicts section
    const conflicts = (session?.conflicts || []).filter(c => c.status === 'open' || c.status === 'snoozed');
    if (conflicts.length > 0) {
        html += `<div class="ccs-conflicts-section">`;
        html += `<div class="ccs-pillar-section-header">⚠️ Conflicts <span class="ccs-pillar-section-count">${conflicts.length}</span></div>`;
        html += conflicts.map(c => `
            <div class="ccs-conflict-item ccs-conflict-item--${c.severity}" data-conflict-id="${c.id}">
                <div class="ccs-conflict-header">
                    <span class="ccs-conflict-fields">${escapeHtml(c.fieldA)} ↔ ${escapeHtml(c.fieldB)}</span>
                    <span class="ccs-badge ccs-badge--${c.severity === 'high' ? 'error' : c.severity === 'medium' ? 'warning' : 'info'}">${c.severity}</span>
                </div>
                <div class="ccs-conflict-desc">${escapeHtml(c.description)}</div>
                <div class="ccs-conflict-actions">
                    <button class="ccs-btn ccs-btn--sm" data-conflict-action="ignore" data-conflict-id="${c.id}">Ignore</button>
                    <button class="ccs-btn ccs-btn--sm" data-conflict-action="snooze" data-conflict-id="${c.id}">Snooze</button>
                </div>
            </div>
        `).join('');
        html += `</div>`;
    }

    listEl.innerHTML = html;

    // Wire audit button dynamically since it's now in the volatile concept tab
    const auditBtn = listEl.querySelector('#ccs_audit_btn');
    if (auditBtn) {
        auditBtn.addEventListener('click', async () => {
            auditBtn.disabled = true;
            auditBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Running...';
            try {
                // Since runCoherenceAudit is imported, we can just call it
                // Wait, I need to make sure runCoherenceAudit and _showAuditModal are in scope.
                const report = await runCoherenceAudit();
                _showAuditModal(report);
            } catch (e) {
                showToast(`Audit failed: ${e.message}`, 'error');
            } finally {
                auditBtn.disabled = false;
                auditBtn.innerHTML = '<i class="fa-solid fa-shield-halved"></i> Run Coherence Audit';
            }
        });
    }

    const reviewBtn = listEl.querySelector('#ccs_review_btn');
    if (reviewBtn) {
        reviewBtn.addEventListener('click', () => {
            triggerAIReview();
        });
    }

    // Bind expand/collapse (once)
    if (!_pillarListenerBound) {
        listEl.addEventListener('click', (e) => {
            // Expand/collapse
            const pillar = e.target.closest('.ccs-pillar');
            if (pillar) {
                const detail = pillar.querySelector('.ccs-pillar-detail');
                const toggle = pillar.querySelector('.ccs-pillar-toggle');
                if (detail) {
                    const isExpanded = detail.style.display !== 'none';
                    detail.style.display = isExpanded ? 'none' : 'block';
                    if (toggle) {
                        toggle.classList.toggle('fa-chevron-up', !isExpanded);
                        toggle.classList.toggle('fa-chevron-down', isExpanded);
                    }
                }
            }

            // Delete world pillar
            const deleteBtn = e.target.closest('.ccs-pillar-delete');
            if (deleteBtn) {
                e.stopPropagation();
                const id = deleteBtn.dataset.pillarId;
                if (id && removeWorldPillar(id)) {
                    showToast('Pillar removed', 'info', 2000);
                    _renderConceptTab();
                    _updateProgress();
                }
            }

            // Add pillar button
            if (e.target.closest('#ccs_add_pillar_btn')) {
                _showAddPillarDialog();
            }

            // Concept path quick-start chips
            const chip = e.target.closest('.ccs-concept-chip');
            if (chip?.dataset.prompt) {
                sendMessage(chip.dataset.prompt);
            }

            // Conflict action buttons (Ignore/Snooze)
            const conflictBtn = e.target.closest('[data-conflict-action]');
            if (conflictBtn) {
                e.stopPropagation();
                const conflictAction = conflictBtn.dataset.conflictAction;
                const conflictId = conflictBtn.dataset.conflictId;
                const session = getSession();
                const conflicts = session?.conflicts || [];
                const conflict = conflicts.find(c => c.id === conflictId);
                if (conflict) {
                    if (conflictAction === 'ignore') {
                        conflict.status = 'ignored';
                        const fps = session.falsePositives || [];
                        fps.push({ conflictId, markedAt: Date.now(), sessionOnly: false });
                        updateSession({ conflicts, falsePositives: fps });
                    } else if (conflictAction === 'snooze') {
                        conflict.status = 'snoozed';
                        updateSession({ conflicts });
                    }
                    showToast(`Conflict ${conflictAction}d`, 'info', 2000);
                    _renderConceptTab();
                }
            }
        });
        _pillarListenerBound = true;
    }
}

function _renderPillarItem(p, icons, isWorld = false) {
    const deleteBtn = isWorld ? `<span class="ccs-pillar-delete" data-pillar-id="${p.id}" title="Remove"><i class="fa-solid fa-xmark"></i></span>` : '';
    return `
        <div class="ccs-pillar ccs-pillar--${p.status}" data-pillar-id="${p.id}">
            <div class="ccs-pillar-header">
                <span class="ccs-pillar-status">${icons[p.status] || icons.pending}</span>
                <span class="ccs-pillar-name">${escapeHtml(p.name || p.id)}</span>
                ${deleteBtn}
                <span class="ccs-pillar-toggle fa-solid fa-chevron-down"></span>
            </div>
            ${p.summary ? `<div class="ccs-pillar-detail" style="display: none;"><p class="ccs-pillar-full-summary">${escapeHtml(p.summary)}</p></div>` : ''}
        </div>
    `;
}

function _showAddPillarDialog() {
    const name = prompt('Enter concept pillar name (e.g., "Core Motivation", "Key Locations"):');
    if (!name?.trim()) return;
    const pillar = addWorldPillar(name.trim());
    if (pillar) {
        showToast(`Added pillar: ${name.trim()}`, 'success', 2000);
        _renderConceptTab();
        _updateProgress();
    } else {
        showToast('Pillar already exists', 'warning', 2000);
    }
}

// ─── Audit Modal ─────────────────────────────────────────────────────────────

function _showAuditModal(report) {
    document.getElementById('ccs_audit_overlay')?.remove();

    const { issues, stats, score } = report;
    const scoreColor = score >= 80 ? 'var(--ccs-success)' : score >= 50 ? '#f0a500' : 'var(--ccs-error)';

    const issueHtml = issues.length === 0
        ? '<div class="ccs-audit-pass"><i class="fa-solid fa-circle-check"></i> All checks passed!</div>'
        : issues.map(i => {
            const icon = i.severity === 'error' ? 'fa-circle-xmark' :
                         i.severity === 'warning' ? 'fa-triangle-exclamation' : 'fa-circle-info';
            return `<div class="ccs-audit-issue ccs-audit-issue--${i.severity}">
                <i class="fa-solid ${icon}"></i>
                <span>${escapeHtml(i.message)}</span>
            </div>`;
        }).join('');

    const overlay = document.createElement('div');
    overlay.id = 'ccs_audit_overlay';
    overlay.className = 'ccs-inspector-overlay';
    overlay.innerHTML = `
    <div class="ccs-inspector-modal ccs-audit-modal">
        <div class="ccs-inspector-header">
            <h3><i class="fa-solid fa-shield-halved"></i> Coherence Audit</h3>
            <button id="ccs_audit_close" class="ccs-icon-btn" title="Close"><i class="fa-solid fa-xmark"></i></button>
        </div>

        <div class="ccs-audit-score-row">
            <div class="ccs-audit-score" style="color:${scoreColor}">${score}<span class="ccs-audit-score-suffix">/100</span></div>
            <div class="ccs-audit-stat-grid">
                <div class="ccs-audit-stat"><span style="color:var(--ccs-error)">${stats.errors}</span> errors</div>
                <div class="ccs-audit-stat"><span style="color:#f0a500">${stats.warnings}</span> warnings</div>
                <div class="ccs-audit-stat"><span>${stats.infos}</span> info</div>
                <div class="ccs-audit-stat"><span>${stats.totalFields}</span> fields</div>
                <div class="ccs-audit-stat"><span>${stats.loreEntries}</span> lore entries</div>
                <div class="ccs-audit-stat"><span>~${(stats.totalTokens + stats.loreTokens).toLocaleString()}</span>t total</div>
            </div>
        </div>

        <div class="ccs-inspector-body">${issueHtml}</div>

        <div class="ccs-inspector-footer">
            <button id="ccs_audit_fix_btn" class="ccs-btn ccs-btn--accent">
                <i class="fa-solid fa-wand-magic-sparkles"></i> Ask AI to Fix
            </button>
            <span class="ccs-inspector-hint">Static analysis — no API calls used</span>
        </div>
    </div>`;

    document.body.appendChild(overlay);

    overlay.querySelector('#ccs_audit_close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#ccs_audit_fix_btn').addEventListener('click', () => {
        overlay.remove();
        const actionable = issues.filter(i => i.severity !== 'info').slice(0, 5);
        if (actionable.length) {
            const list = actionable.map(i => `• ${i.message}`).join('\n');
            sendMessage(`Please help me address these audit issues:\n${list}`);
        } else {
            sendMessage('The coherence audit found no major issues. Can you do a final quality review of the card?');
        }
    });

    function _onKey(e) {
        if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', _onKey); }
    }
    document.addEventListener('keydown', _onKey);
}

let _cardListenerBound = false;

function _renderFieldHistory(row, ccsKey) {
    const session = getSession();
    const history = getFieldHistory(session, ccsKey);
    const panel = row.querySelector('.ccs-field-history-panel');
    if (!panel) return;

    if (!history || history.length === 0) {
        panel.innerHTML = '<p class="ccs-empty-state">No version history available.</p>';
        return;
    }

    const currentVal = row.querySelector('.ccs-field-textarea')?.value || '';

    // Render list of versions
    const items = history.map((ver, idx) => {
        const timeStr = new Date(ver.timestamp).toLocaleString();
        const diffHtml = buildFieldDiffHtml(ver.content, currentVal);

        return `
            <div class="ccs-history-version-item" data-version-index="${idx}">
                <div class="ccs-history-version-header">
                    <span class="ccs-history-version-meta">#${idx + 1} — ${ver.source} — ${timeStr}</span>
                    <button class="ccs-btn ccs-btn--sm ccs-history-restore-btn" data-version-index="${idx}">Restore</button>
                </div>
                <div class="ccs-history-diff-container">${diffHtml}</div>
            </div>
        `;
    }).reverse().join(''); // Show newest first

    panel.innerHTML = `
        <div class="ccs-history-header">
            <span class="ccs-history-title">Version History (Diff to Current)</span>
            <button class="ccs-history-close-btn"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="ccs-history-versions-list">${items}</div>
    `;
}

function _renderCardTab() {
    const session = getSession();
    const fieldsEl = el('ccs_card_fields');
    const tokensEl = el('ccs_card_tokens');
    if (!fieldsEl) return;

    if (!session?.characterAvatar) {
        fieldsEl.innerHTML = '<p class="ccs-empty-state">No character selected.</p>';
        return;
    }

    const ctx = SillyTavern?.getContext?.();
    const fields = ctx?.getCharacterCardFields?.() || {};

    const FIELD_LABELS = {
        description: 'Description',
        personality: 'Personality',
        scenario: 'Scenario',
        firstMessage: 'First Message',
        mesExamples: 'Example Messages',
        system: 'System Prompt',
        creatorNotes: 'Creator Notes',
        charDepthPrompt: 'Character Note',
        alternateGreetings: 'Alt. Greetings',
    };

    let totalTokens = 0;

    const rows = Object.entries(FIELD_LABELS).map(([key, label]) => {
        const value = Array.isArray(fields[key])
            ? fields[key].join('\n---\n')
            : (fields[key] || '');
        const preview = value.trim().substring(0, 80).replace(/\n/g, ' ');
        const hasContent = value.trim().length > 0;

        // Token count (cached real count or sync estimate)
        const tokens = countTokensSync(value);
        totalTokens += tokens;

        // Check manual edit detection
        const ccsFieldMap = {
            description: 'description', personality: 'personality', scenario: 'scenario',
            firstMessage: 'first_mes', mesExamples: 'mes_example', system: 'system_prompt',
            creatorNotes: 'creator_notes', charDepthPrompt: 'character_note',
            alternateGreetings: 'alternate_greetings',
        };
        const ccsKey = ccsFieldMap[key];
        const storedHash = session?.fieldHashes?.[ccsKey];
        const currentHash = hasContent ? hashString(value) : null;
        const wasManuallyEdited = storedHash && currentHash && storedHash !== currentHash;

        const history = getFieldHistory(session, ccsKey);
        const hasHistory = history && history.length > 0;

        return `
            <div class="ccs-field-row ${hasContent ? 'ccs-field-row--filled' : 'ccs-field-row--empty'} ${wasManuallyEdited ? 'ccs-field-row--edited' : ''}" data-field="${key}" data-ccs-field="${ccsKey}">
                <div class="ccs-field-header">
                    <span class="ccs-field-label">${label}</span>
                    ${wasManuallyEdited ? '<span class="ccs-badge ccs-badge--warning" title="Externally edited">✏️</span>' : ''}
                    <span class="ccs-field-tokens">${hasContent ? `~${tokens}t` : 'empty'}</span>
                    
                    <div class="ccs-field-actions-wrap">
                        <button class="ccs-field-action-btn ccs-field-edit-btn" title="Edit Field"><i class="fa-solid fa-pen"></i></button>
                        <button class="ccs-field-action-btn ccs-field-history-btn" title="Version History" style="${hasHistory ? '' : 'display:none;'}"><i class="fa-solid fa-history"></i></button>
                        ${hasContent ? `
                        <button class="ccs-field-action-btn ccs-field-ai-btn ccs-field-expand-btn" title="Expand (AI)"><i class="fa-solid fa-expand"></i></button>
                        <button class="ccs-field-action-btn ccs-field-ai-btn ccs-field-shorten-btn" title="Shorten (AI)"><i class="fa-solid fa-compress"></i></button>
                        <button class="ccs-field-action-btn ccs-field-ai-btn ccs-field-custom-btn" title="Custom AI Instruction"><i class="fa-solid fa-wand-magic-sparkles"></i></button>
                        ` : ''}
                        ${hasContent ? '<span class="ccs-field-toggle fa-solid fa-chevron-down"></span>' : ''}
                    </div>
                </div>
                ${hasContent ? `<p class="ccs-field-preview">${escapeHtml(preview)}${value.length > 80 ? '…' : ''}</p>` : ''}
                ${hasContent ? `<div class="ccs-field-detail" style="display: none;"><pre class="ccs-field-full-content">${escapeHtml(value)}</pre></div>` : ''}
                
                <!-- Inline edit textarea panel -->
                <div class="ccs-field-edit-panel" style="display: none;">
                    <textarea class="ccs-field-textarea" placeholder="Enter content...">${escapeHtml(value)}</textarea>
                    <div class="ccs-field-edit-buttons">
                        <button class="ccs-btn ccs-btn--sm ccs-btn--accent ccs-field-save-btn">Save</button>
                        <button class="ccs-btn ccs-btn--sm ccs-field-cancel-btn">Cancel</button>
                    </div>
                </div>

                <!-- Custom prompt inputs -->
                <div class="ccs-field-custom-panel" style="display: none;">
                    <div class="ccs-field-custom-input-wrap">
                        <input type="text" class="ccs-field-custom-input" placeholder="e.g. Change X to Y, make it darker...">
                        <button class="ccs-btn ccs-btn--sm ccs-btn--accent ccs-field-custom-submit-btn"><i class="fa-solid fa-paper-plane"></i></button>
                        <button class="ccs-btn ccs-btn--sm ccs-field-custom-cancel-btn"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                </div>

                <!-- History / Version Panel -->
                <div class="ccs-field-history-panel" style="display: none;"></div>
            </div>
        `;
    }).join('');

    fieldsEl.innerHTML = rows || '<p class="ccs-empty-state">No fields found.</p>';
    if (tokensEl) tokensEl.textContent = `~${totalTokens}t`;

    // Async upgrade: replace estimates with real token counts
    const fieldContents = {};
    Object.entries(FIELD_LABELS).forEach(([key]) => {
        const val = Array.isArray(fields[key]) ? fields[key].join('\n---\n') : (fields[key] || '');
        if (val.trim()) fieldContents[key] = val;
    });
    if (Object.keys(fieldContents).length > 0) {
        countTokensForFields(fieldContents).then(counts => {
            let newTotal = 0;
            for (const [key, count] of Object.entries(counts)) {
                const row = fieldsEl.querySelector(`[data-field="${key}"]`);
                const tokenSpan = row?.querySelector('.ccs-field-tokens');
                if (tokenSpan) tokenSpan.textContent = `${count}t`;
                newTotal += count;
            }
            // Add zero-content fields back as 0
            if (tokensEl) tokensEl.textContent = `${newTotal}t`;
        }).catch(() => { /* token upgrade is best-effort */ });
    }

    // Bind event handlers (once)
    if (!_cardListenerBound) {
        fieldsEl.addEventListener('click', async (e) => {
            const row = e.target.closest('.ccs-field-row');
            if (!row) return;

            const ccsKey = row.dataset.ccsField;
            const detail = row.querySelector('.ccs-field-detail');
            const toggle = row.querySelector('.ccs-field-toggle');
            const preview = row.querySelector('.ccs-field-preview');
            const editPanel = row.querySelector('.ccs-field-edit-panel');
            const customPanel = row.querySelector('.ccs-field-custom-panel');
            const historyPanel = row.querySelector('.ccs-field-history-panel');

            // 1. Expand/Collapse toggle click
            if (e.target.closest('.ccs-field-toggle') || e.target.closest('.ccs-field-preview')) {
                e.stopPropagation();
                if (detail) {
                    const isExpanded = detail.style.display !== 'none';
                    detail.style.display = isExpanded ? 'none' : 'block';
                    if (preview) preview.style.display = isExpanded ? '' : 'none';
                    if (toggle) {
                        toggle.classList.toggle('fa-chevron-up', !isExpanded);
                        toggle.classList.toggle('fa-chevron-down', isExpanded);
                    }
                }
                return;
            }

            // 2. Edit button click
            if (e.target.closest('.ccs-field-edit-btn')) {
                e.stopPropagation();
                if (editPanel) {
                    const isEditing = editPanel.style.display !== 'none';
                    editPanel.style.display = isEditing ? 'none' : 'block';
                    // Hide others
                    if (customPanel) customPanel.style.display = 'none';
                    if (historyPanel) historyPanel.style.display = 'none';
                    if (detail) detail.style.display = 'none';
                    if (preview) preview.style.display = isEditing ? '' : 'none';
                }
                return;
            }

            // 3. Cancel edit click
            if (e.target.closest('.ccs-field-cancel-btn')) {
                e.stopPropagation();
                if (editPanel) editPanel.style.display = 'none';
                if (preview) preview.style.display = '';
                return;
            }

            // 4. Save edit click
            if (e.target.closest('.ccs-field-save-btn')) {
                e.stopPropagation();
                const textarea = editPanel?.querySelector('.ccs-field-textarea');
                if (textarea) {
                    const newContent = textarea.value;
                    showToast(`Saving ${ccsKey} directly...`, 'info', 2000);
                    const success = await saveFieldDirect(ccsKey, newContent);
                    if (success) {
                        showToast(`${ccsKey} saved successfully!`, 'success');
                    } else {
                        showToast(`Failed to save ${ccsKey}.`, 'error');
                    }
                }
                return;
            }

            // 5. Expand (AI) click
            if (e.target.closest('.ccs-field-expand-btn')) {
                e.stopPropagation();
                sendMessage(`[Action: Expand ${ccsKey}] Please expand the ${ccsKey} field with more detail, richness, and depth.`);
                showToast(`Sending expand instruction for ${ccsKey}...`, 'info');
                return;
            }

            // 6. Shorten (AI) click
            if (e.target.closest('.ccs-field-shorten-btn')) {
                e.stopPropagation();
                sendMessage(`[Action: Shorten ${ccsKey}] Please shorten the ${ccsKey} field to make it more concise, compact, and token-efficient.`);
                showToast(`Sending shorten instruction for ${ccsKey}...`, 'info');
                return;
            }

            // 7. Custom AI button click
            if (e.target.closest('.ccs-field-custom-btn')) {
                e.stopPropagation();
                if (customPanel) {
                    customPanel.style.display = customPanel.style.display === 'none' ? 'block' : 'none';
                    if (editPanel) editPanel.style.display = 'none';
                    if (historyPanel) historyPanel.style.display = 'none';
                }
                return;
            }

            // 8. Custom AI cancel click
            if (e.target.closest('.ccs-field-custom-cancel-btn')) {
                e.stopPropagation();
                if (customPanel) customPanel.style.display = 'none';
                return;
            }

            // 9. Custom AI submit click
            if (e.target.closest('.ccs-field-custom-submit-btn')) {
                e.stopPropagation();
                const input = customPanel?.querySelector('.ccs-field-custom-input');
                if (input && input.value.trim()) {
                    sendMessage(`[Action: Modify ${ccsKey}] Instruction: ${input.value.trim()}`);
                    showToast(`Sending custom instruction for ${ccsKey}...`, 'info');
                    input.value = '';
                    customPanel.style.display = 'none';
                }
                return;
            }

            // 10. History button click
            if (e.target.closest('.ccs-field-history-btn')) {
                e.stopPropagation();
                if (historyPanel) {
                    const isHidden = historyPanel.style.display === 'none';
                    historyPanel.style.display = isHidden ? 'block' : 'none';
                    if (isHidden) {
                        _renderFieldHistory(row, ccsKey);
                    }
                    if (editPanel) editPanel.style.display = 'none';
                    if (customPanel) customPanel.style.display = 'none';
                }
                return;
            }

            // 11. History close click
            if (e.target.closest('.ccs-history-close-btn')) {
                e.stopPropagation();
                if (historyPanel) historyPanel.style.display = 'none';
                return;
            }

            // 12. History restore version click
            if (e.target.closest('.ccs-history-restore-btn')) {
                e.stopPropagation();
                const btn = e.target.closest('.ccs-history-restore-btn');
                const idx = parseInt(btn.dataset.versionIndex, 10);
                const session = getSession();
                const history = getFieldHistory(session, ccsKey);
                const ver = history[idx];
                if (ver) {
                    showToast(`Restoring version #${idx + 1} to ${ccsKey}...`, 'info', 2000);
                    const success = await saveFieldDirect(ccsKey, ver.content);
                    if (success) {
                        showToast(`Restored successfully!`, 'success');
                    } else {
                        showToast(`Failed to restore.`, 'error');
                    }
                }
                return;
            }
        });

        // Add keypress handler for custom input field
        fieldsEl.addEventListener('keydown', (e) => {
            const input = e.target.closest('.ccs-field-custom-input');
            if (input && e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                const submitBtn = input.closest('.ccs-field-custom-panel')?.querySelector('.ccs-field-custom-submit-btn');
                if (submitBtn) submitBtn.click();
            }
        });

        _cardListenerBound = true;
    }
}


async function _renderLoreTab() {
    const loreEl = el('ccs_lore_entries');
    const countEl = el('ccs_lore_count');
    if (!loreEl) return;

    const session = getSession();

    // ── No lorebook selected: show picker ─────────────────────────────────
    if (!session?.lorebookName) {
        if (countEl) countEl.textContent = 'No book selected';

        loreEl.innerHTML = `
        <div class="ccs-lb-picker">
            <div class="ccs-lb-picker-icon"><i class="fa-solid fa-book-atlas"></i></div>
            <h5 class="ccs-lb-picker-title">Choose a Lorebook</h5>
            <p class="ccs-lb-picker-desc">Select an existing lorebook or create a new one to use for this character.</p>
            <div class="ccs-lb-list-wrap" id="ccs_lb_list_wrap">
                <span class="ccs-lb-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading…</span>
            </div>
            <div class="ccs-lb-picker-create">
                <input type="text" id="ccs_lb_new_name" class="ccs-lb-create-input"
                    placeholder="New lorebook name…" maxlength="80" />
                <button id="ccs_lb_create_btn" class="ccs-lb-create-btn">
                    <i class="fa-solid fa-plus"></i> Create New
                </button>
            </div>
        </div>`;

        // Async: populate book list and wire selection buttons
        _populateLoreBookPicker(loreEl);

        // Wire "Create New" button (synchronous — it's already in the DOM)
        loreEl.querySelector('#ccs_lb_create_btn')?.addEventListener('click', async () => {
            const input = loreEl.querySelector('#ccs_lb_new_name');
            const name = input?.value?.trim();
            if (!name) { showToast('Enter a lorebook name first', 'warning', 2000); return; }

            const btn = loreEl.querySelector('#ccs_lb_create_btn');
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating…'; }

            const result = await createWorldInfoBook(name);
            if (result.success) {
                updateSession({ lorebookName: name });
                showToast(`Lorebook created: ${name}`, 'success');
                _renderLoreTab();
            } else {
                showToast(`Create failed: ${result.error}`, 'error');
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-plus"></i> Create New'; }
            }
        });

        return;
    }

    // ── Lorebook selected: render entries ─────────────────────────────────
    const bookName = session.lorebookName;
    const loreDrafts = session?.loreDrafts || [];
    const pendingDrafts = loreDrafts.filter(d => d.status === 'pending');

    let entries = [];
    let tokenBudget = null;
    try {
        const loreData = await getLorebookEntries();
        entries = loreData.entries || [];
        tokenBudget = await getLorebookTokenBudget();
    } catch (e) {
        console.warn('[CCS] Could not fetch lorebook:', e.message);
    }

    if (countEl) {
        let statsText = `${entries.length} entries`;
        if (tokenBudget) statsText += ` · ~${tokenBudget.estimatedUsage}t`;
        countEl.textContent = statsText;
    }

    let html = '';

    // Book info bar with "Change" button
    html += `<div class="ccs-lb-info-bar">
        <span class="ccs-lb-info-name"><i class="fa-solid fa-book"></i> ${escapeHtml(bookName)}</span>
        <button class="ccs-lb-change-btn" id="ccs_lb_change_btn" title="Switch lorebook">
            <i class="fa-solid fa-arrows-rotate"></i> Change
        </button>
    </div>`;

    // Token budget
    if (tokenBudget && entries.length > 0) {
        html += `<div class="ccs-lore-budget">
            <span class="ccs-lore-budget-label">📊 Token Budget:</span>
            <span>📌 Constant: ~${tokenBudget.constantTokens}t</span>
            <span>⚡ Triggered: ~${tokenBudget.conditionalTokens}t</span>
            <span>📈 Est. Usage: ~${tokenBudget.estimatedUsage}t</span>
        </div>`;
    }

    // Staged drafts
    if (pendingDrafts.length) {
        html += `<div class="ccs-lore-staged-section">
            <h5 class="ccs-lore-section-title">⏳ Staged (${pendingDrafts.length})</h5>
            ${pendingDrafts.map(d => `
                <div class="ccs-lore-entry ccs-lore-entry--staged">
                    <div class="ccs-lore-entry-header">
                        <span class="ccs-lore-entry-name">${escapeHtml(d.name || 'Unnamed')}</span>
                        <span class="ccs-badge ccs-badge--warning">${d.type || 'create'}</span>
                        ${d.tokenCount ? `<span class="ccs-lore-entry-tokens">~${d.tokenCount}t</span>` : ''}
                    </div>
                    ${d.keys?.length ? `<div class="ccs-lore-entry-keys">Keys: ${d.keys.map(k => escapeHtml(k)).join(', ')}</div>` : ''}
                    ${d.content ? `<div class="ccs-lore-entry-preview">${escapeHtml(d.content.substring(0, 120))}${d.content.length > 120 ? '…' : ''}</div>` : ''}
                </div>
            `).join('')}
        </div>`;
    }

    // Existing entries
    if (!entries.length && !pendingDrafts.length) {
        html += `<p class="ccs-empty-state">No entries yet. Switch to the Lore phase and ask the AI to create entries.</p>`;
    } else if (entries.length > 0) {
        html += `<div class="ccs-lore-existing-section">
            <h5 class="ccs-lore-section-title">${escapeHtml(bookName)} (${entries.length})</h5>
            ${entries.map(e => `
                <div class="ccs-lore-entry ${e.enabled ? '' : 'ccs-lore-entry--disabled'}">
                    <div class="ccs-lore-entry-header">
                        <span class="ccs-lore-entry-name">${escapeHtml(e.name || 'Unnamed')}</span>
                        ${e.constant ? '<span class="ccs-badge ccs-badge--info">📌</span>' : ''}
                        ${!e.enabled ? '<span class="ccs-badge ccs-badge--muted">off</span>' : ''}
                        <span class="ccs-lore-entry-tokens">~${e.tokens}t</span>
                    </div>
                    ${e.keys.length ? `<div class="ccs-lore-entry-keys">Keys: ${e.keys.map(k => escapeHtml(k)).join(', ')}</div>` : ''}
                    <div class="ccs-lore-entry-preview">${escapeHtml((e.content || '').substring(0, 120))}${(e.content || '').length > 120 ? '…' : ''}</div>
                </div>
            `).join('')}
        </div>`;
    }

    // Recursion warnings
    if (entries.length > 1) {
        try {
            const recursion = await detectRecursion(entries);
            if (recursion.warnings.length > 0) {
                html += `<div class="ccs-lore-recursion-warning">
                    <div class="ccs-lore-section-title">⚠️ Recursion Warnings</div>
                    ${recursion.warnings.map(w => `<div class="ccs-lore-warning-item">${escapeHtml(w)}</div>`).join('')}
                </div>`;
            }
        } catch (e) {
            console.warn('[CCS] Recursion detection failed:', e.message);
        }
    }

    loreEl.innerHTML = html;

    // Wire "Change" button (element is now in DOM)
    loreEl.querySelector('#ccs_lb_change_btn')?.addEventListener('click', () => {
        updateSession({ lorebookName: null });
        _renderLoreTab();
    });
}

/**
 * Async helper: fetch lorebook list and populate the picker's list area.
 */
async function _populateLoreBookPicker(loreEl) {
    const listWrap = loreEl.querySelector('#ccs_lb_list_wrap');
    if (!listWrap) return;

    const books = await listWorldInfoBooks();

    if (!books.length) {
        listWrap.innerHTML = `<p class="ccs-lb-empty">No lorebooks found. Create one below.</p>`;
        return;
    }

    listWrap.innerHTML = books.map(b => `
        <button class="ccs-lb-item" data-book-id="${escapeHtml(b.file_id)}">
            <i class="fa-solid fa-book-open"></i>
            <span class="ccs-lb-item-name">${escapeHtml(b.name || b.file_id)}</span>
        </button>
    `).join('');

    listWrap.querySelectorAll('.ccs-lb-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const bookId = btn.dataset.bookId;
            if (!bookId) return;
            updateSession({ lorebookName: bookId });
            showToast(`Lorebook: ${bookId}`, 'success', 2000);
            _renderLoreTab();
        });
    });
}

// ─── Scratchpad ───────────────────────────────────────────────────────────────

/**
 * Sync the scratchpad textarea value from the current session.
 * Called on open and session change. Does NOT fire updateSession itself.
 */
function _syncScratchpad() {
    const ta = el('ccs_scratchpad');
    if (!ta) return;
    const session = getSession();
    // Only update if not currently focused (avoid overwriting mid-type)
    if (document.activeElement !== ta) {
        ta.value = session?.scratchpad || '';
    }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
    if (!str) return '';
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
}

// ─── Event Binding ────────────────────────────────────────────────────────────

export function bindAppEvents() {
    // Close button
    const closeBtn = el('ccs_close_btn');
    if (closeBtn) closeBtn.addEventListener('click', closeStudio);

    // Prompt Inspector button
    const inspectBtn = el('ccs_inspect_btn');
    if (inspectBtn) {
        inspectBtn.addEventListener('click', () => openPromptInspector());
    }

    // Coherence Audit button is now wired inside _renderConceptTab


    // Settings button
    const settingsBtn = el('ccs_settings_btn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            openSettings();
        });
    }

    // Mode selector
    const modeEl = el('ccs_mode_select');
    if (modeEl) {
        modeEl.addEventListener('change', async (e) => {
            const newMode = e.target.value;
            const session = getSession();
            const oldMode = session?.mode || 'studio';

            if (newMode === oldMode) return;

            // Cancel any active generation before switching
            if (isGenerating()) {
                cancelAllGenerations();
                showToast('Generation cancelled for mode switch', 'info', 2000);
            }

            // Swap chat histories (save old, load new)
            swapModeHistory(oldMode, newMode);

            // Adapt the right panel for the new mode
            adaptPanelForMode(newMode);

            // Update welcome screen and suggestion chips
            await _updateModeUI(newMode);

            // Re-render chat messages for the new mode's history
            try {
                const { renderMessages } = await import('./chat.js');
                renderMessages();
            } catch (e) {
                console.warn('[CCS] chat.js not loaded:', e.message);
            }

            showToast(`Switched to ${e.target.options[e.target.selectedIndex].text}`, 'info');
            _renderRightPanel();
        });
    }

    // Desktop tab headers
    const tabsContainer = el('ccs_tabs');
    if (tabsContainer) {
        tabsContainer.addEventListener('click', (e) => {
            if (isGenerating()) {
                showToast('Please wait for the agent to finish before switching tabs.', 'warning');
                return;
            }
            const btn = e.target.closest('.ccs-tab-btn');
            if (!btn) return;
            switchTab(btn.dataset.tab);
        });
    }

    // Mobile tabs
    const mobileTabs = el('ccs_mobile_tabs');
    if (mobileTabs) {
        mobileTabs.addEventListener('click', (e) => {
            if (isGenerating()) {
                showToast('Please wait for the agent to finish before switching tabs.', 'warning');
                return;
            }
            const btn = e.target.closest('.ccs-mobile-tab-btn');
            if (!btn) return;
            _setMobilePanel(btn.dataset.mobileTab);
        });
    }

    // Resize listener for mobile detection
    window.addEventListener('resize', _handleResize);

    // Backdrop click to close
    const windowEl = el('ccs_window');
    if (windowEl) {
        windowEl.addEventListener('click', (e) => {
            if (e.target === windowEl) closeStudio();
        });
    }

    // Keyboard: Escape to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && _isOpen) closeStudio();
    });

    // Scratchpad: auto-save with 1s debounce + collapse toggle
    const scratchpadEl = el('ccs_scratchpad');
    if (scratchpadEl) {
        let _spTimer = null;
        scratchpadEl.addEventListener('input', () => {
            if (_spTimer) clearTimeout(_spTimer);
            _spTimer = setTimeout(() => {
                updateSession({ scratchpad: scratchpadEl.value });
            }, 1000);
        });
    }
    const spToggle = el('ccs_scratchpad_toggle');
    if (spToggle) {
        spToggle.addEventListener('click', () => {
            const section = el('ccs_scratchpad_section');
            const chevron = el('ccs_scratchpad_chevron');
            const collapsed = section?.classList.toggle('ccs-scratchpad--collapsed');
            if (chevron) {
                chevron.classList.toggle('fa-chevron-up', !collapsed);
                chevron.classList.toggle('fa-chevron-down', collapsed);
            }
        });
    }

    // Lock conflict notifications
    onLockConflict((locked, avatar) => {
        const banner = el('ccs_readonly_banner');
        if (banner) banner.style.display = locked ? 'flex' : 'none';
        if (locked) {
            showToast('Another tab is editing this character. View-only mode.', 'warning', 6000);
        } else {
            showToast('Other tab closed — you now have edit access.', 'success');
            acquireLock(avatar);
        }
    });

    // Listen for card-updated events (fired after Apply succeeds)
    document.addEventListener('ccs:card-updated', () => {
        console.log('[CCS] Card updated — refreshing panels');
        _renderCardTab();
        _renderConceptTab();
        _renderLoreTab();
        _updateProgress();
    });

    // Listen for background conflict detection
    document.addEventListener('ccs:conflict-detected', (e) => {
        const conflict = e.detail;
        console.log('[CCS] Background conflict detected:', conflict);
        showToast(`Conflict detected: ${conflict.fieldA} ↔ ${conflict.fieldB}`, 'warning', 5000);
        _renderConceptTab();
    });

    // Session changes → re-render right panel
    onSessionChange(() => {
        if (!_isOpen) return;
        _updateProgress();
        _renderConceptTab();
        _renderCardTab();
        _renderLoreTab();
        _syncScratchpad();
        syncContextBar();
    });

    // Context bar pills (format + phase switching)
    const ctxBar = el('ccs_context_bar');
    if (ctxBar) {
        ctxBar.addEventListener('click', (e) => {
            if (isGenerating()) {
                showToast('Please wait for the agent to finish before changing phases.', 'warning');
                return;
            }
            const pill = e.target.closest('.ccs-context-pill');
            if (!pill) return;

            if (pill.dataset.format) {
                updateSession({ cardFormat: pill.dataset.format });
                syncContextBar();
                showToast(`Format: ${pill.dataset.format}`, 'info', 2000);
            } else if (pill.dataset.phase) {
                updateSession({ phase: pill.dataset.phase });
                syncContextBar();
                showToast(`Phase: ${pill.dataset.phase}`, 'info', 2000);
            }
        });
    }
}

let _resizeTimer;
function _handleResize() {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(_detectMobile, 150);
}

// ─── Mode UI Updates ─────────────────────────────────────────────────────────

/**
 * Update the chat panel UI (welcome screen, chips, input state) for a mode switch.
 * @param {string} mode - The new mode
 */
async function _updateModeUI(mode) {
    const session = getSession();
    const hasMessages = session?.messages?.length > 0;

    // Update welcome screen content
    const welcomeEl = el('ccs_welcome');
    if (welcomeEl) {
        if (!_defaultWelcomeHtml) {
            _defaultWelcomeHtml = welcomeEl.innerHTML;
        }
        if (!hasMessages) {
            const welcomeHtml = await getWelcomeForMode(mode);
            if (welcomeHtml) {
                welcomeEl.innerHTML = welcomeHtml;
                welcomeEl.style.display = '';
            } else {
                // Studio mode or null — restore default welcome
                welcomeEl.innerHTML = _defaultWelcomeHtml;
                welcomeEl.style.display = '';
            }
        } else {
            welcomeEl.style.display = 'none';
        }
    }

    // Update suggestion chips
    const chipsEl = el('ccs_chips');
    if (chipsEl) {
        const chips = await getChipsForMode(mode);
        if (chips && chips.length > 0) {
            chipsEl.innerHTML = chips.map(c => `
                <button class="ccs-chip" data-chip="${c.text}">
                    <i class="${c.icon}"></i> ${c.text}
                </button>
            `).join('');
        } else if (mode === 'studio') {
            // Restore default Studio chips
            chipsEl.innerHTML = '';
        } else {
            chipsEl.innerHTML = '';
        }
    }

    // Show/hide context bar (format+phase pills are Studio-only)
    const ctxBar = el('ccs_context_bar');
    if (ctxBar) {
        ctxBar.style.display = mode === 'studio' ? '' : 'none';
    }

    // Disable input for blocked modes
    const blocked = await isModeBlocked(mode);
    const inputEl = el('ccs_input');
    const sendBtn = el('ccs_send_btn');
    if (inputEl) {
        inputEl.disabled = blocked;
        inputEl.placeholder = blocked
            ? 'This mode is not yet available.'
            : mode === 'studio'
                ? 'Describe your character idea...'
                : `Ask me to ${_getModeAction(mode)}...`;
    }
    if (sendBtn) {
        sendBtn.disabled = blocked;
    }
}

/**
 * Get a short action verb for a mode's input placeholder.
 * @param {string} mode
 * @returns {string}
 */
function _getModeAction(mode) {
    switch (mode) {
        case 'janitor': return 'convert your card';
        case 'html': return 'generate an HTML intro';
        case 'imageprompt': return 'generate image prompts';
        default: return 'help';
    }
}
