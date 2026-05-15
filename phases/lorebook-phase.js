// phases/lorebook-phase.js
// v3.3 — Lorebook creation: ALWAYS external named lorebook (embedded mode removed)
// On start: if no targetBook selected, immediately prompt the user to choose/create one.

import { chatEngine } from '../core/chat.js';
import { memoryManager } from '../core/memory.js';
import { worldInfoManager } from '../core/worldinfo.js';
import { chatPanel } from '../ui/chat-panel.js';
import { lorebookPanel } from '../ui/lorebook-panel.js';
import { skillRouter } from '../core/skill-router.js';
import { CCSApiError } from '../core/api.js';
import { parseLorebookEntriesFromResponse, parseLorePlan } from '../core/parser.js';
import { haptic } from '../core/haptic.js';

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

        // v3.3: embedded mode removed — always require a named external lorebook.
        // If none is set yet, prompt immediately instead of silently failing later.
        if (!session.lorebookLog.targetBook) {
            this._promptInitialBookSelection();
        } else {
            chatPanel.addSystemMessage(
                `📖 Lorebook: **${session.lorebookLog.targetBook}** — ready. Generate entries or say "change lorebook" to pick a different one.`,
                'info'
            );
        }
    }

    // ── Initial book selection prompt ────────────────────────────────────────

    async _promptInitialBookSelection() {
        chatPanel.addSystemMessage(
            '📖 No lorebook selected. Choose an existing lorebook or create a new one below.',
            'warning'
        );
        await this._showBookSelector();
    }

    async _promptBookChange() {
        await this._showBookSelector();
    }

    async _showBookSelector() {
        try {
            const books = await worldInfoManager.getLorebookList();
            lorebookPanel.renderBookSelector(books, async (choice) => {
                if (choice === '__create_new__') {
                    await this._createNewLorebook();
                } else {
                    await this._setTargetBook(choice);
                }
            }, { showCreateNew: true });
        } catch (err) {
            chatPanel.addSystemMessage('❌ Failed to load lorebook list. Check SillyTavern connection.', 'error');
        }
    }

    async _createNewLorebook() {
        const name = prompt('Enter a name for the new lorebook:');
        if (!name?.trim()) return;
        try {
            const created = await worldInfoManager.createLorebook(name.trim());
            this._setTargetBook(created);
            chatPanel.addSystemMessage(`✅ Created lorebook: **${created}**`, 'info');
        } catch (err) {
            chatPanel.addSystemMessage(`❌ Failed to create lorebook: ${err.message}`, 'error');
        }
    }

    async _setTargetBook(name) {
        this.session.lorebookLog.targetBook = name;
        
        // Load existing entries from the lorebook file
        try {
            const existingEntries = await worldInfoManager.getLorebookEntries(name);
            // Convert from object with uid keys to array
            const entriesArray = Object.values(existingEntries || {});
            this.session.lorebookLog.existingEntries = entriesArray;
            chatPanel.addSystemMessage(
                `📖 Lorebook set: **${name}** (${entriesArray.length} existing entries) — start generating more!`,
                'info'
            );
        } catch (err) {
            console.error('[CCS] Failed to load existing entries:', err);
            this.session.lorebookLog.existingEntries = [];
            chatPanel.addSystemMessage(
                `📖 Lorebook set: **${name}** — start generating entries!`,
                'info'
            );
        }
        
        memoryManager.saveSession(this.session.characterId, this.session);
        this.callbacks.onUpdated?.();
    }

    // ── Build skill-based system prompt ──────────────────────────────────────

    _buildSystemPrompt(task = '') {
        const settings = memoryManager.getGlobalSettings();
        const idea = this.session?.ideaMemory || {};
        return skillRouter.buildSystemPrompt({
            phase: 'lorebook',
            task,
            cardType: idea.cardType || 'single',
            format: idea.format || 'prose',
            customRules: settings.customSystemPromptRules,
        });
    }

    async handleMessage(message) {
        const lower = message.toLowerCase();

        // Change lorebook target
        if (/change lorebook|switch lorebook|select lorebook|pick lorebook/i.test(lower)) {
            chatPanel.addSystemMessage(
                `📖 Current lorebook: **${this.session.lorebookLog.targetBook || 'None'}** — Choose a different one below.`,
                'info'
            );
            await this._promptBookChange();
            return;
        }

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
            await this._organizeEntries();;
            return;
        }
        if (/recursion|check links|entry links|cross.?ref/i.test(lower)) {
            await this._showRecursionReport();
            return;
        }

        // General lorebook chat
        await this._generalChat(message);
    }

    // ── Brainstorm ─────────────────────────────────────────────────────────

    async _brainstormEntries(userMessage) {
        const cardSummary = Object.entries(this.cardFields || {})
            .filter(([k, v]) => typeof v === 'string' && v.trim())
            .map(([k, v]) => `### ${k}\n${v.substring(0, 500)}`)
            .join('\n\n');

        const taskPrompt = skillRouter.getLorebookPrompt('brainstorm');

        chatPanel.startStreaming();
        chatPanel.setInputEnabled(false);

        try {
            await chatEngine.chat({
                userMessage,
                session: this.session,
                cardFields: this.cardFields,
                extraInstruction: `${taskPrompt}\n\n--- Card Summary ---\n${cardSummary}`,
                skillOptions: { phase: 'lorebook', task: 'brainstorm' },
                onComplete: (response) => {
                    chatPanel.finalizeStream(response);
                    const plan = parseLorePlan(response);
                    if (plan && plan.length) {
                        this.session.ideaMemory.loreEntryPlan = plan;
                        memoryManager.saveSession(this.session.characterId, this.session);
                        chatPanel.addSystemMessage(
                            `📋 Lore plan saved: **${plan.length}** entries planned. Say "generate entries" to start building.`,
                            'info'
                        );
                    }
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
        if (!this._guardTarget()) return;

        const cardSummary = Object.entries(this.cardFields || {})
            .filter(([k, v]) => typeof v === 'string' && v.trim())
            .map(([k, v]) => `### ${k}\n${v.substring(0, 500)}`)
            .join('\n\n');

        const taskPrompt = skillRouter.getLorebookPrompt('generate');

        const lorePlan = this.session.ideaMemory.loreEntryPlan || [];
        const lorePlanContext = lorePlan.length
            ? `\n\n--- Planned Entry List ---\nGenerate entries from this plan. For each entry you generate, use the planned title, category, and description as your starting point:\n${lorePlan.map(e => `- ${e.title} | ${e.category} | ${e.activation} | ${e.description}`).join('\n')}`
            : '';

        const acceptedEntries = this.session.lorebookLog.acceptedEntries || [];
        const existingEntriesContext = acceptedEntries.length
            ? `\n\n--- Already Generated Entries ---\nDo NOT duplicate these. You may reference their keywords for recursion chains:\n${acceptedEntries.map(e => `- "${e.comment}" | Keys: ${(e.keys||[]).join(', ')} | ~${Math.round((e.content||'').length/4)}t`).join('\n')}`
            : '';

        chatPanel.startStreaming();
        chatPanel.setInputEnabled(false);

        try {
            await chatEngine.chat({
                userMessage,
                session: this.session,
                cardFields: this.cardFields,
                extraInstruction: `${taskPrompt}${lorePlanContext}${existingEntriesContext}\n\n--- Card Summary ---\n${cardSummary}`,
                skillOptions: { phase: 'lorebook', task: 'generate' },
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
                skillOptions: { phase: 'lorebook' },
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

        const taskPrompt = skillRouter.getLorebookPrompt('keyword_check');

        chatPanel.startStreaming();
        chatPanel.setInputEnabled(false);

        try {
            await chatEngine.chat({
                userMessage: 'Check keyword quality for all entries.',
                session: this.session,
                cardFields: this.cardFields,
                extraInstruction: `${taskPrompt}\n\n--- Entries ---\n${entrySummary}`,
                skillOptions: { phase: 'lorebook', task: 'keyword_check' },
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
        const taskPrompt = skillRouter.getLorebookPrompt('organize');

        chatPanel.startStreaming();
        chatPanel.setInputEnabled(false);

        try {
            await chatEngine.chat({
                userMessage: 'Organize and sort my lorebook entries.',
                session: this.session,
                cardFields: this.cardFields,
                extraInstruction: taskPrompt,
                skillOptions: { phase: 'lorebook', task: 'organize' },
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
            // Dedup on comment+keys together
            const entryKeyStr = (entry.keys || []).sort().join(',');
            const isDupe = this.pendingEntries.some(p => {
                const pKeyStr = (p.keys || []).sort().join(',');
                return p.comment === entry.comment && pKeyStr === entryKeyStr;
            }) || (this.session.lorebookLog.acceptedEntries || []).some(a => {
                const aKeyStr = (a.keys || []).sort().join(',');
                return a.comment === entry.comment && aKeyStr === entryKeyStr;
            });
            if (isDupe) continue;

            entry._tempId = Date.now() + Math.random();
            this.pendingEntries.push(entry);
            added++;
        }

        this.session.lorebookLog.pendingEntries = this.pendingEntries;
        this.callbacks.onUpdated?.();

        if (added) {
            haptic.pulse(15);
            chatPanel.addSystemMessage(`📋 Staged ${added} new entries. Review them in the Lorebook panel.`, 'info');
        }
    }

    _parseEntryList(response) {
        this.session.lorebookLog.entryList = response;
    }

    // ── Insert entries ──────────────────────────────────────────────────────

    async _insertEntries(entries) {
        const loreLog = this.session.lorebookLog;

        if (!loreLog.targetBook) {
            chatPanel.addSystemMessage('❌ No lorebook selected. Use the lorebook panel to choose or create one first.', 'error');
            await this._promptInitialBookSelection();
            return;
        }

        for (const entry of entries) {
            try {
                await worldInfoManager.addEntries(loreLog.targetBook, [entry]);

                // Move from pending to accepted
                this.pendingEntries = this.pendingEntries.filter(p => p._tempId !== entry._tempId);
                loreLog.acceptedEntries = loreLog.acceptedEntries || [];
                loreLog.acceptedEntries.push(entry);
                loreLog.pendingEntries = this.pendingEntries;
                
                // Rebuild recursion map on insert
                loreLog.recursionMap = this._buildRecursionMap() || [];

                haptic.pulse(10);
                chatPanel.addSystemMessage(`✅ Inserted: **${entry.comment || 'Untitled'}** → ${loreLog.targetBook}`, 'info');
            } catch (err) {
                chatPanel.addSystemMessage(`❌ Failed to insert "${entry.comment}": ${err.message}`, 'error');
            }
        }

        memoryManager.saveSession(this.session.characterId, this.session);
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

    _guardTarget() {
        if (!this.session.lorebookLog.targetBook) {
            chatPanel.addSystemMessage('⚠️ No lorebook selected — choose one first.', 'warning');
            this._promptInitialBookSelection();
            return false;
        }
        return true;
    }

    _showError(err, context) {
        const userMessage = (err instanceof CCSApiError)
            ? err.userMessage
            : `❌ ${context}: ${err?.message || 'Unknown error'}`;
        chatPanel.addSystemMessage(userMessage, 'error');
    }

    _buildRecursionMap() {
        const accepted = this.session.lorebookLog.acceptedEntries || [];
        if (accepted.length < 2) return null;
        
        const links = [];
        for (const entry of accepted) {
            const content = (entry.content || '').toLowerCase();
            for (const other of accepted) {
                if (other === entry) continue;
                const matchedKey = (other.keys || []).find(k => 
                    k.length > 3 && content.includes(k.toLowerCase())
                );
                if (matchedKey) {
                    links.push({ from: entry.comment, to: other.comment, trigger: matchedKey });
                }
            }
        }
        return links.length ? links : null;
    }

    async _showRecursionReport() {
        const map = this._buildRecursionMap();
        if (!map) {
            chatPanel.addSystemMessage('No recursion links found (need 2+ accepted entries).', 'info');
            return;
        }
        const report = map.map(l => `• "${l.from}" → triggers "${l.to}" via keyword "${l.trigger}"`).join('\n');
        chatPanel.addSystemMessage(`🔗 **Recursion Links Found:**\n${report}`, 'info');
    }
}

export const lorebookPhase = new LorebookPhase();
