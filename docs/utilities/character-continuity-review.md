# Character Continuity Review

**Status: Planned.**

## User problem

In a long production, a narrator may unintentionally shift a character's vocal characteristics. Manual continuity review is slow and hard to prioritize.

## Target workflow

Use character data and dialogue cues to locate likely lines; explicitly approve one or more REAPER reference regions per character; analyze later candidate lines; review possible deviations in context; document intentional changes.

## Inputs and outputs

- Inputs: Manuscript Guide character IDs/aliases, approved reference regions, candidate dialogue ranges, and local acoustic features.
- Outputs: `character_continuity` findings with reference IDs, measured feature differences, confidence, and contextual manuscript evidence.
- Narrator actions: approve/revoke references, define scope, audition candidates, accept/dismiss/defer findings, and annotate intentional changes.

## Planned features

### MVP

- Store reference-region identity and approval metadata in a project sidecar.
- Measure explainable features: pitch distribution, speaking rate, energy, and broad spectral/vocal-color indicators.
- Flag outliers against the approved reference baseline with confidence and A/B audition.
- Link results to character/scene context supplied by Manuscript Guide.

### Later work

- Multiple intentional voice modes per character and session-condition baselines.
- Assisted review of ambiguous dialogue attribution.

## Non-goals and review boundary

The utility does not automatically identify fictional characters from any voice, diagnose accents, judge whether a performance is "in character," or use unapproved recordings as reference truth.

## Acceptance and risks

- Only explicit approved regions affect a character baseline.
- Intentional deviations can be dismissed with a note and do not repeatedly reappear for identical evidence.
- Tests include the narrator's normal voice, overlapping character voices, narration versus dialogue, and missing/ambiguous speaker cues.
- Main risks: recording-chain changes, limited reference samples, and misleading semantic interpretations of acoustic metrics.
