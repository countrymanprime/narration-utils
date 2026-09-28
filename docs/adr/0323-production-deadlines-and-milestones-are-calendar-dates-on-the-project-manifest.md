# 0323. Production deadlines and milestones are calendar dates on the project manifest

**Status:** Proposed
**Date:** 2026-09-27
**Supersedes:** none

## Context

The production tracking PRD (delivered and deleted; `git log --diff-filter=D -- docs/prds/production-tracking.prd.md` finds it) Phase 3 adds the book's delivery deadline, the contracted amount and a list of milestones (Q3, Q5); how it works now is in [Production](../guides/using-the-app/production.md). Q3's recommendation (A) puts them on `project.Manifest` beside `Credits`, so they survive Replace manuscript and Clear derived data. Its Technical Approach sketches the deadline as `Deadline *time.Time`.

A deadline is a day, not an instant. The narrator picks "1 December". A `time.Time` records an instant in some zone, so the same stored value can show as 30 November or 2 December depending on where and when it is read. The app would also have to choose a time of day the narrator never gave. Milestone due dates have the same problem.

## Decision

- **Where they live:** the deadline, the contracted amount and the milestones are additive, `omitempty` fields on `project.Manifest` (`apps/desktop/internal/project/manifest.go`): `Deadline string`, `ContractedAmount *float64` and `Milestones []Milestone{Name, DueDate, Note}`. They survive Replace manuscript and Clear derived data exactly as `Credits` does.
- **Dates:** every date is a calendar date, stored and sent as a `"YYYY-MM-DD"` string, never a `time.Time`.
  - `production.CheckDate` accepts only a real date in that form.
  - The UI's `productionPlanSchema` checks the same pattern.
  - Any comparison with "today" happens in the narrator's local calendar, where the page renders it.
- **Checks before saving,** in `apps/desktop/internal/production/plan.go`, called by the bindings in `apps/desktop/bindings_production.go`:
  - A milestone needs a name and a real date. A note is optional. Nothing else about a milestone is validated (Q5 A), so the ACX 15-minute checkpoint is a milestone like any other.
  - A list has at most 100 milestones, each name at most 200 characters and each note at most 2,000.
  - The amount is a finite number of zero or more, in the narrator's own currency. It is not converted or formatted.
  - A save that fails any check is refused whole, and nothing is written.
- **Bindings:** `ProductionPlan`, `ProductionSetDeadline(deadline, contractedAmount)` and `ProductionSaveMilestones(milestones)` each answer the whole plan (`production.Plan`).

## Consequences

- A stored date means the same day wherever and whenever the file is read. There's no zone to migrate.
- A hand-edited `project.json` with a malformed date or a negative amount fails the UI's schema loudly ([ADR 0069](0069-payloads-are-validated-with-zod-behind-parsewire-and-a-wrong-shape-fails-loudly.md)) instead of being shown as something it isn't. Saving through the bindings replaces the bad value.
- Time-of-day deadlines (for example "by 5 pm Eastern") aren't representable. A narrator who needs one writes it in a milestone's note.
- Like the other manifest bindings, the save is load, modify, save without a manifest-wide lock. Two concurrent saves from different pages could lose one update, as they already can for `Credits`.
- Storing `time.Time` instants, or validating milestone kinds, would need a new ADR that supersedes this one.
