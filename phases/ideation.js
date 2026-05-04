// phases/ideation.js
// Ideation phase: concept rating, pillar tracking, smart pillar detection, proposed profile

import { chatEngine } from '../core/chat.js';
import { auditEngine } from '../core/audit.js';
import { memoryManager } from '../core/memory.js';
import { buildBaseSystemPrompt } from '../prompts/base.js';
import { parseConceptRating } from '../core/parser.js';
import {
    GREETING_PROMPT, CONCEPT_RATING_PROMPT, GENERATE_IDEAS_PROMPT,
    PILLAR_DISCUSSION_PROMPT, PROPOSED_PROFILE_PROMPT, LOAD_EXISTING_CARD_PROMPT,
} from '../prompts/ideation.js';
import { chatPanel } from '../ui/chat-panel.js';
import { ideaPanel } from '../ui/idea-panel.js';

export class IdeationPhase {
    constructor() {
        this.session = null;
        this.cardFields = null;
        this.isActive = false;
        this.onPhaseComplete = null;
    }

    async start(session, cardFields, onPhaseComplete) {
        this.session = session;
        this.cardFields = cardFields;
        this.onPhaseComplete = onPhaseComplete;
        this.isActive = true;

        const hasContent = cardFields && (
            cardFields.description?.trim() || cardFields.first_mes?.trim() || cardFields.personality?.trim()
        );

        if (hasContent && session.ideaMemory.pillars.length === 0) {
            // Entering review/adopt mode
            session.reviewMode = true;
            await this._greetWithExistingCard(cardFields);
        } else if (session.ideaMemory.pillars.length > 0) {
            await this._resumeGreeting();
        } else {
            await this._initialGreeting();
        }
    }

    async handleMessage(userMessage) {
        if (!this.isActive) return false;
        const lower = userMessage.toLowerCase();

        // "Start building" signals
        const buildSignals = ['start building','start writing','let\'s build','begin writing',
            'move on','ready to write','fill the fields','start the card','approve'];
        if (buildSignals.some(s => lower.includes(s))) {
            await this._offerProposedProfile();
            return true;
        }

        // "Give me an idea" signals
        const ideaSignals = ['give me an idea','suggest a concept','suggest something',
            'generate ideas','i need an idea','come up with','create a concept'];
        if (ideaSignals.some(s => lower.includes(s))) {
            await this._generateIdeas();
            return true;
        }

        // First concept pitch
        const idea = this.session.ideaMemory;
        if (!idea.conceptName && this.session.conversationHistory.length <= 2) {
            await this._rateConceptAndSetupPillars(userMessage);
            return true;
        }

        // Regular ideation conversation
        await this._continueIdeation(userMessage);
        return true;
    }

    // ── Private ──────────────────────────────────────────────────────────────

    async _initialGreeting() {
        const response = await chatEngine.generateBackground(GREETING_PROMPT, 'Generate the initial greeting.');
        chatPanel.addMessage('assistant', response);
        memoryManager.addMessage(this.session, 'assistant', response);
    }

    async _greetWithExistingCard(cardFields) {
        const summary = this._buildExistingCardSummary(cardFields);
        const response = await chatEngine.generateBackground(
            buildBaseSystemPrompt() + '\n\n' + LOAD_EXISTING_CARD_PROMPT,
            `Analyze this existing character card:\n\n${summary}`
        );
        chatPanel.addMessage('assistant', response);
        memoryManager.addMessage(this.session, 'assistant', response);
    }

    async _resumeGreeting() {
        const idea = this.session.ideaMemory;
        const resolved = idea.pillars.filter(p => p.resolved).length;
        const total = idea.pillars.length;
        const pending = idea.pillars.filter(p => !p.resolved).map(p => `□ ${p.name}`).join('\n');
        const msg = `Welcome back! We were building **${idea.conceptName || 'your character'}**.\n\n${resolved}/${total} pillars resolved.\n${pending}\n\nWhere would you like to continue?`;
        chatPanel.addMessage('assistant', msg);
        memoryManager.addMessage(this.session, 'assistant', msg);
        ideaPanel.render(idea);
    }

    async _rateConceptAndSetupPillars(userMessage) {
        chatPanel.setInputEnabled(false);
        chatPanel.startStreaming();
        const response = await chatEngine.generateBackground(
            buildBaseSystemPrompt() + '\n\n' + CONCEPT_RATING_PROMPT,
            `Rate this concept and set up structural pillars:\n\n"${userMessage}"`
        );
        chatPanel.finalizeStream(response);
        chatPanel.setInputEnabled(true);

        const parsed = parseConceptRating(response);
        if (parsed?.conceptName) {
            this.session.ideaMemory.conceptName = parsed.conceptName;
            this.session.ideaMemory.conceptRating = { scores: parsed.scores, overall: parsed.overall };
        }
        if (parsed?.pillars?.length) this.session.ideaMemory.pillars = parsed.pillars;

        memoryManager.addMessage(this.session, 'assistant', response);
        memoryManager.saveSession(this.session.characterId, this.session);
        ideaPanel.render(this.session.ideaMemory);
    }

    async _generateIdeas() {
        chatPanel.setInputEnabled(false);
        chatPanel.startStreaming();
        const response = await chatEngine.generateBackground(
            buildBaseSystemPrompt() + '\n\n' + GENERATE_IDEAS_PROMPT,
            'Generate 3 original character concept ideas.'
        );
        chatPanel.finalizeStream(response);
        chatPanel.setInputEnabled(true);
        memoryManager.addMessage(this.session, 'assistant', response);
    }

    async _continueIdeation(userMessage) {
        chatPanel.setInputEnabled(false);
        chatPanel.startStreaming();

        // Smart pillar detection (utility tier — non-blocking if it fails)
        this._detectAndMarkPillar(userMessage).catch(() => {});

        const response = await chatEngine.chat({
            userMessage,
            session: this.session,
            cardFields: this.cardFields,
            extraInstruction: PILLAR_DISCUSSION_PROMPT,
            onComplete: (text) => {
                chatPanel.finalizeStream(text);
                chatPanel.setInputEnabled(true);
                const allResolved = this.session.ideaMemory.pillars.length > 0 &&
                    this.session.ideaMemory.pillars.every(p => p.resolved);
                if (allResolved) {
                    chatPanel.addSystemMessage('✅ All pillars resolved! Type "start building" or click below.', 'info');
                    this._addStartBuildingButton();
                }
                memoryManager.saveSession(this.session.characterId, this.session);
                ideaPanel.render(this.session.ideaMemory);
            },
        });
    }

    async _detectAndMarkPillar(userMessage) {
        const unresolved = this.session.ideaMemory.pillars.filter(p => !p.resolved);
        if (!unresolved.length) return;

        // Build context from last 2 messages
        const recent = this.session.conversationHistory.slice(-4);
        const ctx = recent.map(m => `${m.role}: ${m.content.substring(0, 100)}`).join('\n');

        // Try each unresolved pillar — stop at first resolution found
        for (const pillar of unresolved.slice(0, 3)) {
            const resolution = await auditEngine.detectPillarResolution(userMessage, pillar.name, ctx);
            if (resolution) {
                pillar.resolved = true;
                pillar.answer = resolution;
                this.session.ideaMemory.keyDecisions.push({
                    decision: `${pillar.name}: ${resolution}`,
                    timestamp: Date.now(),
                });
                ideaPanel.updatePillar(this.session.ideaMemory.pillars);
                memoryManager.saveSession(this.session.characterId, this.session);
                break; // Only mark one pillar per message
            }
        }
    }

    async _offerProposedProfile() {
        chatPanel.setInputEnabled(false);
        chatPanel.startStreaming();
        const settings = memoryManager.getGlobalSettings();
        const response = await chatEngine.generateBackground(
            buildBaseSystemPrompt(settings.customSystemPromptRules)
                + '\n\n' + PROPOSED_PROFILE_PROMPT
                + '\n\n' + memoryManager.buildIdeaMemorySummary(this.session),
            'Generate the proposed character profile summary.'
        );
        chatPanel.finalizeStream(response);
        chatPanel.setInputEnabled(true);
        memoryManager.addMessage(this.session, 'assistant', response);
        this._addApproveButton();
    }

    _addApproveButton() {
        const bar = document.createElement('div');
        bar.className = 'ccs-accept-bar';
        bar.innerHTML = `
            <span class="ccs-accept-label">Ready to start writing fields?</span>
            <button class="ccs-btn ccs-btn-primary" id="ccs-approve-profile-btn">✅ Approve & Start Building</button>
        `;
        bar.querySelector('#ccs-approve-profile-btn').addEventListener('click', () => {
            this.session.ideaMemory.proposedProfileApproved = true;
            memoryManager.saveSession(this.session.characterId, this.session);
            this.isActive = false;
            this.onPhaseComplete?.();
            bar.innerHTML = '<span class="ccs-accept-label">✅ Moving to field generation...</span>';
        });
        document.getElementById('ccs-chat-messages')?.appendChild(bar);
    }

    _addStartBuildingButton() {
        const container = document.getElementById('ccs-chat-messages');
        if (container?.querySelector('.ccs-start-building-bar')) return;
        const bar = document.createElement('div');
        bar.className = 'ccs-accept-bar ccs-start-building-bar';
        bar.innerHTML = `
            <span class="ccs-accept-label">All pillars resolved!</span>
            <button class="ccs-btn ccs-btn-primary" id="ccs-start-build-btn">🚀 Generate Proposed Profile</button>
        `;
        bar.querySelector('#ccs-start-build-btn').addEventListener('click', () => this._offerProposedProfile());
        container?.appendChild(bar);
    }

    _buildExistingCardSummary(cardFields) {
        const parts = [];
        const fields = ['name','description','personality','scenario','first_mes','mes_example','system_prompt'];
        for (const f of fields) {
            const v = cardFields[f];
            if (v?.trim()) parts.push(`[${f.toUpperCase()}]\n${v.substring(0, 300)}${v.length > 300 ? '...' : ''}`);
        }
        const g = cardFields.alternate_greetings || [];
        if (g.length) parts.push(`[ALTERNATE_GREETINGS: ${g.length} greeting(s)]`);
        const b = cardFields.character_book;
        if (b?.entries?.length) parts.push(`[CHARACTER_BOOK: ${b.entries.length} entries]`);
        return parts.join('\n\n') || 'No fields populated yet.';
    }
}

export const ideationPhase = new IdeationPhase();
