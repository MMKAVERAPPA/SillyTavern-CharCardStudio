/**
 * CharCardStudio v4.0.0 — index.js
 * Entry point. Loaded by SillyTavern as type="module".
 *
 * Responsibilities:
 *  - Detect extension path (for renderExtensionTemplateAsync)
 *  - Inject settings.html into ST's extensions panel
 *  - Inject window.html into document body
 *  - Wire the "Open Studio" button
 *  - Subscribe to ST events (CHARACTER_EDITED, etc.)
 *  - Initialize all core modules
 */

import { initSessionManager, loadSession, saveSession, clearCurrentSession, getSession } from './core/session.js';
import { initMultiTab, releaseLock } from './core/multi-tab.js';
import { openStudio, closeStudio, bindAppEvents, updateCharacterName } from './ui/app.js';
import { bindChatEvents, renderMessages, onSend } from './ui/chat.js';
import { showToast } from './ui/toast.js';
import { initAgent } from './core/agent.js';

// ─── Extension Path Detection ─────────────────────────────────────────────────
// ST loads extensions from: /scripts/extensions/third-party/CharCardStudio/index.js
// We need the path prefix for renderExtensionTemplateAsync.

let EXT_PATH = 'third-party/CharCardStudio';

try {
    // Use import.meta.url if available (ES module context)
    if (import.meta?.url) {
        const match = new URL(import.meta.url).pathname.match(/\/scripts\/extensions\/(.+)\/[^/]+\.js$/);
        if (match) EXT_PATH = match[1];
    }
} catch (_) {
    // Fallback: scan script tags
    for (const s of document.getElementsByTagName('script')) {
        if (s.src && s.src.toLowerCase().includes('charcardstudio')) {
            const match = new URL(s.src).pathname.match(/\/scripts\/extensions\/(.+)\/[^/]+\.js$/);
            if (match) { EXT_PATH = match[1]; break; }
        }
    }
}

console.log(`[CCS] Loaded from: ${EXT_PATH}`);

// ─── ST Context Helpers ───────────────────────────────────────────────────────

export function getCtx() {
    return SillyTavern?.getContext?.() ?? null;
}

function getRequestHeaders() {
    return getCtx()?.getRequestHeaders?.() ?? { 'Content-Type': 'application/json' };
}

// ─── Initialization ───────────────────────────────────────────────────────────

async function init() {
    console.log('[CCS] Initializing Character Card Studio v4.2.1...');

    // 1. Initialize session manager (localforage)
    initSessionManager();

    // 2. Initialize multi-tab coordination
    initMultiTab();

    // 3. Inject settings.html into ST's extensions panel
    await _injectSettingsPanel();

    // 4. Inject main window template into body
    await _injectWindowTemplate();

    // 5. Bind all UI events
    bindAppEvents();
    bindChatEvents();

    // 5b. Initialize the AI agent (wires into chat's onSend callback)
    initAgent(onSend);

    // 6. Wire the Open Studio button in settings drawer + wand menu
    _bindSettingsButton();
    _addWandMenuButton();

    // 7. Subscribe to ST events
    _subscribeToSTEvents();

    // 8. Handle page unload — save session and release lock
    window.addEventListener('beforeunload', _onBeforeUnload);

    console.log('[CCS] Ready.');
}

// ─── Wand Menu Button ────────────────────────────────────────────────────────

function _addWandMenuButton() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('ccs_wand_btn')) return;

    const btn = document.createElement('div');
    btn.id = 'ccs_wand_btn';
    btn.classList.add('list-group-item', 'flex-container', 'flexGap5');
    btn.innerHTML = '<div class="fa-solid fa-wand-magic-sparkles extensionsMenuExtensionButton"></div><span>Character Card Studio</span>';
    btn.title = 'Open Character Card Studio';
    btn.addEventListener('click', () => {
        // Close the extensions menu
        document.getElementById('extensionsMenuButton')?.click();
        openStudio();
    });
    menu.appendChild(btn);
}

// ─── Settings Panel Injection ─────────────────────────────────────────────────

async function _injectSettingsPanel() {
    const ctx = getCtx();
    const container = document.getElementById('extensions_settings')
        || document.getElementById('extensions_settings2');

    if (!container) {
        console.warn('[CCS] extensions_settings container not found.');
        return;
    }

    try {
        let html;
        if (ctx?.renderExtensionTemplateAsync) {
            html = await ctx.renderExtensionTemplateAsync(EXT_PATH, 'settings');
        } else {
            // Fallback: fetch directly
            const res = await fetch(`/scripts/extensions/${EXT_PATH}/settings.html`);
            html = await res.text();
        }
        if (html) container.insertAdjacentHTML('beforeend', html);
    } catch (err) {
        console.error('[CCS] Failed to inject settings panel:', err);
    }
}

// ─── Window Template Injection ────────────────────────────────────────────────

async function _injectWindowTemplate() {
    // Check if already injected
    if (document.getElementById('ccs_window')) return;

    const ctx = getCtx();

    try {
        let html;
        if (ctx?.renderExtensionTemplateAsync) {
            html = await ctx.renderExtensionTemplateAsync(EXT_PATH, 'templates/window');
        } else {
            const res = await fetch(`/scripts/extensions/${EXT_PATH}/templates/window.html`);
            html = await res.text();
        }
        if (html) document.body.insertAdjacentHTML('beforeend', html);
    } catch (err) {
        console.error('[CCS] Failed to inject window template:', err);
        showToast('Studio failed to load template.', 'error');
    }
}

// ─── Button Binding ───────────────────────────────────────────────────────────

function _bindSettingsButton() {
    // Use event delegation — the button may be injected after DOMContentLoaded
    document.addEventListener('click', (e) => {
        if (e.target.closest('#ccs_open_studio_btn')) {
            e.preventDefault();
            openStudio();
        }
    });
}

// ─── ST Event Subscriptions ───────────────────────────────────────────────────

function _subscribeToSTEvents() {
    const ctx = getCtx();
    if (!ctx) return;

    const es = ctx.eventSource || window.eventSource;
    const et = ctx.event_types || window.event_types || {};

    if (!es) {
        console.warn('[CCS] ST eventSource not available.');
        return;
    }

    // Character switched — save current session, load new one
    const onCharacterChange = async () => {
        const prevSession = getSession();
        if (prevSession) {
            saveSession(true);
            clearCurrentSession();
        }

        const newCtx = getCtx();
        const character = newCtx?.characters?.[newCtx?.characterId];

        if (character?.avatar) {
            await loadSession(character.avatar, character.name || '');

            // Update UI if studio is open
            const windowEl = document.getElementById('ccs_window');
            if (windowEl && windowEl.style.display !== 'none') {
                updateCharacterName(character.name || '');
                renderMessages();
            }
        }
    };

    // CHARACTER_EDITED — another process saved the card, update our hash tracking
    const onCharacterEdited = () => {
        console.log('[CCS] Character edited externally — dispatching card-updated');
        document.dispatchEvent(new CustomEvent('ccs:card-updated'));
    };

    // APP_READY — ST is fully loaded
    const onAppReady = () => {
        console.log('[CCS] ST APP_READY received.');
        _addWandMenuButton(); // Retry in case menu wasn't ready at init
        // Load session for currently selected character if any
        const ctx = getCtx();
        const character = ctx?.characters?.[ctx?.characterId];
        if (character?.avatar) {
            loadSession(character.avatar, character.name || '').catch(console.error);
        }
    };

    // Subscribe
    if (et.CHAT_CHANGED) es.on(et.CHAT_CHANGED, onCharacterChange);
    if (et.CHARACTER_SELECTED) es.on(et.CHARACTER_SELECTED, onCharacterChange);
    if (et.CHARACTER_EDITED) es.on(et.CHARACTER_EDITED, onCharacterEdited);
    if (et.APP_READY) es.on(et.APP_READY, onAppReady);

    // Fallback string event names
    if (!et.CHAT_CHANGED) es.on('chat_changed', onCharacterChange);
    if (!et.CHARACTER_SELECTED) es.on('character_selected', onCharacterChange);
    if (!et.APP_READY) es.on('app_ready', onAppReady);
}

// ─── Page Unload ──────────────────────────────────────────────────────────────

function _onBeforeUnload() {
    saveSession(true);
    releaseLock();
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────
// ST loads this as type="module". Use jQuery's ready (ST's jQuery is available globally)
// to ensure DOM is ready before injection.

if (typeof jQuery !== 'undefined') {
    jQuery(async () => {
        try {
            await init();
        } catch (err) {
            console.error('[CCS] Initialization failed:', err);
        }
    });
} else {
    // Fallback if jQuery somehow not available
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 0);
    }
}
