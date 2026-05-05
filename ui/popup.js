// ui/popup.js
// Full-screen studio overlay
// FIX: removed duplicate messages on phase switch, fixed editMessage index,
//      fixed overlay close-on-tap for mobile, annotation cleanup on close

import { memoryManager } from '../core/memory.js';
import { cardManager } from '../core/card.js';
import { auditEngine } from '../core/audit.js';
import { chatEngine } from '../core/chat.js';
import { chatPanel } from './chat-panel.js';
import { cardPanel } from './card-panel.js';
import { lorebookPanel } from './lorebook-panel.js';
import { ideaPanel } from './idea-panel.js';
import { settingsModal } from './settings-modal.js';
import { statsManager } from '../core/stats.js';
import { ideationPhase } from '../phases/ideation.js';
import { generationPhase } from '../phases/generation.js';
import { lorebookPhase } from '../phases/lorebook-phase.js';
import { detectPhaseSwitch } from '../core/parser.js';
import { toastManager } from './toast.js';

const PHASE = { IDEATION: 'ideation', BUILDING: 'building', LOREBOOK: 'lorebook' };
const TAB   = { IDEA: 'idea', CARD: 'card', LOREBOOK: 'lorebook' };

export class StudioPopup {
    constructor() {
        this.isOpen = false;
        this.isMinimized = false;
        this.el = null;
        this._minBar = null;         // floating minimize bar
        this.currentPhase = PHASE.IDEATION;
        this.currentTab = TAB.CARD;
        this.session = null;
        this.cardFields = null;
        this.characterId = null;
        this._escHandler = null;
    }

    // ── Scoped selectors — work whether el is in DOM or not ──────────────────
    $(sel)  { return this.el?.querySelector(sel) ?? null; }
    $$(sel) { return this.el ? [...this.el.querySelectorAll(sel)] : []; }

    open() {
        if (this.isOpen) { this._focusInput(); return; }
        const { characterId } = SillyTavern.getContext();
        if (characterId === undefined || characterId < 0) { this._showNoCharError(); return; }

        this.characterId = characterId;
        this.cardFields = cardManager.readCurrentCard();
        if (!this.cardFields) { this._showNoCharError(); return; }
        this.session = memoryManager.loadSession(characterId);

        this._buildDOM();               // binds all events via this.$() before DOM insert
        document.body.appendChild(this.el);  // NOW in DOM
        this.isOpen = true;

        this._initPanels();             // safe to use document.getElementById now

        // ✅ FIX: Restore saved conversation history into chat panel DOM
        this._restoreSessionToUI();

        this._routeToPhase(this.session.currentPhase || PHASE.IDEATION);

        // Lock body scroll on mobile
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
    }

    close() {
        if (!this.isOpen) return;
        if (this.session) memoryManager.saveSession(this.characterId, this.session);

        // Clean up escape handler
        if (this._escHandler) {
            document.removeEventListener('keydown', this._escHandler);
            this._escHandler = null;
        }
        if (this._shortcutHandler) {
            document.removeEventListener('keydown', this._shortcutHandler);
            this._shortcutHandler = null;
        }

        // FIX: Clean up annotation listener to prevent memory leak
        chatPanel.destroy();

        this.el?.remove();
        this.el = null;
        this._minBar?.remove();
        this._minBar = null;
        this.isOpen = false;
        this.isMinimized = false;
        document.body.style.overflow = '';
        document.documentElement.style.overflow = '';
    }

    minimize() {
        if (!this.isOpen || this.isMinimized) return;
        this.isMinimized = true;
        if (this.el) this.el.style.display = 'none';

        // Create floating restore bar if it doesn't exist
        if (!this._minBar) {
            this._minBar = document.createElement('div');
            this._minBar.className = 'ccs-min-bar';
            this._minBar.innerHTML = `
                <span class="ccs-min-bar-icon">🎭</span>
                <span class="ccs-min-bar-label">Card Studio — ${this._esc(this.cardFields?.name || 'Character')}</span>
                <span class="ccs-min-bar-phase">${this.currentPhase}</span>
                <button class="ccs-min-bar-restore" title="Restore">▲ Restore</button>
                <button class="ccs-min-bar-close" title="Close Studio">✕</button>
            `;
            this._minBar.querySelector('.ccs-min-bar-restore').addEventListener('click', () => this.restore());
            this._minBar.querySelector('.ccs-min-bar-close').addEventListener('click', () => this.close());
            document.body.appendChild(this._minBar);
        }
        this._minBar.style.display = '';
    }

    restore() {
        if (!this.isOpen || !this.isMinimized) return;
        this.isMinimized = false;
        if (this.el) this.el.style.display = '';
        if (this._minBar) this._minBar.style.display = 'none';
        this._focusInput();
    }

    // ── DOM build — NO document.getElementById here ───────────────────────────

    _buildDOM() {
        this.el = document.createElement('div');
        this.el.id = 'ccs-studio';
        this.el.className = 'ccs-studio-overlay';
        this.el.innerHTML = `
            <div class="ccs-studio-inner">
                <div class="ccs-studio-header">
                    <div class="ccs-header-left">
                        <span class="ccs-logo">🎭</span>
                        <span class="ccs-title">Card Studio</span>
                        <span class="ccs-char-name" id="ccs-char-name">${this._esc(this.cardFields.name || 'New Character')}</span>
                        <span class="ccs-save-indicator" id="ccs-save-indicator">✓ Saved</span>
                        <span class="ccs-phase-badge" id="ccs-phase-badge">💡 Ideating</span>
                    </div>
                    <div class="ccs-header-right">
                        <button class="ccs-hdr-btn" id="ccs-resume-btn" style="display:none">📂 Resume</button>
                        <button class="ccs-hdr-btn" id="ccs-new-session-btn" title="Start fresh session">✦ New</button>
                        <button class="ccs-hdr-btn" id="ccs-ghost-btn" title="Toggle Ghost Mode (Alt+Shift+G)">👻</button>
                        <button class="ccs-hdr-btn" id="ccs-settings-btn" title="Settings">⚙</button>
                        <button class="ccs-hdr-btn" id="ccs-shortcuts-btn" title="Keyboard shortcuts">⌨</button>
                        <button class="ccs-hdr-btn" id="ccs-minimize-studio" title="Minimize">−</button>
                        <button class="ccs-hdr-btn ccs-close-btn" id="ccs-close-studio" title="Close Studio">✕</button>
                    </div>
                </div>

                <div class="ccs-studio-body">
                    <div class="ccs-chat-col">
                        <div class="ccs-chat-toolbar">
                            <input type="text" id="ccs-chat-search-input" placeholder="Search chat..." autocomplete="off">
                            <button class="ccs-chat-tbtn" id="ccs-chat-search-btn" title="Search Chat">🔍</button>
                            <button class="ccs-chat-tbtn" id="ccs-chat-inspect-btn" title="View Raw Prompt">🔬</button>
                        </div>
                        <div class="ccs-chat-messages" id="ccs-chat-messages"></div>
                        <div class="ccs-chat-input-area">
                            <div class="ccs-phase-tabs">
                                <button class="ccs-ptab active" data-phase="${PHASE.IDEATION}">💡 Ideate</button>
                                <button class="ccs-ptab" data-phase="${PHASE.BUILDING}">📝 Build</button>
                                <button class="ccs-ptab" data-phase="${PHASE.LOREBOOK}">📖 Lore</button>
                            </div>
                            <div class="ccs-input-row">
                                <textarea id="ccs-chat-input" class="ccs-chat-textarea" placeholder="Talk to the Lab Assistant..." rows="2"></textarea>
                                <div class="ccs-input-btns">
                                    <button class="ccs-send-btn" id="ccs-send-btn" title="Send (Enter)">▶</button>
                                    <button class="ccs-abort-btn" id="ccs-abort-btn" title="Stop generation">⏹</button>
                                </div>
                            </div>
                            <div class="ccs-snippet-bar" id="ccs-snippet-bar" style="display:none">
                                <span class="ccs-snip-label">📌</span>
                                <div id="ccs-snip-chips"></div>
                            </div>
                        </div>
                    </div>

                    <div class="ccs-workspace-col">
                        <div class="ccs-workspace-tabs">
                            <button class="ccs-wtab active" data-tab="${TAB.CARD}">📋 Card</button>
                            <button class="ccs-wtab" data-tab="${TAB.LOREBOOK}">📖 Lore</button>
                            <button class="ccs-wtab" data-tab="${TAB.IDEA}">💡 Concept</button>
                        </div>
                        <div class="ccs-workspace-panel">
                            <div id="ccs-card-panel-container"></div>
                            <div id="ccs-lorebook-panel-container" style="display:none"></div>
                            <div id="ccs-idea-panel-container" style="display:none"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // ✅ All bindings use this.$() — el is NOT in DOM yet here, but this.$() works
        this._bindHeaderEvents();
        this._bindWorkspaceTabs();
        this._bindPhaseTabs();
    }

    _esc(str) {
        return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ── _initPanels — called AFTER appendChild ─────────────────────────────────

    _initPanels() {
        chatPanel.init('ccs-chat-messages',
            (msg, editIdx) => this._handleUserMessage(msg, editIdx),
            () => { chatEngine.abort(); generationPhase.queue = []; }
        );
        chatPanel.bindInput('ccs-chat-input', 'ccs-send-btn', 'ccs-abort-btn');
        chatPanel.enableInlineAnnotation(this.session, (text, action) =>
            this._handleAnnotationRequest(text, action)
        );

        cardPanel.init('ccs-card-panel-container', this.cardFields, this.session, {
            onGenerateField:  (f) => { statsManager.record('fieldsGenerated'); generationPhase.generateField(f); },
            onVariations:     (f) => { statsManager.record('variations'); generationPhase.generateVariations(f); },
            onRewriteField:   (f, action) => { statsManager.record('variations'); generationPhase.rewriteField(f, action); },
            onGenerateAll:    () => generationPhase.generateAllFields(),
            onAudit:          () => this._runAudit(),
            onExport:         () => this._exportSessionLog(),
            onReviewExisting: () => this._reviewExistingCard(),
            onInferTags:      () => this._inferTags(),
            onRestoreVersion: (f, idx) => this._restoreVersion(f, idx),
            onAddTag:         (tag) => this._addTag(tag),
            onQuickEdit:      (f, val) => { statsManager.record('quickEdits'); this._handleQuickEdit(f, val); },
        });

        lorebookPanel.init('ccs-lorebook-panel-container', {
            onInsertEntry:  (entry) => lorebookPhase._insertEntries([entry]),
            onDiscardEntry: (tempId) => {
                const idx = lorebookPhase.pendingEntries.findIndex(p => p._tempId === tempId);
                if (idx !== -1) lorebookPhase.pendingEntries.splice(idx, 1);
            },
        });

        ideaPanel.init('ccs-idea-panel-container');
        this._renderSnippetBar();

        // Resume banner — session already loaded, check if it has history
        const hasHistory = (this.session.conversationHistory?.length || 0) > 0;
        const resumeBtn = document.getElementById('ccs-resume-btn');
        if (resumeBtn) resumeBtn.style.display = hasHistory ? '' : 'none';
    }

    // ── Restore saved session to UI on re-open ────────────────────────────────
    _restoreSessionToUI() {
        const history = this.session.conversationHistory;
        if (!history?.length) {
            // No history — show welcome screen
            chatPanel.renderWelcomeScreen({
                pitch: () => {
                    chatPanel.addSystemMessage('💡 Tell me about the character you want to create!', 'info');
                    this._focusInput();
                },
                surprise: () => {
                    this._handleUserMessage('Give me 3 original character concepts to choose from');
                },
                improve: () => {
                    this._handleUserMessage('Review this card and suggest improvements');
                },
            });
            return;
        }

        // Replay messages into chat panel
        chatPanel.restoreHistory(history);

        // Restore idea panel
        if (this.session.ideaMemory?.conceptName) {
            ideaPanel.render(this.session.ideaMemory);
        }

        // Restore card panel status dots
        cardPanel.updateCardFields(this.cardFields);

        // Restore lorebook panel if entries exist
        if (this.session.lorebookLog.acceptedEntries?.length) {
            lorebookPanel.render(
                this.session.lorebookLog.acceptedEntries,
                this.session.lorebookLog.pendingEntries || []
            );
        }

        // Show resume banner with session info
        const conceptName = this.session.ideaMemory?.conceptName;
        const msgCount = history.length;
        const phase = this.session.currentPhase || 'ideation';
        chatPanel.addSystemMessage(
            `📂 Session restored — **${conceptName || 'In-progress character'}** · ${msgCount} messages · Phase: ${phase}`,
            'info'
        );
    }

    _handleQuickEdit(fieldName, value) {
        if (!fieldName || !this.cardFields) return;
        // Write directly to the card
        if (fieldName === 'alternate_greetings') {
            this.cardFields[fieldName] = value.split('\n---\n');
        } else {
            this.cardFields[fieldName] = value;
        }
        cardManager.writeField(fieldName, this.cardFields[fieldName]);
        // Create a version in history
        if (this.session) {
            memoryManager.addFieldVersion(this.session, fieldName, this.cardFields[fieldName], 'Manual edit');
        }
        cardPanel.setFieldStatus(fieldName, 'accepted');
        cardPanel.updateCardFields(this.cardFields);
        this._flashSaveIndicator();
    }

    // ── Phase routing ──────────────────────────────────────────────────────────

    _routeToPhase(phase) {
        this.currentPhase = phase;
        this.session.currentPhase = phase;
        this._updatePhaseBadge(phase);
        this._updatePhaseTabs(phase);

        switch (phase) {
            case PHASE.IDEATION:
                ideationPhase.start(this.session, this.cardFields, () => this._routeToPhase(PHASE.BUILDING));
                break;
            case PHASE.BUILDING:
                generationPhase.start(this.session, this.cardFields, {
                    onCardUpdated: () => {
                        this.cardFields = cardManager.readCurrentCard() || this.cardFields;
                        cardPanel.updateCardFields(this.cardFields);
                    },
                });
                break;
            case PHASE.LOREBOOK:
                lorebookPhase.start(this.session, this.cardFields, {
                    onUpdated: () => {
                        lorebookPanel.render(
                            this.session.lorebookLog.acceptedEntries,
                            lorebookPhase.pendingEntries
                        );
                        this._switchWorkspaceTab(TAB.LOREBOOK);
                    },
                });
                this._switchWorkspaceTab(TAB.LOREBOOK);
                break;
        }
    }

    async _handleUserMessage(message, editIdx) {
        // FIX: editMessage — pass actual message content, don't assume *2 index
        if (editIdx !== undefined) {
            // Find the actual index in session history for this edit
            const history = this.session.conversationHistory || [];
            let userMsgCount = 0;
            for (let i = 0; i < history.length; i++) {
                if (history[i].role === 'user') {
                    if (userMsgCount === editIdx) {
                        // Truncate history to this point + rewrite the message
                        this.session.conversationHistory = history.slice(0, i);
                        break;
                    }
                    userMsgCount++;
                }
            }
        }

        // FIX: Check for phase switch FIRST — don't add duplicate user message
        // (chatPanel._handleSend already added the user message to the DOM)
        const switchTo = detectPhaseSwitch(message);
        if (switchTo === 'lorebook') {
            // User message already rendered by _handleSend, just route
            this._routeToPhase(PHASE.LOREBOOK);
            return;
        }
        if (switchTo === 'building') {
            this._routeToPhase(PHASE.BUILDING);
            return;
        }
        if (switchTo === 'build_start' && this.currentPhase === PHASE.IDEATION) {
            await ideationPhase.handleMessage(message);
            return;
        }

        switch (this.currentPhase) {
            case PHASE.IDEATION: await ideationPhase.handleMessage(message); break;
            case PHASE.BUILDING: await generationPhase.handleMessage(message); break;
            case PHASE.LOREBOOK: await lorebookPhase.handleMessage(message); break;
        }
        memoryManager.saveSession(this.characterId, this.session);
    }

    // ── Header events — this.$() works before DOM insertion ───────────────────

    _bindHeaderEvents() {
        this.$('#ccs-close-studio')?.addEventListener('click', () => this.close());

        this.$('#ccs-settings-btn')?.addEventListener('click', () => settingsModal.open());

        this.$('#ccs-new-session-btn')?.addEventListener('click', () => {
            if (!confirm('Start a new session? Current session will be saved.')) return;
            memoryManager.clearSession(this.characterId);
            this.session = memoryManager.createNewSession(this.characterId);
            statsManager.record('sessions');
            chatPanel.clear();
            cardPanel.init('ccs-card-panel-container', this.cardFields, this.session, cardPanel.callbacks);
            this._routeToPhase(PHASE.IDEATION);
        });

        this.$('#ccs-resume-btn')?.addEventListener('click', () => {
            // Resume btn just scrolls to bottom and re-renders idea panel
            const idea = this.session.ideaMemory;
            ideaPanel.render(idea);
            const chatContainer = document.getElementById('ccs-chat-messages');
            if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
        });

        // Minimize button
        this.$('#ccs-minimize-studio')?.addEventListener('click', () => this.minimize());

        // Shortcuts help toggle
        this.$('#ccs-shortcuts-btn')?.addEventListener('click', () => this._toggleShortcutHelp());

        // Ghost Mode toggle
        this.$('#ccs-ghost-btn')?.addEventListener('click', () => this._toggleGhostMode());

        // Chat Toolbar events
        const searchInput = this.$('#ccs-chat-search-input');
        const searchBtn = this.$('#ccs-chat-search-btn');
        searchBtn?.addEventListener('click', () => {
            if (!searchInput) return;
            searchInput.style.display = searchInput.style.display === 'block' ? 'none' : 'block';
            if (searchInput.style.display === 'block') searchInput.focus();
        });
        
        searchInput?.addEventListener('input', (e) => this._handleChatSearch(e.target.value));
        
        this.$('#ccs-chat-inspect-btn')?.addEventListener('click', () => this._openRawContextInspector());

        // Escape minimizes (not closes) to preserve session
        this._escHandler = (e) => {
            if (e.key === 'Escape' && this.isOpen && !this.isMinimized) {
                // Close shortcut help if open
                const help = this.el?.querySelector('.ccs-shortcut-help');
                if (help) { help.remove(); return; }
                this.minimize();
            }
        };
        document.addEventListener('keydown', this._escHandler);

        // Keyboard shortcuts
        this._shortcutHandler = (e) => {
            if (!this.isOpen || this.isMinimized) return;
            const ctrl = e.ctrlKey || e.metaKey;
            if (ctrl && e.key === '1') { e.preventDefault(); this._routeToPhase(PHASE.IDEATION); }
            else if (ctrl && e.key === '2') { e.preventDefault(); this._routeToPhase(PHASE.BUILDING); }
            else if (ctrl && e.key === '3') { e.preventDefault(); this._routeToPhase(PHASE.LOREBOOK); }
            else if (ctrl && e.key === 'g') { e.preventDefault(); generationPhase.generateAllFields(); }
            else if (ctrl && e.key === 'f') { 
                e.preventDefault(); 
                const searchInput = this.$('#ccs-chat-search-input');
                if (searchInput) {
                    searchInput.style.display = searchInput.style.display === 'block' ? 'none' : 'block';
                    if (searchInput.style.display === 'block') searchInput.focus();
                }
            }
        };
        
        // Ghost Mode global hotkey Alt+Shift+G
        this._ghostModeHandler = (e) => {
            if (e.altKey && e.shiftKey && e.key === 'G') {
                e.preventDefault();
                this._toggleGhostMode();
            }
        };
        document.addEventListener('keydown', this._ghostModeHandler);
        document.addEventListener('keydown', this._shortcutHandler);

        // FIX: Overlay close-on-tap — only trigger when BOTH pointerdown and click
        // land on the overlay itself (not on .ccs-studio-inner or its children).
        // This prevents accidental close on mobile when tapping inside the studio.
        let _pointerDownTarget = null;
        this.el.addEventListener('pointerdown', (e) => { _pointerDownTarget = e.target; });
        this.el.addEventListener('click', (e) => {
            // Only close if both the pointerdown AND click were on the overlay backdrop itself
            if (e.target === this.el && _pointerDownTarget === this.el) {
                this.close();
            }
        });

        // FIX: Prevent touches inside .ccs-studio-inner from reaching the overlay
        const inner = this.$('.ccs-studio-inner');
        if (inner) {
            inner.addEventListener('pointerdown', (e) => e.stopPropagation());
            inner.addEventListener('click', (e) => e.stopPropagation());
        }
    }

    _toggleGhostMode() {
        if (!this.el) return;
        this.el.classList.toggle('ccs-ghost-mode');
        const btn = this.$('#ccs-ghost-btn');
        if (btn) btn.style.background = this.el.classList.contains('ccs-ghost-mode') ? 'var(--ccs-accent)' : '';
    }

    _handleChatSearch(query) {
        const term = query.toLowerCase().trim();
        const messages = this.el?.querySelectorAll('.ccs-msg');
        if (!messages) return;
        messages.forEach(msg => {
            if (!term) {
                msg.style.display = '';
                return;
            }
            const text = msg.querySelector('.ccs-msg-bubble')?.textContent?.toLowerCase() || '';
            msg.style.display = text.includes(term) ? '' : 'none';
        });
    }

    _openRawContextInspector() {
        if (!this.session.lastPayload) {
            toastManager.show('No raw context available yet. Generate a message first.', 'warn');
            return;
        }
        
        const payload = this.session.lastPayload;
        let content = '';
        if (payload.system) {
            content += `<div class="ccs-inspector-section" style="margin-bottom:8px;"><strong>System Prompt:</strong><pre style="background:var(--ccs-surface3); padding:8px; border-radius:4px; font-size:0.75rem; white-space:pre-wrap; word-wrap:break-word;">${this._esc(payload.system)}</pre></div>`;
        }
        if (payload.messages) {
            content += `<div class="ccs-inspector-section" style="margin-bottom:8px;"><strong>Messages:</strong><pre style="background:var(--ccs-surface3); padding:8px; border-radius:4px; font-size:0.75rem; white-space:pre-wrap; word-wrap:break-word;">${this._esc(JSON.stringify(payload.messages, null, 2))}</pre></div>`;
        }
        if (payload.generationOptions) {
            content += `<div class="ccs-inspector-section"><strong>Options:</strong><pre style="background:var(--ccs-surface3); padding:8px; border-radius:4px; font-size:0.75rem; white-space:pre-wrap; word-wrap:break-word;">${this._esc(JSON.stringify(payload.generationOptions, null, 2))}</pre></div>`;
        }

        const modal = document.createElement('div');
        modal.className = 'ccs-shortcut-help'; // reuse the modal styling
        modal.innerHTML = `
            <div class="ccs-shortcut-header">
                <div class="ccs-shortcut-title">🔬 Raw Context Inspector</div>
                <button class="ccs-shortcut-close">✕</button>
            </div>
            <div class="ccs-shortcut-body" style="text-align:left; max-height: 60vh; overflow-y: auto;">
                ${content}
            </div>
        `;
        
        modal.querySelector('.ccs-shortcut-close').addEventListener('click', () => modal.remove());
        this.el.appendChild(modal);
    }

    _toggleShortcutHelp() {
        const existing = this.el?.querySelector('.ccs-shortcut-help');
        if (existing) { existing.remove(); return; }
        const help = document.createElement('div');
        help.className = 'ccs-shortcut-help';
        help.innerHTML = `
            <div class="ccs-shortcut-list">
                <div class="ccs-shortcut-item"><span>Switch to Ideate</span><span class="ccs-shortcut-key">Ctrl+1</span></div>
                <div class="ccs-shortcut-item"><span>Switch to Build</span><span class="ccs-shortcut-key">Ctrl+2</span></div>
                <div class="ccs-shortcut-item"><span>Switch to Lore</span><span class="ccs-shortcut-key">Ctrl+3</span></div>
                <div class="ccs-shortcut-item"><span>Generate All</span><span class="ccs-shortcut-key">Ctrl+G</span></div>
                <div class="ccs-shortcut-item"><span>Send Message</span><span class="ccs-shortcut-key">Enter</span></div>
                <div class="ccs-shortcut-item"><span>Minimize Studio</span><span class="ccs-shortcut-key">Esc</span></div>
            </div>
        `;
        this.$('.ccs-studio-inner')?.appendChild(help);
    }

    _flashSaveIndicator() {
        const el = document.getElementById('ccs-save-indicator');
        if (!el) return;
        el.classList.add('visible');
        setTimeout(() => el.classList.remove('visible'), 2000);
    }

    // ── Workspace tabs — this.$$ ───────────────────────────────────────────────

    _bindWorkspaceTabs() {
        this.$$('.ccs-wtab').forEach(tab => {
            tab.addEventListener('click', () => this._switchWorkspaceTab(tab.dataset.tab));
        });
    }

    _switchWorkspaceTab(tabName) {
        this.currentTab = tabName;
        this.$$('.ccs-wtab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
        this.$('#ccs-card-panel-container')?.style && (this.$('#ccs-card-panel-container').style.display     = tabName === TAB.CARD     ? '' : 'none');
        this.$('#ccs-lorebook-panel-container')?.style && (this.$('#ccs-lorebook-panel-container').style.display = tabName === TAB.LOREBOOK ? '' : 'none');
        this.$('#ccs-idea-panel-container')?.style && (this.$('#ccs-idea-panel-container').style.display     = tabName === TAB.IDEA     ? '' : 'none');

        if (tabName === TAB.LOREBOOK) lorebookPanel.render(this.session.lorebookLog.acceptedEntries, lorebookPhase.pendingEntries);
        if (tabName === TAB.IDEA) ideaPanel.render(this.session.ideaMemory);
    }

    // ── Phase tabs — this.$$ ──────────────────────────────────────────────────

    _bindPhaseTabs() {
        this.$$('.ccs-ptab').forEach(tab => {
            tab.addEventListener('click', () => {
                const phase = tab.dataset.phase;
                if (phase === this.currentPhase) return;
                if (phase === PHASE.BUILDING
                    && this.currentPhase === PHASE.IDEATION
                    && !this.session.ideaMemory.proposedProfileApproved) {
                    if (!confirm('Move to building phase without approving the concept profile?')) return;
                }
                chatPanel.addSystemMessage(`Switching to ${phase} mode...`, 'info');
                this._routeToPhase(phase);
            });
        });
    }

    _updatePhaseTabs(phase) {
        this.$$('.ccs-ptab').forEach(t => t.classList.toggle('active', t.dataset.phase === phase));
    }

    _updatePhaseBadge(phase) {
        const badge = this.$('#ccs-phase-badge');
        if (!badge) return;
        const labels = { ideation:'💡 Ideating', building:'📝 Building', lorebook:'📖 Lorebook' };
        badge.textContent = labels[phase] || phase;
        badge.className = `ccs-phase-badge ccs-phase-${phase}`;
    }

    // ── Snippets ───────────────────────────────────────────────────────────────

    _renderSnippetBar() {
        const snippets = memoryManager.getSnippets();
        const bar = this.$('#ccs-snippet-bar');
        const chipsEl = this.$('#ccs-snip-chips');
        if (!bar || !chipsEl) return;
        if (!snippets.length) { bar.style.display = 'none'; return; }
        bar.style.display = '';
        chipsEl.innerHTML = snippets.map(s =>
            `<button class="ccs-snip-chip" data-id="${s.id}" title="${this._esc(s.category)}: ${this._esc(s.content.substring(0,60))}">${this._esc(s.name)}</button>`
        ).join('');
        chipsEl.querySelectorAll('.ccs-snip-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                const snip = memoryManager.getSnippets().find(s => s.id === btn.dataset.id);
                if (!snip) return;
                const input = this.$('#ccs-chat-input');
                if (input) { input.value += (input.value ? '\n' : '') + snip.content; input.focus(); }
            });
        });
    }

    // ── Feature actions ────────────────────────────────────────────────────────

    async _runAudit() {
        chatPanel.addSystemMessage('🔍 Running coherence audit...', 'info');
        try {
            const result = await auditEngine.runCoherenceAudit(this.session, this.cardFields);
            chatPanel.addMessage('assistant', result.raw || 'Audit complete — no issues found.');
        } catch (err) {
            chatPanel.addSystemMessage('❌ Audit failed: ' + err.message, 'error');
        }
    }

    async _reviewExistingCard() {
        chatPanel.addSystemMessage('⭐ Reviewing card...', 'info');
        try {
            const result = await auditEngine.reviewExistingCard(this.cardFields);
            chatPanel.addMessage('assistant', result.raw);
        } catch (err) {
            chatPanel.addSystemMessage('❌ Review failed: ' + err.message, 'error');
        }
    }

    async _inferTags() {
        try {
            const settings = memoryManager.getGlobalSettings();
            chatPanel.addSystemMessage('✨ Inferring tags...', 'info');
            const tags = await auditEngine.inferTags(this.cardFields, settings.platformTarget);
            if (!tags.length) { chatPanel.addSystemMessage('No tag suggestions generated.', 'info'); return; }
            cardPanel.showTagSuggestions(tags, (accepted) => this._addTags(accepted));
        } catch (err) {
            chatPanel.addSystemMessage('❌ Tag inference failed: ' + err.message, 'error');
        }
    }

    async _addTag(tag) {
        const current = [...(this.cardFields.tags || [])];
        if (!current.includes(tag)) {
            current.push(tag);
            await cardManager.writeField('tags', current);
            this.cardFields.tags = current;
            cardPanel.refreshTags(current, (t) => this._removeTag(t));
        }
    }

    async _addTags(tags) { for (const t of tags) await this._addTag(t); }

    async _removeTag(tag) {
        const current = (this.cardFields.tags || []).filter(t => t !== tag);
        await cardManager.writeField('tags', current);
        this.cardFields.tags = current;
        cardPanel.refreshTags(current, (t) => this._removeTag(t));
    }

    async _restoreVersion(fieldName, idx) {
        const content = memoryManager.getFieldVersion(this.session, fieldName, idx);
        if (!content) return;
        if (!confirm(`Restore ${fieldName} to v${idx + 1}?`)) return;
        await cardManager.writeField(fieldName, content);
        this.cardFields[fieldName] = content;
        cardPanel.setFieldStatus(fieldName, 'accepted');
        cardPanel.updateCardFields(this.cardFields);
        chatPanel.addSystemMessage(`↩ Restored ${fieldName} to v${idx + 1}`, 'info');
    }

    async _handleAnnotationRequest(selectedText, action) {
        const messages = {
            expand:   `Expand on this: "${selectedText}" — add more detail while matching the existing tone.`,
            specific: `Make this more specific: "${selectedText}" — replace vague language with concrete detail.`,
            explain:  `Why was this choice made? "${selectedText}" — explain the creative reasoning.`,
        };
        const msg = messages[action] || `${action}: "${selectedText}"`;
        chatPanel.addMessage('user', msg);
        await this._handleUserMessage(msg);
    }

    _exportSessionLog() {
        const session = this.session;
        const card = this.cardFields;
        const lines = [
            `# Character Card Studio — Session Log`,
            `**Character:** ${card.name || 'Unnamed'}`,
            `**Date:** ${new Date().toLocaleDateString()}`,
            `**Concept:** ${session.ideaMemory?.conceptName || 'N/A'}`,
            '',
            '## Resolved Pillars',
            ...(session.ideaMemory?.pillars || []).filter(p => p.resolved).map(p => `- **${p.name}:** ${p.answer}`),
            '',
            '## Key Decisions',
            ...(session.ideaMemory?.keyDecisions || []).map(d => `- ${d.decision}`),
            '',
            '## Accepted Fields',
        ];
        for (const [f, log] of Object.entries(session.fieldLog || {})) {
            if (log.acceptedAt && log.versions.length > 0) {
                const v = log.versions[log.versions.length - 1];
                lines.push(`\n### ${f}\n\`\`\`\n${v.content || ''}\n\`\`\``);
            }
        }
        lines.push('', '## Lorebook Index');
        for (const e of session.lorebookLog?.acceptedEntries || []) {
            lines.push(`- [${e.category || 'General'}] **${e.comment}** — Keys: ${(e.keys || []).join(', ')}`);
        }
        const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(card.name || 'character').replace(/\s+/g,'_')}_studio_log.md`;
        a.click();
        URL.revokeObjectURL(url);
    }

    _showNoCharError() {
        toastManager.show('Select a character in SillyTavern first, then open the Studio.', 'error');
    }

    _focusInput() { this.$('#ccs-chat-input')?.focus(); }
}

export const studioPopup = new StudioPopup();
