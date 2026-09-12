# Take Intelligence

**Status: Planned.**

## User problem

When several takes cover the same line, a narrator needs fast, explainable comparison—not an opaque assertion about which artistic performance is best.

## Target workflow

Select an item with alternate takes or a reviewed duplicate group; align each take to the same manuscript span; A/B loop them in context; inspect evidence; choose the active take manually.

## Inputs and outputs

- Inputs: same-span REAPER takes, transcript/alignment results, local audio measurements, optional approved character references, and narrator-selected evaluation weights.
- Outputs: `take_comparison` findings with per-take evidence and separate technical/text/reference rankings.
- Narrator actions: constrain comparison scope, audition, inspect scoring reasons, adjust weights, choose the active take, or ignore rankings.

## Planned features

### MVP

- Validate that candidates map to the same manuscript span before ranking.
- Compare word fidelity, clipping/noise indicators, duration, pause profile, and basic level consistency.
- Provide A/B and context-loop controls with no automatic active-take change.
- Explain each metric and identify unavailable evidence rather than substituting a hidden estimate.

### Later work

- Separate "closest to approved character reference" evidence.
- Narrator-specific weighting presets and historical decisions for calibration.

## Non-goals and review boundary

No single numeric score defines a better performance. The utility cannot measure emotional truth, intention, or artistic preference, and it never auto-comps.

## Acceptance and risks

- Scoring remains stable for unchanged inputs and is reproducible from stored measurements.
- Missing transcript or reference evidence lowers coverage rather than falsely penalizing a take.
- Tests include disagreement between textual correctness, technical cleanliness, and performance preference.
- Main risk: users over-trusting a composite score; the interface must foreground evidence categories.
