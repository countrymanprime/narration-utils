# Recording coverage: calibrating the four settings on the synthetic fixtures

**Status: measured, 2026-09-23.** This note records the calibration that chose the recording check's shipped defaults
([ADR 0132](../adr/0132-the-recording-check-ships-0-8-3-8-3-chosen-on-synthetic-fixtures-and-labelled-uncalibrated.md)).
It uses the [synthetic fixture set](recording-coverage-fixtures.md), because the owner chose constructed fixtures over
an owner-supplied corpus (Q15 in [the recording check's decisions](../utilities/recording-coverage.md#decisions)).
The defaults therefore stay **Proposed** and labelled uncalibrated on real narration until a permissioned corpus exists.

## What ran

`sidecars/transcript-compare/tests/coverage_calibration.py` runs every case the way the host runs a check. The sidecar's
coverage mode (`compare.py --coverage`, `core/coverage_mode.py`) reads a JSON manifest and one words file per item and
writes the tagged result lines. The thresholds are then applied on read by a copy of `coverage.Report.TextComplete`
(`apps/desktop/internal/coverage/report.go`). Scripted cases get their words files written first, so nothing is
transcribed. A test checks that the in-process run and the `compare.py` command line write the same result.

```bash
uv run python sidecars/transcript-compare/tests/coverage_calibration.py synthetic   # the sweep below (about 10 minutes)
uv run python sidecars/transcript-compare/tests/coverage_calibration.py render-audio --voice <piper .onnx> --out <dir outside the repo>
uv run python sidecars/transcript-compare/tests/coverage_calibration.py audio --corpus <that dir> --model small=<model dir> --model tiny=<model dir>
```

### The cases

| Set | Tune | Held out | What |
| --- | --- | --- | --- |
| Committed | 9 | 7 | The 16 Phase 1 cases, with their own split |
| Stress | 62 | 42 | The Phase 2 generated cases (drop, false start, read twice, unrelated speech, misread one word in six, pickup, first sentence dropped) |
| Resolution | 30 | 21 | New: a phrase of 4 or 6 words left out, or 9 words said as unrelated speech, in the middle of every paragraph long enough |
| **All** | **101** | **70** | |

Generated cases are split by chapter. Chapter II and the constructed chapter are held out, so no generated case the
defaults are chosen on shares a chapter with a generated case they are judged on.

The resolution cases are what the check promises to catch. Q3 set that resolution: more than 3 words missing in a row,
or more than 8 words said as other text. The Phase 1 and 2 cases only miss whole sentences and paragraphs. Without the
resolution cases, every candidate up to a missing run of 8 had no false "met", so the sweep could not bound the two
resolution settings. A skip of 1 to 3 words is below the resolution on purpose. It cannot be told apart from a
transcriber that drops a word, so no case asks for it.

### Simulated transcriber error

The synthetic transcripts are perfect. `with_asr_noise` perturbs them, seeded per case and level. A word is dropped with
probability `drop`, or else swapped for a common word ("the", "and", "uh" and so on) with probability `swap`. With
`burst`, a run of words is dropped once every `burst_every` words, like a phrase lost to the voice filter. The labels do
not change, because they describe what the narrator did.

| Level | Drop | Swap | Burst |
| --- | --- | --- | --- |
| none | 0 | 0 | - |
| light | 1% | 2% | - |
| moderate | 3% | 5% | - |
| bursty | 1% | 2% | 3 words every 150 |
| heavy | 5% | 10% | 4 words every 120 |

"Light" is close to what the `small` model made of the Piper renders below. The other levels are margin for real
narration, which is harder than a synthetic voice.

### The grid and the rule

The grid has 600 candidates: `min_paragraph_present` 0.8, 0.85, 0.9, 0.95 or 1.0, `max_missing_run` 0, 1, 2, 3, 4, 5, 6
or 8, `max_misread_run` 4, 6, 8, 10 or 12, and `min_anchor_run` 2, 3 or 4. `choose` applies a fixed rule:

1. **Safe only.** A safe candidate has no false "met" on `tune` at any noise level. It also credits no chance-matched
   word in a paragraph that unrelated speech replaced. That is the PRD's chance-match metric, measured on the perfect
   transcripts.
2. **Then the most complete `tune` chapters called complete,** summed over the five noise levels.
3. **Then the candidate closest to the Proposed values** (0.95, 3, 8, 3).

## Results

168 of the 600 candidates are safe. The rule chooses **0.8, 3, 8, 3**. Only the paragraph share moves, from 0.95 to
0.8.

| Settings | Noise | Split | Cases | False met | False not met | Complete called complete |
| --- | --- | --- | --- | --- | --- | --- |
| Proposed (0.95, 3, 8, 3) | none | tune | 101 | 0 | 0 | 35/35 |
| Proposed (0.95, 3, 8, 3) | none | held out | 70 | 0 | 0 | 24/24 |
| Proposed (0.95, 3, 8, 3) | light | tune | 101 | 0 | 7 | 28/35 |
| Proposed (0.95, 3, 8, 3) | light | held out | 70 | 0 | 4 | 20/24 |
| Proposed (0.95, 3, 8, 3) | moderate | tune | 101 | 0 | 32 | 3/35 |
| Proposed (0.95, 3, 8, 3) | moderate | held out | 70 | 0 | 18 | 6/24 |
| Proposed (0.95, 3, 8, 3) | bursty | tune | 101 | 0 | 30 | 5/35 |
| Proposed (0.95, 3, 8, 3) | bursty | held out | 70 | 0 | 18 | 6/24 |
| Proposed (0.95, 3, 8, 3) | heavy | tune | 101 | 0 | 35 | 0/35 |
| Proposed (0.95, 3, 8, 3) | heavy | held out | 70 | 0 | 23 | 1/24 |
| **Shipped (0.8, 3, 8, 3)** | none | tune | 101 | 0 | 0 | 35/35 |
| **Shipped (0.8, 3, 8, 3)** | none | held out | 70 | 0 | 0 | 24/24 |
| **Shipped (0.8, 3, 8, 3)** | light | tune | 101 | 0 | 0 | 35/35 |
| **Shipped (0.8, 3, 8, 3)** | light | held out | 70 | 0 | 0 | 24/24 |
| **Shipped (0.8, 3, 8, 3)** | moderate | tune | 101 | 0 | 6 | 29/35 |
| **Shipped (0.8, 3, 8, 3)** | moderate | held out | 70 | 0 | 2 | 22/24 |
| **Shipped (0.8, 3, 8, 3)** | bursty | tune | 101 | 0 | 1 | 34/35 |
| **Shipped (0.8, 3, 8, 3)** | bursty | held out | 70 | 0 | 0 | 24/24 |
| **Shipped (0.8, 3, 8, 3)** | heavy | tune | 101 | 0 | 32 | 3/35 |
| **Shipped (0.8, 3, 8, 3)** | heavy | held out | 70 | 0 | 18 | 6/24 |

**False "met" on the held-out cases is 0 at every noise level**, the PRD's shipping gate. Both settings give the same
labels with a perfect transcript:

| Settings | Split | Paragraph labels agreed | Regions located | Same kind |
| --- | --- | --- | --- | --- |
| Proposed (0.95, 3, 8, 3) | tune | 499/501 | 65/66 | 65/66 |
| Proposed (0.95, 3, 8, 3) | held out | 251/255 | 44/46 | 44/46 |
| Shipped (0.8, 3, 8, 3) | tune | 498/501 | 65/66 | 65/66 |
| Shipped (0.8, 3, 8, 3) | held out | 250/255 | 44/46 | 44/46 |

The misses are the long pickups the [alignment spike](recording-coverage-alignment-spike.md) describes. The one extra
label miss in each split at 0.8 is a paragraph whose long first sentence was dropped (`c-0001-drop-sentence-2`,
`c-0002-drop-sentence-3`). Under a fifth of it was read, so the harness labels it `missing` instead of `partial` at 0.8.
The verdicts and regions are unchanged.

### Each setting moved on its own

Each setting was moved over its grid with the other three at the shipped values. The counts are summed over the five
noise levels, so "complete called complete" is out of 175 on `tune` (35 × 5) and 120 on held out.

| Setting | Value | False met (tune) | False met (held out) | Complete called complete (tune) | Complete called complete (held out) |
| --- | --- | --- | --- | --- | --- |
| min_paragraph_present | **0.8** | 0 | 0 | 136/175 | 100/120 |
| min_paragraph_present | 0.85 | 0 | 0 | 130/175 | 100/120 |
| min_paragraph_present | 0.9 | 0 | 0 | 118/175 | 89/120 |
| min_paragraph_present | 0.95 | 0 | 0 | 71/175 | 57/120 |
| min_paragraph_present | 1 | 0 | 0 | 40/175 | 38/120 |
| max_missing_run | 0 | 0 | 0 | 40/175 | 38/120 |
| max_missing_run | 1 | 0 | 0 | 91/175 | 74/120 |
| max_missing_run | 2 | 0 | 0 | 106/175 | 81/120 |
| max_missing_run | **3** | 0 | 0 | 136/175 | 100/120 |
| max_missing_run | 4 | 34 | 19 | 146/175 | 107/120 |
| max_missing_run | 5 | 36 | 19 | 149/175 | 107/120 |
| max_missing_run | 6 | 51 | 28 | 149/175 | 108/120 |
| max_missing_run | 8 | 51 | 29 | 149/175 | 108/120 |
| max_misread_run | 4 | 0 | 0 | 113/175 | 88/120 |
| max_misread_run | 6 | 0 | 0 | 129/175 | 93/120 |
| max_misread_run | **8** | 0 | 0 | 136/175 | 100/120 |
| max_misread_run | 10 | 35 | 29 | 138/175 | 101/120 |
| max_misread_run | 12 | 36 | 30 | 138/175 | 102/120 |
| min_anchor_run | 2 | 0 | 0 | 139/175 | 103/120 |
| min_anchor_run | **3** | 0 | 0 | 136/175 | 100/120 |
| min_anchor_run | 4 | 0 | 0 | 124/175 | 99/120 |

What this shows:

- **`min_paragraph_present` decides how much transcriber error the check tolerates.** At 0.95, one dropped word in a
  20-word paragraph fails the chapter. That is why the Proposed values failed 7 of 35 complete `tune` chapters under
  light noise. At 0.8 the same chapters pass, and the resolution cases still fail because `max_missing_run` catches them.
  0.8 is the lowest value on the grid, and the grid stops there on purpose. Below it, a paragraph could lose a fifth of
  its words in short gaps of 1 to 3 words and still pass. No fixture has that pattern, so going lower would be a guess
  rather than a finding.
- **`max_missing_run` 3 and `max_misread_run` 8 are the loosest values that still catch the resolution cases.** One word
  more on either lets a skipped or replaced phrase through (34 and 35 false "met" on `tune`). A test pins this.
- **`min_anchor_run` 2 would pass three more noisy chapters, but it credits chance matches.** With 2, a pair of common
  words inside unrelated speech ("to go", "it is") counts as read. The verdicts stay right, but the unrelated-speech
  paragraphs no longer read 0 words present. So 2 is not safe, and 3 stays.

## Real transcription: Piper renders through the sidecar and Whisper

`render-audio` spoke the 16 committed cases with the app's Piper voice (`en_US-ljspeech-high`), outside the repository,
in the `NARRATION_COVERAGE_CORPUS` layout. A trimmed item's audio is its played range only, so the played-range slicing
itself is covered by the text path and the service tests rather than here. `audio` then ran the real sidecar with
`--model-dir` pointing at each model's hash-pinned files (CPU, int8), exactly as the host launches it.

| Model | Cases | False met | False not met | Complete chapters: words present | Words dropped / swapped / added (all cases) |
| --- | --- | --- | --- | --- | --- |
| small | 16 | 0 | 0 | 3 of 8 one word short, the rest complete | 34 / 64 / 5 |
| tiny | 16 | 0 | 0 | 6 of 8 one or two words short | 15 / 100 / 8 |

This holds at both the Proposed and the shipped settings. With a clean synthetic voice, no paragraph of a complete
chapter fell below 0.95. So the real-audio run neither needs nor contradicts the change to 0.8. That change comes from
the simulated error margin. For `small`, 42 of the 64 swaps were in the constructed chapter (invented names and
spoken numbers) and the refrain chapter. The aligner counts a swap as a misread, which is present. `small` "dropped" 24 words in
`c1-retakes-false-starts`, but they were the false starts and the aside, which the check does not need. The
per-case tables are the `audio` command's output.

### Time budget

Measured on an AMD Ryzen 9 9955HX (16 cores), CPU, int8, one check per process as the host runs it:

| Model | 16 chapters of 0.4 to 1.2 minutes, 12.0 minutes in all | One 12.0-minute item | Model load per check |
| --- | --- | --- | --- |
| small (the default) | 127 s (about 10.6 s per audio minute, with the load each time) | 125 s: **10.4 s per audio minute** | about 2 s |
| tiny | 35 s (about 3 s per audio minute) | 25 s: **2.1 s per audio minute** | under 0.5 s |

So a first check of a 30-minute chapter with `small` takes about 5 minutes on this machine, and with `tiny` about 1
minute. A second check that reuses every words file transcribes nothing and took 0.3 s per chapter here. A slower
machine scales the transcription part. These figures are for this machine and a clean synthetic voice. They are not a
promise.

### The larger model (Q7): pending

Q7 asks for `small` to be compared with one larger model. No larger catalog model (`medium`, `large-v3-turbo`,
`large-v3`) was installed on the machine that ran this, and installing one is a download of 1.5 GB or more, which needs
the owner's go-ahead. `tiny` was compared instead, as the smaller end. The larger comparison is tracked in
[#425](https://github.com/countrymanprime/narration-utils/issues/425) (see
[the recording check page](../utilities/recording-coverage.md#not-done-yet)). Run it with
`audio --model medium=<dir>`.

## Limits

- **A synthetic voice and synthetic noise.** Piper reads cleanly, at an even pace, with no room noise, breaths or mouth
  clicks. Real narration will drop more words. That is why the defaults keep the "uncalibrated" label.
- **Counts, not rates.** 171 cases over four short chapters. The zero on held out is a count of zero in 70 cases at
  each of five noise levels, not a proven rate.
- **The resolution is a design choice, not a finding.** The 4-word skip and the 9-word replacement come from Q3. A
  narrator who wants to catch a 2-word skip can set `max_missing_run` to 1, and will get more false "not met" from
  transcriber drops (the table above shows the cost).
- **A real corpus replaces this.** Point `NARRATION_COVERAGE_CORPUS` at a permissioned corpus (audio outside the repo,
  labels in the same format), run `audio` over it, and re-run the sweep with its cases. Only then can the defaults lose
  the "uncalibrated" label for the conditions it covers.
