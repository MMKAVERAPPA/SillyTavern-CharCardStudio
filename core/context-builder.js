// core/context-builder.js
// Assembles system prompt + conversation prompt for every AI call

import { memoryManager } from './memory.js';

export class ContextBuilder {

    /**
     * Build context for a conversational chat turn.
     * Returns { systemPrompt, prompt } where prompt is the full message history
     * formatted as a single string for generateRaw.
     */
    buildContext({ session, cardFields, baseSystemPrompt, extraInstruction = '' }) {
        let systemPrompt = baseSystemPrompt || '';

        // Tone/voice profile
        const toneProfile = memoryManager.getToneProfilePrompt();
        if (toneProfile) systemPrompt += '\n\n' + toneProfile;

        // Platform target
        const platformHint = memoryManager.getPlatformPrompt();
        if (platformHint) systemPrompt += '\n\n' + platformHint;

        // Idea memory
        if (session) {
            const ideaSummary = memoryManager.buildIdeaMemorySummary(session);
            if (ideaSummary) systemPrompt += '\n\n' + ideaSummary;
        }

        // Card state
        const cardState = this._buildCardState(cardFields, session);
        if (cardState) systemPrompt += '\n\n' + cardState;

        // Lorebook index
        if (session) {
            const lbIndex = memoryManager.buildLorebookIndex(session);
            if (lbIndex) systemPrompt += '\n\n' + lbIndex;
        }

        // Extra per-call instruction
        if (extraInstruction) {
            systemPrompt += '\n\n[CURRENT_TASK]\n' + extraInstruction + '\n[/CURRENT_TASK]';
        }

        // ── Build prompt from conversation history ──────────────────────────
        const parts = [];

        // Session briefs
        if (session) {
            const briefs = memoryManager.buildSessionBriefs(session);
            if (briefs) parts.push(briefs);
        }

        // Conversation history — format as dialogue for generateRaw
        if (session?.conversationHistory?.length) {
            for (const msg of session.conversationHistory) {
                const prefix = msg.role === 'user' ? 'User' : 'Assistant';
                parts.push(`${prefix}: ${msg.content}`);
            }
        }

        const prompt = parts.join('\n\n') || '';

        return { systemPrompt, prompt };
    }

    /**
     * Build a minimal background context (no conversation history).
     * Used for audit, compression, conflict detection.
     */
    buildBackgroundContext({ session, cardFields, baseSystemPrompt }) {
        let systemPrompt = baseSystemPrompt || '';
        const cardState = this._buildCardState(cardFields, session);
        if (cardState) systemPrompt += '\n\n' + cardState;
        if (session) {
            const lbIndex = memoryManager.buildLorebookIndex(session);
            if (lbIndex) systemPrompt += '\n\n' + lbIndex;
            const ideaSummary = memoryManager.buildIdeaMemorySummary(session);
            if (ideaSummary) systemPrompt += '\n\n' + ideaSummary;
        }
        return { systemPrompt, prompt: '' };
    }

    _buildCardState(cardFields, session) {
        if (!cardFields) return '';
        const fieldLog = session?.fieldLog || {};

        let state = '[CARD_STATE — Character card currently being built]\n';
        state += '[STUDIO_NOTE: You are the author/collaborator. Do NOT roleplay as the character.]\n\n';

        const fields = ['name','description','personality','scenario',
                        'first_mes','mes_example','system_prompt',
                        'post_history_instructions','creator_notes','tags'];

        for (const field of fields) {
            const value = cardFields[field];
            const accepted = fieldLog[field]?.acceptedAt != null;
            const hasContent = Array.isArray(value)
                ? value.length > 0
                : (typeof value === 'string' && value.trim().length > 0);

            if (hasContent) {
                const label = accepted ? '✅ ACCEPTED' : '📋 CURRENT';
                const preview = typeof value === 'string'
                    ? (value.length > 200 ? value.substring(0, 200) + '... [truncated]' : value)
                    : JSON.stringify(value).substring(0, 200);
                state += `[FIELD: ${field}] ${label}\n${preview}\n[/FIELD]\n\n`;
            } else {
                state += `[FIELD: ${field}] 🔲 EMPTY\n\n`;
            }
        }

        const greetings = cardFields.alternate_greetings || [];
        if (greetings.length) {
            state += `[FIELD: alternate_greetings] ✅ ${greetings.length} greeting(s)\n`;
            greetings.forEach((g, i) => {
                state += `  [${i}]: ${g.substring(0, 80)}${g.length > 80 ? '...' : ''}\n`;
            });
            state += '\n';
        } else {
            state += '[FIELD: alternate_greetings] 🔲 EMPTY\n\n';
        }

        state += '[/CARD_STATE]';
        return state;
    }
}

export const contextBuilder = new ContextBuilder();
