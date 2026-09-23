# Take Review: Pickups, Duplicates, and Take Intelligence

**Supersedes:** `docs/utilities/duplicate-and-pickup-finder.md`, `docs/utilities/take-intelligence.md` (planned-work briefs, removed when this PRD landed; recoverable from git history)

Roadmap milestone 2 ("Recording and take review", `docs/roadmap.md:26-30`), covering the Duplicate and Pickup Finder and Take Intelligence briefs (superseded by this PRD and removed from the tree; their line citations below refer to the briefs as of d5cc994, readable with `git show d5cc994:docs/utilities/duplicate-and-pickup-finder.md` and `git show d5cc994:docs/utilities/take-intelligence.md`) and [Recording, Pickups, and Comping](../workflows/recording-and-comping.md). Re-checked against `main` at d5cc994 on 2026-09-19: none of the code files cited here changed since b9d348d. Citations are `file:line` on branch `claude/features-defects-prds-planning-87c378` (b9d348d) for anything checked in code; "per docs" marks a claim taken from a document and not verified. Sibling PRDs (written in parallel; file names only): `review-dashboard-and-findings-adoption.prd.md` (milestone 1, prefix RD, the foundation this PRD depends on), `character-continuity-review.prd.md` (prefix CC), `teleprompter-manuscript-integration.prd.md`, `diagnostics-delivery-and-cleanup-tools.prd.md`, `reaper-automation-follow-through.prd.md`. In Depends columns this PRD's own phases are bare numbers; other PRDs' phases are `RD-n`, `CC-n`, or named.

## Problem Statement

A narrator who records a line again, restarts after a false start, or records pickups elsewhere in the session has to find the alternate read by ear, judge it against the manuscript, and assemble it into the right item by hand. Transcript Compare only judges the active take of the selected items, so it shows a restart as a stray "extra" and knows nothing about alternates. The cost is hours of hunting and re-listening per chapter, plus the risk that a well-meant automatic tool makes editorial calls the narrator must own.

## Evidence

Verified in code:

- **Categories exist, no producer exists.** `pickup`, `duplicate_read` and `take_comparison` are documented categories (`apps/desktop/internal/findings/findings.go:30-32`) and `Validate` rejects anything else (`:138`). Nothing emits them, and the store, adapters and Review page they need are milestone 1 work (`review-dashboard-and-findings-adoption.prd.md`).
- **Transcript Compare sees one take.** `prepare_compare` reads only the active take of each selected item (`integrations/reaper/narration_ui_bridge.lua:139`), stitches the items into one audio stream (`sidecars/transcript-compare/core/compare.py:444-464`) and diffs it against one chapter. A false start becomes an `EXTRA` marker (`compare.py:1118-1122`); a re-read elsewhere is invisible unless it is part of the selected items.
- **Timestamped words are not an output.** The sidecar keeps `(word, start, end)` tuples in memory (`compare.py:485-526`) and writes only `SUMMARY`, `DIFF` and `MARKER` lines (`:1538-1563`). Chunked runs write per-chunk JSON under `<results>_chunks/` (`:1488`, `:616-680`) and clean it up on a best-effort basis (`:772`). Additive tagged lines are safe for consumers: the Lua reader handles only `SUMMARY` and `MARKER` (`narration_ui_bridge.lua:201-204`) and Go only checks the `NEED_CHAPTER|` prefix (`apps/desktop/internal/transcript/service.go:486`).
- **No take manipulation exists anywhere.** The bridge commands are `prepare_compare`, `inspect_compare_results`, `export_compare_markers`, `jump_to_compare_marker`, `stamp_item_lines`, `read_line_ids`, `create_chapter_regions`, `close` (`narration_ui_bridge.lua:525-553`). A repo-wide search of Lua, Go and docs finds no use or mention of `AddTakeToMediaItem`, `SetActiveTake`, `SetMediaItemTake_Source` or `I_CURTAKE`. How REAPER behaves when a take is added (which take becomes active, what happens when source length and item length differ) is therefore unverified.
- **The static project model can now list takes (Phase 2, delivered).** The analysis evidence ledger PRD's Phase 1 parser superset (`feat/analysis-evidence-ledger-p1-item-model-parser-superset`, merged into this stack per Q11(a) of that PRD) gave `Item` a `GUID` (from `IGUID`), `ActiveTake` and `Takes []Take` (each with its own `GUID`, `SourceFile`, `SOFFS`, `PlayRate`, `SECTION` offsets, FX-chain presence, stretch-marker count and extension data), tested against the REAPER-saved multi-take fixture (`apps/desktop/internal/tracks/testdata/reaper/saved-cases.rpp`, three real takes). This PRD's own Phase 2 adds `Project.ItemByGUID` (Q6's target-identity lookup) and extends `/media`'s `authorizedMediaSource` to authorize every take's source, not only each item's active one (that PRD's Q10 explicitly deferred the "every take" extension to here).
- **`/media` would not serve alternate takes.** `authorizedMediaPath` allows only the source of each item's first `<SOURCE>` (`apps/desktop/media.go:51-64` over `parse.go:73`), so a second take that points at a different file is refused today.
- **Line identity is Lua-only.** The three commands exist (`narration_ui_bridge.lua:380-509`), no Go, TypeScript or Python file calls them (repo grep), the manual checklist has not been run (`docs/architecture/manuscript-line-identity.md:3`, per docs), and the user's recorded decision is Lua only for now with the REAPER verification and Go client as a later phase (project memory). Its "later phases" list a Go client and consumers such as a pickup list (`manuscript-line-identity.md:42-48`).
- **Measurements are whole-file and WAV-only.** `measure.Analyze(io.Reader)` and `AnalyzeFile` take a whole stream (`apps/desktop/internal/measure/measure.go:52,103`) and ADR 0025 limits input to mono or stereo PCM/float WAV. There is no range-limited analysis, and `Report` carries sample peak and true peak but no clipped-sample count (`measure.go:32-46`). No host binding calls `measure` yet.
- **Timing evidence available today** is word timestamps and the pause gap already used for sentence splitting (`compare.py:64`, `:347-358`) and the `confidence`/`timing_gap_seconds` label (`:1017-1039`). Forced alignment is deliberately deferred (ADR 0008), which caps how precisely a divergence can be localized inside a take.
- **Bridge and settings plumbing** the phases reuse: the bridge client exists only when launched from REAPER (`apps/desktop/app.go:169-173`); layered settings resolve project, global, repo default (`apps/desktop/internal/settings/store.go:25-50`) with built-in defaults that must mirror `config/defaults.json` (`store.go:38-42` comment).

Per docs (not verified in code): the research report names retakes as fixed lanes (`I_FREEMODE=2`, `C_LANEPLAYS`, a 7.54 action that plays only the most recently played lane) and per-take extension data (`GetSetMediaItemTakeInfo_String` with `P_EXT`) as available REAPER surface, marks all of it unverified, and ranks "Pickup list" and "Retakes as fixed lanes" as opportunities 4 and 8 (`docs/research/reaper-automation-surface.md` sections 3 and 9). Narrator workflow claims (a roughly 6.2 hours of work per finished hour, a proofer-flags-then-narrator-re-records-then-editor-integrates pickup loop) come from secondary sources (research section 8).

Assumption - needs validation through an annotated set of 3-5 permissioned chapters with at least 25 known pickup or duplicate locations (the same sample size the local-dependency plan uses for alignment trials, `docs/research/local-dependency-evaluation.md`, MFA trial): that transcript-plus-manuscript alignment finds most in-session pickups and restarts. No labeled data exists in the repo.

## Proposed Solution

Add a read-only repeated-read analyzer that transcribes the items and takes in a chosen scope, aligns each read to the manuscript, and groups reads that cover the same manuscript span into `pickup` and `duplicate_read` findings with full evidence (matched span, both source ranges, match quality, and whether the alternate covers the whole span or only part). The findings appear in the Review page from milestone 1. When the narrator approves one and explicitly picks a target item, a confirmed, undoable REAPER action adds the candidate's source range as a new take in that item, preserves the previously active take, and records provenance. Take Intelligence then compares the takes in a group with separate text, timing and technical evidence per take, localizes divergence to sub-spans, and offers side-by-side audition; the narrator chooses the active take. No composite "best take" score, no automatic activation, no comping. Localizing divergence to sub-spans matters because a take is often partly usable (a clean first half with a flub partway through): the narrator can then combine the usable part of one take with the usable part of another through the confirmed take creation, instead of an all-or-nothing choice, and the partial-span match in the finder is the matching per-take signal.

## Key Hypothesis

We believe grouping repeated reads by manuscript span, and showing each with evidence and side-by-side audition, will let narrators locate and compare alternate takes faster than hunting by ear, without making an editorial decision for them, for narrators who record pickups and retakes inside the project. We'll know we're right when (a) the analyzer finds at least the proposed target share of known pickups on the annotated set (assumption: recall of 80% or better, precision of 60% or better, to be calibrated on that set), (b) it produces no group on curated intentional-repetition fixtures, (c) take creation never changes the active take or any other item and undoes cleanly (manual REAPER checklist), and (d) narrators report finding an alternate faster than by hand (baseline TBD - needs research).

## What We're NOT Building

| Item | Why |
| --- | --- |
| Automatic comping, automatic take activation, or moving or deleting source media | Recorded rule (`roadmap.md:10`; workflows "Safeguards") |
| A composite "best take" score as the headline | Retired `take-intelligence.md:36`: no single number defines a better performance; users over-trusting it is the named risk. Separate evidence categories only |
| Judging emotion, intention or acting, or "character fit" of a take | Out of product boundary. Closeness to an approved character reference is later work and belongs to `character-continuity-review.prd.md` |
| Treating every repetition as a mistake | Retired `duplicate-and-pickup-finder.md:36`; thresholds are conservative and reviewable |
| Inferring the target item from a weak match | Same doc; the narrator chooses, the tool may rank suggestions |
| Acoustic-similarity matching of different reads (fingerprints, DTW) | New dependency, unproven value; evaluate under the local-dependency protocol first (Q1) |
| True forced alignment (MFA, WhisperX) | ADR 0008 gates it on evidence that timing confidence is insufficient; it would add PyTorch or Kaldi |
| Cross-session search index and configurable similarity presets | "Later work" in the retired `duplicate-and-pickup-finder.md` brief |
| Live pickup detection during recording, punch-and-roll, arming | Owned by `teleprompter-manuscript-integration.prd.md` and `reaper-automation-follow-through.prd.md` |
| Explicit collection of alternate readings during recording | "Later work" in the finder brief. This milestone analyzes takes and reads already in the project; recording-time capture is not scoped by any PRD, and the nearest item is retakes as fixed lanes in `reaper-automation-follow-through.prd.md` (phase 25) |
| Importing Pozotron or other proofer marker files | Research opportunity 4, not in the milestone docs; separate scope |
| Take handling for Audacity | No equivalent (`daw-integration.md`, Audacity boundary); deferred |
| Narrator-adjustable weights and calibration from decision history | Take Intelligence "Later work"; only meaningful once decisions accumulate |

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Known pickups and duplicates found (recall) | Proposed 80% or better (assumption, calibrate) | Annotated set of at least 25 known locations over 3-5 permissioned chapters, held out from tuning |
| Precision of surfaced groups | Proposed 60% or better (assumption, calibrate) | Same set, counting narrator "reject" as false positive |
| Intentional repetition and similar dialogue producing groups | 0 on the curated fixture suite | Pytest fixtures: exact copy, pickup, restart, repeated prose, echoed dialogue, unrelated similar phrase (per the retired `duplicate-and-pickup-finder.md` acceptance list) |
| Take creation safety | 0 changes to the previously active take, other items, item length or notes/names; one undo step restores the project exactly | Manual REAPER checklist (user-run) |
| Provenance | Every created take traceable to finding id, source file and range | Automated test on the payload plus manual read-back |
| Reproducibility of comparison | Identical inputs give identical measurements and evidence, and every reported score can be reproduced from the stored measurements | Go tests (retired `take-intelligence.md` acceptance list) |
| Missing evidence handling | Missing transcript, unsupported format or missing reference lowers coverage and is labeled unavailable, never a penalty | Unit tests per metric |
| Time to locate an alternate | TBD - baseline needed | Timed dogfood against the manual workflow |
| Analysis time per hour of audio | TBD - depends on Whisper model and hardware | Measured in phase 3; sets the scope-size guidance |
| Gate | `pnpm check` green each phase; visual suite reviewed at four viewports for UI phases | CI and PNG review |

## Open Questions

- [ ] **Q1. What signal detects a repeated read?** Options: (A) transcript-to-manuscript alignment of every read in scope, grouping reads that cover the same manuscript span, plus exact-copy detection from item source identity; (B) acoustic similarity (fingerprint or DTW) with a new dependency; (C) A plus Silero VAD region clusters as an extra restart cue (`docs/research/local-dependency-evaluation.md`, candidate 7, per docs). Recommendation: A for the milestone, with C evaluated under the documented protocol; B deferred until A demonstrably misses reads that acoustics would catch. A reuses ASR and the manuscript diff the product already ships.
- [ ] **Q2. Where does the repeated-span detector run?** Options: (A) an additive mode of the Python Transcript Compare sidecar, emitting new tagged lines, with a Go adapter making findings (as in milestone 1); (B) a Go analyzer over persisted timestamped words; (C) a new sidecar. Recommendation: A. Tokenization, equivalences, number-word merging and homophones exist only in Python (`compare.py:216-312`) and a Go copy would drift; additive tagged lines are ignored by current readers (evidence above); ADR 0025's objection to a third runtime applies to C.
- [ ] **Q3. What is the scan scope?** Options: (A) the chapter track's items and all takes of those items; (B) A plus one narrator-designated pickup track or time range; (C) the whole project. Recommendation: B. Pickups are often recorded on a separate track or later in the timeline, but a whole-project scan multiplies ASR time by hours and invites false matches. C is the documented cross-session "later work".
- [x] **Q4. How is a take created?** Decided (phase 1 spike, [write-up](../research/take-review-spike-p1-take-mechanics.md)): **A**, add the candidate's source range as a new take on the target item, via `AddTakeToMediaItem` + `SetMediaItemTake_Source`. The spike confirmed: the previously active take stays active (`AddTakeToMediaItem` never touches `I_CURTAKE`); item `D_LENGTH` is unaffected by a candidate longer or shorter than the target item; source-offset alignment to a manuscript span's start uses the take's `D_STARTOFFS`; one `Undo_BeginBlock2`/`Undo_EndBlock2` around the add plus the provenance write is one undo step. It also found that undo/redo replace REAPER's item/take Lua objects project-wide, so the phase 6 command must re-resolve the target item and new take by GUID after `Undo_EndBlock2`, never keep the pre-add pointers.
- [x] **Q5. Where is take provenance stored?** Decided (phase 1 spike): **A**, namespaced take extension data (`P_EXT:narration_utils_take_finding_id`, `P_EXT:narration_utils_take_source_file`, `P_EXT:narration_utils_take_source_range`). The spike confirmed it round-trips through undo/redo as one unit with the take-add, survives save and reload, and does not collide with the item-level `narration_utils_line_id` key from ADR 0026. [ADR 0098](../adr/0098-take-provenance-in-take-extension-data-extends-adr-0026.md) records this, extending (not superseding) ADR 0026. Left open for phase 6's manual checklist: what a split or a take-specific duplicate does to a take's own provenance block (not re-tested by this spike; item-level split/duplicate behaviour was already proven by the S0 spike).
- [x] **Q6. Does this milestone require manuscript line identity stamps?** Decided (phase 2): **B**, do not require them. Spans come from alignment at analysis time (phase 3+); stamped ids only pre-select a target item when present, and are not required by anything in phase 2. `Project.ItemByGUID` (new, `apps/desktop/internal/tracks/tracks.go`) resolves an item by its own `IGUID` regardless of which take is active or which track holds it, giving any later phase the explicit, unstamped target identity this recommendation calls for, re-resolvable against a freshly parsed project immediately before a mutation. Options: (A) require stamps before scanning; (C) this PRD builds the Go client for stamps. Neither adopted, per rationale above.
- [ ] **Q7. How is side-by-side audition delivered?** Options: (A) in the app, two raw source ranges with the target and each candidate played from their own source plus pre/post roll via `/media`, no REAPER mutation, works standalone; (B) in REAPER, looping the timeline context and temporarily switching the active take (restored afterwards); (C) both. Recommendation: A first. It needs no REAPER state change and respects "no automatic active-take change"; it must be labeled "raw source, no FX or edits" because processing chains may differ (the doc names that risk). B is a later Should once the milestone 1 loop plumbing is proven. A needs take-aware source ranges from the static reader (phase 2) and the `/media` authorization change.
- [ ] **Q8. Does the app set the active take?** Options: (A) never, the narrator does it in REAPER; (B) an explicit, confirmed, undoable "Make active" action. Recommendation: A for this milestone (smaller Lua surface, matches the workflow text "choose the active take manually"); B as a later addition using the executor from `RD-8`.
- [ ] **Q9. Any composite score at all?** Options: (A) none, per-category evidence only; (B) an optional narrator-weighted composite; (C) a fixed composite. Recommendation: A. The take-intelligence doc lists weights as an input but its MVP is separate evidence; B waits for accumulated narrator decisions to calibrate, C is what the doc warns against.
- [ ] **Q10. How precisely can divergence be localized inside a take?** Options: (A) diff plus ASR word timestamps per take (ADR 0008's approach); (B) forced alignment (new PyTorch or Kaldi dependency, new ADR superseding 0008). Recommendation: A, with an explicit evaluation gate on the annotated set; escalate to B only with evidence that word-level timing is too coarse to show the divergent sub-span, exactly the condition ADR 0008 states.
- [ ] **Q11. How do restarts map onto the fixed category list?** Options: (A) category `pickup` with `evidence.kind` of `restart`, `pickup` or `exact_copy`, and `duplicate_read` for near-identical re-reads; (B) add a `restart` category, amending the contract. Recommendation: A, since `Validate` rejects unknown categories (`findings.go:138`) and every amendment touches all producers.
- [ ] **Q12. Where do detection thresholds live?** Options: (A) layered project settings with conservative built-in defaults (mirroring `defaults.json`, `store.go:38-42`); (B) constants in the sidecar. Recommendation: A, because narrators with repetitive prose need per-project tuning and the roadmap wants thresholds reviewable.

## Users & Context

**Primary User**

- **Who**: A narrator (often also the editor) recording in REAPER on Windows who records pickups and retakes in the same project.
- **Current behavior**: Listens back to find the good read, drags items or splits by hand, sometimes stacks takes manually; runs Transcript Compare on the assembled timeline only.
- **Trigger**: A chapter has been recorded with false starts, corrections or retakes, or a proofing pass produced pickups to re-record and integrate.
- **Success state**: Each flagged line has its alternate reads listed with evidence, the chosen one sits as a take in the right item with provenance, and the narrator chose the active take knowingly.

**Job to Be Done**: When I have recorded a line more than once, I want the alternates found, lined up against the manuscript and playable side by side, so that I can pick the read I want and have it in the right place without hunting or trusting a black box.

**Non-Users**: Reviewers receiving reports; anyone expecting automatic comping; Audacity users (deferred).

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Notes |
| --- | --- | --- |
| Must | Repeated-span analyzer: restart, pickup, exact and near-duplicate detection with manuscript span association | Phases 3-4 |
| Must | Partial-span match surfaced distinctly from full match | Retired `duplicate-and-pickup-finder.md` MVP; `evidence.coverage` |
| Must | Findings visible and decidable in the Review page; navigate to candidate and target | Phase 5; needs `RD-5`, `RD-6` |
| Must | Take creation only after narrator approval and explicit target item, undoable, provenance kept, previous active take preserved | Phase 6 |
| Must | Same-span validation before any comparison; comparison never ranks mismatched spans | Phase 10 |
| Must | Per-take evidence: word fidelity, clipping and noise indicators, duration, pause profile, level consistency, each explained, unavailable evidence labeled | Phases 8, 10 |
| Must | Sub-span divergence per take | Phases 9-10 |
| Should | Side-by-side A/B audition with loop and pre/post roll | Phase 7 (Q7) |
| Should | Scan scope selector including a pickup track | Phase 5 (Q3) |
| Should | REAPER-side timeline-context audition | Later, after Q7 A |
| Could | Explicit "Make active" action | Q8 B |
| Could | Silero VAD restart cue | Q1 C, only after evaluation |
| Won't | Composite score, weights, cross-session index, auto-comp, character-reference ranking | See table above |

### MVP Scope

Phases 1-10 deliver the milestone. If time-boxed, the smallest coherent slice is phases 2, 3, 4, 5 (find and review pickups and duplicates) followed by 6 (create takes). Take Intelligence (7-10) can follow.

### User Flow

1. Narrator opens Review, chooses Find pickups and duplicates, sets scope (chapter track, optional pickup track), and starts the analysis. Progress is real (ADR 0015).
2. Findings appear grouped by manuscript span with the target read, each candidate, match quality and coverage (full or partial), timestamps and transcript evidence.
3. Narrator auditions target versus candidate, rejects intentional repetition, and accepts a real alternate.
4. For an accepted finding the narrator chooses the target item (suggestions are ranked, never preselected on weak matches) and confirms Create take. REAPER adds it in one undo step; the old active take stays active.
5. In the take comparison view the narrator can constrain the comparison scope, sees per-take evidence and the reason behind each metric, sees the divergent sub-spans, auditions A/B, and chooses the active take in REAPER. Nothing changes if the narrator ignores the rankings.

## Technical Approach

**Feasibility**: MEDIUM. Detection and metrics are Go and Python with fixtures (HIGH). Take creation is MEDIUM-LOW: REAPER's behavior is unverified and cannot be tested in CI. Sub-span localization without forced alignment is MEDIUM and gated on evaluation.

**Architecture Notes**

- **Static project model first.** Extend `apps/desktop/internal/tracks` to read item GUIDs, the takes of each item, the active take, and each take's source, source offset and playrate (coordinate with `teleprompter-manuscript-integration.prd.md` phase 8, which adds `SOFFS`/`PLAYRATE`; whichever lands first, the other rebases). This works standalone and follows the rule that anything derivable from the saved project stays in Go (`daw-integration.md:8`). It can be stale relative to a live, unsaved project, so every mutation re-resolves GUIDs through Lua at execution time and refuses stale identities.
- **Detector.** New sidecar mode transcribes each distinct source range in scope, cached by source identity, range and model, writes timestamped words, aligns each read to manuscript tokens with the existing diff, and clusters reads whose aligned spans overlap. It emits additive tagged lines. Full versus partial coverage is computed from the fraction of the target span a candidate cleanly covers.
- **Findings.** Adapter in Go emits `pickup` and `duplicate_read` with `manuscript` chapter and expected text, `source` (file, and item and take GUIDs once known), `time_range`, `evidence` (matched span, ranges, match ratio, coverage, kind), a confidence with a stated reason, and `suggested_action` `create_take` with `requires_confirmation: true` and parameters naming target item GUID, source file and source range.
- **Take creation (Lua).** New bridge command re-resolves target and source GUIDs, refuses stale ones, adds the take, preserves the active take, writes provenance, and wraps everything in `Undo_BeginBlock2`/`Undo_EndBlock2` like the newer commands (`narration_ui_bridge.lua:392-397`). Exact API sequence is decided by the phase 1 spike.
- **Metrics.** `apps/desktop/internal/measure` gains a range-limited entry point for WAV sources; clipping and noise from samples, level consistency against neighboring items, pause profile and duration from words. MP3, FLAC and others report "unavailable" rather than a guess (ADR 0025 stance).
- **Per-take alignment.** Additive sidecar mode aligns each take's range to the same manuscript span and returns per-word fidelity, so the UI can shade sub-spans.
- **UI.** Candidate group detail, scan dialog, audition component (two `<audio>` sources, loop, pre/post roll, keyboard), take comparison view. New primitives get stories, atlas coverage and `design-spec-guard`. Confirmation dialogs use the delivered modal `Dialog` and alert `ConfirmDialog` ([ADR 0048](../adr/0048-every-dialog-is-one-modal-shell-and-confirms-are-alert-dialogs.md)), which teleprompter phase 1 also builds on.
- **Settings.** Thresholds as project settings (Q12) with built-in defaults kept in sync with `defaults.json`.

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| REAPER take-creation behavior differs from assumptions (active take, length mismatch, undo granularity) | High | Phase 1 spike before any Lua; user-run checklist; do not start REAPER spikes without the user's go-ahead |
| False groups from repeated prose, echoed dialogue, and recurring phrases | High | Fixture suite, conservative thresholds (Q12), the narrator rejects, rejection is remembered via the evidence version |
| ASR errors and homophones make a real repeat look different, or two different lines look alike | Medium | Reuse equivalences and homophones, report match quality, never auto-decide |
| ASR time explodes on whole-project scans | High | Scope selector (Q3), cache by source identity, real progress and cancel, measure in phase 3 |
| Static `.rpp` view is stale or its take serialization differs from assumptions | Medium | Multi-take REAPER-saved fixture; re-resolve GUIDs live before mutation |
| Comparing takes across different processing chains misleads | Medium | Label audition "raw source, no FX", measure raw source only, state it in evidence |
| Users over-trust rankings | Medium | Per-category evidence, no composite (Q9), unavailable evidence shown |
| WAV-only measurement excludes MP3 or FLAC sources | Low-Medium | Report unavailable, never fabricate (ADR 0025) |
| Sub-span localization is too coarse without forced alignment | Medium | Q10 evaluation gate; ADR 0008 conditions |
| Merge conflicts in the Lua dispatcher, `bindings.go`, `tracks/parse.go`, `measure` | High | See Parallel-session compatibility |

## Implementation Phases

Every phase follows the `CLAUDE.md` workflow: plan (find or open the tracking issue first and put `Closes #<n>` in the PR, `docs/operations/github-workflow.md`), `change-impact-scan` (mandatory for `integrations/reaper` and shared UI), TDD, `full-verification-gate` (`pnpm check`), `design-spec-guard` for primitives or `styles.css`, `feature-cleanup`. Phases that change `apps/ui` also run the Playwright visual suite and the atlas and view every PNG at `desktop`, `small-desktop`, `tablet` and `mobile`. Phases that change bindings bump the host API version in `apps/desktop/app.go:33`, `apps/desktop/app_test.go:39-42` and `apps/ui/src/hostApi.ts:2` (whichever PR lands second increments again; check `hostAPIVersion` at merge time). Phases that change `integrations/reaper` require a user-run manual REAPER checklist; green `pnpm check` proves formatting only. Re-check `docs/adr/` before numbering an ADR (take the next free number at merge time; 0027 at d5cc994). Milestone 1 is the foundation: phases 4 onward depend on the findings store and Review page.

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | REAPER take-mechanics spike | User-run spike and checklist for adding a take, active-take behavior, length mismatch, undo, take `P_EXT`; research note plus ADR draft for provenance; no product code | complete | 2, 3 | - | - |
| 2 | Take-aware project model | `tracks` reads item GUID, takes, active take, per-take source/offset/rate; multi-take fixtures; `/media` authorizes every take source | complete | 1, 3 | - (soft: teleprompter phase 8) | - |
| 3 | Timestamped words and repeated-span detector | Sidecar mode: cached transcription per range, persisted words, alignment to manuscript, span clustering, additive tagged output; fixtures and pytest | pending | 1, 2 | - | - |
| 4 | Pickup and duplicate findings | Go scan service and adapter producing `pickup`/`duplicate_read` findings with evidence and `create_take` suggestion; exact-copy detection from project model | pending | 8, 9 | 2, 3, RD-1 | - |
| 5 | Scan and review surface | Bindings, scan dialog, candidate group detail, navigate to target and candidate via milestone 1 plumbing, host API bump | pending | 8, 9 | 4, RD-4, RD-5, RD-6 | - |
| 6 | Take creation action | Lua `create_take` per spike, Go executor, target-item selection and confirm dialog, provenance, undo; manual checklist | pending | 7, 8, 9 | 1, 5, RD-8 (soft) | - |
| 7 | Side-by-side audition | In-app A/B component over `/media` with loop and pre/post roll, keyboard, "raw source" label, visual states | pending | 6, 8, 9 | 2, 5 | - |
| 8 | Take metrics engine | Range-limited WAV analysis in `measure`, clipping, noise, level consistency, duration, pause profile; unavailable-evidence rules | pending | 4, 5, 6, 7, 9 | 2, 3 | - |
| 9 | Per-take alignment and divergence | Sidecar mode aligning each take range to the same span; per-word fidelity; sub-span output | pending | 4, 5, 6, 7, 8 | 3 | - |
| 10 | Take comparison findings and view | `take_comparison` findings, same-span validation, per-category evidence, sub-span view, docs and roadmap close-out | pending | - | 5, 7, 8, 9, RD-5 | - |

### Phase Details

**Phase 1 - REAPER take-mechanics spike**
- **Goal**: Replace guesses about take creation with observed REAPER behavior.
- **Scope**: A written procedure and scratch Lua the user runs on a scratch project: add a take by source range, observe which take is active, item length effects, one-step undo, take `P_EXT` persistence across save and reload; deliverable is a research note and a draft ADR for provenance (extends ADR 0026, does not supersede it). Launches REAPER on the user's machine, so it runs only with their go-ahead.
- **Success signal**: Q4 and Q5 answered from observation; the phase 6 sequence is written down with expected events.

**Phase 2 - Take-aware project model**
- **Goal**: Static, standalone knowledge of items, takes and source ranges.
- **Scope**: Chunk parsing that can split take groups within an item; `Item` gains GUID, takes, active take index, per-take source file, offset and rate; REAPER-saved multi-take fixtures (the user supplies or saves one); `authorizedMediaPath` covers all take sources and stays project-scoped (ADR 0012); update `docs/utilities/tracks.md`.
- **Delivered**: The chunk parsing, `Item`/`Take` fields, and REAPER-saved multi-take fixture (`testdata/reaper/saved-cases.rpp`) all landed already in the analysis evidence ledger PRD's Phase 1 (`feat/analysis-evidence-ledger-p1-item-model-parser-superset`, PR #314), reused here by merging that branch into this stack per Q11(a) of that PRD ("EL Phase 1 lands the superset item model first ... TR Phase 2 ... rebase onto it") rather than duplicating the parser. This phase's own work on top of that merge: `Project.ItemByGUID(guid string) (Track, Item, bool)` (Q6 - the explicit, un-stamped target identity, matching only `Item.GUID`/`IGUID`, never a take's own `GUID`), and extending `authorizedMediaSource` in `apps/desktop/media.go` to authorize every take of every item, not only each item's active take (the evidence ledger PRD's own Q10 scoped its Phase 1 to the active take only and explicitly named this as the deferred extension: "TR Phase 2 asks for all takes; it can extend from B"). `docs/utilities/tracks.md` updated for both the parser superset and the media-route change.
- **Success signal**: Fixture tests for multi-take, trimmed section, playrate; media route refuses unrelated paths; `tracks` page unchanged. Met: `TestItemByGUIDFindsAMultiTakeItemAcrossTracksByItsOwnGUIDNotATakes` (real `saved-cases.rpp` fixture) and `TestMediaMiddlewareAuthorizesEveryTakeOfARealReaperSavedMultiTakeItem`/`TestMediaMiddlewareAuthorizesEveryTakesSourceNotJustTheActiveOne`; `internal/tracks` coverage 96.1% (floor 96); no UI or wire-contract change, so the Tracks page and its tests are unaffected.

**Phase 3 - Timestamped words and repeated-span detector**
- **Goal**: A tested analyzer core, no UI.
- **Scope**: New additive CLI mode in the Transcript Compare sidecar core (the stable entry point contract is unchanged); persisted timestamped words with cache keys; span clustering; classification into restart, pickup, exact copy, near duplicate; full versus partial coverage; fixtures for exact copy, pickup, restart, intentional repetition, echoed dialogue, similar phrases; measure ASR time per audio hour.
- **Success signal**: Pytest fixtures pass with zero false groups on intentional-repetition cases; recall and precision on the annotated set reported (Q1 target calibration).

**Phase 4 - Pickup and duplicate findings**
- **Goal**: Findings from real project data.
- **Scope**: Go service that builds the scan from the project model, runs the sidecar mode, adapts to findings via the milestone 1 store; no bindings; `suggested_action` with parameters and confirmation flag; evidence version so a rejected candidate does not reappear (uses `RD-1`).
- **Success signal**: Service tests with a fake sidecar; finding ids stable across re-scans.

**Phase 5 - Scan and review surface**
- **Goal**: Narrator can run a scan and review groups.
- **Scope**: Bindings (start, state, cancel), scan dialog with scope (Q3) and real progress, candidate group detail in the Review page, navigate to target and candidate using milestone 1's GUID navigation, host API bump, visual states, docs and screenshots (the scan and group-review states extend the Review guide page, `docs/guides/using-the-app/review.md`, added by `RD-5`; `apps/ui/src/docsGuide.test.ts` guards the index and footers).
- **Success signal**: End-to-end on a real chapter; visual suite and atlas green with four-viewport PNG review.

**Phase 6 - Take creation action**
- **Goal**: Confirmed, undoable take creation with provenance.
- **Scope**: Lua command per phase 1; Go executor (reuse `RD-8` executor path if merged, otherwise a minimal one); target picker with ranked suggestions and no auto-selection; confirm dialog stating source, range, target; stale GUIDs abort with a reviewable warning.
- **Success signal**: User-run checklist: creation, active take preserved, item length unchanged, undo restores exactly, stale target refused, notes and names untouched.

**Phase 7 - Side-by-side audition**
- **Goal**: A/B compare in context without touching the project.
- **Scope**: Audition component, pre/post roll from each read's own source, loop and keyboard, honest labeling, states for unavailable source.
- **Success signal**: Component stories and unit tests; visual suite at four viewports; plays real audio in the desktop app (the browser mock only plays silence, `docs/utilities/tracks.md`).

**Phase 8 - Take metrics engine**
- **Goal**: Reproducible per-take measurements with honest gaps.
- **Scope**: `measure` range entry point and tests with analytically known signals (ADR 0025's method), clipping run detection, level against neighbors, pause profile from words, coverage and unavailable rules.
- **Success signal**: Same inputs give identical output; MP3 or missing transcript yields "unavailable" evidence and lowers coverage without penalizing.

**Phase 9 - Per-take alignment and divergence**
- **Goal**: Show where inside a take it goes wrong.
- **Scope**: Additive sidecar mode; per-word fidelity for one range against a fixed manuscript span; output consumed by phase 10; evaluate against the annotated set for Q10.
- **Success signal**: Fixture takes with a flub partway localize to the correct sub-span; evaluation result recorded (adopt A, or evidence for an ADR superseding 0008).

**Phase 10 - Take comparison findings and view**
- **Goal**: Evidence-based comparison in the UI and in findings.
- **Scope**: `take_comparison` findings with per-take evidence and separate rankings; same-span validation; comparison view with sub-span strips and metric explanations; no composite; `roadmap.md` and `config/roadmap.json` updated together (the merge also re-syncs the GitHub milestone description); the recording-and-comping workflow doc, `docs/README.md` inventory and the Review guide page; feature cleanup.
- **Success signal**: Disagreement fixtures (textually right but noisy, clean but misread, technically and textually fine but the narrator prefers another read) display as separate categories and never collapse into one ranking; results reproduce from stored measurements; docs and roadmap consistent.

### Parallelism Notes

Phases 1, 2 and 3 have no dependencies and touch disjoint areas (research and Lua scratch, `tracks`, sidecar). Phases 4 and 5 are a chain; 8 and 9 can run beside them once their inputs exist. Phase 6 needs the spike and phase 5; phase 7 needs phase 2 and the Review surface. Phase 10 is last.

### Parallel-session compatibility

| Phase | Files and areas touched | Likely collisions |
| --- | --- | --- |
| 1 | `docs/research/` (new note), `docs/adr/` (draft), scratch Lua outside the repo | ADR numbering; any session using the user's REAPER at the same time |
| 2 | `apps/desktop/internal/tracks/{tracks.go,parse.go,chunk.go}` and testdata, `apps/desktop/media.go`, `docs/utilities/tracks.md` | Teleprompter phase 8 edits the same parse functions for `SOFFS`/`PLAYRATE`; any Tracks page work |
| 3 | `sidecars/transcript-compare/core/compare.py` (or a new module it imports), `sidecars/transcript-compare/tests/*` | Teleprompter phase 6 may touch `compare.py` for shared matching; keep new logic in a new module |
| 4 | New `apps/desktop/internal/*` scan service and adapter, findings store use | Any session changing the store API (`RD-1`), diagnostics findings work |
| 5 | `apps/desktop/bindings.go`, `apps/desktop/app.go` (host API), `apps/desktop/app_test.go`, `apps/ui/src/{hostApi.ts,api/*,components/review/*}`, visual catalog, docs images | `RD-4`, `RD-5`, `RD-7` and every binding phase; host API number collisions |
| 6 | `integrations/reaper/narration_ui_bridge.lua`, Go executor, review UI confirm dialog | Every Lua PR; dispatcher chain at `:522-553`; user's REAPER availability for the checklist |
| 7 | New audition component and its stories, visual catalog | Dialog modality work; nav or screenshot regeneration in the teleprompter final phase |
| 8 | `apps/desktop/internal/measure/*` | `diagnostics-delivery-and-cleanup-tools.prd.md` exposes and extends the same package; agree the range API once |
| 9 | Sidecar mode module, tests | Phase 3 module; keep separate files |
| 10 | Review UI, findings adapter, `docs/roadmap.md`, `config/roadmap.json`, docs | Any milestone-status edit; roadmap files change together and alone |

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Take creation needs narrator approval, explicit target item identity, and an undoable REAPER action (prior decision) | Enforced in the executor and dialog | Implicit target | `roadmap.md:66`; duplicate-finder doc |
| Never auto-comp, never auto-activate, never move or delete source media (prior decision) | Read-only analysis; narrator activates | Auto-comp | `roadmap.md:10`; recording workflow safeguards |
| No single numeric score defines a better performance (prior decision) | Per-category evidence | Composite | Retired `take-intelligence.md:36` |
| Findings are evidence-based, reviewable, local-first (prior decision) | Findings contract, no cloud | Cloud analysis | `findings-contract.md`, `roadmap.md:10,59` |
| Item notes and take names belong to the narrator; identity in namespaced extension data (prior decision, ADR 0026) | Provenance in take `P_EXT` (extends, per Q5) | Notes or names | ADR 0026 |
| Timing confidence over forced alignment for now (prior decision, ADR 0008) | Diff plus word timestamps | WhisperX, MFA | ADR 0008 gate |
| Measurement in Go; WAV only; unavailable measurements never fabricated (prior decision, ADR 0025) | Range entry point in `measure` | Python sidecar | ADR 0025 |
| Manuscript line identity: Lua only, REAPER verification and Go client later (prior decision, user) | Not required by this milestone (Q6) | Build the client here | Project memory; ADR 0026 |
| Windows-first, REAPER-first, US-English-first (prior decision) | No other platform work | Cross-platform now | `docs/README.md` (closing paragraph) |
| Do not start REAPER spikes without the user's go-ahead (prior decision, user) | Phase 1 is user-run | Autonomous spike | Project memory |
| Take creation (decided, Q4, phase 1 spike) | Add the candidate's source range as a new take on the target item (`AddTakeToMediaItem`); previous active take preserved, item length never changes, `D_STARTOFFS` aligns to the span start, one undo step | Fixed lane, duplicated item, navigate-only | Spike evidence: `docs/research/take-review-spike-p1-take-mechanics.md` |
| Take provenance (decided, Q5, phase 1 spike) | Namespaced take `P_EXT` plus finding id, extending ADR 0026 ([ADR 0098](../adr/0098-take-provenance-in-take-extension-data-extends-adr-0026.md)) | Sidecar only, take name or item notes | Spike evidence: round-trips undo/redo and save/reload, no collision with item-level line identity |
| Line identity stamps not required (decided, Q6, phase 2) | Spans come from alignment at analysis time; item GUID (`Project.ItemByGUID`) is the explicit target identity | Require stamps before scanning; build the stamp Go client here | Removes a dependency on the unverified, user-run REAPER checklist and on `reaper-automation-follow-through.prd.md` |
| Parser reuse (decided, phase 2) | Merged `feat/analysis-evidence-ledger-p1-item-model-parser-superset` (PR #314) into this stack rather than duplicating the take-aware `Item`/`Take` model | Build a minimal equivalent parser independently | EL PRD Q11(a): one superset avoids four PRDs' textual conflicts on `parseItem` and four slightly different `Item` shapes |
| Detection basis (proposed, Q1) | Transcript-to-manuscript alignment | Acoustic similarity | Reuses shipped ASR and diff |
| Detector location (proposed, Q2) | Additive sidecar mode plus Go adapter | Go analyzer, new sidecar | Shared tokenization lives in Python |
| Audition (proposed, Q7) | In-app raw-source A/B first | REAPER-side | No project mutation, standalone |
| Active take (proposed, Q8) | Narrator sets it in REAPER | App action | Narrower Lua surface |
| Composite score (proposed, Q9) | None | Weighted or fixed | Over-trust risk |

## Research Summary

**Market Context** (per the research doc, secondary sources, not re-verified): Pozotron is a commercial proofing service that exports pickup markers for several DAWs; PromptVO markets live misread detection and post-recording proofing; community REAPER script sets include a character take report and pickup import (no license declared: learn from them, do not copy); narrator blogs describe punch-and-roll, record-over-selected-item and "trim existing items" overlap behavior, and a manual proofer-to-pickup loop (`docs/research/reaper-automation-surface.md` sections 2, 7, 8). No surveyed tool was found that groups repeated reads by manuscript span and compares them with evidence, but that rests on absence in search results.

**Technical Context**: REAPER exposes fixed lanes and take-level extension data on paper (research section 3, unverified), but this repo has never called a take-creation API, so the spike gates the design. The product already ships local ASR with word timestamps, a manuscript diff with homophone and number handling, timing confidence (ADR 0008), a Go WAV analyzer (ADR 0025), an audio streaming route (ADR 0012), and a first-use asset gate (`docs/architecture/first-use-dependency-provisioning.md`); no new optional model is needed for the recommended path. Forced alignment (MFA, WhisperX) and acoustic similarity remain candidates under the local-dependency protocol, not commitments; the MFA trial in that document uses the same 25-location gold set this PRD proposes for calibration.

---

*Generated: 2026-09-19*
*Status: DRAFT - needs validation*
