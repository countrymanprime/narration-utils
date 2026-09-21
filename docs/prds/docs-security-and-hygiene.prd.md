# Docs Security and Hygiene: Link Check, Threat Model, Diagrams and Licence Notices

**Source:** the owner's review of the documentation and security posture (2026-09-20), four items approved as worth doing; it draws on [ADR 0028](../adr/0028-planned-work-is-specified-as-prds-and-deleted-when-built.md) (links into deleted PRDs die by design), [`SECURITY.md`](../../SECURITY.md) (its scope list), [`first-use-dependency-provisioning.md`](../architecture/first-use-dependency-provisioning.md) (normative download rules) and [`local-dependency-evaluation.md`](../research/local-dependency-evaluation.md) (licence policy). It does not duplicate [`release-readiness-provisioning-and-docs-site.prd.md`](release-readiness-provisioning-and-docs-site.prd.md); it links to it where the two meet (docs site Phases 10 to 12, installer Phase 14, provisioning Phases 5 to 7).

## Reconciled with the implementation plan (2026-09-21, stack S17)

The owner's decisions in [implementation-plan.md](implementation-plan.md) section 1 override the text below where they differ. Applied here so the phases read true:

- **D17 (AGPL-3.0-or-later, [ADR 0039](../adr/0039-the-project-is-licensed-agpl-3-or-later.md)).** Open Question 12 collapses: bundling Piper, `phonemizer` and eSpeak NG in the frozen sidecar is fine and there is no separate-asset split. The notices ship the AGPL text and a source offer (the repository URL and the release tag); the `allow-licenses` list (Question 14) includes `GPL-3.0-or-later`, `AGPL-3.0-or-later` and the LGPL entries. `LICENSE` is AGPL, not MIT, everywhere this PRD says MIT for the project. Question 13 stays: unclear model licences are marked "unclear" and kept out of the catalog until cleared, per artifact.
- **D11 (docs match the live settings).** No ruleset requires a status check and code-owner review is required. Any row or sentence below that assumes a required check (`CI / gate`) is stale; the docs job is written so that it would be safe to require, and requiring it is an owner-only setting.
- **D14 (in-app update, [ADR 0072](../adr/0072-the-app-updates-itself-from-this-repositorys-releases-and-never-installs-without-a-click.md) to [ADR 0074](../adr/0074-the-windows-update-renames-the-running-executable-and-keeps-the-old-one-until-the-new-one-starts.md)).** The threat model gains the update trust boundary (GitHub API and CDN to the app replacing its own executable), a fourth sequence diagram, the "no telemetry, no listener, one startup request" statements, and a `SECURITY.md` scope bullet (that bullet already exists).
- **D16 (Zod at the boundaries, [ADR 0069](../adr/0069-payloads-are-validated-with-zod-behind-parsewire-and-a-wrong-shape-fails-loudly.md)).** A mitigation of the "stdout relayed as JSON" row.
- **D2 (Lua harness, [ADR 0066](../adr/0066-the-lua-bridge-is-tested-by-a-harness-under-lua-5-4-and-reaper-api-behaviour-is-checked-in-reaper.md)).** Rows that say "Lua untested" say what the harness covers and what only REAPER can show.
- **D18, D22.** Coverage is a ratchet; every open question below adopts its stated recommendation (ticked). Paths are already post-layout ([ADR 0040](../adr/0040-the-repository-is-laid-out-by-role-and-each-project-is-an-nx-project.md)); the `file:line` citations below were taken on `dc9d01a`, many stacks ago, and each phase re-checks the ones it uses.
- **Phase 6 (Could)** runs only if the Mermaid parser runs in Node without a browser; **Phase 11 (Could)** is skipped and filed as an issue.
- The next free ADR is taken at merge time (`0084` at the S16 tip).

Feature PRD for documentation and docs tooling only; no product behavior changes. Citations are `file:line` on worktree HEAD `dc9d01a` (main, after #46) for anything checked in code; "verified (web)" marks an external fact fetched on 2026-09-20 (URLs under Research Summary); "TBD - needs research" marks anything not verified. This is engineering guidance, not legal advice.

## Problem Statement

Four gaps in how the project documents, protects and licenses itself. (1) ADR 0028 makes links from steady-state docs into deleted PRDs go dead by design, and no automated check exists, while `ci.yml` skips documentation-only pull requests entirely, so a broken link can merge unseen. (2) `SECURITY.md` promises a scope (no silent exfiltration, integrity-checked downloads, safe file handling, a trustworthy pipeline) but no document maps the trust boundaries or says which mitigations exist in code, so the owner cannot tell what is covered. (3) The architecture is spread over prose in five documents with no picture of the moving parts (Wails host, React UI, three Python sidecars, the REAPER Lua bridge, the model cache). (4) The installer will bundle Go, JavaScript and frozen Python dependencies and download models, and there is no third-party notice file and no single table of model licences; the check found two GPL-3.0-or-later Python packages inside a shipped sidecar of an MIT project (Evidence).

## Evidence

Verified in code (HEAD `dc9d01a`):

- **Docs skip CI.** `.github/workflows/ci.yml:3-6` has `pull_request` with `paths-ignore: ['docs/**', '**/*.md']`. `docs/operations/ci-and-releases.md:12-23` records why: a workflow skipped by path filtering leaves a required check pending, so required checks would block docs-only pull requests (verified (web), GitHub workflow syntax docs). `dependency-review.yml` and `codeql.yml` have no path filter and are advisory (`dependency-review.yml:2-15`, `fail-on-severity: high`, action `v5.0.0`).
- **Nothing checks links.** The only link tests are `apps/ui/src/docsGuide.test.ts:92` (relative links inside `docs/guides/using-the-app/` only) and `docScreenshots.test.ts`. The repo has 144 tracked Markdown files (166 under `docs/`) and about 90 distinct `http(s)` URLs. Code comments also cite PRD paths that ADR 0028 will kill: `apps/desktop/app.go:650`, `apps/desktop/tracks.go:11`, `sidecars/manuscript-teleprompter/core/live_asr.py:422`; a Markdown link checker does not see those.
- **Network surface.** `net/http` is used in `apps/desktop/internal/assets/store.go:114` (`http.DefaultClient`, catalog URLs only, size and SHA-256 verified in a `.installing` staging directory before the rename, `store.go:75-107`) and in `apps/desktop/media.go`; the desktop host has no listener (`docs/architecture/codebase-map.md:8-9`). **Found:** `apps/ui/index.html:24-29` loads Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`) on every launch, an outbound request that carries no manuscript content but leaks IP and user agent, fails offline, and is remote CSS with no Content-Security-Policy (no `csp` in `index.html` or `apps/desktop/main.go`). The release-readiness PRD's "0 outbound non-loopback requests at startup" metric is measured with a Go transport test, which cannot see a webview request.
- **Sidecar boundary.** `Supervisor.Start`, `Run` and `StartStream` use `exec.CommandContext` with an argv slice (no shell) and a Windows Job Object (`apps/desktop/internal/process/supervisor.go:38-60`, `stream.go:81-113`); the teleprompter builds argv from UI options (`--chapter`, `--mic`, `--model-dir`, `--wav`, `apps/desktop/internal/teleprompter/service.go:147-165`); stdout lines that are valid JSON are relayed verbatim to the UI (`service.go:onLine`). Whether a value starting with `--` is treated as a flag by the sidecars' argparse is unverified.
- **REAPER bridge.** Go writes `commands/NNNNNNNN.cmd` atomically at mode `0o600` (`apps/desktop/internal/bridge/bridge.go:66-79`); Lua polls and dispatches (`integrations/reaper/narration_ui_bridge.lua:511-520`) and opens paths taken from command fields with `io.open` (`:194` read, `:409` write). The session folder is under REAPER's resource path (`NarrationUtils_Launcher.lua:67`). There is no authentication; it relies on per-user file permissions (whether the folder inherits user-only access is TBD - needs research). Lua has no automated tests (ADR 0031).
- **Untrusted inputs.** DOCX is read with `zip.OpenReader` and only named entries are read into memory with `io.ReadAll` (`apps/desktop/internal/importer/docx.go:18-28,211-216`): no extraction to disk, so no zip-slip, but no size limit either. PDF import is behind the `pdf_candidate` build tag (`importer/pdf.go:1`) and is not in shipped builds. The `/media` route serves only paths that equal a source file of the current project's parsed `.rpp`, re-resolved per request (`apps/desktop/media.go:19-60`, ADR 0012); a hostile `.rpp` can list any local path as an item source, and the route would serve it to the app's own webview only.
- **Second launch.** `onSecondInstance` re-parses launcher arguments including `--*-python` and `--repo-root` (`apps/desktop/app.go:405-433,435-455`), so any same-user process that can start the exe can point a sidecar at another program; no privilege boundary is crossed, but it is a fact for the model.
- **Models and licences.** Catalogs are `config/whisper-assets.json` (5 models: tiny 78 MB, small 486 MB, medium 1.53 GB, large-v3-turbo 1.62 GB, large-v3 3.09 GB, all `MIT`, pinned to Hugging Face commit SHAs, per-file SHA-256) and `tts-assets.json` (1 voice, `en_US-ljspeech-high`, 114 MB). spaCy has no catalog (release PRD Phase 5). `pyproject.toml:5-23` lists runtime and dev tools together (no dev group): `black`, `ruff`, `pytest`, `pyinstaller` are not shipped; `fastapi`, `uvicorn`, `httpx` have no import under `tools/` or `libs/python/` (TBD - confirm before dropping). The frozen `manuscript-guide` sidecar imports `piper.voice` (`sidecars/manuscript-guide/core/manuscript_guide.py:30`) and `phonemizer` (`:453`). **Verified (web):** `piper-tts` 1.8.0 (pinned, `pyproject.toml:15`) is `GPL-3.0-or-later` (homepage `OHF-voice/piper1-gpl`) and `phonemizer` is GPLv3 or later, while `LICENSE` is MIT. `local-dependency-evaluation.md:84` says to keep GPL as a separate process and to get a licence review before distributing a combined GPL program; the released sidecar is one PyInstaller executable that contains both first-party code and these packages (`scripts/release/prepare-resources.py`).
- **No notice file.** No `THIRD_PARTY*` or `NOTICE*` file exists; `LICENSE` is the only one. `local-dependency-evaluation.md:83-101` requires a "future dependency manifest" that does not exist yet.

Assumptions - need validation: that the owner wants the threat model for their own review rather than for outside auditors (stated; the OpenSSF passing tier does not require one, TBD - needs research to confirm); that a solo maintainer will keep a link check green only if the noisy part (external links) is advisory.

## Proposed Solution

Four small deliverables, each independently shippable. A `docs.yml` workflow runs an offline lychee check on every pull request (no path filter, so it also catches a code rename that breaks a doc link, and can be required later without the pending-check problem) plus a weekly online run that is advisory. A STRIDE-lite threat model in `docs/architecture/threat-model.md`, a table not a diagram tool, lines up row by row with `SECURITY.md`. Four Mermaid diagrams (one container view, three sequences) live in the architecture docs that own each flow, rendered by GitHub natively. A notices pipeline generates third-party licences for what the installer ships, a generated model provenance table lists every download, and `dependency-review-action` gets an `allow-licenses` list; the two GPL packages and unclear model licences go to the owner first.

## Key Hypothesis

We believe a gated link check, a mapped threat model, four grounded diagrams and a generated notice and provenance set will let a solo maintainer trust the docs and ship a release whose licence and security claims are checkable. We'll know we're right when a PR that deletes a linked PRD or renames a linked source file fails the offline check, the threat model has a row for each `SECURITY.md` scope bullet, every diagram names real files, and a release asset lists every shipped dependency with its licence.

## What We're NOT Building

- Vale prose linting, a Diataxis restructure, an RFC process, DCO, log4brains, docs ownership metadata, a `CHANGELOG.md` (nx release and generated notes suffice), release runbook or postmortem templates - not approved by the owner.
- OWASP Threat Dragon or pytm - overkill for one maintainer; the model is a reviewed table.
- Structurizr, LikeC4 or Mermaid's experimental C4 diagram types - overkill; plain flowchart and sequence diagrams only.
- REUSE per-file SPDX headers - noisy for a repo this size (owner decision).
- Fixing the ADR README "MADR" wording - done separately by the parent.
- The public docs site, provisioning, installer and signing - owned by the release-readiness PRD; this PRD feeds them criteria (Mermaid rendering, notices placement) and reuses their files.
- A product fix for the Google Fonts request or a Content-Security-Policy - recorded in the threat model and filed as an issue (Open Question 7), not built here.
- Legal advice or a legal position on the GPL packages - the PRD surfaces the question and the options only.

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Dead repo-local links on `main` | 0, and a new one fails the PR | Offline lychee job; demonstrate with a deliberately broken link in the Phase 1 PR |
| Docs-only PR gets a link verdict | 100% of PRs run the job, including docs-only | Workflow has no `paths` filter; one docs-only PR as proof |
| Baseline external link rot | Count recorded once, then tracked weekly | First online run summary |
| Threat model completeness | One row per `SECURITY.md` scope bullet plus the REAPER bridge and `/media` route | Review checklist in Phase 3 |
| Diagram accuracy | Every node and message names a real file, binding or event | Reviewer checks each against code at merge |
| Notices coverage | Every shipped Go, npm and frozen Python package appears with a licence | Generated report diffed against the built installer contents (method TBD in Phase 7) |
| Unknown licences in the shipped set | 0 unexplained; GPL and unclear ones each have an owner decision | Report plus Open Questions 12 and 13 |
| Model table drift | 0 rows differ from the catalogs | `--check` in `pnpm check` |
| New dependency licence gate | A PR adding a non-allowlisted licence fails or warns | Test PR |

## Open Questions

- [x] **1. Where does the link check run?** Options: (a) a dedicated `docs.yml` with `paths: ['docs/**','**/*.md']`; (b) a dedicated `docs.yml` with no path filter; (c) drop `paths-ignore` from `ci.yml`; (d) a job inside `ci.yml` (inherits `paths-ignore`, so it never sees docs PRs: rejected). Recommendation: (b). Offline mode on about 144 files should take seconds (TBD - measure), it also catches a code rename that breaks a doc link (a docs-only filter would miss it), and it avoids the pending-required-check trap in `ci-and-releases.md:12-23`. (c) runs a Windows build for every typo.
- [x] **2. Blocking or advisory?** Options: (a) both advisory (`fail: false`); (b) offline blocking, online advisory; (c) both blocking. Recommendation: (b), landing advisory first and flipping in Phase 2 after the baseline is clean. Repo-local links are deterministic; external links flake. Making the check a required status is an owner-only setting.
- [x] **3. Offline or online, and caching?** Options: (a) offline only; (b) offline on PRs plus online weekly and on demand; (c) online on PRs. Recommendation: (b), with `actions/cache` on `.lycheecache` and `--cache --max-cache-age 1d` for the online run (verified (web), lychee-action README) and a `GITHUB_TOKEN` to avoid GitHub rate limits. Whether `--include-fragments` works in `--offline` mode for heading anchors is TBD - verify in Phase 1 (`docsGuide.test.ts` already checks anchors for the guide).
- [x] **4. Exclusions and coverage.** Options: exclude via `.lycheeignore` and `--exclude-path` (both verified (web)) `localhost` and loopback (`--exclude-loopback`), generated `docs/ui/` for the online run only (its links are repo-local and cheap offline; TBD - confirm the atlas kit checks them), the planned docs site URL and build output directory (TBD until release Phases 10 to 12), and the private-reporting URL in `SECURITY.md:10` (needs login). Code comments citing PRD paths need a separate check: (a) a small Node test that greps `docs/prds/<name>.prd.md` in source files and fails if the file is missing; (b) ignore. Recommendation: exclusions as listed, and (a) as a Should, since ADR 0028 makes those comments dead too.
- [x] **5. Threat model location.** Options: (a) `docs/architecture/threat-model.md` (describes shipped behaviour, matches the folder rule in `docs/prds/README.md` and ADR 0028); (b) root `THREAT_MODEL.md` (visible beside `SECURITY.md`, but the root holds only policy files); (c) a section of `SECURITY.md` (mixes a policy with a long table). Recommendation: (a), linked from `SECURITY.md`. The OpenSSF passing tier does not require a threat model (TBD - needs research to confirm the exact criteria); the value is the owner's.
- [x] **6. Keeping the threat model current.** Options: (a) add a "does this change a trust boundary" line to the `feature-cleanup` skill and the PR template; (b) a date and commit stamp only; (c) a yearly review issue. Recommendation: (a) plus (b); a threat model that nobody revisits is the usual failure.
- [x] **7. Google Fonts and CSP finding.** Options: (a) file a tracking issue; the threat model lists it as a known residual; the fix (self-hosting the fonts, adding a CSP) is separate work; (b) fix it inside this PRD; (c) accept it. Recommendation: (a). It is a product change with visual-suite and licence effects (Barlow Condensed and IBM Plex would enter the notices); note the release PRD's startup metric must then count webview requests.
- [x] **8. Where do diagrams live?** Options: (a) each diagram embedded in the architecture doc that owns the flow, the container view in `codebase-map.md`; (b) one new `diagrams.md`; (c) a new section in `codebase-map.md` for all. Recommendation: (a). A diagram next to its prose is edited with it; `codebase-map.md` is edited by almost every PRD, so keep the addition to one section.
- [x] **9. Diagram freshness.** Options: (a) none, rely on review; (b) a parse check: `@mermaid-js/mermaid-cli` (verified (web): processes Markdown files and needs a headless browser, exit codes undocumented, TBD) or the `mermaid` package's parser in a vitest (TBD - verify it runs in Node); (c) both. Recommendation: (b) in a docs job or `pnpm check` only if the parser runs without a browser, otherwise (a) plus a "diagram touched?" line in `feature-cleanup`. Lychee does not read Mermaid.
- [x] **10. Mermaid on the planned docs site.** Known from search (verified (web), TBD confirm each in the Phase 10 spike): Material for MkDocs supports Mermaid natively, Docusaurus needs `@docusaurus/theme-mermaid`, VitePress needs a community plugin, Starlight has no native support. Recommendation: keep diagrams as fenced `mermaid` blocks (portable) and add "renders the four diagrams" to the release PRD's Phase 10 spike criteria.
- [x] **11. Which Python packages are "shipped"?** `pyproject.toml` mixes runtime and dev tools. Options: (a) a checked-in allowlist next to `prepare-resources.py`, verified by a test against the sidecars' imports; (b) derive from the frozen bundle (PyInstaller collects some `*.dist-info`; TBD - needs research); (c) report the whole environment and exclude a denylist. Recommendation: (b) if the spike proves it, else (a).
- [x] **12. GPL-3.0-or-later packages in the shipped sidecar (owner).** `piper-tts` and `phonemizer` are imported by `manuscript-guide`, which is frozen and released; the project is MIT. Options: (a) get a licence review and comply (ship the GPL text and a source offer; the sidecar may need to be GPL); (b) replace them (an older `piper-tts` may have a different licence, TBD - verify 1.2.0's licence; or inference without the GPL wrapper); (c) ship Piper and phonemizer as a separately downloaded asset run as its own process, per `local-dependency-evaluation.md:84`. Recommendation: (a) first, because it costs a review and a file; decide (b) or (c) only if the review says the MIT release is not possible. Block the stable release on the answer (Open Question 12 of the release PRD is the stable-scope decision; this is a different gate).
- [x] **13. Unclear or restricted model licences (owner).** Candidates: spaCy `en_core_web_sm` 3.8.0 is MIT (verified (web)) but its page names OntoNotes 5, ClearNLP and WordNet 3.0 without their terms, so commercial use of the training data is TBD - needs research; `large-v3-turbo` is a community conversion by `deepdml` (MIT tag verified (web)); Moonshine per-model text is unconfirmed (engines PRD); `en_core_web_lg` is unresearched (release Phase 4). Options: (a) approve only with a recorded check per artifact; (b) mark "unclear" in the table and keep it out of the catalog. Recommendation: (b) until cleared, matching the policy at `local-dependency-evaluation.md:85`.
- [x] **14. `allow-licenses` list and scope.** Options: (a) an SPDX allowlist (MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, 0BSD, CC0-1.0, Python-2.0, plus owner-approved others) with `fail-on-scopes: runtime` to skip dev tools (input exists, verified (web); its default is TBD); (b) `deny-licenses` (deprecated for possible removal, verified (web)); (c) advisory only. Recommendation: (a), advisory like the current job. It gates only dependencies added or changed in a PR and warns without failing when a licence is undetected (verified (web)), so it cannot catch `piper-tts` or `phonemizer`, which are already locked; the inventory does.
- [x] **15. Where do notices ship?** Options: (a) a release asset `THIRD-PARTY-NOTICES.txt` beside the zip plus a copy inside the zip; (b) in-app About or Settings page; (c) embedded in the exe behind a binding. Recommendation: (a) now, (b) later as a link from the release PRD's Manage-local-assets surface (Phase 6); (c) needs a host API bump and buys little. Adding a file to the zip changes `scripts/release/assets.mjs` and `verify-installable.mjs`, which release Phases 8 and 14 also edit.
- [x] **16. Markdown lint (Could).** Options: (a) none; (b) `markdownlint-cli2`, TBD - not verified (rules, config and cost against a repo that mixes list numbering styles, `docs/README.md:26-38`). Recommendation: (a) now; revisit after Phase 2.

## Users & Context

**Primary User**
- **Who**: the solo maintainer and any agent session editing `docs/` or shipping a release.
- **Current behavior**: reviews docs by eye, relies on ADR 0028's manual promotion of PRD content, and has no record of what the installer will contain or which model may be used commercially.
- **Trigger**: a docs PR, a dependency bump, a release promotion, a security report.
- **Success state**: a failing check names the dead link; the threat model answers "is this in scope"; a notice file and provenance table exist per release.

**Secondary Users**: a security reporter reading `SECURITY.md` and the threat model; a contributor reading the diagrams; a narrator who may open the notices.

**Job to Be Done**: When I ship or change the docs, I want mistakes caught by a check and claims about security and licences backed by a document, so I can promote a release without auditing by hand.

**Non-Users**: end users who never open a docs page.

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Phase |
| --- | --- | --- |
| Must | Offline lychee job on every PR, `.lychee.toml`, `.lycheeignore`, current dead links fixed | 1 |
| Must | Threat model with a row per `SECURITY.md` scope bullet plus REAPER bridge and `/media` | 3 |
| Must | Container view and three sequence diagrams grounded in code | 4, 5 |
| Must | Notices generated for shipped Go, npm and frozen Python dependencies | 7 |
| Must | Model provenance table (source, licence, commercial use, checksum) and owner answers on GPL and unclear licences | 8 |
| Should | Offline job blocking and documented; weekly online run; PRD-path grep test | 2, 1 |
| Should | `allow-licenses` on dependency review; notices shipped as a release asset and in the zip | 9, 10 |
| Could | Diagram parse check; `markdownlint-cli2` | 6, 11 |
| Won't | Vale, Diataxis, Structurizr and C4 tools, RFCs, DCO, REUSE headers, CHANGELOG, runbook templates | - |

### MVP Scope

Phases 1, 3, 4, 5, 7 and 8. Phase 2 follows once the baseline is clean; 9 and 10 need the owner's licence answers.

### User Flow

1. A PR deletes `docs/prds/x.prd.md` that an ADR links: `Docs / Links (offline)` fails with the file and line; the author repoints or removes the link.
2. A weekly online run posts a job summary of rotted external links; the maintainer fixes or ignores them.
3. A reporter opens `threat-model.md`, finds the boundary for their report, and sees the current mitigation and residual owner.
4. A release runs the notices script; `THIRD-PARTY-NOTICES.txt` is attached and copied into the zip.

### Draft threat model rows (seed for Phase 3; STRIDE letters, refs are code as of `dc9d01a`)

| Boundary | Threat | Existing mitigation | Residual and owner |
| --- | --- | --- | --- |
| First-use downloads (SECURITY bullets 1, 2) | T/S: tampered or redirected model file | Embedded catalog, pinned revision URLs, size and SHA-256 per file, staging then rename (`store.go:75-134`); sidecars load `local_files_only` from the verified dir (`compare.py:503`, `live_asr.py:546`) | Direct CLI use without `--model-dir` downloads unverified (`compare.py:498-503`); non-atomic replace and temp-dir cache fallback (release PRD Phase 2 and Open Question 3); no `https` scheme check in code (TBD) |
| First-use downloads | D: hostile server sends endless data | Hash gate rejects afterward | No pre-download size cap or disk check (release PRD Phase 2) |
| Webview startup (bullet 1) | I: IP and user agent to Google Fonts; remote CSS | None | Finding (`index.html:24-29`); issue per Question 7 |
| Go to sidecar | E/T: argument or option injection through UI options | argv slice, no shell (`supervisor.go:38`); catalog-checked model ids | `--`-prefixed values unverified (TBD - test); stdout relayed as JSON, UI escaping TBD (no `dangerouslySetInnerHTML` found in `apps/ui/src`) |
| REAPER file bridge (add to `SECURITY.md`) | T/E: another process writes a command; Lua then opens attacker-chosen paths | Files in a per-user folder, `0o600`, atomic write, protocol version, commands removed after read | Same-user trust; no authentication; folder ACL TBD; Lua untested (ADR 0031); owner: maintainer |
| Opening a project or manuscript (bullet 3) | T/D: hostile DOCX, `.rpp`, folder path | Named zip entries only, no extraction; PDF not built; `/media` allowlist (`media.go:53-60`) | No DOCX size cap (`docx.go:26`); `ProjectSwitch` takes any path (`ProjectCreate` now requires an absolute one, `docs/architecture/host-binding-concurrency.md`); a hostile `.rpp` can name any local file for playback |
| Second launch | E: launcher arguments choose sidecar executables | Single-instance lock (`main.go:38`) | Same-user only; accepted |
| Release pipeline (bullet 4) | T/S: malicious dependency or workflow change reaches an installer | Promote never rebuilds; checksums; `production` environment; Dependabot with cooldowns; every action pinned to a commit and `zizmor` blocking; least-privilege permissions and no stored checkout credential; build provenance on every asset, verified by promote ([CI and releases](../operations/ci-and-releases.md#build-provenance)); advisory CodeQL, dependency review, govulncheck and OSV-Scanner | Unsigned; no required checks (owner decision D11); no SBOM (not proposed); provenance shows which workflow built a file, not that its source is benign |
| Data at rest | I: manuscripts, audio, Story Bible readable by other local users | User-profile locations, `0o600` on bridge files | Not encrypted; local-first by design; no telemetry (release PRD) |

### Model and data provenance (seed for Phase 8; the generated table adds file lists and per-file SHA-256)

| Artifact | Source and licence | Commercial use | Status |
| --- | --- | --- | --- |
| Whisper tiny, small, medium, large-v3 (faster-whisper CTranslate2) | `Systran/faster-whisper-*`, MIT, pinned commit | Yes (MIT) | In catalog |
| Whisper large-v3-turbo | `deepdml/faster-whisper-large-v3-turbo-ct2`, MIT tag (verified (web)); converted from OpenAI's model | Yes (MIT); community conversion | In catalog |
| Piper `en_US-ljspeech-high` | `rhasspy/piper-voices` v1.0.0, repo MIT (verified (web)); model card says LJ Speech public domain (verified (web)) | Card is silent on commercial use; public-domain data | In catalog |
| spaCy `en_core_web_sm` 3.8.0 | `explosion/spacy-models`, MIT; wheel SHA-256 `1932429d...` from the release page (verified (web), re-hash before use) | MIT; training data terms TBD - needs research | Not catalogued (release Phase 5) |
| Silero VAD `silero_vad_v6.onnx` | Bundled in the `faster-whisper` wheel, MIT per `local-dependency-evaluation.md:351` | Yes | Ships inside two sidecars (ADR 0022) |
| Moonshine, other Piper voices, `en_core_web_lg` | TBD - needs research | TBD | Planned (engines PRD, release Phase 4) |

## Technical Approach

**Feasibility**: HIGH for Phases 1 to 5, 8, 9; MEDIUM for 7 and 10 (deriving the shipped Python set, and what pip-licenses and go-licenses see for frozen and vendored native code such as PyAV's FFmpeg libraries, TBD - needs research).

**Architecture Notes**
- **Link workflow.** New `.github/workflows/docs.yml`: `on: pull_request` (no filter), `schedule` weekly, `workflow_dispatch`; `permissions: { contents: read }`; job `links-offline` runs `lycheeverse/lychee-action@v2` with `--offline`, config in `.lychee.toml`, inputs `docs/` and `*.md`; job `links-online` (schedule and dispatch only, `fail: false`, cache step). Pin the action the way the repo pins others (a tag or SHA, per Phase 13 of the release PRD). Prefer relative-link checks against the tree and set `--root-dir` only if a root-relative link exists (TBD). Document both jobs in `ci-and-releases.md` under Repository settings, next to the pending-check note; do not edit `ci.yml`.
- **Threat model doc.** One file, sections: scope and how to read, assets, trust boundaries, threat table (STRIDE letter per row), residual risks with owner, and a "last reviewed" stamp; each row cites a file or ADR. `SECURITY.md` links to it and gains a REAPER-bridge bullet if the owner agrees (Open Question 5 residual). Findings become GitHub issues per `docs/operations/github-workflow.md`.
- **Diagrams.** Container view (flowchart): Wails shell with its services, `process.Supervisor`, `assets`, `bridge`, `/media` route; React UI over the typed bindings and events; the three frozen sidecars; the REAPER Lua bridge; local stores (project `narration-utils/`, asset cache under `os.UserCacheDir()`, `%APPDATA%\narration-utils`); external hosts (Hugging Face, Google Fonts). Sequences: (1) first-use download: UI, `WhisperInstall` (`bindings.go:77`), `startWhisperInstall` (`app.go:782`), `assets.Install`, host, `WhisperInstallState` polling, gate reply `asset_required` (`bindings.go:415-417`); (2) live teleprompter: `TeleprompterStart` (`bindings.go:402`), `Service.Start`, `StartStream` (`stream.go:81`), sidecar NDJSON, `onLine`, `emitTeleprompterEvent` (`app.go:331`), `teleprompter:event` and `teleprompter:state`, stop file and 8 s grace (`service.go:24`, ADR 0022); (3) REAPER bridge: launcher spawn with `--session-dir`, `bridge.Send`, Lua `defer` tick, dispatch, `events.log`, `transcriptLoop` (`app.go:349`), `Drain` (`service.go:282`) (ADR 0031). Diagrams state "verified against <files>" in a caption.
- **Notices.** A script under `scripts/licenses/` runs `pnpm licenses list --prod --json` in `apps/ui` (verified (web): `--prod`, `--json`, `--long`), `go-licenses report` (and `save` for texts) in `shell` for the Windows build (verified (web): `report`, `check`, `save`; README calls it not officially supported), and `pip-licenses --format=json --with-license-file --from=mixed` restricted to the shipped set (verified (web); how to point it at the frozen bundle or `uv` environment is TBD - needs research), then merges to one text file with a header naming the release version. Adding the fonts, if self-hosted, and the WebView2 runtime terms (a Microsoft component; TBD) are manual entries.
- **Provenance table.** A `scripts/licenses/models.mjs` generator reads the three catalog files and writes rows between markers in `docs/architecture/model-provenance.md`; `--check` runs in `pnpm check`. Hand-written rows cover uncatalogued artifacts.
- **Dependency review.** Add `allow-licenses` and `fail-on-scopes` to `dependency-review.yml`, keep `fail-on-severity: high`; stays advisory.

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Link check floods with false positives | Medium | Advisory first, ignore file, offline mode for PRs |
| Anchor checks unsupported offline | Medium | Phase 1 verifies; keep `docsGuide.test.ts` for guide anchors |
| Notices miss frozen or vendored native code | Medium | Phase 7 spike diffs the report against the built bundle |
| GPL answer forces a product change | Medium | Surface early (Phase 8); block stable release, not this PRD |
| Threat model rots | High | Review trigger in `feature-cleanup` and the PR template; stamp |
| Collisions on `codebase-map.md`, `ci-and-releases.md`, release files | High | Compatibility table; one small section per PR |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Link check, advisory | `docs.yml` (offline on every PR, weekly online), `.lychee.toml`, `.lycheeignore`, fix dead links, PRD-path grep test | complete | 3, 4, 7, 8 | - | - |
| 2 | Link check blocking | Flip offline job to fail, document in `ci-and-releases.md`, owner may require the check | complete | 3-9 | 1 | - |
| 3 | Threat model | `docs/architecture/threat-model.md`, `SECURITY.md` cross-links, issues for findings (fonts, `--` options) | complete | 1, 4, 7, 8 | - | - |
| 4 | Container view | Flowchart in `codebase-map.md`, caption and conventions | complete | 1, 3, 7, 8 | - | - |
| 5 | Sequence diagrams | First-use download, live teleprompter, REAPER bridge, and (D14) the in-app update, each in its owning doc | complete | 1, 3, 7, 8 | 4 | - |
| 6 | Diagram parse check (Could) | Parser or mermaid-cli check per Open Question 9 | complete | 7-9 | 4, 5 | - |
| 7 | Notices tooling | Spike then `scripts/licenses/` and generated report for the Windows package | complete | 1, 3-6, 8 | - | - |
| 8 | Model provenance and licence answers | Generated `model-provenance.md`; the GPL and unclear-licence questions were answered by D17 and Q13 (b) | complete | 1, 3-7 | - | - |
| 9 | Dependency-review `allow-licenses` | List, scopes, docs | pending | 2, 3-6, 10 | 8 | - |
| 10 | Ship notices | Release asset and zip copy, `assets.mjs` and `verify-installable.mjs`, release-note line | pending | 2, 3-6, 9 | 7, 8 | - |
| 11 | Markdown lint (Could) | `markdownlint-cli2` if the owner wants it | pending | 3-10 | 2 | - |

### Phase Details

**Phase 1 - Link check, advisory.** Goal: a verdict on every PR. Scope: the workflow, config files, fixing links found (expect dead PRD links from steady-state docs), the grep test for `docs/prds/*.prd.md` mentions in source, a documented decision on `docs/ui/`. Success: a deliberately broken link fails the job in the PR (then removed); a docs-only PR runs it; baseline external rot counted.

**Phase 2 - Link check blocking.** Scope: `fail` true on the offline job, a "Docs" section in `ci-and-releases.md` (coordinate with release Phase 13), a note that the owner may add `Docs / links-offline` as a required check safely because it never skips. Success: the doc names the job as it appears in Actions.

**Phase 3 - Threat model.** Scope: expand the seed table, resolve each TBD by reading code or test (whether `--`-prefixed options reach argparse; bridge folder ACL; `https` check; UI escaping of relayed events), open issues, add the review trigger to `feature-cleanup`. Success: a row per `SECURITY.md` bullet, each cell cites a file; the owner signs off residual owners.

**Phase 4 and 5 - Diagrams.** Scope: write, render on GitHub (and in the Browser pane preview), caption with the files verified. Success: each named node or message resolves to code; the three sequences match ADRs 0022 and 0031 and the provisioning rules.

**Phase 6 - Diagram parse check.** Scope: only if a browser-free parser works; otherwise skip and record. Success: a malformed diagram fails a local check.

**Phase 7 - Notices tooling.** Scope: spike to answer Open Question 11 and the vendored-native question, then scripts, generated file, a test that the report is non-empty and names every direct dependency of `apps/desktop/go.mod`, `apps/ui/package.json` (prod) and the shipped Python set. Success: report reviewed against the built Windows package.

**Phase 8 - Provenance and licence answers.** Scope: generator, doc, and a hand-off of Open Questions 12 and 13 to the owner with the evidence above. Success: every catalog entry has a row; the owner has answered or logged a decision to defer.

**Phase 9 - `allow-licenses`.** Scope: the list from Phase 8's answers, `fail-on-scopes`, docs in `github-workflow.md`. Success: a test PR adding a disallowed licence is flagged.

**Phase 10 - Ship notices.** Scope: attach the file as a release asset with its `.sha256` and copy it into the zip; extend the package tests; wait for or coordinate with release Phase 14 if the installer lands first. Success: `pnpm release:verify-assets` covers the file.

**Phase 11 - Markdown lint.** Scope: try, measure noise, adopt or drop. Success: a recorded decision.

### Parallelism Notes

Phases 1, 3, 4, 7 and 8 have no code or file dependency and can run in parallel sessions. 2 needs 1's baseline; 5 reuses 4's conventions; 6 needs diagrams; 9 needs the owner's answers from 8; 10 needs 7 and 8. Phases 3 and 8 produce owner decisions, so schedule them early.

### Parallel-session compatibility

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 1, 2 | new `.github/workflows/docs.yml`, `.lychee.toml`, `.lycheeignore`, `docs/operations/ci-and-releases.md`, a new test under `scripts/` or `apps/ui/src` | Release PRD Phases 11 and 13 (link check for the docs site, `ci-and-releases.md` rewrite): land Phase 1 first and let Phase 11 reuse the config |
| 3 | new `docs/architecture/threat-model.md`, `SECURITY.md`, `.claude/skills/feature-cleanup`, PR template | Low; release PRD Phase 13 links `SECURITY.md` to signing |
| 4, 5 | `docs/architecture/codebase-map.md`, `manuscript-teleprompter.md`, `daw-integration.md`, `first-use-dependency-provisioning.md` | Medium: almost every PRD edits `codebase-map.md` and `docs/README.md`; REAPER automation PRD adds commands, so the sequence stays generic |
| 6 | `apps/ui` or `scripts` test, docs job | Low |
| 7, 10 | new `scripts/licenses/`, `scripts/release/assets.mjs`, `verify-installable.mjs`, release workflow | Release Phases 8 and 14 and REAPER automation Phase 4 edit the same release scripts; keep each check separate |
| 8 | new `docs/architecture/model-provenance.md`, `docs/research/local-dependency-evaluation.md` links, `scripts/quality.mjs` | Release Phase 7 rewrites `local-dependency-evaluation.md`; link to it, do not edit its body |
| 9 | `.github/workflows/dependency-review.yml`, `docs/operations/github-workflow.md` | Release Phase 13 extends the same settings list |

Cross-cutting: no host API bump, no product change; next free ADR is `0039` (`docs/adr/` ends at 0038, `docs/prds/README.md:100`), re-check at merge; a decision on the GPL packages or a blocking docs check may deserve an ADR. Every phase follows `CLAUDE.md`: plan, `change-impact-scan`, `full-verification-gate` (`pnpm check`), `feature-cleanup`; `apps/ui`, Playwright and Lua gates do not apply unless Open Question 7 is taken up. Add this PRD to the index in `docs/prds/README.md` in the first PR.

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Lychee link check in CI (owner decision, 2026-09-20) | Build it | Nothing | ADR 0028 kills links by design; this is the only safeguard |
| STRIDE-lite threat model as a table (owner decision, 2026-09-20) | Build it; no Threat Dragon or pytm | Diagramming tools | One maintainer; OpenSSF passing tier does not require one (TBD confirm) |
| Mermaid diagrams in `docs/architecture/` (owner decision, 2026-09-20) | Flowchart and sequence only | Structurizr, LikeC4, C4 types | GitHub renders Mermaid natively (verified (web)) |
| Licence notices and model provenance (owner decision, 2026-09-20) | Generate notices; provenance table; `allow-licenses`; no REUSE headers | REUSE per-file SPDX | REUSE is noisy here |
| Not building (owner decision, 2026-09-20) | Vale, Diataxis, RFC, DCO, log4brains, docs ownership metadata, CHANGELOG.md, runbook and postmortem templates | - | Not approved |
| Docs skip CI (prior decision, `ci.yml:3-6`, `ci-and-releases.md:12-23`) | Keep; the docs job is separate | Remove `paths-ignore` | Avoids a Windows build per typo; pending-check trap |
| Wiki disabled; docs are generated views (prior decision, ADR 0029) | No second copy | Wiki | Drift |
| No loopback server (prior decision, ADR 0012, ADR 0031) | Threat model relies on it | - | Shapes the boundaries |
| Provisioning rules stay in the first-use doc (prior decision, release PRD) | Threat model links to them | Copy them | Single source |
| Docs job has no path filter (proposed) | Offline job on every PR | Docs-only filter | Catches code renames; safe to require |
| Offline blocking, online advisory (proposed) | See Open Questions 2, 3 | Both blocking | Determinism |
| Threat model in `docs/architecture/threat-model.md` (proposed) | See Open Question 5 | Root file | Folder rule |
| Diagrams beside owning prose (proposed) | See Open Question 8 | One diagrams file | Edited together |
| Notices as release asset plus zip copy (proposed) | See Open Question 15 | In-app | No UI change now |
| GPL packages and unclear licences (superseded by D17, 2026-09-21) | The project is AGPL-3.0-or-later; bundle Piper, `phonemizer`, eSpeak NG; ship the AGPL text and a source offer; unclear model licences stay out of the catalog | Escalate to the owner | The owner relicensed ([ADR 0039](../adr/0039-the-project-is-licensed-agpl-3-or-later.md)) |
| Every open question (D22, 2026-09-21) | The stated recommendation | - | The owner asked for recommendations to be adopted |

## Research Summary

**Market Context**
- lychee-action v2 is the current major (verified (web): https://github.com/lycheeverse/lychee-action); `.lycheeignore` (regex per line), `--cache` with `actions/cache` on `.lycheecache`, `fail` and job-summary inputs documented there. CLI flags `--offline`, `--exclude`, `--exclude-path`, `--include-fragments`, `--exclude-loopback`, `--root-dir` verified at https://lychee.cli.rs/guides/cli/.
- GitHub renders Mermaid in Markdown files natively, flowcharts and sequence diagrams included (verified (web): https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams). mermaid-cli processes Markdown and appears to need a headless browser (https://github.com/mermaid-js/mermaid-cli, exit codes not documented). Docs-site support: https://squidfunk.github.io/mkdocs-material/reference/diagrams/, https://docusaurus.io/docs/next/api/themes/@docusaurus/theme-mermaid, https://github.com/emersonbottero/vitepress-plugin-mermaid, https://github.com/withastro/starlight/discussions/1259 (from search results; not fetched individually).
- `dependency-review-action`: `allow-licenses` uses SPDX ids, `deny-licenses` is deprecated for possible removal, undetected licences inform but do not fail, `fail-on-scopes` exists, latest release v5.0.0 (verified (web): https://github.com/actions/dependency-review-action). `pnpm licenses list` supports `--prod` and `--json` (https://pnpm.io/cli/licenses). go-licenses has `report`, `check`, `save` and is not an officially supported Google product (https://github.com/google/go-licenses). pip-licenses options confirmed by search summary only (https://pypi.org/project/pip-licenses/).
- Licences: https://pypi.org/pypi/piper-tts/1.8.0/json (`GPL-3.0-or-later`), https://pypi.org/pypi/phonemizer/json (GPLv3+), https://huggingface.co/rhasspy/piper-voices (MIT), https://huggingface.co/rhasspy/piper-voices/blob/v1.0.0/en/en_US/ljspeech/high/MODEL_CARD (public domain dataset), https://huggingface.co/deepdml/faster-whisper-large-v3-turbo-ct2 (MIT), https://github.com/explosion/spacy-models/releases/tag/en_core_web_sm-3.8.0 (MIT, data sources named without terms). GitHub path-filter behavior: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions.

**Technical Context**
- Verified in code: the CI path filter, the network call sites, the sidecar launch code, the bridge protocol and Lua `io.open` sites, the DOCX reader, the `/media` allowlist, the catalogs and their licence fields, the frozen `piper` and `phonemizer` imports, the absence of notices and of a Markdown link check, Google Fonts in `index.html`.
- Not verified: offline fragment checks, lychee runtime on this tree, `--`-prefixed option handling in the sidecars, bridge folder ACL, whether `mermaid.parse` runs without a browser, what `pip-licenses` and `go-licenses` see in the frozen bundle and the Wails build (including PyAV's vendored FFmpeg), `en_core_web_sm` wheel hash against PyPI or GitHub, older `piper-tts` licences, OntoNotes commercial terms, the OpenSSF criteria.
- Cross-PRD notes are in the hand-off message: the release PRD's Phase 11 and 13 overlap Phases 1 to 2; its startup metric misses the webview font request; `ci-and-releases.md` has since been updated (Windows gate, no NSIS on the runner) so parts of the release PRD's Phase 13 evidence are stale; the GPL packages meet its "release-ready" claim.

---

*Generated: 2026-09-20*
*Status: DRAFT - needs validation*
