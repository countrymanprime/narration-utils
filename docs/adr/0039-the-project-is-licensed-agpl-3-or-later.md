# 0039. The project is licensed AGPL-3.0-or-later

**Status:** Accepted
**Date:** 2026-09-20
**Supersedes:**

## Context

The repository was MIT-licensed from its first commit. The maintainer builds Narration Utils to help narrators with their workflow for free, after finding that every alternative was a subscription that covered one or two needs. The stated goal is that the work stays free, with no exceptions.

MIT lets anyone take the code into a closed, paid product. A copyleft license closes that door. The maintainer is the only human author (`git shortlog` shows one person plus Dependabot), so relicensing needs no one else's consent.

The shipped Guide sidecar already imports GPL-3.0-or-later packages (`piper-tts`, `phonemizer`, and eSpeak NG underneath). Under MIT that was an open question in `docs/research/local-dependency-evaluation.md` and in the docs-security PRD; under a GPL-family license it is not one.

## Decision

Narration Utils is licensed under the GNU Affero General Public License v3.0 or later (SPDX `AGPL-3.0-or-later`), effective on the merge of the pull request that adds this ADR.

- `LICENSE` holds the unmodified AGPL-3.0 text. The root `package.json`, `shell/package.json` and `pyproject.toml` declare `AGPL-3.0-or-later`.
- AGPL rather than GPL because the sidecars and the host could be run as a hosted service; AGPL section 13 extends the source obligation to that case.
- Releases already published under MIT (up to v0.2.7-rc) stay available under MIT. Only new work is AGPL.
- Contributions are accepted under the same license (inbound equals outbound). There is no contributor license agreement.
- A dependency is acceptable if its license is compatible with AGPL-3.0-or-later: permissive licenses (MIT, BSD, ISC, Apache-2.0, 0BSD, CC0), LGPL, GPL-3.0-or-later and AGPL-3.0-or-later. GPL-2.0-only, source-available, non-commercial and no-derivatives licenses are not. Model and voice weights are checked per artifact, because a weight file's terms are separate from the code that loads it.

## Consequences

- The Piper, phonemizer and eSpeak NG question ends. No separate-download split is needed for license reasons.
- Anyone who distributes a modified build, or runs one as a network service, must offer its source under the same terms. The license does not forbid selling copies; it guarantees that every copy stays free to use, study, change and share.
- The dependency allow-list in the docs-security PRD gains GPL, LGPL and AGPL entries, and third-party notices plus a source offer ship with releases (docs-security phases 7, 9 and 10).
- A future move back to a permissive license would need every contributor's consent, which is deliberate: it keeps the commitment hard to undo.
- To change this decision, write a new ADR that supersedes this one.
