# 0126. Recording coverage reads the take markers' SequenceMatcher alignment and folds chance matches into gaps

- **Status:** Proposed
- **Date:** 2026-09-23

## Context and problem

`docs/prds/recording-coverage-analysis.prd.md` needs to know which words of a chapter's body a recording contains, in order (Definitions, Q1). Q2 was answered on 2026-09-23: reuse the `difflib.SequenceMatcher` opcodes that `diff_and_build_markers` in `sidecars/transcript-compare/core/compare.py` already computes for the take markers, unless the Phase 2 spike's fixtures fail, and in that case move to a word-level DP alignment. The PRD's Definitions judge each opcode on its own: a short `equal` block between two non-equal blocks is a chance match, and a `replace` block of at most `max_misread_run` tokens is a misread. Taken one opcode at a time, that rule breaks both ways. `SequenceMatcher` cuts unrelated speech into small `replace` blocks around a shared "the" or "of", and each small block would pass as a misread. A run of misreads with two matching words between them would lose those two words as chance matches.

The spike (`docs/research/recording-coverage-alignment-spike.md`) scored both aligners with the same coverage rules. It used the 16 committed cases from ADR 0125 and 104 cases generated from the same chapters (every paragraph dropped, false-started, read twice, replaced by unrelated speech, misread one word in six, picked up at the end, and its first sentence dropped). It also timed both on a chapter-sized input of about 6,000 tokens.

## Decision drivers

- Q2's answer: reuse the `SequenceMatcher` opcodes the take markers already compute, unless the spike's fixtures fail, and move to a word-level DP alignment in that case.
- Judged one opcode at a time, the PRD's rules break both ways: unrelated speech passes as misreads, and matching words between misreads are lost as chance matches.
- The markers and the marker algorithm must stay unchanged.

## Considered options

1. Reuse `diff_and_build_markers`' `SequenceMatcher` alignment and fold chance matches into gaps
2. A word-level DP (LCS) alignment
3. Judge each opcode on its own, as the PRD's Definitions do

## Decision outcome

**Chosen option: reuse `diff_and_build_markers`' `SequenceMatcher` alignment and fold chance matches into gaps**, because on the spike's fixtures it had no false "met" and no false "not met" and agreed with every committed paragraph label, and the spike did not show the failure that would justify a DP.

- **Alignment.** Coverage uses the alignment `diff_and_build_markers` already returns. Its alignment dict now also carries the two token sequences the opcodes index (`doc_tokens`, `audio_tokens`). The markers and the marker algorithm are unchanged, and a golden test holds them byte-identical (`tests/test_marker_golden.py`). The DP prototype stays in test tooling (`tests/coverage_spike.py`) and is not shipped.
- **Model.** `sidecars/transcript-compare/core/recording_coverage.py` is a pure function from that alignment to per-paragraph present counts, missing runs and typed regions. It does not import `compare.py`, so the Phase 3 sidecar mode can import it.
- **Anchors and gaps.** An `equal` block of at least `min_anchor_run` tokens is an anchor. A shorter one is also an anchor when it sits at either end of the alignment or next to another `equal` block (the hyphen fuse creates those). Everything between two anchors is one gap, and the PRD's rules apply to the whole gap, not to each opcode. If the gap has no transcript, its text is missing. If it has at most `max_misread_run` body tokens, up to `min(body, said)` of them are present as a misread and the rest are a short read. A larger gap is missing: a `skip` when at least half of what was said in it is chapter text read again, and `different_text` otherwise.
- **Heading.** The title and the subtitle go into the aligned token stream as optional heading tokens. They never count toward the denominator, never count as missing, and are not extra when read (Q11).
- **Parameters.** The alignment parameters (`max_misread_run` 8, `min_anchor_run` 3) are fixed for a result. The narrator's thresholds (`min_paragraph_present` 0.95, `max_missing_run` 3) are applied on read. All four are the PRD's Proposed starting values and stay uncalibrated until a real corpus exists (Q3, Q15).

### Consequences

- **Good:** Coverage and the take markers can never disagree about what was read, because they share one alignment.
- **Good:** On the spike's fixtures, SequenceMatcher had no false "met" and no false "not met", and it agreed with every committed paragraph label. The LCS prototype had the same verdicts, but it agreed with fewer labels (it scatters matches across a skipped paragraph's neighbour), took about twice as long (118 ms against 62 ms), and needed a 66 MiB score matrix. The spike did not show the failure that would justify a DP.
- **Bad:** A known limit, shared by both aligners: when a pickup recorded at the end is longer than the text after its place, the in-order alignment credits the pickup and blames the text after it. The verdict is still "not complete", and the region names a neighbouring paragraph. Relocating pickups is out of scope (the PRD's Won't list).
- **Bad:** A gap of up to `max_misread_run` tokens always counts as a misread, so a paragraph of eight words or fewer replaced by other speech counts as present. That is the price of the bound, and Phase 8 calibration can change it.
- **Neutral:** Moving coverage to a DP alignment later needs a new ADR that supersedes this one, with the harness numbers that justify it. The spike module and the golden markers make that comparison repeatable.

### Confirmation

A golden test (`tests/test_marker_golden.py`) holds the markers byte-identical; the spike module (`tests/coverage_spike.py`) and the golden markers make a comparison of aligners repeatable.

## Pros and cons of the options

### A word-level DP (LCS) alignment

- Good, because it had the same verdicts on the spike's fixtures.
- Bad, because it agreed with fewer paragraph labels (it scatters matches across a skipped paragraph's neighbour).
- Bad, because it took about twice as long (118 ms against 62 ms) and needed a 66 MiB score matrix.

### Judge each opcode on its own

- Bad, because `SequenceMatcher` cuts unrelated speech into small `replace` blocks, and each would pass as a misread.
- Bad, because a run of misreads with two matching words between them would lose those two words as chance matches.
