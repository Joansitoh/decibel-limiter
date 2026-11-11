# Third-party notices

Decibel Limiter's own code is under the [MIT License](LICENSE). The packaged extension also bundles the following
third-party files, each under its own license.

| Component | Files | License |
|---|---|---|
| [GSAP](https://gsap.com) 3.15.1 by GreenSock | `extension/js/gsap.min.js` | [GSAP Standard "No Charge" License](https://gsap.com/standard-license): free, including commercial use, but not MIT |
| [Outfit](https://github.com/Outfitio/Outfit-Fonts) font | `extension/fonts/outfit-latin-wght-normal.woff2` | [SIL Open Font License 1.1](extension/fonts/OFL.txt) |
| [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) font | `extension/fonts/jetbrains-mono-latin-wght-normal.woff2` | [SIL Open Font License 1.1](extension/fonts/OFL.txt) |

GSAP is used only for popup animations, and the popup works without it. Forks that redistribute the extension
must follow GSAP's license terms or remove it.

Development-only tools (Playwright, esbuild, web-ext) are not shipped in the extension.
