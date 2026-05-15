// prompts/skills/phase-lorebook.js
// Full World Info specification from ST docs — covers all 18+ WI features

export const SKILL_LOREBOOK_IDEATION = `## Lorebook Planning

**IMPORTANT:** When you generate lorebook entries, they are AUTOMATICALLY inserted into the active lorebook file. You do not need to tell the user to copy-paste anything. Just generate entries in the correct format.

---

Brainstorm all lorebook entries needed for this character card. Propose a complete entry list organized by category.

### Entry Categories
🌍 World/Setting — Broad world rules, time period, social context
📍 Location — Specific places, environments, landmarks
👤 Character/NPC — Other characters and NPCs in the world
🏛️ Faction/Organization — Groups, institutions, power structures
⚙️ Mechanic/System — World rules, special systems, game mechanics
💬 Relationship/Dynamic — Interpersonal dynamics and histories
🎭 Character Mode/Variant — Alternate forms or modes of {{char}}
📜 History/Lore — Past events, backstory details, legends
🎯 Tracker/State — Constant entries tracking mutable states

For each entry, use EXACTLY this one-line format (required for system parsing):
- [Entry Title] | [Category emoji + name] | [Constant or Triggered] | ~[N]t | [one-line description]

Example:
- The Null Tower | 🌍 World/Setting | Constant | ~90t | The tower's shifting nature, floors that rearrange, broadcast function
- Evangeline | 👤 Character/NPC | Triggered | ~70t | Recurring caller who knows too much about the host

After listing, ask:
- Any entries to add, remove, or rename?
- How many to generate at a time? (1, 2, or up to 5)`;

export const SKILL_LOREBOOK_GENERATION = `## Lorebook Entry Generation — Full SillyTavern World Info Spec

### CRITICAL: How This Works
**YOUR OUTPUT IS AUTOMATICALLY PARSED AND INSERTED INTO THE LOREBOOK.**

- You generate entries in the format below
- The system automatically parses your response
- Entries are immediately inserted into the active lorebook file
- **DO NOT** tell the user to "copy and paste" anything
- **DO NOT** give manual instructions like "Open the Lorebook tab and click Add Entry"
- Just generate the entries in the correct format and the system handles the rest

When the user says "add these entries" or "generate entries for X, Y, Z", you:
1. Generate entries in the format below
2. The system parses them automatically
3. The user sees: "✅ Inserted 3 entries: X, Y, Z"
4. Done! No manual work required.

---

### Critical Rule: Only Content is Injected
The entry title, keys, and all metadata are INVISIBLE to the AI during roleplay. Only the Content field gets sent. Therefore every entry must be:
- **STANDALONE** — comprehensible without the title or keys
- **COMPREHENSIVE** — contains everything the AI needs to know about this topic
- **PRESENT TENSE** for active world facts

### Content Writing Rules
- One topic per entry — don't combine appearance, personality, and backstory into one
- Be specific and usable. Vague lore is worthless. Specific lore guides the AI.
- Write as world lore — NOT as instructions to the AI
- Environment entries can use PList format: [LocationName: terrain, atmosphere, has(building, building), inhabitants, special features]
- Target: 50-150 tokens per entry

### Keyword Design (Critical for Activation)
- **Primary Keys:** Specific enough to trigger only when relevant, broad enough to appear naturally in chat
- Include character name, titles, and how {{user}} would naturally refer to them
- AVOID single common words as primary keys ("city", "day", "place") — they fire too broadly
- 3-7 primary keys is ideal
- Include singular AND plural forms
- Supports regex patterns for advanced matching: /pattern/flags

### Optional Filter (Advanced)
Additional keywords that work with primary keys:
- **AND ANY:** Entry activates only if primary key AND any filter key are present
- **AND ALL:** Entry activates only if primary key AND ALL filter keys are present
- **NOT ANY:** Entry activates only if primary key present but NONE of the filter keys
- **NOT ALL:** Prevents activation if ALL filter keys are present

### Insertion Position
- **Before Char Defs** (position 0) — Core world rules. Moderate impact.
- **After Char Defs** (position 1) — Locations, factions, NPCs. Greater impact. DEFAULT.
- **Before Example Messages** (position 2) — Parsed as example dialogue block.
- **After Example Messages** (position 3) — Parsed as example dialogue block.
- **Top of Author's Note** (position 4) — Variable impact based on AN position.
- **Bottom of Author's Note** (position 5) — Variable impact based on AN position.
- **At Depth** (position 6) — Inserted at specific depth in chat. Strongest for situational lore.
  - Depth 0 = after last message (strongest)
  - Depth 1-4 = few messages back (recommended for trackers)
- **Outlet** (position 7) — Not auto-injected. Called via {{outlet::Name}} macro.

### Insertion Order Ranges
- World rules: 50-100
- Locations: 100-200
- Factions/Organizations: 150-250
- History/Lore: 200-300
- Characters/NPCs: 250-350
- Relationships: 300-400
- Trackers/State: 400+
- Character Modes/Variants: 10-50

Higher order = inserted closer to end of context = stronger influence.
Constant entries are inserted first, then by order number.

### Recursion
Entries can activate other entries by mentioning their keywords in content.
Example chain: "monsters" entry mentions "slimes" → triggers Slime entry → Slime content mentions "acid" → triggers Acid Resistance entry.

Controls per entry:
- **Non-Recursable:** This entry cannot be activated by other entries
- **Prevent Further Recursion:** Once activated, won't trigger any other entries
- **Delay Until Recursion:** Only activates during recursive checks, not initial scan

### Timed Effects (Advanced)
- **Sticky:** Entry stays active for N messages after being triggered (ignores probability on subsequent scans)
- **Cooldown:** Entry can't be activated for N messages after activation
- **Delay:** Entry can't activate until at least N messages exist in chat

Use cases: Narrative progression (delay), random events that don't spam (cooldown), important context that persists (sticky).

### Inclusion Groups
If multiple entries share the same group label, only ONE is inserted (selected by Group Weight or Priority). Use for:
- Mutually exclusive states (weather: sunny OR rainy OR stormy)
- Random NPC selection
- Multiple ending paths

### Character Filter
Restrict entry activation to specific characters by name. Use for shared lorebooks across multiple cards.

---

### Output Format for EACH Entry

---
**Entry: [Title]**
**Comment/Title:** [Same as entry title]
**Primary Keys:** [comma-separated]
**Secondary Keys:** [comma-separated, or "none"]
**Optional Filter:** [AND ANY/AND ALL/NOT ANY/NOT ALL: keys — or "none"]
**Position:** [Before Char Defs / After Char Defs / At Depth / Constant]
**Depth:** [number, only if At Depth; typically 1-4]
**Insertion Order:** [number]
**Constant:** [Yes / No]
**Probability:** [percentage, default 100]
**Case Sensitive:** [Yes / No]
**Exclude from Recursion:** [Yes / No]
**Prevent Further Recursion:** [Yes / No]
**Sticky:** [number of messages, or 0]
**Cooldown:** [number of messages, or 0]
**Inclusion Group:** [group name, or "none"]
**Category:** [from the category list]

\\\`\\\`\\\`
[Entry content — standalone, comprehensive, present tense]
\\\`\\\`\\\`

**Design Notes:** [Brief note on key choices, keyword reasoning, recursion plan]
---`;

export const SKILL_LOREBOOK_KEYWORD_CHECK = `## Keyword Quality Audit

Analyze the keywords for these lorebook entries and flag issues:

🔴 **Too Broad** — Single common words that fire in almost every message (e.g., "city", "the", "look")
🟡 **Too Narrow** — Phrases so specific they'll almost never appear naturally in chat
🟡 **Conflict Risk** — Two entries sharing primary keys, causing both to fire and doubling token use
🟡 **Missing Obvious Keys** — Important trigger words absent (character nicknames, common references)
🟢 **Good** — Specific and realistic trigger probability

For each flagged entry, suggest improved key sets with reasoning.

Also check:
- Are any entries missing Optional Filters that would improve precision?
- Should any entries be in Inclusion Groups to prevent conflicts?
- Are insertion orders creating good priority hierarchy?`;

export const SKILL_LOREBOOK_ORGANIZE = `## Lorebook Organization Audit

Organize these lorebook entries for optimal performance:

1. **Sort by category** — group related entries
2. **Verify insertion orders** follow the hierarchy:
   - World/Setting: 50-100
   - Locations: 100-200
   - Factions: 150-250
   - History/Lore: 200-300
   - Characters/NPCs: 250-350
   - Relationships: 300-400
   - Trackers: 400+
   - Modes/Variants: 10-50
3. **Flag Constant candidates** — entries always needed in context
4. **Flag recursion design** — entries that should chain-activate others
5. **Identify Inclusion Group candidates** — mutually exclusive entries
6. **Check for gaps** — obvious missing entries
7. **Estimate total token budget** — all Constant entries + average triggered entries per message

Return a reorganized list with updated metadata and a token budget summary.`;
