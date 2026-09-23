# 0094. Dialog gains a full-size variant that fills the viewport with a margin

- Status: accepted
- Date: 2026-09-22

## Context

`teleprompter-manuscript-integration.prd.md` Phase 1 needs a `Dialog` that can host a full-screen reader (the teleprompter reading modal, built in a later phase of the same PRD): the existing shell caps every dialog at `max-w-[70vw]` and `80dvh` ([ADR 0001](0001-import-dialog-max-width-and-overflow.md)), sized to fit its content, which cannot show a whole chapter of running text plus a status bar and a side rail. ADR 0001 already anticipated this: "a future dialog with a legitimate need for a different max-width should still go through `Dialog`'s API rather than hand-rolling a new width value inline... A future decision to change the max-width... for a specific case should supersede this ADR, not silently edit `Dialog.tsx`." Dialog modality (focus trap, Escape, backdrop, initial/final focus) is a separate, already-decided concern ([ADR 0048](0048-every-dialog-is-one-modal-shell-and-confirms-are-alert-dialogs.md)) and is out of scope here.

## Decision

`Dialog` (`apps/ui/src/components/primitives/Dialog.tsx`) takes a `size?: 'default' | 'full'` prop, default `'default'`.

- `'default'` is unchanged: ADR 0001's cap (`max-w-[70vw]`, `maxHeight: 80dvh`, sized to content).
- `'full'` fills the viewport with a fixed 1rem margin on every side (`max-w-[calc(100vw-2rem)]`, `height` and `maxHeight` both `calc(100dvh - 2rem)`) so the popup always reaches that size rather than shrinking to its content, and its body region (`overflow-y-auto`) scrolls exactly as the default size's does.

Modality is identical for both sizes: the same Base UI `Dialog`/`AlertDialog` root, the same Escape, backdrop, and initial/final focus rules from ADR 0048. Only sizing changes.

## Consequences

- A dialog that genuinely needs the whole window (the teleprompter reading modal, a later phase of `teleprompter-manuscript-integration.prd.md`) gets there through `Dialog`'s own documented API instead of a bespoke width hand-rolled at the call site, keeping ADR 0001's "one modal shell" intact.
- Every existing dialog (`ConfirmDialog`, `WorkDialog`, `AddNoteDialog`, and every other `Dialog` consumer) is unaffected: they don't pass `size`, so they keep the `'default'` cap and behavior verified by the existing Dialog stories and tests.
- `size="full"` is additive to ADR 0001, not a reversal of it: the 70vw/80dvh ceiling still holds for every dialog that doesn't opt in.
- A future third size (for example, a fixed intermediate width) should extend this same prop rather than adding another one-off primitive; a change to what `'full'` or `'default'` mean should supersede this ADR.
