// core/chat.js
// AI generation engine — wraps apiManager, handles history, compression
// FIX: Proper error cleanup, cancelStreaming support, typed errors

import { memoryManager } from './memory.js';
import { apiManager, CCSApiError, classifyApiError } from './api.js';
import { contextBuilder } from './context-builder.js';
import { buildBaseSystemPrompt } from '../prompts/base.js';
import { COMPRESSOR_PROMPT } from '../prompts/compressor.js';
import { statsManager } from './stats.js';

export class ChatEngine {
    constructor() {
        this.isGenerating = false;
        this.abortController = null;
    }

    // ── Main conversational chat ────────────────────────────────────────────

    async chat(options) {
        const { userMessage, session, cardFields, onComplete, onError, extraInstruction, skillOptions } = options;
        const settings = memoryManager.getGlobalSettings();

        // Add user turn to history
        const needsCompression = memoryManager.addMessage(session, 'user', userMessage);
        statsManager.record('messages');

        // Build full context — use skill-router if skillOptions provided
        const baseSystemPrompt = buildBaseSystemPrompt(
            settings.customSystemPromptRules,
            skillOptions || {}
        );
        const { systemPrompt, prompt } = contextBuilder.buildContext({
            session,
            cardFields,
            baseSystemPrompt,
            extraInstruction,
        });

        this.isGenerating = true;
        this.abortController = new AbortController();

        // Capture payload for the Inspector tool
        session.lastPayload = {
            system: systemPrompt,
            messages: prompt,
            generationOptions: { model: settings.primaryModel || 'default' }
        };

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
            // Classify the error
            const classified = (err instanceof CCSApiError) ? err : classifyApiError(err, 'Chat');

            if (classified.errorType === 'aborted') {
                console.log('[CCS] Generation aborted by user');
                return null;
            }

            console.error('[CCS] Generation error:', classified.userMessage);
            // Notify caller about the error
            onError && onError(classified);
            throw classified;
        } finally {
            this.isGenerating = false;
            this.abortController = null;
        }
    }

    // ── Background (no history) generation — PRIMARY ─────────────────────
    // BUG-5 FIX: Now uses abortController so abort button can cancel these calls too

    async generateBackground(systemPrompt, userPrompt) {
        this.abortController = new AbortController();
        this.isGenerating = true;
        try {
            return await apiManager.generatePrimary(systemPrompt, userPrompt, this.abortController.signal);
        } catch (err) {
            const classified = (err instanceof CCSApiError) ? err : classifyApiError(err, 'Background generation');
            if (classified.errorType === 'aborted') return null;
            console.error('[CCS] Background generation error:', classified.userMessage);
            throw classified;
        } finally {
            this.isGenerating = false;
            this.abortController = null;
        }
    }

    // ── BUG-6 FIX: Context-aware generation — sends conversation history ──────
    // Use this for ALL ideation calls instead of generateBackground so the AI
    // has memory of previous messages in the same session.

    async generateWithContext(session, cardFields, systemPrompt, userPrompt, skillOptions = {}) {
        const settings = memoryManager.getGlobalSettings();

        // Build full context with conversation history
        const baseSystemPrompt = buildBaseSystemPrompt(
            settings.customSystemPromptRules,
            skillOptions
        );
        const fullSystemPrompt = systemPrompt || baseSystemPrompt;
        const { prompt: historyPrompt } = contextBuilder.buildContext({
            session,
            cardFields,
            baseSystemPrompt: '',      // system already built above
            extraInstruction: userPrompt,
        });

        this.abortController = new AbortController();
        this.isGenerating = true;
        try {
            const result = await apiManager.generatePrimary(
                fullSystemPrompt,
                historyPrompt || userPrompt,
                this.abortController.signal
            );
            return result || '';
        } catch (err) {
            const classified = (err instanceof CCSApiError) ? err : classifyApiError(err, 'Contextual generation');
            if (classified.errorType === 'aborted') return null;
            console.error('[CCS] Contextual generation error:', classified.userMessage);
            throw classified;
        } finally {
            this.isGenerating = false;
            this.abortController = null;
        }
    }

    // ── Background generation — UTILITY tier (fast/cheap) ────────────────

    async generateUtility(systemPrompt, userPrompt) {
        try {
            return await apiManager.generateUtility(systemPrompt, userPrompt);
        } catch (err) {
            const classified = (err instanceof CCSApiError) ? err : classifyApiError(err, 'Utility');
            console.warn('[CCS] Utility generation failed:', classified.userMessage);
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
            this.abortController = null;
        }
        this.isGenerating = false;
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
