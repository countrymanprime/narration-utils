# 0001. Import dialog max-width and overflow behavior

**Status:** Accepted
**Date:** 2026-09-17

## Context

The Import Manuscript modal (`ConfirmDialog`) was rendering at a fixed `min(31rem, 80vw)` width regardless of content, and both vertical *and* horizontal scrollbars appeared inside it — the horizontal one was a bug: `.panel-body`/`.run-log` never set `overflow-x` or `word-break`, so any long unbroken token (a file path, a long section title, a log line) forced the browser to add a horizontal scrollbar per the CSS spec's default `overflow-x: auto` once `overflow-y` is non-visible.

## Decision

Dialogs (via the new `Dialog` primitive, `shared/ui/src/components/primitives/Dialog.tsx`) scale with content up to `max-w-[70vw]`, keep vertical scroll on the body (`overflow-y-auto`, capped at `80dvh` — intentional, unchanged), and force `overflow-x-hidden` plus `break-words` on the scrollable body so long tokens wrap instead of triggering horizontal scroll.

## Consequences

- Any dialog built on the `Dialog` primitive (`ConfirmDialog`, `WorkDialog`, `AddNoteDialog`) gets this fix for free.
- 70vw is a considered ceiling, not an exact value — a future dialog with a legitimate need for a different max-width should still go through `Dialog`'s API rather than hand-rolling a new width value inline.
- A future decision to change the max-width or reintroduce horizontal scroll for a specific case should supersede this ADR, not silently edit `Dialog.tsx`.
