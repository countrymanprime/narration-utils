# 0575. The LibriVox signal set is a second click evaluation, split by pause, that reports and never opens the gate alone

**Status:** Proposed (editing-readiness-analysis PRD Phase 4 follow-up, stream N-K12; the owner decides on #510 whether a LibriVox reading counts toward ADR 0510's bar, and the run itself is pending there)
**Date:** 2026-09-28
**Supersedes:** none. It adds a second evaluation set beside [ADR 0510](0510-click-and-breath-signals-open-only-on-a-recorded-permissioned-held-out-run-at-target-in-every-condition.md)'s synthetic run and keeps [ADR 0511](0511-click-and-breath-sensitivity-is-a-scan-parameter-and-its-defaults-only-move-toward-more-candidates.md)'s defaults.

## Context

Phase 4 validated the click and breath detectors on synthetic audio only, and both ship gated off (38% and 84%
held-out recall against 90%). The LibriVox Alice corpus ([ADR 0416](0416-librivox-readings-of-the-demo-script-are-fetched-from-archive-org-and-only-their-markers-and-recipes-are-committed.md))
is now on `main`. Its `signal/` set is 3.8 minutes of Kara Shallenberg's Chapter IX in 11 cases: an unedited control
and one defect each. Three cases hold clicks: 4 at -6 dBFS peak in the middle of a pause, 3 at -24 dBFS, and 1 at the
cut next to a breath. Each is a 2 ms decaying 3 kHz burst added to the real audio, so the room tone, breaths and mouth
noise around every click are real, but the click itself is not. Two of the eight carry a `knownIssue`: the builder
records that DX-9's detector misses them. No case labels a breath.

The synthetic corpus splits by file. This set is one reading, so a split by file would put each condition in only one
half.

## Decision

1. **The set runs through Phase 4's own harness.** `TestClickBreathOnLibriVoxSignalCorpus`
   (`apps/desktop/internal/editing/librivoxvalidation_test.go`) uses the synthetic run's matching (`scoreSource`, 50 ms
   tolerance) and its selection rule (`chooseConservative`). It is skipped unless `NARRATION_SIGNAL_CORPUS` names a
   built corpus, the same variable `measure`'s `TestLibriVoxSignalCorpus` reads.
2. **The split is by pause, and a condition is a case.** Within each case the clicks, in time order, alternate
   held-out, tune, held-out and so on. Starting on held-out keeps a one-click condition, the click beside a breath, in
   the half that is reported. That gives 5 held-out and 3 tuning clicks.
3. **It reports and never tunes.** The tuning half's choice of `ClickAboveSilenceDB` is logged next to the shipped
   value and is never applied. Changing a default because this set prefers it would tune the detector to pass. Precision
   is taken per case rather than per half, because both halves share each file's candidates. The unedited control's
   candidates at the same time are counted separately: they are the reader's own sounds, or the same false positive.
4. **It cannot open the gate alone.** Even at 100%, this set is under the bar: fewer than 25 clicks per half, clicks
   that are inserted rather than the reader's own, and no breath labels. With the two known misses, click recall is at
   most 0.75 until DX-9 fixes them. The test fails only on a broken corpus or a stale `knownIssue`. A class that one day
   meets 90% in every condition on both the synthetic set and a real-speech set gets its own Proposed ADR, which records
   the run in `recordedValidations`. This ADR does not open anything.

## Consequences

- The run is reproducible by anyone who can fetch the recordings, and its result goes in the research note next to the
  synthetic one. Until it is run, the note says pending, and it does not predict the numbers.
- For the owner (#510):
  - Does a LibriVox reading count as the "permissioned" corpus in ADR 0510? The recommendation is yes for real speech:
    it is public domain and D71's default source. The owner's own re-run still comes before either class ships (D70).
  - Breath labels need someone to listen, so they are an owner or maintainer task. A `breaths` recipe could mark them
    once they are placed.
  - More clicks, and the reader's own mouth clicks, would take the set past 25 per half.
