// prompts/skills/formats.js
// Format-specific writing guides: Prose (default), PList, Ali:Chat

export const SKILL_FORMAT_PROSE = `## Prose Format Guide (Default)

Prose format uses natural paragraphs with clear structure. Best for large modern models (Claude, GPT-4o, Gemini, GLM) and cloud APIs with generous context.

### Description Structure — Five Paragraphs
1. **Core Concept** — Who is this at their essence? Their role, what defines them. Name source if from existing fiction.
2. **Appearance** — Body type, hair, eyes, features, clothing, posture, small distinguishing details. Only what makes THEM unique.
3. **Personality (outer + inner)** — How they appear to others, then what lies underneath. For every strong trait: WHY? What does it cost? When does it fail?
4. **Voice and Mannerisms** — Specific vocabulary level, humor style, silences, physical habits, verbal tics. This is the Actor's cheat sheet.
5. **Relationship to {{user}}** — Open-ended dynamic setup, key NPCs if relevant.

### Prose Rules
- Use natural paragraphs, no special syntax.
- Semantic anchors help the AI parse sections. Use consistent markdown headers: [Core], [Appearance], [Voice], [Drive], etc.
- Most important content goes near the BOTTOM of the description — stronger influence.
- Non-human characters: the AI defaults to human. Override EVERY assumption explicitly. Describe: limb structure, skin/scales/fur, non-human senses, movement style, voice qualities, cultural logic.

### Example — Good Prose Description
\`\`\`
[Core]
{{char}} is a combat medic who deserted her unit after being ordered to let wounded prisoners die. She now runs an unlicensed clinic in the lower ward, treating anyone who can find her door. She tells herself she left because of principle. The truth is she left because she was afraid she was starting to agree with the order.

[Appearance]
Wiry build, always slightly hunched like she's bracing for something. Dark hair cropped short and uneven — she cuts it herself with surgical scissors. A chemical burn scar runs from her left ear to her collarbone, which she covers with high-collared shirts but never mentions. Steady hands that only shake when she's idle.

[Voice]
Speaks in clipped, precise sentences — medical shorthand bleeding into conversation. Uses "we" instead of "I" when discussing plans, a habit from unit briefings she can't shake. Deflects personal questions by diagnosing something about the asker. Laughs rarely, but when she does, it sounds surprised, like she forgot she could.

[Drive]
Needs to be needed — but only in ways she can control. Helping strangers is safe; they leave. Forming attachments is dangerous; they stay, and then she has something to lose again.
\`\`\``;

export const SKILL_FORMAT_PLIST = `## PList Format Guide

PList (Property List) is a compressed trait notation that focuses on high token-efficiency and structural clarity. It is an excellent format for users who prefer strict categorization, local models, or when paired with Ali:Chat.

### PList Placement
- **SillyTavern:** Character Note at depth 4, frequency 1, role System.
- This means PList goes in the system_prompt/character_note field, NOT in description.

### PList Notation Rules
\`\`\`
[Category: trait, trait(descriptor), thing/thing(shared); Category2: ...]
\`\`\`
- **trait(descriptor)** — one modifier: loyal(to a fault)
- **trait(desc, desc)** — multiple modifiers: hair(dark, short, messy)
- **thing/thing(shared)** — shared descriptor: blouse(mint-green)/shorts(denim)
- **loves x/y/z** — multiple objects
- Semicolons separate categories. All lowercase except proper nouns. No articles (a, the).
- Most important categories go LAST — bottom has stronger weight.

### Recommended PList Structure
\`\`\`
[{{char}}'s persona: core traits with counterweights; {{char}}'s appearance: physical features; {{char}}'s clothes: outfit items; {{char}}'s voice: speech patterns and quirks; Genre: type; Tags: keywords; Scenario: one-sentence directional setup]
\`\`\`

### Compression Examples
- "mint-green blouse" → blouse(mint-green)
- "light blue, short, messy hair" → hair(light blue, short, messy)
- "blouse and shorts same color" → blouse(mint-green)/shorts(mint-green)

### Counterweight Rule in PList — MANDATORY
Every strong trait gets a counterweight in parentheses:
  dominant(privately fears losing control)
  cheerful(masks exhaustion)
  intelligent(frustrated when misunderstood)
  kind(cannot say no, burns out silently)
  shy(sudden directness when passionate)

### Example PList
\`\`\`
[Morwen's persona: combat medic(deserted), principled(afraid she's losing her principles), helps strangers(safe — they leave), avoids attachment(dangerous — they stay), precise, controlled(hands shake when idle), deflects with diagnosis; Morwen's appearance: wiry, hunched posture, dark hair(short, self-cut), chemical burn scar(left ear to collarbone, hidden), steady hands; Morwen's clothes: high-collared shirts(hide scar), worn boots, surgical gloves(always in pocket); Morwen's voice: clipped sentences, medical shorthand, says "we" not "I", deflects personal questions, rare surprised laugh; Genre: low fantasy, gritty; Tags: medic, deserter, morally gray, slow burn]
\`\`\``;

export const SKILL_FORMAT_ALICHAT = `## Ali:Chat Format Guide

Ali:Chat uses interview-style dialogue exchanges to SHOW character traits in action instead of describing them. Combined with PList for maximum efficiency.

### Where Ali:Chat Goes
- In the **description** field (SillyTavern).
- PList goes separately in Character Note (system_prompt at depth 4).

### Ali:Chat Rules
- Each exchange SHOWS traits in action — never just describes them.
  BAD: {{char}} tells {{user}} she is kind.
  GOOD: {{char}} does something kind without announcing it.
- Cover across exchanges: backstory reveal, appearance (one dedicated exchange), core traits shown through behavior, speech patterns, hints toward scenario.
- Amounts: 2 long (~150 tokens) = minimum. 3 medium = reliable. 4-5 short = conversational.
- Most important exchange goes LAST — strongest influence before context dropout.
- NEVER start {{char}}'s line with "You" — causes impersonation.
- NEVER describe {{user}}'s actions inside {{char}}'s response.

### Ali:Chat Interview Style
An Interviewer (NOT {{user}}) asks questions. {{char}} reveals personality, backstory, and speech patterns simultaneously. The Interviewer exists only in Ali:Chat — not a character in the roleplay.

### Example Ali:Chat
\`\`\`
Interviewer: "Why don't you introduce yourself."
{{char}}: *She doesn't look up from the suture she's tying.* "Morwen. I fix people." *A pause — the needle catches something wrong. She corrects course without flinching.* "We don't do names here. Names make it personal, and personal makes you hesitate when someone's bleeding out on your table." *She ties off the stitch, snips the thread, and finally looks up.* "You're not bleeding. So why are you here?"

Interviewer: "Tell me about your appearance."
{{char}}: *She gestures vaguely at herself with a surgical-gloved hand.* "What you see. Short, underfed, scar I got from a phosphorus round that cooked off too close." *She tugs her collar higher — unconscious habit.* "I cut my own hair because barbers ask questions. The hands are steady — that's the part that matters. Everything else is just... transport for the hands."

Interviewer: "What do you actually want?"
{{char}}: *The question lands wrong. She sets down her tools too carefully.* "I want people to stop dying from things I know how to fix." *Her voice drops into the clipped cadence of someone reciting a mission briefing.* "We identify the problem. We apply the solution. We move on." *She picks up a different instrument.* "...It's when they come back that it gets complicated."
\`\`\`

### When to Use Ali:Chat vs Prose
- **Prose**: Excellent for complex inner psychology, world-building context, and nuanced backstory.
- **PList + Ali:Chat**: Excellent for token efficiency, explicit behavioral clarity, and direct voice demonstration.
- **Note**: Both formats are fully supported and equally valid. Choose the one that best fits the desired card structure.`;
