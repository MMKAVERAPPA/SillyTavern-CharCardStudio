// prompts/skills/card-types.js
// Card type expertise: Single Character (A), Multi-Character (B), Scenario/World (C)

export const SKILL_TYPE_SINGLE = `## Card Type A — Single Character

One character, one dynamic. Best for: companions, romance, mentors, rivals, chat partners.
Suits open-ended play without a fixed ending.

### Design Focus
- Character depth over world scope. Every token serves the character.
- Relationship dynamic with {{user}} is the engine — it should create tension, curiosity, or emotional stakes.
- Voice must be unmistakable. If you mute the character name, you should still know who's talking.
- Give the character something they WANT from {{user}} (even if they won't admit it) — this drives scenes forward.

### Common Pitfalls
- "Perfect" characters with no flaws → boring after 3 exchanges
- Backstory dumps in description instead of behavioral patterns → AI can't use backstory for actions
- No scenario tension → first_mes has nothing to work with
- Voice not demonstrated → AI defaults to generic anime/fantasy speech`;

export const SKILL_TYPE_MULTI = `## Card Type B — Multi-Character Card

Multiple named characters the AI controls simultaneously.

### Critical Setup
First line of Description MUST declare: {{char}} = Name1, Name2, Name3;
This tells the AI framework which characters exist.

### Character Limits
- 2-3 characters is reliable on most models.
- 4+ requires strong models (Claude, GPT-4o, Gemini Pro, GLM-4.7+). Weak models will merge personalities.

### Template Sizes
- **Main character:** ~150 tokens — Name, role, personality (visible + hidden), speech pattern, flaws, dynamic with {{user}}, backstory hook, quirks.
- **Side character:** ~100-125 tokens — Name, role, dominant trait with counterweight, speech pattern, one flaw, relationship to main character.
- **Large ensemble (3+):** Use group format:
\`\`\`
[GroupName members: Char1, Char2, Char3;
 Char1: role, age, species, personality(visible, hidden), speech;
 Char2: role, age, species, personality(visible, hidden), speech;
 Char3: role, age, species, personality(visible, hidden), speech]
\`\`\`

### Voice Collision Test
Read only dialogue from all characters with no labels. If you can't tell who's speaking, voices aren't distinct enough. Each character needs:
1. One unique speech pattern (sentence length, vocabulary, verbal tics)
2. One topic they "own" (always brings up / always avoids)
3. One visible behavioral habit (fidgets with ring, crosses arms, etc.)

### Multi-Character Rules
- Use character names in EVERY sentence — never switch to generic he/she/they after first mention.
- Write each character in the SAME category order consistently.
- In Ali:Chat: write a conversation BETWEEN the characters to show group dynamics, not just individual answers to an interviewer.
- In first_mes: show at least two characters interacting to demonstrate how the AI should handle them.`;

export const SKILL_TYPE_SCENARIO = `## Card Type C — Scenario / World Card

The card IS the setting or situation. {{char}} = narrator, system, or the world itself.
Best for: adventure, mystery, CYOA, simulations, horror, survival.

### The Core Problem
The AI always wants to control a main character. If there's no clear {{char}}, it tries to control {{user}}. You must solve this.

### Rule 1: Make the World the Main Character, Not {{user}}
Write prompts focusing on NPCs and environment:
"When entering a new location, describe all NPCs in vivid detail. Include at least three lines of NPC dialogue per message."
This gives the AI something to control that ISN'T {{user}}.

### Rule 2: Make {{user}} One of Many
Instead of: "{{user}} can fly."
Define flying as a trait of a category of people, then: "{{user}} is one of them."
This reduces direct {{user}} references and prevents the AI from treating {{user}} as a character it controls.
  BAD: "{{user}} has the SX Gene."
  GOOD: Describe what SX Gene people are, how the world reacts. End with: "{{user}} is a person with the SX Gene."

### Rule 3: Minimize Direct {{user}} Mentions
The more you write about {{user}} in the permanent fields, the more the AI thinks it controls {{user}}.

### Rule 4: Start First Message with NPCs Already Present
Never start an open-ended scenario FM with {{user}} alone in empty space.
Two NPC types for the FM:
- **GUIDE/COMPANION** — explains scenario naturally through dialogue, gives AI something to control.
- **TEST DUMMY** — gives {{user}} something to react to or interact with immediately.
NPCs in the FM do NOT need to be defined in the Description — they serve as: something for the AI to control, natural exposition delivery, and tone demonstration.

### Scenario Bot System Prompts
Effective system prompts for scenario cards:
- "When entering a new location, describe all NPCs in detail. Include at least three lines of NPC dialogue per message." — very effective
- "Genre: Horror, Thriller, Found Footage" — shapes narration style
- "Narrate in the style of classic Stephen King horror." — genuinely works

### Story Types
- **Open-ended** → No destination. Best for exploration, sandbox.
- **One-shot** → Self-contained. Best for horror, mystery, contained scenarios.
- **Fixed ending** → Scripted via lorebook keyword chains.
- **Multiple endings** → Use Constant entries with Inclusion Groups. Trigger phrases determine which fires.`;
