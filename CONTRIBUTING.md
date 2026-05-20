# Contributing to CharCardStudio

> **This is a hobby project, vibecoded by one person, for one person.**
>
> I built CharCardStudio mainly to make character cards for myself. I vibecoded the entire thing with an AI assistant. As a result, only the AI and God know exactly what the code does — and the AI forgets between sessions, so now only God knows. If you're looking for a well-architected, properly maintained open-source project: wrong repo. If you want to help make a scrappy personal tool slightly less broken: welcome, pull requests are open. Though it will be the AI who reviews and merges it - so try to make it AI friendly.

---

## About the Project

CharCardStudio is a SillyTavern extension built by one person in their spare time. The codebase has evolved quickly across multiple rewrites (v1 → v2 → v3 → v4), is likely to have bugs, and almost certainly has edge cases that were never thought about. Contributions that fix bugs or clean things up are genuinely appreciated — just keep expectations realistic about review times.

---

## Getting Started

### Prerequisites
- SillyTavern installed and running locally
- Node.js / npm (only needed if you use any dev tooling; the extension itself has no build step)
- A modern browser with DevTools

### Dev Setup

1. Clone the repository into your ST extensions folder:
   ```bash
   cd SillyTavern/public/scripts/extensions/third-party/
   git clone https://github.com/MMKAVERAPPA/CharCardStudio.git CharCardStudio
   ```

2. Enable the extension in SillyTavern's Extensions panel

3. Open the browser DevTools (F12) — all CCS logs are prefixed with `[CCS]`

4. Edit files directly — there is no build step. Reload ST (Ctrl+R) to pick up changes to JS/CSS files.

---

## Project Structure

- `core/` — Business logic (agent, tools, session, silent-generation, validators, background checks, tab lock)
- `modes/` — Mode-specific rules & chips (Janitor, HTML, Image prompt, FictionLab)
- `prompts/` — Mode and Phase prompt definitions
- `ui/` — UI controllers (app, chat, settings-modal, toast)
- `templates/` — HTML templates for overlays

The main entry point is `index.js`. The studio itself is orchestrated by `ui/app.js`.

---

## Code Style

- **Vanilla ES modules** — no build step, no bundler, no framework
- **No TypeScript** — plain JavaScript only
- Class names in the DOM use the `ccs-` prefix to avoid conflicts with SillyTavern's own CSS
- Async/await throughout — avoid raw Promise chains
- Keep CSS inside `style.css` using `.ccs-*` class selectors only; never use inline styles for anything persistent
- New settings must have a default value and a migration check in `core/session.js`'s schema migration logic

---

## Submitting a Pull Request

1. Fork the repo and create a feature branch: `git checkout -b feat/my-feature`
2. Make your changes following the code style above
3. Test manually in SillyTavern on both desktop and mobile if possible
4. Update `CHANGELOG.md` under the latest release section or a new unreleased draft
5. Submit a PR with a clear description of **what** changed and **why**

### PR Checklist
- [ ] Tested on desktop (≥ 768px)
- [ ] Tested on mobile if the change touches UI (≤ 480px)
- [ ] No new CSS leaking outside `.ccs-*` scope
- [ ] New settings have defaults + migration in `core/session.js`
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

The technical architecture is documented in `.pi/ARCHITECTURE.md` and `.pi/ARCHITECTURE_PART2.md` in the repository. Key points:

- The **Agent Loop** (`core/agent.js`) drives generation through structured `<tool_call>` definitions.
- The **Session Manager** (`core/session.js`) is the single source of truth for all session state and handles debounced IndexedDB saves.
- **Modes** are swapped programmatically (`swapModeHistory`), restoring separate message histories and layout templates.

---

## License

MIT License — free to use, modify, and distribute.
