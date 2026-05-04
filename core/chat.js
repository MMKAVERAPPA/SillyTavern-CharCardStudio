// core/chat.js
// AI generation engine — wraps apiManager, handles history, compression

import { memoryManager } from './memory.js';
import { apiManager } from './api.js';
import { contextBuilder } from './context-builder.js';
import { buildBaseSystemPrompt } from '../prompts/base.js';
import { COMPRESSOR_PROMPT } from '../prompts/compressor.js';

export class ChatEngine {
    constructor() {
        this.isGenerating = false;
        this.abortController = null;
    }

    // ── Main conversational chat ────────────────────────────────────────────

    async chat(options) {
        const { userMessage, session, cardFields, onComplete, extraInstruction } = options;
        const settings = memoryManager.getGlobalSettings();

        // Add user turn to history
        const needsCompression = memoryManager.addMessage(session, 'user', userMessage);

        // Build full context
        const baseSystemPrompt = buildBaseSystemPrompt(settings.customSystemPromptRules);
        const { systemPrompt, prompt } = contextBuilder.buildContext({
            session,
            cardFields,
            baseSystemPrompt,
            extraInstruction,
        });

        this.isGenerating = true;
        this.abortController = new AbortController();

        try {
            const result = await apiManager.generatePrimary(
                systemPrompt,
                prompt,
                this.abortController.signal
            );

            const fullResponse = result || '';
            memoryManager.addMessage(session, 'assistant', fullResponse);

            if (needsCompression) {
                this._compressSession(session, cardFields).catch(err =>
                    console.warn('[CCS] Background compression failed:', err)
                );
            }

            onComplete && onComplete(fullResponse);
            return fullResponse;
        } catch (err) {
            if (err.name === 'AbortError') {
                console.log('[CCS] Generation aborted by user');
                return null;
            }
            console.error('[CCS] Generation error:', err);
            throw err;
        } finally {
            this.isGenerating = false;
        }
    }

    // ── Background (no history) generation — PRIMARY ─────────────────────

    async generateBackground(systemPrompt, userPrompt) {
        try {
            return await apiManager.generatePrimary(systemPrompt, userPrompt, null);
        } catch (err) {
            console.error('[CCS] Background generation error:', err);
            throw err;
        }
    }

    // ── Background generation — UTILITY tier (fast/cheap) ────────────────

    async generateUtility(systemPrompt, userPrompt) {
        try {
            return await apiManager.generateUtility(systemPrompt, userPrompt);
        } catch (err) {
            console.warn('[CCS] Utility generation failed:', err);
            return null;
        }
    }

    // ── Parallel generation ───────────────────────────────────────────────

    async generateParallel(requests) {
        return apiManager.generateParallel(requests);
    }

    // ── Abort ─────────────────────────────────────────────────────────────

    abort() {
        if (this.abortController) {
            this.abortController.abort();
            this.isGenerating = false;
        }
    }

    // ── Session compression ───────────────────────────────────────────────

    async _compressSession(session) {
        try {
            const allMessages = [
                ...session.sessionBriefs.map(b => `[Previous Summary]: ${b.brief}`),
                ...session.conversationHistory.map(m =>
                    `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
                ),
            ].join('\n\n');

            const brief = await this.generateUtility(
                COMPRESSOR_PROMPT,
                `Compress this character creation session:\n\n${allMessages}`
            );

            if (brief && brief.trim().length > 50) {
                memoryManager.compressOldMessages(session, brief.trim());
                console.log('[CCS] Session compressed');
            }
        } catch (err) {
            console.error('[CCS] Compression failed:', err);
        }
    }
}

export const chatEngine = new ChatEngine();
