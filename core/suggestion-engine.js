// core/suggestion-engine.js
// v3.5 — Zero-cost client-side suggestion engine

export class SuggestionEngine {
    
    /**
     * Generate contextual suggestions based on current phase and card state
     * @returns {Array<{label: string, action: string, type: string}>}
     */
    getSuggestions(session, cardFields, phase) {
        const suggestions = [];
        const idea = session?.ideaMemory || {};

        if (phase === 'ideation') {
            if (!idea.conceptName && !idea.pillars?.length) {
                suggestions.push({ label: 'Suggest an idea', action: 'Suggest a character idea', type: 'primary' });
                suggestions.push({ label: 'Improve existing', action: 'I want to improve an existing character', type: 'secondary' });
            } else if (idea.pillars && idea.pillars.some(p => !p.resolved)) {
                suggestions.push({ label: 'Suggest pillar answers', action: 'Suggest some answers for the pending pillars', type: 'primary' });
                suggestions.push({ label: 'Resolve all', action: 'Resolve all pillars for me', type: 'secondary' });
            } else if (!idea.voiceProfile) {
                suggestions.push({ label: 'Calibrate voice', action: 'Let\'s calibrate the voice', type: 'primary' });
            } else if (!idea.proposedProfileApproved) {
                suggestions.push({ label: 'Approve profile', action: 'The profile looks good, let\'s build!', type: 'primary' });
                suggestions.push({ label: 'Generate profile', action: 'Generate the proposed profile', type: 'secondary' });
            }
        } 
        else if (phase === 'generation') {
            const missingFields = ['description', 'first_mes', 'mes_example', 'scenario', 'personality']
                .filter(f => !cardFields?.[f]);
                
            if (missingFields.length > 0) {
                // Suggest the most important missing field
                let nextField = 'description';
                if (cardFields?.description) {
                    if (!cardFields?.first_mes) nextField = 'first_mes';
                    else if (!cardFields?.mes_example) nextField = 'mes_example';
                    else nextField = missingFields[0];
                }
                suggestions.push({ label: `Generate ${nextField}`, action: `Generate the ${nextField} field`, type: 'primary' });
                
                if (missingFields.length > 1) {
                    suggestions.push({ label: 'Generate all remaining', action: 'Generate all remaining fields', type: 'secondary' });
                }
            } else {
                suggestions.push({ label: 'Test drive character', action: 'Test drive character', type: 'primary' });
                suggestions.push({ label: 'Review card', action: 'Review the full card for issues', type: 'secondary' });
            }
            
            // Contextual field suggestions based on recent generation
            const history = session?.conversationHistory || [];
            const lastMsg = history[history.length - 1];
            if (lastMsg && lastMsg.role === 'assistant' && lastMsg.content.includes('```')) {
                suggestions.push({ label: 'Rewrite', action: 'Rewrite that, make it better', type: 'secondary' });
                suggestions.push({ label: 'Make darker', action: 'Rewrite that to be darker/edgier', type: 'secondary' });
            }
        }
        else if (phase === 'lorebook') {
            suggestions.push({ label: 'Suggest entries', action: 'Suggest some lore entries', type: 'primary' });
            suggestions.push({ label: 'Generate all', action: 'Generate all planned entries', type: 'secondary' });
        }

        return suggestions.slice(0, 3); // Max 3 chips
    }
}

export const suggestionEngine = new SuggestionEngine();
