# Workflow: Chapter Stage Progression

## Goal

Tell a narrator when the evidence says a chapter's current stage is over, without ever changing its status,
audio or manuscript by itself.

## The three rules

A chapter's status (`Not Started`, `Recording`, `Editing`, `Proofing`, `Finalized`) is set by hand in the Home
breakdown table's `<select>`, which stays the narrator's override. Beside it, the app suggests the next stage
from evidence it already holds, one rule per advance:

1. **Recording to Editing.** Every paragraph of the chapter's narration text is present, in manuscript order, in
   the chapter's recorded audio. Misreads count as present; extra reads and false starts do not count against
   it. See [the recording check](../utilities/recording-coverage.md).
2. **Editing to Proofing.** Over every played range of the chapter's audio, zero open candidates remain in each
   required class (empty space to trim, clicks, breaths), from a complete analysis at the current fingerprint.
   See the editing check ([the audio engine panel](../guides/using-the-app/navigation.md#editing-check)).
3. **Proofing to Finalized.** Zero open pickups from every source the narrator has marked required, and every
   required delivery or performance check is met; a check that is unavailable is unknown, never good. See
   [Take review](../utilities/take-review.md) (pickups) and [Master & QC](../guides/using-the-app/master-and-qc.md).

## Flow

1. Home's estimate card shows how many chapters have a suggestion; expanding the breakdown lists each chapter's
   verdict beside its status.
2. A chapter ready to advance reads "Suggested: `<stage>`"; **Why** opens the evidence behind it (what was
   checked, the basis and its age, and for anything unknown, what resolves it). The same wording appears, read
   only, under a chapter's title in the Manuscript page's Chapters & Search panel, and interactively on the
   Proofing page for chapters currently in that stage.
3. The narrator clicks **Confirm**, which sets the status and records the basis, or **Dismiss**, which hides
   that suggestion until the evidence it was computed from changes.
4. If evidence gathered after a confirmation contradicts it, Home shows "Evidence changed since you confirmed"
   with **Revert**. Nothing else moves on its own.

## Safeguards

- Never advance, downgrade or dismiss a chapter's status by itself; every change is one narrator click.
- `unknown` (not analyzed, a track not linked, a check still running) is never treated as met - a false "done"
  hides more real work than a false "not done" costs in extra clicks.
- A dismissal returns only when the exact evidence it was based on changes, never on a timer.

## Success signals

- A narrator trusts that a chapter marked ready has never been claimed done on missing evidence.
- Chapter status stays close to reality with less manual bookkeeping than setting the `<select>` from memory.
- A suggestion the narrator disagrees with is easy to see why (the evidence view) and easy to dismiss.

---

Delivered by the chapter stage recommendations PRD (`docs/prds/chapter-stage-recommendations.prd.md`, deleted;
see [the signal contract](../architecture/stage-recommendations.md), [ADR 0160](../adr/0160-stage-recommendations-are-computed-from-tri-state-signals-by-a-pure-engine.md) and
[ADR 0161](../adr/0161-stage-decisions-live-in-their-own-sidecar-and-confirm-writes-the-record-before-the-status.md)).
The end-to-end verdict is validated against synthetic and public-domain material only so far; see
[ADR 0364](../adr/0364-the-end-to-end-corpus-validation-is-synthetic-and-provisional-until-a-permissioned-project-re-runs-it.md).
