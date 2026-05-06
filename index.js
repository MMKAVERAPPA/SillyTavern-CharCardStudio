// index.js
// SillyTavern Extension entry point for Character Card Studio v3.0.0
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

        // Inject all UI entry points
        injectAllButtons();

        // Bind the settings.html "Open Studio" button
        bindSettingsPanelButton();

        // Register slash command
        registerSlashCommand();

        // Register event listeners
        registerSTEvents();

        console.log(`[${EXT_NAME}] v3.0.0 loaded ✓`);
    } catch (err) {
        console.error(`[${EXT_NAME}] Init failed:`, err);
    }
})();

// ── Button injection — all three entry points ──────────────────────────────────

function injectAllButtons() {
    injectToolbarButton();
    injectExtensionsMenuEntry();
    injectFloatingButton();
}

// 1. Toolbar button (pen-nib in the send form — desktop primary)
function injectToolbarButton() {
    if (document.getElementById('ccs-toolbar-btn')) return;

    const injectTargets = [
        '#send_form',
        '#rightSendForm',
        '.form_create',
        '#chat_input_area',
    ];

    for (const selector of injectTargets) {
        const target = document.querySelector(selector);
        if (target) {
            const btn = document.createElement('div');
            btn.id = 'ccs-toolbar-btn';
            btn.className = 'ccs-toolbar-btn fa-solid fa-pen-nib';
            btn.title = 'Character Card Studio';
            btn.setAttribute('tabindex', '0');
            btn.setAttribute('role', 'button');
            btn.style.touchAction = 'manipulation';
            // Use only 'click' — touchend causes double-fire race conditions on mobile
            btn.addEventListener('click', (e) => { e.stopPropagation(); openStudio(); });
            btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') openStudio(); });
            target.appendChild(btn);
            console.log(`[${EXT_NAME}] Toolbar button injected into ${selector}`);
            return;
        }
    }
    console.warn(`[${EXT_NAME}] Could not find toolbar target`);
}

// 2. Extensions menu entry (ST hamburger menu — the ONLY reliable mobile entry point)
// Pattern from SillyTavern-Tracker: append a .list-group-item to #extensionsMenu
function injectExtensionsMenuEntry() {
    if (document.getElementById('ccs-ext-menu-item')) return;

    const menu = document.getElementById('extensionsMenu');
    if (!menu) {
        // ST hasn't rendered the menu yet — observe and retry
        const observer = new MutationObserver(() => {
            if (document.getElementById('extensionsMenu')) {
                observer.disconnect();
                injectExtensionsMenuEntry();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        return;
    }

    const container = document.createElement('div');
    container.className = 'extension_container interactable';
    container.id = 'ccs-ext-menu-container';
    container.setAttribute('tabindex', '0');

    const item = document.createElement('div');
    item.id = 'ccs-ext-menu-item';
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.title = 'Open Character Card Studio';
    item.setAttribute('tabindex', '0');

    const icon = document.createElement('div');
    icon.className = 'extensionsMenuExtensionButton fa-solid fa-pen-nib';

    const label = document.createElement('span');
    label.textContent = 'Card Studio';

    item.appendChild(icon);
    item.appendChild(label);
    container.appendChild(item);
    menu.appendChild(container);

    // Use only 'click' — works on both mobile tap and desktop click
    item.addEventListener('click', () => openStudio());
    console.log(`[${EXT_NAME}] Extensions menu entry injected`);
}

// 3. Floating action button (visible on mobile only via CSS, fallback if menu injection fails)
function injectFloatingButton() {
    if (document.getElementById('ccs-float-btn')) return;

    const btn = document.createElement('div');
    btn.id = 'ccs-float-btn';
    // CSS class handles position/visibility — do NOT set display:none inline
    // (inline styles override media queries and would hide it on mobile too)
    btn.className = 'ccs-float-btn';
    btn.innerHTML = '🎭';
    btn.title = 'Character Card Studio';
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.style.touchAction = 'manipulation';
    // Use only 'click' — no touchend
    btn.addEventListener('click', (e) => { e.stopPropagation(); openStudio(); });
    document.body.appendChild(btn);
}

// ── Settings panel button (CSP-safe) ─────────────────────────────────────────

function bindSettingsPanelButton() {
    // ST renders settings.html into the extensions panel — we need to wait for it
    const observer = new MutationObserver(() => {
        const btn = document.getElementById('ccs-open-studio-btn');
        if (btn && !btn.dataset.bound) {
            btn.dataset.bound = '1';
            btn.addEventListener('click', openStudio);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Also try immediately
    const btn = document.getElementById('ccs-open-studio-btn');
    if (btn && !btn.dataset.bound) {
        btn.dataset.bound = '1';
        btn.addEventListener('click', openStudio);
    }
}

// ── Slash command ─────────────────────────────────────────────────────────────

function registerSlashCommand() {
    try {
        const { SlashCommandParser, SlashCommand } = SillyTavern.modules ?? {};

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

        // Re-inject all buttons if ST re-renders the chat area
        eventSource.on(event_types.APP_READY, () => {
            injectToolbarButton();
            injectExtensionsMenuEntry();
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
    try {
        const support = apiManager.checkApiSupport();
        if (!support.generateRaw) {
            // Show warning but still open — ST may not be fully loaded yet on mobile
            toastManager.show('⚠️ SillyTavern 1.12+ required for generation. Studio opened in read-only mode.', 'warning');
        } else if (!support.isConnected) {
            toastManager.show('⚠️ No API connected. Connect one in ST to generate.', 'warning');
        }
    } catch (err) {
        console.warn(`[${EXT_NAME}] API check failed:`, err);
    }
    // Always open — let the user decide
    studioPopup.open();
}
