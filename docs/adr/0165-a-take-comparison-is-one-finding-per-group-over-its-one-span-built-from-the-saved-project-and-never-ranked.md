# 0165. A take comparison is one finding per group, over its one span, built from the saved project, and never ranked

- **Status:** Proposed
- **Date:** 2026-09-23

## Context and problem

Take review's last phase (phase 10 of the take-review PRD, now [docs/utilities/take-review.md](../utilities/take-review.md)) had to turn the take metrics of [ADR 0140](0140-take-metrics-are-per-category-evidence-over-a-takes-source-range.md) and the per-take divergence of [ADR 0141](0141-per-take-divergence-is-localized-by-the-markers-diff-and-asr-word-timestamps.md) into something the narrator can review: `take_comparison` findings and a comparison view on the Review page. Four things needed deciding. What a comparison is in the findings store, and how its identity and evidence version behave on a re-run. How "the same span" is guaranteed, so a comparison never sets different text side by side. Where the sidecar's inputs come from, since the `--take-divergence` manifest names audio files the sidecar opens (threat model row 4f). And how the evidence is shown without turning into a ranking (PRD Q9) or an action that changes the active take (Q8).

## Decision drivers

- A comparison must never set different text side by side.
- The `--take-divergence` manifest names audio files the sidecar opens (threat model row 4f).
- The evidence must not turn into a ranking (PRD Q9) or an action that changes the active take (Q8).

## Considered options

1. One unranked `take_comparison` finding per group, over its one span, built from the saved project
2. A narrator-weighted view (PRD Q9 B)
3. A "Make active" action (PRD Q8 B)

## Decision outcome

**Chosen option: one unranked `take_comparison` finding per group, over its one span, built from the saved project**, because a comparison must never set different text side by side, must take its sidecar inputs from the host, and must not rank the reads or change the active take.

- **One `take_comparison` finding per take-review group.** The narrator starts a comparison from a group (`TakeComparisonStart(findingId)`, a cancellable job with the sidecar's own progress, like the scan, [ADR 0124](0124-take-review-groups-are-reviewed-on-the-review-page-each-read-is-navigated-by-its-index-and-the-scan-is-a-cancellable-job.md)). The result is saved by `internal/takecompare` under the analyzer `take-comparison`, scoped by the group's finding id. Its id is `StableID("take-comparison", project, group id)`, so comparing the group again replaces it. Its evidence version hashes the whole evidence, so a decision survives a re-run only when every figure is the same (ADR 0120). It has no confidence score (`confidence: null`, with a reason) and no suggested action.
- **Same span, checked twice.** First, each read of the group is resolved in the saved project by its item and take GUIDs and must still play the same file from the same offset for the same length (within 2 ms); a read that moved, was trimmed, lost its take or its file is listed with its reason and not aligned or measured. At least two reads must pass. Second, every read that passes is aligned in one sidecar run to the group's one sentence span, and the answer is refused unless it is for that span and for exactly those takes, in order. A read in which none of the span's words were heard is listed as not compared: it does not read this part of the script.
- **The sidecar's inputs are the host's own.** The page sends only the group's id. The manifest (chapter id, span, takes) is built from the finding the store holds and the saved project's takes (their GUIDs, resolved source files, `SOFFS` and item length times playrate); the chapter id is the manuscript's own narration chapter whose display title is the one the scan aligned to; the manifest, results and progress paths are in the host's session folder and the manuscript is the project's canonical file. Nothing the UI typed reaches the sidecar's argv or manifest.
- **Evidence side by side, per category, in the group's read order.** `evidence.members` keeps the group's read order and each member's own item, take and source range, so Go to and Loop by index (`FindingsGoToRead`/`FindingsLoopRead`) and Audition work on a comparison exactly as on its group. Each compared member carries the sidecar's word statuses and divergences (snake_case, values unchanged) and `measure.MeasureTake`'s metrics, including the range report every figure comes from, so every figure can be reproduced from what is stored. The pause profile is measured over the span words the read has times for; level consistency is against the active takes of the items either side of the read's item on its track.
- **The view never ranks.** The Review page shows each read's words with every departure marked (not by colour alone) and listed with its time, then one table: a row per category with what it measures, a column per read, each cell a figure or "Unavailable" with its reason. Nothing sums the rows, orders the reads or names a best one, and there is no "Make active" action: the narrator chooses the take in REAPER (Q8 A).

### Consequences

- **Good:** The PRD's disagreement fixtures (word for word but noisy; clean but misread; clean but stopping early) show as separate evidence and never collapse into one number; `internal/takecompare`'s tests pin that, and that identical inputs give identical evidence and version.
- **Neutral:** A comparison is only as fresh as the saved project: the narrator must save in REAPER before comparing after an edit, and a comparison of reads that changed since the scan says so rather than guessing. A new scan that regroups the reads makes a new group id, so its comparison is new too; the old comparison ages out of its group's scope only when that group is compared again.
- **Bad:** The pause profile covers only this part of the script, not silences before or after it in the take, and a read that stops early has fewer words to profile.
- **Neutral:** Taking a take's words from the span alignment rather than from a full transcript avoids a second transcription, at the cost of the pause profile ignoring extra words the read said.
- **Neutral:** A later narrator-weighted view (PRD Q9 B) or a "Make active" action (Q8 B) needs a new ADR; neither is implied by this one.

### Confirmation

`internal/takecompare`'s tests pin that the PRD's disagreement fixtures show as separate evidence and never collapse into one number, and that identical inputs give identical evidence and version.
