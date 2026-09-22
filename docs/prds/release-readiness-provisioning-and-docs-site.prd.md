# Release Readiness: Provisioning, Docs Site and Release Pipeline

**Supersedes:** `docs/architecture/component-showcase-and-docs-site.md` (planned-work brief, removed when this PRD landed; recoverable with `git show d5cc994:docs/architecture/component-showcase-and-docs-site.md`; its Storybook half shipped under ADR 0023 and its remaining plan is Phases 9 to 12 here) and the "Delivery slices" plan of [`docs/architecture/first-use-dependency-provisioning.md`](../architecture/first-use-dependency-provisioning.md).

**Source:** the normative provisioning rules (catalog fields, install and verify semantics, no silent fallback, opt-in updates, cache and removal rules, acceptance criteria) stay in `first-use-dependency-provisioning.md`, which other docs and `SECURITY.md` cite as the rules; the checklist under "Provisioning rules" below restates them so each phase can be checked against them.

The roadmap's "release-readiness work item" (first-use dependency provisioning before distributing compiled GitHub releases), plus the planned component showcase and public documentation site, plus pipeline gaps found while verifying the release path. Citations are `file:line` on worktree HEAD `d5cc994` (current `origin/main`) for anything checked in code; "per docs" marks a claim taken from a document and not verified; "per GitHub" marks a read-only `gh` query run on 2026-09-19. The PRD was first written at `b9d348d`; main has since merged #35 to #42 (Teleprompter integration plan; the guide split into `docs/guides/using-the-app/*.md`; issue forms, labels-as-code and milestone sync; `docs/operations/github-workflow.md`; CodeQL, dependency review, `SECURITY.md` and `CONTRIBUTING.md`; two dependency bumps). Only workflow, `docs/operations`, `README.md` and `apps/desktop/go.{mod,sum}` changed under the paths this PRD cites, so every `file:line` below still holds; the release and CI claims were re-read and updated where main changed them.

## Problem Statement

The project already publishes pre-release builds to GitHub, but a non-developer narrator cannot rely on them: optional assets are only half provisioned (Piper voices and Whisper models are managed, spaCy for Story Bible is not, so Story Bible runs in its lower-quality rules-only mode unless a developer installed a model by hand), there is no place to see or repair downloaded assets, the Windows download is a bare executable with no installer, nothing is signed, and the docs that describe the pipeline no longer match it. The component library and docs are also invisible outside the repository. Until this is done the roadmap's release-readiness item stays open and no stable release can honestly be promoted.

## Evidence

Verified in code (HEAD `d5cc994`) unless marked:

**Provisioning: what exists**
- Shared asset lifecycle: `State`, `Install` (stage in `<dir>.installing`, verify size and SHA-256, atomic rename), `Remove` in `apps/desktop/internal/assets/store.go:35-46,75-107,138-140`; Piper (`apps/desktop/internal/tts/catalog.go`) and Whisper (`apps/desktop/internal/whisper/catalog.go`) catalogs sit on it. Catalog files: `config/tts-assets.json` (1 voice, 114 MB) and `config/whisper-assets.json` (5 models, 78 MB to 3.09 GB). Cache root is `os.UserCacheDir()/narration-utils/assets/{tts,whisper}` (`apps/desktop/app.go:149-167`). First-use gates return `asset_required` for Piper preview, Transcript Compare and the Teleprompter (`bindings.go:169,387,417`). Tests: 5 in `assets/store_test.go` (absent, verify-before-activate, no partial on hash mismatch, idempotent, path scoping).
- Bootstrap does not download optional assets (`scripts/bootstrap.mjs:191,243`; `README.md:80-83`).

**Provisioning: gaps (each verified)**
- **Story Bible spaCy is not provisioned, so builds fall back to rules-only unless a model was installed by hand.** No spaCy model is in the lock or dependencies (`pyproject.toml:21` has `spacy>=3.7` only; no `en_core_web_*` in `uv.lock`); the sidecar catches the load failure and uses rules-only extraction (`sidecars/manuscript-guide/core/manuscript_guide.py:375-381`). The choices are a hard-coded list (`apps/desktop/app.go:676`), the default is `en_core_web_sm` (`config/defaults.json:6`), `guide.Service.Build` passes the model name straight to the sidecar (`apps/desktop/internal/guide/service.go:155-156`), and `startGuideBuild` has no asset gate (`apps/desktop/app.go:838-880`). There is no spaCy catalog file. `scripts/bootstrap.mjs:243` tells developers a "first-use flow" exists for spaCy; it does not. The first-use doc's "current installed-only filter" no longer exists either (choices are hard-coded, not filtered).
- **Install jobs report no real progress, and the Piper path is broken in the desktop app.** Jobs carry only `id`, item, `phase`, `message` (`apps/desktop/app.go:56-65,777-781,832-836`); `assets.Install` streams with `io.Copy` and no callback (`store.go:126`). The Go host sets `phase: "running"` for both (`app.go:735,790`). The UI's Piper contract instead expects `phase: 'downloading'`, `percent` and `error` (`apps/ui/src/api/contracts/tts.ts:26-33`) and only polls, cancels and shows the progress bar while `phase === 'downloading'` (`components/storybible/GuideDetail.tsx:153-176,769-783`). With the real host the first poll loop never runs, the result is not `success`, and the user gets a toast with the "Downloading..." message while the dialog stays at "Download voice" (found by reading; not run against the desktop app, confirm in Phase 1). The mock returns `success` immediately (`api/mockApi.ts:520-524`), so unit tests and the visual suite cannot see it. Whisper is consistent (`'running'`, `contracts/whisper.ts:22-27`, `Transcript.tsx:171-192`) but also has no percent, so ADR 0015 (real progress only) is not met.
- **State is recomputed by hashing.** `State` verifies every file's SHA-256 (`store.go:48-69`), and `Catalog()` calls it per model (`whisper/catalog.go:57`), as does `Dir()` before every use (`catalog.go:74-83`) and each `asset_required` reply. For an installed `large-v3` (3.09 GB) that is a full read on each catalog fetch and each transcription start.
- **Manifest is thin.** It records only provider, id and version (`store.go:91`); the doc requires exact version and provenance, and hash for repair and diagnostics.
- **Only three states, no manage surface.** TypeScript states are `installed | not_installed | verification_failed` (`contracts/whisper.ts:1`, `tts.ts:1`); `downloading` and `update available` from the doc do not exist. Settings shows only the currently selected model or voice with a "Remove" button when installed (`components/settings/Settings.tsx:136-137,247-300`). There is no list of every catalog item, no size total, no verify or repair action, no cache-path display.
- **Missing test coverage the doc requires**: cancellation, offline, interrupted, disk-full, no-download-at-startup, and a packaged-release smoke test. `scripts/release/verify-installable.mjs` only checks that files exist (`:8-27`); nothing launches a built app in CI.
- **The first-use dialog is thinner than the rules.** It shows name, size, publisher, license link, model card and provenance links, and the prose "stored in your per-user asset cache" (`GuideDetail.tsx:768-815`, `Transcript.tsx:470-500`, `TeleprompterPage.tsx:80-95`). The version is in the payload (`previewVoice`, `previewModel`, `app.go:614-628`) but not shown; the source URL, the actual install path and the local disk requirement are absent. The first-use brief lists version, disk requirement and destination, and `local-dependency-evaluation.md:15-19` requires the source URL and install location to be visible.
- **Cache root can silently move to the temp directory.** If `os.UserCacheDir()` fails, `cacheBase` falls back to `os.TempDir()` (`app.go:149-151`), which breaks the "per-user application-data cache" rule and can lose a multi-GB download to temp cleanup.
- **Replacing a non-installed target is remove-then-rename, not atomic.** `Install` calls `os.RemoveAll(target)` and then `os.Rename(staging, target)` (`store.go:99-103`); a crash between them leaves neither. Only reached when a corrupt or partial target exists, so a Repair path should rename aside first.
- **`local-dependency-evaluation.md:15-22` is stale** for releases: it says "Setup may download" into a gitignored cache and "Downloading at setup time"; nothing downloads at setup any more (`bootstrap.mjs:191`). Phase 7 rewrites it.
- **Host API version** is in three places, all `5` (`apps/desktop/app.go:33`, `apps/desktop/app_test.go:40`, `apps/ui/src/hostApi.ts:2`); the next free ADR number is whatever is free at merge time (0027 at `d5cc994`); new bindings snapshot pointers under `h.mu.RLock` (the `h.services()` pattern of `docs/architecture/host-binding-concurrency.md`, which also notes `configureLocked` rebuilds the TTS manager on every project attach, and the Whisper manager is rebuilt too, `app.go:161-167`).

**Release pipeline** (per GitHub, 2026-09-19 unless marked)
- The repo is public (MIT at the time of writing; AGPL-3.0-or-later since [ADR 0039](../adr/0039-the-project-is-licensed-agpl-3-0-or-later.md), owner decision D17: bundling Piper, phonemizer and eSpeak NG is fine, and model and voice licences are still checked per artifact). Releases are pre-release RCs only (`v0.2.0-rc` to `v0.2.6-rc`); no stable release exists. The latest RC's assets are `narration-utils-shell.exe` (421 MB), `narration-utils-shell-macos-arm64.zip` (116 MB), `narration-utils-shell-linux-x64.tar.gz` (234 MB) and `SHA256SUMS.txt`.
- The Windows matrix entry passes `-nsis` (`.github/workflows/_build-native.yml:22`), and `apps/desktop/build/windows/` in git holds only `icon.ico`: no NSIS installer definition is checked in, and the published Windows asset is a bare executable (per GitHub). Verified in the Wails v2.16.0 module (`apps/desktop/go.mod:7`): `wails build -nsis` with no local definition uses the embedded default `project.nsi`, which runs the WebView2 runtime macro (`project.nsi:93`) and creates a Start Menu shortcut and a Desktop shortcut (`project.nsi:99-100`), and it only prints a warning and skips the installer when `makensis` is not found (`pkg/commands/build/nsis_installer.go:53-55`). Still unverified: whether the CI runner has `makensis` on its PATH, and whether any release ever contained an installer. `README.md:80` says the build "does not build installers". `docs/architecture/standalone-launch.md` (kept; now marked Implemented for the launch path and project picker) still plans the packaging in its section 3: an installer that registers a Start Menu entry and optionally a desktop shortcut. None of that is delivered as a release asset yet. WebView2 is not mentioned anywhere in docs or scripts (only in ADR 0012).
- Nothing is signed: artifacts are literally named `unsigned-rc-*` (`prerelease.yml:61,79,99`); no signing step exists in any workflow; `docs/operations/ci-and-releases.md` does not list signing as pending.
- Tag scheme is `v<version>-rc` (`prerelease.yml`, `promote-release.yml`, per GitHub). `ci-and-releases.md` says `-beta.N`.
- `ci-and-releases.md` names required checks `CI / Conventional Commit title`, `CI / Linux quality`, `CI / Format and lint`, and describes changed-file classification, scheduled runs, four-platform bootstrap and installer matrices and draft-PR skipping. The workflows have none of these: `ci.yml` has jobs `quality` and `build`, `paths-ignore` for docs, no schedule, no draft condition, a three-entry native matrix (`windows-x64`, `macos-arm64`, `linux-x64`), and no job validates PR titles (commitlint runs only in the local hook). `scripts/ci/changed-files.mjs` and its test are referenced by no workflow.
- Live repository rulesets (per GitHub): `Main Protection` (deletion, non-fast-forward, creation) and `Pull Request` (squash only, one approving review, code-owner review, last-push approval, thread resolution); no required status checks. `ci-and-releases.md` says code-owner review is "intentionally not a required review" and lists required checks. The `production` environment exists. Re-queried on 2026-09-19 after #37 to #42: unchanged, and `has_wiki` is false.
- Main added workflows and files that `ci-and-releases.md` does not describe (it only gained a link to the new tracking doc): advisory `codeql.yml` (push, PR and weekly; Go, JavaScript/TypeScript, Python) and `dependency-review.yml`, plus `labeler.yml`, `sync-labels.yml`, `sync-milestones.yml` and a `github-scripts` job in `_quality.yml` that tests `scripts/github/*.test.mjs`. `docs/operations/github-workflow.md` now records the owner-only repository settings (wiki disabled, squash-only, secret scanning, private vulnerability reporting, Dependabot) and says `codeql.yml` and `dependency-review.yml` are deliberately not required checks; its `Main Protection` row only says "see CI and releases". `SECURITY.md` and `CONTRIBUTING.md` exist; `SECURITY.md` puts unverified model or binary downloads (citing the first-use brief) and a checksum or installer that does not match the reviewed build in scope, and promises fixes only for the latest release or RC.
- Action versions differ across workflows (`actions/checkout@v7` and `@v4` (the `lua` job), `setup-node@v7` and `@v4`, two different pinned `pnpm/action-setup` SHAs; the new workflows use `checkout@v7`, `labeler@v7`, `codeql-action@v4` and `dependency-review-action@v5.0.0`), so `_quality.yml`, `prerelease.yml` and `.github/actions/setup-toolchain/action.yml` are not consistently pinned (whether each version exists is unverified).

**Component showcase and docs site**
- Storybook is implemented per ADR 0023 (`docs/adr/0023-visual-suite-capture-contract-and-storybook.md`): one `*.stories.tsx` per primitive (14 primitives, 119 stories per the kit ledger), `apps/ui/.storybook/main.ts`, scripts `storybook`, `build-storybook`, `atlas` (`apps/ui/package.json:18-20`), and CI job `ui-atlas` (`_quality.yml`, after `ui-visual`) that builds and captures but only uploads screenshots. Nothing publishes `storybook-static/`, which is gitignored. GitHub Pages is not enabled (`gh api .../pages` returns 404).
- `docs/ui/` (106 KB) is generated by `ui-atlas docs` (14 component pages, an index and `inventory.json`); `docs/images/ui/` is 2.0 MB of curated WebP screenshots (ADR 0011). The kit skill `ui-atlas-ci` step 7 documents GitHub Pages (`actions/upload-pages-artifact`, `deploy-pages`, `pages: write`, `id-token: write`) and says to ask the user first because settings and secrets are theirs to create (`tools/ui-atlas-kit/plugin/skills/ui-atlas-ci/SKILL.md:52-56`).
- `docs/operations/github-workflow.md:14` says the wiki is disabled on purpose because it is an unreviewed second copy that drifts, that `docs/` is "not mirrored anywhere", and that "a published docs site is a separate, planned item" (it linked the retired `component-showcase-and-docs-site.md` for that; the docs-replacement change that removes the brief repoints that link, and ADR 0003's aside that cited the same brief, to this PRD's Phases 9 to 12). A public site is therefore only acceptable as a generated view of `docs/`, never a hand-kept copy (the wiki is disabled for exactly that reason).
- The internal docs are written for contributors and agents; `docs/README.md` states the folder "records planned work ... not a claim that the described utilities already exist". The root `README.md` still describes two tools and a per-tool `daws/` layout and does not mention Tracks, the Teleprompter or the component atlas.

**ADR number check (asked for):** the Storybook and visual-suite decision is ADR **0023** in `docs/adr/`, `docs/adr/README.md`, `docs/design/design-system.md:17` and the kit skills (the retired showcase brief cited it too). The retired UI-defects register wrongly cited "ADR 0021" for the same thing, and disappears with the register; ADR 0021 is "Live speech engines behind one event contract". Project memory cites ADR 0024 and 0025 for the measurement and line-identity decisions, but the repo numbers them 0025 and 0026 (renumbered after a collision); use the repo numbers.

Per docs (not verified in code):
- The provisioning doc's target UX, catalog fields, cache rules, delivery slices and acceptance list (`docs/architecture/first-use-dependency-provisioning.md`), and its status "Partially implemented - Piper preview voices and Whisper transcription models".
- Hugging Face `resolve/<commit>/...` URLs pin Whisper files by revision (visible in the catalog); range-request and rate-limit behavior is unverified.

Assumptions - need validation:
- A clean-machine install works today (no Node, Go, Python, checkout). Method: install the latest RC on a clean Windows VM or a machine without dev tools; the user runs it.
- Narrators want the higher-quality Story Bible enough to accept a model download. Method: ask the user; compare rules-only against spaCy output on the reference manuscript (ADR 0020 favors precision).

## Proposed Solution

Finish provisioning in three steps: make install jobs honest and consistent (fixing the Piper mismatch), harden the shared asset manager and expose one aggregated catalog API, then add spaCy as a catalog-managed asset with a first-use gate on Story Bible and a "Manage local assets" surface for everything. In parallel, publish Storybook to GitHub Pages as a quick win, decide and build a public docs site from the existing Markdown, and reconcile the release docs with the real pipeline. Then close the release gaps in order: a Windows installer, a packaged-app smoke test, and a signing decision, ending in a rehearsed first stable promotion. Each optional model stays download-on-explicit-first-use; nothing downloads at startup.

## Key Hypothesis

We believe finishing first-use provisioning and giving narrators one place to see and repair local assets, together with an installable, documented release, will let a non-developer narrator install a GitHub release and use every feature (including higher-quality Story Bible) without a checkout or a dev toolchain. We'll know we're right when a clean Windows machine installs the release, launches with no download and no request except the once-a-day, switch-off-able update check (ADR 0072), completes a Story Bible build after one explicit spaCy download, and recovers from a cancelled or corrupted download from the assets page without touching the file system.

## What We're NOT Building

- **Bundling optional model weights in the release** - the provisioning doc rules it out; the base release contains only code needed to start the app.
- **Automatic model updates, silent fallback to another model, or background downloads** - prior decision (first-use doc; roadmap): optional downloads only on explicit first use.
- **Cloud processing or telemetry** - prior decision: local-first.
- **New models or engines** (Moonshine, BookNLP, GLiNER, forced aligners), or any change to the local-first and narrator-review boundaries - the first-use brief's out-of-scope note; `docs/research/local-dependency-evaluation.md` governs each new artifact; Moonshine provisioning belongs to `teleprompter-engines-and-input-devices.prd.md` and should use the aggregated catalog from this PRD.
- **macOS/Linux installers and adapters** - prior decision (roadmap Deferred), even though CI builds those artifacts as previews.
- **Distributor profiles or anything about measurement** - see `diagnostics-delivery-and-cleanup-tools.prd.md`.
- **Moving the Storybook or docs to a third-party host with secrets in this PRD** - GitHub Pages first; anything needing accounts or secrets needs the user's go-ahead.
- **Rewriting all internal docs for outsiders** - the public site is a curated view; the contributor tree stays as is.
- **Fixing the recorded a11y and UI debt** (the retired UI-defects register, now owned by the dialog, component-a11y, palette, settings-layout and test-stability PRDs in `docs/prds/`) - separate work; this PRD only avoids growing it.
- **Merging anything** - prior decision: nothing merges without the user.

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| No download at startup | 0 outbound non-loopback requests when the app opens on an empty cache with the update check switched off; with it on, exactly one, a GET of GitHub's releases metadata (the in-app update check, intended, [ADR 0072](../adr/0072-the-app-updates-itself-from-this-repositorys-releases-and-never-installs-without-a-click.md)), and no asset | Go test with a failing `http.RoundTripper` (`apps/desktop/startup_offline_test.go`, delivered in phase 7), plus a manual check on a clean profile |
| Failure modes leave no usable partial | Offline, cancelled, interrupted, hash-mismatch and disk-full: 5 of 5 leave no installed-looking asset, allow retry or repair, and leave unrelated tools usable | Automated tests (first-use doc acceptance) |
| First use completes the request | After Download, the originally requested operation (Piper preview, Whisper compare, Teleprompter, Story Bible build) runs, and the selected model is unchanged | One integration test per gated capability |
| Selecting never downloads | Choosing a compatible spaCy, Whisper or Piper item in Settings makes 0 requests; every catalog-approved spaCy model is selectable before it is installed and downloads only after an explicit Download | Go test with a failing transport, plus a component test |
| Reopen and removal | Reopening recognizes a verified asset without a download; removing one asset disables only its dependent capabilities and leaves settings, project sidecars and the base app untouched | Go and UI tests |
| Real, monotonic install progress | Bytes done never decrease and end at total; UI shows the same number | Go job test plus a UI test with a scripted multi-step mock |
| Piper first-use works on the desktop app | First preview: prompt, download, verify, playback, end to end | Manual run on the real desktop app (the mock cannot show it) |
| Catalog read latency | Listing all assets with 5 installed Whisper models under 100 ms (today: a full SHA-256 of every installed file; 3.09 GB for `large-v3`) | Benchmark before and after Phase 2 |
| spaCy path | On an empty cache, Story Bible build prompts once, downloads, builds with the model (log names it); a second build does not prompt | Integration test with a local HTTP server, plus a manual run |
| Assets page completeness | Every catalog item shown with state, size, publisher, license and provenance link; download, verify and remove available | Component tests and visual states at four viewports |
| Clean-machine install | Latest RC installs and launches with no repository checkout, Node, Go, external Python installer or `pnpm run bootstrap` | Manual on a clean Windows machine; baseline TBD |
| Storybook published | Public URL serves the latest `main` build within one workflow run | Workflow run plus manual visit |
| Docs site health | 0 dead internal links; build fails on a broken link | Link check in CI |
| Docs match pipeline | 0 known discrepancies between `ci-and-releases.md` and the workflows | Review checklist in Phase 13 |
| Stable release | One RC promoted to a stable release via the Promote workflow with checksum verification | Workflow run, run by the user |
| Coverage | At least 80% on new and changed Go, including the brief's named cases: catalog compatibility, first-use gating, no-download startup, verification failure, cancellation and resume, packaged smoke | `go test -cover` and the case list |

## Open Questions

- [x] **1. Story Bible without a spaCy model: what should decline do?** Options: (a) offer three choices in the first-use dialog: Download, Build with rules-only for this run, Cancel. (b) Block the build until downloaded. (c) Bundle a small model in the release (the doc says bundling is not required, not that it is forbidden). Recommendation: (a): it respects "Cancel leaves the app usable", keeps today's supported fallback (`README.md:80-83`), and labels lower-quality output clearly. Do not bundle. Whether the default should stay `en_core_web_sm` is part of the answer. **Answered (Q1, adopted): (a). Decline offers Download, Build with rules-only for this run, Cancel. No bundling.**
- [x] **2. How is a downloaded spaCy model loaded in the frozen sidecar?** Unverified (TBD - needs research, Phase 4): model wheels are packages, so options are (a) catalog a pinned wheel, unpack to the cache and pass the directory path to `spacy.load`; (b) install into the sidecar's environment at runtime (rejected by the doc: no unrestricted `pip install` at runtime); (c) freeze a model in at build time (bundling). Recommendation: (a), decided by the Phase 4 spike including whether the frozen sidecar can import spaCy at all (`manuscript_guide.py:377` swallows the error) and the model's license. **Answered (Q2), resolved by the phase 4 spike: go, see [the result](../research/spacy-model-provisioning-spike.md). Catalog a pinned wheel, unpack it to the cache and pass the directory to `spacy.load`; the spike also checks that the frozen sidecar can import spaCy at all and reads the model licence.**
- [x] **3. Asset cache location and override.** Models reach 3 GB. Options: (a) keep `os.UserCacheDir()/narration-utils/assets` (`app.go:149-153`), show the path in the assets page. (b) Add a global setting to choose another folder (another drive). (c) Move to a data directory rather than a cache. Recommendation: (a) now, (b) as a fast follow if users hit disk limits; never store paths relative to a checkout (doc rule). The brief also leaves two items to this decision: a retention policy (recommendation: nothing ever deletes an installed asset except a user action) and any cache shared across versions or installs (recommendation: none in v1). Note that `os.UserCacheDir()` is `%LocalAppData%` on Windows, where cleanup tools look, and that `app.go:149-151` falls back to the temp directory if it fails; decide whether that fallback should become an error. **Answered (Q3 a): keep `os.UserCacheDir()/narration-utils/assets`, show the path in the assets page, never auto-delete. The temp-directory fallback becomes an error in phase 2.**
- [x] **4. Resume interrupted downloads?** Options: (a) restart on failure (today; a 3 GB restart is costly). (b) Resume with a `.part` file and HTTP Range, verifying the whole-file hash at the end. (c) Resume only for files over a size threshold. Recommendation: (b) if Hugging Face and the spaCy source honor ranges (unverified, TBD - needs research); the hash gate keeps it safe. The doc's acceptance lists "cancellation/resume behavior". **Answered (Q4): resume with a `.part` file and HTTP Range if the hosts honour ranges (verified in phase 2); the whole-file hash still gates the result.**
- [x] **5. Verification policy.** Options: (a) trust a manifest (size plus modification time) on listing and startup, run the full hash on an explicit Verify and before first load per session. (b) Always full hash (today). (c) Hash only at install. Recommendation: (a). It fixes the multi-second cost and still detects corruption before use; a mismatch becomes `verification_failed` with a Repair action. **Answered (Q5 a): manifest fast path on listing and startup, full hash on an explicit Verify and before first load per session.**
- [x] **6. Is "update available" in scope?** Options: (a) not in v1: the catalog is pinned per release; show the catalog version and installed version only. (b) Show an update badge when a newer catalog entry supersedes an installed one, never auto-install. Recommendation: (a). The doc already makes updates opt-in and reviewed (an available version may be shown only when it is in a reviewed release catalog, and never replaces an installed model on its own); nothing needs a badge until a second version of any asset exists. **Answered (Q6): no update badge; the catalog is pinned per release.**
- [x] **7. Legacy caches from the retired bootstrap.** Options: (a) deliberately ignore them and document it. (b) An explicit "import existing model" flow that verifies against the catalog. Recommendation: (a). The retired directories (`.piper`, `.runtime`, `.bootstrap`) are gitignored developer artifacts (`.gitignore`), and the doc allows either an explicit documented migration path or a deliberate rejection, never a silent adoption of unverifiable files. `README.md:89-91` already says the legacy `.runtime` and `.bootstrap` directories are ignored and safe to delete by hand; add `.piper` there. Revisit only if a real user has one. **Answered (Q7): legacy caches are ignored and documented; add `.piper` to the README line.**
- [x] **8. Public docs site generator.** Options: (a) none yet: Storybook on Pages plus GitHub's own Markdown rendering. (b) VitePress (Vite and pnpm are already in the stack; built-in dead-link check). (c) MkDocs Material (Python, `uv` already used). (d) Docusaurus or Astro Starlight (heavier). Recommendation: (a) immediately (Phase 9), then a spike (Phase 10) between (b) and (c) on the repo's real cross-folder relative links (`../../apps/...`, ADR cross-links) before choosing. The choice needs an ADR and is unverified until the spike. Whatever is chosen, the public docs site must be a generated view of `docs/`, never a hand-kept copy (the wiki is disabled for that reason, `docs/operations/github-workflow.md`). **Answered (Q8): Storybook to Pages now (phase 9, the owner enables Pages), then a VitePress vs MkDocs Material spike on the real cross-folder links (phase 10, an ADR).**
- [x] **9. What the public site publishes.** Options: (a) a curated user guide (from `docs/guides/using-the-app/`), the roadmap, the component atlas and selected architecture and ADR pages. (b) The whole `docs/` tree. (c) Purpose-written external pages (the showcase brief's second option; the internal tree is framed for contributors and agents). Recommendation: (a) with an explicit include list; `docs/research/` contains competitor and unverified material and stays out until reviewed. Whichever is chosen is generated from `docs/` on every build and never hand-copied: the wiki was disabled for exactly that drift (`docs/operations/github-workflow.md:14`). **Answered (Q9): a curated include list, generated from `docs/` on every build and never hand-copied; `docs/research/` stays out until reviewed.**
- [x] **10. Windows installer technology.** Options: (a) NSIS via Wails' `-nsis` (already passed to the build; the embedded default `project.nsi` already creates the Start Menu and Desktop shortcuts and runs the WebView2 runtime macro, so a checked-in definition is only needed for what must differ). (b) MSI or MSIX. (c) Keep the portable executable plus a zip. Recommendation: (a). It matches the flag already in CI and the packaging plan in section 3 of `standalone-launch.md` (that brief is kept and marked Implemented for the launch path; its installer, Start Menu entry and desktop shortcut are still planned). Still unverified: whether the CI runner has `makensis` (Wails only warns and skips when it is missing) and whether any release ever contained an installer; check both in Phase 14 before writing any definition. **Answered (Q10): NSIS through Wails `-nsis`; per-user versus per-machine is decided in phase 14 and recorded (the in-app updater of [ADR 0074](../adr/0074-the-windows-update-renames-the-running-executable-and-keeps-the-old-one-until-the-new-one-starts.md) needs a writable install folder, so per-user is preferred).**
- [x] **11. Code signing.** Options: (a) ship unsigned RCs with documented SmartScreen and Gatekeeper warnings and checksums (today). (b) Sign Windows with an Authenticode certificate or a signing service (researched 2026-09-20: **SignPath Foundation** is free for OSI-licensed, already-released, actively maintained projects, but needs MFA, a published signing policy and manual approval of each release ([terms](https://signpath.org/terms.html)); **Azure Artifact Signing** is about $9.99/month, needs a paid Azure subscription with ID and face verification, and is open to individuals only in the US and Canada, with no EV certificates and no custom publisher name ([FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq)); EV certificates no longer bypass SmartScreen (since 2024), so the premium is not worth paying, and reputation builds over time even when signed ([Microsoft](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)); the Certum open-source certificate is TBD - needs research. Signing must run before the attestation step described in [CI and releases](../operations/ci-and-releases.md#build-provenance)). (c) Sign Windows and notarize macOS. Recommendation: decide before the first stable; the user owns certificates, costs and secrets, so no agent adds signing steps unasked. Until decided, keep RCs unsigned and say so in release notes. **Answered (D7): first stable is unsigned. Phase 15 is deferred and no agent adds signing steps; release notes say "unsigned".**
- [x] **12. What "release-ready" means for the first stable.** Options: (a) Windows-only stable; macOS and Linux stay preview assets. (b) All three. Recommendation: (a), consistent with the roadmap's Windows-first and "macOS/Linux installers deferred". Also decide whether signing (Question 11) and the clean-machine install check are stable gates; recommendation: the install check yes, signing the user's call. **Answered (Q12 a, D7): a Windows-only stable; macOS and Linux stay preview assets; the clean-machine install check is a stable gate, signing is not.**
- [x] **13. Repository settings that do not match the docs.** The live rulesets require code-owner review and no status checks; `ci-and-releases.md` describes the opposite (`github-workflow.md` now lists the owner-only settings that do match, and calls CodeQL and dependency review advisory). These are owner-only settings. Options: (a) update the docs to match the settings. (b) Change the settings to match the docs (a required, always-run status check). Recommendation: the user decides; note that adding required checks needs job names that actually exist (Phase 13 lists them). **Answered (Q13 a, D11): the docs change to match the live rulesets (code-owner review required, no required status checks). Stack S06 and S07 already updated the docs; phase 13 verifies and does not redo them.**

## Users & Context

**Primary User**
- **Who**: a narrator (not a developer) installing a GitHub release on Windows to use Manuscript Guide, Transcript Compare and the Teleprompter.
- **Current behavior**: downloads a 421 MB executable with no installer or signature, hits an unsigned-app warning, and finds features that need model downloads behave inconsistently (Piper download UI, Story Bible rules-only until a developer installs a model).
- **Trigger**: first launch, then the first time they use a feature that needs a model.
- **Success state**: installs, launches with nothing downloaded, is asked before any download with size, publisher and license, sees progress that is real, and can see, verify and remove every downloaded asset from one page.

**Secondary Users**
- **Contributor or evaluator**: wants to browse the component atlas and read the guide without cloning.
- **Maintainer (the user)**: promotes RCs to a stable release and needs docs that match the workflows.

**Job to Be Done**
When I install the app, I want it to work out of the box and ask me before downloading anything large, so I stay in control of my disk and bandwidth.

**Non-Users**
- Developers running from a checkout (bootstrap stays as is and does not preload assets).
- macOS and Linux users for installers (previews only).
- Anyone needing offline model installation from a mirror (not in scope; developer seeding command only, per the doc).

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Phase |
| --- | --- | --- |
| Must | Install jobs report real, consistent progress; Piper first-use works on the desktop app | 1 |
| Must | Asset manager: full manifest, cheap state check, explicit verify and repair, staging cleanup, disk-space precheck, failure-mode tests | 2 |
| Must | One aggregated asset catalog API with install, verify, remove | 3 |
| Must | spaCy models catalog-managed, with a first-use gate on Story Bible and a labeled rules-only option | 4, 5 |
| Must | "Manage local assets" surface with all states | 6 |
| Must | No download at startup, legacy-cache policy and docs, packaged-app smoke test | 7, 8 |
| Must | Windows installer with Start Menu entry and WebView2 check | 14 |
| Must | Docs reconciled with the workflows; first stable rehearsal | 13, 16 |
| Should | Storybook published to GitHub Pages | 9 |
| Should | Public docs site (curated, link-checked) | 10, 11, 12 |
| Should | Resume interrupted downloads | 2 (per Open Question 4) |
| Could | Signing (decision first) | 15 |
| Could | Update-available state | after v1 |
| Won't (this cycle) | Bundled models, auto-updates, macOS/Linux installers, third-party doc hosting | later |

### MVP Scope

Provisioning phases 1 to 8 plus the installer (14), the docs reconciliation (13) and the stable rehearsal (16) make a release-ready product. Storybook on Pages (9) is a quick win that can ship any time. The full docs site (10 to 12) and signing (15) are valuable but do not gate a first Windows stable unless the user decides they do (Open Questions 11 and 12).

### User Flow

1. The narrator installs the release and opens the app. Nothing is downloaded (the app's only own request is the once-a-day update check, which fetches release metadata and can be switched off); the assets page (Settings) lists every approved asset as "Not installed" with size, publisher and license link.
2. They start a Story Bible build. The dialog names the spaCy model, its version, publisher, download size and disk needed, license and provenance links, source and install location, and offers Download, Build with rules-only (labeled lower quality), or Cancel. Download shows a real progress bar and can be cancelled.
3. After verification the build resumes with the model they selected. A second build does not prompt.
4. In Settings, Local assets shows total disk used, and per item Download, Verify and Remove. A corrupted file shows "Needs repair" with a Repair button. Each row also shows the installed version and, once a second catalog version exists, the catalog version (Open Question 6).
5. A contributor opens the public Storybook link, and later the docs site, without cloning the repository.

### Provisioning rules (checklist for Phases 1 to 8; canonical text is the first-use brief)

Tags: **shipped** = enforced by `apps/desktop/internal/assets` and the Piper and Whisper gates today; **pending** = a phase here delivers it.

- **Startup.** The release contains all code and runtime libraries needed to start the app; on first launch it creates only settings and asset-cache directories, validates its bundled runtime and shows which optional assets are installed; nothing downloads because the app opened, and selecting a model in Settings never downloads it (**shipped**, proved by the Phase 7 tests in `apps/desktop/startup_offline_test.go`; the only request the app makes on its own is the update check of ADR 0072; the runtime validation at launch is the Phase 8 smoke mode).
- **First-use gate.** An installed, valid asset runs at once (**shipped**). An absent one shows the item, version, publisher, download size, disk needed, license and provenance links and destination, and nothing transfers until the narrator chooses Download; afterward the original operation resumes with the same selected model; Cancel leaves it uninstalled and the rest of the app usable (**shipped** for Piper and Whisper apart from the version, disk and destination fields; **pending** for spaCy, Phase 5).
- **Assets, not startup dependencies.** Model weights, voices, dictionaries and external tool packs are assets. The base release carries only the code needed to start the app and show this flow; a release build never calls `pnpm run bootstrap` or needs Node, Go or a Python installer (**shipped** boundary: `prepare-resources.py`, `verify-installable.mjs`; **pending**: smoke proof, Phase 8).
- **Catalog entry.** Stable id, capability compatibility, exact version (a pinned commit or tag), immutable URL, SHA-256 or stronger, size, publisher, license and notice, model card and provenance links, install layout. No `latest` alias, no runtime `pip install` or unrestricted tool download (**shipped** for Piper and Whisper: `catalogVersion`, `id`, `provider`, `displayName`, `version`, `publisher`, `license`, `licenseUrl`, `modelCardUrl`, `provenanceUrl`, `attribution` and `files[name, url, sha256, size]`, installed at `<cache>/<provider>/<id>/<version>/`; **pending** for spaCy and dictionaries).
- **State in the UI.** Choices come from the compatible catalog with install state kept separate (`installed`, `not installed`, `downloading`, `verification failed`, `update available`); a compatible choice is never hidden because it is not downloaded (**pending**: Phases 1, 5, 6; today three states and hard-coded spaCy choices).
- **Location.** A per-user application-data cache outside the release, the project folder and the checkout; never a checkout-relative path (**shipped** apart from the temp-directory fallback, Open Question 3).
- **Install.** Download to a temporary directory, verify size and hash, rename into place, remove the temporary directory on cancel or failure; a corrupt or partial asset is never selected (**shipped**; Phase 2 hardens replacement). Progress is real, cancellation works where the format allows, and errors are actionable when offline (**pending**, Phase 1). Retry only on an explicit user action, and never fall back silently to a different model (**shipped**).
- **Manifest and removal.** The manifest keeps exact version and provenance so diagnostics can report it and the user can repair or remove the asset; removal never touches settings, project sidecars or the base app (**pending** manifest, Phase 2; **shipped** removal scope).
- **Updates** are opt-in and only from a reviewed release catalog (Open Question 6).
- **Records.** Each new artifact needs its publisher, version, URL, SHA-256, licenses, install location and update policy in `local-dependency-evaluation.md` before a release ships it (**shipped**, Phase 7: the setup-time framing is rewritten to first-use provisioning and the Piper voice, the five Whisper models and the two spaCy models are recorded).
- **Developer flow.** Bootstrap preloads nothing; development uses the same catalog and first-use installer; an explicit developer-only command seeds assets for offline tests and packaging checks (**shipped**, Phase 7: `pnpm run assets:seed`, `apps/desktop/cmd/seed-assets`). Legacy bootstrap caches are ignored and never adopted (Open Question 7, **shipped**: tested and documented in Phase 7).
- **Brief's delivery slices** map as: slice 1 (boundary, catalog and manifest format) shipped plus Phase 2 manifest and Phase 14; slice 2 (asset manager) Phase 2; slice 3 (state APIs and UI, catalog-backed spaCy choices) Phases 3, 5, 6; slice 4 (Piper, Whisper done; spaCy and every later asset) Phase 5 and the engines and Story Bible PRDs; slice 5 (docs, legacy caches, release smoke) Phases 7 (done) and 8.

## Technical Approach

**Feasibility**: HIGH for Phases 1, 2, 3, 6, 7, 9, 13. MEDIUM for 5, 8, 10, 11, 12, 14, 16 (spaCy loading in a frozen sidecar, a launch smoke test in CI, generator choice, installer). LOW-MEDIUM for 15 (certificates, costs, secrets are the user's).

**Architecture Notes**

- **Progress contract.** Add a progress callback to `assets.Install` (bytes done and total from `Content-Length`, falling back to the catalog `size`); job snapshots add `percent`, `bytesDone`, `bytesTotal`; unify TTS and Whisper snapshots behind one type and one phase vocabulary (`downloading`, `verifying`, `success`, `cancelled`, `error`); update the three UI consumers (`GuideDetail.tsx`, `Transcript.tsx`, `TeleprompterPage.tsx`) and the shared poll loop (the teleprompter brief already notes extracting the Whisper install-poll loop). The mock must emit multi-step jobs so tests and the visual suite exercise the real states.
- **Asset manager (Phase 2).** Extend the manifest with hashes, sizes, source URL, catalog version and install time; add `Verify` and `Repair`; keep `State` cheap by trusting the manifest until asked to verify (Open Question 5); disk-space check before download (documented free-space call; TBD Windows API); delete stale `*.installing` directories at startup; optional Range resume (Open Question 4). Everything stays under `apps/desktop/internal/assets`, with tests for each failure mode using a local `httptest` server.
- **Aggregated catalog (Phase 3).** New generic bindings (`AssetsList`, `AssetsInstall`, `AssetsInstallState`, `AssetsInstallCancel`, `AssetsVerify`, `AssetsRemove`) over a registry of providers (Piper, Whisper, spaCy); existing `Tts*` and `Whisper*` bindings remain as thin wrappers until UI migration ends, then are removed in a later change. Every new binding snapshots pointers under `h.mu.RLock`; bump the host API version in three places and regenerate Wails bindings. Because `configureLocked` rebuilds managers per project attach, hoist asset managers out of per-project state (they are not project-scoped).
- **spaCy (Phases 4, 5).** Phase 4 is a spike producing a verified answer to Open Question 2 and catalog entries with pinned URL, size and SHA-256, publisher, license and provenance. Phase 5 adds `config/spacy-assets.json`, a `spacy` provider, sidecar support for a model directory (`sidecars/manuscript-guide/core/manuscript_guide.py`, with Python tests and a change-impact scan because `character-continuity-review.prd.md` also touches Story Bible), an `asset_required` result from the guide build binding, and settings choices sourced from the catalog rather than `app.go:676`. Rules-only remains an explicit, labeled option.
- **Assets page (Phase 6).** A Settings section (or page) consuming `AssetsList`, one row per catalog item; states `not installed`, `downloading` (real percent), `verifying`, `installed`, `needs repair`; total size and cache path; ConfirmDialog for remove; existing primitives only; stories for anything new; no growth of the a11y debt list (`tests/atlas/a11y-debt.ts`). ADR 0015 governs progress.
- **Startup and packaging (Phases 7, 8).** A test proving `NewHost` and `Startup` make no outbound calls; a documented developer-only seeding command; release smoke: a `--smoke` (name TBD) mode or equivalent that starts the packaged host, checks bundled resources and exits nonzero on failure, run in `_build-native.yml` on the Windows runner (Wails is a GUI app, so this is a design task; TBD - needs research). Update `docs/research/local-dependency-evaluation.md`, `README.md`, and the first-use doc status.
- **Storybook on Pages (Phase 9).** New workflow `pages.yml` on push to `main`: install, `pnpm --dir apps/ui run build-storybook`, `actions/upload-pages-artifact`, `actions/deploy-pages` with `pages: write` and `id-token: write`. Requires the user to set Pages source to GitHub Actions. Verify the built site works under a project sub-path (unverified). Do not edit `ci.yml` (its `paths-ignore: docs/**` is separate).
- **Docs site (Phases 10 to 12).** Spike compares candidate generators on the real tree; the chosen tool builds from `docs/` (no copied content, to avoid drift), rewrites or excludes links that leave `docs/`, embeds the component atlas, runs a link check in CI, deploys together with Storybook. Screenshots come from the existing curated pipeline (ADR 0011, `doc-screenshot-sync`); the multi-page guide layout from #36 and its `docsGuide.test.ts` are constraints. New ADR for the generator choice (re-check numbering).
- **Release (Phases 13 to 16).** Reconcile `ci-and-releases.md` with the workflows; decide the fate of `scripts/ci/changed-files.mjs`; confirm `makensis` on the runner and what the embedded default installer already does, check in an NSIS definition under `apps/desktop/build/windows/installer/` only where it must differ, and adjust `collect-assets.mjs` extensions if needed; signing per Open Question 11; rehearse Promote (user runs it).

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| spaCy model cannot be loaded from a directory in the frozen sidecar, or spaCy fails to import when frozen | Medium | Phase 4 spike before any product code; keep rules-only path working |
| Hugging Face or model-source rate limits, redirects or missing Range support | Medium | Pinned revisions (already in the catalog), retry only on explicit user action, resume only if verified |
| Changing job snapshots breaks three UI consumers and tests | Medium | One shared type, updated consumers in the same PR, scripted mock, visual and unit tests |
| Full-hash cost or a trusted-manifest shortcut hides real corruption | Medium | Manifest fast path plus verify-before-first-load per session and an explicit Verify action |
| Antivirus or SmartScreen flags a 421 MB unsigned executable | High | Installer, checksums, release-note guidance; signing decision (Open Question 11) |
| A launch smoke test in CI is flaky or hard for a GUI app | Medium | Dedicated non-interactive mode, generous timeout, run only on package changes |
| Docs generator mangles cross-folder links or ADR references | Medium | Spike on the real tree; dead-link check as a CI gate |
| Pages base path breaks Storybook assets | Low | Verify in a preview deployment before announcing |
| Concurrent PRDs collide on `app.go`, bindings, Settings and nav | High | See Parallel-session compatibility; land Phase 3 before other providers |
| Repo settings drift from docs (rulesets, environments) | Certain today | Owner decision (Open Question 13); document the actual settings |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Install job contract and real progress | Progress callback, unified job snapshot and phase vocabulary, fix the Piper `running`/`downloading` mismatch, scripted mock, host API bump | complete (S16, [ADR 0077](../adr/0077-every-asset-install-is-one-job-with-real-bytes-a-second-start-joins-it-and-one-hook-follows-it.md), `hostAPIVersion` 10) | 4, 9, 12, 13 | - | [plan](implementation-plan.md) (S16) |
| 2 | Asset manager hardening | Full manifest, cheap state, verify and repair, staging cleanup, disk-space check, optional resume, failure-mode tests | complete (S16, [ADR 0078](../adr/0078-asset-state-comes-from-the-manifest-an-asset-is-read-in-full-once-per-session-and-a-failed-download-resumes.md)) | 4, 9, 12, 13 | 1 | [plan](implementation-plan.md) (S16) |
| 3 | Aggregated asset catalog API | Provider registry, generic bindings, hoist managers out of per-project state, host API bump | complete (S16, [ADR 0079](../adr/0079-every-downloadable-asset-is-listed-installed-verified-and-removed-through-one-registry-of-providers.md), `hostAPIVersion` 11) | 4, 9, 12, 13 | 2 | [plan](implementation-plan.md) (S16) |
| 4 | Spike: spaCy model provisioning | Verify loading from a directory in the frozen sidecar, model license, sizes and hashes; catalog entries; written result | complete (S16, go: [result](../research/spacy-model-provisioning-spike.md)) | 1, 2, 3, 9, 12, 13 | - | [plan](implementation-plan.md) (S16) |
| 5 | spaCy catalog and Story Bible gate | `spacy-assets.json`, provider, sidecar model-directory support, `asset_required` on build, three-way dialog, catalog-backed settings choices | complete (S16, [ADR 0080](../adr/0080-the-story-bible-language-model-is-a-catalog-asset-unpacked-at-install-and-the-build-asks-before-it-downloads.md), `hostAPIVersion` 12) | 6, 9, 12 | 3, 4 | [plan](implementation-plan.md) (S16) |
| 6 | Manage local assets UI | Settings section listing every asset with states, verify, repair, remove, totals, cache path; visual states, docs | complete (S16, [ADR 0081](../adr/0081-local-assets-is-a-settings-list-built-from-the-registry-whose-rows-own-their-download-verify-and-remove.md); no host API change, `hostAPIVersion` stays 12; real Windows install, a screen-reader pass and the packaged app are not verified) | 5, 9, 12 | 3 | [plan](implementation-plan.md) (S16) |
| 7 | Startup, legacy caches and provisioning docs | No-download-at-startup test, legacy-cache policy, developer seeding command, docs and status updates | complete (S16; no new ADR, `hostAPIVersion` stays 12; evidence: `apps/desktop/startup_offline_test.go` holds `NewHost`, `Startup`, the first `Bootstrap`, the settings, catalogs, asset list and every model choice to 0 requests with the update check off and to exactly one GitHub releases GET with it on, and holds a file in `.piper`, `.runtime` or `.bootstrap` to "not installed"; `apps/desktop/cmd/seed-assets` with `pnpm run assets:seed`, tested against a local server; `bootstrap.mjs` message corrected; `local-dependency-evaluation.md` rewritten and every shipped artifact recorded. A manual first launch on a clean Windows profile is not run) | 5, 6, 9 | 3 | [plan](implementation-plan.md) (S16) |
| 8 | Packaged-app smoke test | Non-interactive smoke mode, CI step on the Windows package, verify-installable extended | pending | 5, 6, 12 | 7 | - |
| 9 | Storybook on GitHub Pages | `pages.yml`, build and deploy, README link; user enables Pages | pending | 1-8, 10-13 | user enables Pages | - |
| 10 | Spike: docs site generator | Compare candidates on the real tree; decision and ADR | pending | 1-9, 12, 13 | - | - |
| 11 | Public docs site | Build from `docs/`, curated include list, atlas embed, link check, deploy with Storybook | pending | 12, 13, 14 | 9, 10 | - |
| 12 | README and docs accuracy pass | Root README refresh, first-use doc statuses, verify the showcase brief's removal left no dangling links, trim the first-use brief | pending | 1-11, 13 | - | - |
| 13 | CI docs and pipeline hygiene | Reconcile `ci-and-releases.md` with the workflows, decide `changed-files.mjs`, align action pins, cover the new CodeQL, labeler and sync jobs, extend the owner-only settings list in `github-workflow.md` | pending | 1-12 | - | - |
| 14 | Windows installer | NSIS definition, Start Menu entry, WebView2 check, asset collection, checksum flow | pending | 11, 12, 13 | 8 (smoke test), Open Question 10 | - |
| 15 | Code signing | Decision, then signing steps and secrets handling; user-owned | pending | - | 14, user decision | - |
| 16 | First stable rehearsal | Release checklist, clean-machine install check, user runs Promote on an RC | pending | - | 8, 14, 13 | - |

### Phase Details

**Phase 1 - Install job contract and real progress**
- **Goal**: install jobs tell the truth and every UI consumer understands them.
- **Scope**: `apps/desktop/internal/assets/store.go` (callback), `apps/desktop/app.go` job types and snapshots, `apps/desktop/internal/{tts,whisper}/catalog.go` wiring, contracts `tts.ts` and `whisper.ts`, `GuideDetail.tsx`, `Transcript.tsx`, `TeleprompterPage.tsx`, `mockApi.ts`, `wailsClient.ts`; shared poll hook; host API bump in three places plus regenerated bindings; first confirm the Piper defect on the real desktop app.
- **Success signal**: Go test with a slow local server shows monotonic bytes; UI tests drive `downloading` to `success` and `cancelled`; a manual desktop run shows the Piper dialog progressing and then playing the preview; PNGs reviewed at four viewports for changed dialogs.

**Phase 2 - Asset manager hardening**
- **Goal**: the manager is safe and fast enough for multi-GB assets.
- **Scope**: `apps/desktop/internal/assets/*` only (manifest, State, Verify, Repair by renaming the old directory aside instead of remove-then-rename, cleanup, disk check, optional Range resume) and its tests: offline, cancel, interrupted, hash mismatch, disk-full, resume, catalog compatibility; `tts` and `whisper` adapt. The cache-root fallback to `os.TempDir()` (`app.go:149-151`) is decided with Open Question 3 and changed in the same PR if it becomes an error.
- **Success signal**: all five failure modes covered; catalog read latency benchmark improves and is recorded; no partial asset is ever reported installed.

**Phase 3 - Aggregated asset catalog API**
- **Goal**: one API and provider registry for every optional asset.
- **Scope**: registry type, generic bindings, wrappers for existing bindings, hoisting managers out of `configureLocked`, TS contract (`assets.ts`), adapter, mock, host API bump. The registry is not model-specific: it must also carry dictionaries and later tool packs (`story-bible-and-import-ux-briefs.prd.md` needs a dictionary asset; the engines PRD needs Moonshine), each with its own catalog file.
- **Success signal**: Piper and Whisper appear in `AssetsList` with correct states; existing UI keeps working unchanged through wrappers; no data race on manager pointers.

**Phase 4 - Spike: spaCy model provisioning**
- **Goal**: replace assumptions with a verified plan.
- **Scope**: confirm the frozen sidecar can import spaCy; load a model unpacked from a wheel by directory path; record model versions, sizes, SHA-256, license and provenance for `en_core_web_sm` and `en_core_web_lg`; compare Story Bible output rules-only versus model on the reference manuscript; result documented.
- **Success signal**: a written go or no-go with catalog entries ready to commit, or a documented alternative.

**Phase 5 - spaCy catalog and Story Bible gate**
- **Goal**: Story Bible asks before downloading and then uses the model.
- **Scope**: catalog file and provider, sidecar `--spacy-model` directory handling with Python tests, `startGuideBuild` gate and `asset_required` result, contract and dialog with the three choices, settings choices from the catalog (every approved model selectable before it is installed), first-use gating and catalog-compatibility tests, the extra dialog fields (version, disk needed, install path; also added to the Piper and Whisper dialogs), `character-continuity-review.prd.md` change-impact check, visual states and docs.
- **Success signal**: on an empty cache a build prompts, downloads, verifies and logs the model name; declining runs rules-only with a visible label; cancelling leaves the app usable.

**Phase 6 - Manage local assets UI**
- **Goal**: one place to see, verify, repair and remove assets.
- **Scope**: Settings section consuming `AssetsList`, real progress, states, installed and catalog version, totals, cache path, remove confirm, keyboard and screen-reader behavior, `state-catalog.ts` rows and drivers, doc screenshot and guide page, atlas stories for any new primitive, `design-spec-guard`.
- **Success signal**: all states reviewed as PNGs at desktop, small-desktop, tablet and mobile; a corrupted fixture shows "Needs repair" and Repair works; a11y debt list does not grow.

**Phase 7 - Startup, legacy caches and provisioning docs**
- **Goal**: prove and document the no-surprise-download behavior.
- **Scope**: startup test with a failing transport; decision and doc for legacy `.piper`, `.runtime`, `.bootstrap` caches (Open Question 7); developer-only seeding command; update `first-use-dependency-provisioning.md` status and slices, `README.md`, `bootstrap.mjs` message (`:243`), `local-dependency-evaluation.md`.
- **Success signal**: startup test green; docs no longer claim a spaCy first-use flow that does not exist.

**Phase 8 - Packaged-app smoke test**
- **Goal**: CI proves a built package starts.
- **Scope**: design of a non-interactive smoke mode in `apps/desktop/main.go` or `app.go`, invocation in `_build-native.yml` for Windows, extension of `verify-installable.mjs`; runs only on package changes.
- **Success signal**: a deliberately broken resource fails the job; a healthy build passes.

**Phase 9 - Storybook on GitHub Pages**
- **Goal**: a public component atlas.
- **Scope**: `.github/workflows/pages.yml`, README link, notes for the user's Pages setting (added to the owner-only settings table in `docs/operations/github-workflow.md`); no change to `ci.yml`.
- **Success signal**: the deployed site loads, stories render in light and dark, and it matches the latest `main`.

**Phase 10 - Spike: docs site generator**
- **Goal**: choose a generator on evidence.
- **Scope**: build the real `docs/` tree with two candidates; measure broken links, image handling, relative links outside `docs/`, build time; ADR recording the choice.
- **Success signal**: a recommendation with the broken-link counts for each candidate.

**Phase 11 - Public docs site**
- **Goal**: a curated, link-checked public site.
- **Scope**: generator config, include list, generated navigation, atlas embed, CI link check, Pages deploy shared with Phase 9, guide page conventions from #36. The site is generated from `docs/` on every build and is never a hand-kept copy (`github-workflow.md:14`); no CI link check exists today, so this phase adds the first one.
- **Success signal**: zero dead internal links in CI; the site builds from `docs/` without copying content.

**Phase 12 - README and docs accuracy pass**
- **Goal**: docs that describe the product as it is.
- **Scope**: root `README.md` (tools, layout, Tracks, Teleprompter, atlas), `docs/README.md` inventory and reading-order item 6 (still calls provisioning a "planned move"), `codebase-map.md`. Brief bookkeeping already done by the docs-replacement change: `standalone-launch.md` is kept and marked Implemented, the showcase brief is removed and `docs/operations/github-workflow.md:14` and ADR 0003's aside are repointed here, and the retired UI-defects register (with its wrong "ADR 0021" citation) is gone; this phase only verifies no link to them remains (`pnpm check` docs tests plus a grep). Remaining: trim `first-use-dependency-provisioning.md` (drop "Delivery slices", refresh the status line once Phases 5 and 7 land, keep the rules); re-point `docs/roadmap.md:51` if the first-use brief changes name.
- **Success signal**: every claim checked against code; no Markdown link broken.

**Phase 13 - CI docs and pipeline hygiene**
- **Goal**: `ci-and-releases.md` matches reality.
- **Scope**: rc tags, actual job names and matrices, no draft skip, no title-check job (or add one deliberately), the fate of `scripts/ci/changed-files.mjs`, action pin alignment (verify each version exists), the new CodeQL, dependency-review, labeler, sync and `github-scripts` jobs, and the live ruleset differences (Open Question 13). The owner-only settings list already exists in `docs/operations/github-workflow.md`; extend it (rulesets, `production` environment, Pages) instead of creating a second one, and link `SECURITY.md`'s release-pipeline scope to the signing and checksum decisions.
- **Success signal**: a reviewer can follow the doc and get the described behavior; required-check names in the doc exist as job names.

**Phase 14 - Windows installer**
- **Goal**: an installable Windows release.
- **Scope**: first check whether the CI runner has `makensis` and whether the embedded Wails default installer (Start Menu and Desktop shortcuts, WebView2 bootstrapper) is produced and adequate; check in a definition under `apps/desktop/build/windows/installer/` only for what must differ. Start Menu and optional desktop shortcut per the packaging plan in section 3 of `standalone-launch.md` (kept; marked Implemented for the launch path, packaging still planned), WebView2 detection, `collect-assets.mjs`, checksum flow, `README` install steps.
- **Success signal**: an installer runs on a clean Windows machine, registers the shortcut, launches, and uninstall leaves user settings and project sidecars alone.

**Phase 15 - Code signing**
- **Goal**: a decision, then signed Windows artifacts if chosen.
- **Scope**: decision record (ADR if a real decision), secrets handling (user-owned), workflow steps only after the user approves the approach and creates the credentials.
- **Success signal**: signed installer verifies on a clean machine, or the unsigned decision is recorded with release-note wording.

**Phase 16 - First stable rehearsal**
- **Goal**: prove the path from RC to stable.
- **Scope**: release checklist doc, clean-machine install run by the user, the user runs Promote pre-release on an RC; no agent promotes.
- **Success signal**: stable tag and release created from the exact RC assets with checksums verified.

### Standing gates for every phase

CLAUDE.md workflow: plan, `change-impact-scan` (this PRD touches shared Go, bindings, Settings and Python sidecar code), TDD with at least 80% coverage on new Go, `full-verification-gate` (`pnpm check`, not `check:fast`), `design-spec-guard` when primitives or `styles.css` change, `feature-cleanup`. `apps/ui` changes run `visual-catalog-sync`, the Playwright visual suite with PNGs opened at all four viewports, `doc-screenshot-sync`, and the atlas (`pnpm --dir apps/ui atlas`) when a primitive or `styles.css` changes. Binding changes bump the host API version in `apps/desktop/app.go`, `apps/desktop/app_test.go`, `apps/ui/src/hostApi.ts` and regenerate Wails bindings. Whichever PR lands second increments again; check `hostAPIVersion` at merge time. Re-check `docs/adr/` numbering immediately before writing an ADR (the next free ADR number at merge time; 0027 at `d5cc994`). Update `docs/roadmap.md` and `config/roadmap.json` together when the release-readiness item changes. Workflow and settings changes need the user's go-ahead where they involve secrets, environments or repository settings.

### Parallelism Notes

Phase 1 to 3 are a chain because they share `app.go` and `assets`. Phase 4 (spike) has no code dependency and can run from the start. Phases 5, 6 and 7 can run in parallel after Phase 3 (different files), except that both 5 and 6 edit Settings and the mock. Phases 9, 10, 12 and 13 are docs or workflow-only, independent of provisioning code, and can run any time; Phase 11 needs 9 and 10. Phase 14 needs Phase 8's smoke test to be meaningful. Phase 15 is the user's decision. Phase 16 is last.

### Parallel-session compatibility

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 1 | `apps/desktop/internal/assets/store.go`, `apps/desktop/app.go` (job types, `startTtsInstall`, `startWhisperInstall`, snapshots), `apps/desktop/internal/{tts,whisper}/catalog.go`, `apps/ui/src/api/{contracts/tts.ts,contracts/whisper.ts,mockApi.ts,wailsClient.ts}`, `GuideDetail.tsx`, `Transcript.tsx`, `TeleprompterPage.tsx`, `apps/desktop/app_test.go`, `apps/ui/src/hostApi.ts`, `Host.{js,d.ts}` | `teleprompter-manuscript-integration.prd.md` (Phase 2 extracts the session core) and `teleprompter-engines-and-input-devices.prd.md` (Phases 2, 3, 4, 7, 9 and 11) all edit `TeleprompterPage.tsx`, and both also edit `contracts/teleprompter.ts`. Recommended sequence: this Phase 1 first (it changes the install job snapshot), then engines Phase 4 (its `useAssetInstall` and this phase's shared poll hook are the same hook: build it once, in whichever lands first, and the other consumes it), then teleprompter-manuscript-integration Phase 2, then the rest; anyone landing out of order rebases. Also every session that bumps the host API version |
| 2 | `apps/desktop/internal/assets/*` | Engines PRD adding Moonshine catalog entries (should wait for Phase 3 or use the existing manager unchanged) |
| 3 | `apps/desktop/app.go` `Host` struct and `configureLocked`, `apps/desktop/bindings.go`, new contract and adapter | Every binding-adding session; the `h.services()` pattern of `docs/architecture/host-binding-concurrency.md` |
| 4 | `docs/research/` or `docs/architecture/`, catalog draft | None expected |
| 5 | `config/spacy-assets.json`, `sidecars/manuscript-guide/core/manuscript_guide.py` (+tests), `apps/desktop/internal/guide/service.go`, `apps/desktop/app.go` guide build, `GuideDetail.tsx`, `app.go:676` schemas, Settings | `character-continuity-review.prd.md` (Story Bible and Manuscript Guide sidecar), `review-dashboard-and-findings-adoption.prd.md` if it touches Story Bible views |
| 6 | `components/settings/Settings.tsx` and new components, `tests/visual/*`, `docs/images/ui/*`, `docs/guides/using-the-app/settings.md` | Any Settings work (engines PRD input-device and engine settings, diagnostics PRD `Delivery` settings); a nav change regenerates every screenshot |
| 7 | `README.md`, `scripts/bootstrap.mjs`, docs, a Go test | Docs editors |
| 8 | `apps/desktop/main.go`/`app.go` (smoke mode), `.github/workflows/_build-native.yml`, `scripts/release/verify-installable.mjs` | `reaper-automation-follow-through.prd.md` Phase 4 (also edits `verify-installable.mjs` for new Lua files) and `teleprompter-engines-and-input-devices.prd.md` Phase 6 (Moonshine sidecar check): three PRDs add independent checks to the same file, so rebase and keep each check separate |
| 9 | new `.github/workflows/pages.yml` | None; needs the user's Pages setting |
| 10, 11 | `docs/` build config, new tool config, `.github/workflows/pages.yml`, ADR | Any docs move (the guide layout changed in #36); ADR number |
| 12, 13 | `README.md`, `docs/**`, `docs/operations/ci-and-releases.md`, `docs/operations/github-workflow.md`, workflows | Almost every PRD edits `docs/README.md` and `docs/architecture/codebase-map.md` |
| 14 | `apps/desktop/build/windows/installer/*` (new), `.github/workflows/_build-native.yml`, `scripts/release/collect-assets.mjs` | Phase 8 |
| 15, 16 | workflows and secrets (user), docs | None |

Cross-cutting: ADR numbers and the host API version are merge-time serialization points (the later PR takes the next number and rebases); `_quality.yml` and `_build-native.yml` are edited by several PRDs (`reaper-automation-follow-through.prd.md` adds a Lua job); `docs/roadmap.md` and `config/roadmap.json` change together.

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Optional models download only on explicit first use (prior decision, roadmap, first-use doc) | Ask with size, publisher, license before any transfer; cancel leaves the app usable | Preload, startup or background download | Bandwidth and disk control |
| No cloud processing (prior decision) | All local | Cloud analysis | Product boundary |
| Windows-first; macOS/Linux installers deferred (prior decision, roadmap) | Windows-only stable recommended | All platforms | Recorded scope |
| Storybook is the component layer; the visual suite is a gate (prior decision, ADR 0023) | Publish the existing build | Rebuild tooling | Already implemented and run in CI as `ui-atlas` |
| Doc screenshots curated from the visual suite (prior decision, ADR 0011) | Reuse for the docs site | Separate capture | No drift |
| Real progress only (prior decision, ADR 0015) | Install progress from bytes | Placeholder progress | Honest UI |
| Story Bible precision over recall (prior decision, ADR 0020) | Rules-only fallback stays a labeled option | Hide the difference | Narrator trust |
| Measurement in Go, no distributor profile (prior decision, ADR 0025) | Out of scope here | - | Owned by the diagnostics PRD |
| No unrestricted `pip install` or moving `latest` URLs at runtime (prior decision, first-use doc) | Pinned, hashed catalog entries | Runtime installers | Reproducibility and license record |
| Assets live outside the release, project and checkout (prior decision, first-use doc) | Per-user cache | Beside the app | Removal never touches settings or sidecars |
| CI job ordering and release promotion (existing) | Promote never rebuilds an approved RC | Rebuild on promote | Same bytes as approved |
| Asset handling rules (prior decision, first-use brief) | Temp download, verify, atomic rename; no silent fallback; retry only on user action; opt-in updates from a reviewed catalog; removal leaves settings and sidecars | Auto-retry, auto-update, fallback model | Trust and reproducibility |
| Wiki disabled; `docs/` not mirrored (prior decision, `github-workflow.md`) | Public site generated from `docs/` | Hand-kept copy or wiki | An unreviewed second copy drifts |
| Provisioning rules stay in the first-use brief; this PRD tracks the work (proposed) | Trim the brief, keep the rules | Move all rules into the PRD | `SECURITY.md`, the roadmap, `transcript-compare.md`, `local-dependency-evaluation.md`, `manuscript-teleprompter.md` and four PRDs cite the brief as the rules |
| Nothing merges without the user (prior decision) | User merges every PR | Auto-merge | Standing rule |
| Workflow (prior decision, CLAUDE.md) | plan, impact scan, TDD, `pnpm check`, spec guard, cleanup | Fast check only | History of silent regressions |
| spaCy delivery (proposed) | Catalog plus directory load, three-way decline dialog | Bundle a model; block on decline | Keeps the release small and respects Cancel |
| Verification policy (proposed) | Manifest fast path plus explicit Verify and verify-before-first-load | Always hash | Multi-GB cost |
| Legacy caches (proposed) | Deliberately ignored, documented | Migration | Unverifiable files must not be adopted |
| Pages hosting (proposed) | GitHub Pages via Actions | Cloudflare Pages | No secrets; repo already on GitHub |
| Installer (proposed) | NSIS via Wails | MSI or MSIX; portable only | Flag already in CI |
| Docs site generator | Undecided; spike first (Phase 10) | VitePress, MkDocs, Docusaurus, Starlight | Evidence on the real tree |

## Research Summary

**Market Context**
- Comparable desktop tools that download models on demand generally show a model list with size and state; TBD - needs research for specific competitors' UX and any licensing or hosting practices worth copying. No comparison was made for this PRD.
- Documentation and component-library publishing on GitHub Pages is a common pattern for public repositories (the kit skill documents the workflow); it needs no third-party account.

**Technical Context**
- Reused, verified: `apps/desktop/internal/assets` lifecycle, the Piper and Whisper catalogs and gates, the settings layers, the job and binding patterns, the visual suite and atlas, `ui-atlas-kit` docs generation, the release scripts (`collect-assets.mjs`, `generate-notes.mjs`, `promote.mjs`, `verify-installable.mjs`, `sync-version.mjs`) and the prerelease and promote workflows.
- Unverified: spaCy model loading from a directory in the frozen sidecar and the model license (Phase 4); Range and rate-limit behavior of the model hosts; whether the CI runner has `makensis` and whether any release ever contained an installer (what `wails build -nsis` does without a local definition is now read from the Wails module: default `project.nsi`, warns and skips without `makensis`); how to smoke-test a GUI package in CI; whether the pinned action versions in the workflows exist; Pages behavior under a project sub-path.
- Discrepancies found while writing this PRD are listed in the hand-off message.

---

*Generated: 2026-09-19*
*Status: DRAFT - needs validation*
