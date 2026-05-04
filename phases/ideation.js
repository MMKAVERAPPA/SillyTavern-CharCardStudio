// phases/ideation.js
// Ideation phase: concept pitching, rating, pillar resolution, proposed profile
// FIX: try-catch all gen calls, add missing history entries, proper error cleanup

import { chatEngine } from '../core/chat.js';
import { memoryManager } from '../core/memory.js';
import { contextBuilder } from '../core/context-builder.js';
import { buildBaseSystemPrompt } from '../prompts/base.js';
import { parseConceptRating } from '../core/parser.js';
import { auditEngine } from '../core/audit.js';
import { chatPanel } from '../ui/chat-panel.js';
import { ideaPanel } from '../ui/idea-panel.js';
import { CCSApiError } from '../core/api.js';

import {
    GREETING_PROMPT,
    CONCEPT_RATING_PROMPT,
    GENERATE_IDEAS_PROMPT,
    PILLAR_DISCUSSION_PROMPT,
    PROPOSED_PROFILE_PROMPT,
    LOAD_EXISTING_CARD_PROMPT,
} from '../prompts/ideation.js';

export class IdeationPhase {
    constructor() {
        this.session = null;
        this.cardFields = null;
        this.onComplete = null;
    }

    start(session, cardFields, onComplete) {
        this.session = session;
        this.cardFields = cardFields;
        this.onComplete = onComplete;

        // Only start fresh if no conversation history exists
        if (!session.conversationHistory?.length) {
            this._initialGreeting();
        }
    }

    async handleMessage(message) {
        const idea = this.session.ideaMemory;

        // Route to the right handler based on ideation state
        if (message.toLowerCase().includes('suggest') || message.toLowerCase().includes('ideas')) {
            await this._generateIdeas(message);
            return;
        }
        if (message.toLowerCase().includes('load existing') || message.toLowerCase().includes('improve existing')) {
            await this._loadExistingCard(message);
            return;
        }
        if (!idea.conceptName && !idea.pillars?.length) {
            await this._rateConceptAndSetupPillars(message);
            return;
        }
        if (idea.proposedProfileApproved) {
            this.onComplete?.();
            return;
        }
        if (this._isApproval(message) && idea.proposedProfileGenerated) {
            idea.proposedProfileApproved = true;
            chatPanel.addSystemMessage('✅ Profile approved — moving to card building!', 'info');
            this.onComplete?.();
            return;
        }
        if (this._allPillarsResolved() && !idea.proposedProfileGenerated) {
            await this._offerProposedProfile(message);
            return;
        }
        await this._continueIdeation(message);
    }

    // ── Initial greeting ────────────────────────────────────────────────────

    async _initialGreeting() {
        const settings = memoryManager.getGlobalSettings();
        const systemPrompt = buildBaseSystemPrompt(settings.customSystemPromptRules);

        chatPanel.startStreaming();
        chatPanel.setInputEnabled(false);

        try {
            const response = await chatEngine.generateBackground(
                systemPrompt,
                GREETING_PROMPT
            );

            chatPanel.finalizeStream(response);
            memoryManager.addMessage(this.session, 'assistant', response);
        } catch (err) {
            chatPanel.cancelStreaming();
            this._showError(err, 'Failed to start ideation');
        } finally {
            chatPanel.setInputEnabled(true);
        }
    }

    // ── Concept rating ──────────────────────────────────────────────────────

    async _rateConceptAndSetupPillars(userMessage) {
        const settings = memoryManager.getGlobalSettings();
        const systemPrompt = buildBaseSystemPrompt(settings.customSystemPromptRules);

        // FIX: Add user message to history (was missing before)
        memoryManager.addMessage(this.session, 'user', userMessage);

        chatPanel.startStreaming();
        chatPanel.setInputEnabled(false);

        try {
            const response = await chatEngine.generateBackground(
                systemPrompt,
                `${CONCEPT_RATING_PROMPT}\n\nUser's concept pitch:\n${userMessage}`
            );

            chatPanel.finalizeStream(response);
            memoryManager.addMessage(this.session, 'assistant', response);

            // Parse rating and pillars from response
            const rating = parseConceptRating(response);

            this.session.ideaMemory.conceptRating = rating;
            if (rating?.pillars?.length) {
                this.session.ideaMemory.pillars = rating.pillars;
            }
            // Try to extract concept name from the response
            const nameMatch = response.match(/Concept:\s*"?([^"\n]+)"?/i);
            if (nameMatch) {
                this.session.ideaMemory.conceptName = nameMatch[1].trim();
            } else {
                this.session.ideaMemory.conceptName = userMessage.substring(0, 60);
            }

            ideaPanel.render(this.session.ideaMemory);
        } catch (err) {
            chatPanel.cancelStreaming();
            this._showError(err, 'Failed to rate concept');
        } finally {
            chatPanel.setInputEnabled(true);
        }
    }

    // ── Idea generation ─────────────────────────────────────────────────────

    async _generateIdeas(userMessage) {
        const settings = memoryManager.getGlobalSettings();
        const systemPrompt = buildBaseSystemPrompt(settings.customSystemPromptRules);

        // FIX: Add user message to history (was missing before)
        memoryManager.addMessage(this.session, 'user', userMessage);

        chatPanel.startStreaming();
        chatPanel.setInputEnabled(false);

        try {
            const response = await chatEngine.generateBackground(
                systemPrompt,
                GENERATE_IDEAS_PROMPT
            );

            chatPanel.finalizeStream(response);
            memoryManager.addMessage(this.session, 'assistant', response);
        } catch (err) {
            chatPanel.cancelStreaming();
            this._showError(err, 'Failed to generate ideas');
        } finally {
            chatPanel.setInputEnabled(true);
        }
    }

    // ── Load existing card ──────────────────────────────────────────────────

    async _loadExistingCard(userMessage) {
        const settings = memoryManager.getGlobalSettings();
        const systemPrompt = buildBaseSystemPrompt(settings.customSystemPromptRules);

        // FIX: Add user message to history
        memoryManager.addMessage(this.session, 'user', userMessage);

        chatPanel.startStreaming();
        chatPanel.setInputEnabled(false);

        try {
            const cardSummary = Object.entries(this.cardFields || {})
                .filter(([k, v]) => typeof v === 'string' && v.trim())
                .map(([k, v]) => `### ${k}\n${v.substring(0, 300)}`)
                .join('\n\n');

            const response = await chatEngine.generateBackground(
                systemPrompt,
                `${LOAD_EXISTING_CARD_PROMPT}\n\n---\nExisting card fields:\n${cardSummary}`
            );

            chatPanel.finalizeStream(response);
            memoryManager.addMessage(this.session, 'assistant', response);

            this.session.reviewMode = true;
        } catch (err) {
            chatPanel.cancelStreaming();
            this._showError(err, 'Failed to load card');
        } finally {
            chatPanel.setInputEnabled(true);
        }
    }

    // ── Continue ideation (pillar discussion) ───────────────────────────────

    async _continueIdeation(userMessage) {
        const idea = this.session.ideaMemory;
        const pillarContext = (idea.pillars || []).map(p =>
            `${p.resolved ? '✅' : '□'} ${p.name}${p.resolved ? `: ${p.answer}` : ''}`
        ).join('\n');

        const extraInstruction = `${PILLAR_DISCUSSION_PROMPT}

Current Pillar Status:
${pillarContext || 'No pillars established yet.'}`;

        chatPanel.startStreaming();
        chatPanel.setInputEnabled(false);

        try {
            await chatEngine.chat({
                userMessage,
                session: this.session,
                cardFields: this.cardFields,
                extraInstruction,
                onComplete: (response) => {
                    chatPanel.finalizeStream(response);
                },
                onError: (err) => {
                    chatPanel.cancelStreaming();
                    this._showError(err, 'Ideation failed');
                },
            });

            // Fire async pillar detection (non-blocking, utility tier)
            this._detectAndMarkPillar(userMessage).catch(() => {});
        } catch (err) {
            chatPanel.cancelStreaming();
            this._showError(err, 'Ideation failed');
        } finally {
            chatPanel.setInputEnabled(true);
        }
    }

    // ── Proposed profile ────────────────────────────────────────────────────

    async _offerProposedProfile(userMessage) {
        const settings = memoryManager.getGlobalSettings();
        const systemPrompt = buildBaseSystemPrompt(settings.customSystemPromptRules);

        const idea = this.session.ideaMemory;
        const pillarSummary = (idea.pillars || []).map(p =>
            `- ${p.name}: ${p.answer || 'Not yet decided'}`
        ).join('\n');

        // FIX: Add user message to history
        memoryManager.addMessage(this.session, 'user', userMessage);

        chatPanel.startStreaming();
        chatPanel.setInputEnabled(false);

        try {
            const response = await chatEngine.generateBackground(
                systemPrompt,
                `${PROPOSED_PROFILE_PROMPT}\n\nResolved pillars:\n${pillarSummary}\n\nConcept: ${idea.conceptName || 'Not named'}`
            );

            chatPanel.finalizeStream(response);
            memoryManager.addMessage(this.session, 'assistant', response);

            idea.proposedProfileGenerated = true;
            ideaPanel.render(idea);
        } catch (err) {
            chatPanel.cancelStreaming();
            this._showError(err, 'Failed to generate profile');
        } finally {
            chatPanel.setInputEnabled(true);
        }
    }

    // ── Pillar detection (utility tier, async) ──────────────────────────────

    async _detectAndMarkPillar(userMessage) {
        const idea = this.session.ideaMemory;
        const pending = (idea.pillars || []).filter(p => !p.resolved);
        if (!pending.length) return;

        for (const pillar of pending) {
            try {
                const result = await auditEngine.detectPillarResolution(userMessage, pillar.name, '');
                if (result?.resolved) {
                    pillar.resolved = true;
                    pillar.answer = result.summary || '';
                    idea.keyDecisions.push({
                        decision: `${pillar.name}: ${result.summary}`,
                        timestamp: Date.now(),
                    });
                    ideaPanel.updatePillar(idea.pillars);
                }
            } catch {
                // Utility failure is non-blocking
            }
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    _allPillarsResolved() {
        const pillars = this.session.ideaMemory?.pillars || [];
        return pillars.length > 0 && pillars.every(p => p.resolved);
    }

    _isApproval(message) {
        const lower = message.toLowerCase().trim();
        return /^(yes|yep|yeah|looks good|approved?|let'?s go|go|do it|start building|build)/i.test(lower);
    }

    // FIX: Centralized error display with proper cleanup
    _showError(err, context) {
        const userMessage = (err instanceof CCSApiError)
            ? err.userMessage
            : `❌ ${context}: ${err?.message || 'Unknown error'}`;
        chatPanel.addSystemMessage(userMessage, 'error');
    }
}

export const ideationPhase = new IdeationPhase();
