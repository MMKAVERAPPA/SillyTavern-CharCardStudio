# 🎭 Character Card Studio

> An AI-powered character card and lorebook authoring studio for SillyTavern.

---

> **Vibecoded Project**
>
> I built this extension mainly to make character cards for myself. I vibecoded the entire thing — just me, an AI assistant, and too much free time. Somewhere along the way it became very feature-heavy, but at its heart it's still a personal tool that happened to get uploaded to GitHub.
>
> Only the AI and God know what half the code is doing. The AI forgets between sessions, and God has better things to worry about. So if you find a bug: yes, probably. If it works perfectly: pleasant surprise. Well I think I did at least make it stable and relatively bug free and work as intended.

---

## What is Character Card Studio?

Character Card Studio is a full-screen SillyTavern extension that turns character card creation into a guided, conversational process. Instead of filling in fields manually, you have a structured conversation with an AI Lab Assistant that understands the SillyTavern card format deeply — it handles the craft while you handle the creative direction.

The studio guides you through three phases:
1. **Ideation** — pitch a concept, resolve creative pillars, calibrate the character's voice, and lock in a psychological profile before writing a single word
2. **Building** — generate card fields individually or all at once, refine them with rewrite actions, run variations, and audit quality
3. **Lorebook** — brainstorm entries by category, generate them with full World Info metadata, stage and review before inserting into an external named lorebook

---

## ✨ Features

### 💡 Guided Ideation
- Pitch a concept and get a **5-axis rating** (Hook Strength, Longevity, Originality, RP Potential, Platform Appeal)
- Work through **Structural Pillars** — the foundational creative questions that shape every field
- **Smart pillar detection** automatically marks pillars as resolved as you answer them
- **Card type detection** — the AI identifies whether this is a single, multi, or scenario card
- **Voice calibration** — 3 sample lines to confirm the character's speech patterns before writing begins
- **Psychological depth profiling** — Core Motivation, Primary Fear, Hidden Desire, Central Contradiction, The Wound, Stress Behavior, Social Mask — stored and distributed across all fields
- **Proposed Profile** summary before a single word is written — confirm the creative direction first
- Ask the AI to generate concept ideas from scratch if you're stuck

### 📝 Field Generation
- Generate any field individually, or **Generate All** at once
- **Chain-of-thought** — every field goes through Plan → Draft → Self-Check → Output
- **🎲 Variations mode** — get 3 parallel options for any field, pick or blend
- **Quick rewrite actions** (hover any accepted field): Shorten · Lengthen · Darker · More Specific · Elevate · Fix Format · Voice
- **Edit & Resend** any message in the chat — rolls back history and regenerates from that point
- **Generation Queue** — queue multiple fields to generate sequentially
- **Inline annotation** — select text in any response and instantly Expand / Make Specific / Explain Choice
- Auto `{{char}}`/`{{user}}` macro validation before accepting
- `mes_example` format auto-correction and behavioral rule detection
- **Field Preview Drawer** — click 👁 on any field to see current content inline
- **Revision History Timeline** — every accepted version tracked, one-click restore
- **Character test drive** — AI simulates the character across 4 scenarios and critiques the card

### 📖 Lorebook Builder
- Brainstorm all needed entries by category before generating
- **Full World Info spec** — entries include all 18+ metadata features (Timed Effects, Inclusion Groups, Outlet positions, Character Filters, and more)
- **Staged entries** — review before inserting; accept individually or all at once
- **Duplicate detection** — skips entries with titles already in the lorebook
- **Keyword quality checker** — flags keys that are too broad, too narrow, or conflicting
- **Search and filter** by keyword or category across all accepted entries
- **Always writes to an external named lorebook** — on entering the Lore phase you select or create one; selection is persisted across sessions

### ⭐ Card Review Mode
Load any existing card (yours or downloaded) and:
- Get a **per-field quality rating** with specific feedback
- **Improve Mode** — surgical rewrites with full card context
- **Consistency Audit** — cross-field and lorebook contradiction detection
- **Adopt & Continue** — reverse-engineer a downloaded card's creative decisions and keep building

### 🔍 Quality Tools
- **Coherence Audit** — full cross-field consistency check on demand
- **Conflict Detection** — instant background check when you accept any field
- **Style Consistency Check** — audits POV, tense, format, formality, and narrator voice across all fields
- **Psychological Depth Analyzer** — scores the character on 7 axes (Motivation, Fear, Contradiction, Growth, Relatability, Uniqueness, Consistency) and renders a visual bar chart
- **Cross-Reference Validator** — extracts all concrete facts and flags contradictions between fields and lorebook entries
- **Auto-Tag Inference** — AI suggests platform-appropriate tags with confidence levels
- **Token Budget Meter** — live token count with context fill percentage
- **Platform-Aware Mode** — Chub / FictionLab / JanitorAI / Personal adjusts tag vocab, length targets, and format guidance

### 🎨 UI & UX
- **Glassmorphism UI** — frosted-glass header and workspace panels with backdrop blur
- **4 Themes** — Dark (default), Midnight, Sepia, Light; selected in Settings → Appearance
- **Auto-complete chip bar** — phase-aware suggestions injected with one tap, no AI cost
- **Template Picker** — 4 archetype templates on New Session for quick ideation scaffolding
- **Progress Ring** — SVG circular indicator showing field completion with token count
- **Quick Edit** — click ✏️ on any field to edit inline without going through chat
- **Undo / Redo** — `Ctrl+Z` / `Ctrl+Shift+Z` to revert or replay field changes
- **Welcome Screen** — three quick-start cards on fresh sessions (Pitch, Surprise Me, Improve Existing)
- **Chat Search (Ctrl+F)** — filter chat messages instantly
- **Raw Context Inspector** — view the exact payload sent to the LLM
- **Ghost Mode (Alt+Shift+G)** — semi-transparent click-through overlay
- **Session Notes** — persistent scratchpad at the bottom of the Idea tab
- **Toast Notifications** — stacking auto-dismiss notifications
- **Mobile-first** — workspace is a collapsible bottom drawer on mobile; swipe left/right on the chat to change phases; haptic feedback on key interactions

### ⚙️ Power Features
- **Two-tier API system** — primary API for generation, separate utility API for fast background checks
- **Parallel API Calls** — concurrent requests for faster variation/batch generation
- **Voice/Tone Profile** — set POV, action format, prose density, formality register
- **Snippet Library** — reusable text snippets inserted into any prompt with one click
- **Export Session Log** — full markdown export of the entire session (`Ctrl+S`)
- **Session Import/Export** — save and restore full session state as JSON
- **Session compression** — auto-compress long conversations to preserve context quality
- **Usage Statistics** — tracks messages, tokens, field generations, and variations
- **Haptic feedback** — configurable vibration on mobile (off by default)

---

## 📦 Installation

### Method 1 — ST Extension Installer (Recommended)
1. Open SillyTavern
2. Click the **Extensions** icon (stacked cubes) in the top bar
3. Click **Install Extension**
4. Paste: `https://github.com/MMKAVERAPPA/SillyTavern-CharCardStudio`
5. Click Install — done

### Method 2 — Manual
1. Download or clone this repository
2. Copy the `CharCardStudio` folder to:
   ```
   SillyTavern/data/<your-username>/extensions/third-party/CharCardStudio/
   ```
3. Reload SillyTavern
4. Enable the extension in the Extensions panel

---

## 🚀 Quick Start

### First Time Setup
1. **Select a character** in SillyTavern (create a blank one if starting fresh)
2. **Open the Studio** — click **🪄 Extensions (wand)** in the send bar, or type `/charforge` in chat
3. **On mobile** — the workspace panel starts collapsed; tap the handle bar (showing "📋 Card ▲") to expand it

### Creating a Character

#### Phase 1: Ideation
1. Choose a quick-start action from the welcome screen — Pitch a Concept, Surprise Me, or Improve Existing
2. Review the concept rating and answer the structural pillars
3. Approve the voice calibration samples
4. Confirm the proposed profile and move to Building

#### Phase 2: Building
5. Generate fields — click 🪄 on any field, type `generate all`, or ask naturally
6. Review and refine — use quick rewrites (Shorten / Lengthen / Darker / Voice), variations, or inline edit
7. Run a test drive — type "test drive" to simulate the character

#### Phase 3: Lorebook
8. Switch to Lore — `Ctrl+3` or type "work on lorebook"
9. Select or create a named lorebook when prompted
10. Brainstorm entries, generate them, review staged entries, then insert

#### Finishing Up
11. Run a coherence audit — "audit the card"
12. Auto-generate tags
13. Export the session log (`Ctrl+S`)

---

## 🗣️ Chat Commands

You don't need to memorize these — natural language works. But these phrases reliably trigger specific actions:

### Ideation Phase
| Say this | What happens |
|---|---|
| `suggest ideas` / `give me ideas` | AI generates 3 original character concepts |
| `switch to plist` / `use plist format` | Switches format to PList+Ali:Chat |
| `load existing` / `improve existing` | Loads current card for review and improvement |

### Building Phase
| Say this | What happens |
|---|---|
| `generate all` / `fill all fields` | Generates every card field at once |
| `generate [field]` | Generates a specific field |
| `variations for [field]` | 3 parallel creative options for that field |
| `shorten [field]` / `lengthen [field]` | Rewrites a field shorter or longer |
| `darker [field]` / `more specific [field]` | Tonal/detail rewrites |
| `voice [field]` | Sharpens the character's speech patterns in that field |
| `test drive` / `test character` | Character simulation with diagnostic feedback |
| `start building` / `let's build` | Moves from Ideation to Building |

### Lorebook Phase
| Say this | What happens |
|---|---|
| `work on lorebook` | Switches to Lorebook phase |
| `brainstorm entries` | Plans all lorebook categories |
| `generate entries` | Creates entries with full WI metadata |
| `check keywords` | Keyword quality audit |
| `organize entries` | Sort and reorder by category |
| `insert all` / `accept all` | Inserts all staged entries |

### Quality & Audit
| Say this | What happens |
|---|---|
| `run audit` / `audit the card` | Full coherence audit |
| `review this card` | Card quality review with ratings |
| `/charforge` | Opens the studio from ST chat |

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+1` | Switch to Ideate phase |
| `Ctrl+2` | Switch to Build phase |
| `Ctrl+3` | Switch to Lore phase |
| `Ctrl+G` | Generate All fields |
| `Ctrl+F` | Search chat messages |
| `Ctrl+S` | Export session log |
| `Ctrl+/` | Focus chat input |
| `Ctrl+Z` | Undo last field change |
| `Ctrl+Shift+Z` | Redo last undone change |
| `Alt+Shift+G` | Toggle Ghost Mode |
| `Enter` | Send message |
| `Escape` | Minimize studio |

---

## ⚙️ Settings

Open Settings with the ⚙ button in the Studio header.

### API Tab
| Setting | Description |
|---|---|
| **Primary API** | `ST Current` uses whatever ST has active. `Connection Profile` picks from a dropdown of your saved ST profiles. |
| **Utility API** | `Same as primary` (default) or a custom OpenAI-compatible endpoint. Point this at a fast/cheap model (Gemini Flash, GPT-4o-mini, Haiku) for background checks without burning your main model. |
| **Custom System Prompt Rules** | Text appended to every system prompt — your personal writing rules enforced on all generation. |

### Appearance Tab
| Setting | Description |
|---|---|
| **Theme** | Dark (default), Midnight (deep navy), Sepia (warm brown), Light. Applied on save. |

### Tone Tab
Sets the output style profile applied to every generation:
- **POV**: Third person (she/he/they) or First person (I/me/my)
- **Action Format**: `*Asterisks*`, `_Italics_`, or no formatting
- **Prose Density**: Terse / Balanced / Rich
- **Formality Register**: Casual / Neutral / Formal

### Snippets Tab
Add reusable text snippets. They appear as clickable chips above the chat input. Useful for system prompt boilerplate, creator notes templates, content warning formats, etc.

### Session Tab
- **Compression Threshold**: How many messages before history auto-compresses (default: 15)
- **Parallel API Calls**: Enable/disable concurrent API requests for faster generation
- **Input Message Limit**: Cap messages at 12,000 characters (default: on)
- **Haptic Feedback**: Mobile vibration on key interactions (off by default)
- **Export/Import Session**: Save the full session state as JSON; restore from a previously exported file
- **Clear All Sessions**: Deletes all saved session data

---

## 🎛️ Platform Modes

Set in the Card panel or Settings. Affects tag suggestions, length targets, and format guidance:

| Platform | Notes |
|---|---|
| **Chub** | Longer cards preferred, HTML in creator_notes, detailed lorebooks |
| **FictionLab** | Field character limits apply, HTML creator_notes, scenario framing |
| **JanitorAI** | Shorter first_mes, simpler lorebooks, SFW-friendly tags |
| **Personal** | No platform constraints, optimize purely for quality |

---

## 🔧 Two-Tier API Setup (Advanced)

The Studio makes two kinds of AI calls:

**Primary** (generation) — writing field content, running the ideation conversation, card reviews. Needs a capable model. Uses ST's current connection by default.

**Utility** (background) — pillar resolution detection, conflict checks, auto-tag inference, version summaries. These are short, fast calls. Doesn't need a flagship model.

To set up a separate utility API:
1. Open Settings → API tab
2. Set **Utility API** to `Custom OpenAI-compatible endpoint`
3. Enter your endpoint URL (e.g. `https://openrouter.ai/api/v1`)
4. Enter your API key
5. Enter a model name (e.g. `google/gemini-flash-1.5` or `openai/gpt-4o-mini`)

---

## 🗂️ File Structure

```
CharCardStudio/
├── index.js                  # Extension entry point, toolbar injection, slash commands
├── manifest.json             # Extension metadata (v3.3.0)
├── settings.html             # ST Extensions panel UI
├── style.css                 # Full-screen studio styles (glassmorphism, themes, animations)
│
├── core/
│   ├── api.js               # Two-tier API manager (primary + utility) + error classification
│   ├── audit.js             # Coherence audit, depth analysis, style check, cross-ref, tag inference
│   ├── card.js              # Card read/write, token counting, diff, macro validation
│   ├── chat.js              # Generation engine with skill-aware context building
│   ├── context-builder.js   # Smart context sizing with field dependency graph
│   ├── haptic.js            # Mobile haptic feedback (navigator.vibrate wrapper)
│   ├── memory.js            # Session state, field versions, undo/redo stacks, export/import
│   ├── parser.js            # Text parsing: fields, lorebook entries, ratings
│   ├── skill-router.js      # Skill Engine — assembles expert modules per AI call
│   ├── stats.js             # Usage statistics tracking
│   └── worldinfo.js         # Lorebook CRUD (external named lorebooks + createLorebook)
│
├── phases/
│   ├── ideation.js          # Concept rating, card type detection, voice calibration
│   ├── generation.js        # CoT field generation, test drive, rewrite actions
│   └── lorebook-phase.js    # Mandatory named-lorebook selection, entry generation, staging
│
├── prompts/
│   ├── base.js              # Backward-compat wrapper → delegates to skill-router
│   ├── audit.js             # Backward-compat wrapper → delegates to skills
│   ├── compressor.js        # Session compression brief
│   ├── generation.js        # Detail levels, field prompts → delegates to skills
│   ├── ideation.js          # Legacy ideation prompts
│   ├── lorebook.js          # Backward-compat wrapper → delegates to skills
│   ├── utility.js           # Lightweight prompts for utility-tier calls
│   │
│   └── skills/              # Modular knowledge modules
│       ├── core.js          # Identity, field definitions, writing philosophy, naming
│       ├── formats.js       # Prose / PList / Ali:Chat format guides
│       ├── card-types.js    # Single / Multi / Scenario card type expertise
│       ├── field-craft.js   # First Message, System Prompt, NSFW, Psychology
│       ├── phase-ideation.js    # Concept rating, voice cal, proposed profile
│       ├── phase-generation.js  # Chain-of-thought, field instructions, rewrites
│       ├── phase-lorebook.js    # Full World Info spec (18+ features)
│       └── phase-audit.js       # Coherence audit, depth, style, cross-ref, simulation
│
├── templates/               # Archetype templates (v3.3)
│   ├── fantasy-warrior.json
│   ├── romance-modern.json
│   ├── scifi-commander.json
│   └── horror-survivor.json
│
└── ui/
    ├── card-panel.js        # Card status board, progress ring, quick edit, depth radar
    ├── chat-panel.js        # Chat area, welcome screen, streaming, accept bars
    ├── idea-panel.js        # Concept rating display, pillar tracker
    ├── lorebook-panel.js    # Entry index, staging, target banner, search/filter
    ├── popup.js             # Full-screen overlay orchestrator, shortcuts, swipe, undo/redo
    ├── settings-modal.js    # Settings modal (API, appearance, tone, snippets, session)
    └── toast.js             # Stacking toast notification system
```

---

## 🐛 Troubleshooting

**Studio doesn't open**
- Use the **🪄 Extensions (wand)** menu or type `/charforge` in ST chat
- The studio opens even without a character selected — it shows a prompt to pick one first

**Mobile: workspace panel doesn't show**
- Tap the handle bar at the bottom of the studio (shows "📋 Card ▲") to slide it up

**API errors during generation**
- Rate limit (429): Generation stops automatically, wait and retry
- Insufficient balance (402): Check your API provider balance
- Server errors (500+): Temporary — the extension shows an error toast and stops

**Session data lost**
- Sessions save automatically. If ST was force-closed mid-session, some messages at the tail may be lost but the core idea memory and accepted fields are preserved

**Lorebook entries not appearing after insert**
- Check the lorebook is linked to the character in ST's World Info settings

**Lorebook panel shows "No lorebook selected" after searching**
- This was a bug in earlier builds. Update to v3.3.0 — it is fixed.

---

## 📋 Requirements

- SillyTavern **1.12.0** or later
- Any configured AI API connection in ST (Claude, GPT, Gemini, local models via Ollama/LM Studio, etc.)
- **Recommended:** A high-context model (100k+ tokens) for best results with the skill system
- Modern browser (Chrome / Firefox / Edge)

---

## 🤝 Credits

Built by **DeathGamerSolo**  
Character card writing philosophy informed by years of SillyTavern card authoring.  
v3.0 Skill Engine knowledge modules derived from expert-level preset engineering.

---

## 📄 License

MIT License — free to use, modify, and distribute.

---

*For a full version history, see [CHANGELOG.md](CHANGELOG.md).*
