# 🎭 Character Card Studio

> An agentic AI-powered character card and lorebook authoring studio for SillyTavern.

---

> **Vibecoded Project**
>
> I built this extension mainly to make character cards for myself. I vibecoded the entire thing — just me, an AI assistant, and too much free time. Somewhere along the way it became very feature-heavy, but at its heart it's still a personal tool that happened to get uploaded to GitHub.
>
> Only the AI and God know what half the code is doing. The AI forgets between sessions, and God has better things to worry about. So if you find a bug: yes, probably. If it works perfectly: pleasant surprise. Well I think I did at least make it stable and relatively bug free and work as intended.

---

## What is Character Card Studio?

Character Card Studio is a full-screen SillyTavern extension that turns character card creation into a guided, conversational process. Instead of filling in fields manually, you have a structured conversation with an AI assistant that understands the SillyTavern card format deeply — it handles the craft while you handle the creative direction.

The studio supports multiple isolated modes, each with its own chat history:
1. **Studio Mode** — the primary mode that guides you through:
   - **Ideation** — pitch a concept, resolve creative pillars, calibrate the character's voice, and lock in a psychological profile before writing a single word.
   - **Building** — generate card fields individually or all at once, refine them with rewrite actions, run variations, and audit quality.
   - **Lore** — brainstorm entries by category, generate them with full World Info metadata, and stage/review before inserting them into an external named lorebook.
2. **JanitorAI Conversion Mode** — read your SillyTavern card and convert it to a JanitorAI-compatible format.
3. **HTML Intro Mode** — generate styled HTML character introductions in three complexity levels (Simple, Intermediate, Advanced) with a live iframe preview.
4. **Image Prompt Mode** — generate image prompts optimized for specific models (SD, Flux, MJ, NAI, etc.).
5. **FictionLab Mode** — experimental fiction generation mode (currently blocked with a placeholder).

---

## ✨ Features

### 💡 Guided Ideation (Studio Mode)
- Pitch a concept and get a **5-axis rating** (Hook Strength, Longevity, Originality, RP Potential, Platform Appeal).
- Work through **Structural Pillars** — foundational creative questions that shape every field.
- **Smart pillar detection** automatically marks pillars as resolved as you answer them in chat.
- **Card type detection** — the AI identifies whether this is a single, multi, or scenario card.
- **Voice calibration** — 3 sample lines to confirm the character's speech patterns before writing begins.
- **Psychological depth profiling** — Core Motivation, Primary Fear, Hidden Desire, Central Contradiction, The Wound, Stress Behavior, Social Mask — stored and distributed across all fields.
- **Proposed Profile** summary before a single word is written — confirm the creative direction first.

### 📝 Field Generation (Studio Mode)
- Generate any field individually, or **Generate All** at once.
- **Chain-of-thought** — every field goes through Plan → Draft → Self-Check → Output.
- **Staged drafts** — every AI-generated field is shown for review before being applied.
- **🎲 Variations mode** — get 3 parallel options for any field, pick or blend.
- **Quick rewrite actions** (hover any accepted field): Shorten · Lengthen · Darker · More Specific · Elevate · Fix Format · Voice.
- **Edit & Resend** any message in the chat — rolls back history and regenerates from that point.
- **Revision History Timeline** — every accepted version is tracked for one-click restore.
- **Character test drive** — AI simulates the character across 4 scenarios and critiques the card.

### 📖 Lorebook Builder (Studio Mode)
- Brainstorm all needed entries by category before generating.
- **Full World Info spec** — entries include all 18+ metadata features (Timed Effects, Inclusion Groups, Outlet positions, Character Filters, and more).
- **Staged entries** — review before inserting; accept individually or all at once.
- **Duplicate detection** — automatically skips entries already in the target lorebook.
- **Keyword quality checker** — flags keys that are too broad, too narrow, or conflicting.
- **Search and filter** by keyword or category across entries.
- **Always writes to an external named lorebook** — select or create one; selection is persisted.

### 🔄 JanitorAI Conversion
- **Personal field formatting** — simplifies and flattens nested PLists for JLLM compatibility.
- **System prompt conversion** — rewrites prompt rules into Janitor Custom Instructions.
- **Token budget warning** — checks total size to fit Janitor's context limitations (<2000 tokens target).

### 🌐 HTML Intro Generator
- **Simple** — HTML5 structure with inline basic styles.
- **Intermediate** — Styled with CSS animations and layout grids.
- **Advanced** — Full-fledged styling with `@keyframes`, responsive queries, and Google Fonts.
- **Live Preview** — sandboxed iframe preview in the right panel (`sandbox="allow-same-origin"` for script-free security).
- **Interactive command** — intercept `"preview"` commands locally to render quickly.

### 🎨 Image Prompt Generator
- Model-specific prompt templates: Stable Diffusion / SDXL, Illustrious XL, Flux Dev, NovelAI, and MidJourney.
- Artwork styling categories (Anime, Photoreal, Painterly) and camera shot types.

---

## 📦 Installation

### Method 1 — ST Extension Installer (Recommended)
1. Open SillyTavern.
2. Click the **Extensions** icon (stacked cubes) in the top bar.
3. Click **Install Extension**.
4. Paste: `https://github.com/MMKAVERAPPA/CharCardStudio` (or your repo URL).
5. Click **Install** — done.

### Method 2 — Manual
1. Clone or download this repository.
2. Move the `CharCardStudio` folder to:
   ```
   SillyTavern/public/scripts/extensions/third-party/CharCardStudio/
   ```
3. Restart or reload SillyTavern.
4. Open it via the wand icon (✨) in the chat input or the extensions panel.

### Requirements
- **SillyTavern** 1.12.0 or later.
- **Any LLM API** configured in SillyTavern (OpenAI, Claude, local models, etc.).
- **Recommended**: Set Prompt Post-Processing to "Semi-strict (alternating roles; with tools)".

---

## 🚀 Quick Start

### First Time Setup
1. **Select a character** in SillyTavern (or create a blank one if starting fresh).
2. **Open the Studio** — click the wand icon (✨) in the send bar, or click "Open Studio" in the extensions panel.
3. **On mobile** — the workspace panel starts collapsed; tap the handle bar (showing "📋 Card ▲") to expand it.

---

## 🗣️ Chat Commands

Natural language works, but these commands reliably trigger specific actions:

### Studio Mode — Ideation Phase
| Command | Action |
|---|---|
| `suggest ideas` / `give me ideas` | AI generates 3 character concepts |
| `switch to plist` / `use plist format` | Switches format preference to PList+Ali:Chat |
| `load existing` / `improve existing` | Loads current card for review and improvement |

### Studio Mode — Building Phase
| Command | Action |
|---|---|
| `generate all` / `fill all fields` | Generates every card field sequentially |
| `generate [field]` | Generates a specific field |
| `variations for [field]` | 3 parallel options for that field |
| `shorten [field]` / `lengthen [field]` | Rewrites a field shorter or longer |
| `darker [field]` / `more specific [field]` | Tonal/detail rewrites |
| `voice [field]` | Reinforces character's speech patterns |
| `test drive` / `test character` | Simulates character with diagnostic feedback |

### Studio Mode — Lorebook Phase
| Command | Action |
|---|---|
| `work on lorebook` | Switches to Lorebook phase |
| `brainstorm entries` | Plans lorebook categories |
| `generate entries` | Creates entries with full WI metadata |
| `check keywords` | Keyword quality audit |
| `insert all` / `accept all` | Inserts all staged entries |

### Quality & Audit
| Command | Action |
|---|---|
| `run audit` / `audit the card` | Full coherence audit |
| `review this card` | Card quality review with ratings |

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

### General Tab
- **Card Format Preference**: Default format preference (Prose / PList / Mixed).
- **Auto-Summarize Chat**: Toggles auto-summarization of old messages.
- **Threshold Slider**: Set message limit before summarization triggers (keeps last 15 intact).

### Session Tab
- **Export Session**: Download current session as JSON.
- **Import Session**: Load previously exported JSON session.
- **Clear Session**: Reset current session data (messages, drafts, pillars) while keeping character identity.

### Data Tab
- **Storage Usage**: Estimate size of indexDB entries.
- **Danger Zone**: Delete ALL CharCardStudio sessions for ALL characters (permanent).

### About Tab
- Version, author, GitHub links, license, and brief overview of modes.

---

## 🗂️ File Structure

```
CharCardStudio/
├── index.js                  # Entry point, toolbar injection, slash commands
├── manifest.json             # Extension metadata
├── settings.html             # ST Extensions panel UI
├── style.css                 # Glassmorphism studio styles & themes
│
├── core/
│   ├── agent.js              # Agent loop, XML/JSON parsing, tool dispatching
│   ├── session.js            # Session state, IndexedDB persistence, migrations, history swap
│   ├── session-memory.js     # Global/per-character session memory rules
│   ├── silent-generation.js  # Cancellable generation job wrapper
│   ├── tools.js              # 10 agentic tools (field writes, lore CRUD, conflict resolver)
│   ├── tools-fallback.js     # Regex-based JSON tool parser for non-native LLMs
│   ├── validators.js         # Field validation & quality scores
│   ├── lorebook.js           # Lorebook CRUD & caching
│   ├── background.js         # Sequential background check queue
│   └── multi-tab.js          # Heartbeat-based tab lock detector
│
├── modes/
│   ├── janitor.js            # JanitorAI conversion options & instructions
│   ├── html.js               # HTML intro templates & iframe helpers
│   ├── imageprompt.js        # Image prompt model configurations
│   └── fictionlab.js         # Coming soon blocked banner config
│
├── prompts/
│   ├── mode-prompts.js       # Mode system prompt templates
│   └── phase-instructions.js # layered prompt builder & studio instructions
│
├── templates/
│   └── settings-modal.html   # Settings drawer layout
│
└── ui/
    ├── app.js                # Studio shell controller & mode manager
    ├── chat.js               # Chat panel, input, chips, local preview hook
    ├── settings-modal.js     # Settings modal tabs & file export/import
    └── toast.js              # Toast notification builder
```

---

## 🤝 Credits

Built by **DeathGamerSolo**  
Character card writing philosophy informed by years of SillyTavern card authoring.  
v4.0.0 agentic architecture built with heavy AI assistance.

---

## 📄 License

MIT License — free to use, modify, and distribute.
