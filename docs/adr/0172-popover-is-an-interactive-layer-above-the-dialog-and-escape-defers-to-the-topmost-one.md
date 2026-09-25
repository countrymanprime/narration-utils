# 0172. Popover is an interactive layer above the dialog, and Escape defers to the topmost one

- **Status:** Proposed
- **Date:** 2026-09-24

## Context and problem

[Read Aloud Control Bar](../prds/read-aloud-control-bar.prd.md) redesigns the Read aloud dialog's configuration card as
a compact bar with a microphone device picker and a Settings panel, each opened from a button inside a full-size
`Dialog` (`size="full"`, [ADR 0094](0094-dialog-gains-a-full-size-variant-that-fills-the-viewport-with-a-margin.md)).
Neither fits an existing primitive: `Menu` (ADR 0052) only holds a flat list of action items with no room for a
`Select`, a meter or a gain control, and its popup sits at `z-[55]`, below the dialog's `z-[60]` — opened from inside a
dialog, it would draw behind it. The info icon's popup (`primitives/Tooltip.tsx`'s `Tooltip` component, built on Base
UI's `Popover` already) is a read-only hint: it never moves focus in, and it marks itself with
`HINT_POPUP_ATTRIBUTE` so `Dialog.tsx`'s Escape handler defers to it instead of closing the dialog underneath. Neither
shape is right for a popup a person operates (a device list, a Refresh button, a meter).

## Decision drivers

- The popups hold controls a person operates (a device list, a Refresh button, a meter), opened from inside a full-size `Dialog`.
- A popup opened from inside a dialog must draw above it.
- Escape in such a popup must not close the dialog underneath.

## Considered options

1. A new interactive `Popover` primitive at `z-[70]`
2. `Menu` (ADR 0052)
3. The info icon's hint popup (`Tooltip`)

## Decision outcome

**Chosen option: a new interactive `Popover` primitive at `z-[70]`**, because neither `Menu` nor the read-only hint popup is right for a popup a person operates from inside a dialog.

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

### Consequences

- **Good:** A dialog can now host a device picker, a settings panel or any other interactive popup without it drawing behind
  the dialog's backdrop, and closing that popup with Escape no longer closes the dialog underneath it by accident.
- **Neutral:** Two Base UI `Popover` usages now exist in the primitives (the hint inside `Tooltip.tsx` and the new `Popover.tsx`)
  with different focus and marker behaviour; `design-spec-guard` and this ADR are the record of why they differ, so a
  future primitive change does not merge them by mistake.
- **Neutral:** `Menu`'s `z-[55]` is unchanged: nothing here needs a `Menu` opened inside a dialog, so that fix stays with whichever
  PRD needs it first.
- **Neutral:** A future interactive layer above the dialog (a third kind of popup) should extend the same Escape-precedence check
  in `Dialog.tsx` rather than add a fourth ad hoc marker attribute; changing the layer order itself needs a new ADR
  that supersedes this one.

### Confirmation

`design-spec-guard` and this ADR are the record of why the hint popup and the new `Popover` differ, so a future primitive change does not merge them by mistake.

## Pros and cons of the options

### `Menu` (ADR 0052)

- Bad, because it only holds a flat list of action items, with no room for a `Select`, a meter or a gain control.
- Bad, because its popup sits at `z-[55]`, below the dialog's `z-[60]`, so opened from inside a dialog it would draw behind it.

### The info icon's hint popup (`Tooltip`)

- Bad, because it is a read-only hint that never moves focus in.
