// prompts/generation.js
// v3.0 — Delegates field instructions to skill modules. Kept for backward compatibility.

import { SKILL_GENERATION_FIELD_INSTRUCTIONS, SKILL_REWRITE_INSTRUCTIONS } from './skills/phase-generation.js';

export const DETAIL_LEVELS = {
    quick:    { description:'150-300t', personality:'50-100t', scenario:'80-150t', first_mes:'100-200t', mes_example:'100-200t', system_prompt:'100-200t', alternate_greeting:'100-200t' },
    standard: { description:'300-600t', personality:'100-200t', scenario:'150-300t', first_mes:'200-400t', mes_example:'200-400t', system_prompt:'150-300t', alternate_greeting:'200-400t' },
    verbose:  { description:'600-1200t', personality:'200-350t', scenario:'300-500t', first_mes:'400-700t', mes_example:'400-700t', system_prompt:'250-500t', alternate_greeting:'400-700t' },
};

export const FIELD_SPECIFIC_INSTRUCTIONS = SKILL_GENERATION_FIELD_INSTRUCTIONS;

export function buildFieldGenerationPrompt(fieldName, cardFields, ideaMemory, detailLevel = 'standard') {
    const tokens = DETAIL_LEVELS[detailLevel]?.[fieldName] || '300-500t';
    const instructions = SKILL_GENERATION_FIELD_INSTRUCTIONS[fieldName] || '';
    return `Generate the **${fieldName}** field for this character card.

${instructions}

Target length: ${tokens}

Put the COMPLETE generated content inside a triple-backtick code block. After the block, add a brief note on key choices made.

If you have ONE critical question that would significantly change output, ask it first. Otherwise, generate now based on the ideation decisions.`;
}

export const GENERATE_ALL_FIELDS_PROMPT = `Generate ALL character card fields at once based on the ideation decisions.

Format each field with a clear header and code block:

## description
\`\`\`
[content]
\`\`\`

## personality
\`\`\`
[content — or "RECOMMENDED: Leave blank, description covers this fully"]
\`\`\`

## scenario
\`\`\`
[content]
\`\`\`

## first_mes
\`\`\`
[content]
\`\`\`

## mes_example
\`\`\`
[content]
\`\`\`

## system_prompt
\`\`\`
[content]
\`\`\`

After all fields, note:
**⚠️ Generated separately:** alternate_greetings, creator_notes, tags, lorebook — tackle these after reviewing the main fields.`;

export const BATCH_OPERATION_PROMPT = `Apply the requested operation consistently across all target items.

For each item modified, output the new version in a code block labeled with its index.
After all outputs, briefly list what changed in each item.

If the operation is ambiguous, clarify before generating.`;

export const REWRITE_INSTRUCTIONS = SKILL_REWRITE_INSTRUCTIONS;

export const MES_EXAMPLE_WARNING = `⚠️ **mes_example Warning**

The example messages contain what looks like behavioral instructions or critical rules.

**Important:** mes_example is progressively DROPPED from context as chat history grows. Anything here will eventually become invisible to the RP AI.

**Move to:**
- **system_prompt** — format rules and behavioral locks
- **description** — personality-driven behaviors

Should I move those instructions to system_prompt and keep mes_example as pure voice/tone examples?`;
