// prompts/generation.js

export const DETAIL_LEVELS = {
    quick:    { description:'150-300t', personality:'50-100t', scenario:'80-150t', first_mes:'100-200t', mes_example:'100-200t', system_prompt:'100-200t', alternate_greeting:'100-200t' },
    standard: { description:'300-600t', personality:'100-200t', scenario:'150-300t', first_mes:'200-400t', mes_example:'200-400t', system_prompt:'150-300t', alternate_greeting:'200-400t' },
    verbose:  { description:'600-1200t', personality:'200-350t', scenario:'300-500t', first_mes:'400-700t', mes_example:'400-700t', system_prompt:'250-500t', alternate_greeting:'400-700t' },
};

export const FIELD_SPECIFIC_INSTRUCTIONS = {
    description: `## Description Rules
- MOST IMPORTANT field. Structure: core identity/role → behavioral patterns (When X, usually Y, because Z) → appearance (distinctive features only) → backstory (only what shaped who they are now) → world flavor.
- Use {{char}} and {{user}}. Write behavior, not labels.
- Give at least one irrational, disproportionate behavior revealing the character's self-image gap.
- Do NOT include behavioral instructions here — that's system_prompt's job.`,

    personality: `## Personality Rules
- SHORT supplementary field, not a duplicate of description.
- Compressed trait-behavior snapshot — what an AI calibrates tone from.
- Do NOT repeat description content. If description is thorough, keep this minimal.`,

    scenario: `## Scenario Rules
- Set the IMMEDIATE scene: where and when the RP begins.
- NOT for world-building lore (lorebook) or behavioral instructions (system_prompt).
- Set up structural tension if possible — make the opening interesting, not neutral.`,

    first_mes: `## First Message Rules
- Write from {{char}}'s POV. NEVER write for {{user}}. End invitingly.
- Use asterisks for actions (*She sets down her coffee*), quotes for dialogue.
- Establish: physical scene, {{char}}'s state, relationship dynamic, and a hook to respond to.
- Make the character's voice unmistakably clear in the first line.`,

    mes_example: `## Example Messages Rules
- Format EXACTLY: <START>\n{{user}}: [message]\n{{char}}: [response]
- Multiple exchanges separated by <START> tags.
- Purpose: demonstrate CHARACTER VOICE — how they speak, what they notice, how they react.
- CRITICAL: Do NOT put behavioral rules here — they get dropped from context as chat grows.`,

    system_prompt: `## System Prompt Rules
- Instructions TO the AI playing this character — NOT description of the character.
- Include: response style rules, behavioral locks, content guidelines, format requirements.
- Write clearly and directly — this is a directive, not prose.
- Do NOT restate personality/description content.`,

    creator_notes: `## Creator Notes Rules
- For HUMANS downloading/using the card — NOT for the RP AI.
- Write a card page description: what the character is, the RP experience, recommended model tier, setup notes, content warnings.
- Can use Markdown/HTML for card-site styling.`,

    alternate_greeting: `## Alternate Greeting Rules
- Same rules as first_mes: {{char}} POV, NEVER write for {{user}}, end invitingly.
- Each alternate greeting should offer a MEANINGFULLY DIFFERENT starting point:
  different location, different emotional register, different relationship stage, different time period.
- Stand alone completely — assume {{user}} hasn't read other greetings.`,
};

export function buildFieldGenerationPrompt(fieldName, cardFields, ideaMemory, detailLevel = 'standard') {
    const tokens = DETAIL_LEVELS[detailLevel]?.[fieldName] || '300-500t';
    const instructions = FIELD_SPECIFIC_INSTRUCTIONS[fieldName] || '';
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

export const REWRITE_INSTRUCTIONS = {
    shorten:   'Rewrite this field to be approximately HALF the current length. Preserve the most essential content and character voice. Cut anything that is redundant or low-impact.',
    lengthen:  'Expand this field to be approximately DOUBLE the current length. Add more specific behavioral details, concrete examples, and texture. Do not pad with filler.',
    darker:    'Rewrite this field with a significantly darker tone. Increase psychological complexity, edge, and moral ambiguity while keeping the character coherent.',
    specific:  'Rewrite this field to be more SPECIFIC and concrete. Replace abstract statements with specific behaviors, scenes, and details that could not apply to any other character.',
    fixformat: 'Fix the formatting of this field to match SillyTavern best practices. Correct macro usage ({{char}}/{{user}}), action formatting (asterisks), and structural issues.',
    elevate:   'Elevate the writing quality of this field. Improve sentence variety, cut weak phrases, strengthen the character voice, and ensure every line earns its place.',
};

export const MES_EXAMPLE_WARNING = `⚠️ **mes_example Warning**

The example messages contain what looks like behavioral instructions or critical rules.

**Important:** mes_example is progressively DROPPED from context as chat history grows. Anything here will eventually become invisible to the RP AI.

**Move to:**
- **system_prompt** — format rules and behavioral locks
- **description** — personality-driven behaviors

Should I move those instructions to system_prompt and keep mes_example as pure voice/tone examples?`;
