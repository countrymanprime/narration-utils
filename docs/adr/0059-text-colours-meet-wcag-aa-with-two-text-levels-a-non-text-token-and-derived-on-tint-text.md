# 0059. Text colours meet WCAG AA: two text levels, a non-text token, and derived on-tint text

**Status:** Accepted
**Date:** 2026-09-20
**Supersedes:**
**Amends:** [ADR 0016](0016-highlight-primitive.md) (the colour an entity's text takes)

## Context

The palette did not meet WCAG 2.x AA. `--text-faint` carried real labels (section labels, counts, "Global defaults", "Live activity") at 2.2 to 3.7:1; `--text-muted` fell to 4.32 and 3.85:1 on `--surface-2` and `--surface-3` in the light theme; the active navigation item was `--accent` on a 10% accent tint at 4.03:1; and the `Highlight` category colours, used as text on a 20% tint of themselves, reached 3.6 to 4.3:1 in light and 2.5 to 2.9:1 in dark for Lore, Item and Event, because `--lore`, `--item`, `--event` and `--note` had no dark override at all (an unlayered `:root` block at the bottom of `styles.css`). Entity badges, the warn colour used as text and the danger and review text on their soft tints fail the same way. [ADR 0023](0023-visual-suite-capture-contract-and-storybook.md) recorded the first four as ratcheted debt in `apps/ui/tests/atlas/a11y-debt.ts` rather than recolouring silently, and asked for a decision. Axe runs only on stories, never on app states, so nothing measured the rest.

The owner decided (implementation plan D5, and the palette PRD's questions 3 to 8 took their recommendations): the text ramp has two levels plus a non-text token, not three AA levels; highlight and badge text are derived from the category colour; the failures beyond the four debt entries (badges, warn text) are in scope; and a permanent test guards the palette.

## Decision

**Two text colours, both AA on every surface.** `--text` and `--text-muted` are at least 4.5:1 on `--bg`, `--surface`, `--surface-2`, `--surface-3` and `--row-alt`, in both themes. `--text-faint` is retired as a text colour: every place that drew text with it is triaged into muted text (labels, counts, helper text, placeholders: it read as text) or into the non-text token (icons, dots, decorative glyphs), and then the token itself is deleted from `styles.css`. The light `--text-muted` moves from `#6e6959` to `#625e52` (4.55:1 on `--surface-3`, the darkest surface); the dark value already passes. The step between prose and a label is carried by size, weight, case and the typeface (the labels are already small caps or monospace), not by a third grey.

**One non-text token, at least 3:1.** `--non-text` is for what a person sees but does not read: status dots, icon glyphs, the border of an icon, decorative arrows and dashes (WCAG 1.4.11). Starting values `#7e796a` (light) and `#817966` (dark), 3.05:1 and 3.03:1 on `--surface-3`. It is never the colour of text that carries information, and the palette guard requires it to hold 3:1 on every surface.

**Active navigation text is `--accent-strong`** on the accent tint, in `NavButton` (the Settings category tabs already use it, [ADR 0054](0054-tabs-and-toggle-groups-name-and-link-what-the-hand-built-strips-left-anonymous.md)). `--accent` is unchanged, so buttons do not move.

**Highlight and badge text are derived, per kind:** `--<kind>-text: color-mix(in srgb, var(--<kind>) 50%, var(--text))`, defined in both theme blocks for `character`, `place`, `org`, `review`, `lore`, `item` and `event`. `Highlight` and the entity badges use it for their text; the tint and the 1.5 px underline stay the pure category colour (a mark, held to 3:1). This amends ADR 0016 in one respect only: an entity still tints its text in the kind colour and a note still keeps the text colour, but "the kind colour" is now the derived, darker (light) or lighter (dark) mix of it. Because a user's colour setting replaces `--<kind>`, the derived token follows the user's hue.

**User-chosen colours are not guaranteed.** The category colours are user settings, written inline on `<html>`. The 50% mix makes every shipped colour pass, and most user colours, but a very light or saturated choice (a pure `#00ff00`, `#ffff00` or `#00ffff` measured 3.35 to 3.80:1) can still fall short. This is accepted and documented: guaranteeing it would need neutral text on the tint, which gives up the coloured text ADR 0016 chose. A contrast hint beside the colour pickers is a possible follow-up, not part of this decision.

**Dark overrides for `--lore`, `--item`, `--event` and `--note`**, moved into the same token blocks as the other colours (ADR 0010 keeps dark values in `:root[data-theme='dark']`). The hexes are chosen by eye in the phase's screenshot review, held to 3:1 as marks and to 4.5:1 through the derived text.

**Status text:** `--warn-text` (and the equivalent for the danger, review and info text on their soft fills where the guard finds them short) is a text-safe companion to the fill colour `--warn`, which stays for dots and fills.

**The guard is a test, and it is a ratchet.** `apps/ui/src/paletteContrast.test.ts` parses both theme blocks of `styles.css` (`tokenContrast.ts` evaluates `var()`, `color-mix(in srgb, ...)`, `transparent` and `rgba`, and composites tints over the surface the way the browser paints them), and asserts a declared list of pairs: 4.5:1 for text, 3:1 for marks, each over every surface it can sit on. It asserts the order text over muted, and that every colour token the source draws text with has a declared pair. Pairs that fail on the day the test landed are listed in `KNOWN_FAILURES`, each with the phase that fixes it; the list may only shrink, an entry whose pair now passes fails the test until it is deleted, and `MAX_KNOWN_FAILURES` is lowered with it. The four `A11Y_DEBT` entries go with their phases and `MAX_DEBT_ENTRIES` reaches 0 in the last one.

The current colour values live in `apps/ui/src/styles.css` and are described in [design-system.md](../design/design-system.md); the test, not this record, is what holds them to the floors above.

## Consequences

- Every text pair the app declares is AA in both themes, and a new low-contrast pair turns a fast Vitest test red, with the pair, the surface and the ratio in the message. Page-level pairs still depend on the declared list plus the census of tokens used as text; axe on app states (the test flakiness PRD's phase 6) is the wider net and is now unblocked.
- The interface loses its third grey. Text that was faint (section labels, counts, timestamps) is now as dark as muted text; the hierarchy there rests on type. The light theme looks slightly heavier; the dark theme's former faint text is much brighter.
- About 73 usages in about 23 component files change colour token, in reviewable slices by area, each with the full visual suite.
- Highlights and badges are a little darker (light) or lighter (dark) than the pure category colour, and the underline keeps the pure colour.
- Border contrast (`--border` at 1.56:1 on white, WCAG 1.4.11 for component boundaries) is not decided here.
- To change any of this, write a new ADR that supersedes this one.

## Update (phase 4)

The decision stands. Building the dark palette corrected four details:

- **The mix is 45% kind colour, 55% text colour, not 50%, and the tokens are defined once.** At 50% a highlight nested in another highlight (an alias inside a longer name, an entity inside a note) put the derived text on two stacked tints and measured about 4.4:1 (4.37 to 4.50) in the dark theme, which axe found in the reader. At 45% the worst two-tint case is 4.59:1 in dark and 5.35:1 in light, and the guard checks every inner kind over every other kind's tint. A third stacked tint (an entity with two aliases on one word, or the "Go to line" tint under the row) is not covered and measures lower: issue #139. The `--<kind>-text` tokens are defined once in `:root`, not in both theme blocks, because they resolve against each theme's own `--text`.
- **The seven entity colours are not user settings in the shipped app.** The host offers `color_note` and the three diff-marker colours only (`apps/desktop/app.go`, `fieldSchemas`); the mock offered seven more. The app writes the colour settings it maps (`App.tsx`, `Settings.tsx`) inline on `<html>`, where they beat both theme blocks, so in every dark capture and axe pass the entity colours showed their light hexes and the dark tokens never rendered. The mock now matches the host. So "user-chosen colours are not guaranteed" applies to a future setting and to the note colour (whose text is `--text`, so there is nothing to guarantee); the derived tokens still follow any override.
- **The dark values** are `--lore` `#c49056`, `--item` `#6ea5bc`, `--event` `#d37e9b` and `--note` `#d4865a`, taken from the light hues at the lightness of the existing dark colours (about 0.69 in OKLCH) and checked by eye in the reader, the legend and the atlas.
- **`--note` in the dark theme is a fallback the running app does not use.** It writes the repo default note colour inline, which beats the dark token, so the note dot and underline stay `#b85c1e` in dark: 3.70:1 on `--surface` and 3.19:1 on `--row-alt` as a mark, which passes. The guard's dark note pairs measure the token, not that painted colour, so a change of the default would not trip it: issue #138.

## Update (phase 5)

- **Status text has companions, not a `--review` equivalent.** `--danger-text`, `--warn-text` and `--info-text` carry text on the page and on the status colours' soft fills, and `--danger`, `--warn` and `--info` stay for borders, dots and fills. The MISREAD word, alerts and the last-completed badge on `--review-soft` use `--danger-text` (`--danger` and `--review` are the same hex); `--review-text` stays for the Review entity kind's highlight and badge. In light they darken the fill colour toward `--text` (85%, 50% and 90% of the fill colour; the warn share is set by a warn tint on a hovered or selected table row, which measures 4.52:1 at 55%). In dark the fill colours already pass, so the companions equal them. Unlike the entity tokens they are therefore not defined once: the dark block overrides them. The dots and meter segments drawn in `--warn` and `--info` are held to 3:1 on the surface (`--warn` is 3.26:1 there in light, and 2.56:1 on `--surface-2`, which no such mark sits on).
- **Placeholders are text.** Tailwind's preflight draws them at half the text colour, 3.25:1 in the light theme, and neither axe nor the pairs saw it. `styles.css` draws them in `--text-muted`.
- **Text takes tokens only.** A test rejects a Tailwind palette colour or a literal colour as a text colour (`text-red-400` in the Results table was 2.89:1 on white in light).
- The guard's ratchet is empty and the atlas debt list has been empty since phase 4.
