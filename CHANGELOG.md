# Changelog

All notable changes to CharCardStudio are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
Versioning follows [Semantic Versioning](https://semver.org/).

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
  *(see `.pi/docs/` for the full bug report)*
- Quick-edit save now correctly writes to the active card (BUG-003)
- `restoreHistory()` now pushes messages into `this.messages` so edit/resend works on restored messages
- Annotation listener properly cleaned up on studio close (memory leak)
- `cancelStreaming()` now removes the streaming element on abort

---

## [3.0.0] - 2026-05-06

### Added
- **Modular Skill Engine** — generation driven by a skill-based prompt router (`core/skill-router.js`)
- **Psychological depth profiling** — core motivation, primary fear, hidden desire, central contradiction in ideation phase
- **Voice calibration** — samples-based tone locking for consistent character voice
- **Lorebook phase** — full lorebook entry generation and management within the studio
- **Parallel API calls** — variations and batch operations can fire simultaneously
- **Card audit engine** — automated quality check across all card fields
- **Session compression** — long conversations auto-compress older messages to preserve context
- **Platform targeting** — output tuned for Chub, FictionLab, JanitorAI, or personal use

### Changed
- Complete rewrite from v2.x monolithic architecture to modular `core/` + `ui/` + `phases/` structure
- API layer split into primary (card writing) + utility (background checks) tiers
- Settings system migrated to ST's `extensionSettings` for persistence

---

## [2.x] - Legacy

v2.x was a monolithic single-file implementation. No changelog was maintained.
