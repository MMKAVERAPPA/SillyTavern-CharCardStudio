// phases/ideation.js
// v3.0 — Ideation phase with card type detection, voice calibration, and psych depth
// FIX: try-catch all gen calls, add missing history entries, proper error cleanup

import { chatEngine } from '../core/chat.js';
import { memoryManager } from '../core/memory.js';
import { contextBuilder } from '../core/context-builder.js';
import { skillRouter } from '../core/skill-router.js';
import { parseConceptRating, parseLorePlan } from '../core/parser.js';
import { auditEngine } from '../core/audit.js';
import { chatPanel } from '../ui/chat-panel.js';
import { ideaPanel } from '../ui/idea-panel.js';
import { CCSApiError } from '../core/api.js';

export class IdeationPhase {
    constructor() {
        this.session = null;
        this.cardFields = null;
        this.onComplete = null;
        this.onManualResolve = null;
        this.lastIntent = null;
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
        const isFollowUp = /^(yes|ok|do it|that one|sure|go ahead|confirm|perfect)$/i.test(message.trim());
        if (isFollowUp && this.lastIntent && (Date.now() - this.lastIntent.timestamp < 120_000)) {
            await this._executeIntent(this.lastIntent);
            return;
        }

        const idea = this.session.ideaMemory;
        
        // Basic intent mapping for ideation since IntentEngine mostly targets generation/phases
        let mappedIntent = { type: 'chat', originalMessage: message, timestamp: Date.now() };

        // Route to the right handler based on ideation state
        if (message.toLowerCase().includes('suggest') || message.toLowerCase().includes('ideas')) {
            mappedIntent.type = 'suggest';
            this.lastIntent = mappedIntent;
            await this._generateIdeas(message);
            return;
        }
        if (message.toLowerCase().includes('load existing') || message.toLowerCase().includes('improve existing')) {
            await this._loadExistingCard(message);
            return;
        }
        // v3.0: Format change request
        if (/plist|ali.?chat/i.test(message) && /switch|change|use|format/i.test(message)) {
            idea.format = 'plist_alichat';
            memoryManager.saveSession(this.session.characterId, this.session);
            chatPanel.addSystemMessage('📝 Format switched to **PList + Ali:Chat**. PList will go in Character Note (system_prompt at depth 4), Ali:Chat in description.', 'info');
            ideaPanel.render(idea);
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
        // v3.0: Voice calibration — offer after all pillars resolved, before proposed profile
        if (this._allPillarsResolved() && !idea.voiceProfile && !idea.proposedProfileGenerated) {
            await this._voiceCalibration(message);
            return;
        }
        if (this._allPillarsResolved() && idea.voiceProfile && !idea.proposedProfileGenerated) {
            mappedIntent.type = 'proposed_profile';
            this.lastIntent = mappedIntent;
            await this._offerProposedProfile(message);
            return;
        }
        
        this.lastIntent = mappedIntent;
        await this._continueIdeation(message);
    }

    async _executeIntent(intent) {
        if (intent.type === 'suggest') await this._generateIdeas(intent.originalMessage);
        else if (intent.type === 'proposed_profile') await this._offerProposedProfile(intent.originalMessage);
        else await this._continueIdeation(intent.originalMessage || 'continue');
    }

    // ── Build skill-based system prompt ──────────────────────────────────────

    _buildSystemPrompt(task = '') {
        const settings = memoryManager.getGlobalSettings();
        const idea = this.session.ideaMemory;
        return skillRouter.buildSystemPrompt({
            phase: 'ideation',
            task,
            cardType: idea.cardType || 'single',
            format: idea.format || 'prose',
            customRules: settings.customSystemPromptRules,
        });
    }

    // ── Initial greeting ────────────────────────────────────────────────────

    async _initialGreeting() {
        const systemPrompt = this._buildSystemPrompt('greeting');
        const taskPrompt = skillRouter.getIdeationPrompt('greeting');

        chatPanel.startStreaming();
        chatPanel.setInputEnabled(false);

        try {
            // BUG-6: Use generateWithContext so greeting has session context
            const response = await chatEngine.generateWithContext(
                this.session, this.cardFields,
                systemPrompt, taskPrompt,
                { phase: 'ideation', task: 'greeting' }
            );
            if (!response) return; // aborted
            chatPanel.finalizeStream(response);
            memoryManager.addMessage(this.session, 'assistant', response);
        } catch (err) {
            chatPanel.cancelStreaming();
            this._showError(err, 'Failed to start ideation');
        } finally {
            chatPanel.setInputEnabled(true);
        }
    }

    // ── Concept rating (with card type detection) ───────────────────────────

    async _rateConceptAndSetupPillars(userMessage) {
        const systemPrompt = this._buildSystemPrompt('concept_rating');
        const taskPrompt = skillRouter.getIdeationPrompt('concept_rating');

        memoryManager.addMessage(this.session, 'user', userMessage);

        chatPanel.startStreaming();
        chatPanel.setInputEnabled(false);

        try {
            // BUG-6: Include history so AI knows what was said before
            const response = await chatEngine.generateWithContext(
                this.session, this.cardFields,
                systemPrompt,
                `${taskPrompt}\n\nUser's concept pitch:\n${userMessage}`,
                { phase: 'ideation', task: 'concept_rating' }
            );
            if (!response) return; // aborted
            chatPanel.finalizeStream(response);
            memoryManager.addMessage(this.session, 'assistant', response);

            const rating = parseConceptRating(response);
            this.session.ideaMemory.conceptRating = rating;
            if (rating?.pillars?.length) {
                this.session.ideaMemory.pillars = rating.pillars;
            }
            const nameMatch = response.match(/Concept:\s*"?([^"\n]+)"?/i);
            if (nameMatch) {
                this.session.ideaMemory.conceptName = nameMatch[1].trim();
            } else {
                this.session.ideaMemory.conceptName = userMessage.substring(0, 60);
            }
            const typeMatch = response.match(/Card Type:\s*([ABC])/i);
            if (typeMatch) {
                const typeMap = { 'A': 'single', 'B': 'multi', 'C': 'scenario' };
                this.session.ideaMemory.cardType = typeMap[typeMatch[1].toUpperCase()] || 'single';
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
        const systemPrompt = this._buildSystemPrompt('generate_ideas');
        const taskPrompt = skillRouter.getIdeationPrompt('generate_ideas');
        memoryManager.addMessage(this.session, 'user', userMessage);
        chatPanel.startStreaming();
        chatPanel.setInputEnabled(false);
        try {
            // BUG-6: Include history context
            const response = await chatEngine.generateWithContext(
                this.session, this.cardFields,
                systemPrompt, taskPrompt,
                { phase: 'ideation', task: 'generate_ideas' }
            );
            if (!response) return;
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
        const systemPrompt = this._buildSystemPrompt('load_existing');
        const taskPrompt = skillRouter.getIdeationPrompt('load_existing');
        memoryManager.addMessage(this.session, 'user', userMessage);
        chatPanel.startStreaming();
        chatPanel.setInputEnabled(false);
        try {
            const cardSummary = Object.entries(this.cardFields || {})
                .filter(([k, v]) => typeof v === 'string' && v.trim())
                .map(([k, v]) => `### ${k}\n${v.substring(0, 500)}`)
                .join('\n\n');
            // BUG-6: Include history context
            const response = await chatEngine.generateWithContext(
                this.session, this.cardFields,
                systemPrompt,
                `${taskPrompt}\n\n---\nExisting card fields:\n${cardSummary}`,
                { phase: 'ideation', task: 'load_existing' }
            );
            if (!response) return;
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

        const taskPrompt = skillRouter.getIdeationPrompt('pillar_discussion');
        const extraInstruction = `${taskPrompt}

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
                skillOptions: {
                    phase: 'ideation',
                    task: 'general_chat',
                    cardType: idea.cardType || 'single',
                    format: idea.format || 'prose',
                },
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

    // ── v3.0: Voice calibration ─────────────────────────────────────────────

    async _voiceCalibration(userMessage) {
        const idea = this.session.ideaMemory;

        if (this._isApproval(userMessage) && idea._pendingVoiceSamples) {
            idea.voiceProfile = idea._pendingVoiceDescription || 'Voice confirmed via calibration';
            idea.voiceSamples = idea._pendingVoiceSamples || [];
            delete idea._pendingVoiceSamples;
            delete idea._pendingVoiceDescription;
            chatPanel.addSystemMessage('🎤 Voice calibrated! Generating proposed profile...', 'info');
            ideaPanel.render(idea);
            await this._offerProposedProfile(userMessage);
            return;
        }

        const systemPrompt = this._buildSystemPrompt('voice_calibration');
        const taskPrompt = skillRouter.getIdeationPrompt('voice_calibration');
        const pillarSummary = (idea.pillars || []).map(p =>
            `- ${p.name}: ${p.answer || 'Not yet decided'}`
        ).join('\n');
        memoryManager.addMessage(this.session, 'user', userMessage);
        chatPanel.startStreaming();
        chatPanel.setInputEnabled(false);
        try {
            // BUG-6: Include history context
            const response = await chatEngine.generateWithContext(
                this.session, this.cardFields,
                systemPrompt,
                `${taskPrompt}\n\nConcept: ${idea.conceptName || 'Unknown'}\nResolved pillars:\n${pillarSummary}`,
                { phase: 'ideation', task: 'voice_calibration' }
            );
            if (!response) return;
            chatPanel.finalizeStream(response);
            memoryManager.addMessage(this.session, 'assistant', response);
            // BUG-018 FIX: Save to permanent fields immediately so they survive a
            // session exit before the user clicks approve. The _pending prefix was
            // causing data loss. We keep _pending as a flag for the approval check
            // but also write to the real voiceSamples / voiceProfile fields.
            const samples = this._extractVoiceSamples(response);
            const description = this._extractVoiceDescription(response);
            if (samples.length) {
                idea.voiceSamples = samples;              // permanent save immediately
                idea._pendingVoiceSamples = samples;      // flag for approval gate
            }
            if (description) {
                idea.voiceProfile = description;          // permanent save immediately
                idea._pendingVoiceDescription = description;
            }
            memoryManager.saveSession(this.session.characterId, this.session);
            ideaPanel.render(idea);
        } catch (err) {
            chatPanel.cancelStreaming();
            this._showError(err, 'Voice calibration failed');
            idea.voiceProfile = 'Voice calibration skipped';
        } finally {
            chatPanel.setInputEnabled(true);
        }
    }

    // ── Proposed profile ────────────────────────────────────────────────────

    async _offerProposedProfile(userMessage) {
        const systemPrompt = this._buildSystemPrompt('proposed_profile');
        const taskPrompt = skillRouter.getIdeationPrompt('proposed_profile');
        const idea = this.session.ideaMemory;
        const pillarSummary = (idea.pillars || []).map(p =>
            `- ${p.name}: ${p.answer || 'Not yet decided'}`
        ).join('\n');
        memoryManager.addMessage(this.session, 'user', userMessage);
        chatPanel.startStreaming();
        chatPanel.setInputEnabled(false);
        try {
            let profileContext = `${taskPrompt}\n\nResolved pillars:\n${pillarSummary}\n\nConcept: ${idea.conceptName || 'Not named'}`;
            profileContext += `\nCard Type: ${idea.cardType || 'single'}`;
            profileContext += `\nFormat: ${idea.format || 'prose'}`;
            if (idea.voiceProfile) profileContext += `\nVoice Profile: ${idea.voiceProfile}`;
            if (idea.voiceSamples?.length) profileContext += `\n\nConfirmed Voice Samples:\n${idea.voiceSamples.join('\n---\n')}`;
            // BUG-6: Include history context
            const response = await chatEngine.generateWithContext(
                this.session, this.cardFields,
                systemPrompt, profileContext,
                { phase: 'ideation', task: 'proposed_profile' }
            );
            if (!response) return;
            chatPanel.finalizeStream(response);
            memoryManager.addMessage(this.session, 'assistant', response);
            this._extractPsychProfile(response, idea);
            this._captureLorePlan(response);
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
                const recentHistory = (this.session.conversationHistory || [])
                    .slice(-6)
                    .map(m => `${m.role}: ${m.content.substring(0, 300)}`)
                    .join('\n');
                // detectPillarResolution returns a string summary if resolved, or null if not
                const summary = await auditEngine.detectPillarResolution(userMessage, pillar.name, recentHistory);
                if (summary) {
                    pillar.resolved = true;
                    pillar.answer = summary;
                    idea.keyDecisions.push({
                        decision: `${pillar.name}: ${summary}`,
                        timestamp: Date.now(),
                    });
                    ideaPanel.updatePillar(idea.pillars);
                }
            } catch {
                // Utility failure is non-blocking
            }
        }
    }

    // ── v3.0: Extract voice samples from response ───────────────────────────

    _extractVoiceSamples(response) {
        const samples = [];
        const codeBlockRegex = /```[\s\S]*?```/g;
        let match;
        while ((match = codeBlockRegex.exec(response)) !== null) {
            const content = match[0].replace(/```/g, '').trim();
            if (content.length > 20) {
                samples.push(content);
            }
        }
        return samples;
    }

    _extractVoiceDescription(response) {
        // Try to extract a voice summary from the text around the samples
        const lines = response.split('\n');
        for (const line of lines) {
            if (/voice|speech|speak|talk/i.test(line) && line.length > 30 && line.length < 300) {
                return line.replace(/^[\s*#-]+/, '').trim();
            }
        }
        return '';
    }

    // ── v3.0: Extract psychological profile from proposed profile ───────────

    _extractPsychProfile(response, idea) {
        const psych = idea.psychProfile || {};
        const extractors = [
            { key: 'coreMotivation', patterns: [/Core Motivation:\s*(.+)/i, /core want.*?:\s*(.+)/i] },
            { key: 'primaryFear', patterns: [/Primary Fear:\s*(.+)/i, /greatest fear.*?:\s*(.+)/i] },
            { key: 'hiddenDesire', patterns: [/Hidden Desire:\s*(.+)/i, /secret.*?want.*?:\s*(.+)/i] },
            { key: 'centralContradiction', patterns: [/Central Contradiction:\s*(.+)/i, /contradiction.*?:\s*(.+)/i] },
            { key: 'theWound', patterns: [/The Wound:\s*(.+)/i, /wound.*?:\s*(.+)/i, /formative.*?:\s*(.+)/i] },
            { key: 'stressBehavior', patterns: [/Stress Behavior:\s*(.+)/i, /under (?:stress|pressure).*?:\s*(.+)/i] },
            { key: 'socialMask', patterns: [/Social Mask.*?:\s*(.+)/i, /mask.*?:\s*(.+)/i] },
        ];

        for (const { key, patterns } of extractors) {
            for (const pattern of patterns) {
                const match = response.match(pattern);
                if (match) {
                    psych[key] = match[1].trim();
                    break;
                }
            }
        }

        idea.psychProfile = psych;
    }

    _captureLorePlan(response) {
        const plan = parseLorePlan(response);
        if (plan && plan.length) {
            this.session.ideaMemory.loreEntryPlan = plan;
            memoryManager.saveSession(this.session.characterId, this.session);
        }
    }

    async _manualResolvePillar(pillarName) {
        const idea = this.session.ideaMemory;
        const pillar = idea.pillars.find(p => p.name === pillarName && !p.resolved);
        if (!pillar) return;

        // Get last user message from history
        const lastMsg = [...(this.session.conversationHistory || [])]
            .reverse().find(m => m.role === 'user')?.content || '';
            
        const recentHistory = (this.session.conversationHistory || [])
            .slice(-6).map(m => `${m.role}: ${m.content.substring(0, 300)}`).join('\n');
            
        const summary = await auditEngine.detectPillarResolution(lastMsg, pillarName, recentHistory);
        if (summary) {
            pillar.resolved = true;
            pillar.answer = summary;
            idea.keyDecisions.push({ decision: `${pillarName}: ${summary}`, timestamp: Date.now() });
            memoryManager.saveSession(this.session.characterId, this.session);
            ideaPanel.render(idea);
        }
    }


    // ── Helpers ──────────────────────────────────────────────────────────────

    _allPillarsResolved() {
        const pillars = this.session.ideaMemory?.pillars || [];
        return pillars.length > 0 && pillars.every(p => p.resolved);
    }

    _isApproval(message) {
        const lower = message.toLowerCase().trim();
        return /^(yes|yep|yeah|looks good|approved?|let'?s go|go|do it|start building|build|sounds good|perfect|great)/i.test(lower);
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
