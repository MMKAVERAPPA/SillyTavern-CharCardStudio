# Contributing to CharCardStudio

Thank you for your interest in contributing! This guide covers everything you need to get started.

---

## Development Setup

CharCardStudio is a plain SillyTavern extension — **no build step is required**.

1. **Clone the repo** into your SillyTavern extensions folder:
   ```bash
   cd SillyTavern/public/scripts/extensions/third-party
   git clone https://github.com/MMKAVERAPPA/SillyTavern-CharCardStudio CharCardStudio
   ```
2. **Start SillyTavern** as normal.
3. Go to **Extensions → Manage Extensions** and enable *Character Card Studio*.
4. Edit any `.js` or `.css` file and **reload the ST page** (F5) to see changes — no bundler needed.

---

## Project Structure

```
CharCardStudio/
├── index.js              Entry point — registers menus, slash commands, ST events
├── style.css             All UI styles (scoped to .ccs-* classes)
├── settings.html         ST settings panel HTML snippet
├── manifest.json         Extension metadata
├── core/                 Business logic (no DOM dependencies)
│   ├── api.js            Two-tier API manager (primary + utility)
│   ├── card.js           Card field read/write, token counting
│   ├── memory.js         Session state, settings persistence
│   ├── parser.js         Phase detection, response parsing
│   └── ...
├── ui/                   UI components (DOM-dependent)
│   ├── popup.js          Main studio shell, phase routing
│   ├── chat-panel.js     Message rendering, virtual scrolling, streaming
│   ├── card-panel.js     Card status board, field rows
│   └── ...
└── phases/               Phase controllers (orchestrate core + UI)
    ├── ideation.js
    ├── generation.js
    └── lorebook-phase.js
```

---

## Code Style

- **ES6+** syntax — use `const`/`let`, arrow functions, template literals, `async/await`
- **4-space indentation**, max ~120 chars per line
- **No external dependencies** — vanilla JS + browser APIs only (no npm, no bundler)
- **Prefer `class`-based modules** with a singleton export (`export const myModule = new MyClass()`)
- **Always scope CSS** with `.ccs-` prefix to avoid leaking into SillyTavern's styles
- **Comment non-obvious logic** — particularly around ST integration edge cases

### The "Containment" Pattern (important for mobile)
All inner UI elements (modals, tooltips, pickers) **must** be appended to the studio overlay element (`this.el`), not `document.body`. This ensures they respect the overlay's stacking context and render correctly on mobile where ST applies CSS transforms.

---

## Making Changes

### Bug Fixes
1. Check `.pi/docs/ARCHITECTURE.md` and recent issues for known bugs
2. Reproduce the bug with a minimal test case
3. Fix in the appropriate module (`core/` for logic, `ui/` for rendering)
4. Test on both **desktop** and **mobile** viewport widths

### New Features
1. Open a GitHub issue first to discuss the approach
2. Keep `popup.js` as thin as possible — business logic belongs in `core/` or `phases/`
3. New settings → add to `memory.js` `_defaultSettings()` + migration in `init()` + UI in `settings-modal.js`

---

## Submitting a Pull Request

1. Fork the repo and create a feature branch: `git checkout -b feat/my-feature`
2. Make your changes following the code style above
3. Test manually in SillyTavern (desktop + mobile)
4. Update `CHANGELOG.md` under `## [Unreleased]`
5. Submit a PR with a clear description of **what** changed and **why**

### PR Checklist
- [ ] Tested on desktop (≥768px)
- [ ] Tested on mobile (≤480px)
- [ ] No new global CSS leaking outside `.ccs-*` scope
- [ ] New settings have defaults + migration in `memory.js`
- [ ] `CHANGELOG.md` updated

---

## Reporting Bugs

Please open a GitHub issue with:
- SillyTavern version
- CharCardStudio version (shown in the ST extensions panel)
- Device type (desktop/mobile/tablet)
- Steps to reproduce
- Console errors (F12 → Console tab)

---

## Architecture Notes

See [ARCHITECTURE.md](.pi/docs/ARCHITECTURE.md) for a full technical assessment of the codebase, known issues, and planned improvements.
