# 0132. The recording check ships 0.8, 3, 8 and 3, chosen on synthetic fixtures and labelled uncalibrated

- **Status:** Proposed
- **Date:** 2026-09-23

## Context and problem

The recording check has four settings (Q3): `min_paragraph_present` and `max_missing_run` are thresholds applied on
read, and `max_misread_run` and `min_anchor_run` are alignment parameters
([ADR 0126](0126-recording-coverage-reads-the-take-markers-sequencematcher-alignment-and-folds-chance-matches-into-gaps.md),
[ADR 0131](0131-the-recording-signal-is-read-from-stored-checks-with-thresholds-applied-on-read-and-alignment-from-settings.md)).
The owner answered Q3 with starting values of 0.95, 3, 8 and 3. The rule for shipping them (D12) was that no default
ships until it has been scored against labelled chapters, with zero incomplete chapters called complete on held-out
cases. Q15 then replaced the owner-supplied corpus with synthetic fixtures
([ADR 0125](0125-recording-coverage-ground-truth-is-scripted-recordings-with-paragraph-labels-and-a-corpus-directory-variable.md)),
so whatever ships stays labelled uncalibrated.

The synthetic fixtures have a perfect transcript, and the Proposed values pass every case when the transcript is
perfect. The open questions were how the values hold up when the transcriber makes mistakes, and whether the fixtures
could tell a loose setting from a tight one at all. At first they could not: every omission in them was a whole
sentence or paragraph, so a candidate allowing 8 missing words in a row still had no false "met".

## Decision drivers

- D12: no default ships until it has been scored against labelled chapters, with zero incomplete chapters called complete on held-out cases.
- Q15 replaced the owner-supplied corpus with synthetic fixtures, so whatever ships stays labelled uncalibrated.
- The owner's starting values for Q3: 0.95, 3, 8 and 3.
- The values have to hold up when the transcriber makes mistakes, and the fixtures have to tell a loose setting from a tight one.

## Considered options

1. 0.8, 3, 8 and 3, chosen by a fixed rule over a calibration sweep
2. The Proposed values, 0.95, 3, 8 and 3
3. A `min_anchor_run` of 2

## Decision outcome

**Chosen option: 0.8, 3, 8 and 3, chosen by a fixed rule over a calibration sweep**, because of the candidates with no false "met", it calls the most complete `tune` chapters complete, and is then the closest to the Proposed values.

- **The defaults are 0.8, 3, 8 and 3** (`min_paragraph_present`, `max_missing_run`, `max_misread_run`,
  `min_anchor_run`), in `config/defaults.json`, the settings store's built-in defaults, `coverage.DefaultSettings` and
  the sidecar's own defaults (`recording_coverage.py`).
- **They were chosen by a fixed rule over a sweep** (`sidecars/transcript-compare/tests/coverage_calibration.py`). The
  sweep runs 600 candidates over 171 cases through the shipped sidecar path, at five levels of simulated transcriber
  error (words dropped, swapped and dropped in bursts). The rule keeps only safe candidates: no false "met" on the
  `tune` cases at any noise level, and no chance-matched word credited in a paragraph replaced by unrelated speech. Of
  those it takes the one that calls the most complete `tune` chapters complete, then the one closest to the Proposed
  values.
- **The fixtures gained resolution cases** that encode Q3's resolution. A phrase of 4 or 6 words is left out, or 9
  words are said as unrelated speech, in the middle of a paragraph. These cases are what bound `max_missing_run` at 3
  and `max_misread_run` at 8: one word more on either lets such a phrase through. Omissions of 1 to 3 words are below
  the check's resolution on purpose, because they cannot be told apart from a transcriber dropping a word.
- **`min_paragraph_present` moves from 0.95 to 0.8.** It is the setting that decides how much transcriber error the
  check tolerates. At 0.95, one dropped word in a 20-word paragraph fails a complete chapter: under light noise, 7 of 35
  complete `tune` chapters failed. At 0.8 none failed, and false "met" stayed at zero, because `max_missing_run`
  catches every real omission at the resolution. 0.8 is the floor of the grid on purpose. Below it, a paragraph could
  lose a fifth of its words in short gaps and still pass, and no fixture tests that.
- **`min_anchor_run` stays 3.** A value of 2 passes slightly more noisy chapters, but it credits common word pairs
  inside unrelated speech, which fails the PRD's chance-match metric.
- **Result:** zero false "met" on the 70 held-out cases at every noise level, and no false "not met" at the none and
  light levels. The Piper renders of the 16 committed cases, run through the real sidecar with `small` and `tiny`, give
  16 of 16 right with both models at both the Proposed and the shipped values.
- **The label stays.** The Settings page still says "Proposed values, not yet calibrated". It now adds that the values
  were chosen on synthetic test recordings and have not been checked against real ones. This ADR stays Proposed until
  a permissioned corpus (`NARRATION_COVERAGE_CORPUS`) confirms or replaces the values.

### Consequences

- **Good:** A narrator with an existing check sees a verdict computed with the new share at once. The threshold is applied on
  read, so nothing is transcribed and no result goes stale. The alignment parameters did not change, so no stored check
  goes out of date.
- **Neutral:** A narrator's own saved values are untouched. Only the built-in defaults changed.
- **Bad:** A skipped phrase of 3 words or fewer can pass. This was already true of the Proposed values, and it is now stated
  as the check's resolution on the Settings page's rule and in the recording check page.
- **Neutral:** The measurements, the sensitivity of each setting and the time budget (about 10 s of CPU per audio minute with
  `small`, and 2 s with `tiny`, on the machine measured) are in
  [the calibration note](../research/recording-coverage-calibration.md). The comparison with a larger model (Q7) is
  still to run: it needs a download the owner approves.
- **Good:** Recalibrating is one command: `coverage_calibration.py synthetic`, run over a corpus that has more cases. A pytest
  pins the shipped values to `config/defaults.json`, the held-out result at every noise level, and the resolution
  bound, so a change to the aligner that breaks any of them fails `pnpm check`.

### Confirmation

A pytest pins the shipped values to `config/defaults.json`, the held-out result at every noise level, and the resolution bound, so a change to the aligner that breaks any of them fails `pnpm check`.

## Pros and cons of the options

### The Proposed values, 0.95, 3, 8 and 3

- Bad, because at 0.95 one dropped word in a 20-word paragraph fails a complete chapter: under light noise, 7 of 35 complete `tune` chapters failed.

### A `min_anchor_run` of 2

- Good, because it passes slightly more noisy chapters.
- Bad, because it credits common word pairs inside unrelated speech, which fails the PRD's chance-match metric.
