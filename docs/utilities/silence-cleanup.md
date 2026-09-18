# Silence, Breath, and Click Cleanup

**Status: Planned.**

## User problem

Removing dead air, breaths, and clicks during review is manual and error-prone. REAPER's built-in dynamic split needs settings the narrator isn't confident tuning, and re-adding a wrongly-trimmed edge means undo or manually dragging it back. A destructive editor like Audacity raises the stakes further, since a bad cut there isn't cheaply reversible.

## Target workflow

Run the analyzer over a selected chapter or range; review proposed cut/trim points as REAPER markers in a preview pass with no audio changed yet; adjust thresholds or reject individual candidates; approve to commit non-destructive item/take trims and splits.

## Inputs and outputs

- Inputs: local source audio, project item/take boundaries, narrator-configured thresholds (silence floor, minimum breath length, pad/hold time), optional saved preset.
- Outputs: `silence_cleanup` findings with candidate region boundaries, a classification (silence/breath/click), confidence, and a `suggested_action` (split+trim) that only executes on explicit approval.
- Narrator actions: choose scope, tune thresholds/presets, preview markers, approve or reject each candidate (or the whole batch), undo after commit like any other REAPER edit.

## Planned features

### MVP

- Energy/RMS-based silence detection with a minimum-duration floor, informed by lightweight breath/click heuristics (spectral shape, transient detection) so a breath or plosive onset isn't misread as trimmable silence.
- Preview mode: place non-destructive REAPER markers/regions for every candidate before any edit — no automatic commit, ever.
- Approve-all or per-candidate commit, wrapped in an undo block; every trim only moves item/take edges, since source media is never rendered or deleted.
- Threshold presets stored via the existing layered project/user/repo settings.

### Later work

- Auto-tuning thresholds from a short narrator-approved calibration pass.
- Batch preview across a full chapter or book behind a single approval gate.
- Share detection logic with [Narration Diagnostics](narration-diagnostics.md) instead of duplicating silence/level measurement.

## Non-goals and review boundary

The utility never commits a trim without explicit narrator approval, never processes or renders audio destructively, and does not try to distinguish an intentional dramatic pause from cuttable dead air without narrator-set thresholds — ambiguous cases stay in preview for a decision.

## Acceptance and risks

- A previewed candidate's marker position matches the eventual trim boundary exactly.
- Declining a candidate leaves the item byte-for-byte unchanged.
- Tests cover a breath immediately after a plosive, a click inside otherwise-silent audio, and a long intentional dramatic pause near the threshold.
- Main risk: misclassifying a breath or soft consonant onset as silence — mitigated by the preview-then-approve gate rather than aiming for one-shot accuracy.
