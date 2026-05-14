// core/intent-engine.js
// v3.5 — Scored intent detection pipeline
// Replaces flat keyword arrays with a structured, confidence-based intent system.

const FIELD_ALIASES = {
    description: [
        'description', 'desc', 'backstory', 'background', 'who is', 'who she', 'who he',
        'about them', 'about the character', 'character overview', 'write about',
        'tell me about', 'who are they', 'full description', 'overview', 'define the character'
    ],
    first_mes: [
        'first message', 'first mes', 'opening message', 'greeting', 'intro message',
        'opening scene', 'opening line', 'how they start', 'start of the rp',
        'the beginning', 'how it starts', 'opening', 'first contact', 'initial message',
        'the intro', 'starting scene'
    ],
    mes_example: [
        'example message', 'mes example', 'example dialogue', 'dialogue example',
        'sample dialogue', 'how they talk', 'talking examples', 'conversation sample',
        'show how they speak', 'demonstrate voice', 'voice examples', 'example chat'
    ],
    scenario: [
        'scenario', 'setting', 'world context', 'background setting', 'opening context',
        'the world', 'where are they', 'context', 'situation', 'world setup', 'lore context'
    ],
    system_prompt: [
        'system prompt', 'ai instructions', 'instructions', 'behavior rules',
        'format rules', 'behavioral', 'how should the ai', 'rules for', 'character note'
    ],
    personality: [
        'personality', 'traits', 'character traits', 'who they are',
        'their nature', 'their vibe', 'personality traits', 'how they act'
    ],
    creator_notes: [
        'creator notes', 'card description', 'card page', 'download page',
        'card notes', 'notes', 'readme', 'chub description'
    ],
    alternate_greetings: [
        'alternate greeting', 'alt greeting', 'another greeting', 'different opening',
        'add greeting', 'more greetings', 'alternative start', 'other beginnings', 'alternate greetings'
    ],
    tags: ['tags', 'card tags', 'generate tags', 'suggest tags', 'tag this card', 'tag it'],
    name: [
        'name', 'character name', 'what should we name', 'name her', 'name him',
        'give a name', 'suggest a name', 'pick a name'
    ],
    post_history_instructions: [
        'post history', 'post_history', 'post history instructions', 'post history instructions'
    ]
};

const PHASE_ALIASES = {
    lorebook: [
        'lorebook', 'lore', 'world info', 'lore entries', 'start lore', 'work on lore',
        'add lore', 'build the world', 'worldbuilding'
    ],
    building: [
        'building', 'back to card', 'work on fields', 'generate fields', 'write the card',
        'back to writing', 'start writing', 'build now', 'make the fields'
    ],
    ideation: ['back to ideation', 'rethink', 'start over', 'new concept', 'redo the concept']
};

const REWRITE_ALIASES = {
    shorten: ['shorten', 'cut it down', 'make it shorter', 'trim', 'compress', 'condense'],
    lengthen: ['lengthen', 'expand', 'make it longer', 'more detail', 'elaborate', 'flesh out'],
    darker: ['darker', 'edgier', 'grimmer', 'more mature', 'more intense', 'more complex'],
    specific: ['more specific', 'too generic', 'make it unique', 'concrete'],
    elevate: ['elevate', 'improve writing', 'better prose', 'polish', 'raise quality'],
    voice: ['fix the voice', 'strengthen voice', 'more distinctive', 'voice consistency'],
    fixformat: ['fix format', 'fix formatting', 'wrong format', 'broken format']
};

const GENERATE_ALL_ALIASES = [
    'generate all', 'generate everything', 'do the whole card', 'write the whole card',
    'fill the card', 'fill all fields', 'write everything', 'generate all fields'
];

export class IntentEngine {

    /**
     * @returns { type: string, target: string|null, confidence: number, meta: object }
     */
    detect(message, session = null, currentPhase = null) {
        const lowerMsg = message.toLowerCase().trim();
        let bestIntent = { type: 'chat', target: null, confidence: 0.3, meta: {} };

        const updateIfBetter = (intent) => {
            if (intent.confidence > bestIntent.confidence) {
                bestIntent = intent;
            }
        };

        // 1. Generate All check (weight 0.95)
        for (const alias of GENERATE_ALL_ALIASES) {
            if (lowerMsg.includes(alias)) {
                updateIfBetter({ type: 'generate_all', target: null, confidence: 0.95, meta: {} });
                break;
            }
        }

        // 2. Phase switch check (weight 0.9)
        for (const [phase, aliases] of Object.entries(PHASE_ALIASES)) {
            for (const alias of aliases) {
                if (lowerMsg.includes(alias)) {
                    updateIfBetter({ type: 'phase_switch', target: phase, confidence: 0.9, meta: {} });
                    break;
                }
            }
        }

        // 3. Field Generation / Rewrite check
        const rewriteAction = this._detectRewriteAction(lowerMsg);
        const intentType = rewriteAction ? 'rewrite_field' : 'generate_field';

        for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
            for (const alias of aliases) {
                // Exact phrase match (weight 1.0 if it's explicitly asking to generate/write)
                if (lowerMsg.includes(`generate ${alias}`) || lowerMsg.includes(`write ${alias}`) || lowerMsg.includes(`make ${alias}`)) {
                    updateIfBetter({ type: intentType, target: field, confidence: 1.0, meta: { action: rewriteAction } });
                    break;
                }
                
                // Semantic match (weight 0.85)
                if (lowerMsg.includes(alias)) {
                    updateIfBetter({ type: intentType, target: field, confidence: 0.85, meta: { action: rewriteAction } });
                }
                
                // Fuzzy/partial match for field name only (weight 0.7)
                if (alias.length > 4 && lowerMsg.includes(alias.substring(0, 4))) {
                    // Lower confidence to avoid false positives on short substrings
                     if (bestIntent.confidence < 0.7) {
                         // Only update if we don't have a better match, but keep confidence lower
                         updateIfBetter({ type: intentType, target: field, confidence: 0.7, meta: { action: rewriteAction } });
                     }
                }
            }
        }

        // 4. Batch greetings check (weight 0.95)
        if (lowerMsg.includes('batch') || lowerMsg.includes('several greetings') || lowerMsg.includes('multiple greetings')) {
            if (lowerMsg.includes('greeting')) {
                 updateIfBetter({ type: 'batch_greetings', target: 'alternate_greetings', confidence: 0.95, meta: {} });
            }
        }
        
        // 5. Simulation check (weight 0.95)
        if (lowerMsg.includes('test drive') || lowerMsg.includes('simulate') || lowerMsg.includes('chat with')) {
             updateIfBetter({ type: 'simulation', target: null, confidence: 0.95, meta: {} });
        }

        return bestIntent;
    }

    _detectRewriteAction(lowerMsg) {
        for (const [action, aliases] of Object.entries(REWRITE_ALIASES)) {
            for (const alias of aliases) {
                if (lowerMsg.includes(alias)) return action;
            }
        }
        return null;
    }
}

export const intentEngine = new IntentEngine();
