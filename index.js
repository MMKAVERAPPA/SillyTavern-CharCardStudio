// index.js
// SillyTavern Extension entry point for Character Card Studio v2.5.0
// Registers the extension, injects UI entry points, handles settings panel

import { studioPopup } from './ui/popup.js';
import { memoryManager } from './core/memory.js';
import { apiManager } from './core/api.js';
import { toastManager } from './ui/toast.js';

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

        console.log(`[${EXT_NAME}] v2.5.0 loaded ✓`);
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

    if (!injected) {
        console.warn(`[${EXT_NAME}] Could not find toolbar target — floating button only`);
    }

    // v2.5: Always create floating button (CSS handles mobile/desktop visibility)
    // On mobile, toolbar button may exist but be invisible due to ST layout
    document.getElementById('ccs-float-btn')?.remove();
    const fallback = document.createElement('div');
    fallback.id = 'ccs-float-btn';
    fallback.className = 'ccs-float-btn';
    fallback.innerHTML = '🎭';
    fallback.title = 'Character Card Studio';
    fallback.style.touchAction = 'manipulation';
    // Hide on desktop if toolbar injection succeeded
    if (injected) fallback.style.display = 'none';
    fallback.addEventListener('click', openStudio);
    fallback.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.appendChild(fallback);
}

function createToolbarBtn() {
    const btn = document.createElement('div');
    btn.id = 'ccs-toolbar-btn';
    btn.className = 'ccs-toolbar-btn fa-solid fa-pen-nib';
    btn.title = 'Character Card Studio (✒️)';
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('role', 'button');
    btn.style.touchAction = 'manipulation'; // FIX: reliable mobile taps
    btn.addEventListener('click', (e) => { e.stopPropagation(); openStudio(); });
    btn.addEventListener('pointerdown', (e) => e.stopPropagation()); // prevent ST from swallowing the event
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
        toastManager.show('Character Card Studio requires SillyTavern 1.12+. Please update.', 'error');
        return;
    }
    if (!support.isConnected) {
        toastManager.show('No API connection detected. Connect an API in ST first.', 'warning');
        // Still open — user might connect after
    }
    studioPopup.open();
}
