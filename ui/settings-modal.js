/**
 * CharCardStudio v4.0.0 — ui/settings-modal.js
 * Settings modal: open/close, tab switching, export/import sessions, clear data.
 */

import {
    getSession, saveSession, resetCurrentSession,
    updateSession, loadSession,
} from '../core/session.js';
import { showToast } from './toast.js';
import { getCtx } from '../index.js';

// ─── State ──────────────────────────────────────────────────────────────────

let _isOpen = false;
let _templateInjected = false;

// ─── DOM Helper ─────────────────────────────────────────────────────────────

function el(id) {
    return document.getElementById(id);
}

// ─── Open / Close ───────────────────────────────────────────────────────────

/**
 * Open the settings modal.
 */
export async function openSettings() {
    if (_isOpen) return;

    // Inject template on first open (lazy)
    if (!_templateInjected) {
        await _injectTemplate();
        _bindEvents();
        _templateInjected = true;
    }

    _syncSettingsUI();
    _updateSessionInfo();
    _updateStorageInfo();

    const overlay = el('ccs_settings_overlay');
    if (overlay) {
        overlay.style.display = 'flex';
        _isOpen = true;
    }
}

/**
 * Close the settings modal.
 */
export function closeSettings() {
    const overlay = el('ccs_settings_overlay');
    if (overlay) overlay.style.display = 'none';
    _isOpen = false;
}

export function isSettingsOpen() {
    return _isOpen;
}

// ─── Template Injection ─────────────────────────────────────────────────────

async function _injectTemplate() {
    if (el('ccs_settings_overlay')) return;

    const ctx = getCtx();
    let html;

    try {
        // Try ST's template loader first
        const extPath = _getExtPath();
        if (ctx?.renderExtensionTemplateAsync) {
            html = await ctx.renderExtensionTemplateAsync(extPath, 'templates/settings-modal');
        } else {
            const res = await fetch(`/scripts/extensions/${extPath}/templates/settings-modal.html`);
            html = await res.text();
        }
    } catch (err) {
        console.error('[CCS] Failed to load settings template:', err);
        return;
    }

    if (html) {
        document.body.insertAdjacentHTML('beforeend', html);
    }
}

function _getExtPath() {
    try {
        if (import.meta?.url) {
            const match = new URL(import.meta.url).pathname.match(/\/scripts\/extensions\/(.+)\/[^/]+\/[^/]+\.js$/);
            if (match) return match[1];
        }
    } catch (_) { /* fallback */ }
    return 'third-party/CharCardStudio';
}

// ─── Event Binding ──────────────────────────────────────────────────────────

function _bindEvents() {
    // Close button
    const closeBtn = el('ccs_settings_close');
    if (closeBtn) closeBtn.addEventListener('click', closeSettings);

    // Overlay click-to-close
    const overlay = el('ccs_settings_overlay');
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeSettings();
        });
    }

    // Tab switching
    const tabContainer = document.querySelector('.ccs-settings-tabs');
    if (tabContainer) {
        tabContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.ccs-settings-tab-btn');
            if (!btn) return;
            const tab = btn.dataset.settingsTab;
            if (!tab) return;

            // Deactivate all
            document.querySelectorAll('.ccs-settings-tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.ccs-settings-panel').forEach(p => p.classList.remove('active'));

            // Activate selected
            btn.classList.add('active');
            const panel = document.querySelector(`[data-settings-panel="${tab}"]`);
            if (panel) panel.classList.add('active');
        });
    }

    // Format selector
    const formatEl = el('ccs_setting_format');
    if (formatEl) {
        formatEl.addEventListener('change', () => {
            updateSession({ cardFormat: formatEl.value });
            showToast(`Format set to ${formatEl.value}`, 'info', 2000);
        });
    }

    // Summary threshold range
    const rangeEl = el('ccs_setting_summary_threshold');
    const rangeValEl = el('ccs_setting_summary_value');
    if (rangeEl && rangeValEl) {
        rangeEl.addEventListener('input', () => {
            rangeValEl.textContent = rangeEl.value;
        });
    }

    // Export session
    const exportBtn = el('ccs_export_session');
    if (exportBtn) exportBtn.addEventListener('click', _exportSession);

    // Import session
    const importInput = el('ccs_import_session');
    if (importInput) importInput.addEventListener('change', _importSession);

    // Clear session
    const clearBtn = el('ccs_clear_session');
    if (clearBtn) clearBtn.addEventListener('click', _clearSession);

    // Clear all sessions
    const clearAllBtn = el('ccs_clear_all');
    if (clearAllBtn) clearAllBtn.addEventListener('click', _clearAllSessions);
}

// ─── Sync UI State ──────────────────────────────────────────────────────────

function _syncSettingsUI() {
    const session = getSession();
    if (!session) return;

    const formatEl = el('ccs_setting_format');
    if (formatEl) formatEl.value = session.cardFormat || 'prose';
}

function _updateSessionInfo() {
    const infoEl = el('ccs_session_info');
    if (!infoEl) return;

    const session = getSession();
    if (!session) {
        infoEl.innerHTML = '<p class="ccs-text-muted">No session loaded.</p>';
        return;
    }

    const msgCount = session.messages?.length || 0;
    const draftCount = Object.keys(session.cardDrafts || {}).length;
    const loreCount = (session.loreDrafts || []).length;
    const pillarCount = (session.pillarStates || []).length;
    const createdDate = session.createdAt ? new Date(session.createdAt).toLocaleDateString() : 'Unknown';
    const mode = session.mode || 'studio';

    infoEl.innerHTML = `
        <div class="ccs-session-stats">
            <div class="ccs-stat"><span class="ccs-stat-value">${session.characterName || 'Unknown'}</span><span class="ccs-stat-label">Character</span></div>
            <div class="ccs-stat"><span class="ccs-stat-value">${mode}</span><span class="ccs-stat-label">Mode</span></div>
            <div class="ccs-stat"><span class="ccs-stat-value">${msgCount}</span><span class="ccs-stat-label">Messages</span></div>
            <div class="ccs-stat"><span class="ccs-stat-value">${draftCount}</span><span class="ccs-stat-label">Drafts</span></div>
            <div class="ccs-stat"><span class="ccs-stat-value">${pillarCount}</span><span class="ccs-stat-label">Pillars</span></div>
            <div class="ccs-stat"><span class="ccs-stat-value">${createdDate}</span><span class="ccs-stat-label">Created</span></div>
        </div>
    `;
}

async function _updateStorageInfo() {
    const infoEl = el('ccs_storage_info');
    if (!infoEl) return;

    try {
        // Estimate storage via localforage
        let count = 0;
        let totalSize = 0;

        // localforage is globally available in ST
        if (typeof localforage !== 'undefined') {
            const store = localforage.createInstance({ name: 'SillyTavern_CharCardStudio', storeName: 'sessions' });
            const keys = await store.keys();
            count = keys.length;

            // Estimate size from a sample
            for (const key of keys.slice(0, 5)) {
                const val = await store.getItem(key);
                if (val) totalSize += JSON.stringify(val).length;
            }
            if (keys.length > 5) {
                totalSize = Math.round(totalSize / 5 * keys.length);
            }
        }

        const sizeStr = totalSize > 1024 * 1024
            ? `${(totalSize / 1024 / 1024).toFixed(1)} MB`
            : totalSize > 1024
                ? `${(totalSize / 1024).toFixed(1)} KB`
                : `${totalSize} bytes`;

        infoEl.innerHTML = `
            <div class="ccs-session-stats">
                <div class="ccs-stat"><span class="ccs-stat-value">${count}</span><span class="ccs-stat-label">Saved Sessions</span></div>
                <div class="ccs-stat"><span class="ccs-stat-value">~${sizeStr}</span><span class="ccs-stat-label">Estimated Size</span></div>
            </div>
        `;
    } catch (err) {
        infoEl.innerHTML = '<p class="ccs-text-muted">Could not estimate storage usage.</p>';
    }
}

// ─── Export / Import ────────────────────────────────────────────────────────

function _exportSession() {
    const session = getSession();
    if (!session) {
        showToast('No session to export.', 'warning');
        return;
    }

    const data = JSON.stringify(session, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `ccs_session_${(session.characterName || 'unknown').replace(/\s+/g, '_')}_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('Session exported!', 'success');
}

async function _importSession(e) {
    const file = e.target?.files?.[0];
    if (!file) return;

    try {
        const text = await file.text();
        const data = JSON.parse(text);

        // Basic validation
        if (!data.characterAvatar && !data.characterName) {
            showToast('Invalid session file — missing character data.', 'error');
            return;
        }

        // Confirm overwrite
        const session = getSession();
        if (session?.messages?.length > 0) {
            const confirm = window.confirm(
                `This will replace your current session for "${session.characterName || 'this character'}". Continue?`
            );
            if (!confirm) return;
        }

        // Import: use loadSession's path to restore the session
        // We write the data directly to the storage and reload
        if (typeof localforage !== 'undefined') {
            const store = localforage.createInstance({ name: 'SillyTavern_CharCardStudio', storeName: 'sessions' });
            const key = `session_${data.characterAvatar || data.characterName || 'import'}`;
            await store.setItem(key, data);

            // Reload session
            await loadSession(data.characterAvatar, data.characterName);
            showToast(`Session imported for ${data.characterName || 'character'}!`, 'success');

            _updateSessionInfo();

            // Re-render chat
            try {
                const { renderMessages } = await import('./chat.js');
                renderMessages();
            } catch (_) { /* chat not loaded yet */ }
        } else {
            showToast('Storage not available — cannot import.', 'error');
        }
    } catch (err) {
        console.error('[CCS] Import error:', err);
        showToast(`Import failed: ${err.message}`, 'error');
    }

    // Reset file input so same file can be re-imported
    e.target.value = '';
}

// ─── Clear Sessions ─────────────────────────────────────────────────────────

function _clearSession() {
    const session = getSession();
    if (!session) {
        showToast('No session to clear.', 'warning');
        return;
    }

    const confirmed = window.confirm(
        `Delete all chat history and drafts for "${session.characterName || 'this character'}"? This cannot be undone.`
    );
    if (!confirmed) return;

    resetCurrentSession();
    showToast('Session cleared.', 'success');
    _updateSessionInfo();
    closeSettings();

    // Re-render chat to show welcome screen
    try {
        import('./chat.js').then(({ renderMessages }) => renderMessages());
    } catch (_) { /* ok */ }
}

async function _clearAllSessions() {
    // Double confirmation for danger action
    const confirmed1 = window.confirm(
        'Delete ALL CharCardStudio sessions for ALL characters? This is permanent.'
    );
    if (!confirmed1) return;

    const confirmed2 = window.confirm(
        'Are you absolutely sure? Type "delete" in the next prompt to confirm.'
    );
    if (!confirmed2) return;

    const typed = window.prompt('Type "delete" to confirm deleting all sessions:');
    if (typed?.toLowerCase() !== 'delete') {
        showToast('Cancelled — sessions were not deleted.', 'info');
        return;
    }

    try {
        if (typeof localforage !== 'undefined') {
            const store = localforage.createInstance({ name: 'SillyTavern_CharCardStudio', storeName: 'sessions' });
            await store.clear();
            resetCurrentSession();
            showToast('All sessions deleted.', 'success');
            _updateSessionInfo();
            _updateStorageInfo();
            closeSettings();
        }
    } catch (err) {
        console.error('[CCS] Clear all error:', err);
        showToast(`Failed: ${err.message}`, 'error');
    }
}
