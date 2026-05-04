// index.js
// SillyTavern Extension entry point for Character Card Studio v2.0.0
// Registers the extension, injects UI entry points, handles settings panel

import { studioPopup } from './ui/popup.js';
import { memoryManager } from './core/memory.js';
import { apiManager } from './core/api.js';

const EXT_NAME = 'CharCardStudio';

// ── Init ───────────────────────────────────────────────────────────────────────

(function initExtension() {
    try {
        // Init memory/settings
        memoryManager.init();

        // Inject toolbar button (message bar)
        injectToolbarButton();

        // Bind the settings.html "Open Studio" button
        bindSettingsPanelButton();

        // Register slash command
        registerSlashCommand();

        // Register event listeners
        registerSTEvents();

        console.log(`[${EXT_NAME}] v2.0.0 loaded ✓`);
    } catch (err) {
        console.error(`[${EXT_NAME}] Init failed:`, err);
    }
})();

// ── Toolbar button injection ───────────────────────────────────────────────────

function injectToolbarButton() {
    // Try primary injection target: the send form area
    const injectTargets = [
        '#send_form',
        '#rightSendForm',
        '.form_create',
        '#chat_input_area',
    ];

    let injected = false;
    for (const selector of injectTargets) {
        const target = document.querySelector(selector);
        if (target) {
            const btn = createToolbarBtn();
            target.appendChild(btn);
            injected = true;
            break;
        }
    }

    // Fallback: floating button in bottom-right corner (always visible)
    const fallback = document.createElement('div');
    fallback.id = 'ccs-float-btn';
    fallback.className = 'ccs-float-btn';
    fallback.innerHTML = '🎭';
    fallback.title = 'Character Card Studio';
    fallback.addEventListener('click', openStudio);
    document.body.appendChild(fallback);

    if (!injected) {
        console.warn(`[${EXT_NAME}] Could not find toolbar target — floating button active`);
    }
}

function createToolbarBtn() {
    const btn = document.createElement('div');
    btn.id = 'ccs-toolbar-btn';
    btn.className = 'ccs-toolbar-btn fa-solid fa-pen-nib';
    btn.title = 'Character Card Studio (✒️)';
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('role', 'button');
    btn.addEventListener('click', openStudio);
    btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') openStudio(); });
    return btn;
}

// ── Settings panel button (CSP-safe) ─────────────────────────────────────────

function bindSettingsPanelButton() {
    // ST renders settings.html into the extensions panel — we need to wait for it
    const tryBind = () => {
        const btn = document.getElementById('ccs-open-studio-btn');
        if (btn) {
            btn.addEventListener('click', openStudio);
        }
    };

    // Immediate attempt
    tryBind();

    // Also observe DOM changes in case ST renders the panel late
    const observer = new MutationObserver(() => {
        const btn = document.getElementById('ccs-open-studio-btn');
        if (btn && !btn.dataset.bound) {
            btn.dataset.bound = '1';
            btn.addEventListener('click', openStudio);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

// ── Slash command ─────────────────────────────────────────────────────────────

function registerSlashCommand() {
    try {
        const { SlashCommandParser, SlashCommand, SlashCommandClosure } = SillyTavern.modules ?? {};

        // ST 1.12+ slash command registration
        if (SlashCommandParser?.addCommandObject && SlashCommand) {
            SlashCommandParser.addCommandObject(
                SlashCommand.fromProps({
                    name: 'charforge',
                    aliases: ['ccs', 'cardstudio'],
                    helpString: 'Open the Character Card Studio',
                    unnamedArgumentList: [],
                    callback: () => { openStudio(); return ''; },
                })
            );
            return;
        }

        // Fallback: legacy registerSlashCommand if available
        const { registerSlashCommand } = SillyTavern.getContext?.() ?? {};
        if (typeof registerSlashCommand === 'function') {
            registerSlashCommand('charforge', openStudio, [], 'Open Character Card Studio', true, true);
            registerSlashCommand('ccs', openStudio, [], 'Open Character Card Studio', true, true);
        }
    } catch (err) {
        console.warn(`[${EXT_NAME}] Slash command registration failed:`, err);
    }
}

// ── ST event listeners ────────────────────────────────────────────────────────

function registerSTEvents() {
    try {
        const { eventSource, event_types } = SillyTavern.getContext();
        if (!eventSource || !event_types) return;

        // Re-inject toolbar if ST re-renders the chat area
        eventSource.on(event_types.APP_READY, () => {
            if (!document.getElementById('ccs-toolbar-btn')) injectToolbarButton();
        });

        // Update character name in studio header if character changes while studio is open
        eventSource.on(event_types.CHARACTER_EDITED, () => {
            if (studioPopup.isOpen) {
                const nameEl = document.getElementById('ccs-char-name');
                const fields = studioPopup.cardFields;
                if (nameEl && fields) nameEl.textContent = fields.name || 'Character';
            }
        });
    } catch (err) {
        console.warn(`[${EXT_NAME}] Event registration failed:`, err);
    }
}

// ── Open studio ───────────────────────────────────────────────────────────────

function openStudio() {
    // Check API support first
    const support = apiManager.checkApiSupport();
    if (!support.generateRaw) {
        showToast('⚠️ Character Card Studio requires SillyTavern 1.12+. Please update.', 'error');
        return;
    }
    if (!support.isConnected) {
        showToast('⚠️ No API connection detected. Connect an API in ST first.', 'warning');
        // Still open — user might connect after
    }
    studioPopup.open();
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `ccs-toast ccs-toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}
