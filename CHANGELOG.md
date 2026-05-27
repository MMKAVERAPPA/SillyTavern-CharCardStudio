# Changelog

All notable changes to CharCardStudio are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [4.2.1] — 2026-05-27

### Fixed
- **Token Budget Visualizer thresholds** — Color transitions now correctly reflect the Plan spec: green → amber at 2,000t, amber → red at 3,000t (was incorrectly set to 1,500/2,500). Bar cap extended to 4,000t to match actual card sizes.
- **Token Budget Visualizer — Lorebook segment type bug** — `getLorebookTokenBudget()` returns `{estimatedUsage, constantTokens, ...}` but the previous fix was treating the returned object as a raw number. Now correctly extracts `.estimatedUsage` before use.
- **Lorebook context injection force-refresh bug** — `buildSystemPrompt` was calling `getLorebookEntries({ include_content: false })` (an options object), but the function signature is `getLorebookEntries(forceRefresh?: boolean)`. The truthy object caused the cache to bypass on every single AI turn. Fixed to `getLorebookEntries(false)`.
- **Settings modal off-screen on mobile** — The settings modal was injected into `document.body`, where SillyTavern's body transforms can cause `position:fixed` elements to clip. Now injected into `#ccs_window` and uses `position:absolute` on mobile, presenting as a bottom-sheet that slides up from below the viewport edge.
- **Prompt Inspector modal off-screen on mobile** — Same fix as settings modal: injected into `#ccs_window`, bottom-sheet layout on mobile.
- **Coherence Audit modal off-screen on mobile** — Same fix applied.
- **Inline Ask AI toolbar positioning on mobile** — Toolbar was using JS pixel-positioning relative to text selection. On mobile it now CSS-docks above the bottom tab bar instead (no JS positioning conflicts). Custom instruction popup also docks above the toolbar on mobile.

### Added
- **Inline Context Tooltips** — Card field labels in the Card Tab now show a ❓ icon that reveals a best-practice tooltip on hover. All 9 card fields covered.

---

## [4.2.0] — 2026-05-22

Major update focused on prompt enrichment, UI/UX polish, and advanced agentic lore management (Priority 1 & 2 Roadmap).

### Added
- **Feature 11: Concept Brief System** — New living ideation document (`session.conceptBrief`) visible in the Concept Tab. Includes a user annotation textarea that persists to the session. The brief and annotations are automatically injected into the system prompt to anchor the AI's creative direction. Tools: `ccs_write_brief`, `ccs_read_brief`.
- **Feature 12: Token Optimizer** — New `ccs_optimize_tokens` tool allows the AI to rewrite card fields specifically for token compression. Optimized content is staged as a draft and displays the estimated token savings.
- **Feature 13: Semantic Search** — Pure-JS utility `ccs_semantic_search` allowing the AI to scan all card fields and lorebook entries for concepts and contradictions without burning an API call.
- **Dynamic Theme Sync** — Live CSS variable mapping from SillyTavern's native `--SmartTheme*` variables to CharCardStudio. Ensures the extension looks perfectly native to whatever ST theme the user is running. Includes a fallback toggle in Settings.
- **Lore Category Folders** — Lorebook entries are now rendered in collapsible `<details>` accordions grouped by their assigned category (Geography, Factions, NPCs, etc.), complete with category icons, token budgets, and entry counts.
- **Lorebook Context Injection** — The `buildSystemPrompt` now automatically injects a compact summary of the selected lorebook directly into the system prompt. If ≤ 20 entries, it lists them by category and key; if > 20, it provides a statistical breakdown.

### Changed
- **System Prompt Enhancements** — Re-wrote `buildSystemPrompt` and `identity.js` to strictly adhere to the v6 Golden Preset standards. Explicitly defines card types A-E, differentiates between SillyTavern and JanitorAI logic, and clarifies that Prose is the default over PList.
- **AI Scorecard Updates** — Scorecard category bars are now clickable "Fix" buttons that automatically send a targeted repair prompt to the AI. Added a "Redo" button to easily regenerate the review.
- **Token Budget Visualizer** — Real-time, color-coded token usage bar in the Card Tab header, tracking constant vs conditional tokens with a warning threshold at 3000 tokens.
- **Session State** — Bumped schema to `v5` to support `conceptBrief`, `briefAnnotation`, and `personalityMatrix`. Automated migration on load.

---

## [4.1.0] — 2026-05-21

### Added
- **Feature 3: External Lorebook Integration** — Migrated from embedded `character_book` model to SillyTavern's native `/api/worldinfo/` REST endpoints. Users can now select, create, and manage external lorebooks from a dedicated picker inside the Lore tab. Selection persists per-character in `session.lorebookName`.
- **Feature 5: Custom API Connection Routing** — New `core/api-router.js` module routes background checks (conflict detection, token analysis) to a configurable alternate API profile via `ConnectionManagerRequestService`. Falls back gracefully to the default connection. Configurable in Settings → General.
- **Feature 10: Scratchpad** — Persistent, collapsible freeform notes textarea at the bottom of the Concept tab. Auto-saved with 1-second debounce per-character. Never sent to the AI.
- **Feature 6: Prompt Inspector** — Read-only modal (🔍 button in topbar) showing the exact system prompt and message history the AI would receive, with tab switching, per-section token estimates, and clipboard copy.
- **Feature 9: Coherence Audit** — Static analysis engine (`core/coherence-audit.js`) that checks for missing required fields, field length anomalies, lorebook keyword collisions, keyless entries, constant-entry token bloat, and cross-field consistency issues. Results displayed in a scored modal (0–100) with one-click "Ask AI to Fix" escalation.
- **Feature 4: Ideation Phase Redesign (Quickstart)** — When in the Ideate phase with no pillars, the Concept tab now shows Concept Quickstart chip buttons (Brainstorm, Villain, Companion, Mentor, AI/Android, What If?) that inject pre-crafted prompts into the chat.

### Fixed
- **Lore phase prompt** now warns the AI that an external lorebook must be selected before `ccs_create_lore_entry` can succeed.
- **Session defaults** updated: `scratchpad: ''` and `lorebookName: null` are now explicit session fields.
- **Missing CSS** for `.ccs-setting-hint` — the utility API hint text now renders correctly.

### Changed
- `core/background.js` now imports `generateTextWithProfile` instead of `generateText` — all background AI checks route through the API router.
- Session schema remains v3 (scratchpad initialises as empty string, no migration needed).

---

## [4.0.0] — 2026-05-20

Complete rewrite from v3.x. Transitioned to an agentic architecture with a tool-calling AI assistant.

### Added
- **Phase A: Shell & Session**
  - Extension loads as a popup overlay in SillyTavern
  - Chat panel with message rendering, input, send, delete, regenerate
  - Session persistence via LocalForage (IndexedDB) with auto-save (3s debounce)
  - Session schema migration (v0 → v1 → v2) for backward compatibility
  - Multi-tab detection and locking via localStorage heartbeat
  - Read-only banner when another tab is editing the same character
  - Mobile detection with responsive layout
  - Toast notification system
  - Cancel button wired to AbortController
- **Phase B: Agent Loop & LLM Integration**
  - Agentic loop with iterative tool calling (max 8 iterations)
  - System prompt builder with layered architecture (identity → phase → format → card context → tool defs)
  - Silent generation wrapper with abort-aware job tracking
  - XML-like `<tool_call>` JSON-block parsing with fallback
  - Reasoning block extraction and collapsible display
  - Tool result history trimming to prevent token bloat
  - Echo stub for testing without LLM
- **Phase C: Studio Mode**
  - 10 structured tools: `ccs_write_field`, `ccs_read_field`, `ccs_update_pillar`, `ccs_create_lore_entry`, `ccs_read_lore_entries`, `ccs_update_lore_entry`, `ccs_delete_lore_entry`, `ccs_resolve_conflict`, `ccs_update_memory`, `ccs_audit_card`
  - Staged draft system with Apply/Edit/Regen/Skip actions
  - Draft version navigation (prev/next between regenerations)
  - Character Pillars panel (Concept tab) — Core, Audit, Recommendation categories
  - Card Fields panel (Card tab) — live field display with token counts and star ratings
  - Lorebook panel (Lore tab) — entry list with pending drafts and existing entries
  - Phase-based workflow: Ideate → Build → Lore
  - Card format support: Prose, PList + Ali:Chat
  - Background check queue (conflict detection, token analysis)
  - Session memory system (global + per-character rules)
  - Progress bar tracking pillar + field + lore completion
- **Phase D: Additional Modes**
  - Mode selector dropdown in top bar (Studio, JanitorAI, HTML Intro, Image Prompt, FictionLab)
  - Per-mode chat history isolation via `swapModeHistory()`
  - JanitorAI conversion mode — reads card fields, generates conversion
  - HTML Intro mode — 3 sub-modes (simple, intermediate, advanced), sandboxed iframe preview
  - Image Prompt mode — model-specific templates (SD, Flux, MJ, DALL-E, NovelAI)
  - FictionLab mode — blocked placeholder with "coming soon" banner
  - Programmatic tool write-block in non-Studio modes (only `ccs_read_field` allowed)
  - Mode-specific welcome screens and suggestion chips
  - Right panel adaptation per mode (read-only badge, hidden elements)
  - Default welcome screen recovery when switching back to Studio
- **Phase E: Polish & Documentation**
  - Settings modal with 4 tabs (General, Session, Data, About)
  - Session export as JSON file
  - Session import from JSON file
  - Clear session / clear all sessions with confirmation
  - Storage usage estimation
  - Card format preference setting
  - Auto-summarize threshold setting
  - README.md with installation, features, usage guide
  - `.pi/` folder cleanup — removed 14 obsolete planning docs

---

## [3.3.0] - 2026-05-13

### Added
- **Lorebook target selection** — Embedded mode removed; user must always choose a named external lorebook. On entering the Lore phase with no book selected, a picker appears immediately with a **"Create New Lorebook"** option. Selection persists across sessions
- **4 Themes** — Dark (default), Midnight, Sepia, Light; selector in Settings → Appearance, applied live on save
- **Profile dropdown** — API profile setting is now a `<select>` populated asynchronously from `apiManager.getProfiles()` instead of a manual text field
- **Auto-complete chip bar** — Phase-aware suggestion chips below the chat input. Static, no AI cost; chips inject text into the input for quick dispatch
- **Extended keyboard shortcuts** — `Ctrl+S` (export log), `Ctrl+/` (focus input), `Ctrl+Z` (undo), `Ctrl+Shift+Z` (redo). Existing shortcuts updated in help panel
- **Undo/Redo** — In-memory per-session stack (up to 30 actions). Pushes on every quick-edit or field accept; `Ctrl+Z` / `Ctrl+Shift+Z` reverses/reapplies writes to SillyTavern
- **Swipe gestures** — Horizontal swipe on the chat column cycles through phases on mobile; velocity-gated to avoid accidental triggers
- **Haptic feedback** — `navigator.vibrate()` calls on entry insert, undo/redo, and phase swipe. Off by default; toggle in Settings → Session
- **Session portability** — Export current session as a JSON file; import a previously exported file; available in Settings → Session
- **Card templates** — 4 built-in templates (Fantasy Warrior, Modern Romance, Sci-Fi Commander, Horror Survivor); template picker shown on "New Session"
- **Psychological depth analyzer** — `auditEngine.analyzeCharacterDepth()` runs the AI on 7 psychological axes (Motivation, Fear, Contradiction, Growth Potential, Relatability, Uniqueness, Consistency) and renders a color-coded bar chart in the Card Panel
- **Style consistency check** — `auditEngine.checkStyleConsistency()` audits POV, tense, format, formality, and narrator voice across all fields
- **Cross-reference validation** — `auditEngine.crossReferenceCheck()` extracts all facts and checks for contradictions between fields and lorebook entries
- **`core/haptic.js`** — New module; thin wrapper around `navigator.vibrate()` gated behind the settings flag
- **`templates/`** — New directory with 4 JSON template files

### Changed
- `lorebook-panel.js` — Rewrote to include target banner (green if set, yellow warning if not), search/filter, and per-entry insert/discard buttons; "Choose Lorebook" / "Change" banner buttons now correctly wired to the book-selector flow
- `memory.js` — `lorebookLog.embedded` now defaults to `false`; added `theme`, `hapticFeedback`, `_undoStacks`, `_redoStacks` fields; added `pushUndo/popUndo/pushRedo/popRedo/exportSession/importSession` methods
- `settings-modal.js` — Added Appearance tab; profile input is now an async dropdown; added haptic and session import/export controls; fixed stray `</div>` that hid Appearance and Session tabs
- `popup.js` — Theme applied on open; chip bar updates on every phase change; lorebook render always passes `targetBook`; `onChooseLorebook` callback wired to lorebook phase

### Fixed
- Lorebook entries could be generated but never saved (no lorebook target selected before generation) — now blocked at phase start
- "Choose Lorebook" and "Change" banner buttons had no click handlers — now correctly wired
- Lorebook search bar reset the selected target book banner to "No lorebook selected" on every keystroke — fixed by storing `_targetBook` as instance state
- Settings modal Appearance, Session, and Stats tabs were invisible due to a stray `</div>` closing the modal body prematurely
- `apiManager.getProfiles()` was missing — settings modal profile dropdown would crash silently; method now added with graceful fallback

---

## [3.2.0] - 2026-05-13

### Added
- **Virtual scrolling** in the chat panel — DOM is capped at 50 messages; older messages accessible via a "Load earlier messages" button, preventing lag on long sessions
- **Global error boundary** — unhandled CCS promise rejections now surface as a toast notification instead of silently failing
- **Retry with exponential backoff** — rate-limited API calls (HTTP 429) automatically retry up to 3 times (1s → 2s → 4s delays) before showing an error
- **Input message length limit** — messages over 12,000 characters are blocked with a toast; toggleable in **Settings → Session**
- **`core/barrel exports`** — `core/index.js` now re-exports all core singletons for cleaner imports
- **CONTRIBUTING.md** — contributor guide with dev setup, code style, and PR checklist

### Changed
- `updateCardFields()` in `card-panel.js` now diffs changed fields instead of rebuilding the entire DOM — eliminates scroll-position resets and visual flicker
- `enableInlineAnnotation()` refactored to use `AbortController` — annotation event listener is now guaranteed to be cleaned up even if `destroy()` is never called

### Fixed
- **Pre-existing `ReferenceError`** in `core/api.js` — variable `msg` was referenced before assignment in `classifyApiError()` (CORS/timeout detection branch)
- Duplicate listener registration on studio re-open (annotation handler)

---

## [3.1.1] - 2026-05-13

### Fixed
- **Mobile minimize bar** — redesigned as a compact glassmorphism floating pill instead of a full-width bar; no longer covers ST's character action buttons on mobile
- **Settings modal clipping on mobile** — modal now appends to the studio overlay container rather than `document.body`, preventing stacking context conflicts with ST's CSS transforms
- **Minimize/restore lifecycle** — switched from `display:none` to CSS class toggle (`ccs-minimized`), eliminating the overlay rendering bug on mobile

---

## [3.1.0] - 2026-05-12

### Fixed
- 28 production bugs resolved across mobile UI, data persistence, and API race conditions
- Quick-edit save now correctly writes to the active card (BUG-003)
- `restoreHistory()` now pushes messages into `this.messages` so edit/resend works on restored messages
- Annotation listener properly cleaned up on studio close (memory leak)
- `cancelStreaming()` now removes the streaming element on abort

---

## [3.0.0] - 2026-05-06

### Added
- **Modular Skill Engine** — generation driven by a skill-based prompt router (`core/skill-router.js`)
- **Psychological depth profiling** — Core Motivation, Primary Fear, Hidden Desire, Central Contradiction, The Wound, Stress Behavior, Social Mask extracted during ideation and distributed across all fields
- **Voice calibration** — 3 sample lines generated to confirm character voice before writing begins
- **Chain-of-thought generation** — every field goes through Plan → Draft → Self-Check → Output
- **Smart context sizing** — full content for dependency fields, truncated previews for independent fields
- **Character test drive** — AI simulates character across 4 scenarios and critiques the card
- **Full World Info spec** — lorebook phase teaches the AI all 18+ WI features (Timed Effects, Inclusion Groups, Outlet positions, Regex keys, etc.)
- **Card type detection** — Single character, Multi-character, or Scenario/World card, each with specialized generation rules
- **Format flexibility** — Prose (default) or PList+Ali:Chat, switchable mid-session
- **Lorebook phase** — full entry generation and management within the studio
- **Parallel API calls** — variations and batch operations can fire simultaneously
- **Card audit engine** — automated quality check across all card fields
- **Session compression** — long conversations auto-compress older messages to preserve context
- **Platform targeting** — output tuned for Chub, FictionLab, JanitorAI, or personal use

### Changed
- Complete rewrite from v2.x monolithic architecture to modular `core/` + `ui/` + `phases/` structure
- API layer split into primary (card writing) + utility (background checks) tiers
- Settings system migrated to ST's `extensionSettings` for persistence

---

## [2.6.0] - 2026

### Added
- Chat search (`Ctrl+F`) with instant message filtering
- Raw Context Inspector — view the exact payload sent to the LLM
- Ghost Mode (`Alt+Shift+G`) — semi-transparent click-through overlay
- Session Notes — persistent scratchpad in the Idea tab
- Usage Statistics — tracks messages, tokens, field generations, and variations

---

## [2.5.0] - 2026

### Added
- Glassmorphism UI overhaul — frosted-glass panels, backdrop blur, gradient accents
- Welcome Screen — three quick-start cards on fresh sessions
- Progress Ring — SVG circular indicator showing field completion and token count
- Quick Edit — click ✏️ on any field to edit inline
- Extended keyboard shortcuts (`Ctrl+1/2/3`, `Ctrl+G`)
- Toast notification system — stacking, auto-dismiss
- Mobile improvements — collapsible drawer, responsive layouts

---

## [2.0.1] - 2026

### Fixed
- API error classification (`CCSApiError`) for proper rate-limit, balance, and auth handling
- Automatic generation stop on critical errors (balance, auth)
- Parallel API toggle to work around rate limits
- Graceful streaming cleanup on abort

---

## [2.0.0] - 2026

### Added
- Full-screen studio overlay
- Two-tier API system (primary + utility)
- Guided ideation with structural pillars
- Field variations (3 parallel options)
- Lorebook builder (basic entry generation)
- Coherence audit
- Snippet library
- Platform-aware mode (Chub / FictionLab / JanitorAI / Personal)

---

## [1.0.0] - Initial Release

Basic character card generation assistant — single-file implementation, no session state, simple prompt-to-field generation.
