// phases/generation.js
// v3.0 — Card field generation with skill-router, chain-of-thought, and character simulation
// FIX: try-catch all gen calls, parallel toggle, proper error cleanup

import { chatEngine } from '../core/chat.js';
import { memoryManager } from '../core/memory.js';
import { cardManager } from '../core/card.js';
import { auditEngine } from '../core/audit.js';
import { chatPanel } from '../ui/chat-panel.js';
import { cardPanel, FIELD_STATUS } from '../ui/card-panel.js';
import { skillRouter } from '../core/skill-router.js';
import { CCSApiError } from '../core/api.js';

import {
    DETAIL_LEVELS,
    BATCH_OPERATION_PROMPT,
    MES_EXAMPLE_WARNING,
} from '../prompts/generation.js';

import { intentEngine } from '../core/intent-engine.js';
import { extractCodeBlock, parseMultiFieldResponse } from '../core/parser.js';

const GENERATABLE_FIELDS = ['description','personality','scenario','first_mes','mes_example','system_prompt','creator_notes'];

export class GenerationPhase {
    constructor() {
        this.session = null;
        this.cardFields = null;
        this.callbacks = {};
        this.queue = [];
        this._isProcessingQueue = false;
        this.lastIntent = null;
    }

    start(session, cardFields, callbacks = {}) {
        this.session = session;
        this.cardFields = cardFields;
        this.callbacks = callbacks;
    }

    // ── Build skill-based system prompt ──────────────────────────────────────

    _buildSystemPrompt(field = '', task = '') {
        const settings = memoryManager.getGlobalSettings();
        const idea = this.session?.ideaMemory || {};
        return skillRouter.buildSystemPrompt({
            phase: task === 'simulation' ? 'audit' : 'generation',
            task,
            field,
            cardType: idea.cardType || 'single',
            format: idea.format || 'prose',
            nsfw: this._detectNSFW(),
            customRules: settings.customSystemPromptRules,
        });
    }

    _detectNSFW() {
        const idea = this.session?.ideaMemory || {};
        // Check pillars and key decisions for NSFW indicators
        const allText = [
            ...(idea.pillars || []).map(p => p.answer || ''),
            ...(idea.keyDecisions || []).map(d => d.decision || ''),
        ].join(' ').toLowerCase();
        return /nsfw|adult|explicit|sexual|mature|erotic/i.test(allText);
    }

    async handleMessage(message) {
        // Detect follow-ups
        const isFollowUp = /^(yes|ok|do it|that one|sure|go ahead|confirm|perfect)$/i.test(message.trim());
        if (isFollowUp && this.lastIntent && (Date.now() - this.lastIntent.timestamp < 120_000)) {
            await this._executeIntent(this.lastIntent);
            return;
        }

        const intent = intentEngine.detect(message, this.session, 'generation');
        this.lastIntent = { ...intent, timestamp: Date.now(), originalMessage: message };
        await this._executeIntent(this.lastIntent);
    }

    async _executeIntent(intent) {
        if (intent.type === 'simulation') {
            await this._characterSimulation('Test drive character');
            return;
        }
        if (intent.type === 'generate_all') {
            await this.generateAllFields();
            return;
        }
        if (intent.type === 'batch_greetings') {
            await this._handleBatchGreetings(3);
            return;
        }
        if (intent.type === 'generate_field' && intent.target) {
            await this.generateField(intent.target);
            return;
        }
        if (intent.type === 'rewrite_field' && intent.target && intent.meta.action) {
            await this.rewriteField(intent.target, intent.meta.action);
            return;
        }
        if (intent.type === 'rewrite_field' && intent.target) {
             // Fallback if no specific action was detected
             await this.rewriteField(intent.target, 'rewrite');
             return;
        }
        if (intent.type === 'generate_variations' && intent.target) {
             await this.generateVariations(intent.target);
             return;
        }
        
        // Phase switch is handled by popup.js via callbacks, but if we get it here we can just chat
        await this._generalChat(this.lastIntent?.originalMessage || 'continue');
    }

    // ── Single field generation ─────────────────────────────────────────────

    async generateField(fieldName) {
        const detailLevel = document.getElementById('ccs-detail-level')?.value || 'standard';
        const tokens = DETAIL_LEVELS[detailLevel]?.[fieldName] || '300-500t';
        const fieldInstruction = skillRouter.getFieldInstruction(fieldName);

        const genPrompt = `Generate the **${fieldName}** field for this character card.

${fieldInstruction}

Target length: ${tokens}

Put the COMPLETE generated content inside a triple-backtick code block. After the block, add a brief note on key choices made.

If you have ONE critical question that would significantly change output, ask it first. Otherwise, generate now based on the ideation decisions.`;

        cardPanel.setFieldStatus(fieldName, FIELD_STATUS.IN_PROGRESS);
        chatPanel.startStreaming();
        chatPanel.setInputEnabled(false);

        try {
            await chatEngine.chat({
                userMessage: `Generate the ${fieldName} field.`,
                session: this.session,
                cardFields: this.cardFields,
                extraInstruction: genPrompt,
                skillOptions: {
                    phase: 'generation',
                    field: fieldName,
                    cardType: this.session?.ideaMemory?.cardType || 'single',
                    format: this.session?.ideaMemory?.format || 'prose',
                    nsfw: this._detectNSFW(),
                },
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
        const systemPrompt = this._buildSystemPrompt(fieldName);
        const fieldInstruction = skillRouter.getFieldInstruction(fieldName);

        chatPanel.addSystemMessage(`🎲 Generating 3 variations for ${fieldName}...`, 'info');
        chatPanel.setInputEnabled(false);

        const requests = ['A', 'B', 'C'].map(label => ({
            systemPrompt,
            userPrompt: `${fieldInstruction}\n\nGenerate variation ${label} for the "${fieldName}" field. Take a different creative angle than the others. Put content in a triple-backtick code block.\n\nConcept: ${this.session?.ideaMemory?.conceptName || 'the character'}\nDetail level: ${detailLevel}`,
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
        const instruction = skillRouter.getRewriteInstruction(action);
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
                skillOptions: {
                    phase: 'generation',
                    field: fieldName,
                    cardType: this.session?.ideaMemory?.cardType || 'single',
                    format: this.session?.ideaMemory?.format || 'prose',
                },
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
        // Fallback: If session wasn't explicitly started (e.g., clicked from Ideation phase),
        // try to fetch it from the globally injected studioPopup session
        if (!this.session) {
            const popupSession = document.getElementById('ccs-studio') ? window.__ccs_popup_session : null;
            if (popupSession) this.session = popupSession;
            else {
                toastManager?.show('Session not ready. Please select a character.', 'warn');
                return;
            }
        }
        
        chatPanel.addSystemMessage('⚡ Generating all card fields...', 'info');
        chatPanel.startStreaming();
        chatPanel.setInputEnabled(false);

        // Store previous statuses to restore on failure
        const prevStatuses = {};
        GENERATABLE_FIELDS.forEach(f => {
            prevStatuses[f] = cardPanel.fieldStatuses[f];
            cardPanel.setFieldStatus(f, FIELD_STATUS.IN_PROGRESS);
        });

        const generateAllPrompt = skillRouter.getGenerateAllPrompt();

        try {
            await chatEngine.chat({
                userMessage: 'Generate all card fields now.',
                session: this.session,
                cardFields: this.cardFields,
                extraInstruction: generateAllPrompt,
                skillOptions: {
                    phase: 'generation',
                    field: 'description', // Load description-level skills (most comprehensive)
                    cardType: this.session?.ideaMemory?.cardType || 'single',
                    format: this.session?.ideaMemory?.format || 'prose',
                    nsfw: this._detectNSFW(),
                },
                onComplete: (response) => {
                    chatPanel.finalizeStream(response);
                    this._processMultiFieldResponse(response);
                },
                onError: (err) => {
                    chatPanel.cancelStreaming();
                    GENERATABLE_FIELDS.forEach(f => cardPanel.setFieldStatus(f, prevStatuses[f] || FIELD_STATUS.EMPTY));
                    this._showError(err, 'Failed to generate all fields');
                },
            });
        } catch (err) {
            chatPanel.cancelStreaming();
            GENERATABLE_FIELDS.forEach(f => cardPanel.setFieldStatus(f, prevStatuses[f] || FIELD_STATUS.EMPTY));
            this._showError(err, 'Failed to generate all fields');
        } finally {
            chatPanel.setInputEnabled(true);
        }
    }

    // ── v3.0: Character Simulation / Test Drive ─────────────────────────────

    async _characterSimulation(userMessage) {
        const systemPrompt = this._buildSystemPrompt('', 'simulation');
        const taskPrompt = skillRouter.getAuditPrompt('simulation');

        // Build full card state for simulation
        const cardSummary = Object.entries(this.cardFields || {})
            .filter(([k, v]) => typeof v === 'string' && v.trim())
            .map(([k, v]) => `### ${k}\n${v}`)
            .join('\n\n');

        memoryManager.addMessage(this.session, 'user', userMessage);

        chatPanel.addSystemMessage('🎭 Starting character test drive...', 'info');
        chatPanel.startStreaming();
        chatPanel.setInputEnabled(false);

        try {
            const response = await chatEngine.generateBackground(
                systemPrompt,
                `${taskPrompt}\n\n---\nFull Card Content:\n${cardSummary}\n\n---\nUser request: ${userMessage}`
            );

            chatPanel.finalizeStream(response);
            memoryManager.addMessage(this.session, 'assistant', response);
        } catch (err) {
            chatPanel.cancelStreaming();
            this._showError(err, 'Character simulation failed');
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
        const systemPrompt = this._buildSystemPrompt('alternate_greeting');
        const fieldInstruction = skillRouter.getFieldInstruction('alternate_greeting');

        chatPanel.addSystemMessage(`⚡ Generating ${count} alternate greetings...`, 'info');
        chatPanel.setInputEnabled(false);

        const requests = Array.from({ length: count }, (_, i) => ({
            systemPrompt,
            userPrompt: `${fieldInstruction}\n\nGenerate alternate greeting #${i + 1} of ${count} for this character. Each should offer a meaningfully different starting point.\n\nConcept: ${this.session?.ideaMemory?.conceptName || 'the character'}\n\nPut the greeting in a triple-backtick code block.`,
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
                // If any API error occurs, stop the entire queue to prevent spam and memory leaks
                if (err instanceof CCSApiError) {
                    chatPanel.addSystemMessage(`⏹ Queue stopped: ${err.userMessage || err.message}`, 'error');
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
                skillOptions: {
                    phase: 'generation',
                    task: 'general_chat',
                    cardType: this.session?.ideaMemory?.cardType || 'single',
                    format: this.session?.ideaMemory?.format || 'prose',
                },
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
        let parsed = 0;
        for (const [fieldName, content] of Object.entries(fields)) {
            if (content && GENERATABLE_FIELDS.includes(fieldName)) {
                cardPanel.setFieldStatus(fieldName, FIELD_STATUS.GENERATED);
                // BUG-020 FIX: Update the progress ring for each parsed field so the
                // ring animates incrementally during the generate-all response.
                // setFieldStatus already triggers _updateFieldRow + _updateTokenBudget.
                chatPanel.addAcceptBar(fieldName, content, (f, c) => this._acceptField(f, c));
                parsed++;
            }
        }
        if (!parsed) {
            chatPanel.addSystemMessage('⚠️ No field blocks found in response. Try asking for individual fields.', 'warning');
            GENERATABLE_FIELDS.forEach(f => cardPanel.setFieldStatus(f, FIELD_STATUS.EMPTY));
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
            // BUG-014 FIX: Refresh the field row and token budget immediately after write
            cardPanel._updateFieldRow(fieldName);
            cardPanel._updateTokenBudget();
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
                if (result && typeof result === 'string') {
                    chatPanel.addSystemMessage(`⚠️ Potential conflict: ${result}`, 'warning');
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
        const actions = ['shorten', 'lengthen', 'darker', 'specific', 'fixformat', 'elevate', 'voice'];
        for (const action of actions) {
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
