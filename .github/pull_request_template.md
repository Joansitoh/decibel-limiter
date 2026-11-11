<!--
Read CONTRIBUTING.md first. One problem per PR. Title = a Conventional Commit, e.g.
"fix(content): wire elements after DRM keys on Firefox". Delete the comments as you fill this in.
-->

## Problem

<!-- What is wrong or missing, for whom, and how to reproduce it. -->

## Change

<!-- How this fixes it. If it touches several components, why each is needed for this one problem. -->

## Issue or approval

<!-- "Fixes #123". Features and behavior changes: link the maintainer's approval comment.
A small obvious fix without an issue: say why it qualifies. -->

## Verification

<!-- What you ran and what you observed. "Tests pass" alone is not enough. State what you could NOT check. -->

- [ ] `npm test` passes
- [ ] Added or extended a check that fails without this change (or: purely visual / not testable, explained above)

Tested by hand (tick what applies, leave the rest):

- [ ] Chromium, Best quality
- [ ] Chromium, Fullscreen-friendly (including the player's fullscreen button)
- [ ] Firefox (`npm run build:firefox && npm run lint:firefox`, then loaded in Firefox)
- [ ] Two tabs playing at once (Best quality handoff)
- [ ] I **listened** to the result (required for anything that changes what users hear)

<!-- UI changes: before/after screenshots of the popup in light and dark theme, attached here (not committed). -->

## AI disclosure

<!-- Required. Pick one and fill in the details. See CONTRIBUTING.md#ai-assisted-contributions -->

- [ ] No AI tools were used beyond simple autocomplete.
- [ ] AI tools were used: <!-- tool and model, e.g. "Claude Code (Claude Opus)" --> for <!-- what: all the code, the tests, the description… -->

- [ ] I understand every line of this change and can explain it without AI help.

## Checklist

- [ ] One problem only; no unrelated changes
- [ ] New user-facing strings are in every `_locales/*/messages.json`
- [ ] No new permissions, network requests or dependencies (or approved in the linked issue)
- [ ] Docs updated if behavior changed (`docs/ARCHITECTURE.md`, `README.md`, `CHANGELOG.md` under *Unreleased*)
- [ ] "Allow edits by maintainers" is ticked
