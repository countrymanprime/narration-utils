# Chapter Stage Recommendations

**Source:** New work; nothing to supersede. It turns one request from the narrator into a product definition and a delivery plan: suggest that a chapter is done recording when 100% of the chapter's text is there in order (mistakes allowed), done editing when its audio no longer contains common editing tasks (empty space to trim, clicks, breaths), and done proofing when no pickups remain and every required delivery and performance check is good, always as a recommendation the narrator confirms. It draws on `docs/roadmap.md` (product boundary at `:10`), [ADR 0015](../adr/0015-real-progress-only.md), [ADR 0019](../adr/0019-detected-manuscript-is-offered-not-imported.md), [ADR 0025](../adr/0025-delivery-measurements-in-go-profiles-deferred.md), draft ADR 0031 (PR #44), [the findings contract](../architecture/findings-contract.md), [manuscript line identity](../architecture/manuscript-line-identity.md), [Tracks](../utilities/tracks.md), [Transcript Compare](../utilities/transcript-compare.md), [the REAPER automation research](../research/reaper-automation-surface.md) and the sibling PRDs. This PRD is the umbrella of a set of five (written in parallel; file names only): `analysis-evidence-ledger.prd.md` (prefix EL, the foundation), `recording-coverage-analysis.prd.md` (RC), `editing-readiness-analysis.prd.md` (ER), `proofing-readiness-signals.prd.md` (PS), and this one (SR). Existing siblings it depends on or collides with: `review-dashboard-and-findings-adoption.prd.md` (RD), `take-review-pickups-duplicates-take-intelligence.prd.md` (TR), `diagnostics-delivery-and-cleanup-tools.prd.md` (DX; the PRD states no prefix), `teleprompter-manuscript-integration.prd.md` (TM), `reaper-automation-follow-through.prd.md` (RF). Citations are `file:line` on `main` at d5cc994 (this branch; re-read on 2026-09-19) for anything checked in code; "per docs" marks a claim taken from a document and not verified; "TBD - needs <what>" marks a number nobody has measured. In Depends columns this PRD's own phases are bare numbers; phases of RD, DX, TM are `RD-n`, `DX-n`, `TM-n`. The phase numbers of EL, RC, ER and PS are not fixed yet, so their Depends cells name the phase by what it delivers (for example `RC (recording signal)`) and are converted to `<PREFIX>-n` when those PRDs are final. `docs/prds/` and its README arrive with PR #44, which is not merged, so this file has no README to follow yet; it follows the format of the sibling PRDs on that branch.

**Status (2026-09-23):** issue [#409](https://github.com/countrymanprime/narration-utils/issues/409).

- **Delivered:** phase 1 (#411, the signal contract and the pure engine; ADR 0160, Proposed); phase 2 (the decision store and the confirmation service; ADR 0161, Proposed); phase 3 (the recording signal provider checked end to end against the recording-coverage corpus, with per-paragraph evidence and the shared evidence view; no new ADR).
- **Left:** phases 4 to 9.
- **Needs the owner:** review ADRs 0160 and 0161 and the D22 defaults (this PRD's open questions were unanswered).
- **Agents without the owner:** SR-4 to SR-6. SR-4 wires `coverage.NewSignalProvider` and `coverage.Service.EvidenceView` into `stages.Config`. SR-7 waits on editing readiness (ER-6), SR-8 on proofing readiness (PS-1, PS-5).

## Problem Statement

A narrator keeps every chapter's stage by hand: one `<select>` per chapter inside a per-chapter table that is collapsed by default. That status drives what Home shows (the "N of M chapters finalized" line, the progress meter, and the "Actual recorded" hours, which are guessed from the status rather than measured). The narrator, not the app, has to gather the evidence that a stage is over: is every paragraph of the chapter actually in the recording, is the audio free of dead air, clicks and breaths, are the pickups cleared and the delivery checks good. The app holds or can compute much of that evidence, but nothing connects it to the status, so the status drifts from reality, Home's progress misleads, and the bookkeeping is one more chore in a workflow the research puts at hours of work per finished hour (per docs). The costly failure is a false "done": a chapter marked complete while a paragraph is unrecorded or a breath track is still noisy hides real work until delivery. The recommendation must therefore be conservative, must show its evidence, and must never change anything by itself.

## Evidence

Verified in code (`main` at d5cc994):

- **Status is a bare string with five values, set by hand.** `ChapterStatus` is `not_started | recording | editing | proofing | finalized` (`apps/ui/src/api/contracts/manuscript.ts:1`), validated in Go by `validChapterStatus` (`apps/desktop/internal/manuscript/reader.go:303-305`) and stored per chapter id (`reader.go:100-104`). The only writer is the per-chapter `<select>` in the Home breakdown table (`apps/ui/src/components/home/AudiobookEstimatePanel.tsx:188-211`, calling `manuscriptSetChapterStatus`; binding chain `apps/desktop/bindings.go:348` to `apps/ui/src/api/wailsClient.ts:133` to `apps/ui/src/api/mockApi.ts:623`). The table starts collapsed (`AudiobookEstimatePanel.tsx:50`, `:141`) and lists narration chapters only (`:63`).
- **The status sidecar cannot carry more.** `chapterStatus` is a map of chapter id to string inside `<project>/narration-utils/manuscript-notes.json` (`reader.go:247`, `:265`). `normalizeNotes` keeps only `notes`, `chapterStatus` and `readerState` (`reader.go:286-302`), so any new top-level key is silently dropped on the next save; and `chapterPayload` reads a status with a `.(string)` assertion (`reader.go:339`), so an object-valued entry would be ignored and the chapter shown as `not_started`. `chapterPayload` also passes any stored string through without validating it (`reader.go:337-342`), so an unknown status value would reach the UI, where `STATUS_COLOR[chapter.status]` is indexed unguarded (`apps/ui/src/components/manuscript/ChapterNav.tsx:56`; inference: it renders with no colour).
- **Chapter ids do not survive a re-import.** Chapter ids are positional, `c-%04d` (`apps/desktop/internal/manuscript/service.go:403`), and every import writes a new `documentId` (`service.go:431`). `resetDerived` deletes `ManuscriptGuide`, `TranscriptCompare`, `manuscript-notes.json` and `.narration-last-comparison.json` (`service.go:434-441`). Anything keyed by chapter id must also be keyed by `documentId` and cleared there.
- **Status drives visible progress.** "N of M chapters finalized" (`AudiobookEstimatePanel.tsx:77`, `:118`), the segmented meter (`:121-132`, ordered per [ADR 0006](../adr/0006-chapter-progress-bar-ordering.md)), and the coloured dot in the chapter list (`ChapterNav.tsx:56`; `STATUS_ORDER`, `STATUS_LABELS`, `STATUS_COLOR` at `:6-14`).
- **Recorded hours are a guess (D11).** `RECORDED_FRACTION = {not_started: 0, recording: 0.5, editing: 1, proofing: 1, finalized: 1}` (`AudiobookEstimatePanel.tsx:19`) feeds "Actual recorded" (`:69`, `:183-184`), against the intent of ADR 0015. `ManuscriptChapter.recordedFraction?` exists (`manuscript.ts:9`) and the UI prefers it, but the Go host never emits it (`chapterPayload`, `reader.go:337-356`); only mocks set it (`apps/ui/src/api/mockFixtures.ts:222`, `apps/ui/src/api/aliceManuscript.ts:78`).
- **None of the three rules has a producer.** Transcript Compare drops the head and tail `delete` opcodes on purpose (`sidecars/transcript-compare/core/compare.py:1058-1075`) and computes `covered_range` without writing it (`:1148-1154`), so chapter coverage is neither measured nor emitted. No detector exists for dead air, clicks or breaths: the only audio analysis is the whole-file `apps/desktop/internal/measure` package, which nothing calls (ADR 0025). `pickup` is only a category name (`apps/desktop/internal/findings/findings.go:30`). Per docs, RC, ER and PS plus RD, DX and RF phases are what produce these; this PRD builds none of them.
- **"Clean" cannot be told from "never ran".** `measure.Evaluate` returns an empty slice for a compliant report (`apps/desktop/internal/measure/profile.go:42-64`); Transcript Compare persists one slot, overwritten each run, with no chapter id (`apps/desktop/internal/transcript/service.go:531-537`), and shows "No discrepancies found" for the last run only (`apps/ui/src/components/proofing/Results.tsx:90-93`). A signal that reads emptiness as success would report "done" for a chapter nobody analyzed (D7).
- **There is no stored chapter-to-track mapping (D5).** Transcript Compare fuzzy-matches a track name to a chapter title on every run: exact, token prefix or containment, then `SequenceMatcher` ratio of at least 0.75, else `NEED_CHAPTER` (`compare.py:900-955`). The static project reader keeps only `POSITION`, `LENGTH`, `NAME` and the first source (`apps/desktop/internal/tracks/parse.go:68-96`, `tracks.go:18-26`). The Go matcher is planned in TM-8 and consumed by DX-8.
- **Finding review states have no "resolved" (D9).** `unreviewed | accepted | dismissed | deferred` (`findings.go:59-66`).
- **Offer, then confirm, is an existing pattern.** A manuscript found in the project folder is offered and never imported automatically ([ADR 0019](../adr/0019-detected-manuscript-is-offered-not-imported.md)). Draft ADR 0031 (PR #44) states that analyzers report findings and never change audio or the manuscript on their own.
- **UI building blocks.** Tooltips are non-interactive (`apps/ui/src/components/primitives/Tooltip.tsx:17-18`, `pointer-events-none`, `role="tooltip"`), so evidence the narrator must read and follow links from needs another surface; `SlideOver` (`primitives/SlideOver.tsx:9-22`) and `ConfirmDialog` exist. The Proofing card on Home shows a raw discrepancy count (`apps/ui/src/components/home/Home.tsx:339-366`). The Transcript state carries no chapter id, only per-row chapter titles (`apps/ui/src/api/contracts/transcript.ts:3-19`, `:27-43`).
- **Settings and host plumbing.** Settings are layered and string-valued, with `choice` and `color` kinds validated in `saveSettings` (`apps/desktop/app.go:673-679`, `:718-722`); built-in defaults must mirror `config/defaults.json` (`apps/desktop/internal/settings/store.go:38-42`). The host API version is 5 (`apps/desktop/app.go:33`, `apps/desktop/app_test.go:39-42`, `apps/ui/src/hostApi.ts:2`). Services are rebuilt on a project switch (`apps/desktop/app.go:146`), so a new binding follows the service-pointer discipline in `docs/architecture/host-binding-concurrency.md`.

Per docs (not verified in code): the research ranks per-chapter session progress as an unbuilt opportunity (`docs/research/reaper-automation-surface.md:271`), which RF Phase 22 plans from the `.rpp`; the saved `.rpp` lags an open REAPER project (general REAPER behavior; no repo doc states it, TBD - confirm with a REAPER-saved fixture pair), so any evidence read from it is "as of last save".

Assumption - needs validation (D12): that each rule can be met by signals accurate enough that "recommended" is trustworthy. No labeled data exists in the repo. The signal PRDs (RC, ER, PS) carry the annotated corpora; this PRD validates the end-to-end verdict against the narrator's own stage judgement on a small set of permissioned chapters.

## Proposed Solution

Compute, on read, a recommendation for each narration chapter from the evidence that exists now, show it beside the chapter's status with the evidence behind it, and change nothing until the narrator clicks Confirm. A recommendation is never stored as truth (D1). It is built from signals: each signal reports `met`, `not_met` or `unknown` with a reason, evidence and a basis (D2). A stage is recommended only when every required signal is `met`; `unknown` is never treated as `met`, because a false "done" is worse than a false "not done". Only the chapter's current stage is evaluated (D3): a chapter in `recording` can be recommended for `editing`, one in `editing` for `proofing`, one in `proofing` for `finalized`. The narrator confirms, which sets the status through the existing path and stores a confirmation record (stage, time, and the basis it was confirmed on) beside the status, never inside it (D4). If later evidence contradicts a confirmation, Home shows a non-blocking "evidence changed since you confirmed" with a one-click revert; the app never downgrades a chapter itself. A dismissal is remembered against its basis and the suggestion returns only when the basis changes.

The three rules become the product definition of "done" for each stage:

| Stage advance | The narrator's rule | Definition adopted here | Signals (owner) |
| --- | --- | --- | --- |
| recording to editing | 100% of the chapter's text is there, in order, mistakes allowed | Every paragraph of the chapter's narration text is present, in manuscript order, in the chapter's recorded audio. Misreads count as present; extra reads and false starts do not count against it. "100%" is a policy over a measured per-paragraph coverage, not literal word equality; the measurement, the tolerances and the settings are RC's | Text present in order (RC) |
| editing to proofing | The file no longer contains common editing tasks: empty space to trim, clicks, breaths | For the audio of the chapter's track, over every played range, zero open candidates in each required class (trim, click, breath) from a complete analysis at the current fingerprint (D6, D7, D9). Analysis is of source audio; take FX are not applied | Empty space, clicks, breaths, one signal per class (ER) |
| proofing to finalized | No pickups to clear up, and all delivery and performance checks are good | Zero open pickups from every pickup source the narrator has marked required, and every required delivery or performance check `met`; a check that is unavailable is `unknown`, never good | Open pickups, one signal per selected delivery or performance check (PS) |

What this PRD builds is the layer above the signals: the signal contract, a pure recommendation engine, the confirmation and dismissal store, the bindings, the Home surface with an evidence view, the settings that choose which signals are required, and the secondary surfaces. It adds no analysis, no Lua, and no new analyzer. It ships in value order: the recording signal end to end first (contract, engine, store, bindings, Home), then the editing and proofing signals plug into the same interface without reworking it.

## Key Hypothesis

We believe that showing, for each chapter, an evidence-backed suggestion of the next stage that the narrator confirms in one click will keep chapter status accurate with less bookkeeping, make Home's progress reflect measured work, and do so without ever marking a chapter done that is not. We'll know we're right when (a) on the annotated set, no chapter that the narrator judges not done receives a `recommended` verdict (proposed target 0 false recommendations, assumption, calibrate on the corpus), (b) a meaningful share of chapters the narrator judges done receive one (proposed target TBD, needs the first corpus run; calibrate), (c) every unmeasured, stale, unmapped or partial case yields `unknown` and never `met` (table-tested), (d) Confirm changes only the chapter status and the decision file (filesystem-diff test), and (e) narrators report that suggestions matched their own judgement often enough to keep them on (baseline TBD - needs dogfood).

## What We're NOT Building

| Item | Why |
| --- | --- |
| Automatic status changes, auto-advance, or auto-downgrade on contradicting evidence | D1 and D4; roadmap boundary (`docs/roadmap.md:10`); draft ADR 0031 (PR #44). The narrator confirms; a contradiction produces a notice and a revert, nothing else |
| Storing a recommendation as truth, or a background evaluation service | D1. It is computed on read from current evidence; a stored copy would go stale and be trusted |
| Any analysis inside this PRD (transcription, audio decoding, detection, delivery measurement) | RC, ER, PS, EL and DX own the signals. An evaluation is a read over existing results and never starts an analysis (Q12) |
| A new `ChapterStatus` value in v1 (`proofed`) | Q3. The enum is touched in six places and an unknown stored value reaches the UI unguarded (Evidence) |
| A single readiness score or percent-complete headline | Would over-trust one number; per-signal evidence is shown. Measured coverage appears only as evidence |
| Suggesting `recording` for a `not_started` chapter | Q4. Not one of the three rules, and "has audio" is a weak signal |
| Certifying delivery compliance or acting quality | Product boundary (`docs/roadmap.md:10`); ADR 0025 (no distributor profile ships) |
| New Lua, or a requirement that REAPER is running | Recorded decision: Lua-only-for-now and verified by hand later; evidence is computed from the saved `.rpp` and the audio files, so the feature works standalone |
| A live REAPER change counter to detect unsaved edits | At most a Could owned by EL; every recommendation labels its basis "saved project, file modified <time>" instead |
| Multi-track chapters in v1 | D5. A chapter with more than one linked track yields `unknown` until a rule is agreed (Q9) |
| A fuzzy chapter-to-track guess counted as evidence | D5. An unconfirmed match is `unknown`; the confirmed mapping and its UI are EL's |
| A distributor profile or default delivery thresholds | ADR 0025 and D10: thresholds are the narrator's, defaults conservative |
| OS notifications, cloud sync, team dashboards | Local-first; out of the product boundary |
| Removing the manual status `<select>` | It stays as the narrator's override; suggestions never replace it |

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| False recommendations (advance suggested, narrator judges the stage not done) | Proposed 0 on the annotated set (assumption, calibrate on the corpus) | Chapters from the RC, ER and PS corpora, each labeled by the narrator with the stage they consider it in, run through the real providers; every disagreement reviewed |
| Missed recommendations (narrator judges done, no `recommended`) | TBD - needs the first corpus run; then Proposed (assumption, calibrate) | Same set |
| `unknown` never treated as `met` | 100% of cases | Exhaustive table test over every met/not_met/unknown combination for one to four required signals per stage, plus a required-set-empty case |
| Determinism | Same evidence gives the same verdict, evidence list and basis key | Go tests; basis key excludes `computedAt` and project file mtime so a re-save with identical fingerprints keeps dismissals |
| Confirm safety | Only the chapter status and the decision file change; refused when the displayed basis is no longer current | Filesystem-diff test; test that a changed basis returns a refusal; crash-between-writes test (Phase 2) |
| Contradiction handling | Fresh contradicting evidence raises the notice; nothing changes status without a click | Fixtures: new pickup after finalize, deleted paragraph after editing began, stale-only evidence raises no notice (Q10) |
| Evaluation is read-only and cheap | No audio decode, transcription or network call during evaluation; wall time on a real project TBD - measure in Phase 4 (items and files vary) | Test with fake providers that fail if invoked for analysis; timed run on a real project |
| Time to bring chapter statuses up to date | TBD - baseline needed | Timed dogfood against the manual workflow |
| Suggestion accept rate (Confirm over Confirm plus Dismiss) | Reported, no target | Informational, from dogfood |
| Home honesty (D11) | No chapter with a measurement shows a status-guessed "Actual recorded" | UI test once RC fills `recordedFraction`; owned by RC, verified on Home here |
| Gate | `pnpm check` green each phase; visual suite reviewed at four viewports for UI phases | CI and PNG review |

## Open Questions

- [x] **Q1. Where are confirmations and dismissals stored?** Options: (A) a new sidecar file `<project>/narration-utils/stage-decisions.json` keyed by manuscript `documentId` plus chapter id, added to `resetDerived` (`service.go:434-441`); (B) extend `manuscript-notes.json` with an object-valued status or a new key; (C) the findings store from RD-1, as a finding. Recommendation: A, because B breaks on the code as written (`normalizeNotes` drops unknown keys, `reader.go:286-302`; an object-valued `chapterStatus` fails the `.(string)` read at `:339`, and an older build would drop the record on its next save), and C models analyzer output with review states, not narrator state about a chapter. **D22 default (Phase 2):** the owner has not answered, so the recommendation is adopted per rule D22 (`docs/prds/implementation-plan.md`): A, `stage-decisions.json` keyed by `documentId`, cleared by `resetDerived` (ADR 0161).
- [x] **Q2. Does Confirm set the status directly?** Options: (A) yes: Confirm is one action that writes the record and sets the status through `SetChapterStatus`; (B) Confirm only records, and the narrator then changes the `<select>`; (C) derive the status from the records. Recommendation: A, because two steps for one intent invite drift, and it keeps `chapterStatus` the single source of truth for every existing reader (meter, dot, estimate). The `<select>` stays as a manual override and writes no record. **D22 default (Phase 2):** the owner has not answered, so the recommendation is adopted per rule D22 (`docs/prds/implementation-plan.md`): A, Confirm writes the record, then the status through `SetChapterStatus`, and removes the record if the status write fails (ADR 0161).
- [x] **Q3. Add a `proofed` state, or does proofing-complete mean `finalized`?** Options: (A) no new value in v1; proofing-complete recommends `finalized`; (B) add `proofed` between `proofing` and `finalized`; (C) rename nothing, add a per-chapter flag. Recommendation: A, then reopen after dogfood. `finalized` may conflate "proofing done" with "mastered and delivered", but the app has no mastering stage, and B touches `validChapterStatus` (`reader.go:303`), `ChapterStatus` (`manuscript.ts:1`), `STATUS_ORDER/LABELS/COLOR` (`ChapterNav.tsx:6-14`), `RECORDED_FRACTION` (`AudiobookEstimatePanel.tsx:19`), the meter order (ADR 0006), mocks and tests, and an older build shows an unknown value unguarded. B would need an ADR. **D22 default (Phase 1):** the owner has not answered, so the recommendation is adopted per rule D22 (`docs/prds/implementation-plan.md`): no `proofed` value; `stages.Stage` is the stored status and `proofing` advances to `finalized`.
- [x] **Q4. Should a `not_started` chapter with audio suggest `recording`?** Options: (A) no in v1; (B) yes when the linked track has audio items; (C) yes when RC measured any coverage. Recommendation: A, because it is not one of the three rules and item presence is weak evidence (a scratch take, room tone). RC's measured coverage is shown as evidence once it exists; reopen then. **D22 default (Phase 1):** the owner has not answered, so the recommendation is adopted per rule D22 (`docs/prds/implementation-plan.md`): `not_started` is not evaluated (`none`, `stage_not_evaluated`).
- [x] **Q5. Evaluate on read, or in the background?** Options: (A) on read only: Home load, a manuscript refresh, "Check now", after a Confirm, Dismiss or Revert, and after an analysis job finishes in this session; (B) background re-evaluation when project files change; (C) a persisted cache of recommendations. Recommendation: A, because D1 forbids a stored truth, evidence changes only when the saved `.rpp` or audio changes (which the app cannot watch cheaply without REAPER), and the cost is TBD - needs measurement. Reopen only if measured evaluation time exceeds what a page load can carry. **D22 default (Phase 1):** the owner has not answered, so the recommendation is adopted per rule D22 (`docs/prds/implementation-plan.md`): the engine is a pure function with no cache; the service that calls it on read comes in Phases 2 and 4.
- [ ] **Q6. Does ChapterNav show suggestions?** Options: (A) no; (B) a non-interactive marker on the status dot with the text "Suggested: <stage>"; (C) interactive Confirm in the nav. Recommendation: B, in a late phase, because narrators spend time on the Manuscript page but Confirm and its evidence belong in one place (Home), and the nav row is dense (`ChapterNav.tsx:53-63`).
- [x] **Q7. Can a dismissed suggestion reappear?** Options: (A) never; (B) only when its basis changes (any required signal's record or fingerprint), labeled "new evidence since you dismissed"; (C) a time-based snooze. Recommendation: B, because the narrator dismissed a specific set of evidence, and a time-based return would repeat a decision they already made. **D22 default (Phase 1):** the owner has not answered, so the recommendation is adopted per rule D22 (`docs/prds/implementation-plan.md`): a dismissal is matched by basis key, so it lapses when any required signal's state, ledger records or fingerprint change.
- [x] **Q8. How are the required checks chosen?** Options: (A) fixed rules; (B) per-project settings, one `choice` value (`required` or `ignored`) per optional signal, in a new `StageRecommendations` settings tool, with the invariant that a stage whose required set is empty is never `recommended`; (C) per chapter. Recommendation: B, because D10 wants narrator-owned, layered settings and the existing `choice` kind needs no new settings kind (DX-2's numeric kind is not needed for this). C is more than the narrator asked for. **D22 default (Phase 1):** the owner has not answered, so the recommendation is adopted per rule D22 (`docs/prds/implementation-plan.md`): Phase 1 enforces the invariant (an empty required set is `none`, never `recommended`) and uses every declared signal id as the required set until the Phase 6 settings exist.
- [x] **Q9. How are multi-track chapters handled?** Options: (A) v1 supports exactly one confirmed track per chapter; zero or several yield `unknown` with cause `unmapped_track` or `multiple_tracks`; (B) all linked tracks must be `met`; (C) any. Recommendation: A, per D5, because aggregating across tracks needs a rule for overlapping and concatenated takes that nobody has specified; EL owns the mapping and reopens this when it allows several. **D22 default (Phase 1):** the owner has not answered, so the recommendation is adopted per rule D22 (`docs/prds/implementation-plan.md`): `multiple_tracks`, `unmapped_track` and `unconfirmed_mapping` are `unknown` causes in the contract.
- [x] **Q10. Does a stale basis alone raise "evidence changed since you confirmed"?** Options: (A) yes, any signal that is no longer current; (B) only a fresh `not_met` from a complete analysis at the current fingerprint; staleness alone is shown quietly in the evidence view ("edited since you confirmed"); (C) never. Recommendation: B, because editing changes item fingerprints by design (D6), so a recording analysis is expected to go stale once a chapter is in `editing`; A would warn every edited chapter. **D22 default (Phase 2):** the owner has not answered, so the recommendation is adopted per rule D22 (`docs/prds/implementation-plan.md`): B, only a `not_met` of the confirmed stage's signals raises the notice; a changed basis alone sets `evidenceChanged` (ADR 0161).
- [ ] **Q11. Where does the evidence view live?** Options: (A) the existing `SlideOver` (interactive, no new primitive); (B) a new Popover primitive (new stories, atlas and `design-spec-guard` work); (C) an inline expanding row in the breakdown table. Recommendation: A, because tooltips cannot host readable, linkable content (`Tooltip.tsx:17-18`), the table is already five columns wide, and reusing `SlideOver` adds no primitive. Reopen if Home needs it beside the table on wide viewports.
- [x] **Q12. Does "Check now" start missing analyses?** Options: (A) it only re-evaluates; each `unknown` shows what to run and links to the owning page or job; (B) it also starts every missing analysis. Recommendation: A, because analyses are long and the narrator's to start (D1, ADR 0015), and a read that starts work would also break the read-only, cheap evaluation guarantee. **D22 default (Phase 1):** the owner has not answered, so the recommendation is adopted per rule D22 (`docs/prds/implementation-plan.md`): the `Provider` contract forbids starting an analysis; a provider reads existing evidence only.
- [ ] **Q13. Does Confirm ask a second question?** Options: (A) one click, reversible by the Revert control; (B) a `ConfirmDialog`. Recommendation: A, because a status is cheap to revert and a stored basis records what was seen; B adds a `ConfirmDialog` (modal and delivered, [ADR 0048](../adr/0048-every-dialog-is-one-modal-shell-and-confirms-are-alert-dialogs.md)) and a click per chapter.
- [x] **Q14. Which roadmap milestone carries this?** **Dropped by owner decision D9** (`docs/prds/implementation-plan.md`): the set stays unscheduled, with no edit to `docs/roadmap.md`, `config/roadmap.json` or GitHub milestones from this PRD. Original question: Options: (A) a new milestone after milestone 4; (B) part of milestone 4 (diagnostics and delivery); (C) unscheduled until EL and RC ship. Recommendation: A, because it depends on EL and on signals from three analyzer families and reads as one user outcome; the roadmap and `config/roadmap.json` change together and the merge re-syncs the GitHub milestone (`docs/operations/github-workflow.md`). The user owns the milestone list, so Phase 9 proposes it and does not assume it.

## Users & Context

**Primary User**

- **Who**: A narrator, often also the editor and proofer, recording audiobook chapters in REAPER on Windows, working chapter by chapter.
- **Current behavior**: Sets each chapter's status from memory in the Home breakdown table, or leaves it stale; checks recording completeness by ear or by running Transcript Compare over a selection; edits and proofs against personal checklists.
- **Trigger**: Finishing a working session on a chapter, or opening Home to see what is left.
- **Success state**: Home shows which chapters look ready to advance and why; the narrator confirms or dismisses in one click and trusts that "ready" was never claimed on missing evidence.

**Job to Be Done**: When I finish work on a chapter, I want the app to tell me whether the evidence says the stage is over, and show that evidence, so that I can move the chapter forward quickly without re-checking everything by hand or trusting a guess.

**Non-Users**: Reviewers wanting a compliance certificate; anyone expecting the app to advance chapters on its own; teams sharing progress across machines.

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Notes |
| --- | --- | --- |
| Must | Signal contract and a pure, deterministic recommendation engine; `unknown` never `met`; empty required set never recommends | Phase 1 |
| Must | Confirmation and dismissal store beside the status, keyed by `documentId` plus chapter id, atomic writes, cleared on re-import | Phase 2 (Q1) |
| Must | Confirm sets the status and records the basis; refused if the basis changed; Revert; Dismiss remembered against its basis | Phase 2 (Q2, Q7) |
| Must | Stale-after-confirm notice with one-click revert; never auto-downgrade | Phase 2, surfaced in Phase 5 (Q10) |
| Must | Recording signal wired end to end, with mapping and staleness handled as `unknown` causes | Phase 3; needs RC and EL |
| Must | Home surface: verdict badge, Confirm, Dismiss, evidence view stating what was checked, the basis, how old it is and why it is unknown | Phase 5 |
| Must | Host bindings, TypeScript contract, mock | Phase 4 |
| Must | Docs, state catalog, doc screenshots for every new visible state | Phases 5, 8, 9 |
| Should | Required-check settings per signal (project scope) | Phase 6 (Q8) |
| Should | Editing and proofing signals wired, with remaining candidates or open pickups listed in the evidence | Phases 7, 8 |
| Should | Proofing page panel of chapters currently in Proofing, using the same component | Phase 8 |
| Should | "Check now"; re-evaluate after a job finishes | Phase 5 (Q5, Q12) |
| Should | ChapterNav marker; Tracks page hint where a chapter's track is not linked | Phase 9 (Q6, D5) |
| Could | A master on/off setting for suggestions | Phase 6 |
| Could | Suggest `recording` for `not_started` | Q4, reopened after RC |
| Could | Read-only decision history view | Records are append-only, so it is cheap later |
| Won't | Auto-apply, auto-downgrade, stored recommendations, readiness score, new enum value in v1, multi-track aggregation, new Lua | See table above |

### MVP Scope

Phases 1 to 5 are the MVP: the recording signal end to end, from contract to Home, needing EL's fingerprint, ledger and confirmed mapping and RC's recording signal underneath. Phases 6 to 9 add settings, the editing signal, the proofing signal, and the secondary surfaces and close-out. If time-boxed, stop after Phase 5; it delivers a working suggestion for the most tractable rule and proves the contract that ER and PS plug into.

### User Flow

1. The narrator opens Home. The estimate card shows how many chapters have a suggestion. Expanding the breakdown lists each chapter with its status and a verdict next to it.
2. A chapter in `recording` reads "Suggested: Editing" when the text is present in order. "Why" opens the evidence view: the signal, the coverage evidence (per paragraph), the basis ("saved project, file modified <time>, analyzed <time>") and how old it is.
3. A chapter with nothing analyzed reads "Can't tell yet" with the cause (not analyzed, track not linked, project not saved) and the action that resolves it; "Check now" re-evaluates after the narrator did it.
4. The narrator clicks Confirm. The status changes and a record is stored; or Dismiss, which hides that suggestion until its evidence changes.
5. Later, a re-run shows a paragraph missing after the chapter moved to editing. Home shows "Evidence changed since you confirmed" with Revert. Nothing else moves.

## Technical Approach

**Feasibility**: HIGH for the contract, engine, store, bindings and Home surface (pure Go plus existing UI patterns). The end-to-end value is MEDIUM overall because it depends on signals that do not exist yet (EL, RC, then ER and PS), and on a narrator-confirmed chapter-to-track mapping that does not exist yet.

**Shared decisions (D1 to D12)**

| Decision | Owner | How this PRD applies it |
| --- | --- | --- |
| D1 computed, never applied | SR | The engine is a pure function of current evidence; only Confirm writes |
| D2 tri-state signals | SR (contract) | `met`, `not_met`, `unknown`; recommended only when every required signal is `met` |
| D3 stage mapping, enum unchanged | SR | The status is the current stage; the rule advances one stage; no new value (Q3) |
| D4 confirmation stored beside the status | SR | New sidecar keyed by `documentId` plus chapter id (Q1); revert on contradiction |
| D5 mapping is an input | EL (mapping and confirm UI); SR consumes | Unconfirmed or missing mapping is `unknown`; SR adds only a hint on the Tracks page |
| D6 fingerprint and played range | EL, ER | SR treats them as opaque basis values |
| D7 ledger: clean is not never-ran | EL | Signals are `met` only from a `complete` record at the current fingerprint |
| D8 per-item result cache | EL | Not touched here; keeps re-analysis cheap after an edit |
| D9 open-finding semantics | RD, ER, PS | Open means unreviewed, deferred or accepted; SR reads the outcome through each signal |
| D10 settings and thresholds | SR (required checks), DX-2 (numeric kind), signal PRDs (thresholds) | SR adds `choice` settings only; no thresholds live here |
| D11 replace the guess | RC | Home stops using `RECORDED_FRACTION` where a measurement exists; SR verifies it |
| D12 corpus before thresholds | RC, ER, PS | SR validates the end-to-end verdict on their corpora (Phase 9) |

**Architecture Notes**

- **Package.** New `apps/desktop/internal/stages`: `types.go` (Stage, SignalState, UnknownCause, Signal, Evidence, Basis), `engine.go` (pure; Verdict, Assessment, BasisKey), `provider.go` (Provider, EvidenceView, Collect), `store.go` (decisions), `service.go` (composes providers, store and the manuscript service), and one provider file per signal owner. Providers implement `Provider { Stage() Stage; SignalIDs() []string; Signals(ctx, ChapterContext, EvidenceView) ([]Signal, error) }` (Phase 1 added `SignalIDs` and the error; see the Decisions Log); the engine never imports a signal package. The contract as built is in `docs/architecture/stage-recommendations.md` and ADR 0160.
- **Signal contract (SR defines, the signal PRDs implement).** `Signal { id, stage, state: met | not_met | unknown, reason (short human string), evidence[] (typed: label, value, and where applicable file, range or paragraph ids), basis { ledgerRecordIds[], fingerprint, projectFileMtime }, computedAt }`. This PRD adds one optional field, `cause`, meaningful only when the state is `unknown`: `never_analyzed | stale | incomplete_run | analysis_running | unmapped_track | unconfirmed_mapping | multiple_tracks | measurement_unavailable | project_unreadable | provider_error`. The UI routes the "what to do" action from `cause`; without it every `unknown` would read the same. Signal ids are `<stage>.<name>` (owned by each signal PRD; the table above is illustrative).
- **Verdicts.** For a chapter at `recording`, `editing` or `proofing`, over its required signals: any `not_met` gives `not_ready` (quiet, reason shown); otherwise any `unknown` gives `unknown` (cause and action shown); otherwise all `met` gives `recommended`, unless the narrator dismissed this basis, which gives `dismissed`. `not_started`, `finalized`, an empty required set, or suggestions switched off give `none`. `not_met` outranks `unknown` because neither may recommend and the concrete reason is more useful.
- **Basis key.** SHA-256 over the chapter id, the target stage and each required signal's id, state, ledger record ids and fingerprint, sorted. It excludes `computedAt` and the project file mtime, so a re-save with identical fingerprints keeps a dismissal alive. The UI sends the key it displayed; Confirm and Dismiss recompute and refuse on a mismatch ("evidence changed while you were looking; check again").
- **Evaluation flow.** (1) List narration chapters (`contentKind` narration, as `AudiobookEstimatePanel.tsx:63`). (2) Load decisions and drop any file whose `documentId` differs from the manuscript's. (3) Build one `EvidenceView` per evaluation (parse the saved `.rpp` once, read its mtime, index the ledger; EL supplies the pieces), so providers share it. (4) For each chapter, call the providers of its current stage, run the engine, apply dismissals. (5) For a chapter with a live confirmation (a record whose stage equals the current status), also re-evaluate the signal set that justified it (the previous stage's) to detect contradiction per Q10. Providers may not decode audio, transcribe, or reach the network.
- **Decision store.** `<project>/narration-utils/stage-decisions.json`, written like `saveNotes` (temp file, then rename; `reader.go:258-281`) under a mutex. Fields: `schemaVersion`, `documentId`, and an append-only `decisions` list of `{ chapterId, kind: confirmed | dismissed | reverted, from, target, basisKey, basis (per-signal id, state, ledger record ids, fingerprint, and a short evidence summary), at }`. A confirmation is live only while the chapter's status equals its target, so a manual change through the `<select>` retires it without a write. Added to `resetDerived` (`service.go:434-441`) and documented in `docs/architecture/daw-integration.md` project-sidecar rules and `docs/architecture/codebase-map.md`.
- **Confirm consistency.** Two files are involved (decisions and `manuscript-notes.json`), so Confirm writes the record first, then calls `SetChapterStatus`; if the status write fails it removes the record and reports the error; a crash between the writes leaves a record whose target is not the current status, which is ignored. Tested in Phase 2.
- **Bindings.** `StageRecommendations()`, `StageConfirm(chapter, target, basisKey)`, `StageDismiss(chapter, target, basisKey)`, `StageRevert(chapter)`, encoded through `encodeBinding` like `ManuscriptSetChapterStatus` (`apps/desktop/bindings.go:348`); the service is rebuilt on project switch (`apps/desktop/app.go:146`) and read under the host lock. TypeScript contract `apps/ui/src/api/contracts/stages.ts`, mock fixtures for every verdict, `wailsClient` adapter, regenerated `apps/ui/wailsjs/go/main/Host.{js,d.ts}`.
- **UI.** A `StageSuggestion` component (badge, Confirm, Dismiss, Why, stale notice) in `apps/ui/src/components/stages/`, used in the breakdown table's status cell and reused by the Proofing panel; evidence in a `SlideOver` (Q11). Loading and error states are explicit: a failed evaluation reads "Couldn't check", never silence.
- **Settings.** A `StageRecommendations` tool with `choice` values `required | ignored` per optional signal, project scope over global over built-in default, mirrored in `config/defaults.json` and `builtinDefaults` (`store.go:38-42`), with keys derived from signal ids.
- **Docs.** A new `docs/architecture/stage-recommendations.md` records the contract; `home.md`, `proofing.md`, `tracks.md` and `manuscript.md` under `docs/guides/using-the-app/` gain the new states; a workflow doc under `docs/workflows/` states the three rules.
- **ADRs expected** (written with `adr-author` after code lands; next free number at merge time, PR #44 uses 0027 to 0035): one for "stage recommendations are computed on read and applied only by narrator confirmation; the confirmation record lives beside the status", extending draft ADR 0031 (PR #44); another only if Q3 chooses a `proofed` state.

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| A false "done" recommendation hides real work | Medium | Tri-state signals, `unknown` never `met`, non-empty required set, conservative defaults, corpus gate (Phase 9), basis shown in every verdict |
| Signals arrive late or wrong, so most chapters read `unknown` at first | High | MVP ships one signal; the Home copy names the cause and the action; unmapped chapters route to EL's mapping UI |
| Editing invalidates the earlier stage's basis, causing false alarms | High | Q10: only fresh `not_met` raises the notice; staleness is informational |
| Saved `.rpp` lags the open project, so evidence is out of date | High | Every basis is labeled "saved project, file modified <time>"; no auto-confirm; the narrator sees the age |
| Chapter ids reset on re-import, mis-attaching old decisions | Medium | Keyed by `documentId`; file dropped on mismatch; `resetDerived` entry |
| Two-file Confirm leaves an inconsistent state after a crash | Low | Record-then-status ordering, compensating removal, and the ignore-if-target-differs rule; tested |
| The narrator confuses `not_ready` with `unknown` | Medium | Different wording and action; evidence view lists each signal separately |
| `unknown` fatigue (Home full of "can't tell") | Medium | Group the summary by cause; dismissals per basis; no nav badge in the MVP |
| Host API version and `AudiobookEstimatePanel.tsx` collisions with parallel work | High | See Parallel-session compatibility; check `hostAPIVersion` at merge time |
| `finalized` conflates proofing-done with delivery-done | Medium | Q3 recommends A now and reopens after dogfood; evidence text says "proofing complete" |
| Evaluation cost grows with items and files | Unknown | Measured in Phase 4 on a real project (TBD); Q5 reopens if too slow |

## Implementation Phases

Every phase follows the `CLAUDE.md` workflow: plan (find or open the tracking issue first and put `Closes #<n>` in the PR, `docs/operations/github-workflow.md`), `change-impact-scan`, TDD, `full-verification-gate` (`pnpm check`), `design-spec-guard` for primitives or `styles.css`, `feature-cleanup`. Phases that change `apps/ui` also add rows to `apps/ui/tests/visual/state-catalog.ts` with drivers in `app.drivers.ts`, run the Playwright visual suite and the atlas, and view every PNG at `desktop`, `small-desktop`, `tablet` and `mobile` (`apps/ui/tests/visual/viewports.ts`); new primitives get stories; user-visible states get doc screenshots. Phases that add a host binding bump `hostAPIVersion` in `apps/desktop/app.go`, `apps/desktop/app_test.go` and `apps/ui/src/hostApi.ts` (5 at d5cc994; RD-4, DX-1 and others also bump, so check at merge time) and regenerate `apps/ui/wailsjs/go/main/Host.{js,d.ts}`. No phase adds Lua. Re-check `docs/adr/` before numbering an ADR.

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Signal contract and engine | `apps/desktop/internal/stages` types, provider interface, pure engine, verdicts, basis key, contract doc; exhaustive table tests; fake providers | complete | EL-1 to EL-6, RC | - | - |
| 2 | Decision store and confirmation service | Sidecar store, Confirm, Dismiss, Revert, basis-mismatch refusal, contradiction notice, `resetDerived` entry, crash tests | complete | 3 | 1 | - |
| 3 | Recording signal provider | Adapter from RC's coverage result and EL's staleness and mapping to signals with causes; fixtures; service test on the RC corpus | complete | 2 | 1, RC-7, EL-5, EL-6 | - |
| 4 | Bindings, contract and mock | Four bindings, TypeScript contract, mock, wailsClient, generated Host files, host API bump, timing measurement | pending | - | 2, 3 | - |
| 5 | Home surface (MVP) | `StageSuggestion`, evidence `SlideOver`, breakdown-table integration, summary chip, Check now, states, docs and screenshots | pending | - | 4 | - |
| 6 | Required-check settings | `StageRecommendations` settings tool, defaults, Settings UI, engine wiring, optional master switch | pending | 7, 8 | 1, 5 | - |
| 7 | Editing signal | ER provider adapter, remaining-candidates evidence with time ranges and classes, Home rendering | pending | 6, 8 | 5, ER-6 | - |
| 8 | Proofing signal and Proofing panel | PS provider adapter, open-pickup and delivery-check evidence, Proofing page panel | pending | 6, 7 | 5, PS-1, PS-5 | - |
| 9 | Secondary surfaces and close-out | ChapterNav marker, Tracks hint, end-to-end corpus validation, ADR, docs, cleanup (no roadmap edit: implementation plan D9) | pending | - | 5, 7, 8; EL-7 | - |

### Phase Details

**Phase 1 - Signal contract and engine**
- **Goal**: A tested, deterministic core that the rest of the set codes against.
- **Scope**: `apps/desktop/internal/stages` with the types and `cause` values, the `Provider` interface, the pure engine (verdict rules, empty-required-set rule, basis key excluding time fields), and `docs/architecture/stage-recommendations.md` describing the contract for the RC, ER and PS implementers. No bindings, no UI, no settings. This phase should land before the signal PRDs' provider phases, which import the `Signal` type.
- **Success signal**: An exhaustive table test over every state combination for one to four required signals per stage; a determinism test; a test that `unknown` never yields `recommended`; `pnpm check` green; coverage 80% or better on the package.

**Phase 2 - Decision store and confirmation service**
- **Goal**: Narrator decisions persist beside the status, safely.
- **Scope**: `stage-decisions.json` (fields above), atomic writes, `documentId` scoping, `resetDerived` entry in `apps/desktop/internal/manuscript/service.go`, Confirm with basis-key check that calls the manuscript status path and rolls back on failure, Dismiss, Revert, the live-confirmation rule, and the contradiction notice (Q10) computed from a fake provider; corrupt-file handling that reports an error, never a silent empty; update `daw-integration.md` sidecar rules and `codebase-map.md`.
- **Success signal**: Tests for Confirm success, status-write failure with rollback, a simulated crash between writes, a changed basis refused, a stale record after re-import ignored, a manual `<select>` change retiring a confirmation, dismissal reappearing only on a basis change, and a filesystem diff showing only the two intended files change.

**Phase 3 - Recording signal provider**
- **Goal**: The recording rule produces real signals from real evidence.
- **Scope**: A provider in `apps/desktop/internal/stages` that reads RC's per-chapter coverage result and EL's staleness and mapping API and returns one signal with evidence (per-paragraph coverage, unread head or tail, mid-chapter skips, out-of-order paragraphs as RC defines them), basis (ledger record ids, fingerprint, project file mtime) and cause. Missing or unconfirmed mapping, several tracks, a stale fingerprint, a partial or failed run, and a running analysis all map to `unknown`. No analysis is started here.
- **Success signal**: Fixture tests for complete, truncated, skipped-paragraph, stale, unmapped, multi-track and partial-run cases each mapping as specified, including that a `complete` record with zero coverage gaps is the only path to `met`; a service test over the RC corpus fixtures.

**Phase 4 - Bindings, contract and mock**
- **Goal**: The UI can read recommendations and act on them.
- **Scope**: `StageRecommendations`, `StageConfirm`, `StageDismiss`, `StageRevert`; service rebuilt on project switch and read under the host lock; `contracts/stages.ts`; mock with fixtures covering `recommended`, `not_ready`, `unknown` (each cause), `dismissed`, `none` and the stale notice; wailsClient adapter; generated Host files; host API bump in three places; a timed evaluation on a real project (items, files, wall time recorded, TBD until measured).
- **Success signal**: Binding tests through the host; the mock and the real client return the same shape; the measured time is recorded in the PR and in Q5; `pnpm check` green.

**Phase 5 - Home surface (MVP)**
- **Goal**: The narrator sees, understands and acts on a suggestion.
- **Scope**: `StageSuggestion` in the breakdown table's status cell; a summary chip on the collapsed estimate card ("N chapters have a suggestion"); Confirm, Dismiss, Revert, "Check now"; the evidence view in a `SlideOver` (what was checked, basis with file modified time, age, why unknown, and the action for each cause); explicit loading and error states; refresh after decisions and after a job finishes; state-catalog rows and drivers for recommended, not-ready, unknown, dismissed, stale-notice and error states at four viewports; `home.md` and doc screenshots. The `<select>` remains.
- **Success signal**: End to end on a real chapter recorded in the RC corpus; visual suite and atlas green with every viewport PNG reviewed; Confirm sets the status and a reload keeps it; Revert restores it.

**Phase 6 - Required-check settings**
- **Goal**: The narrator chooses which signals must be met.
- **Scope**: `StageRecommendations` entry in `fieldSchemas` (`apps/desktop/app.go:673-679`) with `choice` values; defaults in `config/defaults.json` and `builtinDefaults`; `Settings.tsx` section; the engine reads effective settings; a stage whose required set is empty shows `none` with an explanation, never `recommended`; an optional master switch.
- **Success signal**: Settings tests for scope precedence and the defaults-sync test; an engine test that ignoring every signal in a stage disables its suggestion; visual states for the settings section.

**Phase 7 - Editing signal**
- **Goal**: The editing rule joins the same surface.
- **Scope**: A provider for ER's per-class signals; evidence lists remaining candidates (class, time range, confidence) with a link to ER's review of them; the processed-audio caveat ("analysis of source audio, take FX not applied") carried in the evidence; Home rendering of multiple signals in the evidence view; no change to the engine or the store.
- **Success signal**: The engine and store are untouched (the diff proves the plug-in claim); fixtures for each class `met`, `not_met` and `unknown`; a chapter with an open breath candidate never reaches `recommended`.

**Phase 8 - Proofing signal and Proofing panel**
- **Goal**: The proofing rule, and a Proofing-page place to see it.
- **Scope**: A provider for PS's signals (open pickups by source, and one signal per selected delivery or performance check); a Proofing page panel listing the chapters currently in `proofing` with their verdicts, using `StageSuggestion` (the Transcript state carries no chapter id, so the panel is chapter-based and does not depend on the last run's identity; PS adds any per-run affordance that routes through Confirm); docs in `proofing.md`.
- **Success signal**: Fixtures for pickups open, resolved and unavailable; an unavailable delivery check is `unknown`; visual suite at four viewports for the panel.

**Phase 9 - Secondary surfaces and close-out**
- **Goal**: Finish the set and prove it end to end.
- **Scope**: The non-interactive ChapterNav marker with "Suggested: <stage>" (Q6); the Tracks page hint where a chapter's track is not linked, pointing at EL's mapping UI; end-to-end validation of the verdicts on the RC, ER and PS corpora against the narrator's own stage labels (D12, requires permissioned chapters; TBD - needs the user), with the false-recommendation result recorded; the ADR(s) via `adr-author`; `docs/README.md` inventory, `home.md`, `proofing.md`, `tracks.md`, `manuscript.md`, the workflow doc; no roadmap or milestone edit (the implementation plan's owner decision D9; Q14 dropped); `feature-cleanup`.
- **Success signal**: Corpus result recorded and any false recommendation explained or fixed; docs, screenshots and roadmap consistent; `pnpm check` and the visual suite green.

### Parallelism Notes

Phase 1 has no dependencies and can run beside EL and RC; it should merge before the signal PRDs' provider phases. Phases 2 and 3 are disjoint (store versus provider) and can run in parallel after Phase 1; Phase 3 waits on RC and EL. Phase 4 needs both. Phases 6, 7 and 8 can run in parallel after Phase 5, but 7 and 8 also wait on ER and PS, and 6 and 8 both edit shared settings and UI files (see below). Phase 9 is last. The MVP can ship without ER, PS or Phase 6.

### Parallel-session compatibility

| Phase | Files touched | Who else collides |
| --- | --- | --- |
| 1 | New `apps/desktop/internal/stages/*`, new `docs/architecture/stage-recommendations.md` | RC, ER, PS provider phases (they import the `Signal` type); nothing else |
| 2 | `apps/desktop/internal/stages/store*.go`, `apps/desktop/internal/manuscript/service.go` (`resetDerived` slice, `:434-441`), `docs/architecture/{daw-integration,codebase-map}.md` | RD-1 and EL both add a directory to the same slice literal, so expect textual conflicts; agree who lands first |
| 3 | `apps/desktop/internal/stages/recording*.go` | RC coverage service and EL staleness API (both must expose stable Go entry points first) |
| 4 | `apps/desktop/{app.go,bindings.go,app_test.go}`, `apps/ui/src/{hostApi.ts,api/contracts/stages.ts,api/mockApi.ts,api/mockFixtures.ts,api/wailsClient.ts}`, `apps/ui/wailsjs/go/main/Host.*` | Every phase in every PRD that adds a binding (RD-4, DX-1, RC, EL): host API number; second to merge rebases to the next number |
| 5 | `apps/ui/src/components/home/{AudiobookEstimatePanel.tsx,Home.tsx}`, new `components/stages/*`, `tests/visual/{state-catalog.ts,app.spec.ts,app.drivers.ts,doc-screenshots.json}`, `docs/guides/using-the-app/home.md`, `docs/images/ui/*` | DX-8 (edits `AudiobookEstimatePanel.tsx` to read measured duration), RC (fills `recordedFraction`, changes the "Actual recorded" cell), TM-13 (regenerates every screenshot), dialog modality work if a dialog is added |
| 6 | `apps/desktop/app.go` (`fieldSchemas`), `config/defaults.json`, `apps/desktop/internal/settings/store.go` (`builtinDefaults`), `apps/ui/src/components/settings/Settings.tsx`, `mockFixtures.ts` | DX-2 (numeric settings kind, same map and page), the teleprompter engines and input-devices settings phase, TM-12 |
| 7 | `apps/desktop/internal/stages/editing*.go`, evidence rendering in `components/stages/*` | ER's review UI and any Home change |
| 8 | `apps/desktop/internal/stages/proofing*.go`, `apps/ui/src/components/proofing/*`, `tests/visual/*`, `docs/guides/using-the-app/proofing.md` | PS (Proofing page affordance and copy), RD-2 (Transcript Compare adapter), TR, any Proofing page work |
| 9 | `ChapterNav.tsx` and its test, `apps/ui/src/components/tracks/TracksPage.tsx`, `docs/roadmap.md`, `config/roadmap.json`, docs and screenshots, `docs/adr/` | EL's mapping UI (Tracks page), TM-8 and DX-8 (tracks), any milestone-status edit (roadmap files change together and alone), ADR numbering |

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Suggestions only; the app never changes status, audio or manuscript by itself (recorded, user) | Narrator confirms every change | Auto-advance | User request; `docs/roadmap.md:10`; draft ADR 0031 (PR #44) |
| Product boundary (recorded) | No comping, no acting verdicts, no cloud | - | `docs/roadmap.md:10` |
| REAPER work is Lua-only-for-now (recorded, user) | No new Lua; compute from the saved `.rpp` and audio | Live REAPER state | Project memory; the app must work standalone |
| Real progress only (recorded, ADR 0015) | Nothing shown may be a placeholder; MVP ships with a real signal | UI first with mock data | ADR 0015 |
| D1 computed, never applied | Engine is pure over current evidence | Stored recommendation | A stored copy goes stale and is trusted |
| D2 tri-state signals | `unknown` never `met` | Boolean signals | A false "done" is worse than a false "not done" |
| D3 stage mapping, enum unchanged in v1 | Current status is the stage; one-stage advance | New `proofed` value | Q3 recommendation A |
| D4 confirmation stored beside the status (proposed, Q1) | New sidecar keyed by `documentId` plus chapter id | Extend `manuscript-notes.json`; findings store | `reader.go:286-302`, `:339`; chapter ids positional |
| Confirm sets the status (proposed, Q2) | One action, record then status, compensating rollback | Record only | Single source of truth for existing readers |
| Recommendations evaluated on read (proposed, Q5) | Home load, refresh, Check now, after decisions and jobs | Background service; cache | D1; cost TBD |
| Evidence view in `SlideOver` (proposed, Q11) | Reuse existing primitive | New Popover; inline row | No new primitive; tooltips are non-interactive |
| Contradiction raises a notice only on fresh `not_met` (proposed, Q10) | Stale is informational | Any stale raises it | Editing changes fingerprints by design |
| Required checks by project settings (proposed, Q8) | `choice` values, non-empty required set | Fixed; per chapter | D10; no new settings kind |
| One track per chapter in v1 (proposed, Q9) | Other counts are `unknown` | Aggregate | D5 |
| Added `cause` to the shared signal contract (proposed) | Optional field on `unknown` | Free-text reasons only | UI needs to route the action; other PRDs may adopt it |
| Evaluation never starts analysis (proposed, Q12) | "Check now" re-reads only | Start missing analyses | ADR 0015; read-only, cheap evaluation |
| Confirm is one click, reversible (proposed, Q13) | Revert control | ConfirmDialog | Cheap to undo; dialog work owned elsewhere |
| Q3 no `proofed` state (D22 default, Phase 1) | Proofing-complete recommends `finalized`; `stages.Stage` is the stored status | Add `proofed`; per-chapter flag | Owner has not answered; PRD recommendation A adopted per D22 |
| Q4 `not_started` not evaluated (D22 default, Phase 1) | Verdict `none` (`stage_not_evaluated`) | Suggest `recording` when audio exists | Owner has not answered; PRD recommendation A adopted per D22 |
| Q5 evaluate on read (D22 default, Phase 1) | Engine is pure and uncached | Background service; cache | Owner has not answered; PRD recommendation A adopted per D22 |
| Q7 dismissal returns on basis change (D22 default, Phase 1) | Dismissals match the basis key | Never return; time-based snooze | Owner has not answered; PRD recommendation B adopted per D22 |
| Q8 required checks by project settings (D22 default, Phase 1) | Phase 1 enforces "empty required set is `none`" and requires every declared id until Phase 6 | Fixed rules; per chapter | Owner has not answered; PRD recommendation B adopted per D22 |
| Q9 one track per chapter (D22 default, Phase 1) | `unmapped_track`, `unconfirmed_mapping`, `multiple_tracks` are `unknown` causes | Aggregate across tracks | Owner has not answered; PRD recommendation A adopted per D22 |
| Q14 roadmap milestone (owner decision D9 of `implementation-plan.md`, recorded) | Unscheduled; no roadmap, roadmap JSON or milestone edit; Phase 9 drops its roadmap step | New milestone after milestone 4 | Owner decision of 2026-09-20 |
| Q12 evaluation never starts analysis (D22 default, Phase 1) | The `Provider` contract forbids it | Start missing analyses | Owner has not answered; PRD recommendation A adopted per D22 |
| Provider declares its signal ids and may fail (Phase 1) | `Provider` gains `SignalIDs()` and `Signals` returns an error; a failed provider yields `unknown`/`provider_error` for every declared id | The Architecture Notes' error-free `Signals` only | The required set and the settings keys need the ids before any signal is reported, and a failure must still hold the chapter at `unknown`; ADR 0160 |
| Untrusted signals become `unknown` (Phase 1) | A required signal that is missing, reported twice, of another stage or fails `Validate` is replaced by `unknown`/`provider_error`; unrequired signals are ignored | Trust the provider; drop the signal | Conservative: bad evidence can hold a chapter back, never move it forward; ADR 0160 |
| `EvidenceView` carries the ledger's inputs (Phase 1) | Parsed saved project, project folder and file, `ProjectErr`, ledger and mapping stores | An opaque value per provider | Exactly what `evidence.EvaluateChapter` takes, so every provider shares one parse; the service that fills it is a later phase |
| Q1 decisions in their own sidecar (D22 default, Phase 2) | `narration-utils/stage-decisions.json`, append-only, keyed by `documentId`, in `resetDerived`; a corrupt file is kept aside and the read is an error | Extend `manuscript-notes.json`; findings store | Owner has not answered; PRD recommendation A adopted per D22; ADR 0161 |
| Q2 Confirm sets the status (D22 default, Phase 2) | Record first, then `SetChapterStatus`, record removed if the status write fails; an orphaned record is ignored because its target is not the status | Record only; derive the status | Owner has not answered; PRD recommendation A adopted per D22; ADR 0161 |
| Q10 only a fresh `not_met` raises the notice (D22 default, Phase 2) | The confirmed stage's signals are re-evaluated; `not_met` gives the notice, a changed basis alone gives `evidenceChanged` | Any stale basis raises it | Owner has not answered; PRD recommendation B adopted per D22; ADR 0161 |
| The stages service reads the manuscript through functions (Phase 2) | `Config` takes `LoadManuscript`, `Chapters` and `SetChapterStatus`, like `coverage.Config` | Import the manuscript package | `manuscript` imports `stages` (through `coverage`, and now for `resetDerived`), so the reverse import would be a cycle |
| The recording provider stays in `internal/coverage` (Phase 3) | `coverage.SignalProvider` (RC Phase 7, ADR 0131) is the Phase 3 provider; no `stages/recording*.go` | A second adapter in `internal/stages` | `coverage` already imports `stages`, so a provider in `stages` would be an import cycle, and a second copy would drift |
| The shared `EvidenceView` is built by the coverage service (Phase 3) | `coverage.Service.EvidenceView` has `stages.Config.View`'s signature: the saved project resolved and parsed once by the recording check's own rules (D6), its modified time, the ledger and the mapping; an unusable project is `ProjectErr` carrying the refusal, so the provider keeps that refusal's action ("choose the saved project on the Tracks page") | A builder in `internal/stages` | The rules for which `.rpp` counts live in `coverage`; a copy would let the two disagree. A later signal that needs the view reads the same one |
| Recording evidence per paragraph (Phase 3) | The coverage line says how many paragraphs pass; each region, largest first; then every paragraph that fails a threshold, with its share read and longest missing run; passing paragraphs are not listed | Every paragraph | A long chapter would list a hundred lines of "all read". RC has no out-of-order region: text read out of order shows as `skip` and `short_read` regions, so the PRD's "out-of-order paragraphs" are those |
| Corpus service test (Phase 3) | The sidecar's real results lines for every committed coverage case at the shipped settings are pinned in `fixtures/coverage/results.golden.json` (`UPDATE_CONTRACTS=1`), and a Go test stores each as a complete check and runs `stages.Service` over it | Hand-written reports; running Python from Go tests | Tests the analyzer's real output without a Python run in the Go suite; all 16 cases agree with their labels (8 recommended, 8 not ready) |

## Research Summary

**Market Context**: The research document surveys REAPER automation and narrator tooling and ranks per-chapter session progress as an unbuilt opportunity (`docs/research/reaper-automation-surface.md:271`, per docs); it does not describe a tool that infers a chapter's production stage from recording, editing and proofing evidence and asks the narrator to confirm, but that rests on absence in a survey and was not searched further here. The product framing (suggest, show evidence, the narrator decides) follows the offer-then-confirm pattern already in the product (ADR 0019).

**Technical Context**: The app already stores a per-chapter status and shows it in three places; it has a findings contract with review states (planned foundation), a whole-file Go measurement package, a Python transcript-to-manuscript aligner, a static `.rpp` reader and layered settings. It lacks the pieces the three rules need: a chapter coverage output (RC), an analysis ledger, item fingerprints and a confirmed chapter-to-track mapping (EL), editing-task detection (ER, on DX Phases 4 and 9), and an open-pickup roll-up (PS, on RD, TR and RF). RF Phase 22 (session progress from the `.rpp`) and DX-8 (measured recorded duration) touch the same Home panel for a related but different purpose (how much is recorded, not whether a stage is over); the sequencing of `AudiobookEstimatePanel.tsx` edits is the main coordination point. No new ML runtime or dependency is needed by this PRD.

---

*Generated: 2026-09-19*
*Status: IN DELIVERY - see the status block under the title (2026-09-23)*
