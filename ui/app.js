/**
 * CharCardStudio v4.0.0 — ui/app.js
 * App shell: popup lifecycle, tab switching, session integration, mobile detection
 */

import {
    getSession, loadSession, clearCurrentSession, saveSession,
    setMode, setPhase, onSessionChange,
} from '../core/session.js';
import { acquireLock, releaseLock, isLocked, onLockConflict } from '../core/multi-tab.js';
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

    const total = session.pillarStates.filter(p => p.status !== 'skipped').length;
    const done = session.pillarStates.filter(p => p.status === 'done').length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    updateProgress(pct, `${done}/${total}`);
}

// ─── Tab Management ──────────────────────────────────────────────────────────

export function switchTab(tabName) {
    _activeTab = tabName;
    _renderTabs();
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

    if (_isMobile !== wasMobile) {
        app.classList.toggle('ccs-mobile', _isMobile);
        if (_isMobile) {
            // Mobile: show chat panel by default
            _setMobilePanel('chat');
        }
    }
}

function _setMobilePanel(panel) {
    _activeMobileTab = panel;
    const app = el('ccs_app');
    if (!app) return;

    // Show/hide panels
    const chatPanel = el('ccs_chat_panel');
    const rightPanel = el('ccs_right_panel');

    if (panel === 'chat') {
        if (chatPanel) chatPanel.style.display = 'flex';
        if (rightPanel) rightPanel.style.display = 'none';
    } else {
        if (chatPanel) chatPanel.style.display = 'none';
        if (rightPanel) rightPanel.style.display = 'flex';
        // Switch to the right tab
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

    const done = pillars.filter(p => p.status === 'done').length;
    if (countEl) countEl.textContent = `${done}/${pillars.length}`;

    const STATUS_ICONS = {
        done: '<i class="fa-solid fa-check" style="color: var(--ccs-success)"></i>',
        in_progress: '<i class="fa-solid fa-spinner fa-spin" style="color: var(--ccs-accent)"></i>',
        skipped: '<i class="fa-solid fa-forward" style="color: var(--ccs-text-muted)"></i>',
        pending: '<i class="fa-regular fa-circle" style="color: var(--ccs-text-secondary)"></i>',
    };

    listEl.innerHTML = pillars.map(p => `
        <div class="ccs-pillar ccs-pillar--${p.status}" data-pillar-id="${p.id}">
            <span class="ccs-pillar-status">${STATUS_ICONS[p.status] || STATUS_ICONS.pending}</span>
            <span class="ccs-pillar-name">${escapeHtml(p.name)}</span>
            ${p.summary ? `<span class="ccs-pillar-summary">${escapeHtml(p.summary)}</span>` : ''}
        </div>
    `).join('');
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

        // Rough token estimate (4 chars ≈ 1 token)
        const tokens = Math.round(value.length / 4);
        totalTokens += tokens;

        return `
            <div class="ccs-field-row ${hasContent ? 'ccs-field-row--filled' : 'ccs-field-row--empty'}">
                <div class="ccs-field-header">
                    <span class="ccs-field-label">${label}</span>
                    <span class="ccs-field-tokens">${hasContent ? `~${tokens}t` : 'empty'}</span>
                </div>
                ${hasContent ? `<p class="ccs-field-preview">${escapeHtml(preview)}${value.length > 80 ? '…' : ''}</p>` : ''}
            </div>
        `;
    }).join('');

    fieldsEl.innerHTML = rows || '<p class="ccs-empty-state">No fields found.</p>';
    if (tokensEl) tokensEl.textContent = `~${totalTokens}t`;
}

function _renderLoreTab() {
    const loreEl = el('ccs_lore_entries');
    const countEl = el('ccs_lore_count');
    if (!loreEl) return;

    const session = getSession();
    const categories = session?.loreCategories || [];
    const stagedLore = (session?.stagedDrafts || []).filter(d => d.type === 'lore');

    if (!categories.length && !stagedLore.length) {
        loreEl.innerHTML = '<p class="ccs-empty-state">Lorebook entries will appear here during the Lore phase.</p>';
        if (countEl) countEl.textContent = '0 entries';
        return;
    }

    const total = categories.reduce((sum, cat) => sum + (cat.entries?.length || 0), 0);
    if (countEl) countEl.textContent = `${total} entries`;

    // Staged entries at top
    let html = '';
    if (stagedLore.length) {
        html += `<div class="ccs-lore-staged-section">
            <h5 class="ccs-lore-section-title">Staged (${stagedLore.length})</h5>
            ${stagedLore.map(d => `
                <div class="ccs-lore-entry ccs-lore-entry--staged">
                    <span class="ccs-lore-entry-name">${escapeHtml(d.name || 'Unnamed')}</span>
                    <span class="ccs-badge ccs-badge--warning">Pending</span>
                </div>
            `).join('')}
        </div>`;
    }

    loreEl.innerHTML = html || '<p class="ccs-empty-state">No lore entries yet.</p>';
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

    // Session changes → re-render right panel
    onSessionChange(() => {
        if (!_isOpen) return;
        _updateProgress();
        _renderConceptTab();
        _renderCardTab();
        _renderLoreTab();
    });
}

let _resizeTimer;
function _handleResize() {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(_detectMobile, 150);
}
