# Proofing Readiness Signals

**Source:** New work (nothing to supersede). It draws on `docs/roadmap.md`, [Technical QC and Handoff](../workflows/technical-qc-and-handoff.md), [Recording, Pickups, and Comping](../workflows/recording-and-comping.md), [Transcript Compare](../utilities/transcript-compare.md), the [findings contract](../architecture/findings-contract.md), ADRs [0008](../adr/0008-timing-confidence-over-forced-alignment-model-for-transcript-compare.md), [0015](../adr/0015-real-progress-only.md) and [0025](../adr/0025-delivery-measurements-in-go-profiles-deferred.md), and draft ADR 0031 (PR #44). Citations are `file:line` on `main` at d5cc994 (working branch `claude/track-completion-recommendations-b69f51`) for anything checked in code; "per docs" marks a claim taken from a document and not verified. This is PRD 5 of 5 in the chapter stage recommendations set. Sibling PRDs (written in parallel; file names only): `chapter-stage-recommendations.prd.md` (prefix SR, the umbrella that owns the signal contract, recommendation engine, confirmation record and Home surfaces), `analysis-evidence-ledger.prd.md` (EL, fingerprints, ledger, confirmed chapter-to-track mapping), `recording-coverage-analysis.prd.md` (RC), `editing-readiness-analysis.prd.md` (ER). Existing sibling PRDs on PR #44: `review-dashboard-and-findings-adoption.prd.md` (RD), `take-review-pickups-duplicates-take-intelligence.prd.md` (TR), `character-continuity-review.prd.md` (CC), `teleprompter-manuscript-integration.prd.md` (TM), `diagnostics-delivery-and-cleanup-tools.prd.md` (no prefix stated in its header; this PRD uses DX), `reaper-automation-follow-through.prd.md` (RF). In Depends columns this PRD's own phases are bare numbers and other PRDs' phases are `<PREFIX>-n`. SR and EL settle in parallel with this PRD, so their dependencies are named by capability (for example `EL ledger`, `SR Confirm`) and become `SR-n` and `EL-n` at merge.

## Problem Statement

A narrator who thinks a chapter is proofed has nothing that tells them whether it is. Transcript Compare shows one table for one run and forgets it on the next run. Proofer pickups, repeated reads and technical measurements each live in a different place or do not exist yet. The chapter status is a manual dropdown. The result is chapters marked finalized while pickups are still open or audio was never measured, or chapters held back because nobody is sure. The narrator asked for a suggestion, not automation: "proofing is done when there are no pickups to clear up and that all delivery/performance checks are good", always confirmed by them. A suggestion is only worth having if it says "unknown" when it cannot tell, because a false "done" hides real work and a false "not done" costs one more look.

## Evidence

Verified in code:

- **No pickup producer or state exists.** `pickup` and `duplicate_read` are only enum values (`shell/internal/findings/findings.go:30-31`, listed at `:45`). Nothing emits them. The bridge commands are `prepare_compare`, `inspect_compare_results`, `export_compare_markers`, `jump_to_compare_marker`, `stamp_item_lines`, `read_line_ids`, `create_chapter_regions`, `close` (per the take-review PRD's check of `shared/reaper/narration_ui_bridge.lua:525-553`).
- **Transcript Compare rows are the nearest thing, and have no "resolved".** `Discrepancy` (`shared/ui/src/api/contracts/transcript.ts:3-19`) is built at `shell/internal/transcript/service.go:314-321`. `markerState` is `pending | existing | exported` and only records whether a take marker exists near that position in REAPER (`narration_ui_bridge.lua:178-187`, set at `:216` and `:279-281`); an exported row is still a discrepancy. A row disappears only when the narrator re-records and re-runs. Row ids are `<item_index>@<srcpos>` (`:214`), so they change with the item selection.
- **Only the last run is persisted, with no chapter identity for a clean run.** `<project>/.narration-last-comparison.json` is one slot, overwritten each run (`service.go:531-537`, read back `:133-143`, written on `COMPARE_INSPECTED` and `COMPARE_EXPORTED` at `:362-365`). The state has no chapter id, `documentId`, item GUIDs or source fingerprints (`empty()`, `:40-45`). The chapter appears only as a title on each `MARKER` row (`compare.py:1562`) and inside the free-text summary `MATCH: '<title>' (score ...) - N discrepancy marker(s)` (`compare.py:1534`, kept as `summary`, `service.go:324-328`). A clean run has zero rows, so its chapter survives only in that summary string.
- **"Clean" means one thing today.** The results page says "No discrepancies found." when `rows.length === 0` (`shared/ui/src/components/proofing/Results.tsx:90-93`). Home shows `lastCompleted.rows.length` as a raw discrepancy count, including exported rows and regardless of chapter (`shared/ui/src/components/home/Home.tsx:339-366`, count at `:356`).
- **A clean result can cover only part of a chapter.** The narrator's selection defines what is compared: selected items on one track, or all items of a selected track (`narration_ui_bridge.lua:110-124`), active take only (`:139`), one manifest line per item `index|source_file|startoffs|length*rate` (`:151`); muted items are not skipped. Head and tail deletes are deliberately dropped as "never part of this recording" (`compare.py:1058-1063`, `:1112-1113`), so an unrecorded tail produces no SKIPPED row. "No discrepancies" therefore never means "the whole chapter was compared".
- **Timing confidence is not a pass signal.** `confidence` and `timing_gap_seconds` are written per marker (`compare.py:1017-1039`, `:1562`) but dropped by the bridge and invisible to Go and the UI. ADR 0008 and `docs/utilities/transcript-compare.md:22` call it "not proof either way".
- **Review states have no `resolved` or `stale`.** They are `unreviewed | accepted | dismissed | deferred` (`findings.go:59-66`); `WithReview` keeps the id (`:172-178`). The contract does not say what `accepted` means. No findings store exists; `docs/architecture/findings-contract.md:3` says existing analyzers do not emit findings yet.
- **Delivery checks exist only as a library nothing calls.** `measure.Profile` limits four metrics with inclusive `Limit{Min,Max}` bounds (`shell/internal/measure/profile.go:13-18`, `:23-29`); no profile ships. `Evaluate` returns findings only for limited metrics: an `out_of_range` error, or an `unavailable` info finding when the value is nil, NaN or infinite (`:42-64`, `:90-95`). A compliant report and a report that never ran both produce an empty slice. Findings carry `Source.File` only (`:106`), no chapter or track. `Report` has values but no clipping count or windowed series (`shell/internal/measure/measure.go:32-49`), and only mono and stereo WAV is read (`shell/internal/measure/wav.go:173`), so an MP3 render cannot be measured.
- **No chapter-to-audio association exists.** `tracks.Item` has no GUID, `SOFFS`, `PLAYRATE` or take list (`shell/internal/tracks/tracks.go:18-26`); `parseItem` reads `POSITION`, `LENGTH`, `NAME` and the first `<SOURCE>` (`shell/internal/tracks/parse.go:68-96`). Nothing records which rendered file belongs to which chapter. Chapter ids are positional `c-%04d` and reset with a new `documentId` on re-import; `resetDerived` deletes derived data (`shell/internal/manuscript/service.go:403`, `:434-441`).
- **Chapter status is a bare string per chapter id**, changed by a `<select>` in the Home breakdown table (`shared/ui/src/components/home/AudiobookEstimatePanel.tsx:188-211`) through `ManuscriptSetChapterStatus` (`shell/bindings.go:348`); the enum is `not_started | recording | editing | proofing | finalized` (`shared/ui/src/api/contracts/manuscript.ts:1`, `shell/internal/manuscript/reader.go:303`).
- **Proofing docs and states cover only the compare flow.** `docs/guides/using-the-app/proofing.md` documents setup and results; the visual catalog has Proofing states `setup-default`, `setup-alt-selection`, `running`, `results-row-expanded`, the EXTRA row and `toast` (`shared/ui/tests/visual/state-catalog.ts:66-81`).
- **Host API version** is `5` in three places: `shell/app.go:33`, `shell/app_test.go:39-42`, `shared/ui/src/hostApi.ts:2`.

Per docs (not verified in code): the proofer-flags, narrator-re-records, editor-integrates pickup loop is a manual marker workflow, and "Pickup list" is research opportunity 4 (`docs/research/reaper-automation-surface.md:254`, `:266`); the saved `.rpp` lags an open project (general REAPER behavior; no repo doc states it, TBD - confirm with a REAPER-saved fixture pair; D6 of the set). The RF and TR PRDs, not this one, define the pickup marker convention and the pickup and duplicate findings.

Assumptions - need validation: (1) that narrators mean Transcript Compare discrepancies, proofer pickups and repeated reads together when they say "pickups to clear up". Method: ask the user and watch a proofing pass on 3-5 permissioned chapters. (2) That narrators render one WAV per chapter before proofing ends. No baseline exists in the repo; method: ask the user how they hand off. (3) Whether narrators save the REAPER project after a comparison. Method: same dogfood pass.

## Proposed Solution

Compute a proofing-readiness suggestion for each chapter whose status is `proofing`, on read, from evidence that already exists or is planned, and offer it on the Proofing page for the narrator to confirm through the SR flow. Two families of signals, each tri-state (D2) with evidence and a basis:

1. **`proofing.pickups`, always required.** A roll-up of open items across the sources that exist over time: Transcript Compare discrepancies (via RD's adapter), `pickup` and `duplicate_read` findings (TR), and proofer `PICKUP:` project markers (RF convention, read from the saved `.rpp`). A source that never ran is absent and the evidence says so; a source that ran but is stale, partial or unmapped makes the signal `unknown`. Resolution only ever comes from a complete re-run at a new fingerprint, or the narrator's dismissal.
2. **`proofing.delivery.<check>`, one per required check.** The narrator's own limits (ADR 0025, DX-2) applied to a measurement of the chapter's rendered WAV, plus analyzer-backed checks (clipping, level shift, room tone) as DX produces them. Each check is met, not met, or unknown. "Unavailable" is never good.

A chapter is suggested for "proofing done" only when every required signal is `met`. This PRD also adds what the roll-up needs and nothing else supplies: a per-chapter identity and currency record for Transcript Compare runs (derived from the run manifest, no Lua or Python change), a static reader for `PICKUP:` markers, and a persisted chapter-to-render association with the render's fingerprint. The evidence is shown, never a grade, and the narrator confirms. Nothing here changes status, audio or manuscript (draft ADR 0031, PR #44).

## Key Hypothesis

We believe a per-chapter suggestion built from every open pickup source and the narrator's own delivery limits, and that answers "unknown" instead of "done" whenever evidence is missing, stale or partial, will let narrators tell which chapters are actually proofed without re-checking each tool, for narrators who proof their own chapters in REAPER. We'll know we're right when (a) on the scenario suite the suggestion is never `recommended` while a required source has an open item, is stale, partial or unavailable (target 0 false "done"), (b) every `unknown` names its reason and the action that resolves it, and (c) on 3-5 permissioned chapters narrators confirm suggestions without overriding them at a rate the pass reports (baseline TBD - needs research; the run also records how often "unknown" was the cause of no suggestion, to judge whether the rules are too strict).

## What We're NOT Building

| Item | Why |
| --- | --- |
| Automatic status change, automatic re-run of comparisons or measurements, background evaluation | Recorded rule: suggestions only, the narrator confirms (D1); draft ADR 0031 (PR #44). Evaluation reads evidence; analysis is started by the narrator |
| A quality grade, "ACX approved", or any pass/fail claim about a distributor | ADR 0025; product boundary (`docs/roadmap.md:10`). Checks are the narrator's own limits |
| Judging acting, interpretation or "performance quality" | Product boundary. "Performance checks" here means measurable audio and pacing findings only |
| A distributor profile or built-in numeric limits | ADR 0025 needs a cited specification first; limits come from the narrator (D10) |
| Detecting pickups, duplicates or discrepancies | Owned by `take-review-pickups-duplicates-take-intelligence.prd.md` and Transcript Compare; this PRD only rolls their findings up |
| The findings store, review UI, or decisions | Owned by `review-dashboard-and-findings-adoption.prd.md`; the roll-up reads them and links to the Review page |
| Pickup marker Lua (`import_pickups`, `count_pickups`, `resolve_pickup`) and the marker convention | Owned by `reaper-automation-follow-through.prd.md` Phase 8 (its Q6); no Lua here (recorded decision) |
| The measurement job, Delivery page, limits settings, windowed analyzers | Owned by `diagnostics-delivery-and-cleanup-tools.prd.md` Phases 1, 2, 4, 5 |
| Recommendation engine, confirmation record, Home badge, evidence popover component | Owned by `chapter-stage-recommendations.prd.md` |
| Fingerprint, ledger, staleness API, confirmed track mapping | Owned by `analysis-evidence-ledger.prd.md`; this PRD consumes them |
| De-duplicating one problem reported by two sources (a Compare row and a `PICKUP:` marker at the same spot) | No reliable shared identity; evidence lists counts per source, and both clear when the audio is fixed |
| Multi-track or multi-render chapters | v1 is one track and one render per chapter (D5) |
| Live REAPER change counter to label unsaved edits | Lua; a Could at most (RF Phase 13 defines `project_state`); not in the MVP |
| Replacing Home's Proofing card row count (`Home.tsx:356`) | Owned by SR's Home work; noted as a discrepancy only |
| macOS, Linux, non-US-English | Windows-first, US-English-first |

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| False "done": suggestion `recommended` while a required source has an open item, is stale, partial, failed, unmapped or unavailable | 0 | Go table tests over source (Compare, TR, markers) x state (absent, current-zero, current-open, stale, partial, failed) x review state, plus delivery cases (Phase 1, 5) |
| Partial or failed run resolving findings | 0 findings counted as resolved by an incomplete run | Fixture: findings merged after a partial run stay open (Phase 1, 2) |
| Staleness detection on edits | 100% of scripted edits (trim, split, delete item, re-record, replace render) turn the affected signal to `unknown` or `not_met` | REAPER-saved before and after `.rpp` pairs (TBD - needs fixtures from the user) |
| Unavailable is never good | 100% of nil or non-finite metrics, missing renders, unsupported formats and unmapped chapters give `unknown` | Table tests over the cases at `profile.go:55-58`, `:90-95` |
| Open-pickup count agrees with the sources | Equals a hand count on the fixture, per source | Fixture project with known open, dismissed, deferred and resolved items |
| Every `unknown` explained | 100% carry a reason and an action | UI and contract tests over each cause |
| Evaluation cost per chapter | TBD - baseline needs measurement in Phase 6; must not start any analysis | Benchmark on a 30-chapter fixture recorded in the PR |
| Narrator agreement with suggestions | Reported, not gated (TBD - baseline needed) | Dogfood on 3-5 permissioned chapters, reusing the D12 corpus chapters as RC and ER produce them |
| Gate | `pnpm check` green each phase; visual suite reviewed at four viewports for UI phases | CI and PNG review |

## Open Questions

- [ ] **Q1. What is an "outstanding pickup"?** Options: (A) any open item (Q2) of category `transcript_discrepancy`, `pickup` or `duplicate_read` for the chapter, plus remaining proofer `PICKUP:` markers attributed to the chapter; (B) only proofer-declared pickups (markers and TR `pickup`), treating Compare discrepancies as advisory; (C) A limited to severity warning or above. Recommendation: A, because the narrator said "no pickups to clear up", every item in A is something a tool or proofer flagged for a look, and dismissal is the sanctioned way to say "not a real problem". C hides items by a severity mapping that RD Phase 2 has not decided. `take_comparison` findings (TR-10) are evidence for choosing a take, not a defect, and are excluded.
- [ ] **Q2. Do `accepted` and `deferred` count as open?** Options: (A) D9: open = `unreviewed`, `deferred`, `accepted`; `dismissed` is not open; an item resolves only when a re-run at a new fingerprint no longer produces it; (B) `accepted` counts as resolved because the narrator decided; (C) `deferred` does not block. Recommendation: A. `accepted` means "real, needs fixing", and `deferred` would otherwise let a narrator clear a chapter by postponing. Whichever phase lands first records the meaning of `accepted` in `docs/architecture/findings-contract.md`.
- [ ] **Q3. Which pickup sources are required?** Options: (A) none is individually required, but at least one source must be current with zero open items; a source that never ran is absent; a source that ran and is now stale, partial or unmapped makes the signal `unknown`; (B) Transcript Compare is required; (C) every source that exists for the project is required. Recommendation: A. A narrator who proofs by a human proofer's marker list never runs Compare, and one who never runs the TR scan should not be blocked by it. The stale rule stops an old result from vouching for a changed chapter. A per-project override can require a named source.
- [ ] **Q4. When is a Transcript Compare run "current" for a chapter?** Options: (A) the run's played-range fingerprint (from its manifest) equals the current fingerprint of the mapped track's items, every played item was in the compared set, and the saved project file is newer than the run; (B) fingerprint match only, with the basis labelled; (C) also require a live change counter (Lua, RF Phase 13). Recommendation: A. The static reader sees only the saved project, and the compare ran on the live one. Requiring a save after the run turns "matches what I last saved" into evidence about the compared audio. It costs one save in REAPER and errs toward "unknown". C stays a Could.
- [ ] **Q5. What is the minimal change that gives a comparison a chapter identity?** Options: (A) when RD-2 ingests a finished run, also write an EL ledger record built from the run's `manifest_<run>.txt` (source file, `startoffs`, played length per item, which Go can read, RD Q4), the chapter resolved from the run's chapter title through the manuscript service, `documentId`, model and project file mtime; (B) grow `.narration-last-comparison.json` into per-chapter files; (C) wait for RD-6 to append GUIDs to `COMPARE_MARKER`. Recommendation: A. It needs no Lua or Python change, gives a clean run a record (D7), and keeps chapter 2's result after chapter 3 is compared. B forks the store RD-1 owns; C needs Lua and still lacks the clean-run case. Duplicate chapter titles are TBD (RD notes the same gap) and resolve to `unknown` with a flag.
- [ ] **Q6. How are `PICKUP:` markers read?** Options: (A) statically from the saved `.rpp`, attributed to a chapter by the time span of its mapped track's items, using the RF convention for done markers; (B) through RF's `count_pickups` when the bridge is available; (C) both, with the static read as the standalone fallback. Recommendation: A for the MVP, since no new Lua is allowed and the app must work standalone; B becomes a Could once RF Phase 8 has been verified in REAPER. The project-marker serialization in a saved `.rpp` is unverified here (TBD - needs a REAPER-saved fixture with `PICKUP:` markers), and RF's Q6 (who owns the convention) must be answered first.
- [ ] **Q7. Which delivery checks are required by default?** Options: (A) none beyond pickups until the narrator picks checks; (B) every profile metric the narrator has set a limit for (a "selected profile"), plus pickups; analyzer-backed checks (clipping, level shift, room tone, pacing, continuity, pronunciation review) are opt-in; (C) everything available. Recommendation: B. It follows the narrator's own definition of good without inventing a threshold, needs no extra step for narrators who set limits, and a check that is not required is still listed in the evidence as "not required" so a pass from pickups alone is visible as such. SR owns the storage and UI for required signals; this PRD supplies the catalogue and validation (a metric cannot be required without a limit).
- [ ] **Q8. What happens for a chapter with no rendered file?** Options: (A) required delivery checks are `unknown` with the action "Choose the rendered file"; (B) delivery checks are treated as absent; (C) measure the chapter's items instead. Recommendation: A. A required check with no evidence must not pass. C needs the range API, played-range stitching and a decoder (DX Q3 option b) and is a Could.
- [ ] **Q9. How is a render tied to the current edit?** Options: (A) the narrator associates a render and attests it was made from the current project; the association stores the fingerprint of the chapter's items at that moment and the render file's fingerprint, and any later change to either makes the delivery signals `unknown`; (B) infer from file modification times only; (C) an optional length cross-check between the render and the chapter's recorded length (DX Phase 8). Recommendation: A, with C shown as evidence and gating only when the narrator sets a tolerance. A stores the narrator's own statement as the basis instead of guessing from timestamps. No default tolerance is proposed: TBD - needs measurement of render-versus-project length on real renders (tails, padding).
- [ ] **Q10. What is measured first, the rendered chapter WAV or the items?** Options: (A) the associated rendered WAV; (B) audio synthesized from the chapter's items; (C) render preferred, items as fallback. Recommendation: A, matching DX Q3; B and C wait for played-range and range-API support (EL, DX Phase 1) and would not include take FX. MP3 renders are `unknown` (unsupported) until DX Q2 decides on a decoder.
- [ ] **Q11. Should timing `confidence` filter discrepancies out of the open count?** Options: (A) no; (B) yes, hide `low`; (C) a setting. Recommendation: A. ADR 0008 calls it "not proof either way". RD-5's "hide low-confidence" control is a view filter and must not change the roll-up; the narrator dismisses items deliberately.
- [ ] **Q12. Should proofing-complete also require the chapter's `recording` signal to be `met`?** Options: (A) no, per D3 only the current stage is evaluated; show the RC coverage status as an information line when RC has a current result; (B) yes; (C) only for the stale-after-confirm check. Recommendation: A. The earlier stage was confirmed by the narrator, and gating on it here would double-count. The information line covers the partial-selection blind spot in the Evidence section.
- [ ] **Q13. Where does readiness live, the Proofing page or Home?** Options: (A) Proofing page only; (B) Home only; (C) detail on the Proofing page, SR's badge and Confirm on Home, both fed by the same signals. Recommendation: C. The narrator does proofing work on the Proofing page and manages status on Home. SR owns the badge, evidence popover and Confirm component; this PRD supplies the proofing-specific content and hosts it on the Proofing page. The exact split of the Proofing page summary between SR and this PRD is a cross-PRD point to settle at planning.
- [ ] **Q14. Is "Mark proofing done" available when the suggestion is not `recommended`?** Options: (A) only when recommended; overriding stays with the existing status `<select>`; (B) always, recording which signals were unmet; (C) A plus a "mark done anyway" link. Recommendation: A. The affordance confirms a suggestion, which keeps the confirmation record's basis meaningful; the narrator can always still set the status by hand. The button says what it does: with no `proofed` state (SR's question), it sets Finalized, and says so.
- [ ] **Q15. How are `PICKUP:` markers outside every chapter's item span handled?** Options: (A) shown as a project-level note on the Proofing page, not blocking any chapter; (B) make every chapter's pickup signal `unknown`; (C) attribute to the nearest chapter. Recommendation: A. B lets one stray marker block the whole book, C guesses. A marker inside a mapped chapter's span counts against that chapter.

## Users & Context

**Primary User**

- **Who**: A solo author-narrator recording and proofing their own chapters in REAPER on Windows, sometimes with a proofer's pickup list, who renders chapter files themselves.
- **Current behavior**: Runs Transcript Compare per chapter, works through markers, re-records, renders, checks levels in another tool, and remembers which chapters are done or changes the status by hand.
- **Trigger**: A chapter has had its proofing pass and its pickups have been re-recorded or dismissed, and the narrator wants to know whether it can be called done.
- **Success state**: The Proofing page shows, per chapter, what is open and what was checked and how recently; a chapter with everything met says so; the narrator confirms in one click and knows why.

**Job to Be Done**: When I finish fixing a chapter's pickups, I want to be told whether anything is still open or unchecked, so that I can mark the chapter done without re-checking every tool and without a tool deciding for me.

**Non-Users**: Reviewers who want certification; narrators who do not use REAPER; anyone expecting acting or performance quality to be assessed.

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Notes |
| --- | --- | --- |
| Must | `proofing.pickups` tri-state signal with source-by-source availability and D9 open semantics | Phase 1 |
| Must | Comparison identity and currency: chapter id, `documentId`, played-range fingerprint from the manifest, item coverage, saved-after-run rule | Phase 2 (Q4, Q5) |
| Must | Resolution only by a complete re-run at a new fingerprint or narrator dismissal; incomplete runs never resolve | Phases 1-2 |
| Must | Chapter-to-render association with render and item fingerprints and narrator attestation | Phase 4 (Q9) |
| Must | Per-check delivery signals from stored measurements and the narrator's limits; unavailable never good | Phase 5 |
| Must | Every signal carries evidence, a reason and a basis; unknown names its action | Phases 1, 5, 6 |
| Must | Proofing page readiness detail with Check now, Choose rendered file, Measure, Open in Review | Phase 6 |
| Must | "Mark proofing done" through SR's Confirm, enabled only when recommended | Phase 7 (Q14) |
| Should | Proofer `PICKUP:` markers as a source, read statically from the saved `.rpp` | Phase 3 (Q6) |
| Should | Analyzer-backed checks (clipping, level shift, room tone) when DX-4 findings exist | Phase 5 |
| Should | Show dismissed counts and dismissals made against older evidence | Phases 1, 6 |
| Should | Signals evaluable for an already-confirmed chapter so SR can show "evidence changed since you confirmed" | Phase 7 |
| Could | Items-based measurement scope; character continuity and pronunciation-review checks; pacing check | After DX and CC phases |
| Could | Live change counter for unsaved edits (Lua, manual checklist) | RF Phase 13 |
| Won't | Auto-confirm, background evaluation, grade, distributor profile, cross-source de-duplication, multi-render chapters | See table above |

### MVP Scope

Phases 1, 2, 4, 5 (metric checks), 6 and 7: the pickup roll-up over Transcript Compare and TR findings, the render association, profile-metric checks, the Proofing page detail and the confirm affordance. Phase 3 (markers) and the analyzer-backed checks in Phase 5 are Should and ship when their inputs exist.

### When a signal is `unknown` (D2)

| Cause | Pickups | Delivery | Action shown |
| --- | --- | --- | --- |
| Never analyzed | No source has a current result | No measurement of the associated render | "Run Transcript Compare", "Measure the render" |
| Stale | A source's fingerprint differs from the chapter's current items, or the project was not saved after the run | Render or items changed since association or measurement | "Re-run", "Save the project in REAPER, then Check now", "Re-associate the render" |
| Unavailable measurement | - | Nil metric (silence, too short) or unsupported format such as MP3 | Named reason, no number |
| Unmapped track | No confirmed chapter-to-track mapping (EL) | Same | "Confirm the track for this chapter" |
| Incomplete run | Compared set omits played items; run partial or failed | Job cancelled or failed | "Compare every item on the chapter track" |
| No rendered file | - | No association (Q8) | "Choose the rendered file" |

### User Flow

1. The narrator finishes a proofing pass: runs Transcript Compare on the chapter, works the findings in Review, re-records, re-compares, saves the REAPER project, renders the chapter.
2. On the Proofing page the readiness section lists chapters with status Proofing. Each row shows the pickup roll-up (open count per source, dismissed count, or "not checked") and each required delivery check (met, not met, not checked).
3. For a chapter with unknown signals, the evidence names the reason and offers the action: run Compare, save, choose the rendered file, measure. The narrator starts each job; nothing runs by itself.
4. Open pickups link to the Review page filtered to the chapter; the narrator decides each, re-records, re-runs.
5. When every required signal is met the row shows a suggestion with its basis ("saved project, file modified <time>; comparison of <time>; render measured <time>"). The narrator opens the evidence, then presses "Mark proofing done", which goes through SR's Confirm and sets the chapter Finalized.
6. If evidence changes later (a new pickup, an edited item), SR shows "evidence changed since you confirmed" with a one-click revert. Nothing downgrades on its own.

## Technical Approach

**Feasibility**: HIGH for the pure signal logic (Go, table-tested). MEDIUM for comparison identity and currency (depends on EL fingerprints and RD-2, needs REAPER-saved `.rpp` fixtures, TBD). LOW-MEDIUM for the marker source (serialization unverified, convention unowned). MEDIUM for the UI (state catalog, four viewports, docs). No Lua and no Python change.

**Cross-cutting decisions as they apply here**

| Decision | Applies as |
| --- | --- |
| D1 Computed, never applied | All signals computed on read; nothing about readiness is stored. The narrator's confirmation is SR's record |
| D2 Tri-state | Central; `unknown` for never analyzed, stale, unavailable, unmapped, incomplete (table above) |
| D3 Stage mapping | Evaluated only while status is `proofing`; suggests advancing to `finalized`; no new enum value |
| D4 Confirmation record | SR owns; this PRD's signals must also be evaluable for a confirmed chapter |
| D5 Mapping is an input | Uses EL's confirmed `trackGuid -> chapterId`; an unconfirmed fuzzy match is `unknown`; Compare's own title match (`compare.py:900-955`) is not trusted as a mapping |
| D6 Fingerprint and played range | Compare currency uses played ranges from the manifest against EL's fingerprint; every basis reads "saved project, file modified <time>" |
| D7 Ledger | A clean run is a `complete` record with zero findings; met needs a complete record at the current fingerprint AND zero open items |
| D8 Per-item cache | Not used; measurement is per render file, keyed by render fingerprint |
| D9 Open semantics | Q2; recorded in the findings contract by whichever phase lands first |
| D10 Settings | Required checks (SR storage, catalogue here) and the optional length tolerance (DX-2 numeric kind); no shipped profile |
| D11 recordedFraction | Not this PRD (RC) |
| D12 Corpus | No audio thresholds here; scenario fixtures are synthetic Go tests plus REAPER-saved `.rpp` pairs; narrator agreement is measured on the RC and ER corpus chapters |

**Architecture Notes**

- **Providers, not I/O in the logic.** A new Go package (proposed `shell/internal/proofing`, name at planning) holds signal providers as pure functions over small read-only interfaces: findings by chapter and category (RD-1 store), ledger records and staleness (EL), project items and markers (EL parser and Phase 3), render association (Phase 4), measurement values (ledger record), settings, and a clock. Providers register with SR's engine through the SR signal contract.
- **Signals per stage.** SR takes several signals for one stage: `proofing.pickups` (always required) and `proofing.delivery.<check>` for each required check. A stage is recommended only when all required signals are `met` (D2). If SR prefers one composite signal per stage, the per-check results move into its evidence list with no change to the rules.
- **Pickup roll-up rule.** For each source: `not_met` if any item is open; `unknown` if the source exists but is stale, partial, failed, unmapped or its scope does not cover the chapter's played items; absent if it never ran and is not required. Overall: `not_met` if any source has an open item; else `unknown` if no source is current or a required or stale source is unresolved; else `met`. Open items are counted from the store: `unreviewed`, `deferred`, `accepted` (Q2); findings flagged "not in latest run" by RD-1 count as resolved only when that run's ledger record is `complete` and covers the finding's item and range, otherwise they stay open. This needs one agreement with RD-1: its merge must not flag findings absent after a partial or failed run.
- **Comparison currency (Phase 2).** The manifest gives, per compared item, source file, `startoffs` and played length (`narration_ui_bridge.lua:151`), active take only, with no GUID or timeline position. The record stores that multiset plus source size and mtime, the chapter id, `documentId`, model, the project file mtime at completion, and outcome. Currency compares the multiset with EL's current fingerprint of the mapped track's items: every item the fingerprint counts as played must appear in the compared set (extra compared items, such as muted ones, do not invalidate; they only over-report, and the narrator dismisses). The project file must be newer than the run. Duplicate identical tuples (copied items) are matched as a multiset.
- **Markers (Phase 3).** `tracks` gains a project-marker read. A marker's chapter is the mapped track whose items' time span contains it. Remaining = `PICKUP:` markers without the RF done convention. Basis is the saved project's mtime; there is no ledger record because nothing was analyzed. The parse extension collides with EL, TM Phase 8 and TR Phase 2 in `parse.go`; it lands after them or rebases.
- **Render association (Phase 4).** A proposed sidecar `<project>/narration-utils/proofing/renders.json` keyed by `documentId` and chapter id: file path, file fingerprint (size, mtime, hash per EL's policy), chapter items fingerprint at attestation, attested-at. It is written atomically like `saveNotes` and added to `resetDerived` (`manuscript/service.go:434-441`), because chapter ids reset on re-import. It stores no measurement; the DX-1 result is stored as an EL ledger record with the `Report` values, keyed by the render fingerprint. The narrator's limits are applied on read, so changing a limit does not force a re-measure.
- **Delivery checks (Phase 5).** Computed from the stored `Report` and the current `Profile`, not from findings alone, because an empty `Evaluate` result cannot tell "met" from "not evaluated". Per metric: value present and within its limit is `met`; out of range is `not_met` with value and limit; nil, NaN, infinite, unsupported format or no measurement is `unknown`; no limit set means the check is not required. A required check with no available analyzer (pacing before DX produces it) cannot be selected.
- **Evaluation is a read.** Check now and Home load read the store, ledger, project file and file stats. They never start Compare, a scan or a measurement. A missing analysis shows its action. Hashing large files follows EL's hash policy; if evaluation is not instant it shows real activity only (ADR 0015).
- **Host surface.** Readiness reads flow through SR's evaluation binding. This PRD adds bindings only for the render association (choose, clear, state) and reuses DX-1's measurement job for the measurement. Host API version bumps in `shell/app.go`, `shell/app_test.go`, `shared/ui/src/hostApi.ts` (currently 5; take the next number at merge), Wails bindings regenerated, services snapshot pointers under `h.mu.RLock` (owned by `host-binding-data-race.prd.md`).
- **UI.** Readiness detail on the Proofing page as a `Panel` with the existing `table.dtable` style; state shown as text plus icon, never colour alone; SR's evidence popover and Confirm are reused. New primitives, if any, need stories and atlas coverage. New states get `state-catalog.ts` rows and drivers in `app.drivers.ts`, doc screenshots and `docs/guides/using-the-app/proofing.md` updates (`visual-catalog-sync`, `doc-screenshot-sync`; `shared/ui/src/docsGuide.test.ts` guards the guide).
- **ADR.** After code lands, use `adr-author` for the proofing-complete definition (open-item semantics, source availability rule, render attestation). Take the next free number at merge time (0027 at d5cc994; PR #44 uses 0027-0035).

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| A false "done" from stale, partial or missing evidence | Medium | Tri-state everywhere, currency rules, scenario matrix tests with target 0 |
| The saved `.rpp` lags the live project, so a matching fingerprint hides unsaved edits | High | Project-saved-after-run rule (Q4), basis label with file time, optional live counter as a Could |
| A partial or failed run makes findings vanish and look resolved | Medium | Resolution only from a complete run covering the finding (needs RD-1 agreement); test in Phases 1-2 |
| A clean comparison of part of a chapter reads as clean (`Results.tsx:90-93`, `compare.py:1058-1063`) | High | Compared-set coverage rule; RC status shown as information (Q12) |
| Clean run has no chapter id, duplicate chapter titles | Medium | Manifest-plus-title record (Q5); duplicates resolve to `unknown` with a flag |
| Wrong or outdated render measured | Medium | Attestation with items fingerprint, render fingerprint, optional length tolerance (Q9) |
| MP3 deliverable cannot be measured | High | `unknown` (unsupported), never a pass; DX Q2 owns the decoder |
| Vacuous delivery pass when no checks are required | Medium | Evidence lists every non-required check; default B ties requirement to the narrator's limits (Q7) |
| Dismissal used to hide real problems | Medium | Dismissed counts and older-evidence dismissals shown in evidence; RD-1 returns changed evidence to `unreviewed` |
| Muted or extra compared items over-report | Low | Counted as open, the narrator dismisses; not a false "done" |
| Marker serialization unverified; RF marker convention unowned | High | Phase 3 conditional on a REAPER-saved fixture and RF Q6 |
| Recommendation over-trusted as a grade | Medium | Always evidence, never a score; suggestion only (draft ADR 0031, PR #44) |
| Merge collisions: `tracks/parse.go`, `transcript/service.go`, `resetDerived`, `bindings.go`, host API version, Proofing page | High | See Parallel-session compatibility |

## Implementation Phases

Every phase follows the `CLAUDE.md` workflow: plan (find or open the tracking issue first and put `Closes #<n>` in the PR, `docs/operations/github-workflow.md`), `change-impact-scan` (this PRD touches `shell/internal/tracks`, `shell/internal/transcript` and shared UI), TDD (80% coverage on new Go), `full-verification-gate` (`pnpm check`, not `check:fast`), `design-spec-guard` when `primitives/` or `styles.css` change, `feature-cleanup`. UI phases run the Playwright visual suite for the Proofing page and view every PNG at `desktop`, `small-desktop`, `tablet` and `mobile`, plus the atlas when a primitive changes. Phases that change bindings bump the host API version in the three places and regenerate `shared/ui/wailsjs/go/main/Host.{js,d.ts}`. There is no Lua in this PRD, so no manual REAPER checklist; the user supplies REAPER-saved `.rpp` fixtures (TBD) for Phases 2 and 3. Precondition for a meaningful dogfood pass: the D12 corpus chapters from RC and ER; this PRD builds none.

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Pickup roll-up signal | Pure Go provider for `proofing.pickups`: source adapters over the findings store, D9 open rule, availability rule, tri-state, evidence and basis; matrix tests | pending | 2, 3, 4 | RD-1, EL-3, SR-1 | - |
| 2 | Comparison identity and currency | Ledger record on Compare ingest from the run manifest; chapter id and `documentId`; item coverage and saved-after-run rule; complete-run resolution | pending | 1, 3, 4 | RD-2, EL-3, EL-1, EL-5 | - |
| 3 | Proofer marker source | Static `PICKUP:` project-marker read from the saved `.rpp`, chapter attribution, remaining count per RF convention (conditional) | pending | 1, 2, 4 | 1, EL-1, EL-5, RF-8 (convention only) | - |
| 4 | Render association and measurement record | Sidecar for chapter-to-render association with fingerprints and attestation; measurement stored as a ledger record; `resetDerived` | pending | 1, 2, 3 | DX-1, EL-3, EL-5 | - |
| 5 | Delivery-check signals | Per-check signals from stored `Report` and the narrator's `Profile`; analyzer-backed checks as findings appear; required-check validation | pending | 3 | 4, DX-2, SR-1 (DX-4 for analyzer checks) | - |
| 6 | Proofing page readiness detail | Bindings, contract, mock, readiness section, render association UI, Check now, Measure, Open in Review; states, docs, screenshots | pending | - | 1, 2, 5, SR-5, RD-5 | - |
| 7 | Mark proofing done and close-out | Confirm affordance through SR, evaluable-when-confirmed signals, docs, ADR, cleanup | pending | - | 6, SR-2 | - |

### Phase Details

**Phase 1 - Pickup roll-up signal**
- **Goal**: A tested, deterministic answer to "are there pickups to clear up" with evidence.
- **Scope**: New Go package; read-only interfaces for findings, ledger and markers; adapters for categories `transcript_discrepancy`, `pickup`, `duplicate_read`; open rule per Q2; per-source availability, stale and partial handling; overall tri-state; evidence entries per source (open count, dismissed count, dismissed-against-older-evidence count, finding ids with time range and paragraph where present) and basis (ledger record ids, fingerprint, project file mtime); registration with SR's engine; record the meaning of `accepted` in `docs/architecture/findings-contract.md` if RD-1 has not. No bindings, no UI.
- **Success signal**: The matrix in Success Metrics passes; an empty roll-up is `unknown`, never `met`; a partial run does not resolve findings; a stale source blocks even when not required; coverage 80% or better.

**Phase 2 - Comparison identity and currency**
- **Goal**: Every finished Transcript Compare run has a chapter, a fingerprint and an outcome, including a clean run.
- **Scope**: Where RD-2 ingests on `COMPARE_INSPECTED` (`service.go:322-330`), write the EL record from `manifest_<run>.txt`, the resolved chapter id and `documentId`, model, and project file mtime; outcome `complete` on inspect, `failed` on error, no record on cancel; the coverage and saved-after-run evaluator (Q4); the merge rule that only a complete record covering a finding's item resolves it (agree with RD-1). Do not change `compare.py`, the marker protocol or the Lua bridge. Depends on EL's extended parser for `SOFFS`, `PLAYRATE` and the active take. `docs/utilities/transcript-compare.md` gains the identity and currency rules.
- **Success signal**: Comparing chapter 3 after chapter 2 leaves chapter 2's record; a clean run yields a `complete` record with zero findings; a `.rpp` pair with a trimmed item makes the run stale; a partial selection yields the coverage gap; identical duplicate tuples handled; a run whose chapter title is duplicated resolves to `unknown` with a flag.

**Phase 3 - Proofer marker source (conditional)**
- **Goal**: Count proofer pickups still open, standalone.
- **Scope**: Project-marker parse in `tracks` with fixtures; chapter attribution by mapped-track item span (Q15); the RF prefix and done convention (answer RF Q6 first); remaining count and evidence; registered as a source in Phase 1; unattributed markers reported as a project-level note. Proceeds only with a REAPER-saved fixture containing `PICKUP:` markers (TBD - needs the user).
- **Success signal**: A fixture with open, done and out-of-span markers yields the expected per-chapter counts; an unreadable project gives `unknown`; the basis states the saved file time.

**Phase 4 - Render association and measurement record**
- **Goal**: Say which file the delivery checks are about and whether it is still the current one.
- **Scope**: The association store (Q9), atomic write, `resetDerived` entry, corrupt-file error surfaced; measurement result kept as a ledger record with the `Report` values from DX-1's job, keyed by render fingerprint; staleness on render or chapter-items change; unsupported formats recorded as unsupported (WAV only, DX Q2). No UI.
- **Success signal**: Replacing the file, or editing the chapter's items after attestation, makes the record stale; re-import clears the store; a non-WAV file is unsupported, not zero.

**Phase 5 - Delivery-check signals**
- **Goal**: Per-check tri-state signals with the narrator's limits.
- **Scope**: Metric checks from `Report` and `Profile` (DX-2, including its sample-peak limit); analyzer-backed checks registered with availability (clipping, level shift, room tone when DX-4 emits `audio_quality` findings; pacing, character continuity from CC and pronunciation review from RD-3 registered as unavailable until produced); required-check validation; optional length cross-check that gates only when a tolerance is set (Q9); evidence text for "no delivery checks required".
- **Success signal**: Tests for the cases at `profile.go:55-58` and `:90-95`; no limit means not required; no render, stale render or non-WAV gives `unknown`; out of range gives `not_met` with value and limit.

**Phase 6 - Proofing page readiness detail**
- **Goal**: The narrator can see what is open and unchecked per chapter and act on it.
- **Scope**: Bindings for the render association, contract, mock fixtures that drive every tri-state deterministically, host API bump; readiness `Panel` on the Proofing page (chapters with status Proofing, per-signal state text and icon, SR's evidence popover); actions Check now, Choose rendered file, Measure (DX-1 job with real progress), Open in Review (RD-5 chapter filter), and a pointer to run Compare; `state-catalog.ts` rows and `app.drivers.ts` drivers (proposed: default, all met, unknown with reasons, none in Proofing, evidence open, measuring); `doc-screenshots.json`; `docs/guides/using-the-app/proofing.md`; four-viewport PNG review.
- **Success signal**: Every state reviewed as PNGs at four viewports with no sideways overflow; `pnpm check` and the visual suite green; evaluation performs no analysis; benchmark recorded.

**Phase 7 - Mark proofing done and close-out**
- **Goal**: Complete the loop: suggest, review evidence, confirm.
- **Scope**: "Mark proofing done" routed through SR's Confirm, enabled only when recommended (Q14), with the consequence stated; signals callable for a confirmed chapter so SR can show "evidence changed since you confirmed"; docs (`proofing.md`, `docs/utilities/transcript-compare.md`, `docs/workflows/technical-qc-and-handoff.md`, `docs/architecture/findings-contract.md` if needed, `docs/README.md` only if a doc is added); ADR via `adr-author`; `feature-cleanup`.
- **Success signal**: Confirm writes SR's record with this PRD's basis; a new pickup or an edited item after confirm shows the changed-evidence note with revert; nothing changes status without the click; docs consistent.

### Parallelism Notes

Phases 1, 2, 3 and 4 touch disjoint code (the new package, the transcript service, `tracks`, a new sidecar) and can run concurrently once EL and RD-1 exist. Phase 5 needs 4. Phase 6 needs the pickup half (1, 2) and the delivery half (5); a first cut can ship the pickup half. Phase 7 is last. Given SR's delivery order, all of this starts after EL, RC and the SR MVP.

### Parallel-session compatibility

| Phase | Files and areas touched | Who else collides |
| --- | --- | --- |
| 1 | New `shell/internal/proofing/*`; `docs/architecture/findings-contract.md` | SR engine package and signal contract, RD-1 store API, EL ledger API; the `accepted` wording in the contract |
| 2 | `shell/internal/transcript/service.go` and tests, the RD-2 adapter file, `docs/utilities/transcript-compare.md` | RD-2 (same ingest point), RF Phase 2 (event fan-out migrates the transcript service), TR ingest; EL parser |
| 3 | `shell/internal/tracks/{parse.go,tracks.go,testdata/*}` | TM Phase 8, EL parser phase, TR Phase 2, RF Phase 14 (all edit the parser and fixtures); land after them or rebase |
| 4 | New files in the proofing package; `shell/internal/manuscript/service.go` (`resetDerived`, line 434) | RD-1, EL, SR each add to the same slice literal (textual conflicts); DX-1 `measure` changes |
| 5 | Proofing package; reads DX-2 `Profile` | DX-2 (`Profile` gains a sample-peak limit; numeric settings kind), DX-4 findings shape |
| 6 | `shell/bindings.go`, `shell/app.go` (host API), `shell/app_test.go`, `shared/ui/src/{hostApi.ts,api/*,components/proofing/*}`, `Host.{js,d.ts}`, `tests/visual/*`, `docs/images/ui/*`, `docs/guides/using-the-app/proofing.md` | Every binding PR (host API number); SR's Home and Proofing summary work; DX-5 Delivery page (file picker); RD-5 Review page; nav-changing PRs regenerate screenshots |
| 7 | SR Confirm wiring, docs, ADR | SR (confirm and evidence popover), ADR numbering (next free at merge; 0027 at d5cc994), any `docs/README.md` edit |

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Suggestions only; the narrator confirms (prior decision, user) | Nothing changes status, audio or manuscript by itself | Auto-advance | D1; draft ADR 0031 (PR #44); ADR 0019 precedent (offer, then confirm) |
| No new Lua for this set; app works standalone where possible (prior decision, user) | Compute from the saved `.rpp`, manifests and files | Live REAPER counter | Lua-only-for-now; live counter is a Could |
| Product boundary (prior decision) | No automatic comping, no acting-quality judgment, no cloud | - | `docs/roadmap.md:10` |
| Real progress only (prior decision, ADR 0015) | Unknown and not-checked are shown as such, never as zero or pass | Placeholder states | ADR 0015 |
| Timing confidence is not proof (prior decision, ADR 0008) | Does not filter the open count | Hide low confidence | `docs/utilities/transcript-compare.md:22` |
| No distributor profile; limits belong to the narrator (prior decision, ADR 0025) | Checks use the narrator's `Profile` | Ship ACX numbers | ADR 0025 |
| Review states and open semantics (prior decision D9, proposed rule Q2) | Open = unreviewed, deferred, accepted | Accepted as resolved | Contract has no `resolved` |
| Computed on read, tri-state, unknown never met (D1, D2) | As stated | Stored verdict | A false "done" is worse than a false "not done" |
| Pickup sources and availability (proposed, Q1, Q3) | Roll-up over Compare, TR, markers; absent unless it ran; stale makes unknown | Require all sources | Narrators use different tools |
| Comparison identity from the manifest (proposed, Q5) | EL ledger record at ingest, no Lua or Python change | Per-chapter results files; wait for GUIDs | Reuses RD-2 and EL, covers clean runs |
| Comparison currency (proposed, Q4) | Fingerprint, item coverage, saved after run | Fingerprint only | Saved project lags the live one |
| Proofer markers read statically (proposed, Q6) | Saved `.rpp`, conditional phase | `count_pickups` over the bridge | No new Lua; standalone |
| Delivery checks required (proposed, Q7) | Profile metrics with limits plus pickups; others opt-in | None, or all | Follows the narrator's definition |
| Render tied to the edit by attestation (proposed, Q9) | Narrator attests; fingerprints stored | Timestamp inference | Explicit basis |
| Measurement scope (proposed, Q10; DX Q3 option a) | Associated rendered WAV first | Items | Standalone, no take FX guesswork |
| One signal per check (proposed) | `proofing.pickups` and `proofing.delivery.<check>` | One composite | Clean basis per signal, clear evidence |
| Confirm only when recommended (proposed, Q14) | Override stays on the status select | Always enabled | Meaningful confirmation basis |
| Workflow (prior decision, CLAUDE.md) | plan, impact scan, TDD, `pnpm check`, spec guard, cleanup | Fast check only | History of silent regressions |

## Research Summary

**Market Context** (per the research doc, secondary sources, not re-verified): the pickup loop is a manual marker workflow between proofer, narrator and editor, and Pozotron and PromptVO are the commercial proofing references (`docs/research/reaper-automation-surface.md:254`, sections 7 and 9). The research proposes a pickup list (opportunity 4) and an ACX-style check but does not describe a chapter-level "ready" signal. Published ACX guidance disagrees on room tone, the stated reason no profile ships (ADR 0025). Nothing in it establishes what narrators regard as proofing-complete; that is Assumption 1.

**Technical Context**: Reused and verified: the findings record and review states (`findings.go:59-66`, `:112-127`), the Transcript Compare service, manifest and persisted snapshot (`transcript/service.go`, `narration_ui_bridge.lua:92-172`), `measure` with `Profile` and `Evaluate` (`profile.go`), the layered settings, the `tracks` parser, the job and binding patterns, the visual suite and atlas. Planned by siblings and consumed here: the findings store and Compare adapter (RD-1, RD-2), pickup and duplicate findings (TR-4), `PICKUP:` markers and their convention (RF-8, RF Q6), measurement job, numeric limits and windowed analyzers (DX-1, DX-2, DX-4), chapter-track matcher (TM-8), and from this set the ledger, fingerprint and mapping (EL) and the recommendation engine (SR). Unverified: how a saved `.rpp` serializes project markers and multi-take items (TBD - needs REAPER-saved fixtures); render-versus-project length differences on real renders (TBD - needs measurement); Compare cost per chapter on real hardware (unmeasured).

**Docs versus code found while verifying**: Home's Proofing card shows every row of the last comparison, exported ones included, as a "discrepancy" while `markerState` never means resolved (`Home.tsx:356`, `narration_ui_bridge.lua:279-281`); a clean comparison of a partial selection reads "No discrepancies found." (`Results.tsx:90-93`, `compare.py:1058-1063`); a clean run's chapter is recoverable only from a free-text summary (`compare.py:1534`); the compare manifest does not skip muted items (`narration_ui_bridge.lua:139-151`); the findings contract does not define `accepted`. Each is addressed by the phase named above or recorded in the siblings.

---

*Generated: 2026-09-19*
*Status: DRAFT - needs validation*
