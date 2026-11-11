# Changelog

All notable changes to Decibel Limiter are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).
The version is the one in `extension/manifest.json`.

## [Unreleased]

## [1.5.2] - 2026-11-12

### Fixed

- Firefox: DRM players (Prime Video, Netflix) failed to start with protection on. Media elements are now only
  routed through the limiter once their DRM keys are attached, or once they are known to be unencrypted.
- Imported settings files and old stored settings can no longer set a ceiling outside −60…0 dBFS. A value above
  0 dBFS would have silently turned protection off.
- On Firefox, the "Rate" prompt linked to the Chrome Web Store; it now opens Firefox Add-ons.

### Changed

- The status line says "Even volume" instead of the ambiguous "Evening volume".
- Updated GSAP (popup animations) from 3.12.5 to 3.15.1.
- The Chromium manifest declares `minimum_chrome_version: 116`, the first version with every API the extension uses.
- Removed an unused font file from the package.

### Project

- Open-source groundwork: contributing guide with an AI-assisted contributions policy, `AGENTS.md`, code of conduct,
  security policy, issue and PR templates, CI, automatic GitHub releases, architecture docs, and third-party
  license notices.

## 1.5.1 - 2026-11-03

### Fixed

- Firefox packaging for Firefox Add-ons: declare data collection permissions (none), final add-on ID, and ship
  unminified sources.

## 1.5.0 - 2026-10-31

### Added

- Firefox support (Fullscreen-friendly path only; Firefox has no tab capture).
- Scenarios: Night, Balanced, Social and Music, plus an optional "Even volume" leveling stage.
- Best quality path (whole-tab capture) as the default, with Fullscreen-friendly as a per-site choice.
- Per-site memory, "Apply to all sites", settings export and import.
- Keyboard shortcuts: Alt+Shift+D toggles protection, Alt+Shift+S cycles scenarios.
- Light, dark and automatic themes; Spanish translation.

### Changed

- Real lookahead limiter in an AudioWorklet: peaks are reduced before they are played instead of after.
- Recovery after a peak is a preset (Fast, Normal, Slow) instead of a free value.

### Fixed

- Only one tab holds Best quality at a time; rebalancing between tabs is serialized so a click can't be lost, and
  other tabs stay protected through the element path.

## 1.4.x and earlier

See the [git history](https://github.com/Joansitoh/decibel-limiter/commits/main).

[Unreleased]: https://github.com/Joansitoh/decibel-limiter/compare/v1.5.2...HEAD
[1.5.2]: https://github.com/Joansitoh/decibel-limiter/releases/tag/v1.5.2
