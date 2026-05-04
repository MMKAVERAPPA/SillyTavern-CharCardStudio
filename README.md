# 🎭 Character Card Studio

> An AI-powered character card and lorebook authoring studio for SillyTavern.

**Character Card Studio** is a full-screen SillyTavern extension that turns character card creation into a guided, collaborative process. Instead of filling fields manually, you have a conversation with an AI Lab Assistant that understands the SillyTavern card format deeply — it handles the craft while you handle the creative direction.

---

## ✨ Features

### 💡 Guided Ideation
- Pitch a concept and get a **5-axis rating** (Hook Strength, Longevity, Originality, RP Potential, Platform Appeal)
- Work through **Structural Pillars** — the foundational creative questions that shape every field
- **Smart pillar detection** automatically marks pillars as resolved as you answer them
- **Proposed Profile** summary before a single word is written — confirm the creative direction first
- Ask the AI to generate concept ideas from scratch if you're stuck

### 📝 Field Generation
- Generate any field individually, or **Generate All** at once
- **🎲 Variations mode** — get 3 parallel options for any field, pick or blend
- **Quick rewrite actions** (hover any accepted field): Shorten · Lengthen · Darker · More Specific · Elevate · Fix Format
- **Edit & Resend** any message in the chat — rolls back history and regenerates from that point
- **Generation Queue** — queue multiple fields to generate sequentially
- **Inline annotation** — select text in any response and instantly Expand / Make Specific / Explain Choice
- Auto `{{char}}`/`{{user}}` macro validation before accepting
- `mes_example` format auto-correction and behavioral rule detection
- **Field Preview Drawer** — click 👁 on any field to see current content inline
- **Revision History Timeline** — every accepted version tracked with AI-generated summaries, one-click restore

### 📖 Lorebook Builder
- Brainstorm all needed entries by category before generating
- Full metadata for every entry: keys, secondary keys, position, depth, insertion order, probability, constant flag
- **Staged entries** — review before inserting, accept individually or all at once
- **Duplicate detection** — skips entries with titles already in the lorebook
- **Keyword quality checker** — flags keys that are too broad, too narrow, or conflicting
- **Search and filter** by keyword or category across all accepted entries
- Supports both **embedded** (character_book) and **external standalone** lorebooks

### ⭐ Card Review Mode
Load any existing card (yours or downloaded) and:
- Get a **per-field quality rating** with specific feedback
- **Improve Mode** — surgical rewrites with full card context
- **Consistency Audit** — cross-field and lorebook contradiction detection
- **Adopt & Continue** — reverse-engineer a downloaded card's creative decisions and keep building from where the author left off

### 🔍 Quality Tools
- **Coherence Audit** — full cross-field consistency check on demand
- **Conflict Detection** — instant background check when you accept any field
- **Auto-Tag Inference** — AI suggests platform-appropriate tags with confidence levels
- **Token Budget Meter** — live token count with 4k/8k/16k/32k context fill bars
- **Platform-Aware Mode** — Chub / FictionLab / JanitorAI / Personal adjusts tag vocab, length targets, format guidance

### ⚙️ Power Features
- **Two-tier API system** — primary API for generation, separate utility API for fast background checks (pillar detection, conflict check, tag inference). Point utility at a cheap/fast model to save cost without affecting card quality
- **Voice/Tone Profile** — set POV, action format, prose density, formality register applied to every generation
- **Snippet Library** — reusable text snippets (system prompt boilerplate, creator notes templates, etc.) inserted into any prompt with one click
- **Export Session Log** — full markdown export of the ideation session, key decisions, all accepted fields, and lorebook index
- **Session compression** — long conversations auto-compress to preserve context quality

---

## 📦 Installation

### Method 1 — ST Extension Installer (recommended)
1. Open SillyTavern
2. Click the **Extensions** icon (stacked cubes) in the top bar
3. Click **Install Extension**
4. Paste your GitHub URL: `https://github.com/YOUR_USERNAME/CharCardStudio`
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

1. **Select a character** in SillyTavern (create a blank one if starting fresh)
2. **Open the Studio** — click the ✒️ pen-nib icon in the message bar, or open the Extensions panel and click **Open Studio**, or type `/charforge` in chat
3. **Pitch your concept** — describe the character idea in natural language
4. **Review the rating and pillars** — the AI will score your concept and ask foundational questions
5. **Answer the pillars** one by one — be specific, the AI will offer concrete options when you're vague
6. **Approve the Proposed Profile** — review the creative summary before writing begins
7. **Generate fields** — click 🪄 next to any field, or use ⚡ Generate All, or ask in chat
8. **Review and accept** each field — check the preview, accept to write to the card
9. **Build the lorebook** — switch to Lorebook tab, brainstorm categories, generate entries
10. **Export your session log** for documentation

---

## 🗣️ Useful Chat Commands

You don't need to memorize these — the AI understands natural language. But these phrases reliably trigger specific actions:

| Say this | What happens |
|---|---|
| `start building` / `let's build` | Moves from ideation to field generation |
| `generate all` / `fill all fields` | Generates every card field at once |
| `variations for [field]` | Opens 3-option variation mode for that field |
| `work on lorebook` | Switches to lorebook phase |
| `brainstorm entries` | Plans all lorebook categories |
| `check keywords` | Runs keyword quality check |
| `run audit` / `audit the card` | Full coherence audit |
| `review this card` | Card quality review with ratings |
| `give me an idea` | AI generates 3 original concepts |
| `/charforge` | Opens the studio from ST chat |

---

## ⚙️ Settings

Open Settings with the ⚙️ button in the Studio header.

### API Tab
| Setting | Description |
|---|---|
| **Primary API** | `ST Current` uses whatever ST has active. `Connection Profile` temporarily switches profiles during generation. |
| **Utility API** | `Same as primary` (default) or a custom OpenAI-compatible endpoint. Point this at a fast/cheap model (Gemini Flash, GPT-4o-mini, Haiku) for background checks without burning your main model. |
| **Custom System Prompt Rules** | Text appended to every system prompt — your personal writing rules enforced on all generation. |

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
- **Clear All Sessions**: Nuclear option — deletes all saved session data

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
├── manifest.json             # Extension metadata
├── settings.html             # ST Extensions panel UI
├── style.css                 # Full-screen studio styles
│
├── core/
│   ├── api.js               # Two-tier API manager (primary + utility)
│   ├── audit.js             # Coherence audit, conflict detection, tag inference
│   ├── card.js              # Card read/write, token counting, diff, macro validation
│   ├── chat.js              # Generation engine (wraps generateRaw correctly)
│   ├── context-builder.js   # System prompt + conversation assembly
│   ├── memory.js            # Session state, field versions, lorebook log, snippets
│   ├── parser.js            # Text parsing: fields, lorebook entries, ratings
│   └── worldinfo.js         # Lorebook CRUD (external + embedded)
│
├── phases/
│   ├── ideation.js          # Concept rating, pillar tracking, proposed profile
│   ├── generation.js        # Field generation, variations, rewrite actions, queue
│   └── lorebook-phase.js    # Entry generation, staging, deduplication
│
├── prompts/
│   ├── base.js              # Core identity, field definitions, writing philosophy
│   ├── audit.js             # Coherence audit, mes_example check, smart suggestions
│   ├── compressor.js        # Session compression brief
│   ├── generation.js        # Field generation instructions, rewrite actions
│   ├── ideation.js          # Concept rating, pillar discussion, proposed profile
│   ├── lorebook.js          # Entry generation schema, keyword checker
│   └── utility.js           # Lightweight prompts for utility-tier calls
│
└── ui/
    ├── card-panel.js        # Card status board, token meter, history, quick actions
    ├── chat-panel.js        # Chat area, streaming, edit/resend, accept bars, variations
    ├── idea-panel.js        # Concept rating display, pillar tracker
    ├── lorebook-panel.js    # Entry index, staging, search/filter
    ├── popup.js             # Full-screen overlay orchestrator
    └── settings-modal.js   # Settings modal (API, tone, snippets, session)
```

---

## 🐛 Troubleshooting

**Studio doesn't open**
- Make sure a character is selected in SillyTavern first
- Check that you have an API connection active

**Nothing generates**
- Requires SillyTavern 1.12+ (`generateRaw` API)
- Check ST's connection status — studio works with whatever API ST has active

**✒️ icon doesn't appear in message bar**
- The floating 🎭 button (bottom-right corner) is always available as fallback
- The pen-nib icon targets ST's `#send_form` — if your ST version uses a different structure it may miss. Use the floating button or the Extensions panel button instead.

**Session data lost**
- Sessions save automatically. If ST was force-closed mid-session, some messages at the tail may be lost but the core idea memory and accepted fields are preserved.

**Lorebook entries not appearing after insert**
- For embedded lorebooks: reload the character in ST after inserting (ST caches character data)
- For external lorebooks: check the lorebook is linked to the character in ST's World Info settings

---

## 📋 Requirements

- SillyTavern **1.12.0** or later
- Any configured AI API connection in ST (Claude, GPT, local models via Ollama/LM Studio, etc.)
- Modern browser (Chrome/Firefox/Edge — no IE or legacy browsers)

---

## 🤝 Credits

Built by **DeathGamerSolo**  
Character card writing philosophy informed by years of SillyTavern card authoring.

---

## 📄 License

MIT License — free to use, modify, and distribute.
