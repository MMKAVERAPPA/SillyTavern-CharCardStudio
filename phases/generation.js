// phases/generation.js
// Card field generation, variations, batch operations, rewrite instructions
// FIX: try-catch all gen calls, parallel toggle, proper error cleanup

import { chatEngine } from '../core/chat.js';
import { memoryManager } from '../core/memory.js';
import { cardManager } from '../core/card.js';
import { auditEngine } from '../core/audit.js';
import { chatPanel } from '../ui/chat-panel.js';
import { cardPanel, FIELD_STATUS } from '../ui/card-panel.js';
import { contextBuilder } from '../core/context-builder.js';
import { buildBaseSystemPrompt } from '../prompts/base.js';
import { CCSApiError, apiManager } from '../core/api.js';

import {
    buildFieldGenerationPrompt,
    GENERATE_ALL_FIELDS_PROMPT,
    BATCH_OPERATION_PROMPT,
    REWRITE_INSTRUCTIONS,
    MES_EXAMPLE_WARNING,
    FIELD_SPECIFIC_INSTRUCTIONS,
} from '../prompts/generation.js';

import {
    extractCodeBlock,
    parseMultiFieldResponse,
    detectFieldFromMessage,
    isBatchGreetingOp,
    isGenerateAllRequest,
} from '../core/parser.js';

const GENERATABLE_FIELDS = ['description','personality','scenario','first_mes','mes_example','system_prompt','creator_notes'];

export class GenerationPhase {
    constructor() {
        this.session = null;
        this.cardFields = null;
        this.callbacks = {};
        this.queue = [];
        this._isProcessingQueue = false;
    }

    start(session, cardFields, callbacks = {}) {
        this.session = session;
        this.cardFields = cardFields;
        this.callbacks = callbacks;
    }

    async handleMessage(message) {
        // Detect field-specific intent
        const field = detectFieldFromMessage(message);

        // Check for batch operations using actual parser functions
        if (isGenerateAllRequest(message)) {
            await this.generateAllFields();
            return;
        }
        if (isBatchGreetingOp(message)) {
            const countMatch = message.match(/(\d+)/);
            await this._handleBatchGreetings(countMatch ? parseInt(countMatch[1]) : 3);
            return;
        }
        if (field && /generat|write|create|make/i.test(message)) {
            await this.generateField(field);
            return;
        }
        if (field && /variation|option|alternative|version/i.test(message)) {
            await this.generateVariations(field);
            return;
        }
        if (field && /rewrite|shorten|lengthen|darker|specific|elevate|fix/i.test(message)) {
            const action = this._detectRewriteAction(message);
            if (action) { await this.rewriteField(field, action); return; }
        }
        // General chat about the card
        await this._generalChat(message);
    }

    // ── Single field generation ─────────────────────────────────────────────

    async generateField(fieldName) {
        const detailLevel = document.getElementById('ccs-detail-level')?.value || 'standard';
        const genPrompt = buildFieldGenerationPrompt(fieldName, this.cardFields, this.session.ideaMemory, detailLevel);

        cardPanel.setFieldStatus(fieldName, FIELD_STATUS.IN_PROGRESS);
        chatPanel.startStreaming();
        chatPanel.setInputEnabled(false);

        try {
            await chatEngine.chat({
                userMessage: `Generate the ${fieldName} field.`,
                session: this.session,
                cardFields: this.cardFields,
                extraInstruction: genPrompt,
                onComplete: (response) => {
                    chatPanel.finalizeStream(response);
                    this._processGeneratedField(fieldName, response);
                },
                onError: (err) => {
                    chatPanel.cancelStreaming();
                    cardPanel.setFieldStatus(fieldName, FIELD_STATUS.EMPTY);
                    this._showError(err, `Failed to generate ${fieldName}`);
                },
            });
        } catch (err) {
            chatPanel.cancelStreaming();
            cardPanel.setFieldStatus(fieldName, FIELD_STATUS.EMPTY);
            this._showError(err, `Failed to generate ${fieldName}`);
        } finally {
            chatPanel.setInputEnabled(true);
        }
    }

    // ── Variations — 3 alternatives ─────────────────────────────────────────

    async generateVariations(fieldName) {
        const detailLevel = document.getElementById('ccs-detail-level')?.value || 'standard';
        const settings = memoryManager.getGlobalSettings();
        const systemPrompt = buildBaseSystemPrompt(settings.customSystemPromptRules);
        const fieldInstruction = FIELD_SPECIFIC_INSTRUCTIONS[fieldName] || '';

        chatPanel.addSystemMessage(`🎲 Generating 3 variations for ${fieldName}...`, 'info');
        chatPanel.setInputEnabled(false);

        const requests = ['A', 'B', 'C'].map(label => ({
            systemPrompt,
            userPrompt: `${fieldInstruction}\n\nGenerate variation ${label} for the "${fieldName}" field. Take a different creative angle than the others. Put content in a triple-backtick code block.\n\nConcept: ${this.session.ideaMemory?.conceptName || 'the character'}\nDetail level: ${detailLevel}`,
        }));

        try {
            const results = await chatEngine.generateParallel(requests);

            results.forEach((text, i) => {
                const content = extractCodeBlock(text) || text;
                const label = ['Variation A', 'Variation B', 'Variation C'][i];
                chatPanel.addVariation(fieldName, label, content, (f, c) => this._acceptField(f, c));
            });
        } catch (err) {
            this._showError(err, `Failed to generate variations for ${fieldName}`);
        } finally {
            chatPanel.setInputEnabled(true);
        }
    }

    // ── Rewrite field ──────────────────────────────────────────────────────

    async rewriteField(fieldName, action) {
        const currentContent = this.cardFields[fieldName];
        if (!currentContent) {
            chatPanel.addSystemMessage(`No content in ${fieldName} to rewrite.`, 'warning');
            return;
        }
        const instruction = REWRITE_INSTRUCTIONS[action];
        if (!instruction) return;

        cardPanel.setFieldStatus(fieldName, FIELD_STATUS.IN_PROGRESS);
        chatPanel.startStreaming();
        chatPanel.setInputEnabled(false);

        try {
            await chatEngine.chat({
                userMessage: `Rewrite ${fieldName}: ${instruction}`,
                session: this.session,
                cardFields: this.cardFields,
                extraInstruction: `${instruction}\n\nCurrent content to rewrite:\n\`\`\`\n${currentContent}\n\`\`\`\n\nPut the rewritten version in a code block.`,
                onComplete: (response) => {
                    chatPanel.finalizeStream(response);
                    this._processGeneratedField(fieldName, response);
                },
                onError: (err) => {
                    chatPanel.cancelStreaming();
                    cardPanel.setFieldStatus(fieldName, FIELD_STATUS.ACCEPTED); // restore to accepted
                    this._showError(err, `Failed to rewrite ${fieldName}`);
                },
            });
        } catch (err) {
            chatPanel.cancelStreaming();
            cardPanel.setFieldStatus(fieldName, FIELD_STATUS.ACCEPTED);
            this._showError(err, `Failed to rewrite ${fieldName}`);
        } finally {
            chatPanel.setInputEnabled(true);
        }
    }

    // ── Generate all fields at once ─────────────────────────────────────────

    async generateAllFields() {
        chatPanel.addSystemMessage('⚡ Generating all card fields...', 'info');
        chatPanel.startStreaming();
        chatPanel.setInputEnabled(false);

        GENERATABLE_FIELDS.forEach(f => cardPanel.setFieldStatus(f, FIELD_STATUS.IN_PROGRESS));

        try {
            await chatEngine.chat({
                userMessage: 'Generate all card fields now.',
                session: this.session,
                cardFields: this.cardFields,
                extraInstruction: GENERATE_ALL_FIELDS_PROMPT,
                onComplete: (response) => {
                    chatPanel.finalizeStream(response);
                    this._processMultiFieldResponse(response);
                },
                onError: (err) => {
                    chatPanel.cancelStreaming();
                    GENERATABLE_FIELDS.forEach(f => cardPanel.setFieldStatus(f, FIELD_STATUS.EMPTY));
                    this._showError(err, 'Failed to generate all fields');
                },
            });
        } catch (err) {
            chatPanel.cancelStreaming();
            GENERATABLE_FIELDS.forEach(f => cardPanel.setFieldStatus(f, FIELD_STATUS.EMPTY));
            this._showError(err, 'Failed to generate all fields');
        } finally {
            chatPanel.setInputEnabled(true);
        }
    }

    // ── Batch operations (alternate greetings) ──────────────────────────────

    async _handleBatchOperation(message, batchInfo) {
        if (batchInfo.type === 'alternate_greetings') {
            await this._handleBatchGreetings(batchInfo.count || 3);
            return;
        }
        // General batch via chat
        chatPanel.startStreaming();
        chatPanel.setInputEnabled(false);

        try {
            await chatEngine.chat({
                userMessage: message,
                session: this.session,
                cardFields: this.cardFields,
                extraInstruction: BATCH_OPERATION_PROMPT,
                onComplete: (response) => {
                    chatPanel.finalizeStream(response);
                },
                onError: (err) => {
                    chatPanel.cancelStreaming();
                    this._showError(err, 'Batch operation failed');
                },
            });
        } catch (err) {
            chatPanel.cancelStreaming();
            this._showError(err, 'Batch operation failed');
        } finally {
            chatPanel.setInputEnabled(true);
        }
    }

    async _handleBatchGreetings(count) {
        const settings = memoryManager.getGlobalSettings();
        const systemPrompt = buildBaseSystemPrompt(settings.customSystemPromptRules);
        const fieldInstruction = FIELD_SPECIFIC_INSTRUCTIONS['alternate_greeting'] || '';

        chatPanel.addSystemMessage(`⚡ Generating ${count} alternate greetings...`, 'info');
        chatPanel.setInputEnabled(false);

        const requests = Array.from({ length: count }, (_, i) => ({
            systemPrompt,
            userPrompt: `${fieldInstruction}\n\nGenerate alternate greeting #${i + 1} of ${count} for this character. Each should offer a meaningfully different starting point.\n\nConcept: ${this.session.ideaMemory?.conceptName || 'the character'}\n\nPut the greeting in a triple-backtick code block.`,
        }));

        try {
            const results = await chatEngine.generateParallel(requests);

            results.forEach((text, i) => {
                const content = extractCodeBlock(text) || text;
                chatPanel.addAcceptBar(`alternate_greeting_${i + 1}`, content, (f, c) => {
                    this._acceptAlternateGreeting(c);
                });
            });
        } catch (err) {
            this._showError(err, 'Failed to generate alternate greetings');
        } finally {
            chatPanel.setInputEnabled(true);
        }
    }

    // ── Queue processing ────────────────────────────────────────────────────

    async addToQueue(fieldName) {
        this.queue.push(fieldName);
        if (!this._isProcessingQueue) {
            await this._processQueue();
        }
    }

    async _processQueue() {
        this._isProcessingQueue = true;
        while (this.queue.length) {
            const field = this.queue.shift();
            try {
                await this.generateField(field);
            } catch (err) {
                // If rate limited or balance error, stop the entire queue
                if (err instanceof CCSApiError && (err.errorType === 'rate_limit' || err.errorType === 'balance')) {
                    chatPanel.addSystemMessage(`⏹ Queue stopped: ${err.userMessage}`, 'error');
                    this.queue = [];
                    break;
                }
            }
        }
        this._isProcessingQueue = false;
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
                    // Check if response contains a field suggestion
                    const field = detectFieldFromMessage(response);
                    if (field) {
                        const content = extractCodeBlock(response);
                        if (content) {
                            chatPanel.addAcceptBar(field, content, (f, c) => this._acceptField(f, c));
                        }
                    }
                },
                onError: (err) => {
                    chatPanel.cancelStreaming();
                    this._showError(err, 'Chat failed');
                },
            });
        } catch (err) {
            chatPanel.cancelStreaming();
            this._showError(err, 'Chat failed');
        } finally {
            chatPanel.setInputEnabled(true);
        }
    }

    // ── Process generated field content ──────────────────────────────────────

    _processGeneratedField(fieldName, response) {
        const content = extractCodeBlock(response);
        if (content) {
            cardPanel.setFieldStatus(fieldName, FIELD_STATUS.GENERATED);
            chatPanel.addAcceptBar(fieldName, content, (f, c) => this._acceptField(f, c));
        } else {
            cardPanel.setFieldStatus(fieldName, FIELD_STATUS.EMPTY);
        }
    }

    _processMultiFieldResponse(response) {
        const fields = parseMultiFieldResponse(response);
        for (const [fieldName, content] of Object.entries(fields)) {
            if (content && GENERATABLE_FIELDS.includes(fieldName)) {
                cardPanel.setFieldStatus(fieldName, FIELD_STATUS.GENERATED);
                chatPanel.addAcceptBar(fieldName, content, (f, c) => this._acceptField(f, c));
            }
        }
    }

    // ── Accept field — write to card ─────────────────────────────────────────

    async _acceptField(fieldName, content) {
        try {
            // Validate macros
            const macroIssues = cardManager.validateMacros(fieldName, content);
            if (macroIssues.length) {
                chatPanel.addSystemMessage(`⚠️ ${fieldName}: ${macroIssues.join(', ')}`, 'warning');
            }

            // mes_example format check
            if (fieldName === 'mes_example') {
                content = cardManager.fixMesExampleFormat(content);
            }

            // Write to card
            await cardManager.writeField(fieldName, content);
            this.cardFields[fieldName] = content;
            cardPanel.setFieldStatus(fieldName, FIELD_STATUS.ACCEPTED);
            this.callbacks.onCardUpdated?.();

            // Save version (generate summary in background)
            chatEngine.generateUtility(
                'Summarize the change in one sentence under 15 words.',
                `Field "${fieldName}" content:\n${content.substring(0, 300)}`
            ).then(summary => {
                memoryManager.saveFieldVersion(this.session, fieldName, content, summary || '');
            }).catch(() => {
                memoryManager.saveFieldVersion(this.session, fieldName, content, '');
            });

            // Conflict check (async, non-blocking)
            auditEngine.checkConflictOnAccept(this.session, this.cardFields, fieldName, content).then(result => {
                if (result?.conflict) {
                    chatPanel.addSystemMessage(`⚠️ Potential conflict: ${result.details}`, 'warning');
                }
            }).catch(() => {});

        } catch (err) {
            chatPanel.addSystemMessage(`❌ Failed to write ${fieldName}: ${err.message}`, 'error');
        }
    }

    async _acceptAlternateGreeting(content) {
        try {
            const existing = this.cardFields.alternate_greetings || [];
            existing.push(content);
            await cardManager.writeField('alternate_greetings', existing);
            this.cardFields.alternate_greetings = existing;
            cardPanel.setFieldStatus('alternate_greetings', FIELD_STATUS.ACCEPTED);
            this.callbacks.onCardUpdated?.();
            chatPanel.addSystemMessage(`✅ Added alternate greeting #${existing.length}`, 'info');
        } catch (err) {
            chatPanel.addSystemMessage(`❌ Failed to save greeting: ${err.message}`, 'error');
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    _detectRewriteAction(message) {
        const lower = message.toLowerCase();
        for (const [action, _] of Object.entries(REWRITE_INSTRUCTIONS)) {
            if (lower.includes(action)) return action;
        }
        return null;
    }

    // FIX: Centralized error display with proper cleanup
    _showError(err, context) {
        const userMessage = (err instanceof CCSApiError)
            ? err.userMessage
            : `❌ ${context}: ${err?.message || 'Unknown error'}`;
        chatPanel.addSystemMessage(userMessage, 'error');
    }
}

export const generationPhase = new GenerationPhase();
