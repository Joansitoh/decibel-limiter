# AGENTS.md

Guidance for coding agents (Claude Code, Codex, Cursor, Copilot, Devin…) working in this repository. Humans are
welcome to read it too. The contribution rules in [CONTRIBUTING.md](CONTRIBUTING.md) apply to agent-written work in
full, including the [AI policy](CONTRIBUTING.md#ai-assisted-contributions). How the extension works:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Project

Decibel Limiter is a Manifest V3 browser extension (Chromium + Firefox) that runs every sound a tab plays through a
lookahead brickwall limiter in an `AudioWorklet`, so peaks above the user's ceiling are never heard. Plain
JavaScript, no framework, no bundler, no runtime dependencies. What ships is exactly the `extension/` folder.

## Map

| Path | What it is |
|---|---|
| `extension/js/presets.js` | Single source of truth: scenarios, presets, defaults, `migrateConfig`, host helpers. Loaded in every context |
| `extension/js/limiter-processor.js` | The limiter (`LookaheadLimiter`, pure and Node-testable) and its `AudioWorkletProcessor` |
| `extension/js/content.js` | Fullscreen-friendly path: one graph per `<audio>`/`<video>`, Firefox DRM rule |
| `extension/js/offscreen.js` | Best quality path: graph for the captured tab stream (Chromium only) |
| `extension/js/background/` | Service worker: `main.js` (handlers), `storage.js` (config resolution), `capture.js` (tab capture ownership) |
| `extension/js/popup/` | Popup ES modules: `main.js` (events), `ui.js` (painting), `config.js`, `format.js`, `theme.js` |
| `extension/_locales/` | Every user-facing string (`en`, `es`) |
| `tests/verify-tab-handoff.mjs` | Main unit check (`npm test`); also runs `tests/limiter-processor.test.js` |
| `tests/e2e/` | Playwright tests that load the real extension in Chromium |
| `scripts/` | `build.mjs` (both store zips), `build-firefox.mjs` (Firefox folder), `store-art.mjs` (store images) |
| `img/store/` | Generated store art. Never edit the PNGs by hand: change `scripts/store-art.mjs` and run `npm run store-art` |
| `dist/`, `test-results/` | Generated, gitignored. Never edit |

## Commands

```sh
npm test                    # unit checks, no browser needed. Run before every commit
npm ci && npx playwright install chromium   # once, for e2e
npm run test:e2e            # loads the extension in Playwright's Chromium
npm run build:firefox       # dist/firefox/, for loading in Firefox
npm run build               # both store zips in dist/ (releases are built by CI, see docs/RELEASING.md)
npm run lint:firefox        # Mozilla's validator on dist/firefox/ (run build:firefox first)
```

`npm run test:hq` drives real tab capture and only works on Windows (it sends a global hotkey). Don't run it
elsewhere; say you couldn't.

## Rules that bite

- **The ceiling is sacred.** No change may let output exceed the ceiling, even for one block at startup.
  `tests/limiter-processor.test.js` checks it; extend it when you touch the limiter.
- **The audio thread doesn't allocate.** No `new`, array literals, closures or `Array.from` inside
  `LookaheadLimiter.process()` or `LimiterProcessor.process()`. GC pauses are audible clicks.
- **One shared scope in the service worker.** The background files are `importScripts`'d together. Never add a
  top-level `const`/`let`/`class` name that another background file also declares, and don't destructure
  `self.DLPresets` at the top of `storage.js` or `capture.js`. A duplicate kills the worker silently.
- **Keep the mirrors in sync.** Release speeds live in both `presets.js` (`STRENGTH_PRESETS`) and
  `limiter-processor.js` (`LIMITER_PRESETS`); the worklet can't import. The store art mirrors popup tokens and icons.
- **Don't answer messages you don't own.** `onMessage` listeners return nothing for unknown types. Only the owner
  returns `true` / calls `sendResponse`. The popup never answers.
- **Validate at the trust boundary.** Messages, storage and imported files go through `migrateConfig()` (and
  `sanitizeIncoming()` for messages). Never trust a config shape.
- **Stored keys are API.** `soft`/`normal`/`strong`, `capture`/`element`, storage key names: existing users have them.
  Renaming needs a migration in `migrateConfig()` and a test.
- **No new permissions, host permissions, network requests, remote code or dependencies in `extension/`** without
  maintainer approval in an issue. Each one changes the install warning or store review for every user.
- **No obfuscation.** Chrome Web Store forbids it; minification at build time is the only transformation.
- **Every string is localized.** Use `data-i18n*` attributes or `chrome.i18n.getMessage()`, and add the key to
  **every** locale in `_locales/`. `npm test` fails on missing or extra keys.
- **Firefox has no Best quality.** Anything using `tabCapture`/`offscreen` must stay behind `HQ_SUPPORTED` (service
  worker) or `chrome.tabCapture` checks (popup). Keep the Gecko DRM rule in `content.js` intact.
- **Never commit** `dist/`, test videos (`tests/videoplayback.mp4`), screenshots or recordings made for a PR.

## How to write code here

Lazy means efficient, not careless. The best code is the code never written. Before writing anything, stop at the
first rung that holds:

1. Does this need to be built at all?
2. Does the platform (Web Audio, the extensions API, the DOM) already do it?
3. Does code already in this repo do it? (`presets.js`, `format.js`, existing helpers)
4. Can it be one line?
5. Only then: the minimum code that works.

- Match the surrounding style: 2-space indent, single quotes, semicolons, `const` by default, private `#fields`,
  early returns. `.editorconfig` has the basics.
- No abstractions, options or files nobody asked for. Deletion over addition. Boring over clever.
- Comments say **why**, not what: the browser quirk, the race, the constraint. Keep the existing ones accurate when
  you change the code under them.
- Mark an intentional shortcut with a `ponytail:` comment that names its limit and the upgrade path.
- Not lazy about: input validation, error handling that would lose user settings, security, accessibility (roles,
  `aria-*`, keyboard), and anything explicitly requested.
- Non-trivial logic leaves one runnable check behind: an assertion in `tests/verify-tab-handoff.mjs` or
  `tests/limiter-processor.test.js`. Extend those before creating a new test file.

## Verifying

- Run `npm test` before you commit. Run `npm run build:firefox && npm run lint:firefox` if you touched the manifest,
  background or anything Firefox-specific.
- You cannot hear audio. A change to audio behavior is not verified until a human has listened to it in a real
  browser. Say so in the PR instead of claiming it works.
- UI changes need before/after screenshots of the popup (light and dark), taken by the human or with Playwright.
- Report the commands you ran, their results, and what you could not check.

## Git and PRs

- Don't commit, push or open PRs unless your human asked. Never bump the version: releasing is the maintainer's job. Don't revert changes you didn't make.
- Conventional Commits: `type(scope): summary`, e.g. `fix(content): wire elements after DRM keys on Firefox`.
  Types and scopes are listed in [CONTRIBUTING.md](CONTRIBUTING.md#commits).
- One problem per PR. Fill in the PR template, including the AI disclosure section: name the tool and model.
- Commits you wrote end with a trailer naming the agent, e.g.
  `Co-Authored-By: Claude <noreply@anthropic.com>` or `Assisted-by: <tool> (<model>)`.
- Before starting, check nobody is on it: `gh pr list --state open --search "<issue number or file>"`.
- After a maintainer pushes to your branch, merge `main` into it. Never rebase or force-push over their commits.
