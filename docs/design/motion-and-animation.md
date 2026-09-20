# Motion & animation strategy

**Status: Planned — one concrete instance exists; no formal system yet.**

## Problem

State changes and page loads currently "pop in" with no transition in most places — colors and values appear abruptly rather than animating, which reads as less polished than a considered motion system. This was noticed while fixing the chapter progress bar's segment ordering (`docs/adr/0006-chapter-progress-bar-ordering.md`).

## What exists today

- `.progressbar > div` (the linear progress bar used in `WorkDialog`) already has `transition: width 0.4s ease` in `styles.css` — this was already correct before this session's work.
- The new `MeterBar` primitive (`shared/ui/src/components/primitives/MeterBar.tsx`) adds `transition-[flex-basis] duration-300 ease-out` on each segment — a first, minimal, low-risk instance of considered motion, added alongside the reordering fix rather than as a separate project.
- Beyond these two spots, no other state transition in the app is animated — most updates (data reload, dialog open/close beyond the existing CSS `transform: translateX` on `.overlay-panel`, toast appearance) are instant.

## Proposed lightweight motion system (not built)

1. **Duration/easing tokens**: a small, fixed set (e.g. `--motion-fast: 150ms`, `--motion-base: 300ms`, `--motion-slow: 450ms`, one easing curve) added to `styles.css`'s `:root` alongside the existing color/spacing tokens, so future transitions reference the same values instead of picking arbitrary numbers per component (as `MeterBar`'s `duration-300` and the existing `.progressbar`'s `0.4s` already inconsistently do).
2. **Guidance on when to animate**: state changes that are the *direct result of a user action in the same view* (expanding a chapter, a progress bar updating) are good animation candidates; page-level navigation and data reloads generally should not be forced into a transition just for polish, since a slow "in the way" animation on a workflow-critical action (import, build) reads as latency, not polish.
3. **Respect `prefers-reduced-motion`**: any new transition should be wrapped or scoped so `@media (prefers-reduced-motion: reduce)` disables it — not yet done for `MeterBar`'s transition, worth adding when this system is formalized.

## Out of scope for this doc

Actually building the token set or auditing every existing interaction for missing transitions — this is a proposal, not a design system yet. See [interaction-feedback-audit.prd.md](../prds/interaction-feedback-audit.prd.md) for the related (but distinct) concern of missing *feedback*, as opposed to missing *animation*.
