# Motion & animation strategy

**Status: Planned — two considered instances exist, both guarded for reduced motion; no formal system yet.**

## Problem

State changes and page loads currently "pop in" with no transition in most places — colors and values appear abruptly rather than animating, which reads as less polished than a considered motion system. This was noticed while fixing the chapter progress bar's segment ordering (`docs/adr/0006-chapter-progress-bar-ordering.md`).

## What exists today

- The `MeterBar` primitive (`apps/ui/src/components/primitives/MeterBar.tsx`) has `motion-safe:transition-[flex-basis] motion-safe:duration-300` on each segment, so it does not animate for people who ask for reduced motion ([ADR 0050](../adr/0050-the-segmented-meter-is-an-image-named-by-its-segments-and-field-wires-its-hint-and-error.md)).
- The `WorkDialog` progress fill eases its width and slides while indeterminate, both under `motion-safe:` ([ADR 0057](../adr/0057-a-running-job-that-cannot-be-cancelled-keeps-its-dialog-blocking-and-says-so.md)). The old `.progressbar > div { transition }` rule in `components.css` is gone because it beat the utility; `legacyCss.test.ts` fails on any `transition` or `animation` declared there.
- The other three progress fills (the Home import preview, the Proofing comparison, the Story Bible voice download) still carry an unconditional `transition-[width] duration-[0.4s] ease-in-out` utility and ease under reduced motion. That is a known gap: move them to `motion-safe:` when this system is formalized.
- The atlas cannot prove reduced motion: the Storybook preview switches every animation and transition off for deterministic screenshots, so the guards are unit tests on the classes.
- Beyond these spots, no other state transition in the app is animated — most updates (data reload, toast appearance) are instant.

## Proposed lightweight motion system (not built)

1. **Duration/easing tokens**: a small, fixed set (e.g. `--motion-fast: 150ms`, `--motion-base: 300ms`, `--motion-slow: 450ms`, one easing curve) added to `styles.css`'s `:root` alongside the existing color/spacing tokens, so future transitions reference the same values instead of picking arbitrary numbers per component (as `MeterBar`'s `duration-300` and the progress fills' `0.4s` already inconsistently do).
2. **Guidance on when to animate**: state changes that are the *direct result of a user action in the same view* (expanding a chapter, a progress bar updating) are good animation candidates; page-level navigation and data reloads generally should not be forced into a transition just for polish, since a slow "in the way" animation on a workflow-critical action (import, build) reads as latency, not polish.
3. **Respect `prefers-reduced-motion`**: any new transition is a `motion-safe:` utility (done for `MeterBar` and `WorkDialog`), never a rule in `components.css`.

## Out of scope for this doc

Actually building the token set or auditing every existing interaction for missing transitions — this is a proposal, not a design system yet. See [interaction feedback](../architecture/interaction-feedback.md) ([ADR 0075](../adr/0075-every-action-that-leaves-the-interface-acknowledges-within-100-ms-cannot-be-fired-twice-and-tells-the-narrator-when-it-ends.md) and the call-site catalog) for the related (but distinct) concern of missing *feedback*, as opposed to missing *animation*.
