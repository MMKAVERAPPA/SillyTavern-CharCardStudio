# CharCardStudio v2 — Agentic Edition
## Comprehensive Design & Build Document
### For AI-assisted implementation

---

> **How to use this document:**
> This is a complete specification intended to be handed to an AI coding assistant (Claude) to plan and implement the extension. Every section contains the "why", the "what", and the "how" at a technical level. The AI should read this entire document before writing a single line of code.

---

## 0. Quick Reference: What's Being Built

A SillyTavern extension that acts as an **agentic character card creation studio**. The user describes a character concept in natural language; the agent plans, clarifies, and executes — writing directly into ST's character fields, generating lorebook entries, staging everything for review. Multiple isolated modes handle specialized tasks (JanitorAI conversion, HTML intros, image prompts, FictionLab — each in its own context so they don't pollute the main card-building session).

**The core problem with v1:** The AI was prompted once per message and expected to output perfectly parseable content. One deviation broke everything. There was no agent loop, no tool system, no state contract between phases, no cancel button, no delete/regenerate, and the pillar tracking was cosmetic UI fiction disconnected from actual AI behavior.

**v2 solves this with:** A real agent loop using ST's native `registerFunctionTool()` API for tool calling (when supported) with a JSON-block fallback for models that don't support it. Every output is a staged draft — the AI proposes, the user commits. Sessions are fully persistent. Modes are fully isolated.

---

## 1. Technical Foundation

### 1.1 ST Extension API — What We Actually Have

Based on the official ST docs (`docs.sillytavern.app/for-contributors/writing-extensions/`):

**Context API (`SillyTavern.getContext()`):**
```javascript
const ctx = SillyTavern.getContext();
ctx.chat                    // Mutable chat log array
ctx.characters              // Full character list
ctx.characterId             // Index of current character
ctx.getCharacters()         // Fetch character data
ctx.saveCharacterDebounced() // Persist character changes
ctx.generateQuietPrompt({ quietPrompt, ... }) // Background AI call
ctx.generateRaw({ prompt, ... })              // Raw AI call
ctx.registerFunctionTool({ name, description, parameters, action, formatMessage, stealth })
ctx.unregisterFunctionTool(name)
ctx.isToolCallingSupported()    // Check if current API supports tools
ctx.canPerformToolCalls(type)   // Check if tools can fire for generation type
```

**Event System:**
```javascript
import { eventSource, event_types } from '../../../../script.js';
eventSource.on(event_types.APP_READY, handler)
eventSource.on(event_types.MESSAGE_RECEIVED, handler)
eventSource.on(event_types.CHARACTER_EDITED, handler)
eventSource.on(event_types.GENERATION_STARTED, handler)
eventSource.on(event_types.GENERATION_ENDED, handler)
eventSource.on(event_types.WORLDINFO_UPDATED, handler)
```

**Persistent Settings:**
```javascript
import { extension_settings, saveSettingsDebounced } from '../../../../script.js';
extension_settings['CharCardStudio'] = { ...myData };
saveSettingsDebounced();
```

**Shared Libraries available via `SillyTavern.libs`:**
`lodash`, `localforage`, `Handlebars`, `DOMPurify`, `DiffMatchPatch`, `Bowser` (for mobile detection)

**World Info API:**
```javascript
import { getWorldInfo, createWorldInfoEntry, saveWorldInfo, updateWorldInfoEntry }
  from '../../../../scripts/world-info.js';
```

**World Info entry fields** (from kingbri guide + ST source):
- `key` (array of trigger keywords)
- `keysecondary` (secondary AND/NOT keys)
- `content` (the injected text)
- `comment` (display name / memo)
- `constant` (boolean — always inject)
- `selective` (boolean — AND condition on secondary keys)
- `selectiveLogic` (0=AND, 1=NOT, 2=AND_NOT)
- `position` (0=before char, 1=after char, 2=author's note top, 3=author's note bottom, 4=at depth)
- `depth` (injection depth if position=4)
- `order` (insertion order — higher = inserted first)
- `probability` (0-100)
- `disable` (boolean)
- `excludeRecursion` / `preventRecursion` (non-recursable flag)
- `scanDepth` (how many messages to scan)
- `group` / `groupWeight` (group scoring)

### 1.2 The Agent Loop — Two Modes

**Mode A: Native Function Tools (preferred)**

When `isToolCallingSupported()` returns true (Claude, GPT-4o, Gemini via Chat Completion):

```javascript
ctx.registerFunctionTool({
  name: 'write_field',
  displayName: '✍️ Write Card Field',
  description: 'Writes content to a specific ST character card field',
  parameters: {
    type: 'object',
    properties: {
      field: { type: 'string', enum: ['description','personality','scenario','first_mes','mes_example','system_prompt','creator_notes'] },
      content: { type: 'string' }
    },
    required: ['field', 'content']
  },
  action: async ({ field, content }) => {
    await stageFieldDraft(field, content);
    return `Staged draft for ${field}. User must approve before applying.`;
  },
  stealth: false  // show tool calls in chat
});
```

**Mode B: JSON-block parsing (fallback)**

For Text Completion APIs (llama.cpp, KoboldCpp, TabbyAPI, Ooba) that don't support tool calling:

The system prompt instructs the model to output tool calls in a specific JSON block:
```
<tool_call>
{"tool": "write_field", "args": {"field": "description", "content": "..."}}
</tool_call>
```

The extension's message handler intercepts every AI response, extracts `<tool_call>` blocks via regex, executes the corresponding JS function, feeds the result back into the next prompt as a `<tool_result>` block, and continues. This is the same loop pattern used by World-Forge (Python) — just implemented in browser JS with ST's streaming API.

**AbortController for cancellation:**
```javascript
let currentAbortController = null;

async function runGeneration(prompt) {
  currentAbortController = new AbortController();
  try {
    const result = await ctx.generateRaw({
      prompt,
      signal: currentAbortController.signal
    });
    return result;
  } catch (e) {
    if (e.name === 'AbortError') return null;
    throw e;
  }
}

function cancelGeneration() {
  currentAbortController?.abort();
}
```

### 1.3 Session Persistence

Sessions use `localforage` (IndexedDB, available via `SillyTavern.libs.localforage`) for large data and `extension_settings` for lightweight config.

```javascript
const lf = SillyTavern.libs.localforage;

// Save session
await lf.setItem(`ccs_session_${characterName}`, JSON.stringify(sessionState));

// Load session
const raw = await lf.getItem(`ccs_session_${characterName}`);
const session = raw ? JSON.parse(raw) : createNewSession();
```

Session state object:
```javascript
{
  version: '2.0',
  characterName: string,
  characterId: string | null,
  mode: 'studio' | 'janitor' | 'html' | 'imageprompt' | 'fictionlab',
  phase: 'ideate' | 'build' | 'lore',
  chatHistory: Message[],        // per-mode
  pillarStates: PillarState[],
  stagedDrafts: StagedDraft[],
  conceptSummary: string,
  platformTarget: 'st' | 'janitor' | 'chub' | 'all',
  tokenTier: 'compact' | 'standard' | 'rich',
  linkedLorebook: string | null,
  conflictLog: Conflict[],
  cardFormat: 'plist' | 'alichat' | 'prose' | 'hybrid',
  lastSaved: timestamp,
  toolMode: 'native' | 'json_block'  // auto-detected
}
```

---

## 2. Writing Formats — What the Agent Knows

From the reference docs provided (Ali:Chat, Kingbri guide, PList+AliChat guide, World Info Encyclopedia), the agent must understand and be able to generate in all of these formats:

### 2.1 Description Formats

**PList (Python List):**
```
[Character = proud, wise, confident, independent, calm, talented, stern, aloof]
[Character's body = beautiful, athletic body, long purple hair, red eyes, medium chest]
[Character's clothes = dark purple silky bodysuit, metallic shoulder pads]
```
Rules: space before first trait, no capitalizing traits, separate entries with `;` in combined PLists, use `(grouping)` for compound attributes e.g. `hair(light blue, short, messy)`, use `/` to separate objects e.g. `blouse(mint-green)/shorts(denim)`.

**Ali:Chat:**
Dialogue examples that express traits through character behavior. Format: `{{user}}: question\n{{char}}: response with *actions in asterisks*`

Rules: 2 long or 3 short examples (5-6 lines each), every example must reinforce specific traits, never start {{char}} response with "You", include character name at least once per example for reinforcement, vary action descriptors to prevent repetition bias, lowercase actions unless proper noun. Keep total Ali:Chat tokens under 600 (permanent context).

**Hybrid PList+Ali:Chat:**
PList defines traits → Ali:Chat reinforces and demonstrates them. This is the recommended approach for modern ST cards. Structure: PList in Description box (or Author's Note via Character Author's Note feature), Ali:Chat examples after `<START>` in Description.

**Prose:**
Full paragraph prose describing character. Less token-efficient but better for complex personalities. The Android card uses this approach.

### 2.2 System Prompt Rules (from preset v6)

These rules are the agent's identity and are injected into every card-building system prompt:
- All pasteable content in code blocks, explanations outside
- Never use banned generic names — ask about world culture first
- Never write `don't/never/do not` in system prompts — write what the AI **should** do
- Never act or speak for `{{user}}`
- Platform-specific formatting rules active based on target platform
- No repeated feelings/actions (vary synonyms: `blushes` → `flustered`)
- Token micro-optimization: compress actions (`she smiles deviously` → `deviously chuckles`)

### 2.3 World Info Entry Formats (from World Info Encyclopedia)

**Environment entry (simple PList):**
```
Keys: location_name, alias1, alias2
Content: [LocationName(alias): characteristic1, characteristic2, has(thing1, thing2)]
Position: Before character (depth matters less for world context)
Order: 100
```

**Lore entry (PList + Ali:Chat):**
```
Keys: trigger_word1, trigger_word2
Content:
[EntryName: trait1, trait2, relationship_to_char]
{{user}}: question about this entry
{{char}}: response that shows how char feels/reacts to this entry
Position: After character
Order: 100
```

**Recursion pattern:**
- Entry A has `non-recursable` OFF → its content can trigger Entry B
- Entry B has `non-recursable` ON (leaf node, no further recursion)
- Use for tree structures: `monsters` → triggers `slime PList` → triggers `slime Ali:Chat` (non-recursable)

**Placement strategy:**
- PLists at depth 5 (above author's note)
- Ali:Chat entries: After character position  
- Constant entries: World frame, permanent lore
- Conditional entries: Outfit alternatives, location-specific info, NPC reactions
- Character filter: Use for entries only one character should know

### 2.4 Lorebook vs World Info distinction
- **World Info** = global, applies to all characters (shared world lore, environment)
- **Lorebook** = character-specific, linked to one character (personal lore, relationships, private knowledge)
- Agent must ask which type each entry should be and link accordingly

---

## 3. Modes

### 3.1 🏗️ Studio Mode (Primary)

**Three phases, fully isolated session state.**

#### Phase 1: 💡 Ideate

**Agent behavior:**

Step 1 — Intake. User dumps their idea in any form. Agent reflects back what it understood.

Step 2 — Crystallization. Agent proposes:
- Core Identity (what this character fundamentally IS)
- Tonal Register (dark/gothic/comedic/tragic/slice-of-life/post-apoc/etc.)
- Card Format (PList / Ali:Chat / Hybrid / Prose — agent recommends based on character complexity)
- Platform Target (ST-only / also Janitor / also ChubAI)
- Token Tier (Compact <2K / Standard 2K-4K / Rich 4K+)
- Writing Style notes (quirks of speech, action descriptors, naming conventions)

Step 3 — Pillar Definition. Agent proposes the full pillar list. User approves/adjusts.

**Structural Pillars** (card fields):
| Pillar | Description | Format guidance |
|---|---|---|
| Name | Character name | Ask culture/world context first. Never generic. |
| Description | Core identity block | PList + Ali:Chat (or Prose for complex chars). Permanent. |
| Personality | Summary box | Brief PList or Boostyle to reinforce key traits. "Disable personality formatting" in ST settings recommended. |
| Scenario | World-frame | Permanent. Disable scenario formatting. Use `[Scenario: ...]` SBF format if needed. |
| First Message | Cinematic opening | Third-person perspective, flipped scenario technique. No impersonation. |
| Example Messages | Voice reinforcement | 2-3 `<START>` blocks. Each must reinforce different traits. 300-600 token limit. |
| System Prompt | Behavioral rules | Positive phrasing only. Token-budgeted. No `don't/never`. |
| Creator Notes | Chub/card-site blurb | Spoiler-free hook. Platform-aware. |
| Alternate Greetings | Variant openings | 2-3 alternates, each with different scenario entry point |
| Author's Note | Per-character injection | Goes in Character Author's Note (not global A/N). PList or compact summary. |
| Optional Tracker | State tracking | Shift-Meter / Bond-Stage / Static-Level / custom / none |
| Tags | Discoverability | Genre, content warnings, platform tags |

**World Pillars** (lorebook entries — dynamic based on character type):

For world-scenario characters (like Shattered Earth):
- Locations (1 entry per area, SBF PList format)
- Factions (1 entry per group)
- History/Events (keyword-triggered lore drops)
- Species/Creatures (if non-human entities)
- Technology/World Rules (world-specific mechanics)
- NPCs (supporting characters, Ali:Chat reaction entries in lorebook)
- Recursion Meta-entries (category indices → individual entries)

For character-centric cards (like Android With Too Much Soul):
- Configuration/Mode entries (each mode = 1 lorebook entry, keyword-triggered)
- Relationship entries (NPCs the character knows)
- Location entries (their personal spaces)
- Personal History entries (events in their past, not in description)
- Hidden Knowledge entries (things only revealed when contextually triggered)

Step 4 — Concept Tab populated:
- Concept summary text
- Confirmed pillars checklist (Pending/In Progress/Done/Skipped)
- Platform target + token tier + format type
- Live card quality score (1-5 stars) with reasoning
- Conflict log (empty at start)

**Quick-action chips during Ideate:**
`Rate my concept` | `Suggest 3 archetypes` | `What pillars do I need?` | `Show concept pros/cons` | `Make it more original` | `Suggest a format` | `Token budget estimate`

#### Phase 2: 📝 Build

**Agent works through Structural Pillars one by one.**

For each pillar:
1. Agent generates using correct format (PList/Ali:Chat/Prose per pillar type)
2. Draft appears in chat as a staged message with action buttons: ✅ Apply | 🔄 Regenerate | ✏️ Edit | ⏭️ Skip
3. If Apply: `write_field` tool fires, ST card field is updated, pillar marked Done
4. If Edit: inline text editor appears in the staged draft
5. If Skip: pillar marked Skipped with reason logged
6. Background check fires via `generateQuietPrompt` after each pillar (fast/cheap model if Utility API configured):
   - Does this contradict anything already written?
   - Token budget check
   - Platform compatibility check
   - Results shown in Concept tab Conflict log

**Smart sequencing:**
Description → Personality → System Prompt → Scenario → First Message → Example Messages → Creator Notes → Author's Note → Alternate Greetings → Tracker → Tags

**Why this order:** Description is the foundation everything references. Personality informs system prompt. System prompt needs personality to write its behavioral rules. Scenario needs description context. First message needs scenario + personality. Examples need voice to be established.

**What the agent CANNOT do without explicit permission:**
- Overwrite an already-applied pillar without asking
- Change character name after it's set
- Apply anything without staging first
- Jump ahead in sequence without flagging it

**Quick-action chips during Build:**
`Generate next pillar` | `Audit current card` | `Suggest counterweights` | `Check token budget` | `Skip this pillar` | `Compress this field` | `Show field preview`

#### Phase 3: 📖 Lore

**Full lorebook pipeline.**

Step 1 — Category planning. Agent proposes the complete entry list:
```
📍 Locations (3): Neo-Tokyo, Seoul Fortress, The Dead Forest
⚔️ Factions (2): Hunter Guild, The Eastern Coalition  
👤 NPCs (4): [names]
📜 History (2): The Collapse, The Zero Event
🔗 Recursion Meta (1): world_threats → triggers creature entries
```
User approves plan before any entries are generated.

Step 2 — Batch generation. Agent generates one category at a time. Each batch shown for review before being written to ST world info.

Step 3 — Entry configuration. For each entry:
- Trigger keywords proposed (following World Info Encyclopedia principles)
- Position assigned (Before char for environment PLists, After char for Ali:Chat lore)
- Insertion order set (100 for most, 2/998 for PList base world brackets)
- Constant vs conditional decision
- Recursion links mapped
- Character filter applied if relevant

Step 4 — Recursion map displayed in Lore tab showing which entries chain to which.

Step 5 — World Info link. Agent asks: Global World Info (all characters) or Character Lorebook (this character only)? Creates and links accordingly.

**Token budget tracking:**
Agent tracks cumulative WI token cost against the configured Context % (default 25%) and warns when approaching limit. Suggests compression or splitting.

**Entry format templates** (agent knows all of these):

Environment entry:
```
[LocationName(alias): characteristic, has(thing1, thing2), state]
```

Lore entry (Ali:Chat style):
```
[EntryName: relationship_to_char, trait1, trait2]
{{user}}: question about entry
{{char}}: *action* response showing char's feelings about it
```

Complex NPC entry (relationship + lore):
```
[NPCName: role, relationship_type, personality_tags]
{{user}}: Who is NPCName?
{{char}}: *action* response establishing relationship and char's feelings
```

**Quick-action chips during Lore:**
`Generate next batch` | `Show recursion map` | `Compress this entry` | `Add NPC entry` | `Add location entry` | `Check consistency` | `Token budget check` | `Export lorebook`

---

### 3.2 🤖 JanitorAI Conversion Mode

**Isolated context. Separate chat history.**

Activated when user says anything like "convert to janitor", "make a janitor version", "JanitorAI mode".

**What the agent knows about JanitorAI:**

From the preset v6 JanitorAI section:
- JLLM (Janitor LLM) is context-limited: 4000–9000 tokens (fluctuates with server load)
- Significantly weaker than large cloud models
- ST Description → Janitor **Personal** field
- Different formatting tolerance: simpler is better
- No complex nested PLists — flatten to simple comma lists
- HTML is NOT supported in standard Janitor cards (only specific inline tags)
- Janitor uses `<START>` as separator (same as Pygmalion)
- Token budget: aim for <2000 tokens total for the card body
- No World Info equivalent — everything must be in the card fields
- System prompt equivalent: **Custom Instructions** field

**Conversion steps the agent performs:**
1. Reads current ST card via `read_card` tool
2. Identifies what can be preserved and what must be simplified
3. Rewrites each field for JLLM:
   - Description → compress, flatten PLists, remove complex formatting
   - Personality → simplest PList possible or brief prose
   - Scenario → keep short, concrete
   - First message → preserve but check length
   - System prompt → convert to Janitor Custom Instructions format, simplify
4. Stages complete converted card for review
5. Offers export as Janitor-compatible JSON

**Key conversion rules:**
- Remove all markdown headers from system prompt
- Remove all HTML from description (unless doing HTML card specifically)
- Flatten `hair(light blue, short, messy)` back to `light blue hair, short hair, messy hair` for JLLM safety
- Move lorebook lore INTO the description if critical (no WI equivalent)
- Token budget warning if total exceeds 2000 tokens

---

### 3.3 🌐 HTML Intro Mode

**Isolated context. Three sub-modes.**

The agent generates a full HTML introduction document for the character's First Message or a standalone showcase page.

**Sub-mode 1: JanitorAI Simple**
Supported: `<h1>-<h3>`, `<p>`, `<strong>`, `<b>`, `<em>`, `<i>`, `<br>`, `<hr>`, `<ul>`, `<ol>`, `<li>`, `<blockquote>`
Colors: `<span style="color: rgb(R, G, B);">` — RGB only, no hex
Font size: `<span style="font-size: Npx;">`
No CSS, no JS, no external resources, no flexbox/grid

**Sub-mode 2: ChubAI Intermediate**
All standard HTML + inline CSS including basic flexbox
`display:flex`, `gap`, `flex-direction`, `flex:1`
Background colors, borders, border-radius, padding, margin, font properties
No `@keyframes`, no external stylesheets, no `<script>`

**Sub-mode 3: Full Web Advanced**
Complete HTML5 + embedded `<style>` with full CSS3
`@keyframes` animations, transitions, hover states
CSS custom properties (`:root` variables)
Google Fonts via `@import`
CSS Grid, flexbox, clip-path, backdrop-filter, blend-modes
Pseudo-elements (`::before`, `::after`)
Media queries for responsive design
No external JS, no `<script>` tags (ST renders HTML, not full pages)

**Agent flow:**
1. Asks: Which platform? Which sub-mode?
2. Reads current character concept/description for reference
3. Asks: Style direction? (gothic/dark, clean/minimal, cinematic, etc.)
4. Generates HTML in chat as a code block
5. Option to preview (renders in iframe in the panel)
6. Option to write directly to `first_mes` field

---

### 3.4 🎨 Image Prompt Mode

**Isolated context. Currently absent from v1 — major new feature.**

The agent generates optimized image generation prompts for the character.

**Agent intake questions:**
1. Which platform/model? (SD 1.5 / SDXL / Illustrious XL / Flux Dev / NovelAI / MidJourney)
2. Shot type? (portrait / half-body / full-body / scene / scenario illustration)
3. Art style? (anime / manhwa / semi-realistic / painterly / photorealistic)
4. NSFW toggle?
5. Character gender, build, key physical features?
6. Specific outfit, expression, or scenario?

**Model-specific prompt structures:**

**SD 1.5 / SDXL base:**
Tag-based, comma-separated. Quality tags first, then subject, then style, then details.
```
masterpiece, best quality, highly detailed, 1girl, [physical description tags], [outfit tags], [expression], [pose], [background], [style tags]
```
Negative: `worst quality, low quality, bad anatomy, bad hands, extra fingers, ...`

**Illustrious XL / NTR MIX (Gagan's stack):**
Same tag-based as SDXL but handles more complex natural language phrases. Regional prompting possible. CFG ~4.8-5.5, DPM++ 2M Karras.

**Flux Dev:**
Natural language sentences work better. Less tag-dependent. Describe cinematically.
```
A portrait photograph of [description]. [Lighting]. [Style notes]. Highly detailed, professional photography.
```

**NovelAI:**
Uses quality tags + Danbooru-style tags. Weighted with `{tag}` for emphasis.
```
{best quality}, {highly detailed}, 1girl, [character description], {detailed eyes}, ...
```

**Output:** Agent generates positive prompt + negative prompt (where applicable) as copy-pasteable code blocks. Offers 3 variations (portrait / action pose / scenario scene).

---

### 3.5 📚 FictionLab Mode

**Isolated context. PLACEHOLDER — implementation details TBD.**

> **Important note to implementing AI:** This mode is a placeholder. The FictionLab platform has recently changed its card format significantly (new Lore Pieces system, different field structure). Do not implement the conversion logic now. Build the mode skeleton (isolated chat context, mode button in switcher, basic system prompt) but add a prominent notice in the UI: *"FictionLab mode is coming soon. The platform recently updated its format. When the new format is documented, this mode will be updated."*
>
> When Gagan provides updated FictionLab documentation, the implementing AI should fill in this section with the correct field mappings and conversion rules.

**What we know works now (from earlier sessions):**
- FictionLab uses Characters, Story Cards, World Details, and Custom Instructions
- The LoreEngine™ uses semantic activation (not just keyword matching)
- Character card has: Name, Persona, Greeting, Example conversations
- Lorebook entries can be linked to characters via card linking
- Token limits differ for free vs FL+ tiers

**What the agent should do in placeholder mode:**
- Accept user's character concept in chat
- Store the conversation and any generated content in the session
- Label everything as "FictionLab draft — pending format update"
- Tell user which fields each piece of content will eventually map to

---

## 4. UI Architecture

### 4.1 Layout Overview

```
┌─────────────────────────────────────────────────────────────┐
│  TOP BAR                                                      │
│  [Logo] [CharName] [Phase Badge] [Mode Badge] [Resume][New]  │
│  [Settings ⚙] [Mobile Menu ≡]                               │
├──────────────────────┬──────────────────────────────────────┤
│  LEFT: CHAT PANEL    │  RIGHT: PANEL TABS                    │
│  ┌──────────────┐    │  [Card] [Lore] [Concept]             │
│  │ Messages     │    │  ┌────────────────────────┐          │
│  │ ...          │    │  │                        │          │
│  │ ...          │    │  │  Tab content           │          │
│  │ ...          │    │  │  (scrollable)          │          │
│  └──────────────┘    │  │                        │          │
│  [Cancel ✕]          │  └────────────────────────┘          │
│  ┌──────────────┐    │                                       │
│  │ Input box    │[→] │                                       │
│  └──────────────┘    │                                       │
│  [Chip][Chip][Chip]  │                                       │
└──────────────────────┴──────────────────────────────────────┘
```

**Mobile layout** (detected via `SillyTavern.libs.Bowser` or `window.innerWidth < 768`):
- Single column — panels stack vertically
- Top bar collapses to hamburger + character name
- Chat panel full width, right panel slides in from bottom as a drawer
- Tab pills at top of drawer for Card/Lore/Concept
- Floating ✕ cancel button bottom-right corner
- Input stays fixed at bottom of viewport
- Touch targets minimum 44×44px

### 4.2 Chat Panel

**Message types:**

Standard AI message — dark card, agent avatar, text content

Tool call card — compact, shows which tool fired:
```
[✍️ write_field] field: description | 847 tokens
```

Staged draft message — special bordered card:
```
┌─ Draft: Description ──────────── 847t ──┐
│ [content preview]                        │
│                                          │
│ [✅ Apply] [🔄 Regen] [✏️ Edit] [⏭ Skip] │
└──────────────────────────────────────────┘
```

Conflict warning card:
```
⚠️ Conflict detected: System prompt says X but personality says Y
[View details] [Resolve] [Ignore]
```

**Per-message actions** (shown on hover, always visible on mobile):
- 🗑️ Delete — removes message from history
- 🔄 Regenerate — resends last user message, replaces this response
- ✏️ Edit — inline edit of message content
- 📋 Copy — copies message text

**Cancel button:**
- Shown as a pulsing red ✕ button during any generation
- Calls `currentAbortController.abort()`
- Position: below the input bar, or as a floating button on mobile

**Quick-action chips:**
- Context-aware (change per phase)
- Max 5 visible at once, scrollable horizontally on mobile
- Each chip is a pre-filled prompt shortcut

### 4.3 Right Panel — Card Tab

Fields displayed in build order:
- Name (+ token count badge)
- Description (+ token count, format badge)
- Personality
- Scenario
- First Message
- Example Messages
- System Prompt
- Creator Notes
- Author's Note
- Alternate Greetings (collapsible list)
- Tags (tag input)

Per-field controls:
- Token count badge (color-coded: green<200, yellow<500, red>500)
- ✏️ Manual edit (opens inline textarea)
- 📋 Copy to clipboard
- 🔄 Regenerate this field (agent re-generates with context)
- 👁️ Format preview (renders the field as it would appear)
- ⚙️ Field settings (position, format override)
- Status dot: ○ empty / ◐ partial / ● complete

Top actions:
- **Generate All** — runs full Build phase sequence unattended, staging each pillar
- **Audit Card** — runs quality review across all fields
- **Export Log** — exports full session log as markdown
- **Review Card** — comprehensive star-rating review with actionable suggestions

Selectors:
- **Platform:** Standard ST / ChubAI / JanitorAI (affects preview rendering and quality checks)
- **Detail level:** Compact / Standard / Rich (token tier)
- **Format:** PList / Ali:Chat / Hybrid / Prose

### 4.4 Right Panel — Lore Tab

- Lorebook selector dropdown (link to existing or create new)
- Lorebook summary (editable text block)
- Search bar + category filter chips
- **Stats bar:** `N existing | N generated | N staged | ~Nt total | X% context budget used`
- **Recursion Links** section (collapsed by default): shows chain map
- **Entries grouped by category** (Location / Faction / NPC / History / etc.) with collapse/expand
- Per-entry display:
  - Entry name/comment
  - Keywords pills
  - Token count
  - Position badge (Before/After/Depth)
  - Constant indicator (📌 if constant)
  - Non-recursable indicator
  - ✏️ Edit | 🗑️ Delete | 📋 Copy actions
- **Staged entries queue** (bottom section): generated but not yet applied
  - [✅ Apply All] [✅ Apply Selected] [🗑️ Discard All]

### 4.5 Right Panel — Concept Tab

```
┌─ Do the option 3 ──────────────────────────────┐
│ 📄 PList+Ali:Chat                               │
│                                                  │
│ ★★☆☆☆ — The core concept is intriguing but...   │
│                                                  │
│ Structural Pillars ───────────── 5/10 ──────────│
│ ████████░░░░░░░░░░░░░░░░░░░░ 50%               │
│                                                  │
│ ✅ Name                                         │
│ ✅ Description                  ◐ In Progress   │
│ ✅ System Prompt                                │
│ ○ Scenario                          [Mark]      │
│ ○ First Message                     [Mark]      │
│ ○ Example Messages                  [Mark]      │
│ ○ Creator Notes                     [Mark]      │
│                                                  │
│ World Pillars ─────────────────────────────────│
│ ○ Locations (0/3)                               │
│ ○ NPCs (0/2)                                    │
│                                                  │
│ ⚠️ Conflicts (1)                                │
│ > System prompt contradicts personality...      │
└──────────────────────────────────────────────────┘
```

- Character name + concept summary (editable)
- Platform + token tier + format display
- Quality star rating (updates live)
- Structural Pillars progress bar + checklist
- World Pillars checklist
- Conflict log with expand/resolve/ignore
- Session info: message count, phase, last saved

### 4.6 Settings Panel (tabbed modal)

**API tab:**
- Primary API: dropdown of ST connection profiles (or "Use ST's current connection")
- Utility API: separate fast/cheap model for background checks. Can be same as primary.
- Custom system prompt rules: textarea appended to every build prompt
- Tool mode: Auto-detect / Force Native / Force JSON-block fallback

**Appearance tab:**
- Theme: Dark (default, matches ST) / Light / High Contrast
- Font size: Small / Medium / Large
- Panel layout: Side-by-side (desktop) / Stacked (mobile) / Auto
- Compact mode: reduces padding for small screens

**Tone tab:**
- Agent personality: Direct & efficient / Collaborative & chatty / Creative & expansive / Strict & systematic
- Response language: Follow ST UI language / Always English

**Lorebook tab:**
- Default entry position: Before char / After char / At depth
- Default depth: 5
- Default scan depth: 4 (kingbri recommends 4)
- Default context %: 45% (kingbri recommendation for adventure-heavy cards)
- Default probability: 100%
- Auto-recursion detection: on/off

**Snippets tab:**
- Saved prompt fragments (character archetypes, scenario templates, system prompt snippets)
- Import/Export snippets as JSON

**Session tab:**
- List of saved sessions (by character name)
- Export session as JSON
- Import session from JSON
- Clear all sessions
- Delete selected session

**Stats tab:**
- Total tokens generated this session
- API calls made
- Average generation time
- Fields filled / total fields
- Lorebook entries created

---

## 5. The Prompt System

### 5.1 System Prompt Architecture

Every AI call in Studio Mode uses a layered system prompt:

```
[LAYER 1: Agent Identity — from preset v6 Character_Creator_Assistant_v6]
You are the Character Card Studio — a professional SillyTavern and JanitorAI 
character card designer, world-builder, lorebook architect, and creative consultant.
You do NOT roleplay. You design, build, analyze, and guide.
[+ all preset rules: no banned names, positive phrasing, code blocks for pasteable content, etc.]

[LAYER 2: Current Mode Instructions]
[Injected based on current mode: studio-ideate / studio-build / studio-lore / etc.]

[LAYER 3: Current Character Context]
Character in progress: [name]
Platform: [target]
Format: [PList/AliChat/Hybrid/Prose]
Token tier: [compact/standard/rich]
Current card state: [field summaries]
Confirmed pillars: [list with status]

[LAYER 4: Tool Definitions — JSON block mode only]
You have access to the following tools. Call them by outputting a <tool_call> block...
[tool definitions listed]

[LAYER 5: Custom User Rules — from Settings > API > Custom system prompt rules]
[User's additional rules appended here]
```

### 5.2 Background Check Prompts (via generateQuietPrompt)

These use a minimal system prompt to save tokens:

**Conflict check:**
```
You are a character card quality checker. Review these two card fields for contradictions.
Field A (personality): [content]
Field B (system_prompt): [content]
Return JSON: {"has_conflict": bool, "description": "...", "severity": "low|medium|high"}
```

**Token budget check:**
```
Count the tokens in this content and return JSON: {"token_count": N, "recommendation": "..."}
Content: [field content]
```

**Keyword suggestion:**
```
Suggest 5-8 trigger keywords for this world info entry. Return JSON array of strings.
Entry name: [name]
Entry content: [content]
```

**Auto-tag generation:**
```
Generate appropriate tags for this character card for ChubAI/ST community.
Include: genre tags, content tags, character type tags, tone tags.
Return JSON array of strings.
Card summary: [summary]
```

### 5.3 Format-Aware Prompt Injection

The build prompt changes based on the target format:

**PList mode:**
```
Generate the Description field using PList format.
Rules:
- Space before first trait: [Character = trait, trait]
- Do NOT capitalize traits
- Separate sections with semicolons in combined PLists
- Use (grouping) for compound attributes: hair(light blue, short, messy)
- Use / for separate objects: blouse(mint-green)/shorts(denim)
- Body and clothes as separate PList sections
```

**Ali:Chat mode:**
```
Generate Ali:Chat examples for the Description field.
Rules:
- 3 short examples (5-6 lines each), 300-600 tokens total
- Every example must reinforce specific traits through behavior
- Never start {{char}} response with "You"  
- Include character name at least once per example
- Vary action descriptors to prevent repetition bias
- Use *asterisks* for actions, not narration blocks
- Simple prompts: {{user}}: Tell me about yourself / Appearance? / Personality?
```

**Hybrid mode:**
```
Generate the Description combining PList + Ali:Chat.
Structure:
1. PList section (traits, body, clothes) — top of description
2. <START> separator
3. 2-3 Ali:Chat examples reinforcing key traits
Total budget: [N] tokens
```

---

## 6. Quality Checks & Validation

### 6.1 Field Validation Rules (from preset v6 + guides)

The agent validates each field before marking it Done:

**Description:**
- [ ] No placeholder content ("Character Name", "TBD", etc.)
- [ ] Format-appropriate (PList correctly formatted / Ali:Chat has proper {{user}}/{{char}} labels)
- [ ] Token count within tier budget
- [ ] No impersonation of {{user}} in Ali:Chat examples
- [ ] Traits expressed through behavior, not just stated

**Personality:**
- [ ] Not identical to description
- [ ] Disability personality formatting recommended (note shown)
- [ ] Brief — just reinforcement keywords or PList summary

**Scenario:**
- [ ] Not identical to first_mes (common mistake)
- [ ] Permanent world-frame, not an event description
- [ ] No {{user}} actions implied

**First Message:**
- [ ] Uses flipped scenario technique (third-person perspective of char)
- [ ] Does NOT describe what {{user}} is doing in detail
- [ ] Has a clear hook or question to drive conversation
- [ ] Not identical to scenario
- [ ] Appropriate length for token tier

**Example Messages:**
- [ ] Has `<START>` separator before each example
- [ ] `{{user}}` and `{{char}}` labels present
- [ ] Each example reinforces different traits
- [ ] Total within 300-600 permanent token budget
- [ ] No impersonation ({{char}} doesn't describe {{user}}'s actions/feelings)

**System Prompt:**
- [ ] No `don't`, `never`, `do not` — all positive phrasing
- [ ] No `{{user}}` actions described
- [ ] Token-budgeted (not bloated)
- [ ] Behavioral rules are concrete and actionable

### 6.2 Star Rating Algorithm

The live quality score in Concept tab (1-5 stars):

```
1★ = Any required field empty or clearly placeholder
2★ = Core fields (description, first_mes) present but system_prompt or scenario empty
3★ = Core fields done, some optional fields missing
4★ = All fields done, minor conflicts or sub-optimal formatting
5★ = All fields done, no conflicts, token-optimized, format-appropriate
```

Plus bonuses:
- +0.5 for having a linked lorebook with >3 entries
- +0.5 for alternate greetings present
- -0.5 for each active conflict in conflict log
- -1.0 for any validation failure in core fields

---

## 7. Bug Prevention Checklist

These are the known failure modes from v1. The implementing AI MUST address each one:

### 7.1 Parsing Failures
- **Problem:** AI output doesn't match expected format, breaks field extraction
- **Solution:** Never rely on string parsing for field content. Use ST's native tool calling when available. For JSON-block fallback, use structured output schemas (`generateRaw` with JSON schema) when supported. Have a graceful fallback that shows raw AI output as an editable draft if parsing fails.

### 7.2 No Cancel Button
- **Problem:** Generation starts, user can't stop it
- **Solution:** Every `generateRaw`/`generateQuietPrompt` call gets an `AbortController`. Cancel button is always visible during generation. On mobile: floating red button bottom-right.

### 7.3 No Delete/Regenerate on Messages
- **Problem:** Bad messages accumulate, context gets polluted
- **Solution:** Every message in the chat panel has delete (🗑️) and regenerate (🔄) actions. Delete removes from `sessionState.chatHistory`. Regenerate replaces the last AI message by re-sending the previous user message.

### 7.4 Pillar Marking Not Working
- **Problem:** Mark button fires but state doesn't update or persist
- **Solution:** Pillar state stored in `sessionState.pillarStates` array, saved to `localforage` after every change. Mark button calls `setPillarStatus(pillarId, status)` which updates state AND saves immediately. Concept tab re-renders from state, not from DOM.

### 7.5 No Delete Pillars Option
- **Problem:** Unwanted pillars can't be removed
- **Solution:** Each pillar in the Concept tab checklist has a 🗑️ remove button. Custom pillars added by user can always be deleted. Default pillars can be hidden/skipped but not deleted (they're required for quality scoring).

### 7.6 AI Marks Wrong Fields
- **Problem:** Tool calls `write_field` with incorrect field name or content
- **Solution:** Field names validated against enum before execution. If invalid field name, show error in chat without executing. Staged drafts always show which field they target, with a field name dropdown so user can correct it before applying.

### 7.7 Session State Loss
- **Problem:** Refreshing the page or switching characters loses all progress
- **Solution:** Auto-save to `localforage` after every message, every pillar state change, every draft action. Resume button loads exact state. If character is switched in ST while session is active, show warning modal.

### 7.8 Context Pollution Between Modes
- **Problem:** JanitorAI conversion chat appears in Studio chat history
- **Solution:** Each mode has its own `chatHistory` array in `sessionState`. Chat panel only displays the active mode's history. Switching modes swaps the displayed history without clearing it.

### 7.9 Mobile Layout Breakage
- **Problem:** Side-by-side layout is unusable on phone screens
- **Solution:** Detect mobile via `Bowser.parse(navigator.userAgent).platform.type === 'mobile'` or `window.innerWidth < 768`. Use a single-column layout with bottom drawer for the right panel. Test all interactive elements at 44×44px minimum touch target. Input box stays fixed at bottom. Chips are horizontally scrollable.

### 7.10 Background Check Race Conditions
- **Problem:** Multiple `generateQuietPrompt` calls fired simultaneously causing overlapping results
- **Solution:** Background checks are queued, not concurrent. A `backgroundCheckQueue` processes one at a time. Results only applied to current pillar, discarded if pillar has moved on.

### 7.11 World Info Write Failures
- **Problem:** `createWorldInfoEntry` fails silently or creates malformed entries
- **Solution:** Wrap all WI writes in try-catch. Validate entry structure before writing. Show explicit success/failure toast. If write fails, keep entry in staged queue so user can retry.

### 7.12 Tool Mode Mismatch
- **Problem:** Native tool calling attempted on Text Completion API that doesn't support it
- **Solution:** On session start, call `isToolCallingSupported()`. If false, automatically switch to JSON-block fallback mode. Show a small indicator in the top bar: `⚡ Native tools` or `📋 JSON fallback`. Allow manual override in Settings > API > Tool mode.

---

## 8. File Structure

```
SillyTavern-CharCardStudio/
├── manifest.json           ← Extension manifest with minimum_client_version
├── index.js                ← Entry point, APP_READY hook, mode router
│
├── core/
│   ├── agent.js            ← Agent loop, prompt builder, tool dispatcher
│   ├── tools.js            ← All tool implementations (write_field, read_card, etc.)
│   ├── session.js          ← Session state management, localforage persistence
│   ├── background.js       ← Background check queue (conflict, token, keyword)
│   └── validators.js       ← Field validation, quality scoring
│
├── modes/
│   ├── studio/
│   │   ├── ideate.js       ← Ideate phase logic + prompts
│   │   ├── build.js        ← Build phase logic + pillar sequencer
│   │   └── lore.js         ← Lore phase logic + category planner
│   ├── janitor.js          ← JanitorAI conversion mode
│   ├── html.js             ← HTML intro mode (3 sub-modes)
│   ├── imageprompt.js      ← Image prompt mode
│   └── fictionlab.js       ← FictionLab mode (placeholder skeleton)
│
├── ui/
│   ├── app.js              ← Main app shell, layout switcher, mobile detection
│   ├── chat.js             ← Chat panel (messages, input, chips, cancel)
│   ├── card-panel.js       ← Card tab rendering + field actions
│   ├── lore-panel.js       ← Lore tab rendering + entry management
│   ├── concept-panel.js    ← Concept tab, pillar checklist, conflict log
│   ├── settings.js         ← Settings modal (all tabs)
│   └── toast.js            ← Toast notifications (success/error/warning)
│
├── prompts/
│   ├── agent-identity.txt  ← Core identity from preset v6 (Character Card Studio rules)
│   ├── studio-ideate.txt
│   ├── studio-build.txt    ← Includes format-specific injection points
│   ├── studio-lore.txt
│   ├── janitor.txt         ← JanitorAI mode rules
│   ├── html-simple.txt
│   ├── html-intermediate.txt
│   ├── html-advanced.txt
│   ├── imageprompt.txt
│   ├── fictionlab.txt      ← Placeholder
│   └── backgrounds/        ← Short prompts for background checks
│       ├── conflict-check.txt
│       ├── token-check.txt
│       ├── keyword-suggest.txt
│       └── autotag.txt
│
├── style.css               ← Extension CSS (dark theme, mobile responsive)
├── settings.html           ← Settings panel HTML template
├── LICENSE                 ← MIT
├── CHANGELOG.md
├── CONTRIBUTING.md
└── README.md
```

---

## 9. Implementation Build Order

Build in this exact order. Each phase should be fully functional before moving to the next.

### Phase A: Shell (get the basics working, nothing can break)
1. `manifest.json` with correct structure and `minimum_client_version`
2. `index.js` — extension loads, shows a panel, no errors
3. Basic chat UI — messages render, input works, send button works
4. Session save/load — `localforage` read/write working
5. Cancel button — `AbortController` wired up
6. Delete/Regenerate on messages — working
7. Mobile detection + layout switch

### Phase B: Agent Foundation
1. Tool mode detection (`isToolCallingSupported()`) → auto-select native vs JSON-block
2. Native tool registration for all core tools
3. JSON-block parser for fallback mode
4. `write_field` tool — writes to ST card, verified working
5. `read_card` tool — reads all current card fields
6. `stage_draft` — shows staged draft with Apply/Reject/Edit
7. Basic Studio Ideate phase prompt + flow

### Phase C: Studio Mode Complete
1. Pillar definition system in Concept tab
2. Build phase — pillar sequencer working
3. All field validations
4. Background check queue (conflict, token)
5. Quality scoring (star rating)
6. Lore phase — category planning + batch generation
7. World Info write tools working
8. Recursion link detection

### Phase D: Additional Modes
1. JanitorAI conversion mode
2. HTML intro mode (3 sub-modes)
3. Image prompt mode
4. FictionLab mode (skeleton only)

### Phase E: Polish
1. Settings panel (all tabs)
2. Export/import session
3. All toast notifications
4. Mobile layout refinement
5. Performance: debounce saves, lazy-load mode prompts

---

## 10. Key API Imports Reference

```javascript
// Core ST imports
import { eventSource, event_types, saveSettingsDebounced, extension_settings }
  from '../../../../script.js';
import { getContext } from '../../../../scripts/extensions.js';

// World Info
import { getWorldInfoSettings, createNewWorldInfo, deleteWorldInfo,
         getWorldInfo, saveWorldInfo, loadWorldInfoData }
  from '../../../../scripts/world-info.js';

// Character management  
import { getCharacters, saveCharacterDebounced, this_chid }
  from '../../../../script.js';

// Shared libs
const { localforage, Bowser, DOMPurify, Handlebars } = SillyTavern.libs;

// Generation
const { generateQuietPrompt, generateRaw, isToolCallingSupported,
        canPerformToolCalls, registerFunctionTool, unregisterFunctionTool }
  = SillyTavern.getContext();
```

---

## 11. Notes on Preset v6 Integration

The `Character_Creator_Assistant_v6.json` preset's Main Prompt and Post-History Instructions become the `agent-identity.txt` file — the foundation of every Studio mode system prompt.

Key rules extracted from preset v6 that must be embedded:
- "You do NOT roleplay. You design, build, analyze, and guide."
- "All pasteable content in code blocks, explanations outside"  
- "Never use banned generic names — ask about world culture before naming"
- "Never write 'don't/never/do not' in system prompts — write what the AI should do instead"
- "Never act or speak for {{user}} in any First Message or example dialogue"
- Platform-specific formatting rules (activated per mode)
- Token budget discipline language

The specialized mode prompts from preset v6 (JanitorAI section, HTML Simple/Intermediate/Advanced sections, Image Prompt Generator section) become the respective mode system prompts in the `prompts/` folder.

---

*Document version: 2.0 — Comprehensive edition*
*Based on: CharCardStudio v1 analysis + preset v6 + Android + Shattered Earth reference cards + Ali:Chat guide + Kingbri PList guide + PList+AliChat guide + World Info Encyclopedia + ST official extension documentation*
