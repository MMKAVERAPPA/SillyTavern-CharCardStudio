// phases/generation.js
// Field generation phase: single fields, variations, batch ops, generate-all, rewrite actions, queue

import { chatEngine } from '../core/chat.js';
import { cardManager } from '../core/card.js';
import { auditEngine } from '../core/audit.js';
import { memoryManager } from '../core/memory.js';
import { buildBaseSystemPrompt } from '../prompts/base.js';
import { chatPanel } from '../ui/chat-panel.js';
import { cardPanel, FIELD_STATUS } from '../ui/card-panel.js';
import {
    detectFieldFromMessage, isBatchGreetingOp, isGenerateAllRequest, extractCodeBlock, parseMultiFieldResponse,
} from '../core/parser.js';
import {
    buildFieldGenerationPrompt, GENERATE_ALL_FIELDS_PROMPT, BATCH_OPERATION_PROMPT,
    REWRITE_INSTRUCTIONS, MES_EXAMPLE_WARNING,
} from '../prompts/generation.js';
import { VERSION_SUMMARY_PROMPT } from '../prompts/utility.js';

export class GenerationPhase {
    constructor() {
        this.session = null;
        this.cardFields = null;
        this.pendingContent = {};   // fieldName -> generated content not yet accepted
        this.onCardUpdated = null;
        this.queue = [];            // generation queue: array of fieldNames
        this.isQueueRunning = false;
    }

    start(session, cardFields, callbacks = {}) {
        this.session = session;
        this.cardFields = cardFields;
        this.onCardUpdated = callbacks.onCardUpdated;

        const idea = this.session?.ideaMemory;
        chatPanel.addMessage('assistant',
            `Let's start writing **${idea?.conceptName || 'your character'}**.\n\n` +
            `Click 🪄 next to any field on the right to generate it, or tell me which field to tackle.\n` +
            `Use **⚡ Generate All** for a quick full draft, or **🎲 Variations** on any field for 3 options side by side.\n\n` +
            `What would you like to start with?`
        );
    }

    async handleMessage(userMessage) {
        if (isBatchGreetingOp(userMessage)) { await this._handleBatchGreetings(userMessage); return true; }
        if (isGenerateAllRequest(userMessage)) { await this.generateAllFields(); return true; }

        // Rewrite action keywords
        const lower = userMessage.toLowerCase();
        for (const [action, instruction] of Object.entries(REWRITE_INSTRUCTIONS)) {
            if (lower.includes(action) && lower.includes('this') || lower.includes(`make it ${action}`) || lower.startsWith(action)) {
                const field = detectFieldFromMessage(userMessage);
                if (field && this.cardFields[field]) {
                    await this.rewriteField(field, action);
                    return true;
                }
            }
        }

        const requestedField = detectFieldFromMessage(userMessage);
        if (requestedField) { await this.generateField(requestedField, userMessage); return true; }

        await this._generalChat(userMessage);
        return true;
    }

    // ── Single field generation ───────────────────────────────────────────────

    async generateField(fieldName, userContext = '', detailLevelOverride = null) {
        cardPanel.setFieldStatus(fieldName, FIELD_STATUS.IN_PROGRESS);
        chatPanel.setInputEnabled(false);
        chatPanel.startStreaming();

        const settings = memoryManager.getGlobalSettings();
        const detailLevel = detailLevelOverride || document.getElementById('ccs-detail-level')?.value || 'standard';
        const extraInstruction = buildFieldGenerationPrompt(fieldName, this.cardFields, this.session?.ideaMemory, detailLevel)
            + (userContext ? `\n\nAdditional user instruction: ${userContext}` : '');

        const response = await chatEngine.chat({
            userMessage: userContext || `Generate the ${fieldName} field.`,
            session: this.session,
            cardFields: this.cardFields,
            extraInstruction,
            onComplete: async (text) => {
                chatPanel.finalizeStream(text);
                chatPanel.setInputEnabled(true);
                cardPanel.setFieldStatus(fieldName, FIELD_STATUS.GENERATED);

                const content = extractCodeBlock(text);
                this.pendingContent[fieldName] = content;

                // Macro validation
                const warnings = cardManager.validateMacros(fieldName, content);
                for (const w of warnings) chatPanel.addSystemMessage(w, 'warning');

                // mes_example format check
                if (fieldName === 'mes_example') {
                    const audit = await auditEngine.auditMesExample(content);
                    if (audit.hasIssues) chatPanel.addSystemMessage(MES_EXAMPLE_WARNING, 'warning');
                }

                chatPanel.addAcceptBar(fieldName, content, (fn, c) => this._acceptField(fn, c));
                memoryManager.saveSession(this.session.characterId, this.session);

                // Auto-suggest check
                const s = await auditEngine.autoSuggestCheck(this.session, this.cardFields);
                if (s) chatPanel.addSystemMessage('💡 Smart Suggestion:\n' + s, 'info');
            },
        });
    }

    // ── Variations (3 options side by side) ──────────────────────────────────

    async generateVariations(fieldName) {
        chatPanel.addSystemMessage(`Generating 3 variations for ${fieldName} in parallel...`, 'info');
        chatPanel.setInputEnabled(false);

        const settings = memoryManager.getGlobalSettings();
        const base = buildBaseSystemPrompt(settings.customSystemPromptRules)
            + '\n\n' + memoryManager.buildIdeaMemorySummary(this.session);
        const detailLevel = document.getElementById('ccs-detail-level')?.value || 'standard';
        const fieldInstruction = buildFieldGenerationPrompt(fieldName, this.cardFields, this.session?.ideaMemory, detailLevel);

        const directions = ['A', 'B', 'C'];
        const requests = directions.map((dir, i) => ({
            systemPrompt: base,
            userPrompt: `Generate variation ${dir} for the ${fieldName} field. Make this variation meaningfully distinct from typical output — variation ${i + 1} of 3 should offer a different angle, tone, or approach. ${fieldInstruction}`,
        }));

        try {
            const results = await chatEngine.generateParallel(requests);

            chatPanel.addMessage('assistant', `Here are 3 variations for **${fieldName}** — pick your favorite or blend elements:`);

            results.forEach((result, i) => {
                const content = extractCodeBlock(result);
                chatPanel.addVariation(fieldName, `Variation ${directions[i]}`, content, (fn, c) => this._acceptField(fn, c));
            });
        } catch (err) {
            chatPanel.addSystemMessage(`Variation generation failed: ${err.message}`, 'error');
        } finally {
            chatPanel.setInputEnabled(true);
        }
    }

    // ── Quick rewrite actions ─────────────────────────────────────────────────

    async rewriteField(fieldName, action) {
        const currentContent = this.cardFields[fieldName];
        if (!currentContent) {
            chatPanel.addSystemMessage(`${fieldName} is empty — generate it first.`, 'warning');
            return;
        }

        const instruction = REWRITE_INSTRUCTIONS[action];
        if (!instruction) return;

        chatPanel.setInputEnabled(false);
        chatPanel.startStreaming();

        const settings = memoryManager.getGlobalSettings();
        const base = buildBaseSystemPrompt(settings.customSystemPromptRules);

        const response = await chatEngine.generateBackground(
            base + '\n\n[REWRITE TASK]\n' + instruction,
            `Rewrite this ${fieldName} field:\n\n${currentContent}\n\nReturn the rewritten content in a triple-backtick code block.`
        );

        chatPanel.finalizeStream(response);
        chatPanel.setInputEnabled(true);

        const content = extractCodeBlock(response);
        this.pendingContent[fieldName] = content;
        cardPanel.setFieldStatus(fieldName, FIELD_STATUS.GENERATED);
        chatPanel.addAcceptBar(fieldName, content, (fn, c) => this._acceptField(fn, c));
    }

    // ── Generate All ──────────────────────────────────────────────────────────

    async generateAllFields(detailLevel = null) {
        chatPanel.setInputEnabled(false);
        chatPanel.addSystemMessage('⚡ Generating all fields... this may take a moment.', 'info');

        const settings = memoryManager.getGlobalSettings();
        const dl = detailLevel || document.getElementById('ccs-detail-level')?.value || 'standard';

        const fullPrompt = buildBaseSystemPrompt(settings.customSystemPromptRules)
            + '\n\n' + memoryManager.buildIdeaMemorySummary(this.session)
            + '\n\n' + memoryManager.getPlatformPrompt()
            + '\n\nDetail level: ' + dl
            + '\n\n' + GENERATE_ALL_FIELDS_PROMPT;

        try {
            const response = await chatEngine.generateBackground(fullPrompt, 'Generate all character card fields now.');
            chatPanel.addMessage('assistant', response);
            memoryManager.addMessage(this.session, 'assistant', response);

            const parsed = parseMultiFieldResponse(response);
            const fieldNames = Object.keys(parsed);

            if (!fieldNames.length) {
                chatPanel.addSystemMessage('⚠️ Could not parse field outputs. Try individual field generation.', 'warning');
                chatPanel.setInputEnabled(true);
                return;
            }

            chatPanel.addMessage('assistant', `✅ Generated ${fieldNames.length} fields. Review and accept each:`);
            for (const [fn, content] of Object.entries(parsed)) {
                this.pendingContent[fn] = content;
                cardPanel.setFieldStatus(fn, FIELD_STATUS.GENERATED);
                chatPanel.addAcceptBar(fn, content, (f, c) => this._acceptField(f, c));
            }

            // Accept All button
            const bar = document.createElement('div');
            bar.className = 'ccs-accept-bar';
            bar.innerHTML = `
                <span class="ccs-accept-label">Accept all ${fieldNames.length} fields at once?</span>
                <button class="ccs-btn ccs-btn-primary" id="ccs-accept-all-btn">✅ Accept All & Write to Card</button>
            `;
            bar.querySelector('#ccs-accept-all-btn').addEventListener('click', async () => {
                for (const [fn, content] of Object.entries(parsed)) {
                    await this._acceptField(fn, content, false);
                }
                this.onCardUpdated?.();
                bar.innerHTML = '<span class="ccs-accept-label">✅ All fields written to card</span>';
            });
            document.getElementById('ccs-chat-messages')?.appendChild(bar);

        } catch (err) {
            chatPanel.addSystemMessage('❌ Generation failed: ' + err.message, 'error');
        } finally {
            chatPanel.setInputEnabled(true);
        }
    }

    // ── Generation queue ──────────────────────────────────────────────────────

    addToQueue(fieldNames) {
        for (const fn of fieldNames) {
            if (!this.queue.includes(fn)) this.queue.push(fn);
        }
        chatPanel.addSystemMessage(`📋 Queued ${fieldNames.join(', ')} for generation.`, 'info');
        if (!this.isQueueRunning) this._runQueue();
    }

    async _runQueue() {
        this.isQueueRunning = true;
        while (this.queue.length > 0) {
            const field = this.queue.shift();
            chatPanel.addSystemMessage(`Generating ${field}...`, 'info');
            await this.generateField(field).catch(err =>
                chatPanel.addSystemMessage(`Queue: ${field} failed — ${err.message}`, 'error')
            );
        }
        this.isQueueRunning = false;
        chatPanel.addSystemMessage('✅ Generation queue complete.', 'info');
    }

    // ── Accept field ──────────────────────────────────────────────────────────

    async _acceptField(fieldName, content, rerender = true) {
        try {
            // Auto-fix mes_example format
            const finalContent = fieldName === 'mes_example' ? cardManager.fixMesExampleFormat(content) : content;

            // Conflict detection (non-blocking)
            auditEngine.checkConflictOnAccept(this.session, this.cardFields, fieldName, finalContent)
                .then(conflict => {
                    if (conflict) chatPanel.addSystemMessage(`⚠️ Possible conflict: ${conflict}`, 'warning');
                }).catch(() => {});

            await cardManager.writeField(fieldName, finalContent);
            this.cardFields[fieldName] = finalContent;

            // Generate version summary (utility tier, non-blocking)
            this._saveVersionWithSummary(fieldName, finalContent);

            cardPanel.setFieldStatus(fieldName, FIELD_STATUS.ACCEPTED);
            if (rerender) this.onCardUpdated?.();
            delete this.pendingContent[fieldName];
        } catch (err) {
            chatPanel.addSystemMessage('❌ Failed to write field: ' + err.message, 'error');
        }
    }

    async _saveVersionWithSummary(fieldName, newContent) {
        const versions = memoryManager.getFieldVersions(this.session, fieldName);
        let summary = '';
        if (versions.length > 0) {
            const prev = versions[versions.length - 1].content;
            try {
                summary = await chatEngine.generateUtility(
                    VERSION_SUMMARY_PROMPT,
                    `Previous version:\n${prev.substring(0, 300)}\n\nNew version:\n${newContent.substring(0, 300)}`
                ) || '';
            } catch {}
        }
        memoryManager.saveFieldVersion(this.session, fieldName, newContent, summary.trim());
        memoryManager.saveSession(this.session.characterId, this.session);
    }

    // ── Batch greeting operation ──────────────────────────────────────────────

    async _handleBatchGreetings(userMessage) {
        const greetings = this.cardFields.alternate_greetings || [];
        if (!greetings.length) {
            chatPanel.addMessage('assistant', 'No alternate greetings yet. Generate some first!');
            return;
        }

        chatPanel.setInputEnabled(false);
        chatPanel.addSystemMessage(`Running batch operation on ${greetings.length} greetings in parallel...`, 'info');

        const settings = memoryManager.getGlobalSettings();
        const base = buildBaseSystemPrompt(settings.customSystemPromptRules);

        const requests = greetings.map((g, i) => ({
            systemPrompt: base + '\n\n' + BATCH_OPERATION_PROMPT,
            userPrompt: `Apply this operation to greeting [${i}]:\n\nOperation: "${userMessage}"\n\nCurrent greeting:\n${g}\n\nReturn ONLY the updated greeting in a code block.`,
        }));

        try {
            const results = await chatEngine.generateParallel(requests);
            const newGreetings = results.map(r => extractCodeBlock(r));

            chatPanel.addMessage('assistant', `✅ Updated all ${greetings.length} greetings.`);

            const bar = document.createElement('div');
            bar.className = 'ccs-accept-bar';
            bar.innerHTML = `
                <span class="ccs-accept-label">Accept all updated greetings?</span>
                <button class="ccs-btn ccs-btn-primary" id="ccs-accept-greetings-btn">✅ Accept All Greetings</button>
            `;
            bar.querySelector('#ccs-accept-greetings-btn').addEventListener('click', async () => {
                await this._acceptField('alternate_greetings', newGreetings);
                bar.innerHTML = '<span class="ccs-accept-label">✅ All greetings updated</span>';
            });
            document.getElementById('ccs-chat-messages')?.appendChild(bar);

        } catch (err) {
            chatPanel.addSystemMessage('❌ Batch operation failed: ' + err.message, 'error');
        } finally {
            chatPanel.setInputEnabled(true);
        }
    }

    async _generalChat(userMessage) {
        chatPanel.setInputEnabled(false);
        chatPanel.startStreaming();
        await chatEngine.chat({
            userMessage,
            session: this.session,
            cardFields: this.cardFields,
            onComplete: (text) => {
                chatPanel.finalizeStream(text);
                chatPanel.setInputEnabled(true);
                memoryManager.saveSession(this.session.characterId, this.session);
            },
        });
    }
}

export const generationPhase = new GenerationPhase();
