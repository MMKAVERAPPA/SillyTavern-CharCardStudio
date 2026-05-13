# Contributing to CharCardStudio

> **This is a hobby project, vibecoded by one person, for one person.**
>
> I built CharCardStudio mainly to make character cards for myself. I vibecoded the entire thing with an AI assistant. As a result, only the AI and God know exactly what the code does — and the AI forgets between sessions, so now only God knows. If you're looking for a well-architected, properly maintained open-source project: wrong repo. If you want to help make a scrappy personal tool slightly less broken: welcome, pull requests are open. Though it will be the AI who reviews and merges it - so try to make it AI friendly.

---

## About the Project

CharCardStudio is a SillyTavern extension built by one person in their spare time. The codebase has evolved quickly across multiple rewrites (v1 → v2 → v3), is likely to have bugs, and almost certainly has edge cases that were never thought about. Contributions that fix bugs or clean things up are genuinely appreciated — just keep expectations realistic about review times.

---

## Getting Started

### Prerequisites
- SillyTavern installed and running locally
- Node.js / npm (only needed if you use any dev tooling; the extension itself has no build step)
- A modern browser with DevTools

### Dev Setup

1. Clone the repository into your ST extensions folder:
   ```bash
   cd SillyTavern/data/<your-username>/extensions/third-party/
   git clone https://github.com/MMKAVERAPPA/SillyTavern-CharCardStudio CharCardStudio
   ```

2. Enable the extension in SillyTavern's Extensions panel

3. Open the browser DevTools (F12) — all CCS logs are prefixed with `[CCS]`

4. Edit files directly — there is no build step. Reload ST (Ctrl+R) to pick up changes to JS/CSS files. Skill prompt files in `prompts/skills/` hot-reload on studio re-open (no full page reload needed).

---

## Project Structure

```
core/          — Business logic (API, memory, audit, card, parsing)
phases/        — Phase orchestrators (ideation, generation, lorebook)
prompts/       — AI prompt templates and skill modules
ui/            — UI components (popup, panels, modals)
templates/     — Character archetype JSON templates
```

The main entry point is `index.js`. The studio itself lives in `ui/popup.js`, which orchestrates all panels and phases.

---

## Code Style

- **Vanilla ES modules** — no build step, no bundler, no framework
- **No TypeScript** — plain JavaScript only
- Class names in the DOM use the `ccs-` prefix to avoid conflicts with SillyTavern's own CSS
- Async/await throughout — avoid raw Promise chains
- Keep CSS inside `style.css` using `.ccs-*` class selectors only; never use inline styles for anything persistent
- New settings must have a default value and a migration check in `memory.js`'s `init()` method
- Keep skill prompt modules in `prompts/skills/` — one file per skill category

---

## Submitting a Pull Request

1. Fork the repo and create a feature branch: `git checkout -b feat/my-feature`
2. Make your changes following the code style above
3. Test manually in SillyTavern on both desktop and mobile if possible
4. Update `CHANGELOG.md` under a new `## [Unreleased]` section
5. Submit a PR with a clear description of **what** changed and **why**

### PR Checklist
- [ ] Tested on desktop (≥ 768px)
- [ ] Tested on mobile if the change touches UI (≤ 480px)
- [ ] No new CSS leaking outside `.ccs-*` scope
- [ ] New settings have defaults + migration in `memory.js`
- [ ] `CHANGELOG.md` updated

---

## Reporting Bugs

Please open a GitHub issue with:
- SillyTavern version
- CharCardStudio version (shown in the ST Extensions panel)
- Device type (desktop / mobile / tablet)
- Steps to reproduce
- Console errors (F12 → Console tab)

Keep in mind this is a hobby project — not every bug will get fixed immediately, but I do read all issues.

---

## Architecture Notes

The full technical architecture is documented in `.pi/docs/ARCHITECTURE.md` in the repository. Key points:

- The **Skill Router** (`core/skill-router.js`) assembles AI prompts from modular knowledge files instead of using a single monolithic system prompt. To add new AI behavior, add a new export to the appropriate `prompts/skills/*.js` file.
- The **Memory Manager** (`core/memory.js`) is the single source of truth for all session state. All reads and writes should go through it, not directly to `extensionSettings`.
- The **Phase orchestrators** (`phases/`) are the "controllers" — they handle user intent within a phase and delegate to `chatEngine`, `auditEngine`, and `worldInfoManager`.

---

## License

MIT License — free to use, modify, and distribute.
