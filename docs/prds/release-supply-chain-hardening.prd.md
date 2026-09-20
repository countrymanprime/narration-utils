# Release Supply-Chain Hardening: Workflow Pinning, Attestations, Rulesets, Vulnerability Scanning and Install-Time Settings

**Source:** the owner's review of the release pipeline's security posture (2026-09-20), six items approved as worth doing; it draws on [ADR 0027](../adr/0027-windows-gates-and-creates-the-release.md) (Windows gates and creates the release; macOS and Linux attach later), [`ci-and-releases.md`](../operations/ci-and-releases.md), [`github-workflow.md`](../operations/github-workflow.md) (owner-only settings), [`SECURITY.md`](../../SECURITY.md) (its "release pipeline" scope bullet) and [`first-use-dependency-provisioning.md`](../architecture/first-use-dependency-provisioning.md). It does not duplicate [`release-readiness-provisioning-and-docs-site.prd.md`](release-readiness-provisioning-and-docs-site.prd.md) (installer, signing, provisioning) or [`docs-security-and-hygiene.prd.md`](docs-security-and-hygiene.prd.md) (link check, threat model, notices, model provenance table); it links to both where they meet.

Feature PRD (CI and security) for workflows, repository settings and their documentation; no product behavior changes and no host API bump. Citations are `file:line` on worktree HEAD `dc9d01a` (main after #46); "live" marks a repository fact read through `gh api` on 2026-09-20; "verified (web)" marks an external fact fetched or searched on 2026-09-20 (URLs under Research Summary); "TBD - needs research" marks anything not verified. Windows code signing is not in this PRD: it stays with the release-readiness PRD (Open Question 11, Phase 15), where the owner owns certificates, costs and secrets, and no agent adds signing steps unasked.

## Problem Statement

A release is an unsigned 400 MB executable built by GitHub Actions and published by the same workflow, and everything that trusts that path is currently trust-by-tag: 33 of 37 external `uses:` references are mutable tags, no workflow sets `persist-credentials: false`, nothing proves a downloaded zip came from this repository's workflow, `main` has no required status check (so "Windows is the gate" is a convention), no scanner looks at Go, npm or Python advisories beyond Dependabot alerts, and install-time settings rely on defaults nobody wrote down. The cost of leaving it: a repointed action tag (the March 2026 trivy-action incident, Evidence) or a poisoned dependency would run inside the job that holds `contents: write` and builds the artifact, and a reporter or narrator has no way to check a release except its `.sha256`, which sits beside the file it protects.

## Evidence

Verified in code (HEAD `dc9d01a`) unless marked:

- **Action pinning.** 37 external `uses:` refs across `.github/workflows/*.yml` and `.github/actions/*/action.yml`; 4 are full-SHA pinned with a version comment (`setup-toolchain/action.yml:37` pnpm/action-setup `# v4`, `:54` setup-uv `# v10.1.0`, `:85` stylua-action `# v4.1.0`; `_quality.yml:115` stylua-action `# v5.0.0`) and 33 are tags: `actions/checkout@v7` x18, `upload-artifact@v7` x3, `download-artifact@v4`, `cache@v4` x3, `setup-node@v4` (`setup-toolchain:40`) and `@v7` (`promote-release.yml:28`), `setup-go@v5`, `setup-python@v5`, `github/codeql-action/{init,analyze}@v4` (`codeql.yml:47,57`), `dependency-review-action@v5.0.0`, `actions/labeler@v7` (`labeler.yml:14`, under `pull_request_target`). Inconsistencies: stylua-action is pinned at two versions (v4.1.0 and v5.0.0; `scripts/toolchain.json` names v4.1.0) and setup-node at two majors. The composite actions are local (`./.github/actions/*`).
- **Permissions and credentials.** Every workflow declares `permissions: { contents: read }` at the top, except `build-linux.yml:17-18` and `build-macos.yml:17-18` (workflow-level `contents: write`, required so the reusable `_attach-platform.yml` can hold it at job level, `:55-56`) and `promote-release.yml:11-12` (workflow-level `contents: write`, single job). `prerelease.yml:63-65` gives the release job `contents: write` and `actions: write`; `codeql.yml:26-29` adds `security-events: write`. There are 18 `actions/checkout` steps and no `persist-credentials` anywhere, so the token stays in `.git/config` for every later step. `promote-release.yml:61` runs `git push origin "$STABLE_TAG"` and needs the persisted credential. Live: the repository default token permission is `read` and `can_approve_pull_request_reviews` is false. `run:` bodies read attacker-influenceable values through `env:` (`promote-release.yml:32-34`, `_attach-platform.yml:26-28`, `build-native/action.yml:24-25,38-39`), which is the safe pattern; a scanner run (Phase 1) confirms it.
- **Release path.** `prerelease.yml:73-97` builds Windows, then `gh release create "$TAG" release-assets/* --prerelease` (`:97`); `:100-104` dispatches `build-macos.yml` and `build-linux.yml`, whose `_attach-platform.yml:71` runs `gh release upload "$TAG" release-assets/* --clobber` some minutes later; `prerelease.yml:82-89` prunes RCs beyond the newest 10 with `gh release delete --cleanup-tag`; `promote-release.yml:46-63` downloads the RC assets, runs `assets.mjs verify` (checksums only, `scripts/release/assets.mjs:83-102`), pushes a stable tag and `gh release create "$STABLE_TAG" prerelease-assets/*` from the same bytes. `ci-and-releases.md:48` documents that a platform build can be re-run "for a promoted release too". There is no provenance or attestation anywhere (`grep attest` finds nothing under `.github`, `scripts`, `docs/operations`).
- **Repository rules (live).** Two active rulesets on the default branch: `Main Protection` (rules `deletion`, `non_fast_forward`, `creation`; admin role and the owner bypass always) and `Pull Request` (squash only, 1 approval, code-owner review, dismiss stale reviews, last-push approval, thread resolution; admin role bypasses via pull request, the owner is exempt). Neither has a `required_status_checks` rule. Force-push and deletion are therefore already blocked; the gap is required checks. `ci-and-releases.md:21-23` says `CODEOWNERS` is "intentionally not a required review", which the live `Pull Request` ruleset contradicts (release PRD Open Question 13). The docs example names `CI / quality / js`; the real check-run names on run 35490013483 are `quality / js`, `quality / go`, `quality / python`, `quality / lua`, `quality / repo-scripts`, `quality / ui-visual`, `quality / ui-atlas`, `quality / ui-atlas-kit`, `ui-dist / build` and `Build (Windows)` (`gh run view --json jobs`). Live: `sha_pinning_required` is false; immutable releases are disabled; secret scanning and push protection are enabled (non-provider patterns and validity checks are disabled); Dependabot security updates are enabled; the `production` environment exists.
- **Pending-check problem.** `ci.yml:3-6` uses `paths-ignore: ['docs/**', '**/*.md']`; `ci-and-releases.md:12-23` records that a required check would stay pending on docs-only pull requests. Verified (web): a workflow skipped by path filtering leaves its checks pending, a job skipped by an `if:` reports success, and a skipped reusable-workflow caller can leave the nested check names unreported (community discussion 72708).
- **Scanning today.** `codeql.yml` (advisory, weekly plus push and PR, `:2`) and `dependency-review.yml` (advisory, `fail-on-severity: high`, `:2,15`) run; Dependabot alerts and security updates are on (`github-workflow.md:87-88`, live). No `govulncheck`, OSV-Scanner or `uv audit` runs. `shell/go.mod` has 3 direct requires (`:5-9`); `pnpm-lock.yaml`, `uv.lock` and `shell/go.sum` are committed.
- **Install-time settings.** `pnpm-workspace.yaml:5-7` sets only `allowBuilds` (esbuild, nx); `package.json:5` pins `pnpm@11.27.0`. Verified (web): pnpm 11 defaults `strictDepBuilds: true`, `blockExoticSubdeps: true` and `minimumReleaseAge: 1440` (minutes, one day), so today's protection is implicit, not written. `dependabot.yml` has five ecosystems, weekly, grouped, and no `cooldown` key; verified (web): since 2026-07-14 Dependabot version updates apply an implicit 3-day cooldown, and security updates bypass it. `pyproject.toml:25-26` has `[tool.uv] package = false` and no `exclude-newer`; CI installs with `pnpm install --frozen-lockfile` and `uv sync --locked` (`setup-toolchain/action.yml:93,97`), so CI installs only what is locked and these settings mostly guard a developer or agent session that runs `pnpm add` or `uv lock`.
- **Model downloads today (Item 6 is mostly done).** `shared/config/whisper-assets.json` pins all five models to 40-hex Hugging Face commit SHAs (`version` and every `url`), with per-file SHA-256 and size; `shared/config/tts-assets.json` pins the Piper voice to the git tag `v1.0.0` (`:9,19,25`, a mutable ref) with per-file SHA-256. `assets.Install` downloads into `<dir>.installing`, verifies size and hash, and renames only on success (`shell/internal/assets/store.go:75-107,125-132`). Gaps: no test asserts the pin shape (40-hex revision, 64-hex hash, `https`); sidecars called without `--model-dir` load `WhisperModel(model_size)` from the Hugging Face hub by name with no pin (`tools/transcript-compare/core/compare.py:503`, `tools/manuscript-teleprompter/core/live_asr.py:546`); spaCy and Moonshine are uncatalogued (release PRD Phases 4, 5; engines PRD). The provenance table and licence answers belong to the docs PRD (Phase 8).

Assumptions - need validation: that the solo maintainer will keep a scanner green only if the first months are advisory; that unsigned releases keep shipping until release Phase 15 (attestations do not change SmartScreen behavior).

## Proposed Solution

Nine small phases, most independently shippable, in three tracks. Workflow track: a `zizmor` job (advisory, then blocking), every `uses:` pinned to a full SHA with a version comment, explicit least-privilege `permissions:` and `persist-credentials: false`, Dependabot keeping pins current with a cooldown. Release track: `actions/attest` build provenance on the RC zip, the exe and the checksum files in `prerelease.yml` and `_attach-platform.yml`, a `gh attestation verify` gate in `promote-release.yml`, and verification instructions in the docs. Repository track: a documented owner checklist (required checks on `main`, the SHA-pinning policy, immutable releases, secret scanning) with a fix for the docs-only pending-check problem, plus a new advisory `security.yml` with `govulncheck` and OSV-Scanner, explicit pnpm and Dependabot install-time settings, and (Could) pinning Piper by commit and a catalog-shape test.

## Key Hypothesis

We believe pinning, attestation and scanning will let a solo maintainer and any narrator check that a release zip was built by this repository's workflow from a pinned toolchain, and let the maintainer trust that a repointed tag or a fresh malicious package cannot silently reach the build job. We'll know we're right when `pinact run --check` and zizmor report zero findings on `main`, `gh attestation verify` passes for every asset of a new RC and promote refuses an unattested one, a required-check ruleset is active without blocking docs-only pull requests, and a seeded known-vulnerable Go module in a test branch is reported by govulncheck or OSV-Scanner within one run.

## What We're NOT Building

- **SLSA Build L3.** Verified (web): GitHub reaches L3 only by moving the build into a shared reusable workflow that isolates the caller; this repo builds in the calling job, one maintainer, one repo. L2 is the target.
- **`step-security/harden-runner`.** Egress blocking is Linux-only and the gate is Windows.
- **EV certificates, cosign on the exe, Sigstore model signing.** Signing is release-readiness Phase 15 (owner-owned); models are already hash-pinned.
- **Renovate.** Dependabot is in place and updates SHA pins with their comments (verified (web)).
- **Required signed commits.** Squash merges are made by GitHub; a solo maintainer gains little and the bypass actors already exist.
- **An SBOM.** Deferred; `anchore/sbom-action` (or `actions/attest` with an SBOM predicate, verified (web) as an input) is the future Could, and the docs PRD's notices file covers licences.
- **`pip-audit` and gating on `uv audit`.** `pip-audit` does not read `uv.lock`; `uv audit` is preview (`--preview-features audit-command`, verified (web)), so it stays an optional local command.
- **A stable-release rehearsal, installer or signing changes** - release-readiness Phases 14 to 16.
- **Changing the RC or promote flow beyond what attestations and (later) immutability need.**

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Tag-pinned external `uses:` | 33 today, 0 at the end; no unpinned ref ever merges | `pinact run --check` and zizmor `unpinned-uses` in CI; `grep` count in the Phase 2 PR |
| zizmor findings on `main` | 0 at regular persona, each suppression justified in `.github/zizmor.yml` | The job; count recorded in the Phase 1 PR |
| `persist-credentials: false` | 17 of 18 checkouts (promote keeps it, with a comment) | zizmor `artipacked` |
| Attested release assets | 100% of assets of every new RC verify | `gh attestation verify` in Phase 5b, plus one manual run on a clean machine |
| Promote of an unattested asset | Refused | Rehearsal on a pre-Phase-5 RC and on a tampered download (documented, not committed) |
| Required checks on `main` | The named set active; docs-only PR merges without bypass | Owner checklist; one docs-only PR as proof |
| Known-vulnerable dependency reported | Within one scheduled or PR run | Seeded test branch per language (Go, npm, Python), not merged |
| Explicit install settings | `minimumReleaseAge`, `strictDepBuilds`, `blockExoticSubdeps` written in `pnpm-workspace.yaml`; `cooldown` on every Dependabot ecosystem | File review, `pnpm install --frozen-lockfile` still green |
| Pin-shape test (Could) | Every catalog file has a 40-hex or tagged-commit revision, 64-hex SHA-256, `https` URL | Go test in `shell/internal/{whisper,tts}` |
| CI time and cost | No PR's critical path grows by more than 2 minutes | Compare `Build (Windows)` and `quality` wall time before and after |

## Open Questions

- [ ] **1. zizmor mode.** Verified (web): `--format=sarif` (the action's default `advanced-security: true`) never exits non-zero, plain format returns exit codes 11 to 14 by severity. Options: (a) SARIF only (advisory, alerts under Code scanning like `codeql.yml`); (b) plain and blocking from day one; (c) advisory first, then blocking. Recommendation: (c), `persona: regular`, flipped in Phase 2 when pinning leaves the baseline clean; `online-audits` on (public repo, `github.token`); pin the zizmor binary through the action's `version:` input (default is `latest`). Whether zizmor flags `pull_request_target` in `labeler.yml:7` (documented safe, `:2-5`) is expected; suppress with a reason.
- [ ] **2. Pinning tooling.** Options: (a) pinact once to convert, zizmor `unpinned-uses` as the ongoing gate; (b) pinact `--check` in CI as well; (c) only the owner-only policy. Recommendation: (a) plus the policy as a backstop (Open Question 4); two CI checkers for one rule is churn. pinact adds `# vX.Y.Z` comments and has `--verify-comment` (verified (web)); whether it skips local `./` refs is TBD.
- [ ] **3. Comment precision.** `setup-toolchain/action.yml:37` says `# v4` while the SHA is a specific release. Options: full tag (`# v4.3.0`) or major only. Recommendation: full tag, so Dependabot's comment update (it only rewrites a comment that ends with the version, verified (web)) and zizmor `ref-version-mismatch` work.
- [ ] **4. SHA-pinning policy (owner).** Verified (web): "Require actions to be pinned to a full-length commit SHA" (changelog 2025-08-15) fails any workflow that uses an unpinned action; live it is off. Options: (a) enable after Phase 2 merges and one Dependabot run passes; (b) never (rely on zizmor). Recommendation: (a). TBD - test on a branch first whether local `./.github/actions/*` and `./.github/workflows/*` refs are exempt (search results conflict) and whether Dependabot's own runs and CodeQL still start.
- [ ] **5. Attestation subjects.** Options: (a) zip only; (b) zip plus the exe inside it; (c) everything in `release-assets/` plus the exe. Recommendation: (c). `gh attestation verify` matches a file's digest, so the exe is verifiable only if attested on its own after extraction; `.sha256` files are two lines and cost nothing; glob `release-assets/*` so the installer (release Phase 14) is covered automatically. `subject-checksums` is an alternative input (verified (web)); TBD - not needed.
- [ ] **6. Attestation placement and failure.** Options: (a) same job as the build and upload, step before `gh release create`, fail closed; (b) a separate job (more isolation, needs an artifact hand-off and re-download). Recommendation: (a): a release without provenance is the thing being prevented, and (b) buys L3-style isolation this PRD does not target. The release job already holds `contents: write`; add `id-token: write`, `attestations: write` and, per the v4 README, `artifact-metadata: write` (verified (web)).
- [ ] **7. Promote verification.** Options: (a) `gh attestation verify --repo` plus the expected signer workflow, mandatory once a cutover RC exists; (b) warn only. Recommendation: (a), in a separate `assets.mjs verify --attestations` path so `release:verify-assets` stays offline; RCs built before the cutover cannot be promoted, which mirrors ADR 0027's precedent for `SHA256SUMS.txt` and costs little because RCs are pruned to 10. TBD - confirm the flag names (`--signer-workflow`, `--source-ref`) against `gh attestation verify --help`, and the signer identity for the reusable `_attach-platform.yml` (it is the job workflow, not `build-macos.yml`).
- [ ] **8. Docs-only pending check (owner-facing).** Options: (a) drop `paths-ignore` from `ci.yml` (every typo runs the Windows build; minutes are free on a public repo, wall clock is not); (b) keep it and require only always-running checks (`docs.yml`, zizmor), which abandons "Windows is the gate"; (c) remove the workflow-level filter, add a cheap `changes` job (`scripts/ci/changed-files.mjs` already exists and is unused) and one `CI / gate` job (`if: always()`, fails on failure or cancel, passes on skipped) that is the only required check; (d) leave it and let the owner bypass on docs PRs. Recommendation: (c), because (a) is the docs PRD's rejected option and a skipped reusable-workflow caller leaves nested names such as `quality / js` unreported; if the maintainer prefers simplicity, (a). Coordinate with the docs PRD Open Question 1, whose `docs.yml` without a path filter is compatible and can be required directly.
- [ ] **9. Which checks to require (owner).** Options: (a) `Build (Windows)` plus `quality / go` and `quality / js`; (b) every `quality / *` plus `Build (Windows)`; (c) (b) plus zizmor and `docs.yml`. Recommendation: (a) at first, (c) after the test-flakiness PRD's phases land, since `ui-visual` and `ui-atlas` have failed intermittently there; CodeQL, dependency review, govulncheck and OSV stay advisory ("add after a few clean runs", `github-workflow.md:90-91`). With Open Question 8 (c), the gate is the single required name.
- [ ] **10. Rulesets versus docs (owner).** Live `Pull Request` requires code-owner review; the docs say it does not (`ci-and-releases.md:21-23`). Options: update the docs; relax the ruleset; keep as is and rely on bypass. Recommendation: owner decision (release PRD Open Question 13); this PRD writes the checklist to match whichever is chosen and keeps admin bypass and unsigned commits.
- [ ] **11. Immutable releases (owner).** Verified (web): once enabled, assets cannot be added, changed or deleted after publish, the tag is protected from deletion and movement (the name cannot be reused), existing releases stay mutable, and drafts stay mutable. Effects here: `_attach-platform.yml:71` (`gh release upload` minutes after publish, and to promoted releases per `ci-and-releases.md:48`) would fail with HTTP 422; `prerelease.yml:88` (`--cleanup-tag`) would leave protected tags, and TBD - whether the release itself can be deleted; `gh release create` with files creates a draft, uploads and publishes (verified (web), gh manual), so the two `create` calls (`prerelease.yml:97`, `promote-release.yml:63`) are fine. Options: (a) enable now and accept losing the late optional macOS and Linux attach; (b) redesign: RC created as a draft that stays a draft until Windows, macOS and Linux assets are all attached, then published (breaks ADR 0027's "optional builds never delay the release", and TBD - whether a draft creates the tag nx needs); (c) defer until a spike on a scratch repository proves a flow, and until after the first stable. Recommendation: (c). It is repository-wide, so it cannot be limited to stable releases; record the result as an ADR that supersedes or amends 0027 if the flow changes.
- [ ] **12. Vulnerability scan gating.** Options: (a) advisory everywhere (SARIF to Security > Code scanning, like `codeql.yml`); (b) OSV PR mode blocking on new vulnerabilities, govulncheck advisory; (c) both blocking. Verified (web): govulncheck-action returns success with `sarif` or `json` output and fails on findings with `text`; OSV-Scanner's PR workflow reports only vulnerabilities new to the pull request, `fail-on-vuln` defaults true, `upload-sarif` defaults true. Recommendation: (a) for the first month, then (b): reachability makes govulncheck the low-noise gate and OSV's PR mode fails only on what the PR adds. Run govulncheck on Windows (the `go` job is Windows-only because Linux native libraries are not installed on PRs; TBD - confirm the action runs on `windows-latest` and set `go-version-input` to the `scripts/toolchain.json` Go, since `shell/go.mod` says `go 1.26.0` while CI uses 1.27.1).
- [ ] **13. Lockfile coverage.** OSV-Scanner supports `pnpm-lock.yaml` and `go.mod` (verified (web), search); `uv.lock` support TBD - confirm with `osv-scanner scan -r .` in Phase 4. If unsupported, options: (a) accept a gap and add `uv audit` as a non-gating step; (b) `uv export` to `requirements.txt` for OSV. Recommendation: (a).
- [ ] **14. pnpm `minimumReleaseAge` value.** Defaults are 1 day (verified (web)). Options: (a) write the defaults out; (b) 3 days (4320), matching Dependabot's default; (c) 7 days. Recommendation: (b), with `minimumReleaseAgeExclude` for an urgent security bump; also consider `trustPolicy: no-downgrade` as a Could (TBD - false-positive rate). Note it affects a session that adds a dependency: `base-ui-primitive-foundation.prd.md` and `boundary-schema-validation.prd.md` each add one and may need the exclude. TBD - whether it applies under `--frozen-lockfile` and to Dependabot's resolution.
- [ ] **15. uv `exclude-newer`.** Verified (web): accepts an RFC 3339 timestamp or a duration such as `3 days` (pyproject `[tool.uv]`, `uv.toml`, CLI). Options: (a) skip: `uv sync --locked` already installs only the lock; (b) `exclude-newer = "3 days"` in `pyproject.toml`. Recommendation: (a) unless a spike shows (b) does not make `uv sync --locked` report an outdated lock (TBD - whether a relative duration is written into `uv.lock`); Dependabot's cooldown covers uv updates.
- [ ] **16. Dependabot cooldown values.** Options: (a) rely on the implicit 3 days; (b) explicit `default-days: 7` everywhere; (c) 7 for `github-actions` and npm, 3 for `gomod` and `uv`. Recommendation: (c), written explicitly so the policy is in the repo; security updates bypass (verified (web)). Whether zizmor has a Dependabot cooldown audit is TBD.
- [ ] **17. Model pinning scope (Could).** Options: (a) repoint Piper from tag `v1.0.0` to its commit SHA (URLs and `version`, hashes unchanged) and add the pin-shape test; (b) also make the CLI-only `WhisperModel(model_size)` path require `--model-dir`; (c) leave (verified integrity already exists). Recommendation: (a); (b) belongs to release Phase 2 and the docs PRD's threat model.
- [ ] **18. OpenSSF Scorecard and Best Practices badge (Could).** Options: (a) skip; (b) `ossf/scorecard-action` with results published and a README badge; (c) also the Best Practices badge. Recommendation: (b) after Phase 2, as a tracking signal only. Scorecard scores Code-Review 0 for a solo project by construction (owner premise); TBD - not researched in this pass.

## Users & Context

**Primary User**
- **Who**: the solo maintainer, and any agent session that edits workflows, adds a dependency or cuts a release.
- **Current behavior**: trusts tags and the `.sha256` beside the asset; reviews Dependabot PRs by reading the diff; merges with `main` unprotected by checks.
- **Trigger**: a Dependabot PR, a new dependency, a prerelease, a promote, an advisory.
- **Success state**: a red check names the unpinned action or the new vulnerability; promote refuses an asset that was not built by the workflow.

**Secondary Users**: a narrator downloading the zip who wants to verify it (`gh attestation verify`); a security reporter reading `SECURITY.md`; the docs PRD's threat model (Release-pipeline row).

**Job to Be Done**: When I publish a release, I want the pipeline to prove what built it and to stop the well-known ways a dependency or action can change under me, so I can promote without auditing every upstream.

**Non-Users**: end users who never open Actions or GitHub.

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Phase |
| --- | --- | --- |
| Must | zizmor job, `.github/zizmor.yml`, permissions audit, `persist-credentials: false` | 1 |
| Must | Every `uses:` pinned to a full SHA with a full-version comment; zizmor blocking; Dependabot keeps them current | 2 |
| Must | `actions/attest` on RC zip, exe and checksum files (Windows) and on macOS and Linux assets | 5a |
| Must | `gh attestation verify` gate in promote, verification instructions in `ci-and-releases.md` and the release notes | 5b |
| Must | Owner checklist for rulesets, required checks, SHA-pinning policy, secret scanning; docs-only pending-check fix | 6 |
| Should | `security.yml` with govulncheck and OSV-Scanner (scheduled, push, PR new-only), advisory | 4 |
| Should | Explicit pnpm settings and Dependabot cooldown | 3 |
| Should | Immutable-release spike and ADR; owner enables only if a flow works | 7 |
| Could | Piper commit pin and pin-shape test; Scorecard workflow and badge; `trustPolicy`; `uv exclude-newer` | 8, 9, 3 |
| Won't | L3, harden-runner, EV, cosign, Renovate, signed commits, SBOM, pip-audit gate, signing | - |

### MVP Scope

Phases 1, 2, 5a, 5b and 6: pinned and scanned workflows, attested and verified releases, a documented rule set. Phases 3 and 4 follow cheaply; 7 waits for the first stable; 8 and 9 are optional.

### User Flow

1. A pull request adds `uses: some/action@v1`: zizmor fails `unpinned-uses` naming the line; the author runs `pinact run` and pushes.
2. A prerelease builds the Windows zip; the attest step records provenance; the release is created; the optional builds attest their assets before uploading.
3. A narrator runs `gh attestation verify narration-utils-windows-x64.zip --repo countrymanprime/narration-utils` and sees the workflow, commit and run.
4. The owner runs Promote: the job downloads the RC assets, verifies checksums and attestations, and only then creates the stable release; an unattested asset stops it.

## Technical Approach

**Feasibility**: HIGH for Phases 1 to 5 and 8; MEDIUM for 6 (owner-only, gate job design) and 7 (immutability semantics not fully verified).

**Architecture Notes**
- **zizmor.** New `.github/workflows/zizmor.yml`: `on: pull_request, push: main, workflow_dispatch`, top-level `permissions: {}`, one job with `security-events: write`, `contents: read`, `actions: read` (the action's documented set, verified (web)); config in `.github/zizmor.yml` with a reason beside every ignore. It covers `dangerous-triggers`, `excessive-permissions`, `artipacked`, `template-injection`, `unpinned-uses`, `ref-version-mismatch` (verified (web), audit list). It is a pull-request check, so it needs no path filter and can be required.
- **Pinning.** One mechanical PR: `pinact run` over `.github/`, review that each comment is the full tag, no behavior change; `_quality.yml` has 11 of the lines, so land it fast (test-flakiness Phase 4 edits the same file). Keep `.github/actions/*` local refs as they are. Update `scripts/toolchain.json`'s stylua `provisioner` string to match and reconcile the two stylua versions (v4.1.0 and v5.0.0) into one, verifying the pinned `version: v2.1.0` still resolves.
- **Permissions.** Move `promote-release.yml` `contents: write` to the job; keep `build-*.yml` workflow-level write with a comment (the caller must grant what the reusable job holds); set `persist-credentials: false` on 17 checkouts and leave `promote-release.yml:25` credentialed with a comment because of `git push` (or replace the push with `gh api` to create the ref and drop the credential). TBD - confirm `nx release version` in `prerelease.yml:43` never pushes; the `version` job checkout (`:27`) can then also drop credentials.
- **Attestation.** In the `release` job (`prerelease.yml`), add `actions/attest@<sha> # v4.x` with `subject-path` covering `release-assets/*` and `shell/build/bin/narration-utils-shell.exe` (TBD - confirm the exe path against `assets.mjs:25-35`), before `gh release create`; job permissions add `id-token: write`, `attestations: write`, `artifact-metadata: write`. In `_attach-platform.yml` add the same at job level, and grant them in `build-macos.yml` and `build-linux.yml`. Attestations live in GitHub and are not release assets, so `assets.mjs verify` and the `prerelease-assets/*` copy in promote are unchanged. Promote must not re-attest: the bytes are unchanged and the RC attestation is keyed by digest. Verified (web): attestations alone give SLSA v1.0 Build L2; they prove which workflow, commit and run produced a file, not that the source is benign, and they do not change SmartScreen or antivirus reactions to an unsigned exe.
- **Verification.** `assets.mjs verify <dir> --attestations` shells out to `gh attestation verify <file> --repo "$GITHUB_REPOSITORY"` (plus the signer flags per Open Question 7) for each present asset, with a mocked `execFileSync` in `assets.test.mjs`; promote passes it, local `pnpm release:verify-assets` does not. Docs: a "Verifying a download" section in `ci-and-releases.md` (needs the GitHub CLI; `gh attestation verify` can also verify offline with a downloaded bundle, TBD) and one line in `scripts/release/generate-notes.mjs` output, TBD - confirm the notes template.
- **Checklist and gate.** Extend the existing owner list in `github-workflow.md:76-91` and the "Repository settings to configure once" section of `ci-and-releases.md:10-28` (do not create a third list) with: required checks by their real names, the `Pull Request` ruleset facts above, SHA-pinning policy, immutable releases (state and why off), secret scanning and push protection (confirmed on live, `github-workflow.md:85`; list the two disabled extras as optional), private vulnerability reporting, Dependabot alerts. For Open Question 8 (c): `ci.yml` drops `paths-ignore`, gains `changes` and `gate` jobs, `quality`, `ui-dist` and `build-windows` get an `if:` on the `changes` output. `codeql.yml` and the new workflows keep their own filters or none.
- **Scanning.** New `.github/workflows/security.yml`: `pull_request` to `main` (OSV PR mode), `push` to `main`, weekly `schedule`, `workflow_dispatch`; jobs `govulncheck` (`golang/govulncheck-action`, `work-dir: shell`, `go-package: ./...`, `output-format: sarif`, Windows runner; upload with `github/codeql-action/upload-sarif`, TBD - whether the action uploads itself) and `osv-scanner` (`google/osv-scanner-action` reusable workflows `osv-scanner-reusable-pr.yml` and `osv-scanner-reusable.yml`, `scan-args` covering `shell/go.mod`, `pnpm-lock.yaml`, `uv.lock`, permissions `actions: read`, `security-events: write`, `contents: read`; `fail-on-vuln: false` while advisory). Results surface under Security > Code scanning and on the PR check; each reusable-workflow ref is SHA pinned like every other.
- **Install-time.** `pnpm-workspace.yaml` gains `minimumReleaseAge`, `strictDepBuilds: true`, `blockExoticSubdeps: true` (exact key names verified against the pnpm 11 release notes; re-check on the installed 11.27.0 with `pnpm config list` in the PR); `dependabot.yml` gains `cooldown:` per ecosystem (`default-days`; per-semver keys TBD). Update `scripts/bootstrap.mjs` messaging only if an install error text changes.
- **Models (Could).** Repoint `tts-assets.json` URLs and `version` from `v1.0.0` to the tag's commit SHA (hashes must not change; resolve it with `git ls-remote` on the Hugging Face repo, TBD), and add a Go test in `shell/internal/{whisper,tts}` that fails on a non-pinned revision, a non-`https` URL or a malformed SHA-256. Provenance table and licence text stay with docs PRD Phase 8; provisioning hardening (staging, disk checks, repair) stays with release Phases 1 to 3.

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Pinned SHA breaks a workflow (wrong tag, moved release) | Low | `pinact` resolves tags; the PR runs the full CI plus a `workflow_dispatch` prerelease dry run on the branch (not published) |
| Attest step fails on a runner or token scope and blocks releases | Medium | Fail-closed by design; the Phase 5a PR proves it on a real RC; `workflow_dispatch` re-run is the retry |
| Reusable-workflow signer identity differs from expectation, so verify gate rejects good assets | Medium | Inspect the first real attestation before hard-coding flags (Phase 5b); keep the check behind a flag until then |
| Immutable releases break the late macOS and Linux attach and RC prune | Certain if enabled today | Off (live) until the spike; explicit in the checklist |
| A required flaky check blocks merges | Medium | Start with the small required set (Open Question 9); admin bypass stays |
| Advisory scanners are ignored | High | Advisory first, flip after a clean baseline; results in Security tab and PR check |
| SHA-pinning policy blocks Dependabot or CodeQL runs | Low to medium | Test on a branch before enabling; policy is one toggle to undo |
| Conflicting edits with four other PRDs in the same workflows | High | Compatibility table; Phase 2 is one mechanical PR landed early |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | zizmor and workflow least privilege | `zizmor.yml` (advisory), `.github/zizmor.yml`, permissions audit, `persist-credentials: false`, findings fixed or justified | pending | 3, 4, 8 | - | - |
| 2 | Pin every action to a SHA | pinact conversion (33 refs), full-version comments, one stylua version, zizmor blocking, docs | pending | 3, 4, 8 | 1 | - |
| 3 | Install-time settings | Explicit pnpm settings, Dependabot `cooldown`, `uv exclude-newer` spike, optional `trustPolicy` | pending | 1, 2, 4, 8 | - | - |
| 4 | Vulnerability scanning | `security.yml`: govulncheck and OSV-Scanner, advisory, seeded-vulnerability proof, lockfile spike | pending | 1-3, 5-8 | - | - |
| 5a | Produce attestations | `actions/attest` in `prerelease.yml`, `_attach-platform.yml`, `build-*.yml` permissions; one real RC verified by hand | pending | 3, 4, 8 | 2 | - |
| 5b | Verify attestations | `assets.mjs verify --attestations`, promote gate, "Verifying a download" docs, release-note line | pending | 3, 4, 6 | 5a | - |
| 6 | Rulesets and required checks | Owner checklist in the two docs, `ci.yml` gate per Open Question 8, owner applies settings and the SHA-pinning policy | pending | 3, 5a, 5b, 8 | 1, 2 | - |
| 7 | Immutable-release spike and decision | Scratch-repo test of RC, attach, prune and promote under immutability; ADR; owner enables or defers | pending | 3, 4, 8 | 5b, first stable | - |
| 8 | Model pin tightening (Could) | Piper commit pin, pin-shape test, threat-model note | pending | 1-7 | - | - |
| 9 | Scorecard (Could) | `scorecard.yml`, badge, recorded baseline | pending | 3-8 | 2, 6 | - |

### Phase Details

**Phase 1 - zizmor and workflow least privilege.** Goal: a machine verdict on every workflow change and a written permission model. Scope: new workflow and config; move `promote-release.yml` write permission to the job; add `persist-credentials: false` to 17 checkouts; justify `labeler.yml` `pull_request_target` and the `build-*.yml` workflow-level write; record the baseline count. Success: job green on the PR; each ignore has a reason; no release behavior changes (run `Prerelease` via `workflow_dispatch` on the branch only if the owner agrees; it publishes).

**Phase 2 - Pin every action.** Goal: no mutable action ref. Scope: pinact over `.github/`, review comments and versions, merge `stylua-action` pins and `toolchain.json`, flip zizmor to blocking, note the convention in `ci-and-releases.md` and `CLAUDE.md`-adjacent docs only if the owner wants. Success: `pinact run --check` reports nothing, zizmor blocking passes, `CI` and `Prerelease`-shaped jobs green, one Dependabot run later proposes a SHA-plus-comment update. Owner then decides Open Question 4.

**Phase 3 - Install-time settings.** Goal: written, reviewable supply-chain defaults. Scope: `pnpm-workspace.yaml`, `dependabot.yml`, a spike on `exclude-newer` against `uv sync --locked`, decision on `trustPolicy`. Success: `pnpm install --frozen-lockfile` and `uv sync --locked` green in CI; settings documented in `ci-and-releases.md`.

**Phase 4 - Vulnerability scanning.** Goal: reachable and lockfile-level advisories in one place. Scope: `security.yml`, `.osv-scanner.toml` only if needed, a seeded vulnerable module on a throwaway branch per language, a note in `github-workflow.md` saying where to look and that both are advisory. Success: a finding appears under Code scanning for the seeded Go module; the `uv.lock` support question is answered.

**Phase 5a - Produce attestations.** Goal: every release asset has provenance. Scope: workflow edits above; one RC produced and verified by hand with `gh attestation verify`, recording the signer identity for each platform workflow. Success: Windows, macOS and Linux assets verify; a modified copy fails.

**Phase 5b - Verify attestations.** Goal: promote refuses what the workflow did not build. Scope: `assets.mjs` flag and tests, promote step, docs section, release-notes line, cutover note. Success: promote of an attested RC passes; of an unattested or tampered one fails (rehearsed, described in the PR).

**Phase 6 - Rulesets and required checks.** Goal: the merge gate the docs describe exists. Scope: checklist text, the `ci.yml` change per Open Question 8, a docs-only pull request as proof, the owner's settings changes (required checks, SHA-pinning policy, secret scanning extras). Agents do not change settings. Success: the doc lists check names that exist in `gh run view --json jobs`.

**Phase 7 - Immutable-release spike.** Goal: know whether, and how, immutability can be on. Scope: on a scratch repository (owner-created), mirror `prerelease.yml`, `_attach-platform.yml` and promote; test late upload, prune, `gh release create` with files, and whether a draft creates the tag; write the result and an ADR if the flow changes. Success: a written go or no-go.

**Phases 8 and 9.** Small, optional, each one PR; success signals are the pin-shape test failing on a bad fixture, and a Scorecard result recorded in the docs.

### Parallelism Notes

Phases 1, 3, 4 and 8 touch different files and can run in parallel. Phase 2 follows 1 (zizmor finds the baseline) and should merge before other PRs add `uses:` lines. 5a needs 2 (attest is pinned like everything else); 5b needs 5a and one real RC. 6 needs job names to be stable (1, 2 and the docs PRD's `docs.yml`) and is mostly the owner's clicks. 7 waits for the first stable and 5b.

### Parallel-session compatibility

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 1 | new `.github/workflows/zizmor.yml`, `.github/zizmor.yml`, every workflow's `permissions:` and `checkout` steps | Medium: test-flakiness Phase 4 (`_quality.yml` `go` job) and docs PRD Phase 1 (new `docs.yml`, which should set the same permissions) |
| 2 | every `uses:` line in `.github/**`, `scripts/toolchain.json` | **High**: `_quality.yml` (11 lines) with test-flakiness Phases 4 and 6 and `verification-and-code-health-tooling.prd.md` Phases 2, 3, 7 and 11 (they also edit `setup-toolchain` and `scripts/toolchain.json`; any action they add must arrive SHA pinned), `dependency-review.yml` with docs PRD Phase 9, `build-native` composite with release Phases 8 and 14; release Phase 13 also lists "action pin alignment", which this phase completes |
| 3 | `pnpm-workspace.yaml`, `.github/dependabot.yml`, maybe `pyproject.toml` | Low; PRDs adding dependencies (base-ui, boundary-schema) must respect the release-age window |
| 4 | new `.github/workflows/security.yml`, `.osv-scanner.toml`, `github-workflow.md` | Low; release Phase 13 also edits `github-workflow.md` |
| 5a | `prerelease.yml` release job, `_attach-platform.yml`, `build-macos.yml`, `build-linux.yml` | **High**: release Phase 14 (installer changes the asset set), Phase 15 (signing must precede attest), Phase 8 (smoke test step in `build-native`) |
| 5b | `scripts/release/assets.mjs` and test, `promote-release.yml`, `ci-and-releases.md`, `generate-notes.mjs` | Medium: release Phases 8 and 14 and REAPER automation Phase 4 also edit `assets.mjs`/`verify-installable.mjs` |
| 6 | `ci.yml`, `ci-and-releases.md`, `github-workflow.md` | **High**: release Phase 13 rewrites both docs; docs PRD Phase 2 adds a Docs section |
| 7 | docs, `docs/adr/`, later workflows | Low; ADR number checked at merge (0037 when written) |
| 8 | `shared/config/tts-assets.json`, `shell/internal/{whisper,tts}/*_test.go` | Low; release Phases 2, 3 and 5 touch `shell/internal/assets` and catalogs |
| 9 | new `scorecard.yml`, `README.md` | Low |

Sequencing: land Phase 2 early and alone; ask test-flakiness, docs and release sessions to rebase after it. Release Phase 15 (signing) must sign before Phase 5a's attest step, and Phase 14's installer joins the glob without changes. Cross-cutting: no host API bump; next free ADR is 0037 (`docs/adr/` ends at 0036), re-check at merge; ADR 0027 needs an amendment or superseding ADR only if Phase 7 changes the attach flow; every phase follows `CLAUDE.md` (plan, `change-impact-scan` over the workflows' consumers, `full-verification-gate`, `feature-cleanup`); `shared/ui`, Playwright and Lua gates do not apply. Add this PRD to `docs/prds/README.md`'s index in the first PR.

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Workflow hardening: zizmor, full-SHA pins, least privilege (owner decision, 2026-09-20) | Build it | Nothing | Tag repointing is real (Evidence, March 2026) |
| Artifact attestations at SLSA Build L2 with `actions/attest` (owner decision, 2026-09-20) | Build it; verify in promote | Checksums only | Checksums sit beside the file they protect |
| Ruleset and immutable-releases checklist, owner-applied (owner decision, 2026-09-20) | Deliver as docs and a gate fix | Agents change settings | Owner-only settings |
| govulncheck and OSV-Scanner, not pip-audit (owner decision, 2026-09-20) | Build advisory | `pip-audit`, gating on `uv audit` | `pip-audit` does not read `uv.lock`; `uv audit` is preview |
| Install-time settings and Dependabot cooldown (owner decision, 2026-09-20) | Write them down | Rely on defaults | Defaults can change silently |
| Model-download tightening as a Could (owner decision, 2026-09-20) | Piper pin and test only | Rework provisioning | Integrity already exists; rest is release PRD |
| Not building (owner decision, 2026-09-20) | L3, harden-runner, EV, cosign, Renovate, signed commits, Sigstore model signing, SBOM, signing steps | - | Reasons under What We're NOT Building |
| Windows gates the release; macOS and Linux attach later (prior decision, ADR 0027) | Keep; attest each platform's asset where it is built | Move all builds into one run | Immutability may force a revisit (Open Question 11) |
| Promote never rebuilds (prior decision, `promote-release.yml:50`) | Keep; verify, do not re-attest | Rebuild | Same bytes, same attestation |
| `production` environment gates promote (prior decision, `ci-and-releases.md:25-28`) | Keep | - | Owner-approved |
| CodeQL and dependency review advisory (prior decision, `github-workflow.md:90-91`) | New scanners mirror them | Blocking | Add to required only after clean runs |
| Windows code signing (prior decision, release PRD Open Question 11) | Out of scope; sign before attest when it lands | Add signing here | Owner owns certificates and secrets |
| Nothing merges without the owner (prior decision) | Owner merges every PR and applies settings | Auto-merge | Standing rule |
| Attest zip, exe and checksum files (proposed) | Open Question 5 (c) | Zip only | Verifiable after extraction |
| zizmor advisory then blocking; pinact once (proposed) | Open Questions 1, 2 | Both checkers in CI | One gate per rule |
| Required checks via one `CI / gate` job (proposed) | Open Question 8 (c) | Drop `paths-ignore`; bypass | Avoids pending and nested-skip traps |
| Immutable releases deferred to a spike (proposed) | Open Question 11 (c) | Enable now | Breaks late attach and prune |
| Scanners advisory first, OSV PR mode then blocking (proposed) | Open Question 12 | Blocking now | Baseline noise |
| pnpm 3-day age, cooldown 7/7/3/3 (proposed) | Open Questions 14, 16 | Defaults | Matches Dependabot's default window |

## Research Summary

**Market Context**
- Tag repointing: on 2026-03-19 76 of 77 `aquasecurity/trivy-action` tags and all `setup-trivy` tags were force-pushed to credential-stealing code (verified (web)): https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23, https://www.wiz.io/blog/trivy-compromised-teampcp-supply-chain-attack.
- SHA pinning policy (2025-08-15): https://github.blog/changelog/2025-08-15-github-actions-policy-now-supports-blocking-and-sha-pinning-actions/. Dependabot updates SHA pins and their comments: https://github.blog/changelog/2022-10-31-dependabot-now-updates-comments-in-github-actions-workflows-referencing-action-versions/. Default 3-day cooldown: https://github.blog/changelog/2026-07-14-dependabot-version-updates-introduce-default-package-cooldown/. pinact: https://github.com/suzuki-shunsuke/pinact.
- zizmor: https://docs.zizmor.sh/usage/, https://docs.zizmor.sh/audits/, https://github.com/zizmorcore/zizmor-action (v0.6.4 shown; pin by SHA).
- Attestations: https://github.com/actions/attest (v4; consolidates `attest-build-provenance` and `attest-sbom`), https://docs.github.com/en/actions/concepts/security/artifact-attestations (Build L2 alone), https://docs.github.com/actions/security-guides/using-artifact-attestations-and-reusable-workflows-to-achieve-slsa-v1-build-level-3 (L3 needs reusable workflows). Free for public repositories.
- Immutable releases GA 2025-10-28: https://github.blog/changelog/2025-10-28-immutable-releases-are-now-generally-available/; `gh release create` with files as draft, upload, publish: https://cli.github.com/manual/gh_release_create.
- Scanners: https://github.com/golang/govulncheck-action, https://google.github.io/osv-scanner/github-action/ (v2.6.0 shown), https://github.com/google/osv-scanner, https://astral.sh/blog/uv-audit. Required checks and skipped jobs: https://docs.github.com/repositories/configuring-branches-and-merges-in-your-repository/defining-the-mergeability-of-pull-requests/troubleshooting-required-status-checks, https://github.com/orgs/community/discussions/72708.
- Install-time: pnpm 11 defaults https://github.com/pnpm/pnpm/releases/tag/v11.0.0, https://pnpm.io/supply-chain-security; uv https://docs.astral.sh/uv/reference/settings/#exclude-newer.

**Technical Context**
- Verified in code and live (`gh api`, 2026-09-20): the 37 refs and their pins, permissions and checkout steps, the release, attach, prune and promote commands, both rulesets, check-run names, repository security settings, catalog pins and the staging-and-verify installer.
- Not verified: the `gh attestation verify` flag set and reusable-workflow signer identity; SLSA wording beyond a search summary of the GitHub docs (the fetched page did not state a level); `uv.lock` in OSV-Scanner; govulncheck-action on `windows-latest` and whether it uploads SARIF itself; whether the SHA-pinning policy exempts local actions and how it interacts with Dependabot and CodeQL; `exclude-newer` durations in `uv.lock`; whether `minimumReleaseAge` applies to frozen installs or Dependabot; immutable-release deletion and prune behavior, and whether a draft creates the tag nx needs; the `actions/attest` release date; whether zizmor audits Dependabot cooldown; Scorecard details; Windows behavior of `gh attestation verify` offline bundles.
- Cross-PRD notes: release Phase 13's "action pin alignment" is completed here; its `_build-native.yml` references are stale (the build is the composite `.github/actions/build-native`); the docs PRD's threat-model row "actions pinned by tag; no SBOM or attestation" changes when Phases 2 and 5 land (SBOM stays absent); base-ui and boundary-schema PRDs add dependencies and meet the release-age window; the verification-and-code-health PRD (untracked at writing) adds golangci-lint with gosec to the `go` job and drops Black from `pyproject.toml` and `uv.lock`, which touches the same files as Phases 2 and 3 and overlaps CodeQL's Go coverage but not govulncheck.

---

*Generated: 2026-09-20*
*Status: DRAFT - needs validation*
