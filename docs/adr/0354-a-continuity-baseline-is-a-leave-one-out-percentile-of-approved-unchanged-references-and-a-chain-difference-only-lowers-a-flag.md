# 0354. A continuity baseline is a leave-one-out percentile of approved, unchanged references, and a chain difference only lowers a flag

**Status:** Accepted (thresholds provisional, D70/D71: the real-corpus re-run is a QA item on #510)
**Date:** 2026-09-28

## Context

`docs/prds/character-continuity-review.prd.md` Phase 5 turns the Phase 4 features (ADR 0348) into `character_continuity` findings. The Phase 1 trial (`docs/research/character-continuity-acoustic-trial.md`) calibrated Q6 provisionally: at least 3 approved clips per character, and an outlier threshold at the reference distribution's own 90th percentile of same-character distance, computed per narrator and character, with the false-reject / false-accept trade-off exposed rather than hard-coded. The PRD also asks for a recording-chain check that "lowers confidence instead of raising a drift flag", narration as a reference subject whose distance each finding shows (Q9, recommendation A), and evidence versions so a dismissed line stays dismissed for identical evidence.

The trial left several details open that a shipped rule has to settle: what a reference is compared against when computing its own distance, how to standardize features, what happens when references measure nearly identically, and whether a chain difference yields no finding or a lesser one. TR-3's persisted aligned words, which the PRD's Q8 names as how a dialogue cue is located in audio, do not exist yet, and no PRD file for them is in the repository.

## Decision

A new package, `apps/desktop/internal/continuity`, holds the baseline builder, candidate locator, outlier rule, chain check and findings adapter. It depends on four roles, never on concrete adapters: `ReferenceSource` (`character.Service`), `ReferenceAudio` (`SavedProjectAudio` over the saved `.rpp`), `CueAligner` and `ClipMeasurer` (`FileMeasurer` over `acoustic` and `measure`).

- **Only approved, unchanged references form a baseline.** A reference whose region changed since approval is excluded before its audio is read; one whose region is not covered by exactly one item's WAV take, or whose audio has no measurable pitch, is excluded with its reason. Nothing is guessed.
- **Standardization** pools every usable reference in the project (characters and narration) into one mean and standard deviation per feature, as the trial did. A feature's deviation is floored at 1% of its mean magnitude, so a feature that barely varies across references does not turn a small change into many standard deviations.
- **The threshold** is the `Rule.Percentile` (default 90) of leave-one-out distances: each reference against the median of the others, so a reference is never measured against a baseline it helped build. It is floored at 0.5 pooled standard deviations (the trial's same-character median was 0.91), so a set of near-identical references does not flag every small difference. `Rule` is a value the caller sets; lowering the percentile tightens the threshold.
- **Below `Rule.MinReferences` (default 3)** a subject has no baseline, its lines are skipped as "insufficient reference", and the result says how many usable clips it has.
- **A candidate** is a dialogue cue attributed to a character (never `unknown`, never narration), reliably aligned by the `CueAligner`, at least 0.5 s long and with measurable pitch. Everything else is reported as skipped with a reason. Until TR-3 lands, production has no aligner, so nothing is flagged; Q8 is answered with option A through the port.
- **The chain check** compares the line's noise floor and RMS level with its references'. More than 6 dB outside the references' range reads as "recording chain may differ". It never raises a finding: an in-voice line with a chain difference raises nothing, and an outlier with one is reported at `info` severity with its confidence halved and its reason saying so, instead of as a `warning`.
- **A finding** carries the reference ids, a per-feature table (value, reference median, min, max, standardized difference, sample size), the distance and threshold, the narration evidence (distance and whether the line is within the narration reference, or why that is unavailable), the chain check and the confidence reason. Confidence is the reference count over 5 (capped at 1) times one minus the line's octave-ambiguous fraction. Its id is `StableID(analyzer, cue id, character id)`, and its evidence version hashes the analyzer and feature versions, the line's audio range and rounded measurements, the baseline's reference ids, medians and threshold, and the rule, so a re-run on the same evidence keeps a decision while a re-recording or an approve, revoke or re-approve re-opens it. `Save` writes one full run per chapter to the findings store. The only suggested action is `audition_reference`, which changes nothing.

## Consequences

- Only approved regions can affect a baseline, and the rule is testable without audio: the package's tests set features directly, and a synthetic tone checks `FileMeasurer`.
- The 3-clip minimum, the 90th percentile, the 0.5 floor, the 6 dB chain limit and the 0.5 s line minimum are all provisional. They need the real-corpus re-run before they ship to narrators, and changing any of them means bumping `continuity.AnalyzerVersion`.
- Until an aligner exists, Phase 5 produces no findings in the app. Phase 6 wires the package into a binding once TR-3's aligned words, or an equivalent, can locate a cue.
- A different distance, standardization or chain rule needs a new ADR that supersedes this one.
