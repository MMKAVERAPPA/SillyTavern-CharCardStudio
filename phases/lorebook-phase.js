// phases/lorebook-phase.js
// Lorebook generation, entry staging, accept/insert, search/filter, keyword check, organize

import { chatEngine } from '../core/chat.js';
import { worldInfoManager } from '../core/worldinfo.js';
import { auditEngine } from '../core/audit.js';
import { memoryManager } from '../core/memory.js';
import { buildBaseSystemPrompt } from '../prompts/base.js';
import { chatPanel } from '../ui/chat-panel.js';
import { lorebookPanel } from '../ui/lorebook-panel.js';
import { parseLorebookEntriesFromResponse } from '../core/parser.js';
import { LOREBOOK_ENTRY_PROMPT, LOREBOOK_IDEATION_PROMPT, LOREBOOK_ORGANIZE_PROMPT } from '../prompts/lorebook.js';

export class LorebookPhase {
    constructor() {
        this.session = null;
        this.cardFields = null;
        this.targetBook = '';
        this.embedded = true;
        this.pendingEntries = [];   // staged but not yet written
        this.onUpdated = null;
    }

    start(session, cardFields, callbacks = {}) {
        this.session = session;
        this.cardFields = cardFields;
        this.onUpdated = callbacks.onUpdated;

        // Restore pending entries if resuming
        this.pendingEntries = [...(session.lorebookLog.pendingEntries || [])];

        chatPanel.addMessage('assistant',
            `Let's build the lorebook for **${session.ideaMemory?.conceptName || 'your character'}**.\n\n` +
            `I'll help brainstorm entries, generate them with full metadata, and write them directly to the card or an external lorebook.\n\n` +
            `First — should entries be **embedded in the character card** (portable, recommended) or in an **external lorebook**?\n` +
            `Also, what areas of lore do you want to start with?`
        );

        lorebookPanel.render(session.lorebookLog.acceptedEntries, this.pendingEntries);
    }

    async handleMessage(userMessage) {
        const lower = userMessage.toLowerCase();

        // Configuration
        if (lower.includes('embedded') || lower.includes('embed in card')) {
            this.embedded = true;
            this.session.lorebookLog.embedded = true;
            chatPanel.addMessage('assistant', '✅ Set to **embedded** in character card. Entries will go into the character_book field.');
            return true;
        }
        if (lower.includes('external lorebook') || lower.includes('standalone lorebook')) {
            this.embedded = false;
            this.session.lorebookLog.embedded = false;
            await this._promptForLorebookName();
            return true;
        }

        // Brainstorm
        if (lower.includes('brainstorm') || lower.includes('what entries') || lower.includes('plan entries') || lower.includes('plan the lorebook')) {
            await this._brainstormEntries();
            return true;
        }

        // Keyword quality check
        if (lower.includes('check keywords') || lower.includes('keyword quality') || lower.includes('review keywords')) {
            await this._checkKeywords();
            return true;
        }

        // Organize
        if (lower.includes('organise') || lower.includes('organize') || lower.includes('sort entries') || lower.includes('reorder')) {
            await this._organizeEntries();
            return true;
        }

        // Accept all pending
        if (lower.includes('accept all') || lower.includes('insert all') || lower.includes('write all entries')) {
            await this._acceptAllPending();
            return true;
        }

        // Generate entries
        await this._generateEntries(userMessage);
        return true;
    }

    // ── Private ──────────────────────────────────────────────────────────────

    async _brainstormEntries() {
        chatPanel.setInputEnabled(false);
        chatPanel.startStreaming();
        const settings = memoryManager.getGlobalSettings();
        const base = buildBaseSystemPrompt(settings.customSystemPromptRules)
            + '\n\n' + memoryManager.buildIdeaMemorySummary(this.session);
        const response = await chatEngine.generateBackground(
            base + '\n\n' + LOREBOOK_IDEATION_PROMPT,
            'Brainstorm all lorebook entries needed for this character card.'
        );
        chatPanel.finalizeStream(response);
        chatPanel.setInputEnabled(true);
        memoryManager.addMessage(this.session, 'assistant', response);
    }

    async _generateEntries(userMessage) {
        chatPanel.setInputEnabled(false);
        chatPanel.startStreaming();
        const settings = memoryManager.getGlobalSettings();

        const lorebookIndex = memoryManager.buildLorebookIndex(this.session);
        const base = buildBaseSystemPrompt(settings.customSystemPromptRules)
            + '\n\n' + LOREBOOK_ENTRY_PROMPT
            + (lorebookIndex ? '\n\n' + lorebookIndex : '')
            + '\n\n' + memoryManager.buildIdeaMemorySummary(this.session);

        const response = await chatEngine.chat({
            userMessage,
            session: this.session,
            cardFields: this.cardFields,
            extraInstruction: LOREBOOK_ENTRY_PROMPT,
            onComplete: async (text) => {
                chatPanel.finalizeStream(text);
                chatPanel.setInputEnabled(true);

                const entries = parseLorebookEntriesFromResponse(text);
                if (!entries.length) {
                    chatPanel.addSystemMessage('⚠️ No entries parsed. Try asking more specifically (e.g. "Generate 3 entries about the city").', 'warning');
                    return;
                }

                // Deduplicate against existing accepted entries
                const deduped = this._deduplicateEntries(entries);
                if (deduped.skipped > 0) {
                    chatPanel.addSystemMessage(`ℹ️ Skipped ${deduped.skipped} duplicate entry title(s).`, 'info');
                }

                for (const entry of deduped.entries) {
                    this.pendingEntries.push(entry);
                    memoryManager.addPendingEntry(this.session, entry);
                }

                lorebookPanel.render(this.session.lorebookLog.acceptedEntries, this.pendingEntries);

                // Show staging bar
                const bar = this._buildStagingBar(deduped.entries);
                document.getElementById('ccs-chat-messages')?.appendChild(bar);

                memoryManager.saveSession(this.session.characterId, this.session);
            },
        });
    }

    _buildStagingBar(entries) {
        const bar = document.createElement('div');
        bar.className = 'ccs-accept-bar ccs-lore-staging-bar';
        bar.innerHTML = `
            <span class="ccs-accept-label">📋 ${entries.length} entry/entries staged:</span>
            <div class="ccs-lore-staged-list">
                ${entries.map(e => `<span class="ccs-lore-tag">${e.comment || 'Untitled'}</span>`).join('')}
            </div>
            <div class="ccs-btn-row">
                <button class="ccs-btn ccs-btn-primary ccs-insert-all-btn">💾 Insert All (${entries.length})</button>
                <button class="ccs-btn ccs-btn-secondary ccs-review-staged-btn">👁 Review in Panel</button>
                <button class="ccs-btn ccs-btn-ghost ccs-discard-staged-btn">🗑 Discard</button>
            </div>
        `;
        bar.querySelector('.ccs-insert-all-btn').addEventListener('click', () => {
            this._insertEntries(entries);
            bar.innerHTML = `<span class="ccs-accept-label">✅ ${entries.length} entries inserted</span>`;
        });
        bar.querySelector('.ccs-review-staged-btn').addEventListener('click', () => {
            lorebookPanel.render(this.session.lorebookLog.acceptedEntries, this.pendingEntries);
            document.getElementById('ccs-tab-lorebook')?.click();
        });
        bar.querySelector('.ccs-discard-staged-btn').addEventListener('click', () => {
            for (const e of entries) {
                const idx = this.pendingEntries.findIndex(p => p._tempId === e._tempId);
                if (idx !== -1) this.pendingEntries.splice(idx, 1);
            }
            lorebookPanel.render(this.session.lorebookLog.acceptedEntries, this.pendingEntries);
            bar.innerHTML = '<span class="ccs-accept-label">🗑 Discarded</span>';
        });
        return bar;
    }

    async _insertEntries(entries) {
        try {
            const { characterId } = SillyTavern.getContext();
            if (this.embedded) {
                await worldInfoManager.addEmbeddedEntries(characterId, entries);
            } else {
                if (!this.targetBook) {
                    chatPanel.addSystemMessage('⚠️ No external lorebook selected. Set one in the Lorebook panel.', 'warning');
                    return;
                }
                await worldInfoManager.addEntries(this.targetBook, entries);
            }

            for (const entry of entries) {
                memoryManager.acceptLoreEntry(this.session, entry);
                const idx = this.pendingEntries.findIndex(p => p._tempId === entry._tempId);
                if (idx !== -1) this.pendingEntries.splice(idx, 1);
            }

            memoryManager.saveSession(this.session.characterId, this.session);
            lorebookPanel.render(this.session.lorebookLog.acceptedEntries, this.pendingEntries);
            this.onUpdated?.();
        } catch (err) {
            chatPanel.addSystemMessage('❌ Failed to insert entries: ' + err.message, 'error');
        }
    }

    async _acceptAllPending() {
        if (!this.pendingEntries.length) {
            chatPanel.addSystemMessage('No staged entries to accept.', 'info');
            return;
        }
        const toInsert = [...this.pendingEntries];
        await this._insertEntries(toInsert);
        chatPanel.addSystemMessage(`✅ Inserted ${toInsert.length} entries.`, 'info');
    }

    async _checkKeywords() {
        const all = [...this.session.lorebookLog.acceptedEntries, ...this.pendingEntries];
        if (!all.length) {
            chatPanel.addMessage('assistant', 'No entries yet to check keywords for.');
            return;
        }
        chatPanel.setInputEnabled(false);
        chatPanel.startStreaming();
        const result = await auditEngine.checkKeywordQuality(all);
        chatPanel.finalizeStream(result);
        chatPanel.setInputEnabled(true);
    }

    async _organizeEntries() {
        const all = this.session.lorebookLog.acceptedEntries;
        if (!all.length) {
            chatPanel.addMessage('assistant', 'No accepted entries to organize yet.');
            return;
        }
        chatPanel.setInputEnabled(false);
        chatPanel.startStreaming();
        const entrySummary = all.map((e, i) => `[${i + 1}] "${e.comment}" | Keys: ${e.keys?.join(', ')} | Order: ${e.insertion_order} | Position: ${e.position}`).join('\n');
        const result = await chatEngine.generateBackground(
            LOREBOOK_ORGANIZE_PROMPT,
            `Organize these lorebook entries:\n\n${entrySummary}`
        );
        chatPanel.finalizeStream(result);
        chatPanel.setInputEnabled(true);
    }

    async _promptForLorebookName() {
        const books = await worldInfoManager.getLorebookList();
        lorebookPanel.renderBookSelector(books, (name) => {
            this.targetBook = name;
            this.session.lorebookLog.targetBook = name;
            chatPanel.addMessage('assistant', `✅ Targeting external lorebook: **${name}**. Ready to generate entries.`);
        });
    }

    _deduplicateEntries(newEntries) {
        const existingTitles = new Set([
            ...this.session.lorebookLog.acceptedEntries.map(e => e.comment?.toLowerCase()),
            ...this.pendingEntries.map(e => e.comment?.toLowerCase()),
        ]);
        const filtered = [];
        let skipped = 0;
        for (const e of newEntries) {
            if (existingTitles.has(e.comment?.toLowerCase())) { skipped++; continue; }
            filtered.push(e);
            existingTitles.add(e.comment?.toLowerCase());
        }
        return { entries: filtered, skipped };
    }
}

export const lorebookPhase = new LorebookPhase();
