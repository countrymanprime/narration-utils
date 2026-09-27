# 0329. Editing-readiness ground truth is a labeled CSV over whole files, scored against DX Phase 9's shipped detector, and a real corpus plugs in through a directory variable

**Status:** Proposed
**Date:** 2026-09-27

## Context

[`editing-readiness-analysis.prd.md`](../prds/editing-readiness-analysis.prd.md)'s D12 allows no click or breath signal
to report `met` until it is validated against an annotated corpus (Phase 4), and no threshold anywhere in the PRD is a
fact before then. Phase 1 ("Editing corpus and evaluation harness") has to exist first: a labeling format, a corpus
plan, and a Go harness that measures recall and precision per class, before there is anything for Phase 4 to validate.
No permissioned narrator audio exists in this repository as of this writing (owner decision D70/D71: development
audio comes from LibriVox or synthetic data, real recordings are a later QA item on
[#510](https://github.com/countrymanprime/narration-utils/issues/510)), and `recording-coverage-analysis.prd.md` faced
the identical problem for its own corpus, settled by
[ADR 0125](0125-recording-coverage-ground-truth-is-scripted-recordings-with-paragraph-labels-and-a-corpus-directory-variable.md).
Unlike that PRD's text-only ground truth (scripted transcripts, no audio needed because its analyzer works on ASR
words), editing's three chores - empty space, clicks, breaths - can only be measured from real acoustic signal, so
the same shape of answer (committed synthetic fixtures, a real corpus through a directory variable, never audio in
git) needs a different mechanism underneath it.

Separately, `apps/desktop/internal/measure/cleanup.go` (DX Phase 9's "silence cleanup analyzer") already ships a
complete, already-shipped detector for all three classes (`CleanupSilence`, `CleanupClick`, `CleanupBreath`) via
`measure.DiagnoseFile`, ahead of that PRD's own remaining wiring (settings keys, the diagnostics job, the findings
list) and ahead of this PRD's Phase 4 validation. Phase 1 could have stubbed the detector out and scored nothing real,
per its own Success Signal's "or a stub" - but a stub would prove only that the harness's plumbing runs, not that it
measures anything true.

## Decision

Phase 1's ground truth is a CSV, one labeled location per row: `source,start_seconds,end_seconds,class,split,note`,
`class` one of `silence_to_trim`, `click`, `breath` (positive) or `keep_pause`, `keep_breath` (negative: a location
kept on purpose, counted only against precision, never against recall), `split` one of `tune`, `held_out`. The format
and its parser/writer live in `apps/desktop/internal/editing/labels_test.go` - test-only, since Phase 1 adds no
product code.

The harness (`apps/desktop/internal/editing/harness_test.go`) scores **whole source files** through
`measure.DiagnoseFile` directly (not `editing.Decode`'s played-range scoping, which is Phase 2's own concern) against
DX Phase 9's **real, already-shipped `CleanupFindings` candidates** - the actual detector this PRD's Phase 4 will
later validate, never a hand-rolled stand-in. Matching allows a labeled tolerance and never double-counts a label or
a candidate across positive and negative accounting.

A real, permissioned corpus (D70/D71: LibriVox by default, or the owner's own chapters) plugs in through the
`NARRATION_EDITING_CORPUS` directory variable, naming a directory holding the WAV files plus a `labels.csv` in this
same format - mirroring ADR 0125's `NARRATION_COVERAGE_CORPUS` exactly. Neither the audio nor that directory's
`labels.csv` is committed. `apps/desktop/internal/editing/syntheticcorpus_test.go` generates a small, fully committed
synthetic corpus (four cases, every segment length a whole multiple of the detector's own 10 ms window) for the tests
that run in every checkout; its numbers are recorded, marked provisional, in
[`docs/research/editing-corpus-and-harness.md`](../research/editing-corpus-and-harness.md), never treated as a
calibration (Q10: "synthetic generators for unit tests only").

## Consequences

- `pnpm check` exercises the real harness and the real DX-9 detector on every run, with no audio, no model and no
  owner data, the same guarantee ADR 0125 gives its own PRD.
- Because the harness calls the shipped detector directly, a future change to `cleanup.go`'s thresholds or matching
  logic is caught here immediately, before Phase 4 ever needs to reason about it - the harness is a regression guard
  on DX-9 as a side effect, not only a validator-in-waiting for this PRD.
- The Success Metrics' proposed 90% recall target, and any precision number, stay unset for real narration until a
  permissioned corpus exists and `TestClassRecallPrecisionOnRealCorpus` is run against it; this ADR records the
  mechanism, not a number.
- A negative label's asymmetry (never reduces recall, only precision) encodes Q4's "a false 'done' is worse than a
  false 'not done'" directly into the scoring code; a future change to that asymmetry needs a new ADR that supersedes
  this one, and would also need to change Q4's own recommendation.
- Scoring whole files means Phase 1's numbers do not yet reflect played-range scoping (an item's dead air outside its
  `SOFFS`/`LENGTH` is invisible to the real editing check, per Phase 2, but visible to this harness if a labeled
  corpus file were a whole raw take rather than an already-trimmed source). A labeled corpus built from played-range
  audio (or noted as such) avoids this; a future phase scoring played ranges directly would need its own harness
  entry point, not a change to this one.
