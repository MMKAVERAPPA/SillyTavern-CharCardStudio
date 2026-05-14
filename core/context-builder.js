// core/context-builder.js
// v3.0 — Smart context sizing with field dependency graph
// Assembles system prompt + conversation prompt for every AI call

import { memoryManager } from './memory.js';
import { skillRouter } from './skill-router.js';
import { characterSeed } from './character-seed.js';

export class ContextBuilder {

    /**
     * Build context for a conversational chat turn.
     * Returns { systemPrompt, prompt } where prompt is the full message history.
     */
    buildContext({ session, cardFields, baseSystemPrompt, extraInstruction = '', phase = null }) {
        let systemPrompt = baseSystemPrompt || '';

        // Tone/voice profile
        const toneProfile = memoryManager.getToneProfilePrompt();
        if (toneProfile) systemPrompt += '\n\n' + toneProfile;

        // Platform target
        const platformHint = memoryManager.getPlatformPrompt();
        if (platformHint) systemPrompt += '\n\n' + platformHint;

        // Idea memory (includes card type, format, voice profile, psych profile)
        if (session) {
            if (phase === 'generation' || phase === 'lorebook') {
                const seedStr = characterSeed.buildSeed(session);
                if (seedStr) systemPrompt += '\n\n' + seedStr;
            } else {
                const ideaSummary = memoryManager.buildIdeaMemorySummary(session);
                if (ideaSummary) systemPrompt += '\n\n' + ideaSummary;
            }
        }

        // Card state — use smart sizing if a field is being generated
        const targetField = this._extractTargetField(extraInstruction);
        const cardState = this._buildCardState(cardFields, session, targetField);
        if (cardState) systemPrompt += '\n\n' + cardState;

        // Lorebook index
        if (session) {
            const lbIndex = memoryManager.buildLorebookIndex(session, phase);
            if (lbIndex) systemPrompt += '\n\n' + lbIndex;
        }

        // Extra per-call instruction
        if (extraInstruction) {
            systemPrompt += '\n\n[CURRENT_TASK]\n' + extraInstruction + '\n[/CURRENT_TASK]';
        }

        // ── Build prompt from conversation history ──────────────────────
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
        const cardState = this._buildCardState(cardFields, session, null);
        if (cardState) systemPrompt += '\n\n' + cardState;
        if (session) {
            const lbIndex = memoryManager.buildLorebookIndex(session);
            if (lbIndex) systemPrompt += '\n\n' + lbIndex;
            const ideaSummary = memoryManager.buildIdeaMemorySummary(session);
            if (ideaSummary) systemPrompt += '\n\n' + ideaSummary;
        }
        return { systemPrompt, prompt: '' };
    }

    /**
     * Build card state with smart context sizing.
     * When generating a specific field, its dependencies get FULL content,
     * while other fields get short previews.
     */
    _buildCardState(cardFields, session, targetField) {
        if (!cardFields) return '';
        const fieldLog = session?.fieldLog || {};

        // Get dependencies for the target field (if generating)
        const fullContentFields = targetField
            ? skillRouter.getFieldDependencies(targetField)
            : [];

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

                // Smart sizing: full content for dependencies, preview for others
                const showFull = fullContentFields.includes(field);
                let preview;

                if (typeof value === 'string') {
                    if (showFull) {
                        // Full content for dependency fields (max 2000 chars to prevent extreme cases)
                        preview = value.length > 2000
                            ? value.substring(0, 2000) + '... [truncated at 2000 chars]'
                            : value;
                    } else {
                        // Short preview for non-dependency fields
                        const previewLen = field === 'description' ? 400 : 200;
                        preview = value.length > previewLen
                            ? value.substring(0, previewLen) + '... [truncated]'
                            : value;
                    }
                } else {
                    preview = JSON.stringify(value).substring(0, 200);
                }

                state += `[FIELD: ${field}] ${label}\n${preview}\n[/FIELD]\n\n`;
            } else {
                if (fullContentFields.includes(field)) {
                    state += `[FIELD: ${field}] 🔲 NOT YET GENERATED — do not reference or invent details\n\n`;
                } else {
                    state += `[FIELD: ${field}] 🔲 EMPTY\n\n`;
                }
            }
        }

        const greetings = cardFields.alternate_greetings || [];
        if (greetings.length) {
            state += `[FIELD: alternate_greetings] ✅ ${greetings.length} greeting(s)\n`;
            greetings.forEach((g, i) => {
                const showFull = fullContentFields.includes('alternate_greeting');
                const len = showFull ? 300 : 80;
                state += `  [${i}]: ${g.substring(0, len)}${g.length > len ? '...' : ''}\n`;
            });
            state += '\n';
        } else {
            state += '[FIELD: alternate_greetings] 🔲 EMPTY\n\n';
        }

        state += '[/CARD_STATE]';
        return state;
    }

    /**
     * Try to extract target field name from the extra instruction text.
     * Used for smart context sizing.
     */
    _extractTargetField(instruction) {
        if (!instruction) return null;
        const match = instruction.match(/Generating:\s*(\w+)/i)
            || instruction.match(/Generate the \*\*(\w+)\*\*/i)
            || instruction.match(/field[:\s]*["']?(\w+)["']?/i);
        return match ? match[1].toLowerCase() : null;
    }
}

export const contextBuilder = new ContextBuilder();
