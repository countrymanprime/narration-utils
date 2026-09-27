# 0320. PFH and the effective rate come only from logged hours and measured recorded time

**Status:** Proposed
**Date:** 2026-09-27
**Supersedes:** none

## Context

The [production tracking PRD](../prds/production-tracking.prd.md) (Phase 2, Q4) adds two figures a narrator otherwise works out in a spreadsheet: **PFH**, hours worked per finished hour, and the **effective hourly rate**, what the book pays per hour worked. The app can reach two different "finished runtime" numbers for a chapter:

- the measured recorded seconds of its one confirmed track (`tracks.Track.RecordedSeconds`, [Actual Recorded](../prds/actual-recorded-column.prd.md)); and
- the word-count estimate on Home (`estimateFinishedHours`, 9,300 words per finished hour).

A PFH that falls back to the estimate would look complete from the first day, but it would present a guess as a measurement. [ADR 0015](0015-real-progress-only.md) and the Actual Recorded PRD already rejected that for progress and recorded length. The rate has the same problem when no contracted amount has been entered: 0 and "a guess" both read as facts.

## Decision

PFH and the effective rate are computed only from hours the narrator logged with the stage timer and audio the app measured. A figure with no honest input is **undefined** (`ok == false`, shown as "—"), never 0 and never an estimate. The definitions live in `apps/desktop/internal/production/pfh.go`:

- **Logged hours** are the durations of stopped sessions only. A running timer has logged nothing yet, and a session whose end is before its start logs 0.
- **Chapter PFH** is the chapter's logged hours, all stages together, divided by its measured recorded hours. It is undefined when the chapter has no measurement (no confirmed track, or no readable project), when it measures 0, or when no time is logged on it.
- **Book PFH** is every logged hour on the book divided by every measured recorded hour so far. An unmeasured chapter, or one measured at 0, adds nothing to the recorded total, but its logged hours still count, because they were worked on the book. It is undefined until some audio is measured and some time is logged.
- **Effective rate** is the contracted amount divided by every logged hour. It is undefined with no amount set, with an amount that isn't a finite, non-negative number, or with no logged hours. An amount the narrator set to 0 gives an honest 0. The amount is a bare number in the narrator's currency; Go never converts or formats it.
- Recorded seconds reach the package through the `production.Recorded` port, a function returning measured seconds per chapter. The package never parses a project or reads links itself; the host adapts the existing recorded-lengths provider (`recordedlengths.go`) to it. A NaN, infinite or negative value is ignored as not a measurement.

## Consequences

- The Production page (Phase 4) and the status report (Phase 5) show "—" early in a book, when little audio is measured. That is the intended signal, and the PRD's risk table covers labelling it ("not enough measured time yet").
- Book PFH runs high while most logged time is on chapters not yet measured. It converges as chapters are linked and recorded. This is accepted rather than mixing in an estimate.
- Hours stay on the book after a manuscript replace, even when a session's chapter id no longer exists: they still count toward book hours and the rate.
- Falling back to the word-count estimate, or showing 0 for an undefined figure, would need a new ADR that supersedes this one.
