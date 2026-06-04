# 🎭 Character Card Studio

> **An agentic AI-powered character card and lorebook authoring studio for SillyTavern.**  
> v5.2.0 — Full-featured. Story-first. Tool-driven.

---

> **Vibecoded Project**
>
> I built this extension mainly to make character cards for myself. I vibecoded the entire thing — just me, an AI assistant, and too much free time. Somewhere along the way it became very feature-heavy, but at its heart it's still a personal tool that happened to get uploaded to GitHub.
>
> Only the AI and God know what half the code is doing. The AI forgets between sessions, and God has better things to worry about. So if you find a bug: yes, probably. If it works perfectly: pleasant surprise. I think I did at least make it stable and relatively bug-free and work as intended.

---

## What is Character Card Studio?

Character Card Studio is a full-screen SillyTavern extension that turns character card creation into a **guided, conversational process**. Instead of filling in fields manually and hoping the AI understands the SillyTavern format, you work with a structured assistant that understands card craft deeply — handling the technical execution while you drive the creative direction.

The studio is built around an **agentic tool-calling architecture**: the AI reasons through your requests, calls structured tools to write fields, save state, manage lorebook entries, and track progress — all staged for your review before anything touches your card.

> ![The CharCardStudio full-screen interface open on a character session](images\main_panel.png)
> *Caption: The full-screen studio interface with the Chat panel (left), Card tab (right), and phase controls at the bottom. The card fields update live as drafts are applied.*

---

## ✨ At a Glance

| What you want to do | How CCS handles it |
|---|---|
| Pitch a concept and get proper creative structure | Ideation phase — story arc, pillars, brief, pre-build checklist |
| Generate card fields with craft knowledge | Build phase — format-aware, pillar-aware, staged drafts |
| Plan and create a lorebook | Lore phase — gap analysis, priority plan, full WI spec |
| Review and fix a finished card | Audit phase — static analysis + AI quality review |
| Convert a card for JanitorAI | JanitorAI Mode — reads your card, rewrites for JLLM |
| Generate an HTML character intro | HTML Mode — 3 complexity levels, live iframe preview |
| Generate image prompts | Image Prompt Mode — 5 model-specific templates |

---

## 📦 Installation

### Method 1 — ST Extension Installer (Recommended)
1. Open SillyTavern.
2. Click the **Extensions** icon (stacked cubes) in the top bar.
3. Click **Install Extension**.
4. Paste: `https://github.com/MMKAVERAPPA/CharCardStudio`
5. Click **Install** — done.

### Method 2 — Manual
1. Clone or download this repository.
2. Move the `CharCardStudio` folder to:
   ```
   SillyTavern/public/scripts/extensions/third-party/CharCardStudio/
   ```
3. Restart or reload SillyTavern.

### Requirements
- **SillyTavern** 1.12.0 or later.
- **Any LLM API** configured in SillyTavern (OpenAI, Claude, Gemini, local models, etc.).
- **Recommended**: Set Prompt Post-Processing to `Semi-strict (alternating roles; with tools)`.

### Opening the Studio
- Click the **✨ wand icon** in the SillyTavern send bar, **or**
- Click **Open Studio** in the extensions panel (Extensions → Character Card Studio).

---

## 🚀 Quick Start

1. **Select a character** in SillyTavern (or create a blank one for a new card).
2. **Open the Studio** via the wand icon or extensions panel.
3. In the **Ideation phase**, pitch your character concept — describe who they are, what makes them interesting, what platform they're for.
4. Work through the conversation until you have a **Concept Brief** — the AI will propose story arcs, signature moments, and confirm creative decisions.
5. When ready, the AI switches you to **Build phase** and generates each card field.
6. Accept, edit, or regenerate each staged draft as it comes in.
7. Switch to **Lore phase** if you want a lorebook. Switch to **Audit** to run a quality check.

> ![The Concept Tab showing Structural Pillars, Concept Brief panel, and Scratchpad](images\concept_panel.png)
> *Caption: The Concept Tab. Structural Pillars track foundational creative decisions (Core Identity, Voice, Scenario, etc.). The Concept Brief panel shows the AI's living design document. The Scratchpad is private — never sent to the AI.*

---

## 🗂️ Studio Modes

The Studio supports five isolated modes, each with its own chat history:

| Mode | Purpose |
|---|---|
| **Studio** | Primary mode — full agentic card creation workflow |
| **JanitorAI** | Convert an existing ST card for JanitorAI compatibility |
| **HTML Intro** | Generate a styled HTML character introduction page |
| **Image Prompt** | Generate image prompts for SD, Flux, MJ, NAI, DALL-E |
| **FictionLab** | Experimental fiction mode (coming soon) |

---

## 🎭 Studio Mode — Full Workflow

Studio Mode has four sequential phases. You move through them in order, but can switch back at any time.

```
Ideate → Build → Lore → Audit
```

---

### 💡 Phase 1: Ideation

The Ideation phase is where you establish everything the card needs before a single field is written. **Don't skip this** — the AI uses the brief and story arc to make every field decision in Build phase.

> ![The Ideate phase with a concept being developed in the chat — the AI has produced a Story Arc plan with signature moments]()
> *Caption: The AI developing a story arc during Ideation. Signature Moments (specific scenes that will define the card in play) are proposed before any field is written.*

#### What the AI does in Ideation:

**Step 1 — Concept Assessment**
- Rates your concept on 5 axes: Hook Strength, Longevity, Originality, RP Potential, Platform Appeal.
- Identifies missing information and asks clarifying questions.

**Step 2 — Card Type & Platform**
- Identifies the card type: A (Single Character), B (Multi-Character), C (Scenario/World), D (Persona/Operator), or E (Universe).
- Sets the target platform: SillyTavern or JanitorAI (which changes field rules).
- Selects format: **Prose** (default, natural paragraphs) or **PList+Ali:Chat** (compressed notation for token-constrained models).

**Step 3 — Story Arc & Narrative Potential**
- Maps 2–4 narrative scenarios with inherent tension (not just "they talk").
- Traces the emotional arc — how the relationship evolves across a long conversation.
- Defines 3 **Signature Moments**: specific scenes that will define the card in play. These feed directly into the First Message and Example Dialogue fields.
- Identifies the player's fantasy — what need or feeling this card is built to satisfy.

**Step 4 — Structural Pillars**
- Works through foundational creative decisions: Core Identity, Emotional Core, Voice & Speech, Key Relationship Dynamic, Central Scenario, Visual Signature, Backstory Hook, Central Contradiction.
- Each pillar answered gets marked ✅ in the Concept Tab.
- Smart detection marks pillars resolved when they're answered naturally in conversation.

**Step 5 — Pre-Build Checklist**
- Before switching to Build, the AI confirms: all pillars resolved, format decided, platform confirmed, no open questions.
- Calls `ccs_switch_phase(phase: "build")` explicitly — you see it happen in the context bar.

#### Concept Brief System

The AI maintains a **living Concept Brief** — a structured markdown document saved to your session:

```markdown
## Core Identity
[Who they are at their essence]

## Voice & Speech
[How they talk, vocabulary, patterns]

## Story Arc
[Scenarios, emotional progression, signature moments]

## Design Decisions
[Format, platform, card type choices]
```

- Visible in the **Concept Tab** → Brief panel.
- Persists across turns — the AI injects it automatically into every prompt.
- You can add **annotations** in the text field below the brief. These appear as `[USER ANNOTATIONS]` in the AI's context — use them to override or add notes without editing the brief directly.

#### Quickstart Chips

If starting fresh with no concept, the Concept Tab shows one-click chip buttons:
`Brainstorm` · `Villain` · `Companion` · `Mentor` · `AI / Android` · `What If?`

Each injects a pre-crafted prompt to get the ideation conversation started immediately.

---

### 📝 Phase 2: Build

Build phase generates the actual card fields. The AI reads the Concept Brief, checks which fields are still pending, and generates them one at a time with staged drafts.

> ![The Card Tab showing multiple fields filled in with token counts and star ratings. A staged draft is visible with Apply/Edit/Regen/Skip buttons]()
> *Caption: The Card Tab during Build phase. Each field shows its token count and a quality star rating. A staged draft (yellow highlight) is waiting for approval — Accept applies it to the card, Regen regenerates, Skip moves on.*

#### Card Fields

All SillyTavern and JanitorAI fields are supported:

| Field | ST name | Notes |
|---|---|---|
| Description / Personality | `description` / `personality` | Main character definition |
| Scenario | `scenario` | World context, PList placement for Janitor |
| First Message | `first_mes` | Heart of the card — Flipped Scenario Technique |
| Example Dialogue | `mes_example` | Ali:Chat or `<START>` blocks |
| System Prompt | `system_prompt` | User-managed; AI leaves this empty |
| Creator Notes | `creator_notes` | Human-readable, not sent to AI |
| Character Note | `depth_prompt` | Injected at depth in ST; PList for Janitor |
| Alternate Greetings | `alternate_greetings` | Multiple starting scenarios; indexed |
| Tags | `tags` | Categorization keywords |

#### Staged Draft System

Every AI-generated field is shown as a **staged draft** before being applied:

```
┌──────────────────────────────────────────────────────────────┐
│ 📝 Description — 312 tokens                                   │
│ ──────────────────────────────────────────────────────────── │
│ [Draft content preview here...]                               │
│                                                               │
│ [Apply ✓]  [Edit ✏️]  [Regen 🔄]  [Skip ⏭]  [← 1/3 →]       │
└──────────────────────────────────────────────────────────────┘
```

- **Apply** — writes to the card.
- **Edit** — opens the draft in a textarea for manual editing before applying.
- **Regen** — generates a new version (keeps all versions; swipe with ← →).
- **Skip** — dismisses without applying.

#### Card Progress Awareness

The AI can see a **CARD PROGRESS** block in its context every turn:

```
━━━ CARD PROGRESS ━━━
[done]        Description, Personality, First Message
[in_progress] Scenario
[pending]     Example Dialogue, Creator Notes, Alternate Greetings
```

After each field, it suggests: *"Next up: Example Dialogue — want me to continue?"*

#### Token Optimizer

If a field is too long, ask the AI to compress it:

> "Optimize the description — it's eating too many tokens."

The `ccs_optimize_tokens` tool rewrites the field for compression, stages it as a new draft, and shows the estimated token saving. You choose to accept or keep the original.

#### Field History & Undo

Every applied field write is tracked in a per-session undo/redo stack.

- **Ctrl+Z** — undo last field change.
- **Ctrl+Shift+Z** — redo.
- Up to 30 actions in history.

#### Quick Edit

Click the ✏️ icon on any card field in the Card Tab to edit it directly inline. The AI is notified of manual changes so it can account for them.

#### Token Budget Visualizer

A real-time color-coded bar in the Card Tab header tracks token usage:

```
Tokens: ████████████░░░░  1,847t / 4,000t
         ↑ Constant    ↑ Conditional
```

- 🟢 Green → 🟡 Amber at 2,000t → 🔴 Red at 3,000t.
- Tracks constant (always-injected) vs. conditional (triggered) token costs separately.

#### Inline "Ask AI" Toolbar

Select any text in the Card Tab to get a floating toolbar with quick AI actions: Improve, Expand, Shorten, Change Tone. The AI rewrites only the selected section.

#### Context Tooltips

Click the ❓ icon next to any card field label to see a best-practice tooltip explaining that field's purpose, platform-specific rules, and token budget guidance — without leaving the studio.

---

### 📖 Phase 3: Lore

The Lore phase builds the character's lorebook — World Info entries that give the AI context about locations, factions, NPCs, and systems when they come up in conversation.

> ![The Lore Tab showing category folders (Geography, Factions, NPCs) with entries, pending draft badges, and the lorebook name in the header]()
> *Caption: The Lore Tab. Entries are grouped into collapsible category folders. Each pending entry (yellow badge) is a staged draft waiting to be inserted into the actual lorebook.*

#### Lore Plan System

Before creating any entries, the AI does a **Lore Gap Analysis**:

1. Reads the Concept Brief → identifies story arc scenarios and signature moments.
2. Reads the card fields → scans for unexplained proper nouns.
3. Reads existing lore entries → avoids duplicates.
4. Produces a **Priority Plan** (shown to you for approval before anything is created):

```
Category  | Entry Name          | Priority    | Why
---------------------------------------------------------------
Geography | The Iron Quarter    | Essential   | Referenced in FM
Factions  | The Iron Circle     | Essential   | Core to backstory
NPCs      | Aldric Vorn         | Enrichment  | Key relationship
History   | The Collapse of '04 | Optional    | Background flavor
```

The plan is saved as a **Lore Plan** document (visible in session state, injected into context every turn). As entries are created, the plan is updated with ✔ marks — the AI always knows what's done and what's pending.

#### Entry Creation

Each entry is created with the full World Info spec:

| Setting | Options |
|---|---|
| **Position** | Before Char Defs (background lore) / After Char Defs (active content) |
| **Order** | 100 (atmosphere) → 150–200 (mechanics) → 250–350 (critical NPCs/factions) |
| **Type** | Constant (every message, use sparingly) / Triggered (on keywords) |
| **Keywords** | 2–5 per entry, singular AND plural forms |
| **Secondary Keys** | AND-logic filter — entry fires only when both key + filter appear |
| **Recursion** | Enabled when this entry's content contains other entries' keywords |
| **Non-Recursable** | Marks the final entry in a recursion chain to prevent loops |
| **Category** | Geography / Factions / NPCs / Magic System / Items / History / Culture / Rules |

#### Lorebook Setup

If no lorebook is attached to the character, the AI walks you through:

```
A) Create a new lorebook:
   Character Card → Extensions tab → World Info → "New World" button.
   Name it (e.g. "Elara Lorebook"). Then come back here.

B) Attach an existing lorebook:
   Same World Info panel → pick from the dropdown.
```

Your lorebook selection persists per character across sessions.

#### Category Folders

Entries in the Lore Tab are automatically grouped into collapsible accordions:

```
📍 Geography (3 entries · ~280t)
  ▶ The Iron Quarter | keys: iron quarter, iron quarters
  ▶ The Wastes       | keys: wastes, the wastes [CONSTANT]
  ▶ ...

⚔️ Factions (2 entries · ~210t)
  ▶ Iron Circle      | keys: iron circle, iron circles
  ▶ ...
```

Each folder shows total token budget for that category.

#### Auto-Context Injection

The AI's system prompt automatically includes a compact lorebook summary on every turn:

```
━━━ LOREBOOK (Elara Lorebook · 8 entries) ━━━
Geography: Iron Quarter (2 keys), The Wastes [CONSTANT]
Factions:  Iron Circle (3 keys)
NPCs:      Aldric Vorn (2 keys), Commander Mira (2 keys)
History:   The Collapse of '04 (3 keys)
```

If there are more than 20 entries, a statistical breakdown is shown instead. This keeps the AI from creating contradictory lore it doesn't know about.

#### Lore Graph Visualization

Open the 🗺️ button in the Lore Tab for an interactive **Lore Graph** — a force-directed node graph showing:
- Which entries activate which other entries (recursion chains).
- Orphaned entries (no keyword connections).
- Token weight per node.
- Circular chain detection.

> ![The Lore Graph visualization showing nodes connected by activation edges, with one orphaned node highlighted](images\lore_graph.png)
> *Caption: The Lore Graph. Each node is a lorebook entry. Edges show keyword-to-keyword activation chains. The highlighted orphaned node has no trigger keywords — it will never fire.*

Graph analysis tools (`ccs_read_lore_graph`, `ccs_suggest_lore_connections`) are available on demand — they don't fire automatically.

---

### 🔍 Phase 4: Audit

The Audit phase is a full quality review of the finished card.

> ![The Coherence Audit modal showing a 0-100 score, a list of errors and warnings, and "Ask AI to Fix" buttons]()
> *Caption: The Coherence Audit modal. The static analysis engine checks structure, completeness, token budgets, and cross-field consistency. Each issue has a one-click escalation to the AI.*

#### Static Coherence Audit

The `ccs_audit_card` tool runs a **local, non-AI static analysis** before the AI even responds:

| Check | What it looks for |
|---|---|
| **Required fields** | Description, First Message, Scenario — are they filled? |
| **Field budgets** | Fields over token limits flagged by severity |
| **Lorebook issues** | Keyless entries, all-Constant entries, keyword collisions |
| **Cross-field consistency** | Name consistency, `{{char}}`/`{{user}}` placeholder usage |
| **Token totals** | Total card weight against platform limits |

Results come back as: score/100, errors (blocking), warnings (notable), and info items.

#### AI Qualitative Review

After the static audit, the AI does a qualitative review — card type appropriateness, concept clarity, First Message quality, voice consistency, and replay value. Results are submitted as a structured scorecard.

#### AI Scorecard

Submit a structured **AI Scorecard** with the `ccs_submit_review` tool:

```
Overall: ⭐⭐⭐⭐ (4/5)

Concept Clarity:    ████████░░  4/5
First Message:      ██████████  5/5  
Character Voice:    ███████░░░  3/5
Lorebook Quality:   ███████░░░  3/5
Replay Value:       ████████░░  4/5

Strengths: [...]
Weaknesses: [...]
Suggestions: [...]
```

Each category bar is a clickable **Fix** button that auto-generates a targeted repair prompt.

#### Conflict Resolution

Background conflict detection runs continuously while you work. When a contradiction is found (e.g., Description says she's an orphan, Scenario references her mother), it appears as a conflict you can:
- **Fix** — apply the AI's resolution suggestion.
- **Ignore** — mark as false positive (won't reappear).
- **Defer** — snooze for now.

---

## 🧠 Agentic Tool System

The AI uses structured `<tool_call>` blocks to take actions. You see tool activity through the **tool indicator** in the context bar.

### Tool Definitions

| Tool | Phase | What it does |
|---|---|---|
| `ccs_write_field` | Build, Audit | Stage a card field for approval |
| `ccs_read_field` | All | Read current field content |
| `ccs_update_pillar` | Ideate | Mark a pillar resolved with a summary |
| `ccs_batch_pillars` | Ideate | Resolve multiple pillars at once |
| `ccs_switch_phase` | All | Transition between phases |
| `ccs_write_brief` | Ideate | Save/update the Concept Brief |
| `ccs_read_brief` | All | Read the Concept Brief |
| `ccs_write_lore_plan` | Lore | Save/update the Lore Gap Analysis & Plan |
| `ccs_read_lore_plan` | Lore | Read the current Lore Plan |
| `ccs_create_lore_entry` | Lore | Stage a new lorebook entry |
| `ccs_read_lore_entries` | Lore | List all current lorebook entries |
| `ccs_update_lore_entry` | Lore | Edit an existing entry (staged) |
| `ccs_delete_lore_entry` | Lore | Mark an entry for deletion (staged) |
| `ccs_read_lore_graph` | Lore | Get lorebook topology (on demand) |
| `ccs_suggest_lore_connections` | Lore | Get connectivity improvement suggestions |
| `ccs_resolve_conflict` | Audit | Resolve a detected cross-field conflict |
| `ccs_audit_card` | Audit | Run static analysis + read all fields |
| `ccs_submit_review` | Audit | Submit structured scorecard |
| `ccs_optimize_tokens` | Build | Stage a token-compressed field rewrite |
| `ccs_semantic_search` | All | Keyword search across fields + lorebook |
| `ccs_update_memory` | All | Save global/session memory rules |
| `ccs_set_card_type` | Ideate | Record the detected card type |
| `ccs_set_platform` | Ideate | Set target platform (ST / Janitor) |
| `ccs_generate_avatar_prompt` | Build | Generate an SD/Flux image prompt |

### Tool Fallback Parser

The tool system uses a **7-strategy fallback parser** with **90+ name normalizer variants** — so even when a model outputs tool calls in a non-standard format (bare text, XML tags, camelCase names, space-separated) they're still caught and executed correctly.

---

## 💾 Session & Memory System

### Session State

Each character gets a dedicated session stored in IndexedDB (via localforage). Session state includes:
- Full conversation history (per-mode isolated)
- All pillar states (structural + world)
- Staged drafts queue
- Concept Brief & annotations
- Lore Plan
- Field version history (undo/redo)
- Detected conflicts
- Memory rules

Sessions persist between SillyTavern restarts. If you open the same character in two browser tabs, the second tab goes into **read-only mode** (multi-tab lock via heartbeat detection).

### Session Memory

The AI can save persistent notes that survive across sessions:

- **Global rules** — apply to every character (e.g., "Always ask about NSFW before proceeding").
- **Session rules** — apply only to the current character.
- **Learnings** — auto-observed patterns the AI notes for itself.

Memory is injected into the system prompt on every turn.

### Session Export / Import

- Export the full session as a JSON file (Settings → Session).
- Import a previously exported session to restore exact state.
- Clear session data without deleting the character.

---

## 🔧 Other Major UI Systems

### Prompt Inspector

Click 🔍 in the Studio header to open the **Prompt Inspector** — a read-only view of the exact system prompt and message history the AI will receive on the next turn:

- Tabs: System Prompt / Message History
- Per-section token estimates
- One-click clipboard copy

> ![The Prompt Inspector modal showing the system prompt split into layered sections with token counts](images\prompt_inspector.png)
> *Caption: The Prompt Inspector. Each section of the system prompt is labeled (Agent Identity, Field Knowledge, Phase Instructions, Tool Definitions, Dynamic Context) with its token cost.*

### Personality Radar

Run a Psychological Depth Profile to get a **radar chart** of your character across 6 axes: Introversion, Logic, Chaos, Aggression, Seriousness, Secrecy.

> ![The personality radar chart — a hexagonal radar visualization of character psychological traits](images\personality.png)
> *Caption: The Personality Radar. Generated from the AI's analysis of the character's description and concept brief. Each axis has a 0–10 score.*

### Ghost Mode

Press **Alt+Shift+G** to toggle Ghost Mode — the studio becomes semi-transparent and click-through, so you can reference ST's UI underneath without closing the studio.

### Dynamic Theme Sync

The studio automatically maps SillyTavern's active CSS theme variables to its own design tokens. Swap themes in ST and the studio updates live — no manual configuration.

---

## 🌐 HTML Intro Mode

Generate a standalone HTML character introduction page at three complexity levels:

| Level | What's included |
|---|---|
| **Simple** | HTML5 structure, inline basic styles, clean typography |
| **Intermediate** | CSS animations, grid layout, color variables |
| **Advanced** | `@keyframes`, responsive media queries, Google Fonts, layered visual design |

A **live sandboxed iframe preview** renders the output in the right panel instantly. The `preview` command is intercepted locally — no round trip to the LLM needed.

> ![The HTML Intro Mode showing generated code on the left and the rendered preview in the right panel]()
> *Caption: HTML Intro Mode. The right panel shows a live sandboxed preview of the generated page. The "Advanced" level output typically includes animations and responsive layout.*

---

## 🎨 Image Prompt Mode

Generate image prompts optimized for specific model families:

| Model | Prompt style |
|---|---|
| **Stable Diffusion / SDXL** | Tag-based, CFG guidance, negative prompt |
| **Illustrious XL** | Anime-focused tag structure |
| **Flux Dev** | Natural language, lighting descriptors |
| **NovelAI** | NAI-specific quality tags, character notation |
| **MidJourney** | `/imagine` format with aspect ratio and style suffixes |

Artwork style options: Anime · Photoreal · Painterly · Cinematic  
Shot type options: Face close-up · Bust · Full body

---

## 🔄 JanitorAI Conversion Mode

Reads your current SillyTavern character card and converts it for JanitorAI compatibility:

- **Personality field** (= ST Description): checks token count (<1,500t target, 2,000t max).
- **Scenario field**: moves PList to the bottom if format is PList+Ali:Chat.
- **System prompt**: rewrites into JanitorAI Custom Instructions format.
- **Creator Notes / System Prompt separation**: JanitorAI has different fields — the AI explains where each piece goes.
- Flags anything that needs manual adjustment for JLLM context limits.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+1` | Switch to Ideate phase |
| `Ctrl+2` | Switch to Build phase |
| `Ctrl+3` | Switch to Lore phase |
| `Ctrl+G` | Generate All fields (Build phase) |
| `Ctrl+F` | Search chat messages |
| `Ctrl+S` | Export session as JSON |
| `Ctrl+/` | Focus chat input |
| `Ctrl+Z` | Undo last field change |
| `Ctrl+Shift+Z` | Redo |
| `Alt+Shift+G` | Toggle Ghost Mode |
| `Enter` | Send message |
| `Escape` | Minimize studio |

---

## 💬 Chat Commands

Natural language works, but these trigger specific behaviors reliably:

### Ideation Phase
| Command | Action |
|---|---|
| `suggest ideas` / `give me ideas` | AI generates 3 character concepts |
| `use plist` / `switch to plist format` | Set format to PList+Ali:Chat |
| `use prose` | Set format to Prose |
| `load existing` / `improve this card` | Loads current card fields for review |

### Build Phase
| Command | Action |
|---|---|
| `generate all` / `fill all fields` | Generates every card field in order |
| `generate [field]` | Generates a specific field |
| `variations for [field]` | 3 parallel options for that field |
| `shorten [field]` / `compress [field]` | Rewrites shorter |
| `lengthen [field]` / `expand [field]` | Rewrites with more detail |
| `optimize tokens for [field]` | Token-compressed rewrite |
| `test drive` / `test character` | AI simulates character across scenarios |

### Lore Phase
| Command | Action |
|---|---|
| `plan the lorebook` | Triggers gap analysis and priority plan |
| `create entries` / `start building` | Begins creating approved entries |
| `check keywords` | Keyword quality review |

### Audit Phase
| Command | Action |
|---|---|
| `run audit` / `audit the card` | Full coherence audit |
| `review this card` | Qualitative review with scorecard |

---

## ⚙️ Settings

Open with the ⚙ button in the Studio header.

### General Tab
- **Card Format Preference**: Default format (Prose / PList).
- **Auto-Summarize Chat**: Enable automatic summarization of older messages to preserve context.
- **Summarization Threshold**: How many messages before summarization kicks in (keeps last 15 intact).

### Session Tab
- **Export Session**: Download current session as a JSON file.
- **Import Session**: Load a previously exported JSON session.
- **Clear Session**: Reset session (messages, drafts, pillars) while keeping the character.

### Data Tab
- **Storage Usage**: Estimated size of all CCS sessions in IndexedDB.
- **Danger Zone**: Delete ALL CharCardStudio sessions for ALL characters (permanent, no undo).

### About Tab
- Version info, author, GitHub link, license summary, mode overview.

---

## 🗂️ File Structure

```
CharCardStudio/
├── index.js                    # Entry point — toolbar injection, slash commands, event binding
├── manifest.json               # Extension metadata & version
├── settings.html               # ST Extensions panel drawer UI
├── style.css                   # Full studio stylesheet (glassmorphism, themes, responsive)
│
├── core/
│   ├── agent.js                # Agentic loop — tool dispatching, stable/dynamic prompt split
│   ├── session.js              # Session state, IndexedDB persistence, schema migrations
│   ├── session-memory.js       # Global/per-character persistent memory rules
│   ├── pillars.js              # Pillar state management, progress tracking, duplicate detection
│   ├── tools.js                # 23+ tool implementations (field writes, lore CRUD, audit, etc.)
│   ├── tools-fallback.js       # 7-strategy XML/JSON parser + 90-variant name normalizer
│   ├── coherence-audit.js      # Static structural analysis engine (no LLM required)
│   ├── validators.js           # Field validation & quality scoring
│   ├── lorebook.js             # ST lorebook REST API wrapper & entry cache
│   ├── field-history.js        # Per-session undo/redo stack for field changes
│   ├── background.js           # Sequential background check queue (conflict detection)
│   ├── api-router.js           # Alternate API routing for background checks
│   ├── silent-generation.js    # Cancellable generation job wrapper (AbortController)
│   ├── token-utils.js          # Token estimation utilities
│   ├── st-context.js           # SillyTavern API bridge (getCtx)
│   └── multi-tab.js            # Heartbeat-based tab lock detection
│
├── prompts/
│   ├── identity.js             # AGENT_IDENTITY, FIELD_KNOWLEDGE, FORMAT_RULES,
│   │                           # NAMING_RULES, CREATIVE_PRINCIPLES (stable prefix layers)
│   ├── phase-instructions.js   # Layered prompt builder — stable prefix + dynamic suffix,
│   │                           # PHASE_PROMPTS (ideate/build/lore/audit),
│   │                           # phase-gated TOOL definitions
│   └── mode-prompts.js         # System prompts for JanitorAI/HTML/ImagePrompt modes
│
├── modes/
│   ├── janitor.js              # JanitorAI conversion options & instructions
│   ├── html.js                 # HTML intro templates & iframe helpers
│   ├── imageprompt.js          # Image prompt model configurations
│   └── fictionlab.js           # Coming soon blocked banner config
│
├── ui/
│   ├── app.js                  # Studio shell controller — mode manager, panel layout
│   ├── chat.js                 # Chat panel, input, suggestion chips, draft rendering
│   ├── lore-graph-v2.js        # Interactive force-directed lorebook graph visualization
│   ├── personality-radar.js    # Psychological profile radar chart
│   ├── prompt-inspector.js     # System prompt viewer modal
│   ├── mode-panel.js           # Mode selector dropdown
│   ├── settings-modal.js       # Settings tabs, file export/import
│   └── toast.js                # Toast notification builder
│
└── templates/
    └── settings-modal.html     # Settings drawer layout template
```

---

## 🔑 Key Design Principles

**Staged drafts, always.** Nothing writes to your card without your approval. Every field, every lorebook entry, every optimization goes through a review step first.

**Phase-gated tools.** The AI only has access to the tools relevant to the current phase. This prevents it from creating lorebook entries during ideation, or writing card fields during audit — and reduces the tool definition token overhead by ~1,100 tokens per turn.

**Stable prefix caching.** The system prompt is split into a stable section (cached across turns) and a dynamic section (rebuilt each turn with fresh card state). The stable prefix contains ~4,750 tokens of identity, field knowledge, format rules, and phase instructions — paid once, not per message.

**Local analysis first.** The static coherence audit, semantic search, and field validation all run locally with no LLM call. AI analysis is escalation, not the first step.

---

## 🤝 Credits

Built by **DeathGamerSolo**  
Character card writing philosophy informed by years of SillyTavern card authoring.  
v4.0.0+ agentic architecture built with AI assistance.

---

## 📄 License

MIT License — free to use, modify, and distribute.
