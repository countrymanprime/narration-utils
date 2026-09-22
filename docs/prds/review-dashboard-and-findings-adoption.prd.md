# Review Dashboard and Findings Adoption

**Supersedes:** `docs/utilities/review-dashboard.md` (planned-work brief, removed when this PRD landed; recoverable from git history)

Roadmap milestone 1 ("Dashboard foundation", `docs/roadmap.md:20-24`). Citations are `file:line` on branch `claude/features-defects-prds-planning-87c378` (b9d348d) for anything checked in code; "per docs" marks a claim taken from a document and not verified. Re-checked against `main` at d5cc994 on 2026-09-19: none of the code files cited here changed since b9d348d, and the doc references were updated for the split "Using the app" guide, `docs/operations/github-workflow.md` and the current `docs/README.md`. Line citations to a superseded brief (for example `review-dashboard.md:40`) refer to that brief as of d5cc994; the briefs are removed from the tree, so read one with `git show d5cc994:docs/utilities/review-dashboard.md`. Sibling PRDs (all in `docs/prds/`; file names only): `take-review-pickups-duplicates-take-intelligence.prd.md` (milestone 2, prefix TR), `character-continuity-review.prd.md` (milestone 3, prefix CC), `teleprompter-manuscript-integration.prd.md`, `diagnostics-delivery-and-cleanup-tools.prd.md`, `reaper-automation-follow-through.prd.md`. In Depends columns this PRD's own phases are bare numbers and other PRDs' phases are `RD-n` (this PRD), `TR-n`, `CC-n`.

## Problem Statement

A narrator who has run Transcript Compare or built a Story Bible has no single, persistent place to triage what the tools flagged: Transcript Compare results live in one table that is overwritten by the next run and has no accept/dismiss/defer, and Story Bible review state lives on a different page with its own model. Every analyzer planned for milestones 2 to 4 would otherwise need its own bespoke results UI, and review decisions would be lost whenever an analyzer re-runs. The shared findings record exists in Go but nothing produces or consumes it yet, so the roadmap's own dependency rule ("every new analyzer emits the shared finding format before it gets a bespoke UI", `docs/roadmap.md:64`) cannot be met for later milestones until this foundation lands.

## Evidence

Verified in code:

- **The findings package is an island.** `apps/desktop/internal/findings/findings.go` defines the record (`:112-127`), validation (`:130-152`), `WithReview` (`:172-178`) and `StableID` (`:184-192`). Its only importer is `apps/desktop/internal/measure/profile.go:6`; no file in `apps/desktop/*.go` references `findings.` or `measure.`. There is no persistence, no sidecar reader or writer, no merge on re-run, and no host binding.
- **Record gaps against the contract.** `docs/architecture/findings-contract.md:12-15` lists `manuscript` "text span", `time_range` "source-relative offsets" and `project` identity; the Go structs carry none of them (`Manuscript` `:91-96` has chapter id/title, expected, recorded only; `TimeRange` `:86-89` is start/end only; `Project` `:70-73` is path and output path). The retired dashboard brief (`docs/utilities/review-dashboard.md:40` at d5cc994) required decisions "attributable to the finding evidence version"; the record has no evidence version (`ReviewState` `:106-110` is status, note, timestamp). `Confidence` is a non-nullable `float64` validated 0..1 (`:122`, `:142-143`), while the contract says an analyzer "must identify uncertain or unavailable evidence rather than fabricate a score" (`findings-contract.md:26`): there is no way to say "no numeric confidence".
- **Transcript Compare results are per-run and per-session.** Rows are built from bridge events in `apps/desktop/internal/transcript/service.go:314-321` with ids `<item_index>@<srcpos>` (`integrations/reaper/narration_ui_bridge.lua:214`), where `item_index` is the position in that run's selected-item manifest (`:138-153`), so ids change when the selection changes. Only the last completed comparison is persisted, to `<project>/.narration-last-comparison.json` (`service.go:531-537`, read back `:133-143`); that file is not documented in `docs/architecture/daw-integration.md`. It carries marker state but no review state. The results page disables export for a reloaded result: "Marker export is available only for results from this active REAPER session" (`apps/ui/src/components/proofing/Results.tsx:58-61`, `Transcript.tsx:468`).
- **Confidence exists but is dropped.** `compare.py` writes `confidence` and `timing_gap_seconds` on every `MARKER` line (`sidecars/transcript-compare/core/compare.py:1017-1039`, written `:1538-1563`). The Lua bridge parses 12 fields per marker but forwards ten of them to the `COMPARE_MARKER` event (everything except `confidence` and `timing_gap_seconds`) (`narration_ui_bridge.lua:205-210`, `:222-240`), Go's row builder reads indexes up to 15 (`service.go:318`), and the UI type `Discrepancy` has no confidence field (`apps/ui/src/api/contracts/transcript.ts:3-19`). ADR 0008 says the same thing and forbids re-litigating the field count.
- **No GUID identity and no durable navigation for compare rows.** `prepare_compare` keeps run state in a Lua table (`narration_ui_bridge.lua:170`, `:512`) and rows hold live item pointers (`:221`); items are never given GUIDs in the manifest (`:151`) or events. The only navigation is `jump_to_compare_marker`: select one item and `SetEditCurPos(project_time, true, false)` (`:531-541`), so it does not start playback and does not loop. The "Play recorded audio" button calls exactly that (`Results.tsx:160-169`). After the launcher action restarts, the `runs` table is empty and jump fails with "Marker location is no longer available" (`:542`). `docs/architecture/daw-integration.md:43-44` requires navigate, loop, add-marker and safe stale-GUID handling.
- **Bridge availability is unobservable.** The Go bridge client exists only when the host was started with `--session-dir` (`apps/desktop/app.go:169-173`), i.e. launched from REAPER; a standalone launch has none (`service.go:97,233,267` all guard `s.bridge == nil`). The bridge has no ping or acknowledgement: commands are files, events are an append-only log (`apps/desktop/internal/bridge/bridge.go:66-105`), and a closed REAPER just leaves command files unconsumed.
- **Manuscript Guide output shape.** Entities carry `review_state` ("needs review" or "generated", set at build `manuscript_guide.py:594`; "reviewed" after any edit `:842`), `locked`, per-entity pronunciation with a label-valued `confidence` (`"high"|"medium"|"low"|"unknown"`, `:449,461,464`) and occurrences with chapter and excerpt evidence (`:508-519`). Entities have no audio time and no track. Ids are a hash of the normalized name (`:226-227`) and are reconciled across rebuilds only for locked or manual entities (`merge_locked`, `:646-727`).
- **Where derived project data is cleared.** `resetDerived` deletes `ManuscriptGuide/`, `TranscriptCompare/`, `narration-utils/manuscript-notes.json` and `.narration-last-comparison.json` on manuscript replace and on Clear (`apps/desktop/internal/manuscript/service.go:264,434-441,449`). A findings sidecar anchored to manuscript chapters and paragraphs must decide what happens there.
- **The UI has no review-queue building blocks.** Primitives are Button, ConfirmDialog, Dialog, ErrorBoundary, Field, Heading, Highlight, MeterBar, NavButton, Panel, Pill, SlideOver, Tooltip, WorkDialog (`apps/ui/src/components/primitives/`); the only table is the legacy `table.dtable` style in `apps/ui/src/components.css:81-97`, used by `Results.tsx`. Every new primitive needs a `.stories.tsx` (`docs/design/design-system.md` "Primitive components").
- **Audio for standalone review already has a path.** `/media` streams project track sources with Range support and refuses anything not referenced by the selected `.rpp` (`apps/desktop/media.go:19-64`, ADR 0012). The static `.rpp` reader gives item position, length, name and source only, no GUID, offset, rate or takes (`apps/desktop/internal/tracks/tracks.go:18-26`, `parse.go:68-96`).
- **Line identity Lua is not driven by Go.** `stamp_item_lines`, `read_line_ids`, `create_chapter_regions` exist (`narration_ui_bridge.lua:380-509`); no `.go`, `.ts` or `.py` file references them (repo grep). Per docs, unverified in REAPER (`docs/architecture/manuscript-line-identity.md:3`). Findings do not need it (GUIDs are the navigation identity).
- **Host API version** is in three places, all 5: `apps/desktop/app.go:33`, `apps/desktop/app_test.go:39-42`, `apps/ui/src/hostApi.ts:2`.

Docs conflict on where the dashboard lives (this is Open Question 1): the retired dashboard brief (`review-dashboard.md:7,11` at d5cc994), `docs/roadmap.md:23` and `config/roadmap.json:16` say "REAPER panel" or "REAPER review panel"; `docs/architecture/daw-integration.md:7,11-12` says logic is Go, UI is React in a native Wails window, and REAPER Lua keeps only REAPER-state operations; `NarrationUtils_Launcher.lua:1-6` says "REAPER itself has no workflow UI". Per the REAPER research, the third-party in-REAPER UI library ReaImGui was archived on 3 Jun 2026 (`docs/research/reaper-automation-surface.md:93`, per docs).

Assumption - needs validation through timed dogfooding on 3-5 permissioned chapters: that review time is dominated by locating and hearing each flagged spot, not by deciding. No baseline exists in the repo.

## Proposed Solution

Adopt the shared finding record end to end, in Go, and put the review UI in the Narration Utils workspace rather than inside REAPER. A Go-owned findings store persists analyzer output and, separately, narrator decisions in the project sidecar; Go adapters turn Transcript Compare results and Manuscript Guide output into findings without changing the Python sidecars' stable contracts; a new Review page lists findings with chapter, category, severity, status and confidence filters, shows evidence and manuscript context, and records accept/dismiss/defer with a note. REAPER-side Lua stays a thin executor: navigate to a finding by GUID (refusing stale identities), loop its context, report bridge liveness, and, last, add one approved marker. No analyzer logic moves into the dashboard and nothing mutates REAPER without an explicit narrator click.

## Key Hypothesis

We believe a persistent, filterable review queue built on the shared finding record, with GUID-based jump and context looping, will let narrators clear every flagged discrepancy in a chapter without hunting through markers and without losing decisions on re-run, for narrators who already use Transcript Compare and the Story Bible. We'll know we're right when (a) every current Transcript Compare marker row maps to a finding without losing manuscript or recorded text, (b) decisions on unchanged evidence survive a host restart and a re-run with zero new ids, (c) a stale GUID is reported and never resolves to a neighbouring item, and (d) a narrator reviewing 3-5 real chapters reaches each flagged spot in one action and reports the queue faster than the marker workflow (baseline TBD - needs research).

## What We're NOT Building

| Item | Why |
| --- | --- |
| A Lua/gfx/ReaImGui panel inside REAPER | Contradicts the recorded boundary (UI in React, Lua for REAPER state only, `daw-integration.md:7`), has no automated tests (`CLAUDE.md`), and the third-party UI library is archived per the research doc. Open Question 1 asks the user to confirm. |
| Analyzer algorithms in the dashboard | Roadmap dependency rule (`roadmap.md:65`); the dashboard consumes findings only. |
| Ingesting pickup, take, character, delivery, silence or level findings | Milestones 2-4 (`TR-*`, `CC-*`, `diagnostics-delivery-and-cleanup-tools.prd.md`). The store and page must accept them by category, but this PRD ships no producer for them. |
| Bulk actions, saved views, audio snippets, cross-project reports | Listed as later work in the superseded dashboard brief. |
| Reports and reviewer packages, including the dashboard brief's optional filtered report | Owned by the diagnostics sibling PRD, `diagnostics-delivery-and-cleanup-tools.prd.md` Phase 7 (report export), which superseded the retired delivery-and-review-export brief. |
| Hiding findings solely because they are inconvenient | Recorded review boundary. The tool never deletes or suppresses a finding on its own: dismissed findings stay auditable, findings absent from the latest run are flagged "not in latest run" rather than removed, and only the narrator's explicit filter or decision changes what the list shows. |
| The track-to-chapter mapping (the retired DAW Project Scan brief's mapping) | Planned and unbuilt: the matcher is owned by `teleprompter-manuscript-integration.prd.md` Phase 8 and exposed by `diagnostics-delivery-and-cleanup-tools.prd.md` Phase 8, which superseded that brief. Chapter grouping here uses the chapter carried on each finding, which is the manuscript-only path. Chapter grouping falls back to the shared track-to-chapter mapping (teleprompter-manuscript-integration Phase 8) for findings that carry only a track or item GUID, so every analyzer shares one mapping instead of each reimplementing it. It plugs in when those phases land. |
| Persisting live teleprompter flags | The teleprompter PRD defers findings persistence; the store here should accept them later without a schema change. |
| Forced alignment, or any change to Transcript Compare's detection | ADR 0008. This PRD only annotates and persists what it already produces. |
| Automatic execution of any suggested action, or automatic audio/take/marker changes | Recorded rule; findings suggest, the narrator confirms (`findings-contract.md:23-27`). |
| OSC or web-interface transport, or replacing the file bridge | Separate decision needing its own ADR (research doc section 10); owned by `reaper-automation-follow-through.prd.md`. |
| Audacity adapter | Deferred (`roadmap.md:56`). |

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Compare rows mapped to findings | 100% of rows in a fixture set built from real `results_*.txt` files; `docText`, `audioText`, script and audio context preserved | Go table test over fixtures |
| Decision persistence | 100% of accept/dismiss/defer decisions and notes survive host restart and a re-run | Go tests plus a manual re-run on one real chapter |
| Id stability | 0 new ids on re-run with unchanged audio and manuscript; jittered ASR timing below the "material change" threshold keeps the id | Go tests with perturbed timings |
| Stale navigation safety | 0 cases where jump or loop selects any item other than the finding's GUID; stale reported as unavailable | Manual REAPER checklist (user-run; no automated Lua tests) |
| Actions from page open to hearing a finding | 1 click on a row plus 1 click on Loop | UI test and walkthrough |
| Review speed vs marker workflow | TBD - needs baseline; hypothesis is faster | Timed dogfood on 3-5 permissioned chapters, blind to nothing (not a model comparison) |
| List/filter responsiveness on a large book | Provisional: interaction under 100 ms at 5,000 findings (assumption; real finding counts per chapter are unknown, TBD) | Synthetic fixture benchmark in the UI test suite |
| Gate | `pnpm check` green each phase; visual suite green with every new state reviewed at all four viewports | CI `ui-visual` job plus PNG review |
| Boundary compliance | No bridge command is sent without an explicit narrator action; no analyzer code in `components/review/` | Unit test on the client plus review |

## Open Questions

- [ ] **Q1. Where does the dashboard live?** Options: (A) Wails workspace page, with REAPER executing only navigate/loop/marker; (B) REAPER-side panel (gfx or ReaImGui); (C) both, a Wails page plus a small REAPER toggle or launcher. Recommendation: A. It matches the recorded boundary and works with the app launched standalone for everything except jumping into REAPER (the Tracks page already works standalone, `docs/utilities/tracks.md`), and it keeps UI testable. Consequence to accept: reword "REAPER review panel" in `roadmap.md:23` and `roadmap.json:16` (the superseded brief said the same) to "Review page in the Narration Utils workspace", and record it in an ADR. `roadmap.json` changes on `main` are synced to the GitHub milestones (`scripts/github/sync-milestones.mjs`, matched by milestone number, so a retitle updates rather than duplicates; `docs/operations/github-workflow.md`), so the reworded summary also changes the milestone description on GitHub.
- [x] **Q2. Finding id scheme for Transcript Compare, and what counts as "materially changed evidence".** Options: (A) manuscript-anchored id from chapter id, paragraph, kind, expected span text and an ordinal for repeats; (B) audio-anchored id from source file and `srcpos`; (C) A for the id plus a separate `evidence_version` hash of the audio-side evidence (recorded text, source file identity, timing beyond a tolerance). Recommendation: C, decided. (B) churns on every model or timing change (a different Whisper model shifts `srcpos`), destroying review history; (A) alone cannot tell that a re-recorded line now says something different. A decision is stored against id plus `evidence_version`; when the version changes the finding returns to `unreviewed` and keeps the earlier note. Phase 1 delivers the record fields and the store's merge semantics (`findings.Store.SaveAnalyzerFindings`); computing `evidence_version` from real ASR output is Phase 2. Tolerance value still TBD - needs research on real timing jitter between models.
- [x] **Q3. Contract gaps to close before more producers exist.** Options: (A) amend the record additively within schema v1: nullable confidence, `manuscript.span`, `time_range` source-relative offsets, `evidence_version`; (B) bump `schema_version` to 2 with those fields; (C) leave the record as is and tuck extras into the free-form `evidence` map. Recommendation: A, decided and delivered in Phase 1 (`apps/desktop/internal/findings/findings.go`): `Confidence` is now `*float64`, `Manuscript.Span` and `TimeRange.SourceStart`/`SourceEnd` are added, and `Finding.EvidenceVersion` carries the Q2 hash. `measure`, the one existing consumer, was updated for the pointer change. A `NotInLatestRun` merge flag was also added (additive, store-computed) to carry Phase 1's "not in latest run" rule.
- [x] **Q4. Where do the adapters run?** Options: (A) Go, consuming the sidecar results file plus bridge events; (B) Python sidecars emit finding JSON directly; (C) hybrid. Recommendation: A, decided. The record, validation and `StableID` are Go (`findings.go`), ADR 0025 set the precedent that Go owns analyzers' findings, the frozen `tools/*/core` CLI contracts stay untouched, and Go can read `confidence` and `timing_gap_seconds` straight from the `results_<run>.txt` it already knows the path of and join by row id with the Lua events, so confidence needs no Lua change. The adapters themselves are Phase 2 and 3.
- [x] **Q5. Sidecar layout and lifecycle.** Options: (A) `<project>/narration-utils/findings/<analyzer>/<scope>.json` for regenerated analyzer output plus one `findings/review.json` for decisions (append-only history), no cache directory yet; (B) one findings file plus one decisions file; (C) SQLite. Recommendation: A, decided and delivered in Phase 1 (`findings.Store`), written only by the Go host with temp-file-then-rename like `SaveHints`, partitioned by analyzer and chapter so re-running chapter 3 does not touch chapter 5, keeping analyzer output and decisions distinct as `daw-integration.md` requires (no cache directory yet, per the recommendation). Sub-decision: the findings directory was added to `resetDerived` (`manuscript/service.go`) so replacing or clearing the manuscript also clears findings anchored to it, decided yes because findings reference chapter and paragraph ids of the replaced manuscript and the existing confirm dialog already covers the deletion.
- [ ] **Q6. What does "loop" do in REAPER, and what state does it change?** Options: (A) set the time selection to the finding's context window, enable repeat and start playback, restoring the previous time selection and repeat state on an explicit Stop; (B) start playback from a pre-rolled cursor with no loop state; (C) loop in the app via `/media` with no REAPER mutation (needs source offset and rate from the `.rpp`, which the parser does not read). Recommendation: A for the roadmap's "looping", with restore semantics decided by a REAPER spike (whether time-selection changes create undo points, how the bridge detects "stopped"). C is a later standalone fallback. The spike launches REAPER on the user's machine and is run only with their go-ahead (project memory).
- [ ] **Q7. Do Manuscript Guide findings duplicate the Story Bible's review state?** Which conditions become findings is undefined in the docs beyond "unresolved entities and unreviewed pronunciations" (`manuscript-guide.md:31`). Options: (A) findings for entities with `review_state == "needs review"` and for unlocked entities whose pronunciation confidence is `low` or `unknown`; a finding decision never mutates the Story Bible, and the finding resolves itself ("resolved upstream") when the entity becomes reviewed or locked; (B) accept/dismiss route through the Story Bible edit path so there is one state; (C) defer the Guide adapter. Recommendation: A. It leaves `edit()` and its lock guard untouched (ADR 0007, ADR 0018) and avoids dismiss meaning "delete an entity". How many findings A produces on a real manuscript is unknown, TBD - needs measurement; ADR 0020's precision-first extraction should keep it small.
- [ ] **Q8. Is per-finding "add approved marker" part of milestone 1?** Options: (A) navigation, loop and decisions only; the batch Export markers action stays on the Transcript page; (B) also a per-finding add-marker action. Recommendation: B, as the last and cuttable phase, because `daw-integration.md:43` names "add an approved marker from a valid finding" as an adapter acceptance criterion and the same confirm-then-execute-then-undo plumbing is what milestone 2's take creation needs. If cut, milestone 1 meets everything in `roadmap.md:20-24` except that line of the adapter doc.
- [ ] **Q9. Where do filters and sort run?** Options: (A) in Go, returning a filtered page over the store; (B) in the UI over the full list. Recommendation: A behind a small query struct, so the same code serves milestones 2-4 and large books; the UI stays a view. Finding counts on real books are unknown, TBD.

## Users & Context

**Primary User**

- **Who**: A self-producing audiobook narrator who records and edits in REAPER on Windows and proofs their own chapters with Transcript Compare and the Story Bible (per docs, `docs/README.md` intro and closing paragraph).
- **Current behavior**: Runs a comparison, exports take markers into REAPER, then finds and re-listens to each marker by hand; reviews Story Bible entries on a separate page; loses the results table on the next run.
- **Trigger**: A chapter is recorded or assembled and needs a proofing pass before the next chapter.
- **Success state**: Every flagged item has a recorded decision, the remaining "to record again" list is explicit, and re-running after fixes does not resurrect dismissed items.

**Job to Be Done**: When I have finished recording a chapter, I want to triage every flagged discrepancy in one queue and jump straight to the audio, so that I can decide what to re-record without re-scanning markers or losing what I already decided.

**Non-Users**: Outside reviewers who receive a report (owned by the delivery/export work); Audacity users (deferred); teams or shared projects (deferred, `roadmap.md:59`).

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Notes |
| --- | --- | --- |
| Must | Findings store with decisions persisted in the project sidecar | Phase 1; carries `evidence_version` |
| Must | Transcript Compare adapter (every marker row becomes a finding) | Phase 2 |
| Must | Manuscript Guide adapter (entity and pronunciation findings) | Phase 3; conditions per Q7 |
| Must | Review page: list, filters (chapter, category, severity, status, confidence), sort, detail with evidence and manuscript context, accept/dismiss/defer with note, analyzer and run timestamp | Phases 4-5. The filter query accepts analyzer-supplied facets; the character filter the dashboard brief lists arrives with `CC-6` |
| Must | Safe stale handling: "not in latest run", "evidence changed", and GUID-unresolved shown as unavailable | Phases 1, 5, 6 |
| Must | GUID-based navigate and context loop with restore, and bridge liveness | Phases 6-7 |
| Should | Show Transcript Compare `confidence` and `timing_gap_seconds` and let the narrator hide low-confidence rows (`transcript-compare.md:32`) | Phase 5 |
| Should | Per-finding approved marker, undoable | Phase 8 (Q8) |
| Should | Jump to manuscript line from any finding (existing `goToManuscript`, `App.tsx:163`) | Phase 5 |
| Could | Keyboard triage (next/previous, accept/dismiss/defer keys) | Phase 5 if cheap |
| Could | In-app audition fallback via `/media` when REAPER is not running | Later; needs `SOFFS`/`PLAYRATE` from the `.rpp` (teleprompter PRD phase 8 adds them) |
| Won't | Bulk actions, saved views, audio snippets, cross-project reports, non-M1 analyzers | See table above |

### MVP Scope

Phases 1 to 7: persisted findings from both existing analyzers, the Review page, and GUID navigation plus looping. Phase 8 (approved marker) is the only cuttable phase.

### User Flow

1. Narrator runs Transcript Compare as today. On completion the host stores findings for that chapter and the Review page badge shows the unreviewed count.
2. Opens Review, filters to the chapter and category, sorts by time or confidence.
3. Selects a finding: sees expected and recorded text, script and audio context, confidence with its reason, analyzer, run time and any earlier decision.
4. If REAPER is running through the launcher, presses Go to (selects the item and moves the cursor) or Loop (plays the context window). If REAPER is not running, both are disabled with the reason.
5. Decides accept, dismiss or defer with an optional note. The decision is written immediately. Where a finding carries a suggested action (phase 8: add an approved marker), the narrator may instead invoke that one action after an explicit confirmation.
6. Re-runs the comparison after re-recording: unchanged findings keep their decisions, changed ones return to unreviewed with the old note, findings no longer produced show "not in latest run".

## Technical Approach

**Feasibility**: MEDIUM. Store, adapters, bindings and page are HIGH (Go and React, all automatable). The REAPER loop and GUID navigation are MEDIUM: they need real REAPER, have no automated tests, and the loop's restore semantics are unverified.

**Architecture Notes**

- **Data flow.** Transcript Compare sidecar writes `results_<run>.txt` (unchanged contract) -> Lua inspects against the live project and emits `COMPARE_MARKER` events (unchanged, until phase 6 appends GUIDs) -> `apps/desktop/internal/transcript` calls a findings adapter when `COMPARE_INSPECTED` arrives (`service.go:322-330`, where `persist` already runs) -> store merges by id and `evidence_version` -> host bindings -> Review page.
- **Adapter mapping (rows to findings).** category `transcript_discrepancy`; `manuscript.expected`/`recorded` from `docText`/`audioText`; kind (`MISREAD`/`SKIPPED`/`EXTRA`), script context, audio context, `timing_gap_seconds`, `existingMarkerName` in `evidence`; `time_range` from `projectTime` (project seconds) with the source-relative start from `srcpos`; `source.file` from the run manifest (`manifest_<run>.txt`, which Go can read); GUIDs added in phase 6; confidence label mapped to a number with the mapping stated in `confidence_reason`, and `unknown` mapped to "no numeric confidence" once Q3 lands. Severity mapping for the three kinds is TBD - needs a user decision during phase 2 planning.
- **Chapter id.** `MARKER` carries the chapter title, not its id (`compare.py:1562`). The adapter resolves title to id through the manuscript service; duplicate titles are TBD - needs research on real manuscripts and fall back to the title with a flag.
- **Sidecar.** Per Q5. Only the Go host writes; Lua and Python never touch it.
- **REAPER commands (phase 6, Lua).** `navigate_item` (by item GUID; unresolved -> `FINDING_STALE`, no neighbour ever used, mirroring `stamp_item_lines`' stale rule, `narration_ui_bridge.lua:380-403`), `loop_context` and `stop_loop`, and `ping`/`PONG`. Every mutating REAPER call is wrapped in `Undo_BeginBlock2`/`Undo_EndBlock2` like the newer commands (`:392-397`); the older export uses `Undo_OnStateChange` (`:292`), which `daw-integration.md:15` calls an undo block. New work follows the block form.
- **Host surface.** New bindings for list/get/review (phase 4), then navigate/loop/stop and bridge status (phase 7), each with a host API bump in the three places, wailsjs regenerated, contract in `api/contracts/findings.ts`, mock and fixtures updated.
- **UI.** `/review` route, `NAV` entry, new primitives with stories and atlas, catalog rows, drivers, four-viewport PNG review, `doc-screenshots.json`, and a new `docs/guides/using-the-app/review.md` page added to the guide's `README.md` index (`apps/ui/src/docsGuide.test.ts` enforces the index, breadcrumb, Previous/Next footers, links and that each curated screenshot is embedded once).
- **Docs.** `findings-contract.md`, `daw-integration.md` (sidecar and adapter sections), `transcript-compare.md`, `manuscript-guide.md`, `codebase-map.md`, `roadmap.md` plus `roadmap.json` together, `docs/README.md` inventory.

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Finding ids churn across re-runs and destroy review history | Medium | Q2 scheme, perturbation tests in phase 1 and 2, `evidence_version` separate from id |
| Row-to-item identity is positional (`item_index`) and breaks when the selection differs between runs | High | Adapter keys on manuscript anchors, not `item_index`; GUIDs added from Lua in phase 6 |
| Loop leaves the narrator's time selection or repeat state changed | Medium | Q6: capture and restore, spike first, explicit Stop, restore on bridge close |
| Bridge liveness cannot be detected today, so buttons lie | High | `ping`/`PONG` in phase 6; disable REAPER actions when no recent `PONG` |
| Lua changes cannot be proven by CI | High | Manual REAPER checklist per Lua phase; user-run only; do not treat green `pnpm check` as proof (`CLAUDE.md`) |
| Guide findings flood the queue | Medium | Q7 conditions; measure on a real manuscript before phase 3 is accepted |
| Large books make the list slow | Medium | Q9 host-side query, virtualization decided from real counts (TBD) |
| Concurrent sessions collide on the Lua dispatcher, `bindings.go`, host API version, `AppShell` NAV and ADR numbers | High | See Parallel-session compatibility |
| Adding the Review nav item regenerates every doc screenshot (nav change, per prior phase experience in project memory) | Certain | One nav-changing PR at a time; coordinate with the teleprompter PRD's final phase |

## Implementation Phases

Every phase follows the `CLAUDE.md` workflow: plan (find or open the tracking issue first and put `Closes #<n>` in the PR, `docs/operations/github-workflow.md`), `change-impact-scan` (mandatory for `integrations/reaper` and `apps/ui/src` shared components), TDD, `full-verification-gate` (`pnpm check`, not `check:fast`), `design-spec-guard` when `primitives/` or `styles.css` change, `feature-cleanup`. Phases that change `apps/ui` also run the Playwright visual suite for the affected page and states and the component atlas, and view every generated PNG at `desktop`, `small-desktop`, `tablet` and `mobile` (`apps/ui/tests/visual/viewports.ts`). Phases that add or change bindings bump the host API version in `apps/desktop/app.go:33`, `apps/desktop/app_test.go:39-42` and `apps/ui/src/hostApi.ts:2` together. Phases that change `integrations/reaper` require a user-run manual REAPER checklist. Re-check `docs/adr/` immediately before numbering any ADR (take the next free number at merge time; 0027 at d5cc994, and parallel sessions each want one). This PRD plans host API 5 to 6 (phase 4) and 6 to 7 (phase 7), and `teleprompter-manuscript-integration.prd.md` also plans 5 to 6; whichever PR lands second increments again; check `hostAPIVersion` at merge time.

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Findings store and contract amendments | Go store for analyzer output and review decisions in the project sidecar; merge on re-run; `evidence_version`; nullable confidence; `resetDerived` decision; docs | complete | - | - | - |
| 2 | Transcript Compare to findings | Go adapter over `results_<run>.txt` plus bridge events; ids per Q2; ingest on `COMPARE_INSPECTED`; UI type gains confidence | complete (UI `Discrepancy` type deferred to phase 5 per this phase's own scope: "only if the existing page consumes them") | 3, 4, 6 | 1 | - |
| 3 | Manuscript Guide to findings | Go adapter over `manuscript_guide.json`; entity and pronunciation conditions per Q7; resolved-upstream handling | pending | 2, 4, 6 | 1 | - |
| 4 | Host bindings for review | List/get/review bindings with a filter query, `contracts/findings.ts`, mock, wailsClient, wailsjs, host API 5 to 6 | pending | 2, 3, 6 | 1 | - |
| 5 | Review page | `/review` list, filters, sort, detail, decisions, stale states, stories, catalog states, docs and screenshots | pending | 6 | 4 (2 and 3 for real data) | - |
| 6 | REAPER navigation and looping bridge | Lua `navigate_item`, `loop_context`, `stop_loop`, `ping`; GUIDs on compare events; Go client and adapter fill; manual checklist | pending | 3, 4, 5 | 2 | - |
| 7 | Wire navigation into host and UI | Bindings and buttons for Go to / Loop / Stop, bridge-status states, host API 6 to 7 | pending | - | 5, 6 | - |
| 8 | Per-finding approved marker and M1 close-out | Lua add-marker with undo block, confirm dialog, executor plumbing reusable by TR-5; `roadmap.md` and `roadmap.json` together; doc closure | pending | - | 7 | - |

### Phase Details

**Phase 1 - Findings store and contract amendments** — delivered.
- **Goal**: A tested Go store that persists findings and decisions and survives re-runs.
- **Scope**: `Store` in `apps/desktop/internal/findings` with atomic temp-then-rename writes; per analyzer and chapter partitions; `Merge` semantics (same id and `evidence_version` keeps the decision, changed version resets to unreviewed and keeps the note, absent ids flagged "not in latest run" and never deleted); append-only decision history; query type for filter/sort (Q9); additive record fields per Q3; add the findings directory to `resetDerived` per Q5; update `findings-contract.md` and the `daw-integration.md` sidecar rules; ADR only if Q1 or Q3 outcomes warrant one.
- **Success signal**: Table tests for merge, id stability under perturbation, corrupt-file handling (never silently swallowed), concurrent read during write, and clear-on-replace; `pnpm check` green; coverage 80% or better on the package.
- **Delivered as**: `findings.Store` (`NewStore`, `SetPersist`, `SaveAnalyzerFindings`, `RecordDecision`, `List`, `Get`) in `apps/desktop/internal/findings/store.go`, with `store_test.go` covering merge-keeps-decision, evidence-version-change resets to unreviewed and keeps the note, not-in-latest-run carry-forward and List filtering, corrupt scope/review files (via `persist.Reporter`, following the existing `settings.Store` convention rather than a hard error, except when the file exists but cannot be read at all), concurrent `List`/`SaveAnalyzerFindings`, and append-only history. `resetDerived` (`apps/desktop/internal/manuscript/service.go`) now also removes `narration-utils/findings/`, covered by `TestResetDerivedClearsTheFindingsDirectory`. No ADR was needed: Q2-Q5 were owner-decided (not left "Proposed"), so the reconciliation above records them in this PRD's own Decisions Log instead. Q9 (filters/sort in Go) is partially realized by `Store.Query`/`List`; the host binding that exposes it is Phase 4. `go build`, `go vet`, and `go test ./...` on `apps/desktop` are green; `internal/findings` coverage is 88%. The UI package is untouched by this phase, so no Playwright/atlas run was needed.

**Phase 2 - Transcript Compare to findings**
- **Goal**: Every marker row becomes a valid finding without losing text.
- **Scope**: Go adapter and fixtures from real result files; join results-file rows with `COMPARE_MARKER` events on row id; call from the transcript service where `persist` runs; carry `markerState` and existing-marker evidence; do not change `compare.py`, the marker protocol, or the Lua bridge; add `confidence` and `timingGapSeconds` to the TS `Discrepancy` type only if the existing page consumes them (otherwise leave for phase 5).
- **Success signal**: Fixture test maps 100% of rows; re-run test yields zero new ids; existing Transcript page behavior and tests unchanged.

**Phase 3 - Manuscript Guide to findings**
- **Goal**: Entity and pronunciation issues appear as findings and resolve when the Story Bible resolves them.
- **Scope**: `apps/desktop/internal/guide` adapter reading the existing JSON through the existing normalization (`service.go:67-106`); no Python change; evidence excerpts and chapter carried from occurrences; numeric confidence mapping from the label with its reason; findings have no time range or source by design.
- **Success signal**: Fixture from a real guide file; locked and reviewed entities produce no open finding; count on a real manuscript recorded in the PR (informs Q7).

**Phase 4 - Host bindings for review**
- **Goal**: The UI can read and decide findings through typed bindings.
- **Scope**: `FindingsList(query)`, `FindingsReview(id, status, note)` (and a summary count for the nav badge), guarded like the other bindings (snapshot the service pointer under `h.mu.RLock`, the `h.services()` pattern of `docs/architecture/host-binding-concurrency.md`); wailsjs regenerated; mock fixtures; `wailsClient.test.ts`; host API 5 to 6.
- **Success signal**: Go binding tests, UI contract and mock tests, `app_test.go` version test updated, no UI page yet.

**Phase 5 - Review page**
- **Goal**: A narrator can list, filter, inspect and decide findings.
- **Scope**: `components/review/*`; new primitives only where needed (each with stories, atlas entry, `design-spec-guard`); `/review` route and `NAV` entry; chapter grouping (the chapter each finding carries, falling back to the shared track-to-chapter mapping from `teleprompter-manuscript-integration.prd.md` Phase 8 for findings that carry only a track or item GUID, once that mapping exists); confidence display and low-confidence hide control; jump to manuscript; states: default, filtered, empty, detail-open, evidence-changed, not-in-latest-run, decision-saved; catalog rows and drivers (`visual-catalog-sync`); guide page (`docs/guides/using-the-app/review.md`) and `doc-screenshots.json` (`doc-screenshot-sync`).
- **Success signal**: Visual suite green with every state's four PNGs reviewed; atlas green; Review page usable with the mock and with real data from phases 2-3.

**Phase 6 - REAPER navigation and looping bridge**
- **Goal**: Go can ask REAPER to go to and loop a finding, and know whether REAPER is listening.
- **Scope**: Lua commands per Architecture Notes with the stale rule and undo blocks; append GUIDs (item, take, track) as trailing fields on `COMPARE_MARKER` and read them in the adapter (never reorder existing fields); Go bridge client methods and event handling; write and check in the manual REAPER checklist next to `manuscript-line-identity.md`'s style; Q6 spike outcome recorded.
- **Success signal**: Go tests with a fake bridge; the user runs the checklist in REAPER and confirms stale GUID refusal, loop restore, ping after REAPER restart; `stylua --check` passes (format only, proves nothing about behavior).

**Phase 7 - Wire navigation into host and UI**
- **Goal**: Go to / Loop / Stop work from the Review page with honest availability states.
- **Scope**: Bindings, contract, mock, buttons, bridge-status states (standalone launch, REAPER not running, running, stale finding), host API 6 to 7, visual states at four viewports.
- **Success signal**: UI tests and visual suite; the manual checklist re-run end to end from the page.

**Phase 8 - Per-finding approved marker and M1 close-out**
- **Goal**: Meet the adapter's "add an approved marker" criterion and close the milestone's documentation.
- **Scope**: Lua `add_take_marker` by take GUID with the existing 0.15 s duplicate rule (`narration_ui_bridge.lua:178-187`) and one undo block; confirm dialog; a generic "execute suggested action" path in Go that TR-5 reuses; `roadmap.md` and `config/roadmap.json` updated together (the merge also re-syncs the GitHub milestone description); the reworded dashboard surface per Q1 in the docs that still say "REAPER panel", `findings-contract.md` ("existing analyzers do not emit it yet", line 3), `transcript-compare.md`, `manuscript-guide.md`, `docs/README.md`, `codebase-map.md`.
- **Success signal**: Manual checklist for add, duplicate skip and undo; `feature-cleanup` clean; `pnpm check` green.

### Parallelism Notes

After phase 1, phases 2, 3, 4 and 6 touch disjoint code (transcript service, guide service, bindings and contracts, Lua and bridge client) and can run at once; phase 5 needs phase 4's contract but can start against the mock. Phases 7 and 8 are strictly sequential. The three-place host API bump and the Lua dispatcher are the serialization points across all PRDs.

### Parallel-session compatibility

| Phase | Files and areas touched | Likely collisions |
| --- | --- | --- |
| 1 | `apps/desktop/internal/findings/*`, `docs/architecture/{findings-contract,daw-integration}.md`, `apps/desktop/internal/manuscript/service.go` (`resetDerived` list, line 434) | Diagnostics and character PRDs also write findings or add directories to `resetDerived`; agree one store API before either starts; `resetDerived` is one slice literal, expect textual conflicts |
| 2 | `apps/desktop/internal/transcript/service.go` and tests, new adapter file, `apps/desktop/app.go:173` constructor call | Any session editing the transcript service (teleprompter matcher work reuses `compare.py` logic but not this file) |
| 3 | `apps/desktop/internal/guide/*` (new file plus test) | Character PRD phase 2 changes the guide data shape (stable ids, dialogue cues); adapter must tolerate additive fields |
| 4 | `apps/desktop/bindings.go`, `apps/desktop/app.go` (`hostAPIVersion`), `apps/desktop/app_test.go`, `apps/ui/src/{hostApi.ts,api/contracts/findings.ts,api/mockApi.ts,api/mockFixtures.ts,api/wailsClient.ts}`, `apps/ui/wailsjs/go/main/Host.*` | Every phase in every PRD that adds a binding or sidecar argument; two PRs both bumping to 6 will conflict, so the second to merge rebases to the next number |
| 5 | `apps/ui/src/components/review/*`, `primitives/*` (new), `App.tsx`, `App.test.tsx`, `AppShell.tsx`, `tests/visual/{state-catalog.ts,app.spec.ts,app.drivers.ts,doc-screenshots.json}`, `docs/guides/using-the-app/` (new `review.md` page plus its `README.md` index row and Previous/Next footers), `docs/images/ui/*` | Teleprompter PRD phase 13 (nav and all screenshots) and any other nav-changing PR |
| 6 | `integrations/reaper/narration_ui_bridge.lua`, `apps/desktop/internal/bridge/*`, `apps/desktop/internal/transcript/service.go`, manual checklist doc | Every Lua PR (teleprompter phases 11-12, TR-5, reaper-automation-follow-through): the command dispatcher `if/elseif` chain (`narration_ui_bridge.lua:522-553`) is a guaranteed conflict spot; order merges and rebase, or agree to add a table-driven dispatch first |
| 7 | Same as 4 plus `components/review/*` and visual states | As 4 and 5 |
| 8 | Lua, `apps/desktop/internal/*` executor, review UI, `docs/roadmap.md`, `config/roadmap.json`, listed docs | Any milestone-status edit; roadmap files must change together, so only one session edits them at a time |

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Local-first; no cloud analysis (prior decision) | Everything runs locally | Cloud analyzers | `docs/roadmap.md:10`, `:59` |
| Analyzers never silently change audio; findings are evidence-based and reviewable (prior decision) | Findings suggest, narrator confirms | Auto-apply | `findings-contract.md:23-27`, `roadmap.md:10` |
| Every new analyzer emits findings before a bespoke UI; dashboard reproduces no analyzer algorithm (prior decision) | Adapters emit findings; page reads them | Per-analyzer UIs | `roadmap.md:64-65` |
| UI in React, logic in Go, REAPER Lua only for REAPER-only state (prior decision) | Review UI is a Wails page | Lua panel | `daw-integration.md:7`, `:11-12` |
| No loopback server, REST endpoint or port (prior decision) | File bridge only | Local HTTP | `daw-integration.md:11-12` |
| Measurement analyzers live in Go; no distributor profile before independent specification (prior decision, ADR 0025) | Go owns findings production | Third sidecar | ADR 0025 |
| Timing-confidence signal over forced alignment (prior decision, ADR 0008) | Keep free-transcribe-then-diff | WhisperX or MFA | ADR 0008; do not change the marker field count |
| Line identity in item extension data; Lua only for now, REAPER verification and Go client are a later phase (prior decision, ADR 0026 and user) | Not a dependency of this PRD | Sidecar identity | ADR 0026; findings use GUIDs |
| Dismissed findings stay auditable; ids do not change unless evidence materially changes (prior decision) | Append-only history; id plus `evidence_version` | Delete on dismiss | `findings-contract.md:27` |
| GUIDs preferred for navigation; positional data is the stale fallback (prior decision) | Navigate by GUID, refuse stale | Nearest item | `findings-contract.md:24`, `daw-integration.md:43-44` |
| Windows-first, REAPER-first, US-English-first (prior decision) | No other platform work | Cross-platform now | `docs/README.md` (closing paragraph) |
| Dashboard surface (proposed, Q1) | Wails Review page | REAPER panel, both | Boundary, testability, standalone use |
| Id and evidence versioning (decided, Q2) | Manuscript-anchored id plus `evidence_version` | Audio-anchored id | Survives model and timing changes |
| Contract gaps closed additively within schema v1 (decided, Q3) | Nullable `confidence`, `manuscript.span`, `time_range` source-relative offsets, `evidence_version` | Bump `schema_version` to 2; tuck extras into `evidence` | No findings persisted anywhere yet, so an additive amendment is free now and costs a version bump later |
| Adapters in Go (decided, Q4) | Go over results file plus events | Python emitters | Keeps sidecar contracts frozen |
| Findings sidecar layout (decided, Q5) | `narration-utils/findings/`, host-only writer, temp-file-then-rename | Single file, SQLite | Separates analyzer output from decisions; `resetDerived` clears it on manuscript replace/Clear |

## Research Summary

**Market Context** (per the research doc, secondary sources, not re-verified): PromptVO markets live misread detection and post-recording proofing without a documented DAW mechanism; Pozotron is a commercial proofing service that exports pickup markers; ReaSpeech indexes transcripts as markers in REAPER through ReaImGui and is GPL-3.0; a community script set adds character take reports and pickup import (no license declared, so learn from it, do not copy). The research found no surveyed tool that keeps a persistent, reviewable finding queue with recorded decisions inside the narrator's own workspace, but that conclusion rests on absence in search results (`docs/research/reaper-automation-surface.md` sections 7 and 9).

**Technical Context**: The file bridge is a thin executor by design, and the research recommends keeping validation and safety in the host and reporting "uncertain outcome" rather than guessing (section 4.6). `SetEditCurPos`, `GetSet_LoopTimeRange`, `GetSetRepeat` and `OnPlayButton` cover navigation and looping; whether time-selection changes are undoable and how to detect "stopped" from a `defer` loop are unverified (section 3, marked (U)). `GetProjectStateChangeCount` gives cheap change detection for stale checks without callbacks. Existing Go precedents to follow: atomic file writes (`transcript/service.go:177-182`), first-use gating (`bindings.go:373-399`), and the `/media` route for any later in-app audition.

**Docs versus code found while verifying** (each is fixed or recorded by the phase named): the "REAPER panel" wording versus the Wails boundary (Q1, phase 8 docs); the contract's `manuscript` text span, source-relative `time_range`, project identity and "evidence version" versus the Go record (Q3, phase 1); `.narration-last-comparison.json` and the `TranscriptCompare/` and `ManuscriptGuide/` folders sitting outside `narration-utils/` and undocumented in the sidecar rules (Q5, phase 1); `daw-integration.md:15` saying mutations use undo blocks while marker export uses `Undo_OnStateChange` (`narration_ui_bridge.lua:292`, phase 6 follows the block form); and the "Play recorded audio" button in `Results.tsx`, which only selects the item and calls `SetEditCurPos`, so it plays nothing (`Results.tsx:160-169`, `narration_ui_bridge.lua:531-541`).

---

*Generated: 2026-09-19*
*Status: DRAFT - needs validation*
