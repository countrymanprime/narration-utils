# 0172. Popover is an interactive layer above the dialog, and Escape defers to the topmost one

**Status:** Proposed
**Date:** 2026-09-24

## Context

[Read Aloud Control Bar](../prds/read-aloud-control-bar.prd.md) redesigns the Read aloud dialog's configuration card as
a compact bar with a microphone device picker and a Settings panel, each opened from a button inside a full-size
`Dialog` (`size="full"`, [ADR 0094](0094-dialog-gains-a-full-size-variant-that-fills-the-viewport-with-a-margin.md)).
Neither fits an existing primitive: `Menu` (ADR 0052) only holds a flat list of action items with no room for a
`Select`, a meter or a gain control, and its popup sits at `z-[55]`, below the dialog's `z-[60]` — opened from inside a
dialog, it would draw behind it. The info icon's popup (`primitives/Tooltip.tsx`'s `Tooltip` component, built on Base
UI's `Popover` already) is a read-only hint: it never moves focus in, and it marks itself with
`HINT_POPUP_ATTRIBUTE` so `Dialog.tsx`'s Escape handler defers to it instead of closing the dialog underneath. Neither
shape is right for a popup a person operates (a device list, a Refresh button, a meter).

## Decision

- **A new primitive, `primitives/Popover.tsx`**, wraps Base UI's `Popover` (ADR 0047) as an interactive popup: a click
  opens it, focus moves in and returns to the trigger on close (Base UI's defaults, left un-overridden — the opposite
  of the hint's `initialFocus={false}`/`finalFocus={false}`), and a press outside or Escape closes it. Its trigger is
  given through a `render` element (`trigger`, the same pattern as `Menu`'s `render` and `TooltipTarget`), so an
  `IconButton` or a `Button` keeps its own look. Its popup is `role="dialog"` (Base UI's default), named by the
  required `label` prop, since its content is often controls rather than a sentence a description could read.
- **It sits at `z-[70]`**, between `Dialog`'s `z-[60]` and a hint's `z-[1000]`: above every dialog, so it is visible
  when opened from inside one, and below a hint, so a tooltip inside the popover still draws on top of it.
- **Escape defers to the topmost popover, then the topmost hint, then the dialog.** The popup carries
  `POPOVER_POPUP_ATTRIBUTE` (`data-popover-popup`), and `Dialog.tsx`'s `onOpenChange` cancels the dialog's own close
  when `document.querySelector(POPOVER_POPUP_SELECTOR)` finds one open — the same check already in place for
  `HINT_POPUP_SELECTOR`. Base UI's own Escape handling closes the popover itself on the same keypress, so one Escape
  closes the innermost open layer and leaves everything under it alone.
- **The hint-style popup is unchanged.** `Tooltip`'s info icon keeps using Base UI's `Popover` directly with its own
  read-only behaviour and `HINT_POPUP_ATTRIBUTE`; it does not become a consumer of the new `Popover` primitive; the two
  serve different contracts (read a note vs. operate a control) on the same underlying library component.

## Consequences

- A dialog can now host a device picker, a settings panel or any other interactive popup without it drawing behind
  the dialog's backdrop, and closing that popup with Escape no longer closes the dialog underneath it by accident.
- Two Base UI `Popover` usages now exist in the primitives (the hint inside `Tooltip.tsx` and the new `Popover.tsx`)
  with different focus and marker behaviour; `design-spec-guard` and this ADR are the record of why they differ, so a
  future primitive change does not merge them by mistake.
- `Menu`'s `z-[55]` is unchanged: nothing here needs a `Menu` opened inside a dialog, so that fix stays with whichever
  PRD needs it first.
- A future interactive layer above the dialog (a third kind of popup) should extend the same Escape-precedence check
  in `Dialog.tsx` rather than add a fourth ad hoc marker attribute; changing the layer order itself needs a new ADR
  that supersedes this one.
