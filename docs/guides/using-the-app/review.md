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

## Going to a finding in REAPER

A finding from a Proofing comparison has an **In REAPER** row. It works when you opened the app from
the Narration Utils action in REAPER and REAPER is still running; the app checks every few seconds
and sends REAPER nothing until you press a button.

- **Go to in REAPER** selects the finding's item, and only that item, and puts the edit cursor on the
  spot. The page says where the cursor went.
- **Loop in REAPER** plays the finding with two seconds either side, over and over: it sets the time
  selection and the loop points to that window, turns repeat on and presses Play. Loop on another
  finding moves the loop there.
- **Stop loop** appears while a loop is playing, on every finding. It stops playback and puts back
  your own time selection, loop points and repeat. Anything you changed yourself while the loop
  played is kept.

None of these edits your project or adds an undo step. A finding is found by its REAPER item, never by
its old project time, so it is still found after you move the item.

![A finding looping in REAPER, with Stop loop](../../images/ui/review-reaper-looping.webp)

- **Add marker in REAPER** puts one take marker on the finding's spot, after you confirm. It is off
  until you accept the finding. The marker is named like the ones **Export markers** on the Proofing
  page adds, for example `MISREAD: 'pink eyes' as 'pale eyes'`, so Export does not add it a second
  time. If the take already has a marker of the same kind there, nothing is added and the page says
  so. This is the only button here that changes your project, and one Undo in REAPER removes the
  marker.

![The confirm before an accepted finding gets its marker in REAPER](../../images/ui/review-reaper-marker-confirm.webp)

When REAPER cannot do it, nothing in REAPER changes and the page says why:

- **the finding's audio changed.** The item was deleted, lost the take the check heard, or was
  trimmed so the spot is no longer in it. Run the check again to find it where it is now.
- **REAPER is recording.** Stop recording first.
- **the script in REAPER is older than the app.** Import it again from the app's REAPER folder.
- **the finding came from an older check** that did not record its REAPER item. The buttons are off;
  run the check again.

![Go to refused because the finding's item is no longer in the REAPER project](../../images/ui/review-reaper-stale.webp)

When REAPER is not connected, Go to, Loop and Add marker are off and the reason is under them. If you opened the
app on its own, open it from the Narration Utils action in REAPER instead. If REAPER was closed or the
action stopped, start it again; the buttons turn back on by themselves. A Story Bible finding has no
audio, so it has no REAPER row.

![Go to and Loop off because REAPER is not answering](../../images/ui/review-reaper-not-connected.webp)

---

[← Tracks](tracks.md) · [Index](README.md) · [Settings →](settings.md)
