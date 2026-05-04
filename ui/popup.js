// ui/popup.js
// Full-screen studio overlay — tabs, phase routing, session routing, export

import { memoryManager } from '../core/memory.js';
import { cardManager } from '../core/card.js';
import { auditEngine } from '../core/audit.js';
import { chatEngine } from '../core/chat.js';
import { chatPanel } from './chat-panel.js';
import { cardPanel } from './card-panel.js';
import { lorebookPanel } from './lorebook-panel.js';
import { ideaPanel } from './idea-panel.js';
import { settingsModal } from './settings-modal.js';
import { ideationPhase } from '../phases/ideation.js';
import { generationPhase } from '../phases/generation.js';
import { lorebookPhase } from '../phases/lorebook-phase.js';
import { detectPhaseSwitch } from '../core/parser.js';

const PHASE = { IDEATION: 'ideation', BUILDING: 'building', LOREBOOK: 'lorebook', REVIEW: 'review' };
const TAB   = { IDEA: 'idea', CARD: 'card', LOREBOOK: 'lorebook' };

export class StudioPopup {
    constructor() {
        this.isOpen = false;
        this.el = null;
        this.currentPhase = PHASE.IDEATION;
        this.currentTab = TAB.CARD;
        this.session = null;
        this.cardFields = null;
        this.characterId = null;
    }

    open() {
        if (this.isOpen) { this._focusInput(); return; }

        const { characterId } = SillyTavern.getContext();
        if (characterId === undefined || characterId < 0) {
            this._showNoCharError(); return;
        }

        this.characterId = characterId;
        this.cardFields = cardManager.readCurrentCard();
        if (!this.cardFields) { this._showNoCharError(); return; }

        this.session = memoryManager.loadSession(characterId);

        this._buildDOM();
        document.body.appendChild(this.el);
        this.isOpen = true;

        this._initPanels();
        this._routeToPhase(this.session.currentPhase || PHASE.IDEATION);
    }

    close() {
        if (!this.isOpen) return;
        if (this.session) memoryManager.saveSession(this.characterId, this.session);
        this.el?.remove();
        this.el = null;
        this.isOpen = false;
    }

    // ── DOM ───────────────────────────────────────────────────────────────────

    _buildDOM() {
        this.el = document.createElement('div');
        this.el.id = 'ccs-studio';
        this.el.className = 'ccs-studio-overlay';
        this.el.innerHTML = `
            <div class="ccs-studio-inner">

                <!-- Header bar -->
                <div class="ccs-studio-header">
                    <div class="ccs-header-left">
                        <span class="ccs-logo">🎭</span>
                        <span class="ccs-title">Character Card Studio</span>
                        <span class="ccs-char-name" id="ccs-char-name">${this.cardFields.name || 'New Character'}</span>
                        <span class="ccs-phase-badge" id="ccs-phase-badge">Ideation</span>
                    </div>
                    <div class="ccs-header-right">
                        <button class="ccs-hdr-btn" id="ccs-resume-btn" title="Resume Previous Session" style="display:none">📂 Resume</button>
                        <button class="ccs-hdr-btn" id="ccs-new-session-btn" title="Start Fresh">🆕 New Session</button>
                        <button class="ccs-hdr-btn" id="ccs-settings-btn" title="Settings">⚙️</button>
                        <button class="ccs-hdr-btn ccs-close-btn" id="ccs-close-studio" title="Close Studio">✕</button>
                    </div>
                </div>

                <!-- Main area: chat left, workspace right -->
                <div class="ccs-studio-body">

                    <!-- Left: chat -->
                    <div class="ccs-chat-col" id="ccs-chat-col">
                        <div class="ccs-chat-messages" id="ccs-chat-messages"></div>
                        <div class="ccs-chat-input-area">
                            <div class="ccs-phase-tabs" id="ccs-phase-tabs">
                                <button class="ccs-ptab active" data-phase="${PHASE.IDEATION}">💡 Ideate</button>
                                <button class="ccs-ptab" data-phase="${PHASE.BUILDING}">📝 Build</button>
                                <button class="ccs-ptab" data-phase="${PHASE.LOREBOOK}">📖 Lorebook</button>
                            </div>
                            <div class="ccs-input-row">
                                <textarea id="ccs-chat-input" class="ccs-chat-textarea" placeholder="Talk to the Lab Assistant..." rows="2"></textarea>
                                <div class="ccs-input-btns">
                                    <button class="ccs-send-btn" id="ccs-send-btn" title="Send">▶</button>
                                    <button class="ccs-abort-btn" id="ccs-abort-btn" title="Stop">⏹</button>
                                </div>
                            </div>
                            <div class="ccs-snippet-bar" id="ccs-snippet-bar">
                                <span class="ccs-snip-label">Snippets:</span>
                                <div id="ccs-snip-chips"></div>
                            </div>
                        </div>
                    </div>

                    <!-- Right: workspace tabs -->
                    <div class="ccs-workspace-col" id="ccs-workspace-col">
                        <div class="ccs-workspace-tabs">
                            <button class="ccs-wtab active" id="ccs-tab-card" data-tab="${TAB.CARD}">📋 Card</button>
                            <button class="ccs-wtab" id="ccs-tab-lorebook" data-tab="${TAB.LOREBOOK}">📖 Lorebook</button>
                            <button class="ccs-wtab" id="ccs-tab-idea" data-tab="${TAB.IDEA}">💡 Concept</button>
                        </div>
                        <div class="ccs-workspace-panel" id="ccs-workspace-panel">
                            <div id="ccs-card-panel-container"></div>
                            <div id="ccs-lorebook-panel-container" style="display:none;"></div>
                            <div id="ccs-idea-panel-container" style="display:none;"></div>
                        </div>
                    </div>
                </div>

            </div>
        `;

        this._bindHeaderEvents();
        this._bindWorkspaceTabs();
        this._bindPhaseTabs();
    }

    _initPanels() {
        chatPanel.init('ccs-chat-messages', (msg, editIdx) => this._handleUserMessage(msg, editIdx), () => {
            chatEngine.abort();
            generationPhase.queue = [];
        });
        chatPanel.bindInput('ccs-chat-input', 'ccs-send-btn', 'ccs-abort-btn');
        chatPanel.enableInlineAnnotation(this.session, (selectedText, action) => {
            this._handleAnnotationRequest(selectedText, action);
        });

        cardPanel.init('ccs-card-panel-container', this.cardFields, this.session, {
            onGenerateField:  (f) => generationPhase.generateField(f),
            onVariations:     (f) => generationPhase.generateVariations(f),
            onRewriteField:   (f, action) => generationPhase.rewriteField(f, action),
            onGenerateAll:    () => generationPhase.generateAllFields(),
            onAudit:          () => this._runAudit(),
            onExport:         () => this._exportSessionLog(),
            onReviewExisting: () => this._reviewExistingCard(),
            onInferTags:      () => this._inferTags(),
            onRestoreVersion: (f, idx) => this._restoreVersion(f, idx),
            onAddTag:         (tag) => this._addTag(tag),
        });

        lorebookPanel.init('ccs-lorebook-panel-container', {
            onInsertEntry: (entry) => {
                lorebookPhase._insertEntries([entry]);
            },
            onDiscardEntry: (tempId) => {
                const idx = lorebookPhase.pendingEntries.findIndex(p => p._tempId === tempId);
                if (idx !== -1) lorebookPhase.pendingEntries.splice(idx, 1);
            },
        });

        ideaPanel.init('ccs-idea-panel-container');

        this._renderSnippetBar();

        // Resume banner
        if (memoryManager.hasIncompleteSession(this.characterId)) {
            const info = memoryManager.getSessionInfo(this.characterId);
            if (info?.messageCount > 0) {
                const resumeBtn = document.getElementById('ccs-resume-btn');
                if (resumeBtn) resumeBtn.style.display = '';
            }
        }
    }

    // ── Phase routing ─────────────────────────────────────────────────────────

    _routeToPhase(phase) {
        this.currentPhase = phase;
        this.session.currentPhase = phase;

        this._updatePhaseBadge(phase);
        this._updatePhaseTabs(phase);

        switch (phase) {
            case PHASE.IDEATION:
                ideationPhase.start(this.session, this.cardFields, () => {
                    this._routeToPhase(PHASE.BUILDING);
                });
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
                        lorebookPanel.render(this.session.lorebookLog.acceptedEntries, lorebookPhase.pendingEntries);
                        this._switchWorkspaceTab(TAB.LOREBOOK);
                    },
                });
                this._switchWorkspaceTab(TAB.LOREBOOK);
                break;
        }
    }

    async _handleUserMessage(message, editIdx) {
        // Handle edit-at-index: roll back memory history
        if (editIdx !== undefined) {
            memoryManager.editMessage(this.session, editIdx * 2, message); // *2 because user msgs are every other
        }

        // Phase switch detection
        const switchTo = detectPhaseSwitch(message);
        if (switchTo === 'lorebook') { chatPanel.addMessage('user', message); this._routeToPhase(PHASE.LOREBOOK); return; }
        if (switchTo === 'building') { chatPanel.addMessage('user', message); this._routeToPhase(PHASE.BUILDING); return; }
        if (switchTo === 'build_start' && this.currentPhase === PHASE.IDEATION) {
            chatPanel.addMessage('user', message);
            await ideationPhase.handleMessage(message);
            return;
        }

        // Route to current phase handler
        switch (this.currentPhase) {
            case PHASE.IDEATION: await ideationPhase.handleMessage(message); break;
            case PHASE.BUILDING: await generationPhase.handleMessage(message); break;
            case PHASE.LOREBOOK: await lorebookPhase.handleMessage(message); break;
        }

        memoryManager.saveSession(this.characterId, this.session);
    }

    // ── Header events ─────────────────────────────────────────────────────────

    _bindHeaderEvents() {
        document.getElementById('ccs-close-studio')?.addEventListener('click', () => this.close());
        document.getElementById('ccs-settings-btn')?.addEventListener('click', () => settingsModal.open());

        document.getElementById('ccs-new-session-btn')?.addEventListener('click', () => {
            if (!confirm('Start a new session? Current session will be saved.')) return;
            memoryManager.clearSession(this.characterId);
            this.session = memoryManager.createNewSession(this.characterId);
            chatPanel.clear();
            cardPanel.init('ccs-card-panel-container', this.cardFields, this.session, cardPanel.callbacks);
            this._routeToPhase(PHASE.IDEATION);
        });

        document.getElementById('ccs-resume-btn')?.addEventListener('click', () => {
            // Session is already loaded — just show a summary
            const idea = this.session.ideaMemory;
            chatPanel.addSystemMessage(
                `Resuming: **${idea.conceptName || 'your character'}** (${this.session.conversationHistory.length} messages in history)`,
                'info'
            );
            ideaPanel.render(idea);
        });

        // Escape key closes
        document.addEventListener('keydown', this._escHandler = (e) => {
            if (e.key === 'Escape' && this.isOpen) this.close();
        });
    }

    // ── Workspace tabs ────────────────────────────────────────────────────────

    _bindWorkspaceTabs() {
        this.el.querySelectorAll('.ccs-wtab').forEach(tab => {
            tab.addEventListener('click', () => this._switchWorkspaceTab(tab.dataset.tab));
        });
    }

    _switchWorkspaceTab(tabName) {
        this.currentTab = tabName;
        this.el.querySelectorAll('.ccs-wtab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));

        document.getElementById('ccs-card-panel-container').style.display = tabName === TAB.CARD ? '' : 'none';
        document.getElementById('ccs-lorebook-panel-container').style.display = tabName === TAB.LOREBOOK ? '' : 'none';
        document.getElementById('ccs-idea-panel-container').style.display = tabName === TAB.IDEA ? '' : 'none';

        if (tabName === TAB.LOREBOOK) lorebookPanel.render(this.session.lorebookLog.acceptedEntries, lorebookPhase.pendingEntries);
        if (tabName === TAB.IDEA) ideaPanel.render(this.session.ideaMemory);
    }

    // ── Phase tabs ────────────────────────────────────────────────────────────

    _bindPhaseTabs() {
        this.el.querySelectorAll('.ccs-ptab').forEach(tab => {
            tab.addEventListener('click', () => {
                const phase = tab.dataset.phase;
                if (phase === this.currentPhase) return;
                if (phase === PHASE.BUILDING && this.currentPhase === PHASE.IDEATION && !this.session.ideaMemory.proposedProfileApproved) {
                    if (!confirm('Move to building phase without approving the concept profile?')) return;
                }
                chatPanel.addSystemMessage(`Switching to ${phase} mode...`, 'info');
                this._routeToPhase(phase);
            });
        });
    }

    _updatePhaseTabs(phase) {
        this.el.querySelectorAll('.ccs-ptab').forEach(t => t.classList.toggle('active', t.dataset.phase === phase));
    }

    _updatePhaseBadge(phase) {
        const badge = document.getElementById('ccs-phase-badge');
        if (!badge) return;
        const labels = { ideation:'💡 Ideating', building:'📝 Building', lorebook:'📖 Lorebook', review:'⭐ Review' };
        badge.textContent = labels[phase] || phase;
        badge.className = `ccs-phase-badge ccs-phase-${phase}`;
    }

    // ── Snippets ──────────────────────────────────────────────────────────────

    _renderSnippetBar() {
        const snippets = memoryManager.getSnippets();
        const chipsEl = document.getElementById('ccs-snip-chips');
        const bar = document.getElementById('ccs-snippet-bar');
        if (!chipsEl) return;
        if (!snippets.length) { bar.style.display = 'none'; return; }
        bar.style.display = '';
        chipsEl.innerHTML = snippets.map(s =>
            `<button class="ccs-snip-chip" data-id="${s.id}" title="${s.category}: ${s.content.substring(0,60)}">${s.name}</button>`
        ).join('');
        chipsEl.querySelectorAll('.ccs-snip-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                const snip = memoryManager.getSnippets().find(s => s.id === btn.dataset.id);
                if (!snip) return;
                const input = document.getElementById('ccs-chat-input');
                if (input) { input.value += (input.value ? '\n' : '') + snip.content; input.focus(); }
            });
        });
    }

    // ── Feature actions ───────────────────────────────────────────────────────

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
            expand: `Expand on this passage: "${selectedText}" — add more detail and texture while matching the existing tone.`,
            specific: `Make this more specific: "${selectedText}" — replace vague language with concrete, character-specific detail.`,
            explain: `Why was this choice made in the card? "${selectedText}" — explain the creative reasoning.`,
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
        a.href = url; a.download = `${(card.name || 'character').replace(/\s+/g,'_')}_studio_log.md`;
        a.click(); URL.revokeObjectURL(url);
    }

    _showNoCharError() {
        const toast = document.createElement('div');
        toast.className = 'ccs-toast ccs-toast-error';
        toast.textContent = '⚠️ Select a character in SillyTavern first, then open the Studio.';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }

    _focusInput() {
        document.getElementById('ccs-chat-input')?.focus();
    }
}

export const studioPopup = new StudioPopup();
