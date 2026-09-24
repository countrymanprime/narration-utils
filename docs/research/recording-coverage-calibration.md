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
uv run python sidecars/transcript-compare/tests/coverage_calibration.py audio --corpus <that dir> --model small=<model dir> --model tiny=<model dir> --model medium=<model dir> --model large-v3-turbo=<model dir>
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

### The larger model (Q7)

Q7 asks for `small` to be compared with one larger model. With the owner's go-ahead, `large-v3-turbo` was installed
from the catalog, hash-verified (`go run ./cmd/seed-assets whisper/large-v3-turbo`, the app's own managers). The 16
cases were then spoken again with the same Piper voice and run through the sidecar with `small` and
`large-v3-turbo`, and then `medium` (also installed with the owner's go-ahead), on the same machine, on 2026-09-23
([#425](https://github.com/countrymanprime/narration-utils/issues/425)):

| Model | Cases | False met | False not met (shipped 0.8) | False not met (Proposed 0.95) | Words dropped / swapped / added (all cases) | 12.0 audio minutes, 16 checks |
| --- | --- | --- | --- | --- | --- | --- |
| tiny | 16 | 0 | 0 | 0 | 19 / 89 / 8 | 36 s (about 3 s per audio minute) |
| small | 16 | 0 | 1 | 1 | 48 / 48 / 4 | 117 s (about 9.7 s per audio minute) |
| large-v3-turbo | 16 | 0 | 0 | 0 | 12 / 31 / 12 | 239 s (about 20 s per audio minute) |
| medium | 16 | 0 | 0 | 1 | 35 / 32 / 3 | 337 s (about 28 s per audio minute) |

- **Neither model passed a chapter that was not read.** Both had no false "met", at both settings.
- **`small` failed one complete chapter this time.** In `c3-refrain-complete` it dropped a run of 13 words in the
  refrain, which is longer than `max_missing_run` 3, so the chapter came out "not met" (105 of 121 words present).
  The first run above did not show this. The new render is a fresh Piper take of the same text, and a Piper take
  varies slightly from one run to the next. So this is `small` losing repeated text on some takes, not a change in
  the check. A narrator sees it as a false "not met" on a chapter with a repeated passage.
- **`large-v3-turbo` heard that chapter and got it right** (119 of 121). It also dropped none of the false starts in
  `c1-retakes-false-starts`, where `small` dropped 23. It added more words than `small` in `c4-unrelated-speech` (9
  against 1), which does not change a verdict because that paragraph is not credited anyway.
- **It costs about twice the time.** About 20 s of CPU per audio minute against about 10 s for `small`, so a first
  check of a 30-minute chapter takes about 10 minutes on this machine instead of about 5. Loading the model took
  under 5 s.
- **`medium` is slower than `large-v3-turbo` and no better.** It read the refrain chapter in full (121 of 121), but
  it took 66 s on that 0.54-minute chapter, and it dropped 4 words of `c1-retakes-false-starts` that the script
  needs. That chapter passes at the shipped 0.8 but not at 0.95. All in, about 28 s of CPU per audio minute, so
  about 14 minutes for a first check of a 30-minute chapter.

So `small` stays the default: it gives no false "met", and it takes half the time. `large-v3-turbo` is worth choosing
for chapters with repeated passages, or when a false "not met" from `small` needs a second opinion. `medium` has no
case here where it beats `large-v3-turbo`. Both are one
synthetic voice on one machine, so the real-corpus limit below still applies.

## Model cascade (Phase 1)

Phase 1 of the model cascade PRD asks whether a `tiny` first pass, with `large-v3-turbo` re-checking only the regions
that fail the chapter, is as good as one model and cheaper. Two commands measure it:

```bash
uv run python sidecars/transcript-compare/tests/coverage_calibration.py windows --corpus <dir> --model tiny=<model dir> --model small=<model dir> --model large-v3-turbo=<model dir>
uv run python sidecars/transcript-compare/tests/coverage_calibration.py cascade --corpus <dir> --model tiny=<model dir> --model small=<model dir> --model large-v3-turbo=<model dir> --work <dir outside the repo>
uv run python sidecars/transcript-compare/tests/coverage_calibration.py cascade --manifest <host manifest> --manuscript <manuscript.json> --chapter-id <id> --model ... --work <dir>
```

`cascade` runs each model alone through the sidecar (the `audio` path and its words cache, which now keeps the time of
the run that transcribed it). It then aligns the first pass in process with the sidecar's own alignment and coverage
code, and takes the regions that fail the chapter: a run over `max_missing_run`, or a region in a failing paragraph.
A "met" first pass stands and loads nothing more. Each failing region's audio bounds are the last matched word before
it and the first after it, read from the alignment's `equal` opcodes. The PRD's Phase 2 will emit these bounds from the
sidecar, and Phase 4 should read them from there. The windows follow MC3: 3 s past each bound, padded to at least
25 s, merged when less than 20 s apart, one slice per item a gap crosses, the item's edge at a chapter edge, and one
whole-chapter pass when the windows exceed 60% of the played audio. `large-v3-turbo` transcribes the windows with one
load a run. Its words replace the first pass's by word midpoint, except within 0.5 s of a cut edge, where the first
pass keeps the word. Then the chapter is aligned again. The re-check time counts the model load for every case that
had a window, and the second alignment. Measured on 2026-09-23 on the same machine as above (AMD Ryzen 9 9955HX, 32
threads, CPU, int8). Another agent's work may have shared the CPU, so the times are within a few seconds.

### Window length

The sidecar's settings (`vad_filter`, `word_timestamps`, int8, CPU), the median of 3 at different offsets in the 12
minutes of the second Piper take:

| Window | 5 s | 10 s | 20 s | 30 s | 45 s | 60 s | 120 s | 240 s | Model load |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tiny | 0.2 | 0.3 | 0.4 | 0.7 | 1.2 | 1.4 | 3.3 | 7.1 | 0.2 |
| small | 1.2 | 1.4 | 2.0 | 3.7 | 6.6 | 7.7 | 16.8 | 41.0 | 0.9 |
| large-v3-turbo | 4.6 | 4.5 | 5.5 | 10.5 | 11.6 | 24.8 | 30.7 | 58.3 | 2.8 |

Seconds. It repeats the PRD's scratch figures: with `large-v3-turbo` a window up to 20 s costs about as much as 5 s,
and the cost steps at 30 s. Three separate 10-second windows took 11.5 s against 16.0 s for one 60-second window over
all three. So padding a window to 25 s is free, and merging saves time only when the joined window needs fewer 30 s
blocks. The 60 s median (24.8 s) sits above the 45 s and 120 s ones, which is probably run-to-run noise.

### The synthetic corpus

The first Piper take was not kept, so the second take (the one Q7 used) and a fresh third take of the 16 cases were
run. Both takes, at both settings:

| Take | Settings | Method | False met | False not met | Seconds | Against `small` |
| --- | --- | --- | --- | --- | --- | --- |
| 2 | 0.95 | tiny | 0 | 0 | 34.4 | 32% |
| 2 | 0.95 | cascade | 0 | 0 | 134.4 | 124% |
| 2 | 0.95 | small | 0 | 1 | 108.4 | 100% |
| 2 | 0.95 | large-v3-turbo | 0 | 1 | 228.0 | 210% |
| 2 | 0.8 | cascade | 0 | 0 | 134.4 | 124% |
| 2 | 0.8 | large-v3-turbo | 0 | 0 | 228.0 | 210% |
| 3 | 0.95 | tiny | 0 | 3 | 35.1 | 30% |
| 3 | 0.95 | cascade | 0 | 0 | 143.6 | 123% |
| 3 | 0.95 | small | 0 | 0 | 116.8 | 100% |
| 3 | 0.95 | large-v3-turbo | 0 | 0 | 234.0 | 200% |
| 3 | 0.8 | tiny | 0 | 2 | 35.1 | 30% |
| 3 | 0.8 | cascade | 0 | 0 | 135.1 | 116% |

At 0.8, take 2 `tiny` and `small` are as at 0.95, and take 3 `small` and `large-v3-turbo` are too.

- **No false "met" from any method.** The cascade called every complete chapter complete on both takes.
- **The re-check rescued every false "not met" `tiny` made.** On take 3, `tiny` failed `c2-subtitle-read`,
  `c3-refrain-complete` and `c4-names-and-numbers`. The windows over those regions, read by `large-v3-turbo`, passed all
  three.
- **Each incomplete chapter paid for a re-check, and most of them were whole-chapter passes.** These chapters last 0.4
  to 1.2 minutes, so one 25-second window is often over 60% of the chapter. The re-check cost 7 to 21 s a case, model
  load included. That is why the cascade came to 116% to 124% of `small` here and not the third the PRD hoped for. On
  a chapter of normal length a window is a small share (next section).

### A real chapter (owner-approved, unlabelled)

One chapter of the owner's own narration was used, with the owner's permission: four unedited takes, 55.1 minutes
played, with pickups and deliberate mistakes. It was read from a copy of the project outside the repository, with the
audio linked in place, read only. The host's own `buildPlan` built the manifest in a scratch test that was not kept.
Nothing from the chapter is in this repository: no words, only counts, times and positions. It has no labels, so
`large-v3-turbo` alone is the reference.

| Settings | Run | Verdict | Failing regions | Windows (s) | Seconds | Against `small` | Regions shared with the reference | Only this run | Only the reference |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0.95 | tiny | not met | 5 | | 103.7 | 25% | 1 | 4 | 2 |
| 0.95 | small | not met | 2 | | 414.3 | 100% | 0 | 2 | 3 |
| 0.95 | large-v3-turbo | not met | 3 | | 765.3 | 185% | 3 | 0 | 0 |
| 0.95 | cascade | not met | 2 | 4 (130) | 129.6 | 31% | 0 | 2 | 3 |
| 0.8 | tiny | not met | 4 | | 103.7 | 25% | 1 | 3 | 1 |
| 0.8 | small | met | 0 | | 414.3 | 100% | 0 | 0 | 2 |
| 0.8 | large-v3-turbo | not met | 2 | | 765.3 | 185% | 2 | 0 | 0 |
| 0.8 | cascade | met | 0 | 3 (105) | 125.5 | 30% | 0 | 0 | 2 |

- **Time:** the cascade took 30% of `small`'s time and 16% to 17% of `large-v3-turbo`'s. It re-checked 105 to 130 seconds of
  55 minutes, 19 to 23 s of CPU plus a 2.8 s load.
- **The one different verdict:** at 0.8, the cascade (like `small`) says met and `large-v3-turbo` says not met.
  `large-v3-turbo`'s larger region is 22 words of `different_text` at item 2, 21:31. There, `large-v3-turbo` wrote no
  words for 20 seconds (21:34 to 21:54 of the source), and `tiny` and `small` both heard speech the whole way. They
  wrote 169 and 174 words from 21:00 to 22:40, against 131, almost all of them in the chapter's vocabulary. So this
  looks like `large-v3-turbo` losing a stretch of speech (a false "not met" from the reference), not `tiny` inventing
  text. `tiny` did not flag the stretch, so the cascade never re-checked it. Only listening can settle it. The other
  region is one word at item 3, 4:59, which both runs report on different manuscript words.
- **The cascade's regions at 0.95** are single words (`short_read`) at item 2, 7:08 and item 3, 4:59. The reference's
  are the stretch above, one word at item 2, 25:50 and one word at item 3, 4:59.

Places to check by ear (item in play order, counted from 1; time in the item's source file):

| Where | What | Found by |
| --- | --- | --- |
| item 2, 21:31 (silence in `large-v3-turbo` from 21:34 to 21:54) | 22 words, `different_text` | `large-v3-turbo` only |
| item 2, 25:50 | 1 word, `short_read` | `large-v3-turbo` only (0.95) |
| item 2, 7:08 | 1 word, `short_read` | cascade only (0.95) |
| item 3, 4:59 | 1 word, `short_read` | both, on different manuscript words |

### Go or no-go

The PRD's Key Hypothesis, over the calibration corpus: no false "met", no more false "not met" than `large-v3-turbo`
alone, and a total time within 40% of `small`'s.

- **Take 2:** false met 0; false not met 0 (`large-v3-turbo` 1 at 0.95, 0 at 0.8); 134.4 s against a limit of
  151.7 s (124%). **Go.**
- **Take 3:** false met 0; false not met 0 (`large-v3-turbo` 0); 143.6 s at 0.95 and 135.1 s at 0.8, against a limit
  of 163.5 s (123% and 116%). **Go.**
- **The real chapter** gives no evidence of a false "met" from the first pass. The one verdict it differs on points
  the other way, at a place where the reference itself lost 20 seconds of speech. That is pending the owner's ear.
  The cascade took 30% of `small`'s time there, which is the PRD's "about a third" on a chapter of real length.

So Phase 1 is a go. Two things for the later phases: on chapters shorter than about a minute the whole-chapter
fallback runs almost every time and the cascade costs more than `small`, and `tiny` can mark a stretch present that
`large-v3-turbo` would not, which is the trust MC6's spot checks would test.

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
