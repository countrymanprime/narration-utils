# 0093. The Home estimate times the first opening and closing template until a project can choose one

- **Status:** Accepted
- **Date:** 2026-09-22

## Context and problem

`audiobook-credits-templates.prd.md` Phase 2 ("Estimate") asks for a "Credits stat in the estimate (rendered words / 155 wpm)"
and the PRD's own user flow names a concrete outcome: "Home shows 'Credits ~18 s' beside the narration estimate." But Phase 1
(`apps/desktop/internal/credits`, `CreditsPanel.tsx`, PR #302) shipped only a narrator-level **library** of opening/closing
templates plus a preview renderer (`creditsPreview(body)`); it never added a way for a project to say "this is the opening
template I am actually going to read" or "this is the closing one." `CreditsPanel.tsx`'s `selectedId` is local component state
for editing, not a persisted per-project choice, and `project.Manifest`'s `Credits` field (Phase 1) holds only token *values*
(title, author, ...), not a chosen template id. Open Question C1 recommended sequencing templates-plus-preview-plus-estimate
before "Manuscript pseudo-entries" and the teleprompter, but did not say what the estimate should render when no per-project
selection exists yet - that gap sits between C1, C2 and C9, none of which the owner's D1-D22 decisions in
`implementation-plan.md` resolve.

This is exactly the case Open Question D22 describes: an open question with no owner decision on record. Per the plan's own
protocol (`implementation-plan.md` section 3, item 7), the recommended path is taken and this ADR records it for the owner to
confirm, adjust or replace once template selection is designed (a natural fit for the deferred Phase 3, "Manuscript entries,"
or its own small phase).

## Decision drivers

- `audiobook-credits-templates.prd.md` Phase 2 asks for a Credits stat in the estimate ("Home shows 'Credits ~18 s' beside the narration estimate").
- Phase 1 shipped only a narrator-level library of templates and a preview renderer, with no way for a project to choose its opening or closing template.
- No owner decision covers what the estimate should render without a per-project selection, so the plan's protocol (D22) takes the recommended path and records it for the owner.
- Opening and closing credits should be separate files (ACX convention, Open Question C11).

## Considered options

1. Time the first `opening` and first `closing` template in the library's order, as a reading default
2. A persisted per-project choice of opening and closing template
3. Show a zero or a placeholder when the library has no `opening` or `closing` template

## Decision outcome

**Chosen option: time the first `opening` and first `closing` template in the library's order, as a reading default**, because Phase 1 shipped no per-project template choice, and for an open question with no owner decision the plan's protocol is to take the recommended path and record it for the owner.

Until a project can choose its own opening/closing templates, the Home audiobook estimate's "Credits" stat is computed from
**the first `opening`-kind and first `closing`-kind template in the narrator's credit template library, in the order
`creditsTemplates()` returns them** (shipped defaults first, per Phase 1's seeding) - rendered with `creditsPreview(body)`
using the current project's own values (falling back to the global narrator default, exactly as `CreditsPanel.tsx`'s preview
already does). Each matched template is treated as its own file (ACX convention, Open Question C11: "Opening and closing
credits should be separate files"), so its word count is timed independently and could later carry its own room-tone padding.
A library with no `opening` or no `closing` template simply omits the "Credits" stat rather than showing a zero or a
placeholder (`apps/ui/src/components/home/AudiobookEstimatePanel.tsx`).

This is a **reading default**, not a new store: no manifest field, binding or `hostAPIVersion` bump is added by this decision.
It reuses the two Phase 1 bindings the Settings > Credits panel already calls (`creditsTemplates`, `creditsPreview`).

### Consequences

- **Bad:** A narrator who adds a second opening template, or reorders their library so their preferred opening is not first, sees the
  estimate keep timing whichever one the store still returns first - the estimate will not match what they intend to read
  until a real "this project's opening/closing template" selection exists. This is a known, accepted gap, not a bug: it should
  be closed by a follow-up phase that adds a per-project template choice (most naturally alongside Phase 3's Manuscript
  entries, which need the same "which template plays here" answer for the read-only pseudo-entries before/after the chapter
  list).
- **Good:** Because the choice is made by list order rather than persisted state, it costs nothing to change later: replacing "first
  opening/closing template" with an explicit per-project selection is a change inside `AudiobookEstimatePanel.tsx`'s own
  effect, with no migration of stored data (there is none yet to migrate).
- **Bad:** The estimate's Credits stat can differ from what `CreditsPanel.tsx`'s own preview shows (whichever template a narrator has
  selected there to edit), which could read as two disagreeing numbers in the same session. This is accepted for Phase 2 and
  should be called out in the guide/help text once the steady-state docs are written.

### Confirmation

Not recorded when this decision was made.
