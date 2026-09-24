# 0085. The third-party notices are generated from the release and ship as their own asset, not inside the update zip

**Status:** Accepted (its asset names are superseded by [ADR 0197](0197-every-release-asset-name-carries-the-bare-version.md))
**Date:** 2026-09-21

## Context

The project is AGPL-3.0-or-later ([ADR 0039](0039-the-project-is-licensed-agpl-3-or-later.md), owner decision D17), so bundling GPL-family code is allowed but the release must carry the licences of what it contains, the AGPL text and a source offer. The docs security and hygiene PRD (stack S17) recommended (Open Question 15 a): the notices as a release asset **and a copy inside the update zip**.

The copy inside the zip conflicts with a security control the app already ships. The in-app updater unpacks exactly one entry, `narration-utils.exe`, and refuses a zip that holds anything else ([in-app update](../architecture/in-app-update.md), [ADR 0074](0074-the-windows-update-renames-the-running-executable-and-keeps-the-old-one-until-the-new-one-starts.md)). A client that is already installed (release candidates exist) would refuse every update to a two-file zip with "does not hold exactly the program", so the change would strand them. Changing the updater's rule is possible but is a change to the hostile-archive defence for the sake of a text file, and the notices would still be stale next to an updated program.

What the notices contain was measured on the local build: 74 Python distributions (derived from the frozen bundle's PyInstaller tables of contents, not from `pyproject.toml`), 44 npm and 18 Go modules, 10 hand-recorded native components, 15,000 lines. The freeze contains test tools that the runtime does not need ([#245](https://github.com/countrymanprime/narration-utils/issues/245)).

## Decision

1. **`scripts/licenses/notices.py` writes `THIRD-PARTY-NOTICES.txt` from what the release contains** (the frozen sidecars' tables of contents, the UI's production dependencies, the Go modules of the Windows build, a hand-kept `manual.json` for native components, the AGPL text of `LICENSE`, a source offer naming the repository and the tag) and **refuses to write a report it cannot trust**: an unknown licence, a component with no licence text, an unowned frozen module, a vendored native folder with no entry, an environment that is not the one that was frozen, a missing direct dependency.
2. **It is a release asset of its own** beside the zip and the setup program, with a `.sha256`, attested by the same `release-assets/*` glob, verified by `assets.mjs verify` (a Windows release without it, or with a changed one, is not promotable), and pointed at from the release notes. It is written by the Windows build after the freeze, so every pull request's Windows build proves the generator still works.
3. **It is not copied into the update zip.** The zip keeps its one file. **Not decided here (for the owner):** whether the setup program should also install a copy beside the program (an NSIS change that cannot be verified without a Windows build and an install), and whether the updater should accept a second, ignored entry once no client older than that change is in use. Both are filed as an issue.
4. **Dependencies use an SPDX allow-list in dependency review** (GPL, AGPL and LGPL families in, GPL-2.0-only out), and **models are recorded per artifact** in a generated table with a hand-written review row for each ([model provenance](../architecture/model-provenance.md)); an artifact whose licence is unclear stays out of the catalog.

## Consequences

- Every release has a checkable inventory of what it ships and where its source is, and the check runs on every pull request's Windows build.
- A narrator who unpacks only the portable zip does not get the notices with it; they are one click away on the same release page, and the setup program's copy is an open follow-up. This is the part to review.
- A licence the generator cannot name, or a component without a licence text, fails the build until a person records it (three are recorded, [#246](https://github.com/countrymanprime/narration-utils/issues/246)).
- Putting the notices in the zip later needs the updater change above and a new ADR that supersedes this one.
