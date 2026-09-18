# Design system reference

**Status: living document — describes current state, not a point-in-time decision.** Each entry links back to the ADR that justified it. Unlike `docs/adr/`, this file is meant to be edited as the system evolves; the ADRs underneath it are what stay immutable.

## Tokens

Design tokens are CSS custom properties defined in `shared/ui/src/styles.css`'s `:root` block, with dark-mode overrides in a single `:root[data-theme='dark']` block. New Tailwind-based components reference them via arbitrary-value syntax — `bg-[var(--surface)]`, `border-[var(--border)]`, `text-[var(--text-muted)]` — rather than duplicating values into `tailwind.config.js`. See [ADR 0003](../adr/0003-tailwind-tokenized-primitives.md).

Key tokens: `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--border`, `--text`, `--text-muted`, `--text-faint`, `--accent`, `--accent-strong`, `--accent-soft`, `--accent-contrast`, `--danger`, `--character`/`--place`/`--org`/`--review` (category colors), `--backdrop` (modal/drawer scrim), `--shadow`, `--shadow-lg`. `--space-*`/`--font-size-*` are additive spacing/type-size steps, grounded in values already repeated across the file — not a full scale, for new/touched code to converge on rather than picking another one-off rem value.

**Theme switching:** `data-theme` on `<html>` is set by `ThemeProvider`/`useTheme` (`shared/ui/src/theme/`), a tri-state Light/Dark/System preference persisted to `localStorage`, exposed via a new "Appearance" category in `Settings.tsx`. An inline bootstrap script in `index.html` sets the attribute before first paint to avoid a flash of the wrong theme. See [ADR 0010](../adr/0010-theme-switching.md).

## Primitive components

Location: `shared/ui/src/components/primitives/`.

| Component | Purpose | Notes |
| --- | --- | --- |
| `Dialog` | Modal shell (backdrop, head, scrollable body, action row) | Max-width `70vw`, `overflow-x-hidden` + `break-words` body ([ADR 0001](../adr/0001-import-dialog-max-width-and-overflow.md)); `actionsAlign="between"` default, `"end"` for single-action dialogs ([ADR 0002](../adr/0002-dialog-action-button-placement.md)) |
| `Button` | Tokenized button, `primary`/`ghost`/`danger` variants | Bakes in `disabled:pointer-events-none` so future buttons don't need to remember to guard hover-while-disabled by hand |
| `MeterBar` | Segmented horizontal meter | Caller controls segment order — see [ADR 0006](../adr/0006-chapter-progress-bar-ordering.md) for why the chapter-progress usage reverses it |

The custom-CSS system (`.btn`, `.panel-head`/`.panel-body`, `.progressbar`, etc.) that ADR 0003 deliberately left in place for not-yet-migrated consumers has since been fully migrated to Tailwind utilities — see [ADR 0009](../adr/0009-complete-tailwind-migration.md), which supersedes ADR 0003. New UI work should reach for Tailwind utilities directly rather than adding to `styles.css`. ADR 0009 also lists the small set of deliberate exceptions still in `styles.css` (a generic `table.dtable` style, scrollbar-hiding rules, keyframe animations, and a handful of unstyled "marker" classes kept only because visual/unit tests select by CSS class).

## Conventions

- **Numeric table columns are right-aligned** (`text-right` on both `<th>` and `<td>`) — see `AudiobookEstimatePanel.tsx`'s Words/Est./Actual columns for the reference implementation.
- **Disabled interactive elements never show a hover affordance.** Use `disabled:pointer-events-none` (Tailwind) alongside `disabled:opacity-*`, not just the opacity change alone — a hover transform/background change that still fires on a disabled element reads as clickable when it isn't.
- **A field that is locked/not-yet-persisted is `disabled`, not hidden**, so the user can see what exists without being able to edit it — see `GuideDetail.tsx`'s `editingDisabled = locked || isNewDraft` pattern.
- **A non-destructive "peek at something else" action is an overlay/slide-over (`.overlay-panel`/`.sheet-backdrop`), never a navigation that replaces the current view's state.** See `Manuscript.tsx`'s Chapters & Search overlay and `GuideDetail.tsx`'s "Review entry" overlay — both exist specifically so switching context doesn't discard an in-progress edit.

## CSS layering gotcha

`styles.css` wraps only *some* rules in `@layer base`/`@layer components` (roughly lines 66–616); everything after that is unlayered plain CSS. Unlayered rules always beat Tailwind utilities (which live in the implicit `@layer utilities`) for the same property, regardless of source order. Before adding a Tailwind override next to a legacy class name, check whether that class is inside a `@layer` block — if it's unlayered, the Tailwind utility will silently do nothing for any property the legacy rule already sets.

## Motion

See [`motion-and-animation.md`](motion-and-animation.md) — not yet a formal system, currently one considered instance (`MeterBar`'s segment transition).
