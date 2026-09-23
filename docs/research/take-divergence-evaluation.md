# Per-take divergence: is ASR word timing precise enough? (Q10)

**Date:** 2026-09-23. **PRD:** [take review, phase 9](../prds/take-review-pickups-duplicates-take-intelligence.prd.md). **Decision:** [ADR 0141](../adr/0141-per-take-divergence-is-localized-by-the-markers-diff-and-asr-word-timestamps.md). **Result:** option (A) stays. Diff plus Whisper word timestamps ([ADR 0008](../adr/0008-timing-confidence-over-forced-alignment-model-for-transcript-compare.md)) localized every constructed divergence to the right words, with its time within 0.23 s. Forced alignment is not adopted.

> **This is synthetic evidence.** The owner chose constructed fixtures over an annotated corpus (Q10, answered 2026-09-23). A synthetic voice reads cleanly and evenly, with no room noise, breaths, mouth noise, plosives or overlapping retakes, and Whisper times such speech better than it times a real session. The numbers below are an optimistic bound. They show the method works and that timing is not its weak point. They do not show how it does on real recordings. If annotated chapters become available, repeat the run on them (see [Repeating it](#repeating-it)).

## The question

Phase 10's comparison view shades where inside each take of one span the read goes wrong. Q10 asked whether a free Whisper transcript with word timestamps, diffed against the manuscript, can show that sub-span, or whether forced alignment (aligning the manuscript to the audio with a CTC or Kaldi model, a first PyTorch dependency) is needed. ADR 0008's condition for moving to forced alignment is evidence that word timing is too coarse.

**What "precise enough" means here.** The smallest sub-span the view can shade is one word. At 150 words a minute a word lasts about 0.4 s. A divergence is *localized* when:

1. it is reported with the right kind (misread, skipped, extra or unread) over the right span words (for an extra, the word it comes before, give or take one: which copy of a repeated word is "the extra" is a choice, not a fact);
2. its time range overlaps the true one (a skip is a point: the pause where the words were left out);
3. both of its boundaries are within 0.4 s of the true ones.

Finer timing than that could not shade a smaller sub-span, so forced alignment would add nothing the view can show.

## The fixtures

[`sidecars/transcript-compare/tests/fixtures/divergence/cases.json`](../../sidecars/transcript-compare/tests/fixtures/divergence/cases.json) holds four paragraphs (three from chapter I of *Alice's Adventures in Wonderland*, public domain, and one constructed with a number, an invented name and a homophone) and 14 scripted takes. A script is a list of segments: `read` (the span's next words, optionally said differently with `as`: digits, a homophone), `misread` (the span's next words said as something else), `skip`, `unread` (the take starts late), `extra` and `restart` (said, not in the span). The harness walks each script along the span and derives the ground truth: every divergence as span words, and its true time from the words the script says. A script that does not read the span's own words is a fixture error.

| Case | Divergence put there |
| --- | --- |
| clean-long-sentence | none (a 57-word sentence read cleanly) |
| misread-one-word-partway | "sister" said as "sitter", 12 words in |
| misread-phrase-late | "pink eyes" said as "pale ears", near the end of a 55-word sentence |
| skip-parenthesis | a 16-word parenthetical left out |
| skip-one-word | "very" left out |
| restart-mid-sentence | "very much out of the", abandoned and read again |
| restart-at-span-start | "So she was considering", abandoned and read again |
| stutter-repeated-word | "having having" |
| flub-near-the-end | "parcel" said as "packet", third-last word |
| two-divergences | "forty-two" said as "forty-four", then "small" left out |
| chatter-around-the-span | "okay take two" before the span, "cut there" after it |
| stops-early | the take stops after the second sentence's first eight words |
| starts-late | the take starts at the second clause |
| numbers-and-homophones | none ("twenty past three" as "20 past 3", "forty-two" as "42", "their" as "there") |

## Method

The analyzer is the shipped code: `compare.py --take-divergence`'s alignment (`core/take_divergence.py`), which runs the take markers' own diff. [`tests/divergence_harness.py`](../../sidecars/transcript-compare/tests/divergence_harness.py) scores it three ways:

- **exact:** words at 150 a minute (0.32 s spoken, 0.08 s gap), a 0.3 s pause after a sentence and 0.35 s after a false start;
- **jitter:** the same with every word boundary moved at random by up to 0.15 s (seeded per case), standing in for ASR timestamp error;
- **real ASR:** each take spoken by a Windows System.Speech voice ([`tests/divergence_tts.ps1`](../../sidecars/transcript-compare/tests/divergence_tts.ps1)). The voice reports every word's onset. A word's true end is where the audio before the next onset last holds speech (10 ms frames within 35 dB of the loudest), so a pause after a word is not counted as part of it. The WAV is decoded and transcribed exactly as the sidecar transcribes a take (`decode_segment`, `transcribe` with word timestamps and VAD, English), from a local faster-whisper model, offline.

The first two run in CI as a gate (`tests/test_divergence_harness.py`). The third is manual.

## Results

**Exact and jittered timing (CI):** 14 of 14 divergences localized, no false divergence, in both. The largest boundary error under jitter was 0.12 s.

**Real ASR, voice 1 (Microsoft David, normal rate), Whisper `small` (the app's default) with the invented name as a vocabulary hint:**

| Case | Truth | Span words | Found | True s | Found s | Error s |
| --- | --- | --- | --- | --- | --- | --- |
| misread-one-word-partway | misread | 11 | misread 11 | 3.00-3.35 | 2.98-3.22 | 0.13 |
| misread-phrase-late | misread | 49-50 | misread 49-50 | 14.68-15.22 | 14.66-15.16 | 0.06 |
| skip-parenthesis | skip | 8-23 | skipped 8-23 | 2.14 | 2.06 | 0.08 |
| skip-one-word | skip | 5 | skipped 5 | 1.39-1.41 | 1.34 | 0.06 |
| restart-mid-sentence | restart | before 14 | extra before 14 | 4.31-5.40 | 4.28-5.30 | 0.10 |
| restart-at-span-start | restart | before 0 | extra before 0 | 0.10-1.41 | 0.00-1.18 | 0.23 |
| stutter-repeated-word | extra | before 17 | extra before 17 | 4.83-5.14 | 4.82-5.08 | 0.06 |
| flub-near-the-end | misread | 19 | misread 19 | 7.10-7.52 | 7.02-7.42 | 0.10 |
| two-divergences | misread | 14 | misread 14 | 5.36-5.97 | 5.26-5.82 | 0.15 |
| two-divergences | skip | 18 | skipped 18 | 6.75 | 6.68 | 0.08 |
| chatter-around-the-span | extra | before 0 | extra before 0 | 0.10-0.93 | 0.00-0.88 | 0.10 |
| chatter-around-the-span | extra | after the span | extra after | 12.51-13.04 | 12.50-12.92 | 0.12 |
| stops-early | unread | 65-111 | unread 65-111 | - | - | - |
| starts-late | unread | 0-7 | unread 0-7 | - | - | - |

Both clean cases reported nothing. 14 of 14 localized, no false divergence, median boundary error 0.10 s, maximum 0.23 s.

**Every run:**

| Voice | Model | Hints | Localized | False divergences | Median / max error s |
| --- | --- | --- | --- | --- | --- |
| David, normal rate | small | none | 14 / 14 | 3 | 0.10 / 0.23 |
| David, normal rate | small | "Arelian" | 14 / 14 | 0 | 0.10 / 0.23 |
| David, normal rate | base | none | 13 / 14 | 8 | 0.10 / 0.25 |
| David, normal rate | base | "Arelian" | 14 / 14 | 3 | 0.10 / 0.23 |
| David, normal rate | tiny | none | 14 / 14 | 12 | 0.11 / 0.15 |
| David, normal rate | tiny | "Arelian" | 13 / 14 | 14 | 0.10 / 0.15 |
| Zira, rate +3 (faster) | small | none | 14 / 14 | 6 | 0.07 / 0.17 |
| Zira, rate +3 (faster) | small | "Arelian" | 14 / 14 | 3 | 0.07 / 0.17 |
| Zira, rate +3 (faster) | base | none | 14 / 14 | 6 | 0.08 / 0.17 |
| Zira, rate +3 (faster) | base | "Arelian" | 14 / 14 | 3 | 0.08 / 0.17 |
| Zira, rate +3 (faster) | tiny | none | 14 / 14 | 13 | 0.09 / 0.14 |
| Zira, rate +3 (faster) | tiny | "Arelian" | 13 / 14 | 12 | 0.09 / 0.14 |

Timing held up in all 12 runs: the largest boundary error was 0.25 s, and no run's median was above 0.11 s.

## What failed, and why it is not timing

No divergence that was found on the right words had a boundary more than 0.25 s from the truth, in any run. **Every failure was an ASR text error:**

- **The invented name.** Without a hint, `small` wrote "Arelian" as "Aerlean" (and, for the faster voice, "Aeolian"), a false misread in the three cases that contain it. The project's vocabulary hints (Whisper hotwords) fixed it for `small` with voice 1. The per-project equivalence list (**Add Equiv**) is the other existing fix. Both are the same mitigations the take markers already rely on.
- **Smaller models mishear ordinary words.** With `base` and `tiny`, "Oh dear" became "O" or "Odeer", "Arelian courier" became "early and career across", "itself" became "it's", "Rabbit" became "rabbits". `base` heard "one small parcel" as "won parcel", which folded the skipped "small" into a misread. `tiny` with hints dropped the repeated "having" (Whisper removes stutters), so the stutter was missed.
- **The faster voice** added "mayor" heard as "mare" and "and" heard as "in", even with `small` and the hint.

Forced alignment would fix none of these. They are errors in *what* Whisper wrote, not *when*. Forced alignment of the manuscript would also hide real misreads, because it forces the expected words onto the audio.

## One fix this evaluation led to

The first real-ASR runs with `base` and `tiny` missed the mid-sentence restart. The transcript differed slightly, so the diff matched the abandoned first copy of "very much out of the" and called the second copy extra, 1.3 s late. The text diff cannot tell which copy was abandoned. The alignment now moves a repeated run to its earlier copy: a narrator abandons the earlier read and continues with the later one. After that change every model localized the restart. `tests/test_take_divergence.py` pins it.

## Other limits

- A misread right before the end of a take absorbs the unread words after it into one `misread` divergence, because the diff reports one replaced block. The span words are right; only the kind is coarser.
- Whisper tends to start the first word of a file at 0.00 s, which is most of the 0.23 s maximum error (restart-at-span-start). Real takes usually start with a little silence too.
- The fixtures have 14 divergences over 14 takes. That is enough to show whether timing is the weak point, not enough to calibrate a threshold. Phase 10 applies no threshold: it shows the evidence.

## Repeating it

```bash
# 1. the texts to speak
python sidecars/transcript-compare/tests/divergence_harness.py --tts-plan %TEMP%/plan.json
# 2. speak them (Windows, offline), one WAV and one onset file per case
pwsh sidecars/transcript-compare/tests/divergence_tts.ps1 -Plan %TEMP%/plan.json -OutDir %TEMP%/divergence-audio [-Voice "Microsoft Zira Desktop" -Rate 3]
# 3. transcribe and score, with a local model directory (no download)
python sidecars/transcript-compare/tests/divergence_harness.py --asr %TEMP%/divergence-audio --model small --model-dir <faster-whisper-small directory> [--hotwords Arelian]
```

The WAVs are scratch output and stay out of the repository. To evaluate real recordings, write a case per take in the same script format (the words actually said, with the divergences where they happened) and a `<case>.json` of true word onsets, for example from a hand-checked forced alignment or a labeled editor session. `--asr` then scores them the same way.
