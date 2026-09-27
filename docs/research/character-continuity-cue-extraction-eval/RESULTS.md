# Dialogue cue attribution: labeled-quote evaluation (Q4)

Phase 2 of [`character-continuity-review.prd.md`](../../prds/character-continuity-review.prd.md) asks for a
"[labeled-quote evaluation](../../prds/character-continuity-review.prd.md) reported (Q4)". This is that
evaluation, run against `extract_dialogue_cues` in
`sidecars/manuscript-guide/core/manuscript_guide.py`.

## Corpus and provenance

31 quotes across 3 chapters and 5 scenes, in an original synthetic manuscript authored for this evaluation
(`run_eval.py`'s `CORPUS`) - no real or copyrighted text. Written to exercise the PRD's three required
scenarios plus two extra edge cases:

- a clean two-person alternating exchange (name tags and continuation);
- a three-person scene (untagged lines must not guess between three people);
- a title-prefixed alias ("Captain Arelian" / "Arelian");
- an incidental, unnamed speaker who never became a Character entity ("the merchant");
- a genuinely ambiguous quote with no tag and no established speaker to alternate from;
- a paragraph with no dialogue at all (a missing cue).

This is a smaller seed set than the 50-100 hand-labeled quotes the PRD's Success Metrics table asks for -
that figure is the whole feature's calibration target (real narrator-confirmed manuscripts, tracked against
Phase 5's outlier findings), not a Phase 2 gate on its own. This evaluation demonstrates the methodology and
gives Phase 2's own success signal a real number; a larger, real-manuscript pass belongs with Phase 5's
calibration work, consistent with how Phase 1's own trial (`character-continuity-acoustic-trial.md`) already
used a synthetic corpus for the same D70/D71 reason (no network access to a real corpus in this environment).

## Ground truth methodology

Each paragraph's quotes are labeled in extraction order with either the true speaker's name, or `unknown`
for a quote that even a careful human reader could not confidently attribute - no tag, three or more active
speakers, or an incidental speaker who was never named as a Character entity. The extractor returning
`unknown` there is *correct*, not a miss (ADR 0020: precision over recall).

## Results

```
uv run --project ../../../sidecars/manuscript-guide python run_eval.py
```

| Metric | Value |
| --- | --- |
| Total quotes | 31 |
| Determinable quotes (a human could attribute them) | 26 |
| Genuinely ambiguous quotes | 5 |
| Attempted attributions | 27 |
| Correct attributions | 26 |
| Wrong attributions | 1 |
| Determinable quotes missed (left `unknown`) | 0 |
| Ambiguous quotes correctly left `unknown` | 4 / 5 |
| **Precision** (correct / attempted) | **0.963** |
| **Recall** (correct / determinable) | **1.0** |
| Ambiguous-quote correctness rate | 0.8 |

## The one wrong attribution: a known, documented limitation

Paragraph `p14` ("The usual being?") is genuinely ambiguous in a three-person scene (Elena, Mira, Toby), but
the extractor attributes it to Elena via continuation. The cause: continuation only tracks speakers
*established so far* in the scene by a resolved tag. At the point `p14` occurs, Toby has not yet spoken, so
the extractor sees only two active speakers (Elena, Mira) and alternates between them - the same mechanism
that correctly resolves `p9`/`p10` two paragraphs earlier, where it recovers the right speaker even from a
pronoun-only tag ("she said") purely from two-person alternation.

This is a real precision cost of the continuation heuristic, not a bug: it cannot look ahead to know a third
participant is about to join. It is exactly the kind of case the PRD's own risk table names ("Wrong dialogue
attribution creates false drift flags... mitigation: `unknown` on ambiguity, precision-first rules, correction
path, no flag without an attributed cue"). Two things already bound the damage:

1. **Confidence tiering.** `speaker_source` distinguishes `"tag"` from `"continuation"` on every cue (see the
   contract in `manuscript_guide.py`'s `extract_cues_from_text`/`extract_dialogue_cues`) precisely so a later
   consumer (Phase 5's candidate locator, Phase 6's review UI) can treat a continuation-sourced attribution
   with less confidence than a directly tagged one, rather than as equally certain evidence.
2. **The correction path** (`correct_cue`, this phase) lets the narrator fix exactly this kind of case once;
   `merge_dialogue_cues` guarantees a rebuild never overwrites that correction, the same durability ADR 0007
   already gives a locked Story Bible entity.

No change to the continuation rule is proposed here: narrowing it further (e.g. requiring a tag within the
last two paragraphs) would trade this one false positive for missed continuations in longer back-and-forth
exchanges, and the PRD's own Phase 1 gate is about acoustic features, not this rule - tightening cue
attribution further is better decided with real manuscript data in Phase 5, if this pattern turns out to be
common enough to matter.

## Reproducing

```bash
cd docs/research/character-continuity-cue-extraction-eval
uv run --project ../../../sidecars/manuscript-guide python run_eval.py --rows   # per-quote detail
```
