# Clause Splitting and Level Normalization

**Status: Planned.**

## User problem

Splitting a take into separate sentence or clause items and normalizing each to a common loudness point is manual, repetitive work every narrator does during review.

## Target workflow

Select an item or range; preview proposed clause-boundary split points; approve to split into separate items; measure and normalize each resulting item to a narrator-set RMS or LUFS target via non-destructive gain.

## Inputs and outputs

- Inputs: selected REAPER item(s), transcript word-level timing where available, a narrator-set loudness target (RMS or integrated LUFS) and tolerance.
- Outputs: split item boundaries (reusing the same preview/approve marker mechanism as [Silence Cleanup](silence-cleanup.md)) and a per-item gain adjustment applied via item/take volume, not rendered audio.
- Narrator actions: choose split scope, review and adjust proposed boundaries before committing, set the loudness target, approve the gain pass.

## Planned features

### MVP

- Propose clause/sentence boundaries from existing transcript word timestamps; preview as markers before splitting, sharing the split-and-approve mechanism built for Silence Cleanup.
- Measure per-item RMS or integrated LUFS (ITU-R BS.1770) and compute the gain delta needed to hit the target.
- Apply gain via REAPER item/take volume (or a take volume envelope) — never by rendering or otherwise destructively processing audio.
- Report each item's before/after level so the narrator can spot outliers instead of trusting a silent global change.

### Later work

- Per-chapter or per-book consistency reports once [Narration Diagnostics](narration-diagnostics.md) measures levels across a whole book.
- Configurable per-genre or per-character loudness targets.

## Non-goals and review boundary

The utility does not master or otherwise process audio content. Every split or gain change is a reversible REAPER parameter change wrapped in an undo block, never a rendered edit.

## Acceptance and risks

- A committed split's boundaries match the previewed markers exactly.
- Re-running normalization on already-normalized items converges instead of drifting further from the target.
- Tests cover clauses with no clear transcript timing, items already at target level, and short interjections near the minimum split length.
- Main risk: a transcript timestamp gap or misalignment producing a bad split point — mitigated by the same preview-before-commit gate as Silence Cleanup.
