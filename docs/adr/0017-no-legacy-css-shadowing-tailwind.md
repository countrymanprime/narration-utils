# 0017. No unlayered legacy CSS or contradictory utilities shadow Tailwind

- **Status:** Accepted
- **Date:** 2026-09-18
- **Related:** Amends [ADR-0009](0009-complete-tailwind-migration.md) (its "marker classes carry zero CSS declarations" claim was wrong for `.overlay-panel`).

## Context and problem

Several reported bugs shared one cause: CSS that silently defeated the Tailwind utilities beside it.

- **Sidebar never opened / page locked (Manuscript).** `.overlay-panel { transform: translateX(100%) }` sat unlayered in `styles.css`. Unlayered rules beat every Tailwind utility regardless of specificity, so the `translate-x-0` on the open panel did nothing, while its transparent click-away backdrop still mounted and swallowed clicks. ADR-0009 had recorded `.overlay-panel` as a declaration-free marker; it was not. `design-system.md` already warned about this layering gotcha, but nothing enforced it.
- **Unstyled alias menu (Story Bible).** `alias-match-menu/-option/-actions` were legacy class names whose CSS no longer existed, so options rendered inline and horizontal.
- **Unreadable buttons (dark mode) and non-blue bookmarks.** Elements applied two utilities for the same property — `text-[var(--text-muted)]` and `text-[var(--accent-contrast)]` on active Pills, `text-[var(--text-faint)]` and `text-[var(--bookmark)]` on bookmarks. Which wins depends on stylesheet order, not class order; in dark mode that produced muted text on an orange fill.

## Decision drivers

- Several reported bugs shared one cause: CSS that silently defeated the Tailwind utilities beside it.
- `design-system.md` already warned about the layering gotcha, but nothing enforced it.
- When two utilities set the same property, which wins depends on stylesheet order, not class order.

## Considered options

1. Limit unlayered rules to an allow-list, use mutually exclusive state classes, and enforce both with a guard test
2. Keep the status quo: an unenforced warning in `design-system.md`

## Decision outcome

**Chosen option: limit unlayered rules to an allow-list, use mutually exclusive state classes, and enforce both with a guard test**, because the layering gotcha kept causing bugs while only a documentation warning, which nothing enforced, stood against it.

1. Unlayered class rules in `styles.css` are limited to the documented exceptions in ADR-0009. The dead or harmful ones (`.overlay-panel`, `.sheet-backdrop`, `.note-overlay`, `.source-flash`, `.reader-control-band`) are deleted.
2. Slide-over panels use the `SlideOver` primitive (`primitives/SlideOver.tsx`), pure Tailwind: closed = `invisible translate-x-full`, open = `visible translate-x-0`; the backdrop exists only while open.
3. State-dependent classes are **mutually exclusive**, chosen with a ternary (`active ? 'a b' : 'c d'`), never a base class plus an override for the same property. `Pill` is the reference; the Manuscript size toggles and Proofing log-verbosity toggles now use it instead of duplicating its markup.
4. A guard test (`shared/ui/src/legacyCss.test.ts`) fails if a removed legacy class name reappears in `src/`, or if `styles.css` gains an unlayered class rule outside its allow-list.

### Consequences

- **Neutral:** Restoring a legacy class for convenience is a regression against this ADR; add a Tailwind utility or a primitive instead.
- **Neutral:** The allow-list in the guard test is the reviewed list of exceptions; growing it needs a reason.
- **Neutral:** Tests and the visual suite select `[data-slide-over]` and `[data-highlight]` instead of legacy marker classes.

### Confirmation

Point 4: the guard test `shared/ui/src/legacyCss.test.ts` fails if a removed legacy class name reappears in `src/`, or if `styles.css` gains an unlayered class rule outside its allow-list.
