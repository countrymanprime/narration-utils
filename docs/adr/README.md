# Architecture & Design Decision Records (ADRs)

**Status: implemented.**

This folder is the fix for a recurring problem: agentic refactoring sessions have silently reverted deliberate decisions (styling, naming, behavior) because too much code and too many commits pile up between when a decision was made and when a later agent "cleans up" without knowing it was deliberate. An ADR is the durable record that a future agent — or person — checks *before* changing something, not after.

## Format: MADR (Markdown Architectural Decision Records)

We use [MADR](https://adr.github.io/madr/), a widely-adopted lightweight format. Each ADR is one file: `NNNN-short-title.md`, numbered sequentially starting at `0001`. Use [`template.md`](template.md) for the section structure.

## Rules

1. **Immutable once Accepted.** Never edit an accepted ADR's Decision or Consequences to reflect a change of mind. If a decision changes, write a **new** ADR that supersedes the old one.
2. **Superseding, not deleting.** The old ADR's `Status` line becomes `Superseded by ADR-NNNN`, and the new ADR's front matter links back (`Supersedes ADR-NNNN`). The old file stays — it's still useful history.
3. **One decision per ADR.** Don't bundle unrelated decisions; a future agent needs to be able to supersede one without touching the others.
4. **Concrete, not aspirational.** An ADR records a decision that was actually made and applied to the code, with a pointer to where. It is not a proposal — proposals for future work belong in `docs/architecture/*.md` (see that folder's own docs for the format).

## How this is enforced

The `design-spec-guard` skill (`.claude/skills/design-spec-guard/`) reads this folder plus [`docs/design/design-system.md`](../design/design-system.md) before/during a refactor and flags any change that contradicts a recorded decision, unless that exact change is listed in an approved plan. The `adr-author` skill (`.claude/skills/adr-author/`) scaffolds new ADRs and handles the supersede bookkeeping so numbering and cross-links stay consistent.

## Index

| # | Title | Status |
| --- | --- | --- |
| [0001](0001-import-dialog-max-width-and-overflow.md) | Import dialog max-width and overflow behavior | Accepted |
| [0002](0002-dialog-action-button-placement.md) | Dialog action buttons on opposite sides | Accepted |
| [0003](0003-tailwind-tokenized-primitives.md) | Tailwind-based tokenized primitives over ad hoc custom CSS classes | Accepted |
| [0004](0004-front-matter-naming.md) | "Front Matter" as the canonical front-matter section name | Accepted |
| [0005](0005-reference-material-excluded-from-chapter-nav.md) | Reference-material sections excluded from chapter navigation, retained in source data | Accepted |
| [0006](0006-chapter-progress-bar-ordering.md) | Chapter progress bar ordered finalized-to-not-started, left to right | Accepted |
| [0007](0007-story-bible-locked-entry-enforcement.md) | Story Bible locked-entry enforcement is server-side authoritative | Accepted |
