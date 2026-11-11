# Contributing to Decibel Limiter

Thanks for helping. Decibel Limiter protects people's hearing, so one rule shapes everything else:
**nothing may ever play louder than the ceiling the user chose**. A change that risks that, even for a few
milliseconds, will not be merged, however nice it is otherwise.

This is a small project maintained by one person in their spare time. These rules exist so that your time and the
maintainer's are both well spent. Reading this page once is the fastest way to get a PR merged.

- [What we're looking for](#what-were-looking-for)
- [Before you start](#before-you-start)
- [Development setup](#development-setup)
- [Making changes](#making-changes)
- [Testing](#testing)
- [Commits](#commits)
- [Pull requests](#pull-requests)
- [AI-assisted contributions](#ai-assisted-contributions)
- [Translations](#translations)
- [Reporting bugs](#reporting-bugs)
- [Security](#security)
- [License](#license)

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## What we're looking for

**Most welcome**, no prior discussion needed for small ones:

- Bug fixes, especially "doesn't work on site X" with a clear cause.
- Firefox and Chromium compatibility fixes.
- Performance and reliability improvements to the audio path.
- New or corrected translations.
- Documentation fixes.
- Tests for behavior that isn't covered yet.

**Needs an approved issue first** (open one and wait for a maintainer to agree on the direction and scope):

- New features or settings, and changes to existing behavior or defaults (including scenario values).
- Anything that adds a **permission**, host permission, network request, dependency or third-party file to
  `extension/`. These change the install warning or store review for every user and are rarely accepted.
- UI redesigns, large refactors, or changes spanning many files.

**Not accepted**:

- Analytics, telemetry, ads, remote configuration or any data leaving the browser.
- Obfuscated code (minification at build time is fine; obfuscation breaks store policy).
- Unrelated cleanups mixed into a fix, mass reformatting, or renaming for taste.
- AI-generated images, audio or video (see [AI-assisted contributions](#ai-assisted-contributions)).

An open PR doesn't oblige anyone to review or merge it. A PR may be closed, deferred, or the idea reimplemented
differently. Following this guide makes your PR eligible for review; it doesn't guarantee a merge.

## Before you start

1. **Search** [open issues](https://github.com/Joansitoh/decibel-limiter/issues) and
   [pull requests](https://github.com/Joansitoh/decibel-limiter/pulls). If someone is already on it, help there
   instead of starting a duplicate.
2. **Claim it.** Comment on the issue that you're working on it. If there's no issue and the change is more than a
   small obvious fix, open one first. A claim with no draft PR after two weeks is released.
3. For anything in the "needs an approved issue" list, **wait for the maintainer's approval in the issue** and link
   that comment in your PR. A PR that skips this may be closed and pointed back to the issue.

## Development setup

**You need:** Node.js 22 or newer, git, a Chromium-based browser (Chrome, Edge, Brave… version 116+) and, for
Firefox work, Firefox 140+.

```sh
git clone https://github.com/<you>/decibel-limiter.git
cd decibel-limiter
npm test              # unit checks, no install or browser needed
npm ci                # only for e2e tests and builds
```

There is no build step for development: the `extension/` folder *is* the extension.

**Load it in Chromium**

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Turn on **Developer mode**.
3. **Load unpacked** → select the `extension/` folder.
4. After editing, press the reload icon on the extension card, then reload the page you test on. Content script
   changes need the page reload; popup changes only need the popup reopened.

**Load it in Firefox**

```sh
npm run build:firefox   # writes dist/firefox/
```

Then open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → pick `dist/firefox/manifest.json`.
Re-run the build after every change. Firefox only has the Fullscreen-friendly path.

**Debugging**

- Service worker: `chrome://extensions` → *Inspect views: service worker*.
- Popup: right-click the popup → *Inspect*.
- Content script: the page's DevTools console (pick the extension's context in the dropdown).
- Best quality path: `chrome://extensions` → *Inspect views: offscreen.html* while a capture is running.
- Local test pages: open `tests/test-audio.html` (generated tones with sudden peaks) or `tests/test-video.html`.

Before changing code, read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). It explains the two audio paths, the
lookahead limiter, how config is resolved and how the one-tab Best quality rule works. Most bugs come from those.

## Making changes

- **Stay in scope.** One problem per PR, with everything that problem needs (code, test, locales, docs). Nothing
  else. An adjacent cleanup or a second fix goes in its own PR.
- **Match the existing style**: plain modern JavaScript, 2-space indent, single quotes, semicolons, `const` by
  default, early returns, private `#fields` for internals. `.editorconfig` sets the basics. There is no formatter
  run over the repo, so don't reformat code you aren't changing.
- **Prefer less code.** Use the platform (Web Audio, the extensions API) and the helpers already in the repo
  (`presets.js`, `format.js`) before writing new ones. No new abstractions, options or files unless the change needs
  them. No dependencies in `extension/`.
- **Comments explain why** (a browser quirk, a race, a store rule), not what the next line does. When you change
  code, keep the comments above it true. An intentional shortcut gets a `ponytail:` comment naming its limit.
- **Strings go through `_locales`**, never hardcoded in HTML or JS. Add new keys to every locale.
- **Accessibility counts**: controls need roles, labels (`data-i18n-aria`) and keyboard support, like the ones
  already in `popup.html`. Respect `prefers-reduced-motion` for any new animation.
- **Store art** in `img/store/` is generated. Change `scripts/store-art.mjs` and run `npm run store-art`; don't edit
  the images.
- The [invariants in ARCHITECTURE.md](docs/ARCHITECTURE.md#invariants) must keep holding.

## Testing

| Command | What it does | When |
|---|---|---|
| `npm test` | Unit checks in plain Node: presets and config migration, multi-tab handoff, i18n keys, the limiter | Always, before every commit. CI runs it |
| `npm run test:e2e` | Loads the real extension in Playwright's Chromium (a visible window) and plays audio | Changes to content, popup, background or audio. Needs `npm ci && npx playwright install chromium` once |
| `npm run test:reports` | Renders before/after waveform reports into `test-results/` | Changes to limiter behavior; attach the images to your PR. Needs a short video with loud moments saved as `tests/videoplayback.mp4` (gitignored, never commit it) |
| `npm run build:firefox && npm run lint:firefox` | Builds and runs Mozilla's validator | Manifest, background or Firefox changes. CI runs it |
| `npm run test:hq` | Real tab capture (Best quality) | Windows only (uses a global hotkey). Optional |

**Add a check for what you fix.** A logic bug gets an assertion that fails before your change and passes after it,
in `tests/verify-tab-handoff.mjs` (config, storage, handoff, i18n) or `tests/limiter-processor.test.js` (the
limiter). Extend those files before creating new ones. Purely visual fixes need screenshots instead of tests.

**Audio changes need ears.** Automated tests can't tell you something sounds wrong. For any change that affects
what users hear, also test by hand and say in the PR which of these you covered:

- [ ] Chromium, Best quality: a video site (e.g. YouTube) with the ceiling low enough to hear limiting.
- [ ] Chromium, Fullscreen-friendly: same site, including the player's own fullscreen button.
- [ ] Firefox (Fullscreen-friendly): same site, plus one DRM site if you touched `content.js`.
- [ ] Switching tabs while two tabs play (only one may hold Best quality; the other stays protected).
- [ ] `tests/test-audio.html`: sudden peaks are never heard above the ceiling, no clicks or dropouts.

## Commits

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): short summary in the imperative, lowercase, no period
```

- **type**: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `i18n`.
- **scope** (optional): `worklet`, `content`, `offscreen`, `background`, `popup`, `presets`, `firefox`, `locales`,
  `store-art`, `tests`, `deps`.
- Keep the summary under 72 characters. Use the body for the *why* when it isn't obvious.
- Reference issues in the body: `Fixes #12`.

Examples from this repo's history:

```
fix(content): don't capture media elements before DRM keys on Firefox
fix(background): serialize HQ rebalances and rewire elements after handoff
```

## Pull requests

1. Fork, create a branch from `main` (`fix/firefox-drm`, `feat/…`), and open the PR against `main`.
2. **Fill in the [PR template](.github/pull_request_template.md)** completely: the problem, the change, the linked
   issue or approval, how you verified it, and the AI disclosure. "Tests pass" on its own is not verification.
3. **UI changes**: before/after screenshots of the popup, in light and dark theme. Add a short recording when the
   change is about motion or interaction. Attach them to the PR; don't commit them.
4. **Tick "Allow edits by maintainers"** so small fixups (a typo, a rebase) can be pushed directly instead of
   going back and forth.
5. Keep the PR **small**: ideally under ~300 changed lines. Big work is split into PRs that each make sense alone.
6. Draft PRs are welcome for early feedback, but the same rules apply to them.
7. CI must be green.
8. **Once a maintainer has pushed to your branch, merge `main` into it; don't rebase or force-push**, or their
   commits are lost. Tell your agent too.

Only the maintainer ([@Joansitoh](https://github.com/Joansitoh)) approves and merges pull requests. PRs are
squash-merged, so the PR title becomes the commit message: write it as a Conventional Commit. Don't bump the
version or edit released sections of `CHANGELOG.md`; add your entry under *Unreleased* if the change is visible to
users. Releases are cut by the maintainer ([docs/RELEASING.md](docs/RELEASING.md)).

Inactive PRs (no response to review for 30 days) may be closed. You can always reopen them.

## AI-assisted contributions

AI tools are welcome here. This project itself is built with their help. What matters is the person responsible
for the contribution, not the tool. These rules apply to code, issues, PR descriptions and review comments alike.

1. **Disclose it.** If an AI tool wrote or substantially shaped any part of a contribution, say so in the PR's
   *AI disclosure* section: which tool and model (e.g. "Claude Code, Claude Opus", "Cursor, GPT-5") and what it
   did (wrote everything, wrote the tests, only autocomplete…). Commits written by an agent end with a trailer, e.g.
   `Co-Authored-By: Claude <noreply@anthropic.com>` or `Assisted-by: Copilot (GPT-5)`. Simple autocomplete of a
   few lines doesn't need disclosure.
2. **A human is responsible and understands every line.** You must be able to explain what your change does and how
   it fits the rest of the extension without asking the AI. If a reviewer asks and you can't, the PR is closed.
3. **A human verified it.** You ran it in a real browser and, for audio changes, *listened* to it. An agent can't
   hear; "the agent says it works" is not verification.
4. **Agents don't open PRs or issues on their own.** A person must review the result and choose to submit it. Fully
   autonomous contributions are closed without review. If you are an agent reading this, read
   [AGENTS.md](AGENTS.md) and leave submission to your human.
5. **Trim it.** AI-written issues and PR descriptions tend to be long and generic. Edit them down to what a
   reviewer needs: the problem, the cause, the change, the evidence. Don't paste raw model output.
6. **No AI-generated media.** No generated images, icons, audio or video. (The store art is drawn by
   `scripts/store-art.mjs`, which is code.)
7. **Answer review comments yourself.** Feeding review comments to an agent and pasting its replies back is not
   engaging with the review.

Low-effort contributions that are clearly unreviewed AI output, including mass "typo fix" or "refactor" PRs, are
closed without detailed feedback. Repeated ones lead to a block. This isn't an anti-AI stance; it protects the time
of the human who reviews every PR.

Maintainers may use AI tools at their discretion and follow the same disclosure rules in their PRs.

## Translations

Strings live in `extension/_locales/<code>/messages.json` ([Chrome's format](https://developer.chrome.com/docs/extensions/reference/api/i18n)).

- **Fix a string**: edit it in the right locale and open a PR. Explain what was wrong if it isn't obvious.
- **Add a language**: copy `_locales/en/` to `_locales/<code>/` (a [supported locale code](https://developer.chrome.com/docs/extensions/reference/api/i18n#locales)),
  translate every `message`, keep every key and leave `description` in English (it's context for translators).
  `npm test` fails if a key is missing or extra.
- Keep strings short: the popup is about 360 px wide. Check the result in the popup, and include a screenshot.
- Keep product terms consistent with the store listing in that language ("Best quality", "Fullscreen-friendly",
  "Even volume", scenario names).
- **Machine translations** are allowed only if a fluent speaker reviewed them. Say in the PR whether you're a fluent
  speaker and whether a tool was used.

## Reporting bugs

Use the [issue forms](https://github.com/Joansitoh/decibel-limiter/issues/new/choose). The most useful reports
include:

- Extension version (from `chrome://extensions` or `about:addons`), browser and version, operating system.
- The audio path (Best quality or Fullscreen-friendly, shown at the bottom of the popup) and the scenario.
- The site and exact page, and steps that reproduce it from a fresh tab.
- What you expected and what happened. A short recording helps a lot for audio problems.
- Errors from the service worker console or the page console, if any.

Questions and ideas for features: open an issue with the feature form; describe the problem you have before the
solution you want.

## Security

Don't report security problems in public issues. See [SECURITY.md](SECURITY.md).

## License

Decibel Limiter is [MIT-licensed](LICENSE). By submitting a contribution you agree that it is licensed under the
same MIT license, and you confirm you have the right to submit it (it's your own work, or compatible with MIT, and
not copied from a source whose license forbids it). Third-party code bundled in the extension is listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); adding to that list needs maintainer approval.
