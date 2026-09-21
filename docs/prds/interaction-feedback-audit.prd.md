# Interaction Feedback Audit

**Supersedes:** `docs/architecture/interaction-feedback-backlog.md` (planned-work brief, removed when this PRD landed; recoverable from git history)

Audit of every async action (click, then network or subprocess call, then UI update) against a written feedback standard, grounded by measured Python-subprocess latencies, followed by fixes for the gaps. Source: the interaction-feedback backlog brief named above. Citations are `file:line` on branch `claude/features-defects-prds-planning-87c378` (b9d348d; re-checked at main d5cc994, where `apps/desktop/` differs only in `go.mod`/`go.sum` and `apps/ui/src` only in two doc-guide tests, so every line number and count still holds) for anything checked in code; "per docs" marks a claim from a doc not re-verified. The backlog's "confirmed and fixed" claim for the TTS download (its item 16) does not hold against the real host (Evidence), while its other fixed case (item 11) does; it is the first finding. The same defect was found independently by `release-readiness-provisioning-and-docs-site.prd.md` (its Evidence and Phase 1), which owns the fix; this PRD keeps the finding as evidence, tracks it as a catalog row, and does not duplicate the work.

## Problem Statement

A narrator clicks something that talks to the Go host or a Python sidecar and cannot tell whether anything happened, whether it is still running, or when it finished if they looked away. The backlog records two fixed cases and asks for a deliberate sweep; the evidence below shows more gaps than the doc knows about, including a shipped flow that cannot work against the real host. Cost of not solving: repeated clicks that fire overlapping subprocesses which rewrite the same file, completions nobody sees, and a standing "did it work?" doubt on the app's slowest screens.

## Evidence

Backlog claims re-checked, then new findings (all verified in code unless marked).

**1. The TTS voice download does not work against the real host (backlog item 16 is not actually closed).**
- The host reports the install job as `{id, voiceId, phase, message}` with `phase: "running"` (`apps/desktop/app.go:735,777-781`); the job struct has no percent and no error field, and `assets.Store`/`tts.Manager.Install` have no progress reporting at all (`apps/desktop/internal/tts/catalog.go:96-102`; no `percent`/`progress` in `apps/desktop/internal/tts` or `assets`).
- The UI contract says `phase: 'downloading' | 'success' | 'cancelled' | 'error'` plus `percent` and `error` (`apps/ui/src/api/contracts/tts.ts:26-33`), and `GuideDetail.tsx` keys everything on `'downloading'`: the poll loop (`:152-172`), the title, body, button label and progress bar (`:768-785`), cancel (`:173-184`). The Whisper contract, by contrast, uses `'running'` (`contracts/whisper.ts:24-29`; `TeleprompterPage.tsx:78`).
- The mock returns instant success with `percent: 100` (`apps/ui/src/api/mockApi.ts:521-533`), and no test in `apps/desktop/` or `apps/ui/{src,tests}` calls `ttsInstall`/`TtsInstall` (grep), so nothing exercised the mismatch.
- By reading the code, in the real host: after "Download voice" the first response has `phase 'running'`, the `while (phase === 'downloading')` loop is skipped, the flow falls to `notify(job.error || job.message)` and stops, the dialog never changes title, label or shows the bar (`Math.max(undefined, 4)` would be `NaN` if it did), and the download continues in the background with no completion signal and no automatic playback. The button stays enabled, and each click starts another install job (`startTtsInstall` creates a new job per call, `app.go:735-737`; whether the store serializes duplicate installs is TBD). Status: strongly indicated by code, needs a confirming run of the real app.
- ADR 0015 forbids a faked percent. The fix (align the UI to the host shape, real byte progress in `assets.Install`, one job snapshot type, a shared poll hook, a scripted mock, a host API bump) is release-readiness Phase 1; it also corroborates this finding independently. Until it merges, this audit only records the rows.

**1b. The backlog's other "fixed" case (item 11, misleading error on the first Story Bible build) does hold.** `Guide.tsx:83-96` awaits `load()` before showing success and dismissing the build dialog, with a comment explaining that the stale-render race used to trip the route `ErrorBoundary` and read as a failed build. It is the model for "a failure or race in a follow-up step must not look like the action failed" (the same rule the briefs PRD applies to build-after-import) and gets a catalog row marked closed. No automated test pins it (grep for `guideBuild`, "Story Bible rebuilt" and the build dialog finds none in `apps/ui/src` or `apps/ui/tests`; the visual suite has no build state), so Phase 3 or 5, whichever first touches that effect, adds one before moving it.

**2. Story Bible mutations have no in-flight state and each spawns a cold Python process.**
- Every mutating binding goes `guide.Service.Run` then `Supervisor.Run` with a fresh process (`apps/desktop/internal/guide/service.go:107-130`, `apps/desktop/internal/process/supervisor.go:76-114`). `GuideEdit` spawns **one process per field** (`apps/desktop/bindings.go:108-112`); the Save button sends four fields (`GuideDetail.tsx:301-310`), so one Save is four sequential cold starts. `GuideCreate` spawns one and also computes pronunciations. `seedCharacterCandidates` spawns one per checked candidate (`bindings.go:316-326`).
- `GuideDetail.tsx` and `Guide.tsx` hold no busy, saving or pending state (grep); handlers `save` (`GuideDetail.tsx:129-140`), `createNewEntity` (`:185-192`), `rescanOccurrences` (`:194-201`), lock (`:275`), relate/unrelate (`:707`, `:658`), delete and merge (`:828`, `:846`) await the call and then toast. Between click and toast the control looks unchanged and can be clicked again.
- Overlapping calls are unsafe: each process does read-modify-write of `manuscript_guide.json`, and `write_json` writes a fixed `.tmp` sibling then `os.replace` (`sidecars/manuscript-guide/core/manuscript_guide.py:729-734`), so two concurrent writers can lose an update or collide on the temp file (not reproduced). The code comment at `bindings.go:301-304` already says concurrent writers would race.
- **Measured** cold-start cost, one machine, dev venv, Windows, warm disk cache, 2-3 samples each (frozen sidecar not measured, TBD): interpreter 54 ms; `manuscript_guide.py --help` (module import only) 286-339 ms, dominated by the module-level `from piper.voice import PiperVoice` (`manuscript_guide.py:30`, about 265 ms), which every subcommand pays though only `render-audio` needs it; `pronouncing` import plus lookup about 340 ms (used by `create` and alias edits); `import spacy` about 750 ms (model load not measured: `en_core_web_sm` is not installed in that venv). Implication, as a lower bound before Go and JSON I/O: a one-field edit is at least about 0.3 s, `create` about 0.6 s, a four-field Save at least about 1.2 s. All exceed the 100 ms acknowledgment threshold, and none has an acknowledgment. Not measured: `build`, `rescan` and `merge` on a full-length manuscript, `render-audio` (adds Piper voice load), the frozen release sidecar (PyInstaller startup is often slower).
- The uncached pronunciation preview has the same gap: `playPreview` awaits `guidePreview` (Go, then `render-audio` with Piper voice load) with no loading state until sound starts (`apps/ui/src/components/storybible/usePreviewAudio.ts:54-100`).

**3. Completion signals are page-scoped and short-lived.**
- Story Bible build polling lives in a `Guide.tsx` effect that stops on unmount (`Guide.tsx:77-102`); leaving the page mid-build loses the dialog and the success toast. The build `WorkDialog` has no Cancel and no Close while running; it now says so and stays blocking ([ADR 0057](../adr/0057-a-running-job-that-cannot-be-cancelled-keeps-its-dialog-blocking-and-says-so.md)).
- The only notification channel is one toast: a single string, fixed 2.4 s (`layout/Toast.tsx:8-9`), keyed by its text (`App.tsx:236`), so an identical message within 2.4 s neither restarts nor re-shows, and an error disappears as fast as a success. Native OS notifications are not implemented (the retired native-notifications brief, now carried by `story-bible-and-import-ux-briefs.prd.md`).

**4. First count of async call sites (method: enumerate then grep).**
- `NarrationApi` has 72 members across nine contract files (`apps/ui/src/api/contracts/`): Manuscript 19, Story Bible 12, Transcript 11, System 6, Project 5, Teleprompter 5, Tts 5, Whisper 5, Tracks 4. Seven are not request-response (four `subscribe*`, `mediaUrl`, `ready`, `reportClientDiagnostic`), leaving 65.
- Grepping `.<method>(` in non-test, non-story source outside `apps/ui/src/api/` finds **87 call sites in 12 files**: Manuscript.tsx 13, Transcript.tsx 12, GuideDetail.tsx 12, Home.tsx 11, TeleprompterPage.tsx 9, Settings.tsx 8, ProjectPicker.tsx 7, App.tsx 4, Results.tsx 3, Guide.tsx 3, TracksPage.tsx 3, AudiobookEstimatePanel.tsx 2. 64 of the 65 methods are called; `manuscriptReader` has no UI caller (a bound but unused method).
- Crude proxies, not verdicts: 59 sites have `notify`/an error setter within 14 lines; 72 have a `try`/`.catch` nearby; 12 have neither. Half of those 12 are false positives (six `ProjectPicker.tsx` sites run inside its `runAction` wrapper, `:43-53`, which sets `busy`, catches and shows the reason; it is the only place with an explicit in-flight state and the model to generalize). The rest need hand triage: `manuscriptImportCancel` (`Home.tsx:329`), `guideCreate` (`Manuscript.tsx:417`), `transcriptReset`/`transcriptCancel` (`Transcript.tsx:446,450,466`), `guidePreview` (`GuideDetail.tsx:73`).
- Silent failures by design: bare `.catch(() => {})` at `App.tsx:134,177`, `Home.tsx:55`, `Transcript.tsx:103`, `TeleprompterPage.tsx:139,148` (mount-time or on-leave calls; each needs a decision, not necessarily a fix).
- Go-native candidates to measure too (not Python): `tracksList` re-parses the `.rpp` on every call and `authorizedMediaPath` calls it on every `/media` request (`apps/desktop/media.go:51-64`); `ManuscriptSearch`/`Chapters`/`Reader` on a full manuscript.

## Proposed Solution

Write the standard down and adopt it as an ADR; measure real latencies of the Python-backed and heavy Go-native operations first (no assumption that any needs a loading state); build the inventory as a catalog kept honest by a ratchet test, one row per call site with a verdict; then fix gaps in order of user pain: Story Bible action feedback and double-submit protection, completion signals that survive navigation, then the rest. The broken TTS download flow and real download progress are owned by release-readiness Phase 1 and only tracked here. Where measurement shows the cost is avoidable (one spawn per field, an eager Piper import), reduce latency instead of only covering it with a spinner, without adding a persistent Python server (forbidden by `docs/architecture/codebase-map.md`).

## Key Hypothesis

We believe a written feedback standard, a measured latency table and a ratcheted call-site catalog will surface and close the missing-acknowledgment and lost-completion gaps in the narrator's slowest flows. We'll know we're right when every one of the 87 call sites has a verdict, every mutating Story Bible action shows an in-flight state within 100 ms in a fake-timer test and cannot be double-fired, and a completion arrives after navigating away.

## What We're NOT Building

- Fake or padded progress or minimum-delay spinners - ADR 0015 (real progress only); indeterminate is allowed where no measurement exists.
- A persistent Python sidecar or any local server - `codebase-map.md`; latency is reduced by fewer spawns and lazy imports instead.
- OS-level notifications - owned by `story-bible-and-import-ux-briefs.prd.md` (native notifications); this PRD supplies the completion events they consume.
- Dialog modality, focus trap, Escape handling and `WorkDialog` semantics - delivered ([ADR 0048](../adr/0048-every-dialog-is-one-modal-shell-and-confirms-are-alert-dialogs.md), [ADR 0057](../adr/0057-a-running-job-that-cannot-be-cancelled-keeps-its-dialog-blocking-and-says-so.md)); this PRD only consumes them (see Parallelism Notes for the one hard coupling).
- REAPER/Lua-side interactions (`integrations/reaper`) - no automated tests, separate manual-verification scope.
- The install-job contract fix (TTS `'running'` versus `'downloading'`), real download progress and the asset-manager work - owned by `release-readiness-provisioning-and-docs-site.prd.md` Phase 1; this PRD tracks the rows.
- Choosing a tracker - already answered on main: work in flight is tracked on GitHub (issues, labels, milestones, the project board) and decisions and docs stay in the repo, per `docs/operations/github-workflow.md` (Open Question 8). Jira is not used.
- Missing motion or animation (transition tokens) - a distinct concern from missing feedback, owned by `docs/design/motion-and-animation.md`.
- New visual design for loading states beyond existing tokens and primitives - reuse `Button`, `Tooltip`, existing progress styling; anything touching primitives triggers `design-spec-guard`.

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Call sites with a recorded verdict | 87 of 87 (or the current count), 0 uncatalogued | Ratchet test comparing enumerated `.method(` sites with the catalog |
| Measured latency table | p50/p95/max for at least: build (small and full-length), create, edit (1 field, alias), Save (4 fields), setLocked, rescan, merge, delete, relate, preview uncached and cached, seed 10 candidates; Go: `tracksList`, `Chapters`, `Search` | Manual-run harness, at least 20 runs per op, cold and warm, dev venv and frozen sidecar, machine spec recorded |
| Acknowledgment within 100 ms | 100% of mutating Story Bible actions and other sites the catalog marks "slow" | Vitest with fake timers and a never-resolving stub: click, advance 100 ms, assert disabled or `aria-busy` |
| Double-fire | 0 overlapping calls per action | Vitest with a counting stub: two rapid clicks produce one call |
| Completion after navigation | Success or failure of build, downloads, transcript and import is visible after leaving the starting page | Vitest/App-level test; manual check |
| Install-flow catalog rows (TTS, Whisper) | Marked closed by release-readiness Phase 1, verified against the real host | Catalog row plus that PRD's contract test and manual desktop run |
| Swallowed errors on user-initiated actions | 0 bare `.catch(() => {})` unexplained | Grep gate in the ratchet test |
| Subprocesses per Story Bible Save | 1 (from 4) if Phase 4 ships | Go test with a counting fake sidecar |
| Visual verification | PNGs reviewed at desktop, small-desktop, tablet, mobile for each changed state | Playwright visual suite per `CLAUDE.md` |

## Open Questions

- [ ] **1. Latency tiers and thresholds.** Options: (a) under 100 ms nothing needed, 100 ms to 1 s an immediate in-flight state (disabled, `aria-busy`), 1 to 10 s a spinner or indeterminate bar plus a completion signal, over 10 s real progress, cancel or dismiss, and OS-notification eligibility; (b) only two tiers (fast, slow); (c) per-flow judgment. Recommendation: (a), adopted as an ADR; note the acknowledgment is required for every non-instant action regardless of measurement, measurement decides only whether a spinner or progress is warranted.
- [ ] **2. Where completion is delivered.** Options: (a) keep the single toast but queue messages and make errors sticky until dismissed; (b) add an activity list (bell or history) of finished jobs; (c) (a) plus OS notifications when unfocused. Recommendation: (c), with (a) in this PRD and OS notifications in the briefs PRD; defer (b) until the catalog shows it is needed.
- [ ] **3. Detecting completion off the starting page.** Options: (a) host emits Wails events when a job ends and an App-level subscriber shows the completion (pattern already used for `transcript:state`, `App.tsx:100`); (b) an App-level poller over known job ids; (c) leave page-scoped and block navigation while a job runs. Recommendation: (a); it also gives the native-notification work a single trigger and removes the page-scoped polling in `Guide.tsx:77-102`.
- [ ] **4. Fix policy for slow Story Bible operations.** Options: (a) acknowledgment only; (b) also cut latency by sending all changed fields in one spawn (`GuideEdit` runs one process per field, `bindings.go:108-112`) and lazily importing Piper only for `render-audio` (`manuscript_guide.py:30`); (c) a persistent sidecar (rejected by `codebase-map.md`). Recommendation: (a) first, (b) as its own data-gated phase after the latency table exists; a one-spawn edit also makes a save atomic (today a failure on field two leaves field one applied).
- [ ] **5. Who fixes the TTS install flow.** Options: (a) leave it to release-readiness Phase 1 (job contract, real progress, shared hook, mock, API bump) and track it as a catalog row; (b) if that phase is scheduled late, ship a small UI-only alignment to `'running'` with an indeterminate bar here first; (c) fix it here in full. Recommendation: (a); (b) only if Phase 1 of that PRD is not next, because a UI-only fix would be rewritten by it.
- [ ] **6. Two PRDs propose a shared install-poll hook.** `teleprompter-engines-and-input-devices.prd.md` phase 4 (`useAssetInstall`, from Transcript and Teleprompter) and release-readiness Phase 1 ("shared poll hook") overlap, and `GuideDetail.tsx:152-172` is a third copy. Options: (a) one owner (recommend release-readiness Phase 1, since it also changes the job contract) and the other PRD adopts it; (b) both build one; (c) leave duplicated. Recommendation: (a). Not ours to build; flagged so the audit's catalog rows point at one hook.
- [ ] **7. Scope of "async action".** Options: (a) user-initiated calls first, with mount-time loads catalogued and only fixed if slow (over 1 s); (b) both equally; (c) user-initiated only. Recommendation: (a).
- [x] **8. Backlog home: Jira, GitHub Issues, or in-repo Markdown?** Resolved by `docs/operations/github-workflow.md` (main, PR #39) after this brief was written: work in flight is tracked as GitHub issues (Bug report or Feature request forms, `needs-triage`, `area:*` and type labels, milestones generated from `config/roadmap.json`) on the Narration Utils project board, with `Closes #<issue>` in the PR; the repository stays the source of truth for decisions (`docs/adr/`) and documentation, and the wiki is disabled. The brief's two-sided tradeoff (in-repo Markdown is version-controlled and co-located; an external tracker adds status, priority and assignment but a second source of truth to sync with `docs/adr/` and the code) was settled by keeping decisions and docs in the repo and using GitHub only for work in flight. Consequence here: the 87-site catalog and its ratchet test stay in the repo (the test needs them there), and call sites the phases do not fix are filed as GitHub issues (Bug report form for defects, otherwise the `enhancement` or `accessibility` label, and `area:ui` or another `area:*` label) instead of being tracked by a revisit trigger.
- [ ] **9. Generic pending state.** Options: (a) a shared hook (a generalization of `ProjectPicker.runAction`, `ProjectPicker.tsx:43-53`) plus a `pending` affordance on `Button`; (b) per-component `useState`. Recommendation: (a); a `Button` change touches a primitive, so `design-spec-guard`, stories and the atlas run.
- [ ] **10. Guard against silent catches.** Options: (a) a lint or test rule that flags `.catch(() => {})` on user-initiated calls with an allowlist for reviewed mount-time cases; (b) review only. Recommendation: (a), folded into the catalog ratchet.

## Users & Context

**Primary User**
- **Who**: an independent audiobook narrator working in the standalone app or inside REAPER, on a typical Windows machine, editing a Story Bible, importing, comparing transcripts, downloading local models.
- **Current behavior**: clicks Save or Rescan and waits with no change on screen; clicks again; watches a dialog that cannot be dismissed; switches to REAPER during long jobs and returns without knowing whether they finished.
- **Trigger**: any action that leaves the Go host or a subprocess, especially Story Bible operations and downloads.
- **Success state**: every action acknowledges immediately, cannot be double-fired, and its outcome is visible even after looking away.

**Job to Be Done**: When I press a button that takes time, I want the app to show it heard me and tell me when it is done, so I can trust it and look away.

**Non-Users**: developers reading logs; REAPER-only users who never open the app.

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability |
| --- | --- |
| Must | Written standard (acknowledge, no double-submit, completion independent of viewer, honest progress, no swallowed errors) recorded as an ADR |
| Must | Latency baseline for Python-backed and heavy Go-native operations, recorded in `docs/research/` |
| Must | Call-site catalog with a verdict per site and a ratchet test |
| Must | Catalog rows for the TTS and Whisper install flows, closed when release-readiness Phase 1 lands |
| Must | In-flight state and double-submit protection on Story Bible mutations and preview |
| Should | Completion signals that survive navigation (host events, App-level subscriber), toast queue, sticky errors |
| Should | Latency reduction where the baseline justifies it (one spawn per edit, lazy Piper import) |
| Should | Remaining gaps from the catalog (swallowed errors, unacknowledged cancel/reset, Settings saves) |
| Could | Activity list of finished jobs |
| Won't | Fake progress, persistent Python server, OS notifications here, install-contract and real download progress (release-readiness Phase 1), dialog primitives work, Lua flows |

### MVP Scope

Standard and ADR, latency baseline, catalog with ratchet, and Story Bible action feedback (Phases 1 to 3). Completion-after-navigation, latency reduction and the long tail follow.

### User Flow

- Narrator presses Save on an entry: the button disables at once and shows busy, the four edits run, a toast confirms; pressing again during the run does nothing.
- Narrator starts a build and leaves the page: when it finishes, a toast (and, when unfocused, an OS notification via the briefs PRD) reports it; returning to the page shows the new state.
- Narrator asks to download a voice (owned by release-readiness Phase 1): the dialog shows the running state and, once the host reports bytes, real progress; on completion the preview plays.

## Technical Approach

**Feasibility**: HIGH for standard, catalog and Story Bible feedback (UI plus tests; `ProjectPicker.runAction` is the pattern). MEDIUM for completion-after-navigation (host events and an App-level subscriber, more files) and for latency reduction (Python and Go changes, data-gated).

**Architecture Notes**
- **Inventory method**: enumerate `NarrationApi` members from `apps/ui/src/api/contracts/*.ts`; find call sites with `\.<method>\(` in non-test, non-story source outside `apps/ui/src/api/`; store the catalog beside the code (for example `apps/ui/src/interactionFeedback.catalog.ts`) with columns: site (file and method), trigger (click, effect, mount), backend cost class (Go-native fast, file I/O, Python spawn, long job, network download, OS dialog), acknowledgment, in-flight guard, completion signal, error surfaced, survives navigation, verdict. A test (modeled on `src/atlasCoverage.test.ts`) fails on any uncatalogued site and on catalog rows whose site disappeared.
- **Latency harness**: a manually run Go test under a build tag (not in CI) driving `guide.Service` against a temp project through the real `Supervisor.Run`, for the dev venv and for the frozen sidecar produced by a release build; fixtures: a small canonical `manuscript.json` and a user-supplied full-length one; report p50/p95/max, cold versus warm, machine specs. Results go to a new `docs/research/` note.
- **Acknowledgment test**: Vitest with fake timers and a never-resolving `NarrationApi` stub; assert the control is disabled or `aria-busy` after 100 ms and that a second click makes no second call.
- **Shared pending hook**: generalize `ProjectPicker.runAction` (busy, catch, message); optional `pending` prop on `Button` (`primitives/Button.tsx`) triggers `design-spec-guard` and atlas stories.
- **Install flows**: not built here; release-readiness Phase 1 owns the job contract, progress callback and mock. This PRD's Phase 5 (completion events) should reuse its unified job snapshot when it lands, so the job-end events carry one shape.
- **Host-to-UI completion**: host emits an event when a job ends (pattern: `transcript:state`, `app.go:320-327`); an App-level subscriber shows the toast; page pollers can then stop owning completion.
- **Host API**: bump `hostAPIVersion` (`apps/desktop/app.go:33`, `apps/desktop/app_test.go:40-41`, `apps/ui/src/hostApi.ts:2`) and regenerate `apps/ui/wailsjs/go/main/Host.*` only when a binding's signature or required payload changes (a new event alone does not; a changed `GuideEdit` signature would).
- **Locking**: any Go changes to bindings snapshot service pointers under `h.mu.RLock` and release before calling into services (`h.services()`, see `docs/architecture/host-binding-concurrency.md`).

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Measured numbers differ on the frozen sidecar or under antivirus (cold starts) | High | Measure both, cold and warm, record machine; thresholds decided on frozen-sidecar numbers |
| Adding pending states changes many components and screenshots | Medium | One shared hook; catalog-driven order; `visual-catalog-sync`; four-viewport PNG review |
| Batching `GuideEdit` changes partial-failure semantics | Medium | One-spawn edit is more atomic; test failure modes; data-gated phase |
| Completion events double-fire with page pollers | Medium | One owner per job kind; remove page-scoped completion when the App-level path lands |
| Contract test hard to keep in sync with Go maps | Medium | Fixture generated from a Go test that marshals the real snapshot |
| Overlap with concurrent PRDs (`GuideDetail.tsx`, `Guide.tsx`, `App.tsx`, `bindings.go`) | High | Compatibility table; land small phases; rebase |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Latency baseline | Manual-run harness, measured table for Python-backed and heavy Go-native operations, results note in `docs/research/` (no product code) | pending | 2 | - | - |
| 2 | Standard, catalog and ratchet | ADR for the standard and thresholds, call-site catalog with verdicts (provisional cost classes), ratchet test, no-swallowed-catch rule | pending | 1 | - | - |
| 3 | Story Bible action feedback | Shared pending hook, in-flight state and double-submit guard on save, create, rescan, lock, alias, relate, merge, delete, uncached preview; states and PNG review | pending | - | 1 (tiers), 2 (standard) | - |
| 4 | Latency reduction (data-gated) | One spawn per edit (batch fields), lazy Piper import, seed path; Python and Go tests; only if Phase 1 justifies it | pending | 5 | 1 | - |
| 5 | Completion that survives navigation | Host job-end events, App-level subscriber, toast queue and sticky errors, remove page-scoped completion; reuse the unified job snapshot if release-readiness Phase 1 has landed | pending | 4 | 2 (soft: release-readiness Phase 1) | - |
| 6 | Remaining gaps | Work through catalog rows still marked gap (swallowed errors, cancel/reset, Settings saves, Go-native slow calls); close the install-flow rows once release-readiness Phase 1 is verified | pending | - | 2, 3, 5 | - |
| 7 | Bookkeeping | `docs/design/motion-and-animation.md:23` already points at this PRD (repointed from the removed backlog brief by the docs-replacement change); repoint it to the ADR and catalog once they exist, file unfixed catalog gaps as GitHub issues (Bug report form, `area:ui`) per `docs/operations/github-workflow.md`, docs screenshots, `feature-cleanup` | pending | - | 3, 5, 6 | - |

### Phase Details

**Phase 1 - Latency baseline**
- **Goal**: decide from data which operations need more than an acknowledgment.
- **Scope**: harness and results note; ops per Success Metrics; dev venv and frozen sidecar; cold and warm; record spaCy model load and full-manuscript `build`/`rescan`/`merge` (not measured yet).
- **Success signal**: a table with p50/p95/max per op and a proposed tier per op.

**Phase 2 - Standard, catalog and ratchet**
- **Goal**: a written, testable standard and a complete inventory.
- **Scope**: ADR (take the next free ADR number at merge time and re-check numbering; 0027 at d5cc994) via `adr-author`; catalog file and ratchet test; verdict for each of the 87 sites; grep gate for bare catches; the TTS and Whisper install rows point at release-readiness Phase 1.
- **Success signal**: ratchet green; every site has a verdict and a linked phase or "no action".

**Phase 3 - Story Bible action feedback**
- **Goal**: every Story Bible action acknowledges and cannot overlap itself.
- **Scope**: hook (generalizing `ProjectPicker.runAction`) and optional `Button` pending affordance; `GuideDetail.tsx`, `Guide.tsx`, `usePreviewAudio.ts`; fake-timer and double-click tests; `visual-catalog-sync`; `design-spec-guard` if `Button` changes.
- **Success signal**: acknowledgment and double-fire tests green; PNGs of pending states reviewed at four viewports.

**Phase 4 - Latency reduction (data-gated)**
- **Goal**: cut avoidable cost.
- **Scope**: `GuideEdit` sends all fields in one process (Python `edit` accepts a batch; Go `guide.Service.Edit`), lazy `PiperVoice` import in `manuscript_guide.py`, failure-mode tests; host API bump only if the binding signature changes.
- **Success signal**: Save uses 1 spawn; measured p95 improvement recorded against Phase 1.

**Phase 5 - Completion that survives navigation**
- **Goal**: completion visible regardless of where the user is.
- **Scope**: host emits job-end events for build, downloads, transcript, import; App-level subscriber; toast queue, longer or sticky errors; remove page-scoped completion in `Guide.tsx`; expose the same trigger to the native-notification work (`story-bible-and-import-ux-briefs.prd.md` Phase 2).
- **Success signal**: test that leaves the page mid-job and still receives completion; no duplicate toasts.

**Phase 6 - Remaining gaps**
- **Goal**: close every catalog row marked gap or record why not.
- **Scope**: per-row fixes using the Phase 3 and 5 patterns; verify release-readiness Phase 1 closed the install rows against the real desktop app.
- **Success signal**: catalog has no unexplained gaps.

**Phase 7 - Bookkeeping**
- **Goal**: docs match reality.
- **Scope**: the `motion-and-animation.md` link (already pointing at this PRD; repoint to the ADR and catalog), ADR index, cross-links, screenshots via `doc-screenshot-sync` (and the matching pages of `docs/guides/using-the-app/`, guarded by `apps/ui/src/docsGuide.test.ts`), GitHub issues for leftover gaps, cleanup. New defects found along the way are GitHub issues (Bug report form, `area:ui` label), per `docs/operations/github-workflow.md`, not entries in a Markdown register.
- **Success signal**: `feature-cleanup` checklist clear; `pnpm check` green.

### Parallelism Notes

Phases 1 and 2 have no dependencies and touch disjoint areas (harness and docs, catalog and test), so they can run concurrently. Phases 4 and 5 are independent of each other but 4 edits `bindings.go`/Python and 5 edits `App.tsx`/`Toast.tsx`/`Guide.tsx`. Phase 3 edits `GuideDetail.tsx`, which release-readiness Phase 1 also edits (install loop `:152-184`, dialog `:768-800`); the hunks are disjoint but expect a rebase.

Coupling with the delivered dialog work ([ADR 0057](../adr/0057-a-running-job-that-cannot-be-cancelled-keeps-its-dialog-blocking-and-says-so.md)): a running rebuild dialog stays blocking and non-cancellable (option (a) of the retired dialog PRD's question 4; owner decision D8 makes it load-bearing, because build-after-import is on by default). Its option (b), "Close and let the job continue in the background", is only safe once Phase 5 here exists, because dismissing the dialog otherwise loses the completion signal. Phase 5 is what can relax ADR 0057, and it does so with a new ADR that supersedes it.

### Parallel-session compatibility

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 1 | new harness file under `apps/desktop/` (build-tagged test) or `scripts/`, `docs/research/` | Low; additive |
| 2 | new catalog and ratchet test in `apps/ui/src/`, new ADR | ADR numbering; any session adding an API call site (catalog rows) |
| 3 | `GuideDetail.tsx`, `Guide.tsx`, `usePreviewAudio.ts`, possibly `primitives/Button.tsx` and stories, visual catalog | release-readiness Phase 1 (`GuideDetail.tsx` install loop), story-bible-and-import-ux-briefs phases 3 (`Guide.tsx` hook extraction) and 11 (`GuideDetail.tsx`), dialog PRD, any `Button` consumer |
| 4 | `apps/desktop/bindings.go` (`GuideEdit`), `apps/desktop/internal/guide/service.go`, `sidecars/manuscript-guide/core/manuscript_guide.py` and tests, possibly `hostApi.ts` and Wails bindings | the delivered host accessor (same functions, now on `h.services()`), briefs phase 10 (`edit()`), any API bump |
| 5 | `App.tsx`, `layout/Toast.tsx`, `Guide.tsx`, `Home.tsx`, `Transcript.tsx`, `apps/desktop/app.go` (events), `api/wailsClient.ts` | briefs phases 2 and 3 (they consume or share the hook), release-readiness Phase 1 (job snapshot shape), dialog PRD, `App.tsx` editors (teleprompter PRDs) |
| 6 | many components per catalog row | Everything above; do in small PRs |
| 7 | docs (`motion-and-animation.md`, ADR index, guide pages) | Low |

Cross-cutting: every phase re-checks `docs/adr/` numbering immediately before writing an ADR; every phase that changes a binding signature or required payload bumps `hostAPIVersion` in `apps/desktop/app.go:33`, `apps/desktop/app_test.go:40-41`, `apps/ui/src/hostApi.ts:2` and regenerates `Host.{js,d.ts}` (several PRDs bump it: whichever lands second increments again); every `apps/ui` phase runs `visual-catalog-sync`, the Playwright visual suite with PNG review of `apps/ui/screenshots/app/<page>/<state>/<viewport>.png` at all four viewports (`apps/ui/tests/visual/viewports.ts`), and `doc-screenshot-sync` (which now refreshes the split guide under `docs/guides/using-the-app/`; `apps/ui/src/docsGuide.test.ts` guards its links and screenshot embeds); primitives or `styles.css` changes also run the atlas (`pnpm --dir apps/ui atlas`) and `design-spec-guard`; every phase follows `CLAUDE.md`: plan, `change-impact-scan`, TDD, `full-verification-gate` (`pnpm check`, not `check:fast`), `design-spec-guard`, `feature-cleanup`. Nothing merges without the user.

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Real progress only (prior decision, ADR 0015) | No fake or padded progress; indeterminate where unmeasured | Placeholder percent | Recorded decision |
| No Python server or browser transport (prior decision, `codebase-map.md`) | Reduce spawns, do not keep a sidecar alive | Persistent sidecar | Recorded boundary |
| Local-first, Windows-first, US-English-first (prior decisions) | Measurements and fixes target Windows local runs | - | Standing scope |
| Story Bible edits are two-click and locked entries rejected server-side (prior decisions, ADR 0018, 0007) | Feedback work keeps Edit/Save flow and the `edit()` guard | Remove the guard for speed | Recorded decisions |
| Work tracked on GitHub, decisions and docs in the repo (prior decision, `docs/operations/github-workflow.md`; supersedes the backlog brief's "too early to tell") | Catalog and ratchet stay in-repo; leftover gaps become GitHub issues | Jira, all-Markdown backlog | Open Question 8, resolved on main |
| Workflow and gates (prior decision, `CLAUDE.md`) | plan, impact scan, TDD, `pnpm check`, spec guard, cleanup; PNG review at four viewports | Fast check only | History of silent regressions |
| Nothing merges without the user (prior decision) | User merges every PR | Auto-merge | Standing rule |
| Measure before adding loading states (prior decision, from the removed backlog brief) | Phase 1 baseline first | Assume | Backlog's own requirement |
| Acknowledge every non-instant action (proposed) | Immediate in-flight state regardless of tier | Only for slow ops | Cheap and consistent |
| Catalog with a ratchet test (proposed) | In-repo catalog checked by a test | One-off audit doc | Prevents the standard from rotting; same pattern as the atlas debt list |
| Completion via host events and an App-level subscriber (proposed) | Events | Page pollers, block navigation | Survives navigation, feeds notifications |
| Install-flow contract and progress owned by release-readiness Phase 1 (proposed) | Track here, do not duplicate | Fix in this PRD | One owner; that phase also changes the job contract and bumps the API |
| Latency reduction is data-gated (proposed) | Phase 4 after Phase 1 | Do it upfront | Backlog says measure first |

## Research Summary

**Market Context**
- No external research was done. The 100 ms acknowledgment and 1 s and 10 s tiers are commonly cited response-time guidance from general HCI practice (recalled, not sourced here); treated as a proposal to be adopted or changed by the user (Open Question 1).

**Technical Context**
- Verified in code: TTS host job shape versus UI contract and mock; per-field Python spawn in `GuideEdit`; absence of in-flight state in Story Bible components; `ProjectPicker.runAction`; page-scoped build polling; toast behavior; the atomic-but-fixed-name `.tmp` write; the module-level Piper import; the call-site counts (script run this session, method above).
- Measured this session: import and interpreter costs listed in Evidence (one machine, dev venv, warm cache).
- Not verified: real-host TTS behavior by running the app; frozen-sidecar startup; spaCy model load; `build`/`rescan`/`merge`/`render-audio` durations; whether duplicate installs collide in the asset store; whether concurrent Story Bible writers actually lose updates.
- Adjacent findings not owned here: `Supervisor.Run` waits on the process before its pipe readers finish (`apps/desktop/internal/process/supervisor.go:98-101`), which can truncate the last stdout line `Create` parses (`CREATED|<id>|<n>`); `manuscriptReader` is bound but has no UI caller. Both are listed in the hand-off message.

---

*Generated: 2026-09-19*
*Status: DRAFT - needs validation*
