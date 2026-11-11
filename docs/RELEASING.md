# Releasing

For maintainers. Contributors don't bump versions or edit released sections of the changelog.

Releases are automatic: when a commit on `main` changes `version` in `extension/manifest.json`, the
[Release workflow](../.github/workflows/release.yml) runs the tests, builds both store packages, tags `v<version>`
and publishes a GitHub release with the zips attached and the notes taken from `CHANGELOG.md`.

## Steps

1. **Changelog.** Move the *Unreleased* entries in `CHANGELOG.md` under `## [<version>] - <date>` and update the
   links at the bottom. The release fails if this section is missing.
2. **Version.** Bump `version` in `extension/manifest.json` ([semver](https://semver.org/): fix → patch, feature →
   minor). The Firefox manifest is generated from it.
3. **Check locally.**
   ```sh
   npm test
   npm run test:e2e
   npm run build            # dist/decibel-limiter-<version>.zip and -firefox.zip
   npm run lint:firefox
   ```
   Load both packages and do the manual pass from [CONTRIBUTING.md](../CONTRIBUTING.md#testing) on Chromium and
   Firefox. The store versions must be strictly greater than the published ones.
4. **Merge to `main`** (both changes in one PR, titled `chore: release <version>`). The workflow publishes the
   GitHub release a minute later. To retry a failed run, use *Run workflow* on the Release workflow.
5. **Upload to the stores** from the release's assets:
   - `decibel-limiter-<version>.zip` → [Chrome Web Store dashboard](https://chrome.google.com/webstore/devconsole)
   - `decibel-limiter-<version>-firefox.zip` → [Firefox Add-ons](https://addons.mozilla.org/developers/addon/decibel-limiter/versions/submit/)

   If permissions changed, update the listings' permission justifications
   (see [ARCHITECTURE.md](ARCHITECTURE.md#permissions)).

## Packages

`npm run build` (`scripts/build.mjs`) writes:

| File | Contents |
|---|---|
| `decibel-limiter-<version>.zip` | `extension/` with every JS file except `*.min.js` minified by esbuild, per file, without bundling. Minified, never obfuscated (store policy) |
| `decibel-limiter-<version>-firefox.zip` | `dist/firefox/` from `scripts/build-firefox.mjs`, unminified, so Firefox Add-ons doesn't need a separate source upload |

The zips are reproducible: the same sources give byte-identical files. `npm run build -- --no-minify` zips the
Chromium sources as they are, for debugging a store rejection.

## Store art

`npm run store-art` regenerates `img/store/*.svg|png` (screenshots 1280×800, promo tiles 440×280 and 1400×560)
with Playwright. Edit `scripts/store-art.mjs`, never the images. If the popup's look or copy changed, update the art
so the listings show the real extension. Fonts render slightly differently per OS, so only commit the images whose
`.svg` actually changed.
