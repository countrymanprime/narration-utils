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
| `--ok-text` | `--ok` darkened 30% toward `--text` | `--ok` | 4.5 or more | 4.5 or more |
| `--experimental-text` | `--experimental` darkened 15% toward `--text` | `--experimental` | 5.29 or more | 6.18 or more |

The surfaces are `--bg`, `--surface`, `--surface-2`, `--surface-3` and `--row-alt` (a reader row, a touch darker than `--surface`). The status companions are measured on the page surfaces (`--bg`, `--surface`, `--surface-2`) and on the soft fills they sit on (`--review-soft`, a warn tint, `--accent-soft`, `--place-soft`); the other tokens on all five. There are two text levels, not three: `--text-faint` was deleted, because it carried real labels at 2.2 to 3.7:1. The step between prose and a label is carried by size, weight, case and typeface. `--non-text` is never the colour of text.

## Studio primitives (Phase 1 token batch)

Studio UI Primitives' Phase 1 ([ADR 0360](../adr/0360-studio-primitives-land-as-flat-leaf-files-after-one-token-batch-and-capability-gating-is-a-primitive.md), a PRD deleted, delivered) adds every colour token the ten new primitives need, in one phase that runs alone, so no later phase touches `styles.css`, `paletteContrast.test.ts` or `tokenContrast.ts`.

- **Meter zones (`LevelMeter`):** `--meter-floor`, `--meter-body`, `--meter-hot` and `--meter-over` are named for their role, not new hues. Each is a derived alias — `--meter-floor: var(--non-text)`, `--meter-body: var(--ok)`, `--meter-hot: var(--warn)`, `--meter-over: var(--danger)` — declared once, the same way `--row-alt` is: it needs no dark override of its own, because it resolves through whichever theme's aliased token is active. Each still gets its own `PAIRS` row (as a mark, 3:1 on `--surface`) so a later phase that breaks the alias fails the guard on the meter specifically, not only on the token it borrowed from.
- **The 14% badge tints:** `--badge-danger-fill` (ReadingControlBar's chip, until Phase 13) and `--badge-experimental-fill` (`StatusBadge`'s experimental tone, which has no soft token) are each a 14% tint of the tone colour (`color-mix(in srgb, var(--<tone>) 14%, transparent)`), declared once and checked as a text pair (4.5:1) against that tone's own `-text` colour on `--surface`. 14%, not the entity badges' 18% ([ADR 0059](../adr/0059-text-colours-meet-wcag-aa-with-two-text-levels-a-non-text-token-and-derived-on-tint-text.md)): at 18%, `--danger-text` on an 18% `--danger` tint measures 4.29:1 in the dark theme. 14% holds 4.5:1 or more for every tone, in light and dark.
- **The `experimental` tone:** a fifth status meaning (ADR 0360 Q6, alongside `--ok`/`--warn`/`--info`/`--danger`) for a capability the host reports as experimental ([ADR 0300](../adr/0300-every-daw-is-reached-through-one-port-of-small-role-interfaces-and-callers-ask-a-resolver-what-it-supports.md)). `--experimental` (`#1f7a7a` light, `#4fbdbd` dark) is a teal, chosen distinct from every existing kind and status hue (in particular `--org`'s purple and `--item`/`--info`'s blues). `--experimental-text` follows the same recipe as `--danger-text`/`--info-text`/`--ok-text`: darkened toward `--text` in light, the raw colour in dark.
- **The booth follows the theme (`FocusShell`, `CompactShell`):** there is no booth palette. The theme is one global setting, and no page or surface forces light or dark ([ADR 0365](../adr/0365-the-theme-is-one-global-setting-and-the-booth-and-companion-follow-it.md), which superseded ADR 0360 Q1's forced-dark `[data-surface='booth']` block and ADR 0362's third `booth` map). The booth and the DAW companion draw with the active theme's tokens. The booth-only size tokens are `--font-size-booth-script` and `--line-height-booth-script`, declared once in `:root` for both themes; its colour tokens, `--reading-bg` and `--rec-fill`/`--rec-text`, have a value in each theme block (see the mock fidelity batch below). `paletteContrast.test.ts` runs every pair over `['light', 'dark']`, and `forcedThemeRules` (`src/tokenContrast.ts`) fails any rule outside the two theme blocks that sets `color-scheme` or redeclares a theme colour. A booth-only colour added later gets a value in both theme blocks and a `PAIRS` row, never a scoped block.

## Per-speaker colours (D85 #6 token batch)

D85 #6 on [#509](https://github.com/countrymanprime/narration-utils/issues/509) ([ADR 0367](../adr/0367-per-speaker-colours-alias-the-seven-entity-kind-hues-and-hash-by-speaker-name.md)) gives each speaker in the Script reader's attribution chip and the Booth's "Voices in scene" tags its own colour, as the benchmark mocks show, instead of the one `--character` colour every speaker drew before this batch.

- **`--speaker-1` through `--speaker-7`** each alias one of the kind colours above, in this order: `character`, `place`, `org`, `review`, `lore`, `item`, `event` (and their `-text` companions the same way) — the same alias derivation the meter zones use, so each needs no dark override or new contrast tuning of its own; a dedicated `speaker-N` row in `PAIRS` still protects the speaker use specifically.
- **`apps/ui/src/components/primitives/speakerColor.ts`** hashes a speaker id (a canonical name, or an entity id where one is available) to one of the seven, deterministically. An eighth or later distinct speaker wraps back to `--speaker-1` (`--character`), the same colour an unresolved speaker (no id at all) falls back to.
- **Two call sites, one derivation:** `primitives/SpeakerTag.tsx` (the Script reader's chip) reads `speakerColorToken` directly; `primitives/Highlight.tsx`'s `colorToken` prop overrides a mark's own kind colour with it, so the Booth's "Voices in scene" tags stay the same `Highlight kind="Character"` mark (data attribute, activation, keyboard support) with only their colour source changed.
- **Known limitation:** hashing by name, not a persistent id, means two speakers who share a display name draw identically, and with only seven buckets a modest cast collides more often than not (the birthday paradox) — accepted for now per ADR 0367 rather than inventing new hues, which would need a second round of hand-tuned contrast.

## Mock fidelity token batch

The mock fidelity work ([ADR 0590](../adr/0590-the-mock-fidelity-token-batch-fills-badges-with-opaque-soft-tokens-and-names-the-mocks-sizes-and-type.md)) added the colours the benchmark mocks draw that no token named. Each one was measured on the mocks, and every primitive now draws them: the `-soft` fills by `StatusBadge` and `Pill`, `--row-selected` by `Table` and `StageGrid`, `--reading-bg` and `--rec-fill`/`--rec-text` by the Booth, `--toast-bg`/`--toast-text` by `Toast`, `--waveform` by Proof's waveform card and `--ok-zone` by Master's book-consistency band. A colour a later mock needs is a follow-up token batch with its own `paletteContrast.test.ts` rows, never a value written into a component.

| Token | Light | Dark | Pair and worst ratio (light / dark) |
| --- | --- | --- | --- |
| `--ok-soft` | `--character-soft` | `--character-soft` | `--ok-text` on it: 5.26 / 6.69 |
| `--warn-soft` | `--warn` 18% over `--surface` | the same recipe | `--warn-text` on it: 5.69 / 5.90 |
| `--info-soft` | `--place-soft` | `--place-soft` | `--info-text` on it: 4.73 / 5.30 |
| `--danger-soft` | `--review-soft` | `--review-soft` | `--danger-text` on it: 4.98 / 4.87 |
| `--row-selected` | `--accent` 8% over `--surface` | the same recipe | a surface: `--text` 15.01 / 12.69, `--text-muted` 5.85 / 6.31, `--danger-text` 5.77 / 5.00 |
| `--reading-bg` | `--surface` | `#0e0d09` | a reading surface: `--text-muted` 6.48 / 8.20 |
| `--rec-fill` / `--rec-text` | `--review-soft` / `--danger-text` | `#5e1d16` / `#f9b8af` | 4.98 / 7.52 |
| `--toast-bg` / `--toast-text` | `--text` / `--bg` | the same | 14.47 / 15.58 |
| `--waveform` | `--accent` 76% over `--surface` | the same recipe | a mark on the card: 3.06 / 4.41 |
| `--ok-zone` | `--ok` 16% over `--surface-2` | the same recipe | the `--accent` tick on it, a mark: 3.05 / 4.40 |

- **The status soft fills are opaque.** A pill draws the same colour on a card and in a selected row. Each is measured over both. They replace `StatusBadge`'s 14% `--badge-*-fill` tints (ADR 0362's badge-fill clause). Phase 2 moved `StatusBadge` onto them ([ADR 0600](../adr/0600-every-pill-tag-and-status-dot-is-one-badge-primitive-with-a-pill-a-tag-and-a-booth-shape.md)) and deleted the ok, warn and info tints.
- **`--row-selected` and `--reading-bg` are surfaces.** `--row-selected` is in `SURFACES` and `PAGE_SURFACES`, and `--reading-bg` is in `READING_SURFACES`, so every pair drawn there is measured there.
- **Two values are lighter or darker than the mock** so that a mark keeps 3:1. `--waveform` is 76%; the mock measures 65 to 77%. `--ok-zone` is 16%; the mock is exactly 18%, but the band's accent ticks were then 2.98:1.

## Choosing a colour for something new

| It is | Use |
| --- | --- |
| Body text, values, titles | `--text` |
| A label, count, helper text, placeholder, empty state, timestamp | `--text-muted` (a placeholder gets it from `styles.css`) |
| An icon, dot, decorative glyph, an unset colour | `--non-text` (and list it in `NON_TEXT_USES` in `paletteContrast.test.ts` with what it draws) |
| The current item on an accent tint (navigation, tabs) | `--accent-strong` |
| Error, warning or info text, on the page or on a soft fill | `--danger-text`, `--warn-text`, `--info-text`; `--danger`, `--warn` and `--info` stay for borders, dots and fills |
| A requirement met (Master & QC's rule results) | `--ok-text`; `--ok` stays for borders, dots and fills |
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

Enforced beyond the token test: axe runs on every app state in the visual suite ([ADR 0064](../adr/0064-the-visual-suite-runs-axe-on-every-app-state-and-a-violation-fails-unless-it-is-declared-debt.md)), and none of its declared debt is `color-contrast`; the suite runs the light theme by default, so the dark palette is guarded by the token test and by a manual `UI_THEME=dark UI_AXE=1` run. Not enforced by a test: border contrast.

## Checking a colour change

1. `pnpm --dir apps/ui exec vitest run src/paletteContrast.test.ts` (fast, names the pair, the surface and the ratio).
2. `pnpm check`, and `pnpm --dir apps/ui atlas` when a primitive or `styles.css` changed.
3. The visual suite in both themes (`UI_THEME=dark` runs the whole suite in dark; the run ends with a known validation failure on `theme-dark` and `reader-dark`, which match their default states there), at every viewport, and look at the PNGs: `screenshots/app/<page>/<state>/<viewport>.png`.
4. For a wide change, an axe `color-contrast` pass over every state in both themes catches what the declared pairs miss (it found nested highlights and placeholders while the palette stack was built).
5. Regenerate the documentation images once, after the last visual change (`doc-screenshot-sync`).
