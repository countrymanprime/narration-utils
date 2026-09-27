# 0404. Production's "Next up" ranks chapters by held-back readiness, then stage, and the deadline is shown, not projected

**Status:** Proposed
**Date:** 2026-09-27

## Context

[Production Tracking](../prds/production-tracking.prd.md) Phase 4 adds the Production page. Its "Next up" list is "ranked by which chapter most threatens the deadline", and its success metric asks for an order that matches "a recorded expected order (nearest at-risk deadline first)". The concept mock (`mockups/production-tracking/01-production-home-concept.webp`, not yet owner-approved) also shows a pace projection ("On track · at current pace done Oct 9") and a burndown.

Two facts limit what can honestly be computed:

- The book has **one** deadline and no chapter has its own. Phase 3 (deadlines and milestones on the manifest, not landed yet) adds a book deadline and a generic milestone list (Q5 A). No per-chapter due date exists or is planned, so "nearest deadline first" cannot tell two chapters apart.
- A pace projection needs a rate of progress over time. Nothing records when progress happened: the time log records hours worked per chapter and stage (ADR 0320), and a chapter's status records where it is now, not when it got there. Projecting a finish date from those would mix hours worked with an estimated amount of work left, which is the "estimate presented as a fact" that ADR 0015 and ADR 0320 rule out. The PRD itself leaves burndown data to its Phase 6 (Could).

## Decision

**"Next up" order.** `production.BuildOverview` (`apps/desktop/internal/production/overview.go`) lists the narration chapters that are not finalized, at most five. A chapter with no content kind counts as narration, as the manuscript package reads it. They are ordered by these groups:

1. Chapters in progress (recording, editing or proofing) whose current stage the stage recommendations call `not_ready`. Something known holds them back.
2. Other chapters in progress: readiness `unknown`, `none` or `dismissed`, or not assessed.
3. Chapters in progress that look ready to move on (`recommended`). They need a confirmation on Home, not more work.
4. Chapters not started.

Within each group, the least advanced stage comes first, then book order. Readiness is always the stage recommendations' own verdict, read live (Q8 A) and never recomputed. The mock (`apps/ui/src/api/productionMock.ts`) applies the same order.

**The deadline is shown, not projected.** The page shows the due date and the whole calendar days left, counted by the host from the local date so the figure stays the same all day. Its tone is:

- neutral when more than a week is left;
- a warning at a week or less while any chapter is unfinished;
- danger once the date has passed;
- success when every chapter is finalized.

No finish date is projected from the pace so far.

**Readiness columns with no producer say "Not available".** On the board, Record, Edit and Proof come from the chapter's status and its current stage's readiness. Prep (prep depth) and Delivery (a delivery verdict tied to a chapter's file) have no per-chapter producer yet. Their columns render "Not available", as the PRD's risk table says, and come last so a narrow window shows the columns that have real answers first.

## Consequences

- The order is deterministic and tested (`TestNextUpOrdersChaptersByTheRiskTheyPutOnTheDeadline`), and it changes when a stage's readiness changes, which is the PRD hypothesis's third check. It does not change when the deadline moves: with one book-wide date, no chapter-level order could honestly change.
- If per-chapter milestones are ever added (a later extension of Phase 3's generic list), the ranking gains a first key, the nearest milestone. That supersedes this ADR's ordering rule.
- The concept mock's pace projection and burndown are not built. Once Phase 6 records burndown data, a projection can be decided in its own ADR, with how its uncertainty is shown.
- **Owner review needed** (#510): whether "held back first, then least advanced" is the risk order the owner wants, and whether the one-week warning threshold is right.
