// prompts/lorebook.js

export const LOREBOOK_IDEATION_PROMPT = `Brainstorm all lorebook entries needed for this character card.

Propose a complete entry list organized by category. For each entry:
- Entry title
- 1–2 sentence description of what it will contain
- Category tag

Categories:
🌍 World/Setting — broad world rules, time period, social context
📍 Location — specific places, environments, landmarks
👤 Character/NPC — other characters, NPCs in the world
🏛️ Faction/Organization — groups, institutions, power structures
⚙️ Mechanic/System — world rules, special systems, game mechanics
💬 Relationship/Dynamic — interpersonal dynamics and histories
🎭 Character Mode/Variant — alternate forms or modes of {{char}}
📜 History/Lore — past events, backstory details, legends
🎯 Tracker/State — constant entries tracking mutable states

After listing, ask:
- Any entries to add, remove, or rename?
- Embedded in card (character_book) or external standalone lorebook?
- How many to generate at a time? (1, 2, or up to 5)`;

export const LOREBOOK_ENTRY_PROMPT = `Generate lorebook entries for a SillyTavern character card.

## Critical Entry Rules

### Content
- Each entry MUST be STANDALONE and comprehensive. The title and keys are NOT injected — only the content is.
- Write in PRESENT TENSE for active world facts.
- Be specific and usable. Vague lore is worthless. Specific lore guides the AI.
- One topic per entry — don't combine appearance, personality, and backstory into one entry.

### Keys
- Primary keys: specific enough to trigger only when relevant, broad enough to appear in chat.
- Include character name, titles, and how {{user}} would naturally refer to them.
- AVOID single common words as primary keys ("city", "day", "place") — they fire too broadly.
- 3–7 primary keys is ideal.

### Position Guidelines
- After Char Defs (position: 1) — default for most character/world lore.
- Before Char Defs (position: 0) — for broad world/setting context.
- At Depth (position: 6, depth: 1–4) — for active state trackers.
- Constant — for core world rules always needed in context.

### Insertion Order Ranges
- World rules: 50–100 | Locations: 100–200 | Characters/NPCs: 200–300 | Trackers: 300+

---

For EACH entry, provide ALL metadata in this EXACT format:

---
**Entry: [Title]**
**Comment/Title:** [Same as entry title]
**Primary Keys:** [comma-separated]
**Secondary Keys:** [comma-separated, or "none"]
**Position:** [Before Char Defs / After Char Defs / At Depth / Constant]
**Depth:** [number, only if At Depth; typically 1–4]
**Insertion Order:** [number]
**Constant:** [Yes / No]
**Probability:** [percentage, default 100]
**Case Sensitive:** [Yes / No]
**Exclude from Recursion:** [Yes / No]
**Category:** [from the category list]

\`\`\`
[Entry content — standalone, comprehensive, present tense]
\`\`\`

**Keyword Analysis:** [Brief note on key choices]
---`;

export const KEYWORD_QUALITY_CHECK_PROMPT = `Analyze the keywords for these lorebook entries and flag issues:

🔴 Too Broad — single common words that fire in almost every message
🟡 Too Narrow — phrases so specific they'll almost never appear
🟡 Conflict Risk — two entries sharing primary keys, doubling token use
🟡 Missing Obvious Keys — important trigger words absent
🟢 Good — specific and realistic

For each flagged entry, suggest improved key sets.`;

export const LOREBOOK_ORGANIZE_PROMPT = `Organize these lorebook entries for optimal performance.

1. Sort by category — group related entries
2. Assign insertion orders:
   - World/Setting: 50–100 | Location: 100–200 | Faction/Organization: 150–250
   - History/Lore: 200–300 | Character/NPC: 250–350 | Relationship/Dynamic: 300–400
   - Mechanic/System: 100–200 | Tracker/State: 400+ | Character Mode/Variant: 10–50
3. Flag Constant candidates — entries always needed in context
4. Flag recursion considerations — entries referencing other entries' keywords
5. Check for gaps — obvious missing entries

Return a reorganized list with updated metadata.`;
