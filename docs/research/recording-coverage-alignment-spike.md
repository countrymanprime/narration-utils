# Recording coverage: the coverage model and the alignment spike

**Status: decided, 2026-09-23.** This is Phase 2 of [`recording-coverage-analysis.prd.md`](../prds/recording-coverage-analysis.prd.md), under Q1, Q2, Q3 and Q11 as answered on 2026-09-23. The spike kept `SequenceMatcher`. [ADR 0126](../adr/0126-recording-coverage-reads-the-take-markers-sequencematcher-alignment-and-folds-chance-matches-into-gaps.md) records the decision and the gap rule, and this note records the measurements behind them.

## What is here

| Path | What |
| --- | --- |
| `sidecars/transcript-compare/core/recording_coverage.py` | The coverage model. It is a pure function from one alignment to per-paragraph present counts, the longest missing run and typed regions (`head`, `tail`, `skip`, `short_read`, `different_text`), each naming its paragraph ids and its first and last manuscript words. Thresholds are applied on read. |
| `sidecars/transcript-compare/core/compare.py` | Unchanged except that the alignment dict `diff_and_build_markers` returns now also carries `doc_tokens` and `audio_tokens`, the sequences its opcodes index. |
| `sidecars/transcript-compare/tests/coverage_spike.py` | Test tooling. It holds the coverage analyzer for the Phase 1 harness, the DP prototype (`lcs_opcodes`), the generated stress cases and the benchmark. Running it prints the tables below. |
| `sidecars/transcript-compare/tests/test_coverage.py`, `test_coverage_spike.py` | The Definitions as tests, and the spike's results pinned so a regression fails `pnpm check`. |
| `sidecars/transcript-compare/tests/test_marker_golden.py`, `fixtures/coverage/markers.golden.json` | The markers `diff_and_build_markers` produces for every committed case, byte for byte. The file was written before the change and still matches after it. |

## The model in one paragraph

Coverage reads the opcodes the take markers come from, so the two cannot disagree. An `equal` block of at least `min_anchor_run` (3) tokens is an anchor. A shorter block is also an anchor when it sits at either end of the alignment or next to another `equal` block. Otherwise it is a chance match. Everything between two anchors is one gap, and the rules are applied per gap, not per opcode. A gap with no transcript is text not read. A gap of up to `max_misread_run` (8) body tokens is a misread: up to `min(body, said)` of its tokens count as present, and the surplus is a short read. A larger gap is missing. It is a `skip` when at least half of what was said in it is chapter text read again (a retake, or the tail of a false start), and `different_text` otherwise. Missing text before the first present token is `head`, and after the last it is `tail`. The title and subtitle are optional heading tokens. They are outside the denominator and never count as extra (Q11). A chapter is `text_complete` when every paragraph has a present fraction of at least `min_paragraph_present` (0.95) and no missing run, counted across paragraph boundaries, is longer than `max_missing_run` (3). All four numbers are the PRD's Proposed starting values and are uncalibrated (Q3, Q15).

The gap rule refines the PRD's per-opcode wording. Taken one opcode at a time, `SequenceMatcher`'s habit of splitting unrelated speech around a shared "the" or "of" turns it into several small `replace` blocks that each pass as a misread. The same wording would also drop the two correctly read words between two nearby misreads as a chance match. The `unrelated_speech` and one-in-six `misread` stress cases below are the tests for both problems.

## Fixtures

- **Committed**: the 16 cases of the Phase 1 set (`tune` 9, `held_out` 7), with their labels unchanged.
- **Generated stress set**: 104 cases built by `stress_cases()` from the same four chapters. For every paragraph there is a case where it is dropped (head, skip or tail), false-started for six words with an aside and then read, read twice (a retake after a good read), replaced by unrelated speech of its own length, and misread one word in six. For every paragraph but the last there is a pickup case: skipped in place and read at the end. For every paragraph with more than one sentence there is a case with its first sentence dropped. The labels follow the Phase 1 rules. Every case is built through `harness.build_case`, so the loader's consistency checks apply to it.
- Numbers, homophones, hyphens and title reads are covered by the committed `c4-names-and-numbers`, `c1-title-read` and `c2-subtitle-read` cases and by unit tests through `compare.py`'s own tokenizing.

## Results

`uv run python sidecars/transcript-compare/tests/coverage_spike.py`, 2026-09-23, default parameters:

| Aligner | Set | Cases | False met | False not met | Paragraph labels agreed | Regions located | Same kind |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SequenceMatcher | tune | 9 | 0 | 0 | 41/41 | 4/4 | 4/4 |
| SequenceMatcher | held_out | 7 | 0 | 0 | 29/29 | 4/4 | 4/4 |
| SequenceMatcher | stress | 104 | 0 | 0 | 455/461 | 50/53 | 50/53 |
| DP (LCS) | tune | 9 | 0 | 0 | 40/41 | 4/4 | 3/4 |
| DP (LCS) | held_out | 7 | 0 | 0 | 29/29 | 4/4 | 4/4 |
| DP (LCS) | stress | 104 | 0 | 0 | 451/461 | 51/53 | 47/53 |

Benchmark: a chapter of 6,020 tokens against a transcript of 5,705 tokens (the committed paragraphs repeated, with a paragraph skipped and a false start every few paragraphs), best of three runs:

| Aligner | Time | Memory |
| --- | --- | --- |
| SequenceMatcher (`autojunk=False`) | 62 ms | negligible |
| DP (LCS, numpy, one row at a time, full traceback matrix) | 118 ms | 66 MiB score matrix (uint16) |

For comparison, the Phase 1 order-blind stub had 2 false "met" and 2 false "not met" on the committed set.

## Where each aligner goes wrong

- **Both: a long pickup.** In `c-0002-pickup-2`, `c-0003-pickup-3` and `c-0004-pickup-1`, the paragraph read again at the end is longer than the text after its place. An in-order alignment then credits the longer reading, the pickup, and marks the text after its place as missing (`tail`). The verdict is still "not complete", which is right, but the region names the wrong paragraph. These are all 6 of SequenceMatcher's paragraph-label misses and all 3 of its region misses. No in-order alignment can do better here, because moving a pickup back to its place is out of scope (Won't).
- **DP only: scattered matches.** The LCS takes any extra match. In the committed `c2-pickup-at-end` and in four generated cases (`c-0002-drop-1`, `c-0002-pickup-1`, `c-0002-drop-sentence-1`, `c-0003-drop-4`), it pairs common words across the gap and leaves the end of the preceding paragraph as a string of short blocks. Those fall below `min_anchor_run`, so that paragraph drops to `partial` and the region grows to take it in. The verdicts are unchanged, but the labels are worse.

## Decision

Keep `SequenceMatcher` (Q2 option A). It passes every committed fixture with the right verdict, every label and every region kind, and it never gives a false "met" on the stress set. The DP prototype is no better on any fixture, is worse on labels, is twice as slow and needs a large matrix. The owner's rule was to move to a DP only if the fixtures fail, and they do not. A banded DP was not built, because the full LCS already shows that DP scoring is not what limits the results. What limits them is the pickup case, and no in-order aligner fixes that.

## Limits

- The transcripts are perfect. Nothing here measures how often Whisper drops or garbles words. That rate sets the real false "not met" rate, and Phase 8 measures it on audio.
- A paragraph of `max_misread_run` (8) words or fewer, replaced by other speech, counts as present. That comes from bounding misreads by length, and the stress set has no paragraph that short.
- `sail` is in the bundled homophone list as `sale`, so "sail cloth" read against "sailcloth" does not fuse. It counts as a one-word misread with one extra word, and the take markers show the same thing. This is not a coverage problem, and it is noted here only because the unit tests use a different compound word for that reason.
- Four short chapters and generated variants give counts, not rates.
