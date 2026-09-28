# Editing readiness: click and breath validation

**Status: provisional (D70), 2026-09-28. Both classes ship gated off.** This is Phase 4 of
[`editing-readiness-analysis.prd.md`](../prds/editing-readiness-analysis.prd.md) ("Click and breath validation"). It runs
[DX Phase 9's click and breath detectors](../../apps/desktop/internal/measure/cleanup.go) (exercised, not changed; DX-9
owns them) on a tuning half, chooses the scan defaults there, and reports precision and recall on a held-out half per
class and recording condition. Neither class reaches the proposed 90% recall, so both `editing.clicks` and
`editing.breaths` stay `unknown` ("not validated yet") for every analyzer version. No permissioned narrator audio is on
`main` (the Alice corpus, #836, is not merged), so the corpus is synthetic, and per Q10 a synthetic run could not
validate a detector even at 100%. The real run is a QA item on
[#510](https://github.com/countrymanprime/narration-utils/issues/510). Decisions:
[ADR 0510](../adr/0510-click-and-breath-signals-open-only-on-a-recorded-permissioned-held-out-run-at-target-in-every-condition.md)
and [ADR 0511](../adr/0511-click-and-breath-sensitivity-is-a-scan-parameter-and-its-defaults-only-move-toward-more-candidates.md).

## The corpus

[`validationcorpus_test.go`](../../apps/desktop/internal/editing/validationcorpus_test.go) generates it in code and
writes it in Phase 1's labeling format ([editing-corpus-and-harness.md](editing-corpus-and-harness.md)), with a tuning
split and a held-out split built from different seeds. Phase 1's four clean cases placed every event where the default
thresholds catch it. This corpus is built to find failures instead: levels are drawn at random over a realistic range,
and every event sits in one of four recording conditions.

| Condition | Room tone (peak) | Speech (peak) | What it tests |
| --- | --- | --- | --- |
| `studio` | digital silence | -14 dBFS | the easy case |
| `room_tone` | -62 dBFS | -14 dBFS | a treated home booth |
| `noisy_room` | -44 dBFS | -14 dBFS | room tone just above the detectors' absolute -50 dBFS silence floor |
| `quiet_read` | -62 dBFS | -28 dBFS | a soft read, whose quietest breaths fall under that floor |

Each condition has 2 files per split. Each file holds every hard case twice, in a seeded random order, between runs of
speech (a tone):

| Hard case | Label | Built as |
| --- | --- | --- |
| breath | `breath` | noise, 200-500 ms, 8-28 dB under the speech peak |
| breath after a plosive | `breath` | a 20 ms burst at speech level, then the breath at once |
| click in a pause | `click` | noise, 10-30 ms, -18 to 0 dBFS, with 80-150 ms of pause on each side |
| click near an onset | `click` | a 10 ms click, then 30 ms of pause, then the word |
| kept breath | `keep_breath` | a breath the narrator keeps: a candidate on it counts against precision |
| soft onset | none | a 250 ms pause, then a quiet fricative 14-22 dB under speech before the word |
| plosive release | none | a 60 ms stop closure, a 20 ms burst, then a pause |

That gives 32 labeled clicks and 32 labeled breaths per split, past the PRD's proposed 25 per class
(`TestValidationCorpusShape`). Speech is a tone, so it has none of the fricatives, sibilants or mouth noise inside
words that real narration has. Real audio will do worse than this, not better.

## Tuning half: choosing the defaults

Each class has one sensitivity knob. The sweep varies it around DX's default and holds everything else at DX's defaults
(`TestShippedDefaultsAreTheTuningHalfChoice`). The selection rule favors recall, because a missed click or breath is the
false-"done" risk:

1. Take the highest recall.
2. Among those, keep only values at least as sensitive as DX's default. A precision gain measured on synthetic audio is
   no reason to raise fewer candidates on real audio.
3. Then take the highest precision.
4. Then the value nearest DX's default.

| Knob | Values tried | Tuning result | Chosen |
| --- | --- | --- | --- |
| `ClickAboveSilenceDB` | 20, 25, 30, 35, 40 | recall 0.38 (12/32) at every value; precision 0.50 up to 35, 0.60 at 40 (it drops the plosive releases in the quiet read) | **30**, DX's default (rule 2 excludes 35 and 40) |
| `BreathBelowSpeechDB` | 6, 8, 10, 12, 15 | recall 0.84 at 6 and 8, 0.72 at 10, 0.62 at 12, 0.53 at 15; precision 0.48, 0.48, 0.45, 0.44, 0.41 | **8** (DX ships 12), the nearer of the two tied values |

At DX's 12 dB, breaths 8 to 12 dB under the speech peak are missed. Those are the loud breaths a narrator most wants
caught. `editing.DefaultScanOptions()` now scans with 8 dB. It is used whenever the host passes no scan options, which
the app does today.

## Held-out half: results

Scored at the chosen defaults, with 50 ms of matching tolerance (`TestRecordedValidationsAreTheHeldOutRun`, which fails if
these numbers stop matching the recorded runs in [`validation.go`](../../apps/desktop/internal/editing/validation.go)).
The target is the PRD's proposed 90% recall per class.

| Class | Condition | Recall | Precision | Notes |
| --- | --- | --- | --- | --- |
| click | studio | 0.50 (4/8) | 0.50 (4/8) | every click near an onset missed; every plosive release raised |
| click | room_tone | 0.50 (4/8) | 0.50 (4/8) | the same |
| click | noisy_room | 0.00 (0/8) | none raised | room tone is above the floor, so no click has a silent flank |
| click | quiet_read | 0.50 (4/8) | 0.50 (4/8) | the same as studio |
| **click** | **all** | **0.38 (12/32)** | **0.50 (12/24)** | **target 0.90: not met** |
| breath | studio | 1.00 (8/8) | 0.50 (8/16) | 4 on kept breaths, 4 on soft onsets |
| breath | room_tone | 1.00 (8/8) | 0.53 (8/15) | |
| breath | noisy_room | 1.00 (8/8) | 0.35 (8/23) | room tone between words reads as breaths |
| breath | quiet_read | 0.38 (3/8) | 0.60 (3/5) | quiet breaths fall under the absolute -50 dBFS floor |
| **breath** | **all** | **0.84 (27/32)** | **0.46 (27/59)** | **target 0.90: not met** (and missed badly in one condition) |

Precision is reported for completeness. It does not gate: Q4 makes every open candidate block, and a false candidate
costs one dismissal.

## Failures found, each with a fixture

`TestDetectorFailureFixtures` rebuilds each failure on its own and pins what the shipped detector does. When DX Phase 9
fixes one, the test fails on purpose. The fix is then a new analyzer version with a new recorded run, never an edited
number.

| Fixture | An editor cuts it | Detector | Why |
| --- | --- | --- | --- |
| click inside a pause of room tone | yes | finds it | (named hard case, passes) |
| breath right after a plosive | yes | finds it | (named hard case, passes) |
| mouth click 30 ms before a word | yes | **misses** | a click needs 5 silent 10 ms windows on each side |
| click in a pause of a noisy room | yes | **misses** | the silence around it is above the absolute -50 dBFS floor |
| plosive release after a stop closure | no | **raises a click** | a closure gives the burst a silent flank on one side and a pause gives the other |
| soft fricative onset after a pause | no | **raises a breath** | quiet and noise-like, of breath length: identical to a breath by level and zero crossings |
| loud breath 6 dB under the speech peak | yes | **misses** | even the chosen 8 dB needs a breath further under speech |
| quiet breath in a quiet read | yes | **misses** | below the absolute floor, so read as silence |

What would move the numbers is DX-9's to decide, not this phase's. The run points at three things:

- a silence floor relative to the read's own noise floor (the PRD's Q8 recommendation B) rather than an absolute -50
  dBFS;
- a click test that needs a short silent flank on one side only, or one based on spectral flatness or crest factor;
- a breath test that looks at spectral shape, not just zero crossings.

## What the product does with this

- **Analyzer versions.** `editing.click` and `editing.breath` ledger records are stamped with their own versions,
  `editing-click-v1` and `editing-breath-v1`. Each carries only its own count. The cache key includes all three
  classes' versions, so a new version of any one re-decodes, and that class's records alone read stale.
- **The gate.** `IsValidated` opens only for a recorded run of exactly that analyzer and version, on a permissioned
  corpus, at 90% recall overall and in every condition. `ClassSignal` checks the gate first. An unvalidated version is
  `unknown` whatever the scan found. It still lists its open candidates and a "Detector" evidence line with the recorded
  run. `TestClassSignalGateTurnsAnUnvalidatedVersionUnknown` shows the same clean, covered input reading `met` under a
  validated version and `unknown` under any other.
- **Candidates.** A scan now persists click and breath candidates as `silence_cleanup` findings, with project time,
  source range, and the class's analyzer version. The evidence version covers the source file, class and source range
  only (Q7). The editing check panel lists them for review. Without persisted findings, a validated signal would have
  read `met` with candidates unsaved.
- **Sensitivity** stays a scan parameter (part of the parameter hash), not a read-time filter. The PRD makes a filter
  conditional on "scores separate cleanly". The detectors give fixed confidences (0.35, 0.5, 0.6), not a continuous
  score, so there is nothing to filter on.

## Re-running on real audio

Build a permissioned corpus per D70/D71 ([editing-corpus-and-harness.md](editing-corpus-and-harness.md): `labels.csv`
plus WAVs outside the repo, at least two narrators or rooms, at least 25 labeled locations per class and split, and a
note of each file's condition), then run Phase 1's real-corpus test:

```bash
cd apps/desktop
NARRATION_EDITING_CORPUS=/path/outside/the/repo go test ./internal/editing/... -run TestClassRecallPrecisionOnRealCorpus -v
```

It scores at DX's defaults; to score at the Phase 4 defaults, and per condition, point `scoreByCondition`
(`validationrun_test.go`) at the corpus with `DefaultScanOptions().Cleanup`. A class opens only when a `permissioned`
record in `validation.go` reaches 90% held-out recall overall and in every condition. That change is made by hand,
next to the run's numbers in this note, and reviewed; `TestShippedDetectorsAreGatedOff` fails until it is updated on
purpose.

## Limits

- **Synthetic only.** Speech is a tone. Breaths and clicks are shaped noise. Every number here is provisional (D70),
  and Q10 says so plainly: synthetic breaths and clicks are not a validation.
- **Counts, not rates.** Eight events per class per condition per split is enough to show a failure mode, not to
  estimate a rate to two digits.
- **Source audio.** Like the whole check, this reads source files. Take FX, gain and fades are not applied.
