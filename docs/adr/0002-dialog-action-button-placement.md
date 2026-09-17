# 0002. Dialog action buttons on opposite sides

**Status:** Accepted
**Date:** 2026-09-17

## Context

Every dialog's Cancel/Confirm (and optional danger) buttons were right-aligned together (`justify-end`), including the Import Manuscript modal. The user's explicit preference is for the dismissive action (Cancel) to sit on the opposite side of the modal from the affirmative/destructive actions, not clustered together.

## Decision

The `Dialog` primitive's action row defaults to `justify-between`: Cancel (or the single dismissive action) renders alone, and any grouped affirmative/danger actions are wrapped in their own `flex gap-2` group so they stay visually grouped together on the other side. `WorkDialog` opts out via `actionsAlign="end"` because it only ever shows one button at a time — `justify-between` would strand a lone button on the left, which reads oddly for a "Close" action.

## Consequences

- This is an app-wide convention, not specific to the Import modal — `ConfirmDialog`, `WorkDialog`, and `AddNoteDialog` all go through the same `Dialog` primitive, so a future dialog gets consistent placement automatically.
- A dialog with a genuine reason to deviate (like `WorkDialog`) uses the `actionsAlign` prop rather than reimplementing the action row.
