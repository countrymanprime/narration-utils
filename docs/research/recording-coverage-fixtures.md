# Recording coverage: the synthetic fixture set and harness

**Status: in place, 2026-09-23.** Phase 1 of the recording-coverage PRD (delivered and deleted; the steady state is [the recording check](../utilities/recording-coverage.md)), under D12 and Q15 as amended on 2026-09-23: no coverage threshold ships until it has been scored against labeled chapters. For now the labeled chapters are synthetic. The owner chose constructed fixtures over an owner-supplied corpus, so the defaults that Phase 8 ships stay Proposed and labeled uncalibrated until a real, permissioned corpus recalibrates them. [ADR 0125](../adr/0125-recording-coverage-ground-truth-is-scripted-recordings-with-paragraph-labels-and-a-corpus-directory-variable.md) records the format choice.

## What is here

| Path | What |
| --- | --- |
| `sidecars/transcript-compare/tests/fixtures/coverage/manuscript.json` | A canonical manuscript (schema 1, the file the importer writes and `compare.py` reads) with four narration chapters: three public-domain excerpts from *Alice's Adventures in Wonderland* (1865), Chapters I, II and X, and one chapter written for this repo with invented names and numbers. Chapter X repeats its refrain paragraph word for word. |
| `sidecars/transcript-compare/tests/fixtures/coverage/cases/*.json` | 16 cases. Each is one scripted recording of one chapter, with a label for every paragraph and the expected chapter verdict. |
| `sidecars/transcript-compare/tests/coverage_harness.py` | Loads and validates a corpus, renders scripted recordings into timed transcript words, scores an analyzer and prints the label table. Also holds the order-blind stub analyzer. |
| `sidecars/transcript-compare/tests/test_coverage_harness.py` | Tests for the format rules, the scoring, the stub and the corpus hook, and checks on the committed set: every condition has a case, both verdicts appear in each split, no audio, under 64 KiB. |

Nothing here is product code. The analyzer being measured is `core/recording_coverage.py` (Phase 2). `tests/coverage_spike.py` turns it into a harness analyzer, and `tests/coverage_calibration.py` runs the shipped path over its cases ([the calibration](recording-coverage-calibration.md)). `build_case` builds a case from its JSON form without a file, so generated cases (the Phase 2 stress set) obey the same labeling rules.

## A case

```json
{
  "schemaVersion": 1,
  "id": "c2-pickup-at-end",
  "chapter": "c-0002",
  "conditions": ["pickup_at_end"],
  "split": "tune",
  "description": "Paragraph two is skipped in place and recorded as a pickup after the last paragraph.",
  "recording": {"items": [{"id": "item-1", "segments": [
    {"read": "p-000006"}, {"read": "p-000008"}, {"read": "p-000009"},
    {"pause": 3.0}, {"say": "Pickup for paragraph two."}, {"pause": 1.0}, {"read": "p-000007"}
  ]}]},
  "expected": {
    "textComplete": false,
    "paragraphs": {"p-000006": "present", "p-000007": "missing", "p-000008": "present", "p-000009": "present"},
    "regions": [{"kind": "skip", "paragraphs": ["p-000007"]}]
  }
}
```

- **The file name is the case id.** `chapter` is a chapter id in the corpus's `manuscript.json`.
- **A recording is the chapter's items in position order.** Each item has either `segments` (scripted) or `audio` (a file in a permissioned corpus, relative to the corpus directory and not allowed to leave it). An optional `playedRange: [start, end]`, in seconds of the item's source, models a trimmed item. Only words that fall wholly inside the range are heard, and their times count from its start. This matches the played range in the PRD (D6) and the words files that Phase 3 writes.
- **Segments.** `{"read": "<paragraph id>"}` reads a paragraph. It may take `"sentences": [from, to]` or `"words": [from, to]` (half-open ranges, `to` may be `null` for "to the end") to read part of it, and `"as": "<text>"` for the words as spoken and transcribed (a number said as words, a name the transcriber spells another way, a misread). `{"say": "<text>"}` is any other speech: a title, a subtitle, a false start, an aside or unrelated talk. `{"pause": <seconds>}` is silence. Each word takes `WORD_SECONDS` (0.4 s, 150 words a minute).
- **Rendering gives a perfect transcript.** It contains what the narrator said, spelled the way a transcriber would write it. Transcriber error (dropped or garbled words) is not modeled except where a case says so with `"as"`. Phase 8 measures that error on audio.

## Labeling rules

The labels describe the recording against the PRD's rule that recording is done when all of the chapter's text is there, in order, even with mistakes. They do not describe what any analyzer can detect. The loader rejects a case that breaks these rules:

1. **Every body paragraph gets a label** of `present`, `partial` or `missing`. The title and subtitle are not paragraphs, so reading them or leaving them out never changes a label (Q11).
2. **`present`**: every word of the paragraph was read in its place in the chapter order. Misreads still count as present (Definitions, Present). Retakes, false starts and asides around the paragraph do not matter.
3. **`partial`**: some of the paragraph was read in place and some was not, for example a skipped sentence.
4. **`missing`**: none of the paragraph was read in place. Text read only out of place, like a pickup at the end or a refrain read once where the chapter has it twice, is missing where it belongs (Definitions, In order). So is text that is in an item's source but outside its played range, and a paragraph replaced by unrelated speech.
5. **`textComplete` is true exactly when every paragraph is `present`.** This is the ground truth. The narrator's thresholds (`min_paragraph_present`, `max_missing_run`) decide how close an analyzer's report must come to it, and Phase 8 sets them by scoring against these labels.
6. **Every paragraph that is not present is in a region, and a region names no present paragraph.** Region kinds follow the PRD's Definitions: `head`, `tail`, `skip`, `short_read` and `different_text`. The kind names what the narrator did, not how much of a paragraph it touched. A sentence left out inside the read span is a `skip` (text simply not said), even when its paragraph is only `partial`. `short_read` is for a passage said in fewer, different words than the text (a paraphrase), and no committed case has one yet.

## Conditions and split

Every condition in the PRD's Phase 1 list has at least one case. Three more cover things the PRD names elsewhere: `misread`, `unrelated_speech` (the chance-match fixture) and `trimmed_out_text`. `CONDITIONS` in the harness is the list, and a test fails if any condition has no committed case.

Each case is in the `tune` split (9 cases) or the `held_out` split (7). Phase 8 may tune thresholds on `tune` only and reports false "met" on `held_out`. Both splits contain complete and incomplete chapters.

## Scoring

`evaluate(cases, analyzer)` calls `analyzer(chapter, items)` for each case and compares the returned `Report` with the labels:

- **Verdict.** `ok`, `false_met` (the analyzer called an incomplete chapter complete, the error that blocks shipping defaults) or `false_not_met`.
- **Paragraph labels agreed**, out of the chapter's paragraphs.
- **Regions located.** A labeled region is located when some reported region names at least one of its paragraphs. This is the PRD's "right paragraph for every labeled region" metric, and a same-kind count is reported beside it.
- **Skipped.** An analyzer raises `NeedsAudio` for a case it cannot hear, such as an audio-only corpus case with the stub, and the case is listed as skipped instead of scored.

The label table is Markdown, one row per case, followed by a summary for each split and overall.

## Running it

```bash
uv run python sidecars/transcript-compare/tests/coverage_harness.py            # committed set (+ the corpus, if set)
uv run python sidecars/transcript-compare/tests/coverage_harness.py --strict   # exit 1 on any false "met"
uv run python sidecars/transcript-compare/tests/coverage_harness.py --corpus-only
```

The pytest suite (`pnpm check`, via the `transcript-compare` test target) runs the harness on the committed set every time.

### The stub analyzer, as a baseline

`presence_stub` treats a paragraph as present when at least 95% of its words were heard anywhere in the recording, and partial when at least 50% were. It ignores order on purpose. Its result on the committed set on 2026-09-23:

| Split | Cases | False met | False not met | Paragraph labels agreed | Regions located |
| --- | --- | --- | --- | --- | --- |
| tune | 9 | 1 (`c2-pickup-at-end`) | 1 (`c4-names-and-numbers`) | 34/41 | 3/4 |
| held_out | 7 | 1 (`c3-refrain-read-once`) | 1 (`c4-misread`) | 27/29 | 3/4 |

The stub is fooled in the cases where order matters (a pickup and a refrain), and it rejects the cases where the right words come out spelled differently (numbers, names, misreads). A real analyzer has to handle both. These numbers are a floor for comparison. They are not a target. The Phase 2 coverage model scores 0 false met, 0 false not met, 70/70 labels and 8/8 regions on the same set; see [the alignment spike](recording-coverage-alignment-spike.md).

## A permissioned corpus: `NARRATION_COVERAGE_CORPUS`

Set `NARRATION_COVERAGE_CORPUS` to a directory with the same layout (`manuscript.json` and `cases/*.json`). The harness then scores it together with the committed set, or alone with `--corpus-only`. In pytest, `test_the_permissioned_corpus_loads_and_scores` validates and scores it, and that test is skipped when the variable is unset. Its items can point at audio with `"audio": "<path inside the directory>"`. The audio stays outside the repository (Q15 option A) because of permissions and size, and because the manuscripts may be under copyright. An analyzer that cannot read audio skips those cases. A real corpus can extend the synthetic set or replace it, and once it exists, Phase 8's defaults can drop the "uncalibrated" label for the conditions it covers (implementation plan D19).

Nothing in the repo points the variable at anything by default, and the harness never writes to the corpus directory.

## Limits

- The words are synthetic text, so nothing here measures how often Whisper drops or garbles words in a clean read. That rate decides the false "not met" rate. Phase 8 simulated it and measured it on Piper renders: see [the calibration](recording-coverage-calibration.md).
- One synthetic speaking rate and no ASR timing jitter. Positions are only as good as `WORD_SECONDS`.
- Sixteen cases over four short chapters is enough to exercise every condition, but too few to make a rate meaningful. Report counts, not percentages.
- The editing-readiness PRD (ER Phase 1) needs its own audio corpus for clicks and breaths. It can reuse this layout (`manuscript.json`, `cases/*.json` with a `split`, a `*_CORPUS` directory variable), but its labels are time ranges, so it cannot reuse these files.
