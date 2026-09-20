# 0035. The Story Bible's read-only view is the same form with disabled controls, not `EntitySummary`

**Status:** Proposed
**Date:** 2026-09-19
**Amends:** ADR-0018 (records the alternative it did not choose and why; its Decision is unchanged)

## Context

[ADR 0018](0018-story-bible-entries-read-only-until-edit.md) made Story Bible entries read-only until Edit is pressed. The planning brief it grew from (`docs/architecture/story-bible-readonly-views.md`, now removed; `git show d5cc994:docs/architecture/story-bible-readonly-views.md`) proposed a different way to do it: render `EntitySummary.tsx` as the read-only view and swap in the form on Edit. ADR 0018 records what shipped but never says that alternative was passed over. With the brief gone, a later refactor could reasonably "simplify" `GuideDetail.tsx` toward it, because two components already show an entity read-only.

## Decision

The read-only state of a Story Bible entry is the edit form itself with its controls disabled, not `EntitySummary`. `GuideDetail.tsx` keeps one layout: an `editing` flag (`:55`) and `editingDisabled = !canEdit || !editing` (`:112`) drive the `disabled` prop of every field, the category picker, and the alias and relationship controls, and Edit, Save and Cancel appear in the same header (`:287-330`). `EntitySummary` stays where it is: the Manuscript page's entity peek (`shared/ui/src/components/manuscript/Manuscript.tsx:444`) and the "Review entry" slide-over inside `GuideDetail` (`:864`), which show an entity without opening it for editing.

## Consequences

- The reasons below are read from the code; ADR 0018 does not state them.
- `EntitySummary` is a display-only mirror (its own comment says editing stays exclusive to the Story Bible) and has only one of the actions ADR 0018 keeps available in read-only mode (Go to line). Pronunciation preview, rescan occurrences, lock and unlock, and delete are missing, so making it the primary view would mean rebuilding those beside it or dropping them.
- One layout means pressing Edit changes whether the fields accept input and which header buttons show, not the layout of the entry, and one set of fields has to be kept correct. The cost is that a read-only entry is styled as a form: disabled inputs and textareas that read less like text than `EntitySummary`'s prose.
- `GuideDetail.test.tsx` locks this in: the read-only tests find the name by its input value and assert the input is disabled (`:60-98`), so replacing the form with `EntitySummary` fails them.
- The two views can drift, since both display the same entity fields (`EntitySummary` is a hand-kept mirror), so a field added to the form must be added to `EntitySummary` separately if the peek should show it.
- Rendering `EntitySummary` as the Story Bible's read-only view, or merging the two components, would need a new ADR that supersedes ADR 0018.
