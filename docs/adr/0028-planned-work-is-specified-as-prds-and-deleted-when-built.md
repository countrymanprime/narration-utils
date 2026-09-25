# 0028. Planned work is specified as PRDs, kept apart from ADRs, and a PRD is deleted once its work is built

- **Status:** Accepted
- **Date:** 2026-09-19

## Context and problem

Planned work used to live in per-feature briefs scattered across `docs/architecture/`, `docs/utilities/` and `docs/design/`, with a status line at the top saying "Planned" or "Not implemented". They mixed three things: a plan, evidence for it, and (once code shipped) a description of how the code works. Twenty of them accumulated, and several went stale in place: `docs/architecture/story-bible-readonly-views.md` still said "Planned - not implemented" after the behavior shipped as [ADR 0018](0018-story-bible-entries-read-only-until-edit.md). A reader could not tell whether a file under `docs/architecture/` described the app or hoped for it, and the `adr-author` skill even tells authors to put proposals in `docs/architecture/*.md`.

## Decision drivers

- The briefs mixed a plan, evidence for it, and a description of how shipped code works.
- Several briefs went stale in place after their behavior shipped.
- A reader could not tell whether a file under `docs/architecture/` described the app or hoped for it.

## Considered options

1. Planned work as PRDs in `docs/prds/`, kept apart from ADRs, and deleted once built
2. Keep the status quo: per-feature briefs with a status line, scattered across `docs/architecture/`, `docs/utilities/` and `docs/design/`

## Decision outcome

**Chosen option: planned work as PRDs in `docs/prds/`, kept apart from ADRs, and deleted once built**, because the scattered briefs mixed plans with descriptions of shipped code and went stale, so a reader could not tell whether a file described the app or hoped for it.

1. Planned work is specified as a PRD in `docs/prds/`, one file per feature or defect group, named `<topic>.prd.md`, using the fixed section order in [`docs/prds/README.md`](../prds/README.md). Each PRD carries a phase table with a `Status` cell per phase and a `PRP Plan` column for the per-phase implementation plan (none written yet). The pull request that delivers a phase updates its `Status` cell.
2. The 20 per-feature briefs are removed and replaced by 16 PRDs, indexed with a "Replaces" column and a "Replaced briefs" table in `docs/prds/README.md`. Each removed file is recoverable from git, for example `git show d5cc994:docs/utilities/review-dashboard.md`.
3. PRDs and ADRs stay separate. An ADR records a decision that was made and applied ([`docs/adr/README.md`](README.md) rule 4). A PRD names the decisions it expects to make and links the ADR once it is written; it never stands in for one.
4. A PRD is deleted when its work is implemented and steady-state documentation exists. Steady-state documentation is `docs/architecture/`, `docs/utilities/`, `docs/guides/` and the ADRs. The PRD's evidence and history stay recoverable from git; the docs that remain describe the code as it is.
5. PRDs specify, issues track. Work in flight is an issue or pull request on GitHub ([ADR 0029](0029-work-is-tracked-on-github-and-decided-in-the-repo.md)), not a PRD checklist.

### Consequences

- **Good:** A file in `docs/architecture/` or `docs/utilities/` describes shipped behavior or a rule that shipped code cites. Three former briefs stayed for that reason: `first-use-dependency-provisioning.md`, `manuscript-teleprompter.md` and `standalone-launch.md`, each with its remaining planned work moved into a PRD.
- **Bad:** Deleting a finished PRD loses the reasoning that lived in it unless that reasoning was promoted. Any decision it settled needs its ADR before the PRD goes, and any behavior it specified needs a steady-state doc. That promotion is manual and easy to skip.
- **Neutral:** The delete step in point 4 has been exercised: several PRDs have since been delivered and deleted (TXT and EPUB manuscript import among them), each listed in the [`docs/prds/README.md`](../prds/README.md) index as "PRD deleted, delivered" with a pointer to its steady-state docs.
- **Bad:** PRDs are long (each has a Research Summary and a Decisions Log), so the folder is heavier to read than the briefs were. The index and the phase tables are the intended entry points.
- **Neutral:** Code comments and docs that pointed at a removed brief now point at a PRD or ADR (for example the teleprompter comment in `apps/desktop/app.go`); a link to a PRD becomes dead when that PRD is deleted, so links from steady-state docs into `docs/prds/` are temporary by design.
- **Neutral:** Changing this needs a new ADR that supersedes this one, for example if PRDs move out of the repository.

### Confirmation

Not recorded when this decision was made.
