# 0003. Tailwind-based tokenized primitives over ad hoc custom CSS classes

**Status:** Superseded by ADR-0009
**Date:** 2026-09-17

## Context

The app's UI is built from a large, ad hoc custom CSS system (`shared/ui/src/styles.css`, ~1600 lines): classes like `.btn`, `.btn-primary`, `.confirm-dialog`, `.panel-body` reused (inconsistently) across 18+ files, mixed with existing Tailwind utility classes already used inline. This made a handful of dialog/button/progress-bar bugs (see ADR 0001, 0002, 0006) harder to fix consistently, since the same visual concept was duplicated with small drifts across files. The user wants to move toward Tailwind-based, theme-tokenized primitive components instead of writing more custom CSS classes.

## Decision

New shared UI primitives (`Dialog`, `Button`, `MeterBar` in `shared/ui/src/components/primitives/`) are built with Tailwind utility classes exclusively for layout/spacing/typography, using Tailwind's arbitrary-value syntax (`bg-[var(--surface)]`, `border-[var(--border)]`, etc.) to reference the **existing** CSS custom properties defined in `styles.css`'s `:root` block, rather than introducing a second, competing token system in `tailwind.config.js`. This is a deliberately **small, incremental start**, not a full migration — the existing `.btn`/`.panel-*` classes remain in place for their current 18+ consumers, and migrating them is explicitly out of scope for now (see [`docs/prds/release-readiness-provisioning-and-docs-site.prd.md`](../prds/release-readiness-provisioning-and-docs-site.prd.md) for the eventual broader plan).

A structural note for implementers: `styles.css` wraps some rules in `@layer base`/`@layer components` (lines 66–616) and leaves the rest unlayered. Tailwind utilities (in the implicit `@layer utilities`) can override anything in `@layer components`, but an **unlayered** rule (e.g. `.confirm-dialog`, `.tooltip-target`, `.run-log`) always wins over a Tailwind utility for the same CSS property, regardless of source order — so a new primitive must either avoid using an unlayered legacy class name entirely (the approach taken for `Dialog`) or only add Tailwind utilities for properties the legacy rule doesn't already set (the approach taken for `MeterBar`'s reuse of `.progress-segment`/`tooltip-target`).

## Consequences

- `Dialog`/`Button`/`MeterBar` are Tailwind-first and don't add new custom CSS.
- The rest of the app's `.btn`/`.panel-*`/etc. classes stay as-is; a component using them is not "wrong," just not yet migrated.
- Anyone adding a new primitive must re-check which `@layer` (if any) a legacy class it touches lives in before assuming a Tailwind utility will override it — see the structural note above.
- A future decision to migrate the rest of the app, or to formalize tokens in `tailwind.config.js`'s `theme.extend`, should supersede this ADR.
