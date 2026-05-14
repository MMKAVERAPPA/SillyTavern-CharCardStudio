// prompts/skills/phase-generation.js
// Chain-of-thought field generation with self-checks and format awareness

export const SKILL_GENERATION_COT = `## Chain-of-Thought Field Generation

When generating any card field, follow this internal structure:

### [PLAN] (Think before writing)
- What sections will this field contain and why?
- What format am I using? (Prose / PList / Ali:Chat)
- What existing fields do I need to stay consistent with?
- What's the target token range?
- For this specific field, what are the critical quality criteria?

### [DRAFT]
Write the field content inside a triple-backtick code block.

### [SELF-CHECK] (Verify before presenting)
Apply these checks mentally and fix issues before presenting the final version:
□ Actor Test: Could someone perform this character from this content alone?
□ Distinctiveness: If I hid the name, could I identify this character?
□ No {{user}} actions written (especially in first_mes, mes_example)
□ Token budget within range for the detail level
□ Counterweights present for every strong trait
□ Most important content positioned at bottom (for stronger AI influence)
□ Voice consistency with established voice samples (if available)
□ VOICE ANCHOR CHECK: Does the dialogue/internal thought match the Voice Profile in the Character Seed EXACTLY?
□ No contradictions with other accepted fields
□ Macros correct: {{char}} and {{user}} used properly

### [OUTPUT]
Present the final version in a code block. After the block, add a brief note on key creative choices made and any trade-offs.

If one critical question would significantly change the output, ask it first. Otherwise, generate based on ideation decisions.`;

export const SKILL_GENERATION_FIELD_INSTRUCTIONS = {
    description: `## Generating: description
The most important permanent field. Structure and write with extreme care.

**Prose Format Structure:**
1. [Core] — Who is this at their essence? Role, defining concept.
2. [Appearance] — Distinctive features only. Skip generic details.
3. [Personality] — Outer presentation → inner reality. Every trait gets a WHY and a COST.
4. [Voice] — Speech patterns, vocabulary, verbal tics, humor style. The Actor's cheat sheet.
5. [Drive] — Core motivation, what they want from {{user}}, relationship dynamic setup.

**PList+Ali:Chat Structure:**
- Ali:Chat exchanges go in description (3-4 exchanges covering backstory, appearance, core traits, voice)
- PList goes separately in system_prompt/character_note field

**Quality Criteria:**
- Every sentence must pass: "Does this change how the AI plays the character?"
- Behavior-over-labels: "When [trigger], {{char}} usually [behavior], because [reason]"
- Most important content at BOTTOM of field
- Target: 400-900 tokens (standard), 600-1200 (verbose)

**Avoid these common traps:**
- Generic MBTI summaries ("She is an INTJ who...")
- Backstory-first structure (start with who they ARE, not where they came from)
- Adjective clusters without behaviors ("cold, aloof, mysterious" → show HOW)
- Adverb abuse ("She spoke softly, quietly, gently...")
- Present-tense life summary ("She works as a detective...")`,

    personality: `## Generating: personality
Short supplementary field. Many excellent cards leave this blank entirely.

**When to use:** Only if description doesn't fully cover the trait-behavior snapshot the AI calibrates tone from.
**When to skip:** If description is thorough, write "RECOMMENDED: Leave blank — description covers personality fully."

**If generating:**
- Compressed trait-behavior snapshot: 50-150 tokens max
- Do NOT repeat anything from description
- Use pipe-separated format for efficiency: "stoic | observant | dry humor | fiercely loyal but won't show it"
- Every trait gets a counterweight or qualifier`,

    scenario: `## Generating: scenario
Sets the permanent situational frame. Be surgical — every token is permanent.

**Include:**
- World context (time period, social norms, relevant world rules)
- Relationship starting point between {{char}} and {{user}}
- Active tension or stakes (what makes this situation interesting RIGHT NOW)
- Narration style instructions if needed

**Do NOT include:**
- The specific location of the opening scene (that's first_mes only!)
- World-building lore dumps (use lorebook)
- Behavioral instructions (use system_prompt)
- Backstory (use description)

**Critical Rule:** If the FM starts in a café, do NOT put "they are in a café" in scenario. When they leave the café, the AI will still think they're there because scenario is permanent.`,

    first_mes: `## Generating: first_mes
The heart and soul of the card. A bad FM ruins even a perfect description.

**Apply the Flipped Scenario Technique:**
Write from {{char}}'s side. {{user}}'s presence is perceived through {{char}}'s eyes or implied.
  WRONG: "You walk into the room and see her."
  RIGHT: "The door creaks. She doesn't look up from her work — not yet."

**Structure:**
1. Establish physical scene through {{char}}'s perception (1-2 sentences)
2. Show {{char}} in action (doing something that reveals personality)
3. The moment of contact — {{char}} notices/addresses {{user}}
4. Hook ending — something for {{user}} to respond to (constrained freedom, not yes/no)

**Voice:** If the character has unique speech patterns, they MUST appear in the FM. This is where the AI learns voice.
**Length:** Choose deliberately. FM length = response length anchor. 200-400 tokens for standard, 400-700 for verbose.

**Avoid these common traps:**
- Weather/environment openers ("The rain fell steadily...")
- Walking-into-room openers ("You step into the dimly lit...")
- "You notice..." or "You feel..." (breaks the perspective rule)
- Monologue dumps ({{char}} talking for 3+ paragraphs before any hook)
- Ending on a closed statement (must end on something that demands a response)`,

    mes_example: `## Generating: mes_example
Voice demonstration through example dialogue. Gets dropped from context as chat grows.

**Format EXACTLY:**
\`\`\`
<START>
{{user}}: [message]
{{char}}: [response with actions and dialogue]
<START>
{{user}}: [different situation]
{{char}}: [response showing different facet]
\`\`\`

**Coverage Requirements:**
- At least 2 exchanges, ideally 3-4
- One exchange showing appearance (someone asks or it's naturally revealed)
- One exchange showing stress/vulnerability (how they react under pressure)
- One exchange showing their primary personality trait in action
- Different emotional registers across exchanges

**Rules:**
- Show HOW {{char}} talks, not just WHAT they say
- Include physical mannerisms, verbal tics, thought patterns
- Most important exchange goes LAST (strongest influence)

**Avoid these common traps:**
- Echoing the question back ("Oh, you want to know about that?")
- {{char}} starting with "You" ("You look tired today")
- Generic answers that any character could give
- More than 4 exchanges (gets dropped from context as chat grows)
- Behavioral rules or instructions here — they WILL get dropped`,

    system_prompt: `## Generating: system_prompt
Instructions TO the AI. Not character description. Every token must ADD something new.

**What belongs here:**
- Response format rules (action formatting, dialogue style)
- Behavioral locks that enforce character contradictions
- Genre/style anchoring ("Genre: Psychological Horror")
- Things the AI tends to get wrong with this specific character

**What does NOT belong here:**
- Personality descriptions (that's description's job)
- "Always be faithful to the character" (AI already tries this)
- "Remember everything" (physically impossible)
- "Don't/Never/Do not" instructions (use positive framing instead)

**Token budget:** Under 100 tokens. 200 max. If you need 500+, the card design needs rethinking.

**Positive framing examples:**
  Instead of "Don't break character" → "Stay in character at all times"
  Instead of "Never speak for {{user}}" → "Write only {{char}}'s actions, dialogue, and internal thoughts"
  Instead of "Don't use flowery language" → "Use direct, blunt language"

**Avoid these common traps:**
- "Do not break character" (redundant, wastes tokens)
- Negative framing ("Do not be boring" → "Be creative")
- Restating personality ("{{char}} is rude" → use description instead)`,

    creator_notes: `## Generating: creator_notes
For HUMANS downloading the card. The RP AI never sees this.

**Structure:**
1. One-line hook (first line appears in card-site thumbnails!)
2. What the RP experience is like (2-3 sentences)
3. Character concept summary
4. Content warnings if applicable
5. Recommended setup (model tier, any required settings)
6. Alternate greetings summary if present

**Platform-aware:** Can use Markdown and HTML for styling on Chub/FictionLab.`,

    alternate_greeting: `## Generating: alternate_greeting
Same rules as first_mes, but each must offer a MEANINGFULLY DIFFERENT starting point.

**Variation types:**
- Different location (café vs park vs their apartment)
- Different emotional register (playful vs stressed vs vulnerable)
- Different relationship stage (strangers vs acquaintances vs established)
- Different time period or context (morning routine vs late night vs during a crisis)
- Different power dynamic ({{char}} in control vs {{char}} at a disadvantage)

**Rules:**
- Stand alone completely — assume {{user}} hasn't read other greetings
- Apply the Flipped Scenario Technique
- Maintain voice consistency with first_mes
- Each should make the user think "oh, THIS is an interesting way to start"`,
};

export const SKILL_GENERATE_ALL = `Generate ALL character card fields at once based on the ideation decisions.

Apply chain-of-thought internally for each field. Present each with a clear header and code block:

## description
\`\`\`
[content — most important field, write with full care]
\`\`\`

## personality
\`\`\`
[content — or "RECOMMENDED: Leave blank, description covers this fully"]
\`\`\`

## scenario
\`\`\`
[content — permanent context only, no opening scene location]
\`\`\`

## first_mes
\`\`\`
[content — apply Flipped Scenario Technique, show voice clearly]
\`\`\`

## mes_example
\`\`\`
[content — 3+ exchanges with <START> tags, voice demonstration]
\`\`\`

## system_prompt
\`\`\`
[content — under 200 tokens, only what ADDS something, positive framing]
\`\`\`

After all fields, note:
**⚠️ Generate separately:** alternate_greetings, creator_notes, tags, lorebook — tackle these after reviewing the main fields.
**📊 Token estimate:** [rough permanent token count for description + personality + scenario + system_prompt]`;

export const SKILL_REWRITE_INSTRUCTIONS = {
    shorten:   'Rewrite to approximately HALF length. Preserve essential content and voice. Cut redundancy and low-impact details. Prioritize behavioral patterns over backstory.',
    lengthen:  'Expand to approximately DOUBLE length. Add specific behavioral details, concrete examples, and texture. Do not pad with filler — every added line must pass "does this change how the AI plays the character?"',
    darker:    'Rewrite with a significantly darker tone. Increase psychological complexity, moral ambiguity, and edge. Lean into the character\'s wounds and contradictions. Keep them coherent, not edgy for edginess.',
    specific:  'Replace abstract statements with specific behaviors, scenes, and details that could not apply to any other character. Apply the "behavior over labels" principle aggressively.',
    fixformat: 'Fix formatting to match SillyTavern best practices. Correct {{char}}/{{user}} macro usage, action formatting (asterisks), <START> tag placement, and structural issues.',
    elevate:   'Elevate writing quality. Improve sentence variety, cut weak phrases, strengthen character voice, ensure every line earns its place. Apply the Actor Test.',
    voice:     'Rewrite to make the character voice more distinctive and consistent. Sharpen speech patterns, verbal tics, vocabulary choices. Make them unmistakable.',
};
