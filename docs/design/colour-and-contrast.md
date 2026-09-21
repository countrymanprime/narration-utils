# Colour and contrast

**Status: living document, describes the current state.** The decision is [ADR 0059](../adr/0059-text-colours-meet-wcag-aa-with-two-text-levels-a-non-text-token-and-derived-on-tint-text.md) (with its updates for phases 4 and 5); this file is what to do with it. The tokens themselves live in `apps/ui/src/styles.css` ([design-system.md](design-system.md) has the rest of the token list).

## The rule

Every colour pair the app draws meets WCAG 2.x AA in **both themes**, on **every surface it can sit on**:

- **text** is 4.5:1 or more (SC 1.4.3): everything a person reads, including placeholders, labels, counts and empty states;
- **marks** (what is seen and not read: icons, status dots, meter segments, the highlight underline) are 3:1 or more (SC 1.4.11).

Not covered: the contrast of component borders (`--border` is 1.56:1 on white; ADR 0059 leaves it undecided), disabled controls (WCAG exempts them), and a colour a user chooses in Settings.

## The tokens

| Token | Light | Dark | Contrast, worst to best surface (light) | (dark) |
| --- | --- | --- | --- | --- |
| `--text` | `#211e17` | `#f1ece1` | 11.68 to 16.63 | 11.11 to 15.58 |
| `--text-muted` | `#625e52` | `#b0a891` | 4.55 to 6.48 | 5.52 to 7.74 |
| `--non-text` | `#7e796a` | `#817966` | 3.05 to 4.35 | 3.03 to 4.25 |
| `--accent-strong` | `#96490f` | `#f2a75a` | 4.53 to 6.45 | 6.52 to 9.14 |
| `--danger-text` | `--danger` darkened 15% toward `--text` | `--danger` | 4.98 or more | 4.87 or more |
| `--warn-text` | `#755507` | `--warn` | 4.62 or more | 5.29 or more |
| `--info-text` | `--info` darkened 10% toward `--text` | `--info` | 4.66 or more | 5.30 or more |

The surfaces are `--bg`, `--surface`, `--surface-2`, `--surface-3` and `--row-alt` (a reader row, a touch darker than `--surface`). The status companions are measured on the page surfaces (`--bg`, `--surface`, `--surface-2`) and on the soft fills they sit on (`--review-soft`, a warn tint, `--accent-soft`, `--place-soft`); the other tokens on all five. There are two text levels, not three: `--text-faint` was deleted, because it carried real labels at 2.2 to 3.7:1. The step between prose and a label is carried by size, weight, case and typeface. `--non-text` is never the colour of text.

## Choosing a colour for something new

| It is | Use |
| --- | --- |
| Body text, values, titles | `--text` |
| A label, count, helper text, placeholder, empty state, timestamp | `--text-muted` (a placeholder gets it from `styles.css`) |
| An icon, dot, decorative glyph, an unset colour | `--non-text` (and list it in `NON_TEXT_USES` in `paletteContrast.test.ts` with what it draws) |
| The current item on an accent tint (navigation, tabs) | `--accent-strong` |
| Error, warning or info text, on the page or on a soft fill | `--danger-text`, `--warn-text`, `--info-text`; `--danger`, `--warn` and `--info` stay for borders, dots and fills |
| An entity's text on a tint of its own colour (highlights, badges) | `--<kind>-text` |
| Anything else | A token from `styles.css` with a pair declared in `paletteContrast.test.ts`; never a Tailwind palette colour (`text-red-400`) or a literal colour |

## Category colours

`--character`, `--place`, `--org`, `--review`, `--lore`, `--item`, `--event` and `--note` are the kind colours, each with a light value in `:root` and a dark value in `:root[data-theme='dark']`. The dark ones sit at about the same lightness (0.69 in OKLCH), so the eight read as one family. As a mark (the underline, the dots) each holds 4.09:1 or more in light and 5.03:1 or more in dark.

`Highlight` and the entity badges draw their text in `--<kind>-text`, which is 45% of the kind colour and 55% of `--text` (one definition for both themes; it follows an override of the kind colour). The tint (20% for a highlight, 18% for a badge) and the 1.5px underline stay the pure kind colour. A note keeps `--text` on its tint (ADR 0016). Highlights nest where annotations overlap, so the tints add up: the guard checks every kind over every other kind's tint (two stacked tints, 4.59:1 in dark at worst); a third stacked tint is not covered (issue #139).

In the shipped app only the note colour is a user setting (`color_note`, written inline on `<html>`, where it beats the theme blocks, so the dark `--note` is a fallback: issue #138). The entity colours are not settings, and the mock backend must offer no colour setting the host does not (`mockFixtures.test.ts`): it once did, and every dark screenshot then showed the light colours.

## What enforces it

- `apps/ui/src/paletteContrast.test.ts` reads both theme blocks of `styles.css` (`tokenContrast.ts` evaluates `var()`, `color-mix`, `transparent` and `rgba` and composites tints the way the browser paints them) and holds every declared pair to its floor over every surface it sits on. Its ratchet, `KNOWN_FAILURES`, is empty; an entry is a known failure and gets the review of an atlas debt entry. It also checks the order text over muted over non-text, that every colour a source file draws text with has a declared pair (so a new one cannot ship unmeasured), that no text uses a palette or literal colour, that `--non-text` is used only where an icon, dot or glyph is listed, that placeholders are `--text-muted`, and stacked highlights.
- `apps/ui/src/retiredTokens.test.ts` fails on any mention of `--text-faint` in the UI package.
- The component tests `Highlight.test.tsx`, `EntitySummary.badges.test.ts` and `NavButton.test.tsx` tie the components to the recipes the guard measures (the guard reads tokens, not component source).
- The component atlas (`pnpm --dir apps/ui atlas`) runs axe on every story in both themes; its debt list (`tests/atlas/a11y-debt.ts`) is empty and capped at 0.

Not enforced by a test: axe over the app's own states (it runs on stories only; the test flakiness PRD's phase 6 adds it, and every state is at 0 violations in both themes today), and border contrast.

## Checking a colour change

1. `pnpm --dir apps/ui exec vitest run src/paletteContrast.test.ts` (fast, names the pair, the surface and the ratio).
2. `pnpm check`, and `pnpm --dir apps/ui atlas` when a primitive or `styles.css` changed.
3. The visual suite in both themes (`UI_THEME=dark` runs the whole suite in dark; the run ends with a known validation failure on `theme-dark` and `reader-dark`, which match their default states there), at every viewport, and look at the PNGs: `screenshots/app/<page>/<state>/<viewport>.png`.
4. For a wide change, an axe `color-contrast` pass over every state in both themes catches what the declared pairs miss (it found nested highlights and placeholders while the palette stack was built).
5. Regenerate the documentation images once, after the last visual change (`doc-screenshot-sync`).
