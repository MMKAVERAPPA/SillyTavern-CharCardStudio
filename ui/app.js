/**
 * CharCardStudio v4.0.0 — ui/app.js
 * App shell: popup lifecycle, tab switching, session integration, mobile detection
 */

import {
    getSession, loadSession, clearCurrentSession, saveSession,
    setMode, setPhase, updateSession, onSessionChange, hashString,
} from '../core/session.js';
import { acquireLock, releaseLock, isLocked, onLockConflict } from '../core/multi-tab.js';
import { calculateProgress, getSubProgress, addWorldPillar, removeWorldPillar } from '../core/pillars.js';
import { getLorebookEntries, getLorebookTokenBudget, detectRecursion } from '../core/lorebook.js';
import { calculateStarRating, renderStarHtml } from '../core/validators.js';
import { showToast } from './toast.js';

// ─── State ───────────────────────────────────────────────────────────────────

let _isOpen = false;
let _isMobile = false;
let _activeTab = 'concept';
let _activeMobileTab = 'chat';
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
    _renderTopBar();
    _renderTabs();

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
}

let _pillarListenerBound = false;

function _renderConceptTab() {
    const session = getSession();
    const listEl = el('ccs_pillar_list');
    const countEl = el('ccs_pillar_count');
    if (!listEl) return;

    const pillars = session?.pillarStates || [];

    if (!pillars.length) {
        listEl.innerHTML = '<p class="ccs-empty-state">Start a conversation to define your character\'s core pillars.</p>';
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

    // Star Rating
    const rating = calculateStarRating(session);
    html += `<div class="ccs-star-rating">
        <div class="ccs-star-rating-stars">${renderStarHtml(rating.stars)}</div>
        <div class="ccs-star-rating-details">${rating.details}</div>
        ${rating.modifiers.length ? `<div class="ccs-star-rating-modifiers">${rating.modifiers.join(' · ')}</div>` : ''}
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

let _cardListenerBound = false;

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

        // Rough token estimate (4 chars ≈ 1 token)
        const tokens = Math.round(value.length / 4);
        totalTokens += tokens;

        // Check manual edit detection
        const ccsFieldMap = {
            description: 'description', personality: 'personality', scenario: 'scenario',
            firstMessage: 'first_mes', mesExamples: 'mes_example', system: 'system_prompt',
            creatorNotes: 'creator_notes', charDepthPrompt: 'character_note',
        };
        const ccsKey = ccsFieldMap[key];
        const storedHash = session?.fieldHashes?.[ccsKey];
        const currentHash = hasContent ? hashString(value) : null;
        const wasManuallyEdited = storedHash && currentHash && storedHash !== currentHash;

        return `
            <div class="ccs-field-row ${hasContent ? 'ccs-field-row--filled' : 'ccs-field-row--empty'} ${wasManuallyEdited ? 'ccs-field-row--edited' : ''}" data-field="${key}">
                <div class="ccs-field-header">
                    <span class="ccs-field-label">${label}</span>
                    ${wasManuallyEdited ? '<span class="ccs-badge ccs-badge--warning" title="Externally edited">✏️</span>' : ''}
                    <span class="ccs-field-tokens">${hasContent ? `~${tokens}t` : 'empty'}</span>
                    ${hasContent ? '<span class="ccs-field-toggle fa-solid fa-chevron-down"></span>' : ''}
                </div>
                ${hasContent ? `<p class="ccs-field-preview">${escapeHtml(preview)}${value.length > 80 ? '…' : ''}</p>` : ''}
                ${hasContent ? `<div class="ccs-field-detail" style="display: none;"><pre class="ccs-field-full-content">${escapeHtml(value)}</pre></div>` : ''}
            </div>
        `;
    }).join('');

    fieldsEl.innerHTML = rows || '<p class="ccs-empty-state">No fields found.</p>';
    if (tokensEl) tokensEl.textContent = `~${totalTokens}t`;

    // Bind expand/collapse (once)
    if (!_cardListenerBound) {
        fieldsEl.addEventListener('click', (e) => {
            const row = e.target.closest('.ccs-field-row');
            if (!row) return;
            const detail = row.querySelector('.ccs-field-detail');
            const toggle = row.querySelector('.ccs-field-toggle');
            const preview = row.querySelector('.ccs-field-preview');
            if (detail) {
                const isExpanded = detail.style.display !== 'none';
                detail.style.display = isExpanded ? 'none' : 'block';
                if (preview) preview.style.display = isExpanded ? '' : 'none';
                if (toggle) {
                    toggle.classList.toggle('fa-chevron-up', !isExpanded);
                    toggle.classList.toggle('fa-chevron-down', isExpanded);
                }
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
    const loreDrafts = session?.loreDrafts || [];
    const pendingDrafts = loreDrafts.filter(d => d.status === 'pending');

    // Fetch real entries from character data
    let entries = [];
    let bookName = null;
    let tokenBudget = null;
    try {
        const loreData = await getLorebookEntries();
        entries = loreData.entries || [];
        bookName = loreData.bookName;
        tokenBudget = await getLorebookTokenBudget();
    } catch (e) {
        console.warn('[CCS] Could not fetch lorebook:', e.message);
    }

    if (!entries.length && !pendingDrafts.length) {
        loreEl.innerHTML = '<p class="ccs-empty-state">No lorebook entries yet. Switch to the Lore phase to create entries.</p>';
        if (countEl) countEl.textContent = '0 entries';
        return;
    }

    // Header stats
    if (countEl) {
        let statsText = `${entries.length} entries`;
        if (tokenBudget) {
            statsText += ` · ~${tokenBudget.estimatedUsage}t`;
        }
        countEl.textContent = statsText;
    }

    let html = '';

    // Token budget summary
    if (tokenBudget && entries.length > 0) {
        html += `<div class="ccs-lore-budget">
            <span class="ccs-lore-budget-label">📊 Token Budget:</span>
            <span>📌 Constant: ~${tokenBudget.constantTokens}t</span>
            <span>⚡ Triggered: ~${tokenBudget.conditionalTokens}t</span>
            <span>📈 Est. Usage: ~${tokenBudget.estimatedUsage}t</span>
        </div>`;
    }

    // Staged drafts section
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

    // Existing entries section
    if (entries.length > 0) {
        html += `<div class="ccs-lore-existing-section">
            <h5 class="ccs-lore-section-title">${bookName ? escapeHtml(bookName) : 'Lorebook'} (${entries.length})</h5>
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

    // Settings button
    const settingsBtn = el('ccs_settings_btn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            showToast('Settings panel coming in Phase D', 'info');
        });
    }

    // Mode selector
    const modeEl = el('ccs_mode_select');
    if (modeEl) {
        modeEl.addEventListener('change', (e) => {
            setMode(e.target.value);
            showToast(`Switched to ${e.target.options[e.target.selectedIndex].text}`, 'info');
            _renderRightPanel();
        });
    }

    // Desktop tab headers
    const tabsContainer = el('ccs_tabs');
    if (tabsContainer) {
        tabsContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.ccs-tab-btn');
            if (!btn) return;
            switchTab(btn.dataset.tab);
        });
    }

    // Mobile tabs
    const mobileTabs = el('ccs_mobile_tabs');
    if (mobileTabs) {
        mobileTabs.addEventListener('click', (e) => {
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
        syncContextBar();
    });

    // Context bar pills (format + phase switching)
    const ctxBar = el('ccs_context_bar');
    if (ctxBar) {
        ctxBar.addEventListener('click', (e) => {
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
