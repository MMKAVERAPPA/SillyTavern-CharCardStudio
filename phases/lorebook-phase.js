// phases/lorebook-phase.js
// Lorebook creation: brainstorming, entry generation, staging, insertion
// FIX: try-catch all gen calls, proper error cleanup

import { chatEngine } from '../core/chat.js';
import { memoryManager } from '../core/memory.js';
import { worldInfoManager } from '../core/worldinfo.js';
import { chatPanel } from '../ui/chat-panel.js';
import { lorebookPanel } from '../ui/lorebook-panel.js';
import { contextBuilder } from '../core/context-builder.js';
import { buildBaseSystemPrompt } from '../prompts/base.js';
import { CCSApiError } from '../core/api.js';
import { parseLorebookEntriesFromResponse } from '../core/parser.js';

import {
    LOREBOOK_IDEATION_PROMPT,
    LOREBOOK_ENTRY_PROMPT,
    KEYWORD_QUALITY_CHECK_PROMPT,
    LOREBOOK_ORGANIZE_PROMPT,
} from '../prompts/lorebook.js';

export class LorebookPhase {
    constructor() {
        this.session = null;
        this.cardFields = null;
        this.callbacks = {};
        this.pendingEntries = [];
    }

    start(session, cardFields, callbacks = {}) {
        this.session = session;
        this.cardFields = cardFields;
        this.callbacks = callbacks;

        // Restore pending entries from session
        this.pendingEntries = session.lorebookLog.pendingEntries || [];
    }

    async handleMessage(message) {
        const lower = message.toLowerCase();

        // Detect user intent
        if (/brainstorm|plan|what entries|suggest entries/i.test(lower)) {
            await this._brainstormEntries(message);
            return;
        }
        if (/generate.*entr|create.*entr|write.*entr/i.test(lower)) {
            await this._generateEntries(message);
            return;
        }
        if (/insert all|accept all|save all/i.test(lower)) {
            await this._insertAllPending();
            return;
        }
        if (/check.*key|keyword.*quality|audit.*key/i.test(lower)) {
            await this._checkKeywordQuality();
            return;
        }
        if (/organiz|sort|reorder/i.test(lower)) {
            await this._organizeEntries();
            return;
        }
        if (/embedded|character.?book/i.test(lower)) {
            this.session.lorebookLog.embedded = true;
            chatPanel.addSystemMessage('📝 Lorebook mode: embedded in character card.', 'info');
            return;
        }
        if (/external|standalone|world.?info/i.test(lower)) {
            await this._selectExternalBook();
            return;
        }

        // General lorebook chat
        await this._generalChat(message);
    }

    // ── Brainstorm ─────────────────────────────────────────────────────────

    async _brainstormEntries(userMessage) {
        const cardSummary = Object.entries(this.cardFields || {})
            .filter(([k, v]) => typeof v === 'string' && v.trim())
            .map(([k, v]) => `### ${k}\n${v.substring(0, 200)}`)
            .join('\n\n');

        chatPanel.startStreaming();
        chatPanel.setInputEnabled(false);

        try {
            await chatEngine.chat({
                userMessage,
                session: this.session,
                cardFields: this.cardFields,
                extraInstruction: `${LOREBOOK_IDEATION_PROMPT}\n\n--- Card Summary ---\n${cardSummary}`,
                onComplete: (response) => {
                    chatPanel.finalizeStream(response);
                    // Parse entry list and store
                    this._parseEntryList(response);
                },
                onError: (err) => {
                    chatPanel.cancelStreaming();
                    this._showError(err, 'Brainstorming failed');
                },
            });
        } catch (err) {
            chatPanel.cancelStreaming();
            this._showError(err, 'Brainstorming failed');
        } finally {
            chatPanel.setInputEnabled(true);
        }
    }

    // ── Generate entries ────────────────────────────────────────────────────

    async _generateEntries(userMessage) {
        const cardSummary = Object.entries(this.cardFields || {})
            .filter(([k, v]) => typeof v === 'string' && v.trim())
            .map(([k, v]) => `### ${k}\n${v.substring(0, 200)}`)
            .join('\n\n');

        chatPanel.startStreaming();
        chatPanel.setInputEnabled(false);

        try {
            await chatEngine.chat({
                userMessage,
                session: this.session,
                cardFields: this.cardFields,
                extraInstruction: `${LOREBOOK_ENTRY_PROMPT}\n\n--- Card Summary ---\n${cardSummary}`,
                onComplete: (response) => {
                    chatPanel.finalizeStream(response);
                    this._stageEntriesFromResponse(response);
                },
                onError: (err) => {
                    chatPanel.cancelStreaming();
                    this._showError(err, 'Entry generation failed');
                },
            });
        } catch (err) {
            chatPanel.cancelStreaming();
            this._showError(err, 'Entry generation failed');
        } finally {
            chatPanel.setInputEnabled(true);
        }
    }

    // ── General chat ────────────────────────────────────────────────────────

    async _generalChat(message) {
        chatPanel.startStreaming();
        chatPanel.setInputEnabled(false);

        try {
            await chatEngine.chat({
                userMessage: message,
                session: this.session,
                cardFields: this.cardFields,
                onComplete: (response) => {
                    chatPanel.finalizeStream(response);
                    // Check if response contains entry data
                    const entries = parseLorebookEntriesFromResponse(response);
                    if (entries.length) {
                        this._stageEntries(entries);
                    }
                },
                onError: (err) => {
                    chatPanel.cancelStreaming();
                    this._showError(err, 'Lorebook chat failed');
                },
            });
        } catch (err) {
            chatPanel.cancelStreaming();
            this._showError(err, 'Lorebook chat failed');
        } finally {
            chatPanel.setInputEnabled(true);
        }
    }

    // ── Keyword quality check ───────────────────────────────────────────────

    async _checkKeywordQuality() {
        const accepted = this.session.lorebookLog.acceptedEntries || [];
        if (!accepted.length) {
            chatPanel.addSystemMessage('No entries to check — generate some first.', 'info');
            return;
        }

        const entrySummary = accepted.map(e =>
            `Entry: ${e.comment}\nKeys: ${(e.keys || []).join(', ')}\nSecondary: ${(e.secondary_keys || []).join(', ')}`
        ).join('\n\n');

        chatPanel.startStreaming();
        chatPanel.setInputEnabled(false);

        try {
            await chatEngine.chat({
                userMessage: 'Check keyword quality for all entries.',
                session: this.session,
                cardFields: this.cardFields,
                extraInstruction: `${KEYWORD_QUALITY_CHECK_PROMPT}\n\n--- Entries ---\n${entrySummary}`,
                onComplete: (response) => {
                    chatPanel.finalizeStream(response);
                },
                onError: (err) => {
                    chatPanel.cancelStreaming();
                    this._showError(err, 'Keyword check failed');
                },
            });
        } catch (err) {
            chatPanel.cancelStreaming();
            this._showError(err, 'Keyword check failed');
        } finally {
            chatPanel.setInputEnabled(true);
        }
    }

    // ── Organize ────────────────────────────────────────────────────────────

    async _organizeEntries() {
        chatPanel.startStreaming();
        chatPanel.setInputEnabled(false);

        try {
            await chatEngine.chat({
                userMessage: 'Organize and sort my lorebook entries.',
                session: this.session,
                cardFields: this.cardFields,
                extraInstruction: LOREBOOK_ORGANIZE_PROMPT,
                onComplete: (response) => {
                    chatPanel.finalizeStream(response);
                },
                onError: (err) => {
                    chatPanel.cancelStreaming();
                    this._showError(err, 'Organize failed');
                },
            });
        } catch (err) {
            chatPanel.cancelStreaming();
            this._showError(err, 'Organize failed');
        } finally {
            chatPanel.setInputEnabled(true);
        }
    }

    // ── External book selection ─────────────────────────────────────────────

    async _selectExternalBook() {
        try {
            const books = await worldInfoManager.getLorebookList();
            if (!books.length) {
                chatPanel.addSystemMessage('No external lorebooks found. Create one in SillyTavern first, or use embedded mode.', 'warning');
                return;
            }
            lorebookPanel.renderBookSelector(books, (name) => {
                this.session.lorebookLog.targetBook = name;
                this.session.lorebookLog.embedded = false;
                chatPanel.addSystemMessage(`📖 Using external lorebook: **${name}**`, 'info');
            });
        } catch (err) {
            chatPanel.addSystemMessage('❌ Failed to load lorebook list.', 'error');
        }
    }

    // ── Stage entries ───────────────────────────────────────────────────────

    _stageEntriesFromResponse(response) {
        const entries = parseLorebookEntriesFromResponse(response);
        if (!entries.length) {
            chatPanel.addSystemMessage('No entries found in response. Try asking for specific entries.', 'info');
            return;
        }
        this._stageEntries(entries);
    }

    _stageEntries(entries) {
        let added = 0;
        for (const entry of entries) {
            // Dedup by title
            const isDupe = this.pendingEntries.some(p => p.comment === entry.comment) ||
                           (this.session.lorebookLog.acceptedEntries || []).some(a => a.comment === entry.comment);
            if (isDupe) continue;

            entry._tempId = Date.now() + Math.random();
            this.pendingEntries.push(entry);
            added++;
        }

        this.session.lorebookLog.pendingEntries = this.pendingEntries;
        this.callbacks.onUpdated?.();

        if (added) {
            chatPanel.addSystemMessage(`📋 Staged ${added} new entries. Review them in the Lorebook panel.`, 'info');
        }
    }

    _parseEntryList(response) {
        // Store the brainstormed list for reference
        this.session.lorebookLog.entryList = response;
    }

    // ── Insert entries ──────────────────────────────────────────────────────

    async _insertEntries(entries) {
        const loreLog = this.session.lorebookLog;

        for (const entry of entries) {
            try {
                if (loreLog.embedded) {
                    await worldInfoManager.addEmbeddedEntries(this.session?.characterId, [entry]);
                } else if (loreLog.targetBook) {
                    await worldInfoManager.addEntries(loreLog.targetBook, [entry]);
                } else {
                    chatPanel.addSystemMessage('❌ No lorebook target set. Choose embedded or external first.', 'error');
                    return;
                }

                // Move from pending to accepted
                this.pendingEntries = this.pendingEntries.filter(p => p._tempId !== entry._tempId);
                loreLog.acceptedEntries = loreLog.acceptedEntries || [];
                loreLog.acceptedEntries.push(entry);
                loreLog.pendingEntries = this.pendingEntries;

                chatPanel.addSystemMessage(`✅ Inserted: ${entry.comment || 'Untitled'}`, 'info');
            } catch (err) {
                chatPanel.addSystemMessage(`❌ Failed to insert "${entry.comment}": ${err.message}`, 'error');
            }
        }

        this.callbacks.onUpdated?.();
    }

    async _insertAllPending() {
        if (!this.pendingEntries.length) {
            chatPanel.addSystemMessage('No pending entries to insert.', 'info');
            return;
        }
        await this._insertEntries([...this.pendingEntries]);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    // FIX: Centralized error display with proper cleanup
    _showError(err, context) {
        const userMessage = (err instanceof CCSApiError)
            ? err.userMessage
            : `❌ ${context}: ${err?.message || 'Unknown error'}`;
        chatPanel.addSystemMessage(userMessage, 'error');
    }
}

export const lorebookPhase = new LorebookPhase();
