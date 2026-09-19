# Design system reference

**Status: living document — describes current state, not a point-in-time decision.** Each entry links back to the ADR that justified it. Unlike `docs/adr/`, this file is meant to be edited as the system evolves; the ADRs underneath it are what stay immutable.

## Tokens

Design tokens are CSS custom properties defined in `shared/ui/src/styles.css`'s `:root` block, with dark-mode overrides in a single `:root[data-theme='dark']` block. New Tailwind-based components reference them via arbitrary-value syntax — `bg-[var(--surface)]`, `border-[var(--border)]`, `text-[var(--text-muted)]` — rather than duplicating values into `tailwind.config.js`. See [ADR 0003](../adr/0003-tailwind-tokenized-primitives.md).

Key tokens: `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--border`, `--text`, `--text-muted`, `--text-faint`, `--accent`, `--accent-strong`, `--accent-soft`, `--accent-contrast`, `--danger`, `--character`/`--place`/`--org`/`--review` (category colors), `--backdrop` (modal/drawer scrim), `--shadow`, `--shadow-lg`. `--space-*`/`--font-size-*` are additive spacing/type-size steps, grounded in values already repeated across the file — not a full scale, for new/touched code to converge on rather than picking another one-off rem value.

**Theme switching:** `data-theme` on `<html>` is set by `ThemeProvider`/`useTheme` (`shared/ui/src/theme/`), a tri-state Light/Dark/System preference persisted to `localStorage`, exposed via a new "Appearance" category in `Settings.tsx`. An inline bootstrap script in `index.html` sets the attribute before first paint to avoid a flash of the wrong theme. See [ADR 0010](../adr/0010-theme-switching.md).

## Primitive components

Location: `shared/ui/src/components/primitives/`.

**The component atlas is the source of truth for what each primitive can look like.** Every primitive has a `<Name>.stories.tsx` next to it (one story per variant/state, `play()` for the primary interaction). Browse it with `pnpm --dir shared/ui storybook`; `pnpm --dir shared/ui atlas` builds it and captures every story in light/dark at a wide and a narrow viewport, failing on axe violations, a throwing `play()`, sideways overflow, or console errors. `src/atlasCoverage.test.ts` fails if a primitive has neither a story nor a recorded exemption, and `src/stories.test.tsx` runs every story as a unit test. The table below is a summary; when it and the atlas disagree, the atlas wins. See [ADR 0023](../adr/0023-visual-suite-capture-contract-and-storybook.md).

| Component | Purpose | Notes |
| --- | --- | --- |
| `Dialog` | Modal shell (backdrop, head, scrollable body, action row) | Max-width `70vw`, `overflow-x-hidden` + `break-words` body ([ADR 0001](../adr/0001-import-dialog-max-width-and-overflow.md)); `actionsAlign="between"` default, `"end"` for single-action dialogs ([ADR 0002](../adr/0002-dialog-action-button-placement.md)) |
| `Button` | Tokenized button, `primary`/`ghost`/`danger` variants | Bakes in `disabled:pointer-events-none` so future buttons don't need to remember to guard hover-while-disabled by hand |
| `Highlight` | Highlighted text (entity / note / review, plus the Teleprompter's `Cursor` word) | One category→color mapping; fills the line height; `Cursor` is a solid accent fill, not a tint ([ADR 0016](../adr/0016-highlight-primitive.md), [ADR 0024](../adr/0024-teleprompter-highlight-follows-the-sidecars-spans.md)) |
| `SlideOver` | Right-edge panel with click-away backdrop | Pure Tailwind; `invisible translate-x-full` when closed ([ADR 0017](../adr/0017-no-legacy-css-shadowing-tailwind.md)) |
| `Pill` | Toggle chip | Active/inactive classes are mutually exclusive so text stays readable in dark mode |
| `MeterBar` | Segmented horizontal meter | Caller controls segment order — see [ADR 0006](../adr/0006-chapter-progress-bar-ordering.md) for why the chapter-progress usage reverses it |

The custom-CSS system (`.btn`, `.panel-head`/`.panel-body`, `.progressbar`, etc.) that ADR 0003 deliberately left in place for not-yet-migrated consumers has since been fully migrated to Tailwind utilities — see [ADR 0009](../adr/0009-complete-tailwind-migration.md), which supersedes ADR 0003. New UI work should reach for Tailwind utilities directly rather than adding to `styles.css`. ADR 0009 also lists the small set of deliberate exceptions still in `styles.css` (a generic `table.dtable` style, scrollbar-hiding rules, keyframe animations, and a handful of unstyled "marker" classes kept only because visual/unit tests select by CSS class).

## Conventions

- **Numeric table columns are right-aligned** (`text-right` on both `<th>` and `<td>`) — see `AudiobookEstimatePanel.tsx`'s Words/Est./Actual columns for the reference implementation.
- **Disabled interactive elements never show a hover affordance.** Use `disabled:pointer-events-none` (Tailwind) alongside `disabled:opacity-*`, not just the opacity change alone — a hover transform/background change that still fires on a disabled element reads as clickable when it isn't.
- **A field that is read-only, locked or not-yet-persisted is `disabled`, not hidden**, so the user can see what exists without being able to edit it. Story Bible entries open read-only and gain Edit/Save/Cancel controls only on request ([ADR 0018](../adr/0018-story-bible-entries-read-only-until-edit.md)); see `GuideDetail.tsx`.s `editingDisabled`.
- **A non-destructive "peek at something else" action is a `SlideOver` primitive, never a navigation that replaces the current view's state.** See `Manuscript.tsx`'s Chapters & Search overlay and `GuideDetail.tsx`'s "Review entry" overlay — both exist specifically so switching context doesn't discard an in-progress edit.

## Manuscript reader

- **Alternating rows.** Paragraph rows alternate between `--surface` and `--row-alt` (a touch darker in light theme, a touch lighter in dark) with a 1px `--border` line between rows, like banded table rows. Highlights tint with `transparent` mixes so they read on either row.
- **Highlights** are the `Highlight` primitive only ([ADR 0016](../adr/0016-highlight-primitive.md)): entity, note and review share one look, filling the full line height, in the kind's color.
- **Sticky chapter headers** are opaque (`bg-[var(--surface)]`) with a soft shadow once stuck; they must never be transparent over scrolling text.
- **"Go to line" target** stays highlighted (accent edge and tint) for 60 seconds (`JUMP_HIGHLIGHT_MS` in `Manuscript.tsx`), with a brief ring pulse on arrival.
- **Formatting and line breaks** from import (`spans`, `\n`) render as `<strong>`/`<em>`/`<u>` and `white-space: pre-line` ([ADR 0014](../adr/0014-inline-formatting-as-offset-spans.md)).
- **Side panels** use `SlideOver`; state-dependent classes are mutually exclusive ([ADR 0017](../adr/0017-no-legacy-css-shadowing-tailwind.md)).

## CSS layering gotcha

`styles.css` wraps only *some* rules in `@layer base`/`@layer components` (roughly lines 66–616); everything after that is unlayered plain CSS. Unlayered rules always beat Tailwind utilities (which live in the implicit `@layer utilities`) for the same property, regardless of source order. Before adding a Tailwind override next to a legacy class name, check whether that class is inside a `@layer` block — if it's unlayered, the Tailwind utility will silently do nothing for any property the legacy rule already sets.

## Motion

See [`motion-and-animation.md`](motion-and-animation.md) — not yet a formal system, currently one considered instance (`MeterBar`'s segment transition).
