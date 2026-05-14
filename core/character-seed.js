// core/character-seed.js
// v3.5 — Compact, structured character seed to replace ideaSummary for generation
// Keeps token usage low while threading ideation decisions explicitly into prompts.

export class CharacterSeed {
    
    /**
     * Builds a compact string representing the character's core ideation state.
     * Intended for the system prompt during generation and lorebook phases.
     * Target length: < 150 tokens.
     */
    buildSeed(session) {
        if (!session?.ideaMemory) return '';
        
        const idea = session.ideaMemory;
        if (!idea.conceptName && !idea.pillars?.length) return ''; // Nothing to seed

        const parts = [];
        parts.push('[CHARACTER_SEED]');
        
        // Header
        const typeStr = idea.cardType || 'single';
        const formatStr = idea.format || 'prose';
        const nsfwStr = this._detectNSFW(idea) ? 'yes' : 'no';
        parts.push(`Concept: ${idea.conceptName || 'Unknown'} | Type: ${typeStr} | Format: ${formatStr} | NSFW: ${nsfwStr}`);
        
        // Psych profile (if exists)
        if (idea.psychProfile) {
            const psych = [];
            if (idea.psychProfile.coreMotivation) psych.push(`Psych: ${idea.psychProfile.coreMotivation}`);
            if (idea.psychProfile.primaryFear) psych.push(`Fear: ${idea.psychProfile.primaryFear}`);
            if (idea.psychProfile.centralContradiction) psych.push(`Contradiction: ${idea.psychProfile.centralContradiction}`);
            if (psych.length) parts.push(psych.join(' / '));
        }

        // Voice
        if (idea.voiceProfile) {
            // Compress voice profile to 1-2 lines
            const voice = idea.voiceProfile.replace(/\n/g, ' ').substring(0, 150);
            parts.push(`Voice: ${voice}`);
        }

        // Pillars
        const pillars = idea.pillars || [];
        const resolved = pillars.filter(p => p.resolved && p.answer);
        const pending = pillars.filter(p => !p.resolved);
        
        if (resolved.length) {
            const resolvedStrs = resolved.map(p => `[${p.name}]=${p.answer.replace(/\n/g, ' ').substring(0, 80)}`);
            parts.push(`Resolved: ${resolvedStrs.join('; ')}`);
        }
        
        if (pending.length) {
            parts.push(`Pending: ${pending.map(p => `[${p.name}]`).join(', ')}`);
        }
        
        parts.push('[/CHARACTER_SEED]');
        
        return parts.join('\n');
    }

    _detectNSFW(idea) {
        const allText = [
            ...(idea.pillars || []).map(p => p.answer || ''),
            ...(idea.keyDecisions || []).map(d => d.decision || ''),
        ].join(' ').toLowerCase();
        return /nsfw|adult|explicit|sexual|mature|erotic/i.test(allText);
    }
}

export const characterSeed = new CharacterSeed();
