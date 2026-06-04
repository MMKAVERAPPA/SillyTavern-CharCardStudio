# CharCardStudio — v5.0 Roadmap

> **Status as of v4.2.1:** Priorities 1 through 3 and all housekeeping items are fully implemented.
> This document covers **Priority 4 only** — the v5.0 major systems.
> This is the single source of truth for all future development.

---

## 📚 Resources & References

- **ST World Info Docs:** `SillyTavernDocs/Usage/worldinfo.md` — canonical reference for all WI behavior
- **v6 Preset (Gold Standard):** `Character_Creator_Assistant_v6.json`
- **Reference Extension Analysis:** `../Studio/EXTENSION_ANALYSIS.md`
- **Reference Extensions:** ST-Copilot, Saints-Silly-Extensions, Lorewalker, World-Forge (see old Plan archive)

---

## 🗺️ v5.0 Architecture Overview

```
v5.0 Release
├── 4.1 — Advanced Lore Graph (canvas-based, full visual intelligence)
├── 4.2 — Avatar Generation Hook (AI writes SD prompt, user confirms, ST generates)
├── 4.3 — Chat Log Analysis (user picks N messages, AI stages targeted card updates)
└── 4.4 — World / Campaign Mode (new 'World' mode tab, Campaign View, cross-world AI tools)
```

All four features ship together as v5.0. Design and plan everything now, implement in order 4.1 → 4.4.

---

## 🌐 4.1 — Advanced Lore Graph (v5.0)

### Overview

A complete rebuild of the existing basic SVG lore graph (`ui/lore-graph.js`) into a **canvas-based, fully interactive visual intelligence system** that makes the lorebook's activation topology instantly understandable.

The graph is opened via a **full-screen overlay** button in the Lore tab — a dedicated 🗺️ icon that expands the graph to fill the entire Studio window (the `#ccs_window` layer), with the rest of the UI temporarily hidden behind it.

---

### 4.1.1 — Rendering Engine

**File:** New `ui/lore-graph-v2.js` (replaces `ui/lore-graph.js`)

**Why rebuild:** The current SVG-based renderer cannot handle:
- Zoom/pan with smooth performance at 50+ nodes
- Canvas-level interactivity (hover, lasso, drag with grid snap)
- Mobile pinch-to-zoom
- Minimap rendering
- Node sizing by token weight

**Technology choice:** `<canvas>` 2D API — no external libraries. Pure JS physics simulation + canvas rendering loop. This keeps the bundle small and gives maximum control.

**Rendering loop:**
```
requestAnimationFrame loop:
  1. Run physics tick (force simulation)
  2. Clear canvas
  3. Draw edges (arrows, colors based on type)
  4. Draw nodes (circles/cards, colored by category)
  5. Draw labels
  6. Draw minimap (separate small canvas in corner)
  7. Draw overlay panels (search, simulate, node detail)
```

---

### 4.1.2 — Node Appearance

Each node is a **rounded rectangle card** (not just a circle) containing:

```
┌─────────────────────────────────┐
│ [CATEGORY BADGE]   🔵 CONSTANT  │  ← strategy icon
│ Entry Name                      │
│ ~142t  ⟳ recursion-level: 2    │  ← token count + flags
└─────────────────────────────────┘
```

**Node sizing:** When **Token Count Overlay Mode** is active (toggle in toolbar), node width scales proportionally to token count — visually revealing which entries are "heavy" vs "light".

**Node color:** Category-based, consistent with the list view:
- Geography → `#3b82f6` (blue)
- Factions → `#ef4444` (red)
- NPCs → `#f59e0b` (amber)
- Magic System → `#8b5cf6` (purple)
- Items → `#10b981` (emerald)
- History → `#6b7280` (gray)
- Culture → `#ec4899` (pink)
- Rules/Constant → `#f97316` (orange)
- Uncategorized → `#4b5563` (dark gray)

**Node decorations (overlaid icons):**
- 🔵 Constant strategy — pulsing glow ring around node
- 🔗 Vector/keyless — dashed border
- ⚪ Disabled — node rendered at 30% opacity with strikethrough on name
- ⛔ Non-recursable — small grey shield icon in top-right corner of card
- 🛑 Prevent further recursion — red stop icon in top-right corner
- ⏳ Delay until recursion — clock icon, dotted border
- 🎲 Probability < 100% — dice icon with % number overlay
- 📌 Pinned (user locked position) — pin icon in top-left corner
- 🔒 Inclusion group member — lock icon (group label shown on hover)

---

### 4.1.3 — Edge (Connection) Visual Language

Edges represent activation relationships between entries. Multiple visual types:

| Edge Type | Visual | Meaning |
|---|---|---|
| **Direct activation** | Solid arrow, category color | Entry A's content contains Entry B's primary key |
| **Conditional activation** | Dashed arrow, dimmer color | Activation depends on secondary key logic (AND ANY / NOT ANY) |
| **Constant → anything** | Glowing/pulsing solid arrow | Source is CONSTANT so this link always fires |
| **Stops recursion** | Red arrow with ⛔ at target end | Source activates target but target has "Prevent further recursion" |
| **Probabilistic** | Yellow arrow | Target has Probability < 100%, may not fire even when triggered |
| **Inclusion group** | Purple bidirectional dashed line | Entries compete — only one will activate |
| **Recursive-only path** | Dotted arrow with ⏳ | Target only activates during recursive scan passes |

**Arrow direction:** Always Source → Target (A triggers B = A → B arrow).

**Edge labels:** On hover, an edge shows a tooltip: `"Contains key: 'rufus'" | AND ANY: ['dog','companion']`

---

### 4.1.4 — Physics Simulation

**Default layout:** Physics-based force simulation, **with category clustering**.

The algorithm:
1. **Category repulsion zones:** Virtual "center-of-mass" attractors per category. Each node is pulled toward its category's centroid.
2. **Node-node repulsion:** All nodes repel each other (Barnes-Hut approximation for performance).
3. **Edge attraction:** Connected nodes are pulled together (spring force, proportional to edge strength).
4. **Damping:** Velocity is damped each tick so simulation settles to a stable state.
5. **Grid snap:** When grid snap is enabled (toolbar toggle), nodes snap to a 40px grid on release.

**Performance:** For 50+ nodes, Barnes-Hut spatial partitioning is used. For 100+ nodes, a simplified "category cluster" static layout is used instead of physics (user can toggle physics back on).

**Pinned nodes:** User can lock any node (`📌`). Pinned nodes have zero velocity — they act as anchors for the physics simulation around them.

---

### 4.1.5 — Interactive Controls

**Full-screen overlay toolbar (top bar):**
```
[← Back to Lore] [📐 Grid Snap] [📌 Lock Mode] [🔢 Token Size Mode]
[🔍 Search] [⚡ Simulate] [📤 Export PNG] [📊 Stats]
```

**Navigation (all platforms):**
- **Desktop:** Scroll wheel = zoom, click+drag on empty space = pan, click node = select, drag node = move
- **Mobile:** Pinch = zoom, one-finger drag on empty space = pan, tap node = select, long-press node = context menu

**Lasso selection:** Click+drag on empty space (while holding Shift) draws a selection rectangle. All nodes within are selected together for bulk operations.

**Minimap:** Small `<canvas>` in the bottom-right corner (120×80px) showing a scaled overview of the full graph with a viewport indicator rectangle. Click minimap to jump to that area.

**Zoom controls:** `+` / `-` buttons in corner for accessibility. Zoom level shown as `120%`. Fit-to-screen button centers and scales all nodes.

---

### 4.1.6 — Search & Filter Bar

**Location:** Expandable bar under the top toolbar (toggle via 🔍 button).

**Behavior:**
- Type a keyword or entry name → matching nodes pulse/glow, non-matching nodes dim to 20% opacity
- Matching includes: entry name, entry keys, entry content (partial match)
- **Clear button** resets all nodes to full opacity
- Results count shown: `3 entries match "rufus"`

**Filter chips** (additional filters that can stack with search):
- `Constant only` — show only blue-circle entries
- `Orphaned` — show entries with no incoming or outgoing edges
- `Recursive loops` — highlight only entries involved in circular chains
- `Heavy (>300t)` — highlight token-expensive entries
- `Disabled` — show/highlight disabled entries
- `Has probability <100%` — show probabilistic entries

---

### 4.1.7 — Keyword Activation Simulator

**Location:** Expandable panel under the toolbar (toggle via ⚡ button).

**Purpose:** Simulate what entries would activate if the AI generates or the user types a given message, without actually running ST.

**UI:**
```
┌────────────────────────────────────────────────────────────────┐
│ ⚡ Activation Simulator                              [×] Close │
│ Test message: [Commander Vlatko rode into Neo-Tokyo...      ] │
│                                                               │
│ Scan Depth: [3 msgs ▼]  Recursion: [ON ▼]  Budget: [2000t ▼] │
│                                                    [▶ Simulate] │
├────────────────────────────────────────────────────────────────┤
│ Pass 1 — Direct keyword matches (scan depth: 3 msgs):         │
│   ✅ Commander Vlatko  (key: "vlatko") — ~142t                │
│   ✅ Neo-Tokyo         (key: "neo-tokyo") — ~89t              │
│                                                               │
│ Pass 2 — Recursive activation from Pass 1 content:           │
│   ✅ Iron Circle       (key: "iron circle", in Vlatko entry) │
│   ⛔ House Aldric      (CONSTANT, always loaded) — ~67t       │
│                                                               │
│ Pass 3 — No new activations.                                  │
│                                                               │
│ Total activated: 4 entries  |  ~298t / 2000t budget  ✅       │
│                                                               │
│ ⚠️  Circular chain detected: Vlatko → Iron Circle → Vlatko  │
└────────────────────────────────────────────────────────────────┘
```

**Graph sync:** While the simulator is open, activated entries glow on the graph in simulation-specific colors (Pass 1 = green, Pass 2 = amber, Pass 3+ = orange). Non-activated entries dim.

**Algorithm (pure JS, no AI):**

```javascript
function simulateActivation(testMessage, entries, options) {
  const { scanDepth, recursionEnabled, tokenBudget } = options;
  const activated = new Set();
  const passes = [];
  let usedTokens = 0;

  // Always include CONSTANT entries first
  for (const entry of entries) {
    if (entry.constant && entry.enabled) {
      activated.add(entry.uid);
      usedTokens += entry.tokens;
    }
  }

  // Build scan buffer (last N messages + test message)
  let scanBuffer = testMessage;

  // Pass 1: direct keyword scan
  const pass1 = [];
  for (const entry of entries) {
    if (activated.has(entry.uid)) continue;
    if (!entry.enabled) continue;
    if (entry.delayUntilRecursion) continue; // skip in pass 1
    if (_matchesKeys(scanBuffer, entry)) {
      if (_passesSecondaryFilter(scanBuffer, entry)) {
        if (Math.random() * 100 <= (entry.probability ?? 100)) {
          if (usedTokens + entry.tokens <= tokenBudget) {
            activated.add(entry.uid);
            usedTokens += entry.tokens;
            pass1.push(entry);
          }
        }
      }
    }
  }
  passes.push(pass1);

  if (!recursionEnabled) return { passes, activated, usedTokens };

  // Recursive passes
  let prevActivated = new Set(pass1.map(e => e.uid));
  let recursionStep = 0;

  while (prevActivated.size > 0) {
    recursionStep++;
    const newContent = [...prevActivated].map(uid =>
      entries.find(e => e.uid === uid)?.content || ''
    ).join('\n');

    const passN = [];
    for (const entry of entries) {
      if (activated.has(entry.uid)) continue;
      if (!entry.enabled) continue;
      // Check if any already-activated entry has "preventRecursion"
      if (_anySourcePreventsRecursion(prevActivated, entries, entry)) continue;
      if (_matchesKeys(newContent, entry)) {
        if (usedTokens + entry.tokens <= tokenBudget) {
          activated.add(entry.uid);
          usedTokens += entry.tokens;
          passN.push(entry);
        }
      }
    }

    if (passN.length === 0) break;
    passes.push(passN);
    prevActivated = new Set(passN.map(e => e.uid));
  }

  // Detect circular chains (already computed by detectRecursion())
  return { passes, activated, usedTokens, circularChains: detectCircular(activated, entries) };
}
```

---

### 4.1.8 — Node Interactions

**Click (tap on mobile):** Selects node. Highlights all connected edges and neighbor nodes.

**Double-click (desktop) / Tap again (mobile):** Opens the **inline node editor panel** — a side panel that slides in from the right edge of the graph overlay:

```
┌──────────────────────────────┐
│ ✏️ Edit Entry                │
│ Name: [Iron Circle         ] │
│ Category: [Factions ▼]       │
│ Keys: [iron circle] [faction]│
│ Strategy: ● Keyword          │
│ Position: [After Char ▼]     │
│ Order: [100    ]             │
│ Probability: [100%   ]       │
│ ☐ Constant  ☐ Non-recursable │
│ ☐ Prevent recursion          │
│ ☐ Delay until recursion      │
│ Content:                     │
│ [The Iron Circle is a secret]│
│ [organization of mercenaries]│
│ [who operate in Neo-Tokyo…  ]│
│                              │
│ Tokens: ~89t   [Save] [Del]  │
└──────────────────────────────┘
```

Changes made in this panel are saved immediately to the lorebook via `updateLorebookEntry()`. The graph re-renders after save to reflect any new connections (if keys changed).

**Right-click / Long-press context menu:**
- View entry (opens side panel in read-only mode)
- Edit entry (opens side panel in edit mode)
- Find all connections (zooms to show this node + its neighbors, dims everything else)
- Enable / Disable entry (toggle without opening editor)
- Pin / Unpin node position
- Delete entry (with confirmation)

---

### 4.1.9 — World Mode Dual Lorebook View

When the Studio is in **World Mode** (Priority 4.4), the lore graph can display **two lorebooks simultaneously**:

- World lorebook nodes: larger, with a 🌍 badge
- Character lorebook nodes: standard size, with a 👤 badge
- Edges between the two lorebooks: shown as dashed gold arrows labeled "World link" — these represent world entries whose keywords appear in character entries, indicating the character references world lore

This view makes it immediately obvious which world entries a character "uses" vs. which are orphaned in the world lorebook.

---

### 4.1.10 — Stats Panel

A collapsible stats strip under the toolbar:

```
Entries: 23  |  Edges: 41  |  Orphaned: 3  |  Circular chains: 1
Constant tokens: ~340t  |  Conditional tokens: ~1,240t  |  Est. usage: ~1,108t
Largest entry: "The Iron Circle" (~189t)  |  Most connected: "Neo-Tokyo" (7 edges)
```

---

### 4.1.11 — Export

**Export PNG:** Renders the current canvas view (with all nodes, edges, minimap hidden) to a full-resolution PNG. The graph is rendered to an offscreen canvas at 2x resolution first, then `canvas.toBlob()` → download link.

**Export SVG:** Not supported (canvas-based renderer doesn't have an SVG equivalent). PNG only.

---

### 4.1.12 — New AI Tools for the Lore Graph

#### `ccs_read_lore_graph()`

Returns a JSON summary of the current lorebook's graph topology for AI reasoning:

```javascript
// Returns:
{
  entries: [{ uid, name, category, tokens, constant, enabled, keys, flags }],
  edges: [{ from_uid, to_uid, type: 'direct'|'conditional'|'group' }],
  orphaned: [uid, ...],
  circularChains: [[uid, uid, ...], ...],
  stats: { totalEntries, totalTokens, estimatedUsage, mostConnected }
}
```

Use case: AI can call this before suggesting lore structure improvements — it sees which entries are isolated, which are overconnected, which create loops.

#### `ccs_suggest_lore_connections()`

AI reads the full lorebook content (via `ccs_read_lore_entries`) and the graph topology (via `ccs_read_lore_graph`), then suggests:

1. **New keyword additions:** "The 'Iron Circle' entry should add 'mercenary' as a secondary key, since the 'Combat Mercenaries' entry mentions it but doesn't link back."
2. **Bridge entries:** "There's no entry linking 'Commander Vlatko' to 'Neo-Tokyo' despite both being major nodes — suggest creating an NPC entry for Vlatko's handler in the city."
3. **Loop warnings:** "Entries #4 and #7 form a circular recursion chain. Consider adding 'Prevent further recursion' to #7."
4. **Orphan resolution:** "Entry 'The Old Quarter' has no keys in any other entry's content — it will never activate via recursion. Add 'old quarter' to the 'Neo-Tokyo' entry."

The AI stages these as **suggestions in the chat**, not as automatic changes.

---

### 4.1.13 — Mobile Compatibility

The full-screen graph overlay uses the same bottom-sheet overlay system as the settings modal (appended to `#ccs_window`, full-viewport).

Mobile-specific behaviors:
- **Pinch to zoom** via `TouchEvent` handling on the canvas
- **Single-finger pan** on empty canvas space
- **Tap to select** node
- **Long-press** for context menu (300ms delay)
- **Node editor panel** slides up from the bottom instead of from the right (bottom-sheet style)
- **Simulator panel** and **Search bar** are collapsible via a bottom drawer
- Grid snap and lasso selection are **disabled on mobile** (too hard to use with touch)
- Minimap is **hidden on mobile** (too small to be useful)

---

### 4.1.14 — Files

| File | Action | Description |
|------|--------|-------------|
| `ui/lore-graph-v2.js` | **[NEW]** | Full canvas-based renderer + physics + interaction |
| `ui/lore-graph.js` | **[KEEP]** | Old SVG renderer, kept as lightweight fallback, but the graph button in the Lore tab now calls lore-graph-v2 |
| `ui/app.js` | **[MODIFY]** | Update graph button to open the full-screen overlay, import new tools |
| `core/tools.js` | **[MODIFY]** | Add `ccs_read_lore_graph`, `ccs_suggest_lore_connections` |
| `prompts/phase-instructions.js` | **[MODIFY]** | Add tool definitions for new AI tools |
| `style.css` | **[MODIFY]** | Full-screen graph overlay styles, node editor panel, simulator panel |

---

## 🖼️ 4.2 — Avatar Generation Hook (v5.0)

### Overview

A two-step flow where the AI writes an optimized image generation prompt based on the character's Description and visual traits, the user reviews and optionally edits it, then clicks Generate to submit it to SillyTavern's existing image generation pipeline.

### 4.2.1 — Flow

```
User: "Generate an avatar for her"
  ↓
AI calls: ccs_generate_avatar_prompt({ style: 'cinematic' })
  ↓
AI returns a staged prompt in the chat:
  ┌────────────────────────────────────────────────────────┐
  │ 🖼️ Avatar Prompt Ready                                 │
  │                                                        │
  │ Style: Cinematic portrait                              │
  │                                                        │
  │ Positive: "young woman, silver hair, pale skin, violet │
  │ eyes, mysterious expression, elegant court dress,      │
  │ dramatic lighting, dark fantasy, oil painting style,  │
  │ highly detailed, 8k"                                   │
  │                                                        │
  │ Negative: "deformed, blurry, watermark, lowres,        │
  │ extra limbs, bad anatomy"                              │
  │                                                        │
  │ [✏️ Edit Prompt]  [▶ Generate Avatar]  [✕ Dismiss]   │
  └────────────────────────────────────────────────────────┘
  ↓ (user clicks Generate)
  ↓
CCS calls ST's image generation API
  ↓
ST generates the image, CCS sets it as the character's avatar
  ↓
Toast: "Avatar generated and applied! ✅"
```

### 4.2.2 — Tool: `ccs_generate_avatar_prompt`

```javascript
// Parameters:
{
  style: 'cinematic' | 'anime' | 'painterly' | 'realistic',  // optional, default 'cinematic'
  emphasis: 'face' | 'full_body' | 'bust',                   // optional, default 'bust'
  extra_tags: ['dark fantasy', 'dramatic lighting']          // optional user hints
}

// AI constructs this from:
// 1. session.cardFields.description (visual traits mentioned)
// 2. session.conceptBrief (appearance section if present)
// 3. session.personalityMatrix (extreme values suggest visual traits)
// 4. The style parameter determines aesthetic framing
```

### 4.2.3 — ST Integration Research Needed

Before implementation, audit ST's image generation API surface:
- `SillyTavernDocs/extensions/` — check for image generation hooks
- Look for `ctx.generateQuietPrompt` pattern used by other extensions
- Check ST-Copilot reference code for how it calls generation pipelines
- Determine if SD/DALL-E/ComfyUI all share a unified API or need separate branches

### 4.2.4 — Edit Prompt UI

The "Edit Prompt" button opens an inline editor in the chat message:
```
Positive prompt: [editable textarea                          ]
Negative prompt: [editable textarea                          ]
Style: [Cinematic ▼]   Emphasis: [Bust ▼]
[▶ Generate with edits]
```

### 4.2.5 — Error Handling

- If no image generation is configured in ST → show actionable error: "No image generator configured. Go to ST's Extensions → Image Generation to set one up."
- If generation fails → show error toast with ST's error message
- If avatar is set successfully → re-render the character name area in the topbar to show the new avatar thumbnail

### 4.2.6 — Files

| File | Action | Description |
|------|--------|-------------|
| `core/tools.js` | **[MODIFY]** | Add `toolGenerateAvatarPrompt`, `toolSubmitAvatarGeneration` |
| `ui/chat.js` | **[MODIFY]** | Render avatar prompt staged message with Edit/Generate/Dismiss buttons |
| `prompts/phase-instructions.js` | **[MODIFY]** | Add `ccs_generate_avatar_prompt` tool definition |
| `style.css` | **[MODIFY]** | Avatar prompt card styles |

---

## 📖 4.3 — Chat Log Analysis Tool (v5.0)

### Overview

The user selects how many recent messages to analyze (via a slider). The AI reads that chat history alongside the current card content, identifies character drift and evolution, and stages targeted field updates as drafts for the user to approve or reject.

### 4.3.1 — Flow

```
User: "Analyze how she's evolved in our roleplay"
  ↓
UI shows a slider: "Analyze last N messages" [====●====] 50
And a Generate button
  ↓
CCS reads ctx.chat (last N messages)
CCS reads all card fields
  ↓
AI receives:
  - Current card fields (description, personality, scenario, etc.)
  - Last N messages (formatted as [USER] / [CHAR] pairs)
  - Task: identify drift, evolution, inconsistencies, propose updates
  ↓
AI calls ccs_write_field() for each suggested update
  (updates are staged as drafts — NOT applied automatically)
  ↓
AI also writes a chat analysis report in its message:
  ┌────────────────────────────────────────────────────────┐
  │ 📖 Chat Log Analysis — 50 messages                     │
  │                                                        │
  │ Character Evolution:                                   │
  │ • She started formal, grew more playful by message 30  │
  │ • Developed a catchphrase "as you wish, my liege"     │
  │ • Her fear of water was never referenced after msg 12  │
  │                                                        │
  │ Proposed Card Updates: (3 drafts staged for approval)  │
  │ • Personality: Added "playful undercurrent"            │
  │ • First Message: Updated to reflect evolved tone       │
  │ • Mes Examples: Added new catchphrase example          │
  │                                                        │
  │ Inconsistencies Found:                                 │
  │ • Card says "hates crowds" but actively sought them    │
  │   in messages 15, 22, 31                               │
  └────────────────────────────────────────────────────────┘
```

### 4.3.2 — Message Range Slider

The slider appears when the user says something like "analyze my chat" — a quick-action chip that shows the slider before submitting:

```
┌────────────────────────────────────────┐
│ 📖 Analyze Chat Log                    │
│ Messages to analyze:                   │
│ [10 ●━━━━━━━━━━━━━━━━━━━━━] 200        │
│              50 messages               │
│                                        │
│ [▶ Start Analysis]  [✕ Cancel]         │
└────────────────────────────────────────┘
```

### 4.3.3 — Token Budget Awareness

Reading 200 messages could be 10k+ tokens. Before sending:
1. Count tokens in the message range
2. If > 4000t, show a warning: "200 messages = ~6,200 tokens. Consider reducing to ~50 messages (~1,500t) for better results."
3. Older messages are summarized first (use session memory summaries if available)

### 4.3.4 — Tool: `ccs_analyze_chat_logs`

This is handled via the normal `sendMessage()` flow — there's no separate JS tool call. The AI receives the message history as part of the user's message context. The AI then calls existing `ccs_write_field()` to stage the proposed updates.

A helper function is added to prepare the message context:
```javascript
function _buildChatLogContext(messageCount) {
  const messages = getCtx()?.chat?.slice(-messageCount) || [];
  return messages.map(m =>
    `[${m.is_user ? 'USER' : 'CHAR'}] ${m.mes}`
  ).join('\n\n');
}
```

### 4.3.5 — Files

| File | Action | Description |
|------|--------|-------------|
| `ui/app.js` | **[MODIFY]** | Chat log slider UI, `_buildChatLogContext()` helper |
| `ui/chat.js` | **[MODIFY]** | Render analysis result message with evolution summary |
| `style.css` | **[MODIFY]** | Analysis slider UI, analysis result card styles |

---

## 🏗️ 4.4 — World / Campaign Mode (v5.0)

### Overview

A fully separate **"World" mode** in the Studio mode selector (alongside Studio, Janitor, HTML, Image Prompt). This mode is for building **shared world lorebooks** — worlds that multiple characters can inhabit.

Each character's Studio session can link to a world lorebook. A **Campaign View** shows all characters that belong to a world as a visual card wall, with cross-world intelligence indicators.

---

### 4.4.1 — Storage Architecture

**World sessions:** Stored in localforage (same as character sessions) under a special key pattern:
```javascript
`world_session_${worldName}` // e.g., "world_session_World of Aethoria"
```

A world session has its own schema (see 4.4.6).

**Global registry:** Stored in `extensionSettings.CharCardStudio.worldRegistry`:
```javascript
{
  worlds: {
    "World of Aethoria": {
      lorebookName: "World of Aethoria",
      characters: ["avatar_commander_vlatko", "avatar_miroslava"],
      createdAt: 1748303245,
      lastModified: 1748303245
    }
  }
}
```

**Character → World link:** Each character session gets a new field:
```javascript
session.linkedWorld = "World of Aethoria" | null
```

This allows the Campaign View to query all sessions and group them by world.

**Linking flow:** A character can be linked to a world:
1. Inside their Studio session → new "Link to World" dropdown in the Lore tab header
2. Inside the World mode Campaign View → drag-and-drop or "Link Character" button

---

### 4.4.2 — World Mode: UI Entry

A new option in the mode selector dropdown:
```html
<option value="world">🌍 World Builder</option>
```

When this mode is selected:
- The right panel shows **World** tabs instead of Concept/Card/Lore:
  - **⚡ Ideation** — world concept brief
  - **🗺️ World Lore** — the world's primary lorebook (same Lore tab UI)
  - **👥 Campaign** — all characters linked to this world

---

### 4.4.3 — World Mode: Phase Flow

**Phase 1 — World Ideation:**
- AI asks: What kind of world? Genre, conflict, factions, tech level, tone?
- AI calls `ccs_write_brief()` to produce a **World Brief** (same concept brief system, different template)
- World Brief template:
  ```markdown
  ## World Brief: [Working Title]
  **Genre:** [Dark Fantasy / Sci-Fi / Historical / etc.]
  **Scale:** [City / Nation / Planet / Multiverse]
  **Central Conflict:** [What's the main tension driving events?]
  **Factions:** [List with 1-line descriptions]
  **Tone:** [Grim & gritty / Epic / Cozy / etc.]
  **Key Themes:** [Power, betrayal, survival, etc.]
  **What makes it unique:** [1-2 sentences]
  ### Open Questions
  [Things to resolve before building entries]
  ```

**Phase 2 — World Build:**
- AI creates lorebook entries for the world (geography, factions, species, rules, history)
- Uses ALL existing lore tools: `ccs_create_lore_entry`, `ccs_update_lore_entry`, etc.
- The AI is instructed to categorize every entry carefully (they will be shared across characters)
- Constant entries are used for world rules that always need to be in context
- New AI tool: `ccs_find_lore_gaps()` (see 4.4.5)

**Phase 3 — World Review:**
- Run coherence audit on the world lorebook (same `runCoherenceAudit()` system)
- Open lore graph to check for orphaned entries and missing connections
- New AI tool: `ccs_generate_character_from_lore()` — propose a character concept that fits the world

---

### 4.4.4 — Campaign View

**Location:** The "Campaign" tab inside World Mode.

**Layout:** A visual **card wall** — responsive grid of character cards:

```
┌──────────────────────────────────────────────────────┐
│ 🌍 World of Aethoria — Campaign View                 │
│ 3 characters  |  World lore: 24 entries, ~1,240t     │
│ [+ Link Character]  [📊 World Analysis]              │
├──────────────────────────────────────────────────────┤
│ ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│ │ [avatar]    │  │ [avatar]    │  │ [avatar]    │  │
│ │ Commander   │  │ Miroslava   │  │ [+ Add New  │  │
│ │ Vlatko      │  │ Alchemist   │  │  Character] │  │
│ │ ──────────  │  │ ──────────  │  │             │  │
│ │ 8 lore      │  │ 5 lore      │  │             │  │
│ │ entries     │  │ entries     │  │             │  │
│ │ ⚠️ 2 heavy  │  │ ✅ Clean    │  │             │  │
│ │             │  │             │  │             │  │
│ │ [Open]      │  │ [Open]      │  │             │  │
│ └─────────────┘  └─────────────┘  └─────────────┘  │
└──────────────────────────────────────────────────────┘
```

**Opening a character from Campaign View:** Clicking "Open" switches the Studio to Studio mode and loads that character's session. The world context remains injected.

**Linking a character:** Clicking "+ Link Character" shows a list of all known CCS sessions (queried from localforage). User selects one → that character's `session.linkedWorld` is set.

**Creating a new character from the world:** Clicking "+ Add New Character" switches to Studio mode with a world-aware start prompt: "Create a new character for the world [World of Aethoria]. The AI knows the world lorebook and will suggest coherent characters."

---

### 4.4.5 — New AI Tools for World Mode

#### `ccs_find_lore_gaps()`

```javascript
// Parameters: none (reads current lorebook automatically)
// AI analyzes existing entries and identifies structural gaps:
// - "Faction 'Iron Circle' is mentioned but has no leader NPC"
// - "Geography entries mention 'the north' but no entry defines it"
// - "Magic system entry has no rules entry limiting its use"
// - "3 character NPCs reference 'The Old War' — no history entry for it"
```

#### `ccs_generate_character_from_lore()`

```javascript
// Parameters:
{
  role: 'protagonist' | 'antagonist' | 'side_character' | 'npc',  // optional
  faction: 'Iron Circle',                                           // optional affiliation
  card_type: 'A' | 'B' | 'C'                                      // optional type
}
// AI reads the world lorebook via ccs_read_lore_entries
// Proposes a character concept that fits:
// - The world's factions
// - The world's geography
// - The world's tone and rules
// AI writes a World-aware Concept Brief and proposes transitioning to Studio mode
```

#### `ccs_analyze_world_coherence()`

```javascript
// Checks if the current character session is consistent with its linked world lorebook:
// - Does the character reference factions that exist in the world?
// - Does the character's description use world-specific terms correctly?
// - Are there any contradictions between character lore and world rules?
// Returns a coherence report (same format as runCoherenceAudit)
```

#### `ccs_read_lore_graph()` (also used in 4.1)

Returns graph topology including multi-lorebook data when in World Mode.

#### `ccs_suggest_lore_connections()` (also used in 4.1)

Can operate across both the character lorebook and the linked world lorebook simultaneously in World Mode.

---

### 4.4.6 — World Session Schema

```javascript
{
  // Identity
  _type: 'world',                    // Distinguishes from character sessions
  worldName: 'World of Aethoria',    // The world's name
  lorebookName: 'World of Aethoria', // The bound primary lorebook

  // Brief / Ideation
  conceptBrief: null,                // World brief (same field, world template)
  briefAnnotation: '',               // User annotations

  // State
  phase: 'ideate' | 'build' | 'review',
  messages: [],                      // Chat history for this world session
  createdAt: timestamp,
  lastModified: timestamp,

  // No card fields — world sessions don't have character card data
  // No pillarStates — world doesn't use the pillar system
  // No personalityMatrix — N/A for worlds
}
```

---

### 4.4.7 — Cross-World Intelligence (Campaign Analysis)

Activated via the "📊 World Analysis" button in Campaign View. Runs a pure-JS scan, no AI call needed:

**Analysis 1: Token weight warning**
- Identify world lorebook entries with > 200 tokens
- These are "heavy" — they inflate context for every character that uses the world
- Report: "3 entries exceed 200t: [The Sundering War, Iron Circle History, Magic System]. Consider splitting these."

**Analysis 2: NPC name conflicts**
- Scan all linked character lorebooks for entries that share the same name
- Check if their content contradicts each other
- Report: "Character A and Character B both have an NPC entry named 'General Aldric' — they describe him differently."

---

### 4.4.8 — Session Manager Extensions Needed

```javascript
// New functions in core/session.js:

// Load a world session
async function loadWorldSession(worldName) { ... }

// Save a world session
async function saveWorldSession(worldSession) { ... }

// Get all character sessions linked to a world
async function getLinkedCharacters(worldName) { ... }

// Link a character to a world
async function linkCharacterToWorld(characterAvatar, worldName) { ... }

// Get global world registry
function getWorldRegistry() { ... }

// Update global world registry
function updateWorldRegistry(worldName, data) { ... }
```

---

### 4.4.9 — Files

| File | Action | Description |
|------|--------|-------------|
| `ui/app.js` | **[MODIFY]** | World mode tab UI, Campaign View, phase flow, mode selector option |
| `core/session.js` | **[MODIFY]** | World session schema, `loadWorldSession`, `saveWorldSession`, `getLinkedCharacters`, `linkCharacterToWorld`, world registry functions |
| `core/tools.js` | **[MODIFY]** | `ccs_find_lore_gaps`, `ccs_generate_character_from_lore`, `ccs_analyze_world_coherence` |
| `prompts/phase-instructions.js` | **[MODIFY]** | World mode phase prompts (world ideation, world build, world review), new tool definitions |
| `style.css` | **[MODIFY]** | Campaign View styles, world mode tab styles, character card wall grid |
| `templates/window.html` | **[MODIFY]** | Add World mode option to mode selector |

---

## 📊 Priority 4 Implementation Summary

| # | Feature | Effort | Impact | Notes |
|---|---------|--------|--------|-------|
| 4.1 | Advanced Lore Graph (canvas rebuild) | Very High | 🔥🔥🔥🔥 | New file `lore-graph-v2.js`, full canvas renderer |
| 4.1a | — Physics simulation + layout | High | | Core of the rebuild |
| 4.1b | — Keyword simulator (pure JS) | Medium | | No AI needed, pure activation algorithm |
| 4.1c | — Node editor panel | Medium | | Inline lorebook editing from graph |
| 4.1d | — Mobile compatibility | Medium | | Touch events, bottom-sheet panels |
| 4.1e | — AI graph tools | Low | | `ccs_read_lore_graph`, `ccs_suggest_lore_connections` |
| 4.2 | Avatar Generation Hook | Medium | 🔥🔥🔥 | Needs ST API research first |
| 4.3 | Chat Log Analysis | Medium | 🔥🔥🔥 | Slider UI + context builder |
| 4.4 | World / Campaign Mode | Very High | 🔥🔥🔥🔥🔥 | Full new mode, session schema changes |
| 4.4a | — World mode session/storage | High | | Most architectural work |
| 4.4b | — World phase flow + prompts | Medium | | World-specific AI prompt layers |
| 4.4c | — Campaign View card wall | Medium | | Visual UI for linked characters |
| 4.4d | — Cross-world AI tools | Medium | | `ccs_find_lore_gaps`, `ccs_generate_character_from_lore`, `ccs_analyze_world_coherence` |
| 4.4e | — Dual-lorebook graph view | Medium | | Extension of 4.1 |

---

## 🗒️ Open Design Questions (Resolve Before Implementing)

1. **ST Avatar API surface:** Before implementing 4.2, audit exactly what ST exposes for image generation (which extensions, what function signatures, whether SD/DALL-E/ComfyUI are unified). This determines if 4.2 is a 1-day task or a 1-week task.

Answer - Search in docs if not, then leave it be

2. **Campaign View character loading:** When the user opens a character from Campaign View, the Studio needs to load that character's session AND switch to Studio mode. This involves loading a different character in ST (`ctx.selectCharacter()`?). Need to verify the ST API for programmatic character switching.📿

3. **World lorebook binding in ST:** When building the world, should CCS automatically bind the world lorebook to each character via ST's character → lorebook binding? Or leave that to the user? (ST supports this via the API: `ctx.getCharacterCardFields()` + `ctx.saveCharacterCardFields()`.) The automatic approach is more seamless but could surprise the user.

Answer - automatically bind

4. **Lore graph performance ceiling:** What's the maximum number of nodes before we switch from physics to static layout automatically? Proposed: 80+ nodes → static cluster layout (physics optional via toggle). Needs testing.

Answer - 60 nodes (or an option to disable unnecessary stuff to avoid lag)

5. **Multi-lorebook graph layout:** When showing both world and character lorebooks simultaneously in World Mode graph view, how do we visually separate them? Proposed: world entries in the center/top half of the canvas, character entries in the bottom half, with gold cross-lorebook edges. Or should they be intermixed and distinguished only by the badge?

Asnwer - yeah do it like that

6. **Campaign View vs character selection in ST:** CCS shows the Campaign View with character avatars. Clicking a character needs to actually load that character in ST (not just show their CCS session). Do we call `ctx.selectCharacter(avatar_filename)`? If the character is in a different ST folder, does this work? Need to verify.

Answer - verify and do it

---

## 🚫 Not in v5.0 (Future Consideration)

- **Vector embedding integration** for lore graph (similarity-based connections, not keyword-based)
- **STscript Automation ID visualization** in the lore graph (entries with automation IDs shown with a ⚡ badge)
- **Timed effects visualization** in the lore simulator (sticky/cooldown/delay timed effects)
- **Chat background generation** (separate from avatar generation)

---