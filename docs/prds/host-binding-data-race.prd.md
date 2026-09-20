# Host Binding Data Race

**Supersedes:** `docs/architecture/host-binding-concurrency.md` (planned-work brief, removed when this PRD landed; recoverable from git history)

Defect PRD for the known issue that brief documented. Citations are `file:line` on branch `claude/features-defects-prds-planning-87c378` (b9d348d; re-checked at main d5cc994, where `git diff b9d348d..HEAD -- shell` touches only `apps/desktop/go.mod` and `apps/desktop/go.sum`, so every `apps/desktop/` line number and count below still holds, and `hostAPIVersion` is still 5 at `apps/desktop/app.go:33`) for anything checked in code; "per docs" marks a claim from a doc not re-verified. The brief was partly stale (wrong field list, wrong counts, wrong description of one "safe" pattern); the corrected picture is in Evidence. This PRD does not change any product behavior and does not change the binding surface.

**Reconciled with the [implementation plan](implementation-plan.md) (stack S03, tracking issue #59).** The repository layout move (ADR 0040) already rewrote every path below to `apps/desktop/`, `apps/ui/` and so on; the `file:line` numbers were not re-derived and drift as phases land (the counts and the field list were re-verified at the phase 1 base and still hold: the guard test lists 51 functions after phase 1, see its `directReadAllowlist`). Open Questions 1 to 9 take their recommendations (owner decision D22, answered below), coverage follows D18 (a ratchet on logic directories, not a blanket 80%), and the next free ADR number is 0041. Phase 1 also folded `TeleprompterStart` into the accessor (it mixed a snapshot with a bare `h.whisper` read) and made `tracksDiscover`/`tracksSelect` share one snapshot; the accessor's struct also carries the launch `config`, so the project folder and the settings store of one call come from one project.

## Problem Statement

Every project switch (picker, "open recent", REAPER second launch) reassigns seven service pointers on `Host` under `h.mu.Lock()`, while most Wails bindings read those same pointers with no lock, which is a data race under the Go memory model. The picker made switching a routine, user-driven action that can overlap the UI's ordinary polling calls, so a latent problem became reachable. The cost of leaving it: undefined behavior that a `-race` run would flag, stale or half-initialized service reads that are impossible to reproduce on demand, and no test or check that stops the next binding (several concurrent PRDs add bindings) from repeating the pattern.

## Evidence

Verified in code:

- **History (from the brief).** The pattern predates the project picker: the REAPER second-instance path (`onSecondInstance`) already reassigned the pointers under the lock while bindings read them bare, but that was a rare, REAPER-only event. The picker turned switching into a routine action that can overlap the polling calls the UI already makes (`GuideBuildState`, `TtsInstallState`, `TranscriptLastCompleted`). The brief was written while reviewing the picker; its claim that the new `Project*` bindings and `ManuscriptSelectFile` set the locking model is only true for `ctx` (see the read-side count below).
- **The write side.** `configureLocked` (`apps/desktop/app.go:123-179`) reassigns **seven** pointer fields, not the four the doc names: `settings` (`:126`), `manuscript` (`:146`), `guide` (`:148`), `tts` (`:159`), `whisper` (`:167`), `transcript` (`:173`), `teleprompter` (`:178`). Callers hold `h.mu.Lock()`: `Startup` (`:113`), `attachProjectLocked` (`:401`) via `onSecondInstance` (`:414`) and `ProjectSwitch` (`apps/desktop/bindings.go:203`). `h.recents` and `h.sidecars` are set once in `NewHost` (`app.go:91`) and never reassigned, as the doc says.
- **The read side, counted.** `apps/desktop/bindings.go` has 65 exported `Host` methods (each is a Wails binding; `Bootstrap` in `app.go:560` is a 66th). Classified by reading each body:
  - **44 dereference a swappable pointer directly with no lock**: `Tts{Catalog,Remove}`, `Whisper{Catalog,Remove}`, `Guide{Entities,Edit,SetLocked,Rescan,Create,Merge,Delete,Relate,Unrelate,Preview}`, all 19 `Manuscript*` (including `ManuscriptSelectFile`, which snapshots only `ctx` under the lock and then reads `h.manuscript` unguarded at `bindings.go:265`, so it is not the model the doc says it is), `Transcript{Start,Cancel,Reset,LastCompleted,AddEquivalence,Jump,ExportMarkers,SuggestHints,Hints,SaveHints}`, and `TeleprompterStart` (reads `h.whisper`, `bindings.go:407-417`).
  - **5 more reach a pointer through helpers in `app.go`**: `SystemSettingsForScope` (`settingsForScope`, `:688-695`), `SystemSaveSettings` (`saveSettings` `:725`, plus `Bootstrap`), `TtsInstall` (`startTtsInstall` `:728-740`), `WhisperInstall` (`startWhisperInstall` `:783-795`), `GuideBuild` (`startGuideBuild` reads `h.guide` at `:838` before taking the lock and again inside its goroutine at `:876`). `resolveWhisperModelID` reads `h.settings` (`:645`) and `Bootstrap` reads `h.transcript` (`:585-586`).
  - **16 are already safe**: `TtsInstallState/Cancel`, `WhisperInstallState/Cancel`, `GuideBuildState`, `ProjectSelectFolder`, `ProjectSwitch`, `ProjectCreate`, `ProjectRecents`, `ProjectRemoveRecent`, `SystemReportDiagnostic`, `Teleprompter{Stop,State}` (via `teleprompterService()`, `app.go:649-655`, which already snapshots under `RLock`), `Tracks{Discover,Select,List}` (`apps/desktop/tracks.go:17-19,42-44`). Also safe: `emit*` (`app.go:320-347`), `transcriptLoop` (`:357-359`), `Shutdown` (`:371-373`).
  - So **49 of 65 bindings plus `Bootstrap` race** ("the majority", as the doc says, and worse than "a handful of examples" suggested). Field reference counts in `bindings.go` (lines mentioning the field, including nil checks): guide 25, manuscript 20, transcript 20, whisper 12, tts 8, settings 4.
- **What the race can and cannot do.** Go pointer writes are word-sized, so a torn pointer is not expected on the supported platform; the concrete risks are (1) a reader using the pre-switch service for a call that overlaps the switch, (2) unsynchronized publication (the reader may see the new pointer before the new object's fields under the memory model), and (3) `-race` reporting it the moment any test interleaves the two. No known user-visible failure is recorded. Severity is therefore **medium, latent**; this is an assumption to validate with the stress test in Phase 1, not an observed incident.
- **Nothing currently exercises it.** No test runs a binding concurrently with a switch (the only goroutine in `apps/desktop/*_test.go` is the `Shutdown` wrapper at `teleprompter_test.go:92`). CI runs `go -C apps/desktop test -race ./...` on ubuntu and windows (`.github/workflows/_quality.yml:144`), but local `pnpm check` runs `go test ./...` without `-race` (`scripts/quality.mjs:170`), and this Windows machine cannot run the detector: `go env CGO_ENABLED` is `0` and no `gcc` is on PATH. So a local green proves nothing about races.
- **Two constraints any fix must respect (lock ordering).** The `emit*` callbacks take `h.mu.RLock()` (`app.go:320-347`), and `Shutdown` deliberately stops the teleprompter without holding `h.mu` for that reason (`app.go:369-370`, ADR 0022). `canAttachLocked` calls into services while holding `h.mu.Lock()` (`:495-502`). Therefore a snapshot must be copy-and-release; holding `RLock` across a service call risks a recursive read lock behind a queued writer, which deadlocks.
- **The two smaller items are real.** `ProjectCreate` runs `os.MkdirAll(path)` (`bindings.go:223`) before `attachProjectLocked` applies the busy guard (`app.go:398-400`), so a refused create leaves an empty folder; it also passes a relative path straight to `MkdirAll`. `configureLocked` rebuilds `tts.New` (`:158`) and also `whisper.New` (`:166`, not mentioned in the doc) on every attach; each reads one small catalog JSON (`apps/desktop/internal/tts/catalog.go:36-46`, `whisper/catalog.go:39-49`), so the cost is two small file reads, negligible next to the correctness issue. `release-readiness-provisioning-and-docs-site.prd.md` Phase 3 already plans to hoist the managers out of `configureLocked`, which would remove this item and shrink the set of swappable pointers.
- **The flaky test is a different bug, already fixed.** `TestShutdownStopsARunningTeleprompterWithoutDeadlocking` failed in 6 Go jobs across 4 CI runs on 2026-09-19 (15:01Z to 17:09Z; ubuntu four times, windows twice; `gh run view --log-failed`), always as "the teleprompter session should be stopped after Shutdown" (`teleprompter_test.go:103`) after about 1.0 s, i.e. `Shutdown` returned, not a deadlock. Before commit `0e703d5` (PR B), `teleprompter.Service.Close` waited on `child.Done()`, which closes before the watcher goroutine records the final phase, so `Busy()` could still be true; that commit added the `finished` channel closed after the state is recorded and made `Close` wait on it (`apps/desktop/internal/teleprompter/service.go:46-48,190-194,259,292-309`). No Go job has failed in the eight completed CI and Prerelease runs since (small sample, `gh run list`). Root cause is unrelated to `h.mu` or the service pointers. The retired UI-defects register carried a stale note that still described it as an open flake; that note disappears with the register, so there is no doc to correct.

## Proposed Solution

Add one accessor that returns a value-struct snapshot of the seven pointers under a single `RLock` and releases before use, convert every affected binding and helper mechanically to `svc := h.services()` (mirroring `teleprompterService()` and the doc's own proposal), and stop the regression two ways: a `-race` stress test that flips projects while hammering the read bindings, and an AST test that runs in plain `go test` (no cgo) and fails when any function outside a short allowlist selects `h.<swappable field>`. Roll it out as a ratchet (the allowlist can only shrink, the same pattern as the atlas a11y debt list, `apps/ui/tests/atlas/a11y-debt.ts`), in small domain-by-domain PRs, then fix the two small items.

## Key Hypothesis

We believe a copy-and-release snapshot accessor plus an AST guard and a race stress test will remove the host data-race class for the developer maintaining `apps/desktop/` and keep new bindings from reintroducing it. We'll know we're right when the stress test fails on the pre-fix commit under `-race` in CI and passes after, direct reads of the seven fields outside the allowlist are zero, and no full-suite run (`-race -count=20`) reports a race.

## What We're NOT Building

- An `atomic.Pointer[services]` refactor - larger diff; tests assign the fields directly in seven places across two files (`app_test.go:175,188`, `teleprompter_test.go:60,112`, and reads at `app_test.go:209,261`, `teleprompter_test.go:253`), so it would churn tests for no extra safety here. Kept as a Could.
- A global lock serializing bindings - kills concurrent UI polling and invites deadlocks with the `emit*` callbacks.
- Holding `h.mu.RLock` across service calls - deadlock risk (Evidence, lock ordering).
- Making a project switch wait for or refuse in-flight `Guide*` subprocess calls - `canAttachLocked` covers import drafts, jobs, transcript and teleprompter only; extending it is a separate scope decision (Open Question 4).
- Validating `ProjectSwitch`/`ProjectCreate` paths beyond the small `ProjectCreate` changes below - adjacent hardening, separate.
- A fix for `TestShutdownStopsARunningTeleprompterWithoutDeadlocking` - already fixed in `0e703d5` and a different root cause; this PRD only stress-runs it as a check.
- Any change to the host API surface or `hostAPIVersion` - the binding signatures do not change (verify by an empty regenerated `Host.{js,d.ts}` diff).
- A third-party linter - CI uses `go vet` and `staticcheck`, neither has a check for this.
- Memoizing or hoisting the TTS and whisper managers - release-readiness Phase 3 owns hoisting them out of per-project state; doing both would collide in `configureLocked`.

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Bindings and helpers reading a swappable field outside the accessor | 49 bindings plus `Bootstrap` today, 0 at the end | AST guard test (allowlist shrinks each PR, reaches empty) |
| Race stress test detects the defect | Fails on the pre-fix commit under `-race`, passes after | Run in CI (ubuntu) or WSL; TBD - measure detection rate over 20 runs before merging |
| Race-free full suite | `go test -race -count=20 ./...` green, both CI OSes | CI (temporary `-count`) and one manual run |
| New binding regressions | Adding a direct `h.guide` read in a new binding fails a local `go test` | AST guard (no cgo needed); demonstrate with a deliberately bad fixture |
| Refused `ProjectCreate` leaves no folder | 0 folders created when busy | Go test using the busy setup at `app_test.go:231-247` |
| Flake check | `-race -count=200 -run TestShutdownStops...` green | One manual stress run recorded in the Phase 1 PR |
| Host API surface | Unchanged; no version bump | Empty diff of regenerated `apps/ui/wailsjs/go/main/Host.*` |
| Behavior | Existing Go tests pass unchanged | `go -C apps/desktop test ./...` and `pnpm check` |

## Open Questions

- [x] **1. Snapshot shape.** Options: (a) one `services()` accessor returning a struct of all seven pointers under one `RLock` (consistent snapshot across a call that uses several, for example `GuidePreview` uses guide, settings and tts; `TranscriptSuggestHints` uses guide and transcript); (b) per-field accessors like `teleprompterService()`; (c) `atomic.Pointer[services]`. Recommendation: (a). It is mechanical, keeps tests unchanged, and avoids mixing an old guide with a new transcript inside one call, which (b) allows. **Answered (D22): (a). `services()` returns a `hostServices` value struct (the seven pointers plus the launch `config`) under one `RLock`.**
- [x] **2. Regression guard.** Options: (a) AST test in `go test` with a ratcheting allowlist plus the `-race` stress test; (b) only the stress test; (c) move the fields behind an unexported sub-struct for compile-time enforcement. Recommendation: (a). The stress test only bites where cgo works (CI); the AST test bites locally, which matters because this developer machine cannot run `-race`. **Answered (D22): (a). `hostguard_test.go` (AST guard, ratcheting allowlist) plus `hostrace_test.go` (`-race` stress test).**
- [x] **3. Local race checking.** Options: (a) leave `pnpm check` as is and rely on CI's `-race`; (b) add `-race` to `scripts/quality.mjs:170` when `go env CGO_ENABLED` is `1`. Recommendation: (a); it keeps the local gate portable, and the AST test covers the common regression. **Answered (D22): (a). `pnpm check` is unchanged; CI's `-race` and the AST guard cover it.**
- [x] **4. Scope of "busy" during a switch.** `canAttachLocked` ignores in-flight `Guide*` mutations and `ManuscriptImportCommit` seeding. Options: (a) out of scope, file as a follow-up; (b) extend the guard now. Recommendation: (a); it is a behavior change with its own design (counters per service) and would widen this mechanical PR. **Answered (D22): (a). Out of scope; filed as #60.**
- [x] **5. `ProjectCreate` ordering and validation.** Options: (a) check `canAttachLocked` under `RLock` first, `MkdirAll` only if free, and require an absolute path (attach re-checks under the write lock, so a lost race at worst leaves an empty folder); (b) `MkdirAll` then remove the folder if attach is refused and we created it; (c) leave as is (the doc calls it low harm). Recommendation: (a). **Answered (D22): (a), delivered in Phase 4.**
- [x] **6. TTS and whisper manager rebuild.** Options: (a) leave it to release-readiness Phase 3, which hoists the managers out of `configureLocked`; (b) memoize here by (catalog path, cache root) (building once in `Startup` is unsafe because `--repo-root` can arrive changed on a second launch, `app.go:410`); (c) leave as is. Recommendation: (a). The measured cost is two tiny reads, and a memoization here would collide with that phase. If that PRD is dropped, revisit (b). **Answered (D22): (a). Left to release-readiness Phase 3; the accessor struct shrinks if `tts` and `whisper` leave the swappable set.**
- [x] **7. Flaky teleprompter test.** Options: (a) treat as fixed by `0e703d5`, and verify with a one-off `-race -count=200` run (the stale flake note in the retired UI-defects register is gone with that register, so nothing else needs correcting); (b) keep it open for more CI history; (c) fold anything further into this PRD. Recommendation: (a); code and CI history agree on root cause, and it is not a lock-ordering problem. Open only if the stress run fails. **Answered (D22): (a). No code change; the one-off `-race -count=200` run needs cgo, which this Windows machine lacks, so it is recorded as pending for CI in the Phase 1 pull request.**
- [x] **8. PR split.** Options: (a) one large mechanical PR; (b) four PRs: infrastructure plus guard, then two domain conversions, then the small items and allowlist removal. Recommendation: (b), each reviewable in one sitting and each shrinking the ratchet. **Answered (D22): (b), four stacked pull requests.**
- [x] **9. Sequencing against concurrent binding work.** Several PRDs add bindings (`SystemNotify`, `SystemLookup`, seek, findings, measure). Options: (a) land Phase 1 first and require new bindings to use `h.services()`; (b) freeze other binding PRs until Phases 2-3 merge; (c) let new bindings inline an `RLock` snapshot and rebase. Recommendation: (a), with (c) as the fallback if Phase 1 is not merged; never a direct field read. **Answered (D22): (a). Phase 1 lands first and later stacks build new bindings on `h.services()`; the guard fails a direct read.**

## Users & Context

Honest framing: this is a defect in developer-facing code with an indirect narrator impact.

**Primary User**
- **Who**: the maintainer and any session adding or changing `apps/desktop/` bindings; secondarily the narrator whose project switch could overlap a poll.
- **Current behavior**: writes bindings by copying an existing one (most read `h.<service>` directly); CI's `-race` gives false reassurance because no test creates the interleaving.
- **Trigger**: adding or editing a binding; a project switch during UI polling.
- **Success state**: every binding reads services through one accessor, a new direct read fails a local test, and a race would fail CI.

**Job to Be Done**: When I add or change a binding, I want the safe way to be the only way that compiles or passes tests, so a project switch never races a poll.

**Non-Users**: narrators and REAPER users do not interact with this directly; no UI or behavior changes.

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability |
| --- | --- |
| Must | `services()` accessor: value snapshot of the seven pointers under one `RLock`, released before use |
| Must | Convert all 44 direct and 5 helper-reachable bindings plus `Bootstrap`, `resolveWhisperModelID`, `startGuideBuild` (both reads) |
| Must | `-race` stress test: alternating `ProjectSwitch` against two temp projects while goroutines call the read bindings |
| Must | AST guard test with a ratcheting allowlist that shrinks to empty |
| Should | `ProjectCreate`: busy pre-check before `MkdirAll`, absolute path required |
| Should | Convert the already-safe sites (`teleprompterService()`, `tracks.go`, `Shutdown`, `transcriptLoop`) to the accessor so there is one pattern |
| Should | Once `services()` exists, repoint the two code comments (`apps/desktop/app.go:650`, `apps/desktop/tracks.go:11`) to its doc comment. They were repointed from the removed brief to this PRD by the docs-replacement change, so the removed-brief citation is already fixed |
| Could | `atomic.Pointer[services]` in a later refactor |
| Won't | Global lock, held `RLock` across service calls, extending `canAttachLocked`, path validation beyond `ProjectCreate`, manager memoization (release-readiness Phase 3 hoists them) |

### MVP Scope

Phases 1 to 3: accessor, guard, stress test and every conversion. Phase 4 (small items, cleanup) can follow.

### User Flow

Developer-facing only: a binding calls `svc := h.services()`, uses `svc.guide` and friends, and never touches `h.guide`. Attempting `h.guide` in a new function fails `go test`.

## Technical Approach

**Feasibility**: HIGH. The change is mechanical; the only design care is copy-and-release and the tests.

**Architecture Notes**
- **Accessor**: one small struct type holding the seven pointers and a method on `Host` that takes `h.mu.RLock()`, copies, and returns. No service call happens while the lock is held. Nil checks stay as they are (a service can legitimately be nil, for example `tts` when the catalog is missing).
- **Callers not in `bindings.go`**: `app.go` helpers (`settingsForScope`, `saveSettings`, `startTtsInstall`, `startWhisperInstall`, `startGuideBuild`, `resolveWhisperModelID`, `Bootstrap`); the goroutines inside `startTtsInstall`/`startWhisperInstall`/`startGuideBuild` must use the snapshot taken before they start, not re-read the field (`app.go:740,795,876`); `ManuscriptImportCommit`'s post-commit closure uses `h.guide` and should capture the snapshot.
- **Stress test**: call `ProjectSwitch` with two `t.TempDir()` projects in one goroutine while several goroutines loop over read bindings that tolerate errors (`ManuscriptChapters`, `ManuscriptReaderState`, `GuideEntities`, `GuideBuildState`, `TtsCatalog`, `WhisperCatalog`, `TranscriptHints`, `TranscriptLastCompleted`, `TeleprompterState`, `SystemSettingsForScope`, `Bootstrap`, `TracksList`). `h.ctx` is nil in tests, which `ProjectSwitch` tolerates (`bindings.go:209`). Bounded iteration counts, no sleeps. Existing tests already call `configureLocked`/`attachProjectLocked` (`app_test.go:197-262`); note that `configureLocked` may materialize embedded resources into the user cache when developer sidecars are absent (`app.go:129-131`), which is existing test behavior.
- **AST guard**: parse the non-test files of package `main` with `go/parser`; flag `SelectorExpr` on the receiver `h` selecting one of the seven names; allow only `NewHost`, `configureLocked`, `canAttachLocked`, the accessor, and the ratchet allowlist. The test also fails if an allowlisted function no longer violates, so the list cannot go stale.
- **TDD order**: RED needs the race detector, which this machine lacks; demonstrate RED once in CI (temporary branch) or WSL, GREEN as conversions land. The AST test gives local RED/GREEN.
- **CLAUDE.md gates**: no `apps/ui` change, so no Playwright run; no `integrations/reaper` change. `pnpm check` (not `check:fast`) before done.

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Holding `RLock` across a service call deadlocks with `emit*` callbacks and a queued writer | Medium | Copy-and-release only; a test that calls `services()` from inside a callback path; review checklist item |
| Merge conflicts with concurrent sessions adding bindings | High | Land Phase 1 first and publish the accessor; conversion PRs are small and rebase cleanly; see compatibility table |
| Stress test slow or flaky | Low | Fixed small iteration counts, no sleeps, no real sidecars |
| AST guard false positives or brittle allowlist | Low | Match on receiver and field name only; allowlist is one function name per line, sorted |
| Behavior drift from reordering nil checks | Low | Mechanical edits, existing Go tests unchanged, one domain per PR |
| Race detector unavailable locally | Certain here | AST guard runs locally; race test runs in CI and WSL |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Accessor, guard and stress harness | `services()`, AST guard with the full current violation list as allowlist, stress test over already-converted bindings, convert the already-safe sites, one-off flake stress run | complete | - | - | - |
| 2 | Convert Manuscript and Guide | `Manuscript*`, `Guide*` bindings, `startGuideBuild`, import-commit closure; shrink allowlist; extend stress test | pending | 3 | 1 | - |
| 3 | Convert Tts, Whisper, Settings, Transcript, Bootstrap | Remaining bindings and `app.go` helpers including install goroutines; shrink allowlist; extend stress test | pending | 2 | 1 | - |
| 4 | Small items and cleanup | `ProjectCreate` ordering and path check, remove the allowlist (empty), point the two code comments at the `services()` doc comment (they cite this PRD today), `feature-cleanup` | pending | - | 2, 3 | - |

### Phase Details

**Phase 1 - Accessor, guard and stress harness**
- **Goal**: the safe pattern exists, is enforced, and is testable before any mass edit.
- **Scope**: new accessor in `apps/desktop/app.go` (or a small new file); new `apps/desktop/hostguard_test.go` (AST guard, allowlist listing every currently violating function) and `apps/desktop/hostrace_test.go` (stress test covering only bindings already converted, plus `TeleprompterState`, `TracksList`, `ProjectRecents`); convert `teleprompterService()`, `tracks.go`, `Shutdown`, `transcriptLoop`; record a `go test -race -count=200 -run TestShutdownStops ./` result.
- **Success signal**: AST guard green with the full allowlist and red on a deliberately bad fixture; stress test green; no binding signature changes.
- **Delivered**: the accessor is `apps/desktop/services.go` (`hostServices`, `Host.services()`); `teleprompterService()` is gone; `TeleprompterStart` was converted here too, and `tracksDiscover`/`tracksSelect` share one snapshot through `discoverTracks`. The guard's allowlist started with 51 functions. The stress test (`stressReaders`) covers the already-safe read bindings, the emit callbacks and the Tracks bindings; each later phase adds rows for what it converts. Pending, needs cgo: the `-race` demonstration and the one-off `-race -count=200 -run TestShutdownStops` run (CI runs the suite with `-race`; the numbers are in the phase 1 pull request).

**Phase 2 - Convert Manuscript and Guide**
- **Goal**: the two largest groups (about 29 bindings) read through the accessor.
- **Scope**: `bindings.go` Manuscript* (`:251-371`) and Guide* (`:93-173`), `seedCharacterCandidates` (`:305-330`), `startGuideBuild` (`app.go:837-893`), import-commit closure (`:286-296`); allowlist entries removed; stress test binding list extended.
- **Success signal**: allowlist shrinks by those functions; existing tests pass unchanged; empty `Host.*` regeneration diff.

**Phase 3 - Convert Tts, Whisper, Settings, Transcript, Bootstrap** (`TeleprompterStart` moved to Phase 1)
- **Goal**: the rest.
- **Scope**: `TtsCatalog/Remove`, `WhisperCatalog/Remove`, `Transcript*` (`:373-506`), `settingsForScope`, `saveSettings`, `startTtsInstall`, `startWhisperInstall`, `resolveWhisperModelID`, `Bootstrap`; install goroutines use the captured snapshot.
- **Success signal**: allowlist reaches zero for these; stress test covers them.

**Phase 4 - Small items and cleanup**
- **Goal**: close the two smaller items and finish the ratchet.
- **Scope**: `ProjectCreate` (`bindings.go:219-227`) checks `canAttachLocked` under `RLock` before `MkdirAll` and requires an absolute path, with a test; delete the allowlist so the guard has no exceptions; repoint the comments at `apps/desktop/app.go:650` and `apps/desktop/tracks.go:11` (they cited the removed `host-binding-concurrency.md` and now cite this PRD, changed by the docs-replacement change) to the accessor's doc comment, which carries the field list; the flake note in the retired UI-defects register is gone with that register, so nothing else to fix there.
- **Success signal**: guard with no allowlist green; busy `ProjectCreate` leaves no folder; the comments name the accessor; `pnpm check` green.

### Parallelism Notes

Phase 1 must land first. Phases 2 and 3 edit different regions of `bindings.go` and `app.go` but both edit the shared allowlist and the stress test's binding list; keep the allowlist one entry per line, sorted, to make rebases trivial, or run them in order 2 then 3 if a session prefers no rebases. Phase 4 follows both.

### Parallel-session compatibility

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 1 | `apps/desktop/app.go` (new type and accessor, `Shutdown`, `transcriptLoop`, `teleprompterService`), `apps/desktop/tracks.go`, new `apps/desktop/hostguard_test.go` and `apps/desktop/hostrace_test.go` | Low; additive. Announce the accessor so concurrent sessions use it in new bindings. release-readiness Phase 3 also edits the `Host` struct and `configureLocked`; if it lands first, `tts` and `whisper` may leave the swappable set and the accessor struct should shrink accordingly |
| 2 | `apps/desktop/bindings.go` lines `:93-173` and `:251-371`, `apps/desktop/app.go` `startGuideBuild` | **High.** Any concurrent session adding or editing Manuscript/Guide bindings (interaction-feedback-audit phase 4 batches `GuideEdit`; story-bible-and-import-ux-briefs phases 5 and 10 change `ManuscriptImportCommit` and Guide edit paths) |
| 3 | `apps/desktop/bindings.go` lines `:41-91` and `:373-506`, `apps/desktop/app.go` helpers `:641-893` | **High.** Any session touching Transcript/Tts/Whisper bindings, `fieldSchemas`/`saveSettings` (teleprompter-engines, diagnostics PRDs), or adding bindings (findings, measure, seek, `SystemNotify`, lookup) |
| 4 | `apps/desktop/bindings.go` `ProjectCreate`, comments in `apps/desktop/app.go` and `apps/desktop/tracks.go` | Low to medium |

Sequencing: because this work rewrites nearly every binding body, merge Phase 1 first, then run Phases 2 and 3 quickly and back to back, and ask concurrent sessions that add bindings to build on `h.services()` from Phase 1 or to rebase onto Phases 2-3. A binding added meanwhile with a direct field read will fail the guard (that is the point). Cross-cutting: no `hostAPIVersion` bump (no signature change; if a regenerated `Host.*` diff is non-empty something is wrong); no ADR is expected, but if one is written re-check `docs/adr/` numbering first and take the next free number at merge time (0027 at d5cc994); every phase follows `CLAUDE.md`: plan, `change-impact-scan` (`apps/desktop/` consumers and tests), TDD, `full-verification-gate` (`pnpm check`), `feature-cleanup`. `design-spec-guard` and the Playwright suite do not apply (no `apps/ui` change).

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Snapshot-then-release under `h.mu.RLock` (prior decision, the retired `host-binding-concurrency.md` brief, recoverable with `git show d5cc994:docs/architecture/host-binding-concurrency.md`; precedent `teleprompterService()`, `app.go:649-655`) | Adopt as the pattern | Held lock across the call | Avoids recursive-read deadlock behind a queued writer |
| Never hold `h.mu` across service `Close` or callbacks (prior decision, ADR 0022, `app.go:369-370`) | Keep | - | The `emit*` callbacks take `h.mu.RLock` |
| Project switch refused while busy (prior decision, `canAttachLocked`) | Unchanged | Extend to all in-flight ops | Out of scope |
| Fix is a separate change, not folded into the project-picker feature (prior decision, brief "Why not fixed in the same pass") | Systemic mechanical change reviewed on its own | Bundle with the picker | Touches dozens of unrelated bindings with its own regression risk |
| `h.recents`, `h.sidecars` need no guard (prior decision, verified) | Left as is | Guard anyway | Set once in `NewHost` |
| CI runs `-race` (prior decision, `_quality.yml:144`) | Keep; add a test that interleaves | Rely on existing tests | No test creates the interleaving |
| Workflow and gates (prior decision, `CLAUDE.md`) | plan, impact scan, TDD, `pnpm check`, cleanup | Fast check only | History of silent regressions |
| Nothing merges without the user (prior decision) | User merges every PR | Auto-merge | Standing rule |
| Accessor shape | `services()` value snapshot of the seven pointers plus the launch `config` (D22; delivered in Phase 1) | Per-field, atomic pointer | Consistent, mechanical, tests unchanged |
| Guard mechanism | AST test with ratcheting allowlist plus race stress test (D22; delivered in Phase 1) | Stress only, compile-time structure | Works locally without cgo |
| PR split | Four PRs, guard first (D22) | One PR | Reviewable, shrinks the ratchet |
| Flaky teleprompter test | Treated as fixed by `0e703d5`, not folded in (D22); the one-off `-race -count=200` run is pending for CI (no cgo locally) | Fold into this PRD | Different root cause (`Close` waited on process exit, not state) |
| `ProjectCreate` and manager rebuild | `ProjectCreate` checks busy first and needs an absolute path (Phase 4); the manager rebuild stays with release-readiness Phase 3 (D22) | See Open Questions 5 and 6 | Answered by owner decision D22 (adopt the recommendations) |
| `canAttachLocked` scope | Out of scope, filed as #60 (D22) | Extend the guard here | A behavior change with its own design; keeps this change mechanical |
| Coverage gate | Ratchet, not a blanket 80% (D18); the guard's allowlist is the ratchet for this PRD | 80% on new Go | Owner decision D18 |

## Research Summary

**Market Context**
- Not applicable; internal defect. No external research was done. The pattern (snapshot a pointer under a read lock and use it after unlocking; the alternative being an atomic pointer to an immutable struct) is standard Go practice; confirming it against current Go memory-model guidance is TBD.

**Technical Context**
- Verified in code: the seven reassigned fields and their callers; the per-binding classification (44 direct, 5 via helpers, 16 safe, plus `Bootstrap`); existing snapshot precedents; lock-ordering constraints; CI `-race` and its absence locally; absence of any concurrent-binding test; the `ProjectCreate` ordering; the `Close`/`finished` fix in `0e703d5` and the CI failure history (`gh run view --log-failed`, runs 35450405764, 35450645580, 35456259702, 35457174727).
- Adjacent findings, not fixed here: `TestImportJobReportsRealProgressAndLogs` failed once on windows-latest (`apps/desktop/internal/manuscript/service_test.go:94`, "percent 100 elapsed 0", run 35423277660), likely a coarse Windows clock; `Supervisor.Run` calls `command.Wait()` before its pipe readers finish (`apps/desktop/internal/process/supervisor.go:98-101`), which the `os/exec` docs say is incorrect for `StdoutPipe` and which could truncate a sidecar's last output line; `ProjectSwitch` attaches to any path string without checking it is an existing directory.
- Not verified: the stress test's detection rate on the pre-fix commit (TBD - measure); behavior under the Windows race detector.

---

*Generated: 2026-09-19*
*Status: DRAFT - needs validation*
