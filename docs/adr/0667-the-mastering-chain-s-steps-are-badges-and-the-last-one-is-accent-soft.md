# 0667. The mastering chain's steps are Badges, and the last one is `--accent-soft`

**Status:** Proposed (Phase 14 of the [mock fidelity PRD](../prds/mock-fidelity-primitives-and-components.prd.md), stream F-P14 on [#509](https://github.com/countrymanprime/narration-utils/issues/509))
**Date:** 2026-09-28
**Supersedes:** none (`MasteringChain.tsx`'s chips had no ADR of their own)

## Context

`master/MasteringChain.tsx` drew its read-only chain (fixed by [ADR 0440](0440-master-and-qcs-platform-tabs-are-the-projects-delivery-profile-and-the-page-draws-only-what-the-host-measures.md) point 4: EQ, Limiter, Gain, in words) as a hand-rolled `li` chip (`rounded-full border ... bg-[var(--surface-2)]`) per step, joined by `→` arrows. Mock 05 draws the same shape - `--surface-2` chips joined by arrows - but its last chip (the platform's own gain target, e.g. "Gain to RMS −20.5 dB") is filled `--accent-soft`, distinct from the fixed steps before it.

## Decision

Each step composes `Badge` (the one badge primitive, [ADR 0600](0600-every-pill-tag-and-status-dot-is-one-badge-primitive-with-a-pill-a-tag-and-a-booth-shape.md)) with its own colours rather than a `StatusTone`, since a chain step is not a status: `{ fill: 'var(--surface-2)', text: 'var(--text)', line: 'transparent' }` for every step but the last, and `{ fill: 'var(--accent-soft)', text: 'var(--accent-strong)', line: 'transparent' }` for the last one - the chain's own row decides which step is last (`row.chain.length - 1`), not a name match, so a DAW row with a differently named final step still gets the highlight. The step's name and detail render as one label (`"${step.name} · ${step.detail}"`); the arrows between steps are unchanged.

## Consequences

- `MasteringChain.tsx` no longer draws a chip look of its own; its `badgeShapes.test.ts` allowance is removed rather than lowered.
- A DAW-provider row (`row.chain.length === 0`, "your DAW's own FX chain") is unaffected: it never reaches this code path.
- A chain step gaining its own status (e.g. a step the host flags as stale) is a change to this file's colour logic and a new ADR superseding this one.
