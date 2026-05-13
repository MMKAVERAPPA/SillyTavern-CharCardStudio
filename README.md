# 🎭 Character Card Studio

> An AI-powered character card and lorebook authoring studio for SillyTavern — now with the **Skill Engine**.

**Character Card Studio** is a full-screen SillyTavern extension that turns character card creation into a guided, collaborative process. Instead of filling fields manually, you have a conversation with an AI Lab Assistant that understands the SillyTavern card format deeply — it handles the craft while you handle the creative direction.

**v3.3.0** — **Experience & Polish.** 4 themes (Dark/Midnight/Sepia/Light), per-phase auto-complete chips, swipe-to-change-phase on mobile, `Ctrl+Z`/`Ctrl+Shift+Z` undo/redo, session import/export, template picker on new session, psychological depth radar chart, style consistency & cross-reference audit, haptic feedback.


---

## 🆕 What's New in v3.0.0 — The Skill Engine

### 🧠 Modular Skill Architecture
The AI no longer uses a single static system prompt for everything. Instead, a **Skill Router** assembles specialized knowledge modules on-the-fly:

- **Core Skills** (always loaded) — Identity, SillyTavern field definitions, writing philosophy, naming rules
- **Format Skills** — Prose (default) or PList+Ali:Chat, loaded based on your choice
- **Card Type Skills** — Single character, Multi-character, or Scenario/World card expertise
- **Phase Skills** — Different expert knowledge for ideation, generation, lorebook, and audit
- **Field-Craft Skills** — Deep expertise for specific fields (First Message craft, System Prompt design, NSFW balance)

This means when you're generating a first message, the AI knows about the **Flipped Scenario Technique**, constrained freedom endings, and FM-length-as-response-anchor. When you're building lorebook entries, it knows about **all 18+ World Info features** including Timed Effects, Inclusion Groups, and Outlet positions.

### 🎤 Voice Calibration
After resolving your character's creative pillars, the Studio now runs a **voice calibration step**:
1. The AI generates 3 sample lines showing your character in different situations
2. You review and confirm the voice feels right
3. That confirmed voice becomes the reference for **every field** generated afterward

This ensures the character sounds consistent across description, first message, example dialogue, and alternate greetings.

### 🧬 Psychological Depth Profiling
Every character now gets a structured psychological profile automatically extracted during ideation:

| Dimension | What It Captures |
|-----------|-----------------|
| Core Motivation | What drives them at their deepest level |
| Primary Fear | What they're most afraid of (often unconscious) |
| Hidden Desire | What they want but won't admit |
| Central Contradiction | The gap between who they are and who they present as |
| The Wound | The formative experience that shaped them |
| Stress Behavior | How they act under pressure |
| Social Mask | What they show the world vs. what's underneath |

This profile is stored in the session and **distributed across every field** — description shows the mask, first message reveals cracks in it, example messages demonstrate stress behavior.

### 🔗 Chain-of-Thought Generation
Every field generation now follows a structured internal process:
```
[PLAN]   → What sections, what format, what consistency checks?
[DRAFT]  → The actual content
[CHECK]  → Actor Test, Distinctiveness, Counterweight Rule, Voice Consistency
[OUTPUT] → The final approved version
```

The AI self-checks every field against quality criteria before presenting it to you.

### 🎯 Smart Context Sizing
When generating a field, the AI now gets **full content** for that field's dependencies instead of truncated previews:

- Generating `first_mes`? → Full `description` + `scenario` + `personality` in context
- Generating `system_prompt`? → Full `description` in context (to avoid duplicating content)
- Generating `creator_notes`? → Only short previews (independent field)

This prevents the AI from contradicting or duplicating content across fields.

### 🎭 Character Test Drive
After building your card, type **"test drive"** in the Build phase to simulate your character:
- The AI temporarily "becomes" the character using **only** the card content
- It runs through 4 test scenarios (casual, stressed, confronted, intimate)
- After each response, it breaks character to critique: *"The card handled X well but Y was vague because..."*
- Generates actionable suggestions for card refinement

### 📚 Full World Info Specification
The lorebook builder now teaches the AI about **all** SillyTavern World Info features:

| Feature | Status |
|---------|--------|
| Basic keys, position, depth, insertion order | ✅ Was supported |
| Optional Filters (AND ANY / AND ALL / NOT ANY / NOT ALL) | 🆕 New |
| Timed Effects (Sticky, Cooldown, Delay) | 🆕 New |
| Inclusion Groups with Group Weight | 🆕 New |
| Character Filters (include/exclude) | 🆕 New |
| Recursion chains and non-recursable entries | 🆕 New |
| Outlet positions with `{{outlet::Name}}` macro | 🆕 New |
| Regex key support | 🆕 New |
| Scan depth recommendations by card type | 🆕 New |
| Environment PList format for world entries | 🆕 New |

### 🔀 Card Type Detection
The AI now automatically detects whether you're building:
- **Type A — Single Character** (companion, romance, mentor)
- **Type B — Multi-Character** (voice collision tests, `{{char}} = Name1, Name2` declaration)
- **Type C — Scenario/World Card** (world-as-character, NPC patterns, `{{user}}` minimization)

Each type loads specialized rules — multi-character cards get guidance on preventing voice blending, scenario cards get NPC companion patterns.

### 📝 Format Flexibility
- **Default:** Prose format (natural language descriptions)
- **Switchable:** Type "switch to plist" in chat to switch to PList+Ali:Chat
- Format choice propagates through all generation — the AI adjusts structure, placement rules, and counterweight guidance accordingly

---

## ✨ Core Features

### 💡 Guided Ideation
- Pitch a concept and get a **5-axis rating** (Hook Strength, Longevity, Originality, RP Potential, Platform Appeal)
- Work through **Structural Pillars** — the foundational creative questions that shape every field
- **Smart pillar detection** automatically marks pillars as resolved as you answer them
- **Card type detection** — the AI identifies whether this is a single, multi, or scenario card
- **Voice calibration** — 3 sample lines to confirm the character's speech patterns before writing begins
- **Psychological depth profiling** — structured personality profile extracted from your creative decisions
- **Proposed Profile** summary before a single word is written — confirm the creative direction first
- Ask the AI to generate concept ideas from scratch if you're stuck

### 📝 Field Generation
- Generate any field individually, or **Generate All** at once
- **Chain-of-thought** — every field goes through Plan → Draft → Self-Check → Output
- **🎲 Variations mode** — get 3 parallel options for any field, pick or blend
- **Quick rewrite actions** (hover any accepted field): Shorten · Lengthen · Darker · More Specific · Elevate · Fix Format · **Voice** (new — sharpen speech patterns)
- **Edit & Resend** any message in the chat — rolls back history and regenerates from that point
- **Generation Queue** — queue multiple fields to generate sequentially
- **Inline annotation** — select text in any response and instantly Expand / Make Specific / Explain Choice
- Auto `{{char}}`/`{{user}}` macro validation before accepting
- `mes_example` format auto-correction and behavioral rule detection
- **Field Preview Drawer** — click 👁 on any field to see current content inline
- **Revision History Timeline** — every accepted version tracked with AI-generated summaries, one-click restore
- **Content snippet** — first 80 characters of each field shown directly on the card panel
- **Character test drive** — simulate your character to find card gaps before publishing

### 📖 Lorebook Builder
- Brainstorm all needed entries by category before generating
- **Full World Info spec** — entries include all 18+ metadata features (Timed Effects, Inclusion Groups, Outlet positions, Character Filters, and more)
- **Staged entries** — review before inserting, accept individually or all at once
- **Duplicate detection** — skips entries with titles already in the lorebook
- **Keyword quality checker** — flags keys that are too broad, too narrow, or conflicting
- **Search and filter** by keyword or category across all accepted entries
- **Always writes to an external named lorebook** — on entering Lore phase you select or create one; selection is persisted across sessions

### ⭐ Card Review Mode
Load any existing card (yours or downloaded) and:
- Get a **per-field quality rating** with specific feedback
- **Improve Mode** — surgical rewrites with full card context
- **Consistency Audit** — cross-field and lorebook contradiction detection
- **Adopt & Continue** — reverse-engineer a downloaded card's creative decisions and keep building from where the author left off

### 🔍 Quality Tools
- **Coherence Audit** — full cross-field consistency check on demand
- **Conflict Detection** — instant background check when you accept any field
- **Character Test Drive** — AI becomes the character and critiques the card
- **Auto-Tag Inference** — AI suggests platform-appropriate tags with confidence levels
- **Token Budget Meter** — live token count with context fill percentage
- **Platform-Aware Mode** — Chub / FictionLab / JanitorAI / Personal adjusts tag vocab, length targets, format guidance

### 🎨 UI & UX
- **Glassmorphism UI** — frosted-glass header and workspace panels with backdrop blur
- **4 Themes** — Dark (default), Midnight, Sepia, Light; selected in Settings → Appearance
- **Auto-complete chip bar** — phase-aware suggestions injected with one tap, no AI cost
- **Gradient accents** — buttons, title text, and send button use a blue-to-purple gradient
- **Inter font** — clean, modern typography with system font fallback
- **Smooth animations** — message entrance, field status glow transitions, progress ring
- **Welcome Screen** — three quick-start cards on fresh sessions (Pitch, Surprise Me, Improve Existing)
- **Template Picker** — 4 archetype templates on New Session for quick ideation scaffolding
- **Progress Ring** — SVG circular indicator showing field completion with token count
- **Quick Edit** — click ✏️ on any field to edit inline without going through chat
- **Undo / Redo** — `Ctrl+Z` / `Ctrl+Shift+Z` to revert or replay field changes
- **Psychological Depth Radar** — 7-axis bar chart in card panel after running depth analysis
- **Chat Search (Ctrl+F)** — filter chat messages instantly
- **Raw Context Inspector** — view the exact payload sent to the LLM
- **Ghost Mode (Alt+Shift+G)** — semi-transparent click-through overlay
- **Session Notes** — persistent scratchpad at the bottom of the Idea tab
- **Toast Notifications** — stacking auto-dismiss notifications
- **Mobile-first** — opens via 🪄 Extensions wand on any screen size; workspace is a collapsible bottom drawer on mobile; swipe left/right on chat to change phases

### ⚙️ Power Features
- **Two-tier API system** — primary API for generation, separate utility API for fast background checks. Point utility at a cheap/fast model to save cost
- **Parallel API Calls** — concurrent requests for faster variation/batch generation
- **Voice/Tone Profile** — set POV, action format, prose density, formality register
- **Snippet Library** — reusable text snippets inserted into any prompt with one click
- **Export Session Log** — full markdown export of the entire session (`Ctrl+S`)
- **Session Import/Export** — save and restore full session state as JSON
- **Session compression** — auto-compress long conversations to preserve context quality
- **Usage Statistics** — tracks messages, tokens, field generations, and variations
- **Haptic feedback** — configurable vibration on mobile for key interactions

---

## 📦 Installation

### Method 1 — ST Extension Installer (Recommended)
1. Open SillyTavern
2. Click the **Extensions** icon (stacked cubes) in the top bar
3. Click **Install Extension**
4. Paste the GitHub URL: `https://github.com/MMKAVERAPPA/SillyTavern-CharCardStudio`
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
3. **On mobile** — the workspace panel starts collapsed at the bottom; tap the handle bar (showing "📋 Card ▲") to expand it

### Creating a Character

#### Phase 1: Ideation
1. **Choose a quick-start action** from the welcome screen:
   - 💡 **Pitch a Concept** — describe your character idea in natural language
   - 🎲 **Surprise Me** — AI generates 3 original concepts for you
   - 📂 **Improve Existing** — load and enhance the current card's content
2. **Review the concept rating** — the AI scores your concept on 5 axes and auto-detects the card type (single/multi/scenario)
3. **Answer the structural pillars** — these are the foundational creative questions (personality core, central conflict, relationship dynamic, etc.)
   - Be specific! "She's cold but secretly caring" → "She deflects emotional moments with sarcasm, but always shows up when it matters — with actions, never words"
   - The AI will offer concrete options when you're vague
4. **Voice calibration** — after all pillars are resolved, the AI generates 3 sample lines in the character's voice. Approve them or request adjustments
5. **Review the proposed profile** — a full creative summary including the psychological depth profile. Approve it to move to building

#### Phase 2: Building
6. **Generate fields** — three ways:
   - Click 🪄 next to any field on the card panel
   - Type `generate all` in chat for all fields at once
   - Ask naturally: "write the description" or "create the first message"
7. **Review each field** — the AI presents content in a code block with an Accept button
   - Check that voice is consistent across fields
   - Use the **progress ring** to track completion (e.g. "5/7 fields")
8. **Refine fields** — multiple options:
   - **Quick rewrite**: Hover a field → Shorten / Lengthen / Darker / Specific / Elevate / Fix Format / Voice
   - **Variations**: "give me variations for first_mes" → 3 parallel options
   - **Quick edit**: Click ✏️ to edit inline directly
   - **Test drive**: Type "test drive" to simulate the character and find gaps
9. **Switch format** (optional) — type "switch to plist" to change from Prose to PList+Ali:Chat format

#### Phase 3: Lorebook
10. **Switch to Lore tab** — press `Ctrl+3` or type "work on lorebook"
11. **Brainstorm entries** — "brainstorm entries" generates a categorized plan of all needed entries
12. **Generate entries** — "generate 5 entries" creates full entries with all World Info metadata
13. **Review staged entries** — check keys, position, depth, and content in the Lorebook panel
14. **Insert entries** — accept individually or "insert all" at once
15. **Keyword audit** — "check keywords" runs a quality check on all accepted entries

#### Finishing Up
16. **Run a coherence audit** — "audit the card" for a full cross-field consistency check
17. **Auto-generate tags** — the AI suggests platform-appropriate tags
18. **Export session log** — save a full markdown record of your creative process

---

## 🗣️ Chat Commands

You don't need to memorize these — the AI understands natural language. But these phrases reliably trigger specific actions:

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
| `generate [field]` | Generates a specific field (e.g., "generate description") |
| `variations for [field]` | 3 parallel creative options for that field |
| `shorten [field]` / `lengthen [field]` | Rewrites a field shorter or longer |
| `darker [field]` / `more specific [field]` | Tonal/detail rewrites |
| `voice [field]` | Sharpens the character's speech patterns in that field |
| `test drive` / `test character` | Character simulation with diagnostic feedback |
| `start building` / `let's build` | Moves from ideation to field generation |

### Lorebook Phase
| Say this | What happens |
|---|---|
| `work on lorebook` | Switches to lorebook phase |
| `brainstorm entries` | Plans all lorebook categories |
| `generate entries` | Creates entries with full WI metadata |
| `check keywords` | Keyword quality audit |
| `organize entries` | Sort and reorder by category |
| `insert all` / `accept all` | Inserts all staged entries |
| `embedded` / `external` | Sets lorebook target mode |

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
Add reusable text snippets. They appear as clickable chips above the chat input. Click a chip to append the snippet content to your message — useful for system prompt boilerplate, creator notes templates, content warning formats, etc.

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

Utility calls are fire-and-forget — if the utility API is unavailable, the main flow continues normally.

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
│   ├── haptic.js            # ★ Mobile haptic feedback (navigator.vibrate wrapper)
│   ├── memory.js            # Session state, field versions, undo/redo stacks, export/import
│   ├── parser.js            # Text parsing: fields, lorebook entries, ratings
│   ├── skill-router.js      # ★ Skill Engine — assembles expert modules per AI call
│   ├── stats.js             # Usage statistics tracking
│   └── worldinfo.js         # Lorebook CRUD (external + createLorebook)
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
│   └── skills/              # ★ Modular knowledge modules (v3.0)
│       ├── core.js          # Identity, field definitions, writing philosophy, naming
│       ├── formats.js       # Prose / PList / Ali:Chat format guides
│       ├── card-types.js    # Single / Multi / Scenario card type expertise
│       ├── field-craft.js   # First Message, System Prompt, NSFW, Psychology
│       ├── phase-ideation.js    # Concept rating, voice cal, proposed profile
│       ├── phase-generation.js  # Chain-of-thought, field instructions, rewrites
│       ├── phase-lorebook.js    # Full World Info spec (18+ features)
│       └── phase-audit.js       # Coherence audit, depth, style, cross-ref, simulation
│
├── templates/               # ★ Archetype templates (v3.3)
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
- The studio now opens even without a character selected — it shows a prompt to pick one first

**✒️ pen-nib icon missing from message bar**
- This is expected in v3.1.0 — the toolbar button was removed for mobile compatibility
- Use the **🪄 Extensions (wand)** menu instead; it works on both desktop and mobile

**Mobile: workspace panel doesn't show**
- Tap the **handle bar** at the bottom of the studio (shows "📋 Card ▲") to slide it up
- Or swipe up anywhere on the workspace area to expand it

**API errors during generation**
- Rate limit (429): Generation stops automatically, wait and retry
- Insufficient balance (402): Check your API provider balance
- Server errors (500+): Temporary — the extension will stop and show an error toast

**Session data lost**
- Sessions save automatically. If ST was force-closed mid-session, some messages at the tail may be lost but the core idea memory and accepted fields are preserved.

**Lorebook entries not appearing after insert**
- For embedded lorebooks: reload the character in ST after inserting (ST caches character data)
- For external lorebooks: check the lorebook is linked to the character in ST's World Info settings

**Old session doesn't have v3.0 features**
- Sessions created before v3.0 will work fine but won't have card type, voice profile, or psych profile data pre-populated. Start a new session to get the full v3.0 experience.

---

## 📋 Requirements

- SillyTavern **1.12.0** or later
- Any configured AI API connection in ST (Claude, GPT, Gemini, local models via Ollama/LM Studio, etc.)
- **Recommended:** A high-context model (100k+ tokens) like GLM-4, Gemini Pro, or Claude for best results with the skill system
- Modern browser (Chrome/Firefox/Edge — no IE or legacy browsers)
- Internet connection recommended (for Inter font from Google Fonts; falls back to system fonts offline)

---

## 📜 Version History

| Version | Highlights |
|---------|-----------|
| **v3.3.0** | 4 themes, auto-complete chips, swipe-to-change-phase, Ctrl+Z/Redo undo, session import/export, template picker, depth radar chart, style consistency & cross-ref audit, haptic feedback, profile dropdown |
| **v3.2.0** | Virtual scrolling (50-msg DOM cap with load-more), auto-retry on rate limits, global error boundary, input message limit toggle, `updateCardFields` diffing, AbortController annotation cleanup, CONTRIBUTING.md, CHANGELOG.md |
| **v3.1.1** | Mobile minimize pill, settings modal mobile fix |
| **v3.1.0** | Mobile UI overhaul — collapsible bottom drawer, swipe gestures, wand-menu only entry point, no-character screen, reliable mobile rendering |
| **v3.0.0** | Skill Engine architecture, voice calibration, psychological profiling, chain-of-thought generation, smart context sizing, character test drive, full World Info spec, format flexibility |
| **v2.6.0** | Chat search (Ctrl+F), Raw Context Inspector, Ghost Mode, Session Notes, Usage Statistics |
| **v2.5.0** | Glassmorphism UI overhaul, Welcome Screen, Progress Ring, Quick Edit, keyboard shortcuts, toast notifications, mobile improvements |
| **v2.0.1** | API error classification, automatic generation stop on critical errors, parallel API toggle, graceful streaming cleanup |
| **v2.0.0** | Full-screen studio, two-tier API, guided ideation with pillars, field variations, lorebook builder, coherence audit, snippet library |
| **v1.0.0** | Initial release — basic character card generation assistant |

---

## 🤝 Credits

Built by **DeathGamerSolo**
Character card writing philosophy informed by years of SillyTavern card authoring.
v3.0 Skill Engine knowledge modules derived from expert-level preset engineering.

---

## 📄 License

MIT License — free to use, modify, and distribute.
