[Using the app](README.md) › Review

# Review

Review gathers what the app's checks found into one list, so you can work through them in one place:
the differences a [Proofing](proofing.md) comparison heard between the script and the recording, and
the [Story Bible](story-bible.md) entries and pronunciations that need a look. Each finding waits in
the list until you accept, dismiss or defer it, and your decision is kept with the project. Running a
check again keeps your decision on a finding whose evidence did not change.

The line under the title counts the latest run's findings by status: to review, accepted, dismissed
and deferred.

![Review page listing findings from the Proofing comparison and the Story Bible](../../images/ui/review-default.webp)

Review is always in the navigation, even before a manuscript is imported. Until a check has found
something, it says there is nothing to review yet and where findings come from.

![Review page with nothing to review yet](../../images/ui/review-empty.webp)

## Filtering and sorting

The row of lists above the findings narrows them by status, by kind of finding, by the check that
found it, and by chapter, and chooses the order: by chapter, by project time, by confidence (lowest
first, so the least certain come up first) or by severity (most serious first). Only the kinds,
checks and chapters that have findings are offered.

- **Only findings scored 50% or more** hides the findings a check was less sure of. A finding with no
  score at all (the check had nothing to measure) is hidden too.
- **Include findings the latest run did not repeat** brings back findings from an earlier run that
  the latest one no longer produced. They are kept, marked "not in the latest run", so a decision you
  made on one is never lost.

**Clear filters** puts every filter back to showing everything, and keeps the order. A long list shows
its first 100 findings; **Show more** adds the next 100.

![Review page filtered to one check and to confident findings, at tablet width](../../images/ui/review-filtered.webp)

## A finding and your decision

Select a finding to see it in full beside the list (under it on a narrower window):

- what the script says and, for a Proofing difference, what the recording has;
- the chapter, the time in the REAPER project, which check found it, and how serious it is;
- the evidence: the kind of difference (misread, skipped, extra words), the script and recording
  around it, the pause measured at its boundary, a REAPER marker already there, or, for a Story Bible
  finding, why the entry needs a look;
- its confidence, and the check's reason for it.

**Show in manuscript** opens the [Manuscript](manuscript.md) at the finding's line (it needs an
imported manuscript), and a Story Bible finding also has **Open in Story Bible**.

![A transcript difference selected, with its evidence and the decision controls](../../images/ui/review-detail.webp)

**Accept**, **Dismiss** or **Defer** records your decision at once, with the note if you wrote one (up
to 2,000 characters). The page says it was saved, and the list and the counts update. **Reopen** puts a
decided finding back in the list to review.

A decision is always made on the evidence you are looking at. If the check ran again after you opened
the finding and the evidence changed, the decision is not saved: the page says so, shows the latest
version, and keeps your note, so you can look again and decide.

![A decision not saved because the check ran again since the finding was shown](../../images/ui/review-evidence-changed.webp)

Going to a finding in REAPER and playing it in a loop are not on this page yet.

---

[← Tracks](tracks.md) · [Index](README.md) · [Settings →](settings.md)
