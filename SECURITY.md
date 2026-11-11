# Security policy

## Supported versions

Only the latest version published on the Chrome Web Store and Firefox Add-ons receives fixes. Extensions update
automatically, so a fix reaches users with the next release.

## Reporting a vulnerability

**Please don't open a public issue.** Report it privately through
[GitHub's private vulnerability reporting](https://github.com/Joansitoh/decibel-limiter/security/advisories/new)
(Security tab → *Report a vulnerability*).

Include what an attacker can do, the steps or a proof of concept, and the extension version and browser. You'll get
an acknowledgement within a week. This is a volunteer project, so fixes are best effort, but security reports take
priority over everything else. You'll be credited in the release notes unless you prefer not to be.

## Scope

Things we especially want to hear about:

- A web page influencing the extension beyond its own audio: forging messages to the service worker, changing
  another site's settings, reading stored settings, or running code in an extension context.
- The content script (it runs on every page) exposing data or functionality to the page.
- A crafted settings file that, once imported, breaks the extension or turns protection off without the user
  noticing.
- Any way the extension makes a network request, sends data out of the browser or loads remote code.

Out of scope: a page detecting that the extension is installed (the worklet file is web-accessible by design),
issues that need a malicious extension or a compromised browser, and reports from automated scanners without a
demonstrated impact.
