# Editing readiness: the corpus, the labeling format and the evaluation harness

**Status: synthetic baseline only, 2026-09-27.** This is Phase 1 of
[`editing-readiness-analysis.prd.md`](../prds/editing-readiness-analysis.prd.md) ("Editing corpus and evaluation
harness"): no product code, a labeling format, a corpus plan, synthetic generators, and a Go harness that scores
[DX Phase 9's cleanup detector](../../apps/desktop/internal/measure/cleanup.go) (`measure.CleanupFindings`'s own
candidates: silence, click, breath) against labeled locations. Every number below is from the **committed synthetic
corpus only** (D70): no permissioned narrator audio exists yet, so, per D12, no threshold here is a fact. A real run
is a QA item on [#510](https://github.com/countrymanprime/narration-utils/issues/510), tracked until it happens.

## The labeling format

A CSV, one row per labeled location, header `source,start_seconds,end_seconds,class,split,note`
(`apps/desktop/internal/editing/labels_test.go`, `ParseCorpusLabels`/`WriteCorpusLabels`):

| Column | Meaning |
| --- | --- |
| `source` | The audio file's name (or path relative to the corpus directory) the row labels. |
| `start_seconds`, `end_seconds` | The labeled span, in that source file's own seconds. `end` must be after `start`. |
| `class` | One of `silence_to_trim`, `click`, `breath` (positive: a genuine editing chore) or `keep_pause`, `keep_breath` (negative: a location the narrator kept on purpose - Phase 1 Scope's "negative labels for intentional pauses and kept breaths"). |
| `split` | `tune` or `held_out` (ADR 0125's own precedent for a `tune \| held_out` column), so one directory holds both halves. |
| `note` | Free text: provenance, or why a location is a marginal call. Never parsed. |

A `keep_pause` row never subtracts from `silence_to_trim`'s recall, and `keep_breath` never subtracts from `breath`'s:
they only ever count against that class's **precision**, when a candidate overlaps them (Q4/Q7: a candidate blocks
regardless of confidence, and dismissal - never suppression - is the exit). `click` has no negative class; nothing in
Phase 1 Scope calls for one.

## The corpus

**Real audio (D70/D71, Q10 option A+synthetic):** a permissioned narrator's own chapters are the ground truth, from at
least two narrators or rooms, at least 25 labeled locations per class (proposed, assumption per the PRD), raw and
edited versions of the same chapters where available (the edited cut marks exactly what an editor removed). Per D71,
**LibriVox** is the default source for real speech when the owner's own material is not yet available: public domain,
many readers, solo readings with one reader voicing several characters. A corpus built from it must record, per
recording, the LibriVox URL, the reader, the book, and the public-domain statement (its catalog page states this for
every recording) - in `note`, or in a `provenance.md` alongside `labels.csv` in the same directory. The audio itself
never enters this repository: `NARRATION_EDITING_CORPUS` names the directory (mirroring
[ADR 0125](../adr/0125-recording-coverage-ground-truth-is-scripted-recordings-with-paragraph-labels-and-a-corpus-directory-variable.md)'s
`NARRATION_COVERAGE_CORPUS`), holding the WAV files `labels.csv` names plus `labels.csv` itself (also not committed,
since it names and times real recordings). `TestClassRecallPrecisionOnRealCorpus`
(`apps/desktop/internal/editing/harness_test.go`) skips cleanly when the variable is unset, so `pnpm check` never
needs the corpus to be present.

**Synthetic audio (committed, unit tests only):** `apps/desktop/internal/editing/syntheticcorpus_test.go` generates
four short WAV cases (two `tune`, two `held_out`; 8000 Hz mono, every segment length a whole multiple of 10 ms so it
lands exactly on the detector's own window boundaries), each built from a sequence of segments - speech (a tone, long
enough to establish a speech level), a trimmable gap, a breath-like noise burst, a click-like impulse with true-silence
flanks, a long "meant" pause (`keep_pause`), and a kept breath (`keep_breath`, acoustically identical to the real one
by design: the detector cannot yet tell the two apart, which is exactly the point being illustrated, not a bug). Labels
are derived from the running sample count as each segment is rendered, so they can never drift out of sync with the
audio (`TestSyntheticCorpusLabelsMatchAudio`). Per Q10's recommendation, **this is not a validation**: it proves the
harness runs and regresses if the detector or the matching logic breaks, nothing about real narration.

## The harness

`apps/desktop/internal/editing/harness_test.go` calls `measure.DiagnoseFile` (the same entry point DX Phase 9's own
findings use) on each labeled source, whole-file (Phase 1 scores source audio, not played ranges - Phase 2's own
scope), and matches its `Cleanup.Candidates` against the split's labels: each candidate and each label match at most
once, a positive label unmatched is a false negative, a leftover candidate matching a negative label is a false
positive "against an intentional label", and any candidate matching nothing at all is an unexplained false positive.
Overlap allows 50 ms of tolerance on the synthetic corpus and 100 ms on a real one (Phase 1 Scope: "within a labeled
tolerance").

```bash
cd apps/desktop
go test ./internal/editing/... -run 'TestClassRecallPrecisionOnSyntheticCorpus|TestSensitivitySweepOnTuningHalf' -v

# once a permissioned corpus exists:
NARRATION_EDITING_CORPUS=/path/outside/the/repo go test ./internal/editing/... -run TestClassRecallPrecisionOnRealCorpus -v
```

`TestSensitivitySweepOnTuningHalf` sweeps a couple of `measure.CleanupOptions` values (a stricter breath threshold, a
stricter click threshold) on the **tuning half only**, printing the same per-class table at each setting - Phase 1
Scope's "sensitivity sweep on a tuning half". It picks nothing: choosing values from a sweep like this on real data is
Phase 4's job (click and breath validation), gated separately.

## Baseline: the synthetic corpus, default thresholds (2026-09-27)

`measure.DefaultDiagnosticOptions()` and `measure.DefaultCleanupOptions()` (both already shipped, DX Phases 1 and 9),
50 ms tolerance:

| Class | Split | Recall | Precision | Notes |
| --- | --- | --- | --- | --- |
| `silence_to_trim` | tune | 1.00 (2/2) | 0.50 (2/4) | 2 of the 4 raised candidates are the `keep_pause` location, correctly flagged as "may be meant" (`cleanup.go`'s own reduced-confidence branch) but still counted, per Q4 |
| `silence_to_trim` | held out | 1.00 (2/2) | 0.50 (2/4) | same shape |
| `click` | tune | 1.00 (2/2) | 1.00 (2/2) | no negative class exists for click |
| `click` | held out | 1.00 (2/2) | 1.00 (2/2) | |
| `breath` | tune | 1.00 (2/2) | 0.50 (2/4) | 2 of the 4 raised candidates are the `keep_breath` location - acoustically indistinguishable from a real breath by design |
| `breath` | held out | 1.00 (2/2) | 0.50 (2/4) | same shape |

Sensitivity sweep (tuning half only): a stricter click threshold (`ClickAboveSilenceDB` 40 instead of 30) changes
nothing here (the synthetic click sits at full scale against true silence). A stricter breath threshold
(`BreathBelowSpeechDB` 18 instead of 12) drops the synthetic breath's recall to 0/2, because its fixed level was chosen
to sit inside the *default* window, not every window a sweep might try - a reminder that a sensitivity sweep's numbers
depend on where the corpus's own examples sit relative to the swept setting, which is exactly why Phase 4 needs real
recordings spanning a range of levels, not a handful of synthetic points.

**Read this as:** the detector finds every unambiguous synthesized event (recall 1.0 across all three classes,
gated as a regression check in `TestClassRecallPrecisionOnSyntheticCorpus`) and, exactly as expected, also flags the
two locations a narrator would keep (silence and breath precision at 0.50) - the asymmetry Q4 accepts on purpose ("a
false 'done' is worse than a false 'not done'... a dismissal is paid for once"). None of this says anything about the
Success Metrics' proposed 90% recall target, which is scored on real narration, held out, once it exists.

## Limits

- **No real audio yet.** Every number above is synthetic. Real speech has plosives before breaths, soft onsets, room
  tone that shifts through a chapter, and clicks that sit closer to speech level than a clean impulse against true
  silence - all named as risks in the PRD's Technical Risks table, none of them exercised here.
- **Four cases, not a corpus.** This is a regression guard, not a sample large enough to estimate a rate (compare
  [the recording-coverage calibration note](recording-coverage-calibration.md)'s own "counts, not rates" limit).
- **A real corpus replaces this note's numbers.** Point `NARRATION_EDITING_CORPUS` at a permissioned corpus built per
  D70/D71 (LibriVox or the owner's own chapters, `labels.csv` in the format above, audio and labels both outside the
  repo), run `TestClassRecallPrecisionOnRealCorpus`, and record the held-out numbers, the corpus's conditions (how many
  narrators or rooms, how many labeled locations per class) and the source provenance here. Until then the click and
  breath signals stay gated `unknown` regardless (Phase 4, Q5's validated-version gate; see
  [editing-click-breath-validation.md](editing-click-breath-validation.md) for Phase 4's run and the gate's rule) -
  this note's job is only to prove the harness that will decide that gate actually works.
