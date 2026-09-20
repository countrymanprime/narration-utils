# 0009. Complete the Tailwind migration; retire the legacy custom-CSS system

**Status:** Accepted (its `table.dtable` exception is superseded by [ADR 0056](0056-a-presentational-table-primitive-replaces-the-dtable-class-and-rows-take-the-keyboard.md))
**Date:** 2026-09-18
**Supersedes:** ADR-0003

## Context

[ADR 0003](0003-tailwind-tokenized-primitives.md) deliberately started small: only `Dialog`, `Button`, and `MeterBar` were rebuilt in Tailwind, with the rest of the app's ~1600-line `shared/ui/src/styles.css` (roughly 134 custom classes across 18+ consuming files) left untouched, and a note that "a future decision to migrate the rest... should supersede this ADR." The user asked for exactly that follow-through: migrate `shared/ui` fully off the custom-CSS system to Tailwind atomic classes.

## Decision

`shared/ui`'s custom-CSS system has been migrated to Tailwind utility classes (arbitrary-value syntax referencing the existing CSS custom properties in `styles.css`'s `:root` block — no new `tailwind.config.js` token system was introduced, consistent with ADR 0003's stance) across all 35 consuming `.tsx` files, done in 8 phases by component directory (`primitives`, `layout`, `home`, `proofing`, `settings`, `storybible`, `manuscript`, then a cleanup pass), plus `components/project/ProjectPicker.tsx`, which was missed from the initial phase plan and caught during the final audit. `styles.css` shrank from 1593 lines to 377 lines (76% reduction). Every phase was verified with `pnpm check` (lint, Prettier, `tsc`, Vitest, production build) and the full Playwright visual suite (46 states × 4 viewports, `shared/ui/tests/visual/`), with zero visual regressions found.

A small set of things were deliberately **not** converted, and are not intended to be:

- **`table.dtable`** (plus its `th`/`td`/`row-selected`/hover rules): a generic reusable table style used by 4 files (`Results.tsx`, `AudiobookEstimatePanel.tsx`, `GuideDetail.tsx`, `Guide.tsx`). Kept as a deliberate "component class" — analogous to Tailwind Typography's `prose` — since inlining it would mean repeating a long Tailwind class string across 30+ individual `<th>`/`<td>` tags for no reuse benefit.
- **Scrollbar-hiding rules** (`.scroll-chrome-hidden`, `.guide-list-scroll`'s `::-webkit-scrollbar` rules) and **`.guide-list-scroll tr:has(.type-X) td:first-child`** category-color-coding rules: not cleanly expressible as a single Tailwind utility (cross-browser scrollbar hiding), or clearer as hand-written CSS than a `:has()`-based Tailwind arbitrary variant.
- **`@keyframes tooltip-in`, `source-flash`, `work-progress-slide`**, referenced via Tailwind's `animate-[keyframeName_...]` arbitrary-value syntax. The `.source-flash` *class* also survives because `Manuscript.tsx` applies it via raw `classList.add`/`remove`, not JSX `className` — Tailwind can't express a class toggled outside React's render.
- **Bare "marker" classes with no attached styling** (`.note-overlay`, `.ms-highlight`, `.settings-nav`, `.overlay-panel`, `.manuscript-reader`, `.source-line-number`, `.progressbar`, `.progress-segment`, and a bare `active` token on a couple of toggle buttons): kept purely because `tests/visual/app.spec.ts` and several Vitest unit tests select elements by CSS class (the codebase has no `data-testid` convention). Tailwind utility classes on the same elements provide all of the actual visual styling now; these classes carry zero CSS declarations.
- **Dynamic per-category colors** (badge category color, manuscript entity-highlight color, category-dot color) moved from CSS class variants (`.badge-Character`, `.ms-highlight.hl-Place`, `.cat-dot.type-Organization`, etc.) into three small exported lookups in `shared/ui/src/components/manuscript/EntitySummary.tsx` (`BADGE_STYLE`/`BADGE_CLASS`, `HL_STYLE`/`hlClassName`, `CAT_DOT_BG`/`CAT_DOT_CLASS`) that produce inline `style` objects, since Tailwind can't express "background chosen by a runtime string" as a static class.

Along the way, one pre-existing, unrelated bug was found and fixed: `tests/visual/app.spec.ts`'s `chapter-collapsed` driver looked for a button named exactly `'Collapse all'`, but the actual `aria-label` is `'Collapse all chapters'` (confirmed via `git diff` to predate this session). Fixed as a one-line selector correction, since it blocked running the visual suite this migration relies on for verification.

## Consequences

- `styles.css` now contains only true design tokens (`:root` custom properties, light/dark theme overrides), `@tailwind` directives, and the small set of intentional exceptions listed above — not a parallel ad hoc utility-class system.
- New UI work in `shared/ui` should reach for Tailwind utilities first; reintroducing a custom CSS class for something Tailwind can already express should be treated as a regression against this ADR, not a style choice.
- The exceptions above are real, ongoing maintenance surface: `table.dtable` in particular means table markup across 4 files still depends on a shared class rather than being self-contained. A future decision to build a `Table` primitive component (removing `.dtable` too) would supersede only that part of this ADR.
- [`docs/design/design-system.md`](../design/design-system.md)'s note that "legacy custom-CSS equivalents... remain in `styles.css` and are still the right choice for existing consumers not yet migrated" is now stale and has been updated to point here instead.
