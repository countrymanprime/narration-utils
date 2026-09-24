# Recording Check Model Cascade

**Source:** owner conversation of 2026-09-23, after the Q7 model comparison of [#425](https://github.com/countrymanprime/narration-utils/issues/425) (item 1). Builds on the delivered recording check ([steady state](../utilities/recording-coverage.md), [calibration note](../research/recording-coverage-calibration.md), ADRs [0125](../adr/0125-recording-coverage-ground-truth-is-scripted-recordings-with-paragraph-labels-and-a-corpus-directory-variable.md) to [0132](../adr/0132-the-recording-check-ships-0-8-3-8-3-chosen-on-synthetic-fixtures-and-labelled-uncalibrated.md)). Citations are `file:line` on `main` at dd006030. Phase 2 (region bounds) is built; nothing else is yet.

## Problem Statement

The recording check transcribes a whole chapter with one Whisper model, the Transcript Compare `model_size` (`small` by default). That forces a trade-off: `small` takes about 5 minutes of CPU for a 30-minute chapter and can still call a complete chapter incomplete, while `large-v3-turbo` gets it right but takes about 10 minutes. The narrator runs the check after every recording session, so both the time and the false "not met" matter.

## Evidence

- **No model has ever passed an unread chapter.** Six model runs over two Piper takes of the 16 committed cases (`tiny` and `small` on the first take; `tiny`, `small`, `medium` and `large-v3-turbo` on the second) gave 96 verdicts at each of the shipped (0.8) and the Proposed (0.95) settings, and not one false "met". Every error was a false "not met": a model lost words it could not hear, never invented the missing text. ([calibration note, Q7](../research/recording-coverage-calibration.md#the-larger-model-q7))
- **Second take, one machine (AMD Ryzen 9 9955HX, CPU, int8):**

  | Model | False met | False not met (0.8 / 0.95) | CPU per audio minute | 30-minute chapter |
  | --- | --- | --- | --- | --- |
  | tiny | 0 | 0 / 0 | about 3 s | about 1.5 min |
  | small (default) | 0 | 1 / 1 | about 10 s | about 5 min |
  | large-v3-turbo | 0 | 0 / 0 | about 20 s | about 10 min |
  | medium | 0 | 0 / 1 | about 28 s | about 14 min |

  `small`'s false "not met" was a 13-word drop in a repeated refrain (`c3-refrain-complete`); `large-v3-turbo` heard it (119 of 121).
- **Transcription cost is per 30-second block, not per second.** A scratch benchmark with the sidecar's settings (`vad_filter`, `word_timestamps`, int8, CPU, 32 threads), `large-v3-turbo`:

  | Window | 5 s | 10 s | 20 s | 30 s | 60 s | 120 s | 240 s |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | Seconds | 4.6 | 4.9 | 4.9 | 10.4 | 16.8 | 27.6 | 63.4 |

  Loading the model took 3.2 s (median of 3); `tiny` loads in 0.2 s and runs at 1.5 to 2 s per audio minute. Three separate 10-second windows took 12.2 s against 14.4 s for one 60-second window over all three. So a window shorter than about 25 s costs the same as a 25-second one, the load is paid once per run, and merging two windows pays off only while the audio between them is short.
- **The sidecar already transcribes any list of slices with one model load.** `WhisperTranscriber` loads once and keeps the model for the run (`sidecars/transcript-compare/core/coverage_mode.py:243-265`); each manifest item is `(sourceFile, startOffset, length)` and words come back in source seconds (`:256`, `:263`). But every manifest item is also played audio and joins the alignment timeline (`:374-385`), so re-check windows cannot simply be added as items.
- **A gap has one audio point today.** `RegionPosition{ItemIndex, ItemGUID, SourceTime}` (`apps/desktop/internal/coverage/report.go:84-98`) is the first word of the gap's own audio (`coverage_mode.py:388-396`); the last matched word before the gap and the first after are computed during alignment but not emitted.
- **The model is one string per words file and per result.** `ItemWords.model` (`coverage_mode.py:85-94`), `StoredResult.Model` (`results.go:43-44`), `ReportView.Model` (`view.go:55`). The words cache key includes the model (`wordsParamHash`, `params.go:95-97`); the record's parameter hash leaves it out on purpose (Q13, [ADR 0128](../adr/0128-the-coverage-service-reads-the-saved-project-keeps-words-per-source-range-and-leaves-model-and-language-out-of-the-parameter-hash.md)). The sidecar's reuse check never compares a words file's model with `--model` (`coverage_mode.py:317-319`); only the host's cache key keeps models apart.
- **Nothing chooses a model per check.** `CoverageStart(chapterId)` resolves the global Transcript Compare model (`apps/desktop/bindings_coverage.go:41-75`, `app.go:1034-1040`).

## Proposed Solution

Check each chapter in two passes. A fast first pass (`tiny`) transcribes the whole chapter. A "met" paragraph stands. Every region the first pass reports missing becomes a window of audio, bounded by the matched words on either side of it, padded and merged by the block cost above, and a stronger model (`large-v3-turbo`) transcribes only those windows in one run. Its words replace the first pass's words inside each window, and the chapter is aligned again from the merged words, so the verdict still comes from the same rules and settings. When the windows would cover most of the chapter, the second pass transcribes the whole chapter instead.

## Key Hypothesis

We believe a `tiny` pass with `large-v3-turbo` re-checks of the missing regions will give verdicts at least as good as `small` alone in about a third of the time on a typical chapter. We'll know we're right when, over the calibration corpus, the cascade has no false "met", no more false "not met" than `large-v3-turbo` alone, and a total time within 40% of `small`'s, and a real, permissioned corpus (#425 item 3) does not show a false "met" from the first pass.

## What We're NOT Building

- A new alignment, verdict rule or threshold. The four settings and ADR 0132's values stay; only where the words come from changes.
- Re-checking "met" paragraphs by default. The cascade's safety rests on the first pass never inventing missing text; a spot check is a Could (MC6).
- GPU support, a new model, or a download the narrator did not ask for. A missing re-check model falls back as in MC4.
- Changing Transcript Compare, Proofing or the teleprompter's model choice.
- Dropping the "Proposed values, not yet calibrated" label. That still waits for a real corpus.

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| False "met" | 0 on the synthetic cases, and 0 on the real corpus when it exists | `coverage_calibration.py cascade` |
| False "not met" | No more than `large-v3-turbo` alone on the same take | Same |
| Time | Within 40% of `small` alone on the 16 cases and on a 30-minute item; far below `large-v3-turbo` alone | Same, per audio minute |
| Window cost model | Padding and merging choose the cheaper plan on the benchmark's cases | Unit tests on the planner with a cost table |
| No second pass when nothing is missing | A chapter the first pass calls complete never loads the second model | Service test with a fake sidecar |
| Honest labels | The result names both models and how many windows were re-checked | Go, Vitest, visual states |

## Open Questions

- [x] **MC1. Default or opt-in?** Recommendation: opt-in (a Recording check setting, off) until the real corpus confirms the first pass never gives a false "met", then on by default in its own PR with an ADR. **Answered 2026-09-23: opt-in, off by default.**
- [x] **MC2. Which models?** Recommendation: two settings, first pass (default `tiny`) and re-check (default `large-v3-turbo`), from the approved list; the re-check model must not be smaller than the first. **Answered 2026-09-23: two settings, first pass `tiny` and re-check `large-v3-turbo`.**
- [x] **MC3. Window rules as settings or constants?** Recommendation: constants measured by the benchmark, in one place: pad each window to 25 s, merge windows less than 20 s apart, and transcribe the whole chapter when the windows cover more than 60% of it. Expose them only if the real corpus shows they need tuning per machine. **Answered 2026-09-23: constants (25 s, 20 s, 60%), not settings.**
- [x] **MC4. The re-check model is not installed.** Recommendation: the check asks for the download as it does today for its one model (`RecordingCheck.tsx:152-178`), with "Check with tiny only" as the other choice; a tiny-only result is labelled as such. **Answered 2026-09-23: offer the download, or a labelled tiny-only check.**
- [x] **MC5. What the result shows.** Recommendation: "Checked with tiny; 3 passages re-checked with large-v3-turbo" in the dialog and on the stored result, and the region list marks which regions the second model confirmed missing. **Answered 2026-09-23: name both models and the re-checked passages, and mark confirmed regions.**
- [x] **MC6. Spot checks of "met" chapters (Could).** Re-check a small sample of "met" paragraphs, or those with long misread runs, so a false "met" from the first pass would show up in use. Recommendation: not in the first delivery; revisit with the real corpus. **Answered 2026-09-23: not in the first delivery.**
- [x] **MC7. Staleness.** A cascade result and a single-model result of the same chapter are both current today (the model is outside the parameter hash, Q13). Recommendation: keep Q13; the label says which models made it. **Answered 2026-09-23: keep Q13.**

## Users & Context

**Primary User**: a narrator checking a chapter after a recording session, on a Windows laptop without a GPU.
**Current behavior**: presses Check recording and waits for one model over the whole chapter; a false "not met" sends them looking for a gap that is not there.
**Trigger**: the end of a recording session, or a stage recommendation asking whether the chapter is recorded.
**Success state**: the check finishes in about the time `tiny` takes, and any "not met" it reports is one the stronger model agrees with.
**Job to Be Done**: When I finish recording a chapter, I want to know quickly and reliably whether every line is in the audio, so I can re-record the gaps before I move on.
**Non-Users**: narrators who never run the recording check.

## Solution Detail

| Priority | Capability | Phase |
| --- | --- | --- |
| Must | A calibration harness `cascade` command that measures the cascade on a corpus | 1 |
| Must | Each missing region reports its bounds in audio: the last matched word before and the first after, as item and source time | 2 |
| Must | A sidecar mode that transcribes a list of windows with one model load and splices the words into each item's words file, with per-span model provenance | 3 |
| Must | A window planner: bounds, padding, merging, per-item slices, whole-chapter fallback | 4 |
| Must | The host runs both passes as one check (one job, one cancel, one `job:ended`) and re-aligns from cached words | 4 |
| Must | Settings for on/off and the two models; the missing-model choice | 5 |
| Must | The dialog and result name both models and the re-checked windows | 5 |
| Should | The sidecar refuses to reuse a words file made by another model | 3 |
| Could | Spot checks of "met" paragraphs (MC6) | - |
| Won't | New verdict rules, GPU, automatic downloads | - |

**User flow**: the narrator presses Check recording. Progress reads "First pass (tiny)", then "Re-checking 3 passages (large-v3-turbo)". The result shows the verdict, "Checked with tiny; 3 passages re-checked with large-v3-turbo", and the regions still missing, each with its position in the audio.

## Technical Approach

**Feasibility**: HIGH. The sidecar already transcribes slices with one load and aligns from cached words without transcribing; the new parts are the region bounds, a windows-only mode, the splice and a planner.

**Architecture**
- **Region bounds.** In `coverage_mode.run`, map the anchor opcodes' audio indexes on either side of each region through `alignment["index_map"]` and `Timeline.position` to `{itemIndex, sourceTime}` pairs, and emit them on `COVERAGE_REGION` as `before` and `after` (either can be absent at a chapter edge). This is a wire change: `RegionLine` (`report.go:91-98`), the Zod schema `apps/ui/src/api/schemas/coverage.ts`, the golden payloads `tests/fixtures/contracts/coverage-result-*.json` (regenerated with `UPDATE_CONTRACTS=1`), the row in `wireContracts.test.ts` and the mock.
- **Window planner (Go, pure).** From the regions and the manifest's played ranges: window = `[before.end, after.start]` in each item, padded to at least 25 s and a few seconds past each bound; a window at a chapter edge runs to the item's edge; a window across two items becomes one slice per item; windows less than 20 s apart merge; if the windows exceed 60% of the chapter's audio, one whole-chapter pass replaces them. The constants sit beside `DefaultThresholds` with the benchmark cited.
- **Windows-only sidecar mode.** `--coverage --recheck <windows.json>` transcribes the windows with `--model`, then, for each affected words file, replaces the words whose midpoints fall inside a window with the new words, dropping words that touch a window edge. The words file gains a `spans` list (`{start, end, model}`) so provenance is per range, and `wordsVersion` goes up (which invalidates old cache entries once).
- **Host orchestration.** `prepareAndLaunch` (`service.go:247-296`) runs pass 1 as today with the first-pass model; if the report has regions, it plans windows, runs the re-check mode, harvests the spliced words, and runs the alignment again from the all-cached words (no transcription, `service_test.go:186`). The words cache key gains the model pair so a cascade's spliced words never seed a single-model check. One `coverage:state` stream with a stage field, one `job:ended`.
- **Result label.** `StoredResult.Model` stays the first-pass model for compatibility; a new `Recheck {model, windows, seconds}` field carries the rest, and `ReportView` exposes it.

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| The first pass gives a false "met" on real narration (noise, breaths, pace) | Medium | Opt-in until the real corpus (MC1); MC6 spot checks; the harness measures it |
| Word times at a window edge disagree between models, doubling or losing a word | Medium | Drop words touching an edge; pad past the bounds; a splice test with overlapping words |
| Whisper's VAD trims a short window to nothing | Low | Pad to 25 s; test a window of silence |
| The block cost differs on a GPU or a slower laptop | Medium | The planner's rules follow Whisper's 30 s window, which does not depend on the machine; record the benchmark per machine in the note |
| Two sidecar runs double the cancel and failure paths | Medium | One job; the service tests for cancel and failure run for each stage |
| The wire change breaks older stored results | Low | `before`/`after` optional; an old result reads without them |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Harness evidence | `coverage_calibration.py cascade` simulates the cascade (first-pass words, windows, re-check words, splice, align) and a `windows` benchmark command; results in the calibration note | complete: go ([evidence](../research/recording-coverage-calibration.md#model-cascade-phase-1): no false met and no false not met on two Piper takes at 0.95 and 0.8, 116% to 124% of `small`'s time on the short synthetic chapters and 30% on a 55-minute real chapter; one real-chapter disagreement pending the owner's ear) | with 2 | - | - |
| 2 | Region bounds | `before`/`after` on `COVERAGE_REGION`, Go types, Zod, goldens, mock | complete | with 1 | - | - |
| 3 | Re-check mode and splice | Windows-only sidecar mode, per-span provenance, `wordsVersion` bump, model check on reuse | pending | - | 2 | - |
| 4 | Planner and orchestration | Go planner, two-pass service run, cache key, one job | pending | - | 1, 3 | - |
| 5 | Settings, dialog and docs | On/off and model settings, the missing-model choice, labels, visual states, steady-state docs, ADR | pending | - | 4 | - |

**Phase 1.** Goal: prove the cascade on the corpus before the product changes. It reuses `Whisper(model, model_dir)` (`tests/coverage_calibration.py:164`) and the pure alignment, and adds the benchmark from this PRD's Evidence as a command. Success: the Key Hypothesis's numbers on both Piper takes, recorded in the calibration note. If the cascade misses them, stop here.
**Phase 2.** Goal: every region knows where it sits in the audio. Success: sidecar tests for a skip, a head, a tail and a region across two items; contract tests. **Delivered** ([ADR 0168](../adr/0168-a-coverage-region-carries-its-bounds-as-optional-before-and-after-points-with-no-version-bump.md)): `Region.audio_before`/`audio_after` from the anchors with body text (`recording_coverage.py`), written as `before`/`after` in each word's own item (`coverage_mode.py`); pinned by `tests/test_coverage.py` (skip, head after a read title, tail, different text, short read, nothing read), `tests/test_coverage_mode.py` (a skip in one item, a skip across two items, a head, a tail, no words) and the regenerated `fixtures/coverage/results.golden.json`; Go `RegionLine.Before`/`After` with `report_test.go` (bounds read; an old results file and an old stored result read with none); the Zod schema, the regenerated `coverage-result-*` goldens, a `wireContracts.test.ts` case and the mock. No version bump: the fields are additive and the verdict is unchanged.
**Phase 3.** Goal: the sidecar re-checks windows without touching the timeline. Success: tests for splice, edge words, overlapping windows and a silent window; an all-cached re-run after a splice loads no model.
**Phase 4.** Goal: one check, two passes. Success: service tests with a fake sidecar for no regions (one pass), some regions (windows), most of the chapter (whole-chapter fallback), cancel in each stage and failure in each stage; planner unit tests with the benchmark's cost table.
**Phase 5.** Goal: the narrator can turn it on and sees what it did. Success: Vitest for the settings and labels, the visual suite across viewports for the new states, and `docs/utilities/recording-coverage.md` updated; the PRD is deleted in this PR.

**Parallelism Notes**: Phases 1 and 2 are independent. 3 needs 2's region shape; 4 needs 1's go/no-go and 3's mode.

**Parallel-session compatibility**

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 1 | `sidecars/transcript-compare/tests/coverage_calibration.py` and its test, `docs/research/recording-coverage-calibration.md` | #425 item 3 (real corpus) |
| 2 | `core/coverage_mode.py`, `core/recording_coverage.py`, `internal/coverage/report.go`, `apps/ui/src/api/schemas/coverage.ts`, `tests/fixtures/contracts/coverage-*.json`, `wireContracts.test.ts`, `coverageMock.ts` | Stage recommendations (`signal.go` reads regions) |
| 3 | `core/coverage_mode.py`, `compare.py` CLI, `internal/coverage/words.go`, `params.go` | Any other coverage work |
| 4 | `internal/coverage/service.go`, `run.go`, a new `plan.go`, `bindings_coverage.go`, `jobs.go` | #425 item 4 (play from a region) touches the same dialog later |
| 5 | `RecordingCheck.tsx`, `RecordingCheckReport.tsx`, `recordingCheckText.ts`, `RecordingCheckSummary.tsx`, `app.go` settings schema, `settings_number.go`, `config/defaults.json`, `state-catalog.ts`, `app.drivers.ts`, `docs/utilities/recording-coverage.md`, `docs/guides/using-the-app/` | Settings page work, the stage-recommendation PRDs |

Cross-cutting: each phase follows `CLAUDE.md`: plan, `change-impact-scan`, TDD, `full-verification-gate`, `feature-cleanup`. Phases 2 and 5 cross the wire and follow `docs/architecture/wire-contracts.md`. Phase 3 changes what the sidecar reads and writes on disk; re-read threat-model row 4e.

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Open questions MC1 to MC7 | The owner adopted every recommendation (2026-09-23) | - | Recorded on each question above |
| Trust "met" from the first pass | Yes, re-check only "not met" regions (adopted) | Re-check everything; spot checks | 96 verdicts, no false "met" from any model; MC6 keeps a spot check open |
| Window size | Bounded by matched words, padded to 25 s, merged under 20 s apart (adopted) | A fixed 1 to 2 minutes either side | Whisper costs per 30 s block; the bounds are where the missing text must be |
| Whole-chapter fallback | Above 60% of the chapter (adopted) | Always windows | Near that point the windows cost as much as the whole |
| Splice, then re-align | The verdict comes from the unchanged rules over merged words (adopted) | Let the second model overrule a region directly | One set of rules; the result is reproducible from cached words |
| Model and staleness | Keep Q13 (ADR 0128) | Put the model pair in the parameter hash | A better re-check should not make older results stale |

## Research Summary

**Technical context**: verified on `main` at dd006030: the check's flow from `CoverageStart` to the stored result, the words cache and its key, the parameter hash and Q13, the region position, the sidecar's one-load slice transcription and its timeline, the settings and their label, and the wire contracts. **Measured on 2026-09-23**: the four-model comparison on a second Piper take and the window benchmark, on one machine. **Not verified**: any real narration; a GPU; a slower laptop.

---

*Generated: 2026-09-23*
*Status: IN PROGRESS - open questions MC1 to MC7 answered (2026-09-23); Phase 2 complete*
