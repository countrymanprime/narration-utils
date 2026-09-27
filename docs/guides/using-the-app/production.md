[Using the app](README.md) › Production

# Production

Production answers "am I on pace?" for the book you have open: how much audio is finished, how many hours
you have worked and on which stages, your hours per finished hour (PFH), your effective hourly rate, how
far away the delivery date is, and which chapters to work on next. It needs an imported manuscript, so it
stays locked in the navigation until you [import one on Home](home.md).

Every figure comes from two things only: hours you logged with the stage timer, and audio the app
measured on each chapter's confirmed REAPER track. Nothing is estimated from the word count except the
target runtime beside **Finished audio**, which says it is one. A figure with nothing honest to work from
shows a dash (—) and says why, rather than 0.

## The figures

- **Finished audio**: the measured length of every chapter with a confirmed track, against a target
  estimated from the word count.
- **Work time logged**: every stopped timer added up, and split by stage (record, edit, proof).
- **Hours per finished hour**: hours logged divided by measured audio. It stays a dash until both exist.
- **Effective rate**: the contracted amount for the book divided by the hours logged, in your own
  currency. It stays a dash until a contracted amount is set.
- **Delivery date**: the days left until the book is due. It turns to a warning in the last week while
  chapters are unfinished, and to red once the date has passed. It stays a dash until a date is set.
- **Chapters finalized**: how many chapters are marked Finalized.

Setting the delivery date and the contracted amount is not in the app yet: both arrive with deadlines and
milestones in a later release.

## The stage timer

Each chapter under **Next up** has **Start timer**, which starts timing the chapter's current stage. While
a timer runs, a bar at the top of the page names the chapter and stage, with **Stop timer**. Only one timer
runs at a time: stop it before you start another. Time is logged only while you run a timer, never from
REAPER activity, and starting or stopping a timer never changes a chapter's status.

## Next up

**Next up** lists up to five chapters, in the order they most threaten the delivery date: first the
chapters whose current stage is held back by something a check found (for example, the end of a chapter
not read), then the other chapters in progress, least advanced first, then those that look ready to move
on (confirm them on Home), then the chapters not started.

## Chapter pipeline

The board has one row per chapter. **Recorded** is its measured length. **Record**, **Edit** and **Proof**
say **Done** for a stage the chapter has passed, **Not yet** for one ahead of it, and for its current stage
what the [stage suggestion on Home](home.md) says: **Ready**, **Not ready**, **Not checked** or **In
progress**. **Prep** and **Delivery** say **Not available**: no check reports them per chapter yet. The
board scrolls sideways in a narrow window; use the arrow keys to move from cell to cell.

---

[← Home](home.md) · [Index](README.md) · [Manuscript →](manuscript.md)
