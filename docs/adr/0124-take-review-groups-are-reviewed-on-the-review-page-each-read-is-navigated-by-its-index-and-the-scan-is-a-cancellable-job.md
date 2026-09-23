# 0124. Take-review groups are reviewed on the Review page, each read is navigated by its index, and the scan is a cancellable job

**Status:** Proposed
**Date:** 2026-09-23

## Context

`docs/prds/take-review-pickups-duplicates-take-intelligence.prd.md` Phase 5 shipped only part of its scope, because the
Review page did not exist yet: a synchronous `TakeReviewScan` binding, a `TakeReviewFindings` read-back, and a
`TakeReviewPanel` on the Tracks page with its own table, audition and "Add as take". The review dashboard milestone
has since delivered the Review page, its four generic findings bindings
([ADR 0120](0120-findings-are-read-and-decided-through-four-generic-bindings-and-a-decision-carries-the-evidence-version-it-was-made-against.md))
and Go to, Loop and Stop by GUID ([ADR 0121](0121-going-to-and-looping-a-finding-is-by-guid-and-source-time-makes-no-undo-point-and-stop-restores-what-the-loop-changed.md),
[ADR 0122](0122-the-review-page-asks-reaper-only-on-a-click-and-only-while-it-answers-and-a-refusal-is-an-answer.md)).
What remained was to put take review on that surface. Four things had to be settled:

- **Where take-review findings are browsed and decided.** Keeping the Tracks panel beside the Review page would mean two
  lists of the same findings, one of which could not record a decision.
- **How a group is navigated.** A pickup or duplicate-read finding groups several reads, each with its own item, take
  and range in its own source (`evidence.members`). The finding's `source` names only one of them and it has no
  `time_range`, so `FindingsGoTo(id)` could reach only that read, and `FindingsLoop(id)` none.
- **How the scan runs.** Transcribing every take of a chapter track takes minutes. ADR 0015 requires real progress, and
  the PRD asks for cancel. The sidecar's `--find-repeats` mode already writes the shared `stage|pct|message` progress
  file and stops at a `.cancel` file beside it.
- **When a read may be added as a take.** The PRD's user flow says take creation is for an accepted finding; the Tracks
  panel offered it for any finding.

## Decision

1. **Take review has no list of its own.** Its findings are read and decided on the Review page through the generic
   bindings, like every other analyzer's. `TakeReviewPanel`, `TakeReviewScan` and `TakeReviewFindings` are removed. A
   take-review finding's detail shows its reads (`TakeReviewReads`) in place of the finding-level REAPER row: each
   read's file and range in it, how much of the span it covers and how closely it matches the script, and nothing that
   ranks one over another (Q9). The page checks `evidence` against `takeReviewEvidenceSchema` before it shows or acts on
   the reads; evidence that does not match shows as generic evidence.
2. **A read is navigated by its index, through two more bindings.** `FindingsGoToRead(id, read)` and
   `FindingsLoopRead(id, read)` place `evidence.members[read]` by its own item and take GUIDs, over its own range in its
   source, and are refused in the same order and words as `FindingsGoTo` and `FindingsLoop`. The page sends only the id
   and the index; the host reads the GUIDs and times from the store, so the page cannot name an arbitrary item (threat
   model row 5f). The loop is the finding's, so `FindingsReaperStatus` names the finding and `FindingsStopLoop` stops
   it. A read index the finding does not have is an error, not a refusal: the page only offers the reads it was sent.
   REAPER plays the item's active take, so a read that is another take of its item is heard through the in-app
   audition (Phase 7), which the guide says.
3. **The scan is a job.** `TakeReviewScanStart(scope)` checks the scope (`takereview.ValidateScope`: a chapter track, at
   most one of a pickup track or a range, a range that is whole, forwards and not before zero) and that the named tracks
   are in the project, then runs the scan in the background with a progress path in the session folder.
   `TakeReviewScanState()` reports the sidecar's own percent and stage, each new stage appended as live activity, and
   the scope and the number of groups saved; idle, it offers the project's saved pickup scope (Q3, Q12 settings) for the
   dialog to start from. `TakeReviewScanCancel()` writes the sidecar's cancel file and cancels the process, and nothing
   is saved. One scan runs at a time, a running scan keeps the host from switching project, and the end is a
   `take_review` `job:ended` event (ADR 0076), so the dialog can be left with **Continue in background**. The dialog is
   the shared `WorkDialog`.
4. **Add as take is offered once the narrator accepts the group.** The Review page keeps it off, with the reason, until
   the finding's review status is `accepted`, and while REAPER is not connected. The target item and the candidate read
   are still chosen by the narrator and never preselected (Q4/Q8), and are chosen by the read's index, not its item
   GUID, since two reads can be takes of the same item. `TakeReviewCreateTake` and its executor (Phase 6) are
   unchanged; the host does not re-check the review status, since the take is the narrator's own confirmed action and
   the finding id is recorded as its provenance.

## Consequences

- One place lists and decides every finding; the Tracks page is back to tracks, playback and the REAPER tools.
- Host API 39 to 40: two bindings added, the scan's three replace the two synchronous ones, wire contracts for the job
  and for each read's navigation, and a golden of the take-review findings as `FindingsList` sends them.
- The scan's progress is only as fine as the sidecar reports it: one step per read transcribed.
- The per-read bindings are generic over any finding whose evidence lists `members` with item, take and range, not
  only take review's.
- A `take_review` scan that ends while the dialog is open is also announced by a toast, as a Story Bible rebuild is.
- `evidence.members` is now read by the host as well as shown; a change to its shape is a wire-contract change
  (`findings-list-take-review.json`, `takeReviewEvidenceSchema`).
