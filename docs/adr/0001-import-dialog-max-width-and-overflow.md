# 0001. Import dialog max-width and overflow behavior

- **Status:** Accepted
- **Date:** 2026-09-17

## Context and problem

The Import Manuscript modal (`ConfirmDialog`) was rendering at a fixed `min(31rem, 80vw)` width regardless of content, and both vertical *and* horizontal scrollbars appeared inside it — the horizontal one was a bug: `.panel-body`/`.run-log` never set `overflow-x` or `word-break`, so any long unbroken token (a file path, a long section title, a log line) forced the browser to add a horizontal scrollbar per the CSS spec's default `overflow-x: auto` once `overflow-y` is non-visible.

## Decision drivers

- Long unbroken tokens (a file path, a long section title, a log line) must not force a horizontal scrollbar.
- The dialog's width should follow its content rather than a fixed value.

## Considered options

1. Dialogs scale with content up to `max-w-[70vw]`, scroll vertically only, and wrap long tokens
2. Keep the status quo: a fixed `min(31rem, 80vw)` width with both vertical and horizontal scrollbars

## Decision outcome

**Chosen option: dialogs scale with content up to `max-w-[70vw]`, scroll vertically only, and wrap long tokens**, because forcing `overflow-x-hidden` plus `break-words` on the scrollable body makes long tokens wrap instead of triggering horizontal scroll.

Dialogs (via the new `Dialog` primitive, `shared/ui/src/components/primitives/Dialog.tsx`) scale with content up to `max-w-[70vw]`, keep vertical scroll on the body (`overflow-y-auto`, capped at `80dvh` — intentional, unchanged), and force `overflow-x-hidden` plus `break-words` on the scrollable body so long tokens wrap instead of triggering horizontal scroll.

### Consequences

- **Good:** Any dialog built on the `Dialog` primitive (`ConfirmDialog`, `WorkDialog`, `AddNoteDialog`) gets this fix for free.
- **Neutral:** 70vw is a considered ceiling, not an exact value — a future dialog with a legitimate need for a different max-width should still go through `Dialog`'s API rather than hand-rolling a new width value inline.
- **Neutral:** A future decision to change the max-width or reintroduce horizontal scroll for a specific case should supersede this ADR, not silently edit `Dialog.tsx`.

### Confirmation

Not recorded when this decision was made.
