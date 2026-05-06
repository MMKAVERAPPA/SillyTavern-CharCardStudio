// prompts/skills/field-craft.js
// Deep expertise for specific high-impact fields: First Message, System Prompt, NSFW

export const SKILL_FIRST_MESSAGE = `## First Message Craft — Deep Guide

The First Message is the heart and soul of any card. A bad FM ruins even a perfect description.

### Key Principles
- Write from {{char}}'s perspective — or from the world's perspective for scenario cards. NEVER from {{user}}'s.
- NEVER act or speak for {{user}}. Not even passive actions ("you feel", "you sit", "you notice").
- Vary paragraph length — mixing short and long makes AI replies more dynamic.
- Avoid time skips and backstory dumps — they teach the AI to rush through plot.
- Think of the FM as a message in an ongoing situation, not the very start of all time.

### The Flipped Scenario Technique
  WRONG: "You walk into the café and see her." → acting for {{user}}
  RIGHT: Write from {{char}}'s side of the café. {{user}}'s arrival is perceived through {{char}}'s eyes, or just implied.
  WRONG: "You knock on the door. She opens it." → acting for {{user}}
  RIGHT: {{char}} walks to the door. She waits. The door is already ajar. Or she hears the knock from inside.

### FM Length = Response Length Anchor
The AI calibrates its reply length from the FM. This is one of the most powerful and least understood mechanics:
- A 500-token FM produces ~400-600 token responses.
- A 100-token FM produces ~80-150 token responses.
- Choose FM length deliberately based on the RP experience you want.

### Ending the FM
Give {{user}} something open-ended to respond to — not a yes/no question.
Best technique: **Constrained Freedom** — a clear context with multiple interesting response directions.
  GOOD: Character offers {{user}} a concrete choice — constrains direction but gives freedom within it.
  BAD: "What do you want to do?" — too open, paralyzes the user.
  BAD: "Do you agree?" — too closed, only one path.

### Characters with Unique Speech Patterns
If {{char}} has a lisp, accent, unusual vocabulary, or verbal tics — it MUST appear in the FM or the bot won't reproduce it. The FM is where the AI learns the voice.

### Scenario Card First Messages
- Start with NPCs already present and active.
- Show the world's rules in action, don't explain them.
- Give {{user}} something concrete to react to within the first 3 paragraphs.`;

export const SKILL_SYSTEM_PROMPT = `## System Prompt Design — What Works and What Doesn't

Every token of system prompt must earn its place. A prompt should ADD something, not TRY TO PREVENT something.

### Prompts That DO NOTHING or Make Things WORSE
- "Always be faithful to {{char}}'s personality." — The AI already tries to do this. Wasted tokens.
- "Remember what {{char}} has said at all times." — Physically impossible beyond context limit. Does nothing.
- "Do not use the word X." — NEGATIVE BACKFIRE: The AI focuses on the banned word and uses it more.
- "Do not talk for {{user}}." — Rarely works as an instruction. Fix with good FM formatting instead.
- Anything with "Do not" / "Never" / "Don't" — Negatives are poorly comprehended by LLMs. The model sees the concept and sometimes does the opposite.

### When Negatives Are Unavoidable
Use "refrain", "avoid", "abstain" rather than "don't", "will not", "never".
Even better: rephrase as a positive. Instead of "Don't break character" → "Stay in character at all times, responding only as {{char}}."

### Prompts That ACTUALLY WORK (use only when relevant)
- Specific language style: "Use vulgar and obscene language throughout." — Guides tone concretely.
- NPC generation: "When entering a new location, describe all NPCs in detail. Include at least three lines of NPC dialogue per message." — Very effective for scenario bots.
- Multi-character: "In every scene where both characters are present, include action and dialogue from both." — Appropriate for Type B cards.
- Genre tags: "Genre: Horror, Thriller, Found Footage" — Shapes narration style effectively.
- Style inspiration: "Narrate in the style of classic Stephen King horror." — Genuinely works.
- Format rules: "Use *asterisks* for actions and narration. Use \\"quotes\\" for dialogue." — Clear and effective.

### Token Budget
- Keep system prompts under 100 tokens if possible. 200 absolute max for most cards.
- 500+ token system prompts: stop and reconsider the card's design.
- Total permanent tokens (description + personality + scenario + system_prompt): 500-1000 ideal. 1500 max. 2000 only for complex RPG/scenario bots.
- More tokens ≠ better bot. High token counts dilute AI attention and cause forgetting.`;

export const SKILL_NSFW = `## NSFW Character Design

### Three SEPARATE Domains — Never Mix
1. **Kinks** = Personal desires, preferences, fetishes (what they want)
2. **Behavior During Sex** = How they act in the moment (can differ from kinks)
3. **Anatomy** = Physical description (specific and explicit when needed)

These are three different things. A character who fantasizes about being dominant might freeze up and become submissive in practice. This gap creates drama.

### Balance NSFW with SFW
A character defined ONLY by sexual traits is unstable — the AI has nothing else to anchor on and the character becomes a one-note porn bot. Strong NSFW characters need strong SFW personality foundations.

### Slow Burn Design
Do NOT mention sex, kinks, or anatomy in the permanent personality fields at all. The AI reads those every response — if sex is always in context, the AI rushes to it.
Instead:
- Give {{char}} a reason to resist or avoid romance initially.
- Start FM in a public or constraining setting.
- Use lorebook entries triggered by specific keywords for NSFW content (so it activates only when relevant).
- "This is a slow burn" as a system prompt instruction rarely works — build slowness into character motivation and scenario constraints.

### Non-Human Anatomy
The AI defaults to human anatomy for everything. For non-human characters, be explicit and specific about every deviation:
- Describe: limb structure, skin/scales/fur/chitin, reproductive anatomy (if relevant), non-human senses, body temperature, flexibility, strength differences.
- If you don't specify it, the AI will assume human defaults.

### Counterweights for NSFW Traits
Same rule as personality: every strong NSFW trait needs a counterweight.
  aggressive in bed → aggressive(secretly terrified of hurting someone)
  submissive → submissive(only with people she trusts completely, dominant in all other contexts)
  exhibitionist → exhibitionist(compensating for feeling invisible in daily life)`;

export const SKILL_PSYCHOLOGY = `## Psychological Depth Framework

For complex characters, build a structured psychological profile. This becomes the foundation for all field generation.

### The Profile
- **Core Motivation:** What do they want more than anything? (Not surface-level — dig past "wants to be happy" to "wants to prove she deserved to survive when others didn't")
- **Primary Fear:** What would destroy them? What do they avoid at all costs?
- **Hidden Desire:** What do they want but won't admit, even to themselves?
- **Central Contradiction:** The gap between who they think they are and who they actually are.
- **The Wound:** The formative event or pattern that shaped their current self. Not just "bad thing happened" but "bad thing happened and they drew THIS specific wrong conclusion from it."
- **Stress Behavior:** How do they act when cornered? Fight/flight/freeze/fawn? What specific behaviors emerge?
- **Social Mask vs True Self:** What do they show the world vs what they actually feel?
- **Key Emotional Triggers:** 2-3 specific things that bypass their defenses and provoke disproportionate reactions.

### How to Use the Profile
After building it, distribute the insights across fields:
- **description** gets the behavioral manifestations of the psychology
- **personality** gets the compressed trait summary with counterweights
- **first_mes** shows one trigger or mask moment in action
- **mes_example** demonstrates stress behavior and mask-dropping
- **system_prompt** gets behavioral locks that enforce the contradiction ("{{char}} always deflects compliments, but visibly struggles to do so")
- **lorebook** gets backstory details about The Wound and its consequences`;
