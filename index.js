// index.js
// SillyTavern Extension entry point for Character Card Studio v3.0.0
// Uses the same proven pattern as SillyTavern-MemoryBooks for maximum compatibility.

import { eventSource, event_types } from '../../../../script.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';

import { studioPopup } from './ui/popup.js';
import { settingsModal } from './ui/settings-modal.js';
import { memoryManager } from './core/memory.js';
import { cardManager } from './core/card.js';
import { apiManager } from './core/api.js';
import { toastManager } from './ui/toast.js';

const EXT_NAME = 'CharCardStudio';

// ── jQuery shorthand (always available in ST) ────────────────────────────────
const $ = window.jQuery;

// ── Selectors ────────────────────────────────────────────────────────────────
const SELECTORS = {
    extensionsMenu: '#extensionsMenu',
    menuItem: '#ccs-menu-item',
};

// ── Main init (mirrors MemoryBooks pattern exactly) ──────────────────────────

async function init() {
    // Guard: only run once
    if (window._ccsInitialized) return;
    window._ccsInitialized = true;

    // Global error boundary: surface unhandled CCS rejections as a toast
    // rather than silently losing them or crashing the page.
    if (!window._ccsErrorBoundary) {
        window._ccsErrorBoundary = true;
        window.addEventListener('unhandledrejection', (event) => {
            const reason = event.reason;
            if (!reason) return;
            const stack = reason?.stack || reason?.message || String(reason);
            // Only catch errors originating from CharCardStudio code paths
            if (!stack.includes('CharCardStudio') && !stack.includes('/ccs-')) return;
            console.error(`[${EXT_NAME}] Unhandled rejection:`, reason);
            toastManager.show(`⚠️ Studio error: ${reason?.message || reason}`, 'error');
        });
    }

    // DEBUG: Expose modules to window for console testing
    if (!window._ccsModules) {
        window._ccsModules = {
            studioPopup,
            settingsModal,
            memoryManager,
            cardManager,
            apiManager,
            toastManager,
        };
    }

    // Init memory/settings
    try { memoryManager.init(); } catch (e) { console.warn(`[${EXT_NAME}] memoryManager.init failed:`, e); }

    // Poll until the extensions menu is available (same approach as MemoryBooks)
    let attempts = 0;
    while ($(SELECTORS.extensionsMenu).length === 0 && attempts < 20) {
        await new Promise(resolve => setTimeout(resolve, 500));
        attempts++;
    }

    // Inject the wand-menu entry
    createUI();

    // Register slash command
    registerSlashCommand();

    // Register ST event listeners
    registerSTEvents();

    console.log(`[${EXT_NAME}] v3.2.0 loaded ✓`);
}

// ── Wand-menu entry (the ONLY entry point — works on desktop and mobile) ──────

function createUI() {
    // Don't inject twice
    if ($(SELECTORS.menuItem).length > 0) return;

    const menuItem = $(`
        <div id="ccs-menu-item-container" class="extension_container interactable" tabindex="0">
            <div id="ccs-menu-item" class="list-group-item flex-container flexGap5 interactable" tabindex="0">
                <div class="fa-fw fa-solid fa-pen-nib extensionsMenuExtensionButton"></div>
                <span>Card Studio</span>
            </div>
        </div>
    `);

    const extensionsMenu = $(SELECTORS.extensionsMenu);
    if (extensionsMenu.length > 0) {
        extensionsMenu.append(menuItem);
        console.log(`[${EXT_NAME}] Extensions menu entry injected`);
    } else {
        console.warn(`[${EXT_NAME}] Extensions menu not found`);
    }
}

// ── Bind click via jQuery event delegation (robust, survives DOM mutations) ──

$(document).on('click', SELECTORS.menuItem, () => openStudio());

// Settings panel "Open Studio" button (injected by ST from settings.html)
$(document).on('click', '#ccs-open-studio-btn', () => openStudio());

// ── Slash command ─────────────────────────────────────────────────────────────

function registerSlashCommand() {
    try {
        SlashCommandParser.addCommandObject(
            SlashCommand.fromProps({
                name: 'charforge',
                aliases: ['ccs', 'cardstudio'],
                helpString: 'Open the Character Card Studio',
                unnamedArgumentList: [],
                callback: () => { openStudio(); return ''; },
            })
        );
        console.log(`[${EXT_NAME}] Slash commands registered`);
    } catch (err) {
        console.warn(`[${EXT_NAME}] Slash command registration failed:`, err);
    }
}

// ── ST event listeners ────────────────────────────────────────────────────────

function registerSTEvents() {
    try {
        if (!eventSource || !event_types) return;

        // Re-inject menu entry if ST re-renders the UI
        eventSource.on(event_types.APP_READY, () => createUI());

        // BUG-032 FIX: Refresh the studio's full card field cache when the user
        // edits the character externally in ST while the studio is open.
        // Previously this only updated the name label, leaving cardFields stale.
        eventSource.on(event_types.CHARACTER_EDITED, () => {
            studioPopup.refreshCardFields();
        });
    } catch (err) {
        console.warn(`[${EXT_NAME}] Event registration failed:`, err);
    }
}


// ── Open studio ───────────────────────────────────────────────────────────────

function openStudio() {
    try {
        const support = apiManager.checkApiSupport();
        if (!support.generateRaw) {
            toastManager.show('⚠️ SillyTavern 1.12+ required for generation. Studio opened in read-only mode.', 'warning');
        } else if (!support.isConnected) {
            toastManager.show('⚠️ No API connected. Connect one in ST to generate.', 'warning');
        }
    } catch (err) {
        console.warn(`[${EXT_NAME}] API check failed:`, err);
    }
    studioPopup.open();
}

// ── Bootstrap — same as MemoryBooks ──────────────────────────────────────────

$(document).ready(() => {
    if (eventSource && event_types?.APP_READY) {
        eventSource.on(event_types.APP_READY, init);
    }
    // Fallback: run after 2 seconds regardless
    setTimeout(init, 2000);
});
