# 0365. The theme is one global setting, and the booth and the companion follow it

**Status:** Accepted
**Date:** 2026-09-27
**Supersedes:** ADR-0360 (its Q1 booth token block only), ADR-0362 (its booth block decision only)

## Context

[ADR 0360](0360-studio-primitives-land-as-flat-leaf-files-after-one-token-batch-and-capability-gating-is-a-primitive.md) settled open question Q1 of Studio UI Primitives (a PRD deleted, delivered) with a high-contrast booth token block, `[data-surface='booth']` in `apps/ui/src/styles.css`, scoped to `FocusShell`. [ADR 0362](0362-studio-token-batch-aliases-meter-and-badge-colours-and-a-minimal-booth-override.md) chose what that block overrides: the surface and text tokens, a copy of the dark theme's status colours, the kind `-text` mixes and `--font-size-booth-script`. `FocusShell` set `data-surface="booth"` on its root. The effect was that the booth was always very dark, whatever the narrator picked in Settings > Appearance: "the booth is a place, not a preference". `tokenContrast.ts` modelled the block as a third map (`booth`, layered over dark), and `paletteContrast.test.ts` checked every pair over light, dark and booth. The `StatusBadge` atlas story `Booth` pinned the whole document to dark so the badges would match.

The owner reversed that on issue #509 (D69, 2026-09-27): dark mode is one app-wide setting, either on or off. No page or surface may force light or dark. The dark backgrounds of the approved booth and DAW companion concept mocks show the dark theme; they are not a per-page look.

## Decision

**The theme is one global setting.** `ThemeProvider` ([ADR 0010](0010-theme-switching.md)) writes `data-theme` on `<html>`, and the two theme blocks, `:root` and `:root[data-theme='dark']`, are the only rules in `styles.css` that set colour tokens a theme varies or set `color-scheme`. No page, dialog or primitive sets `data-theme`, `data-surface` or `color-scheme` of its own, and no rule scoped to a surface redeclares a theme colour.

**The booth and the companion follow the active theme.**

- `[data-surface='booth']` is deleted, and `FocusShell` no longer sets `data-surface`. Booth mode draws with the same tokens as every other screen, in light or dark.
- `CompactShell` (the DAW companion) never forced a theme, and stays that way.
- **The one booth-only token that stays** is `--font-size-booth-script` (1.1rem), for the booth's script view. It is a size, not a colour, and is declared once in the base `:root` block, so it has the same value in light and dark.
- **No booth-only colour or higher-contrast treatment.** The booth uses the theme's palette, and every pair in that palette already meets WCAG AA in both themes ([ADR 0059](0059-text-colours-meet-wcag-aa-with-two-text-levels-a-non-text-token-and-derived-on-tint-text.md)). A booth-only colour token added later has a value in both theme blocks, a `PAIRS` row checked in both themes, and is never a scoped block that forces a scheme.

**The palette guard checks two themes and forbids a forced one.**

- `Theme` in `apps/ui/src/tokenContrast.ts` is `'light' | 'dark'`; `boothTokens` and `countBoothBlocks` are gone, and `paletteContrast.test.ts` runs every pair over `['light', 'dark']`.
- `forcedThemeRules(css, themeCss)` names every rule, other than the two theme blocks, that sets `color-scheme` or redeclares a token the dark theme sets. `paletteContrast.test.ts` asserts it finds none in `styles.css` or `components.css`, so a scoped palette like the old booth block fails the gate. A token neither theme varies, such as a size, may still be scoped.
- The visual suite gains `manuscript / booth-dark`: the booth with Dark chosen in Settings > Appearance. If the booth forced one palette again, it would render the same as `booth-default` and the suite's identical-states check would fail.

## Consequences

- **One place for colour.** A token has a light value and a dark value, and nothing else. There is no third map to keep in sync with dark, and no hand-copied block of dark's status colours to drift.
- **The booth is no darker than dark.** A narrator who wants a dark booth picks Dark for the whole app. A narrator on Light gets a light booth. The deeper, lights-down palette of ADR 0360 Q1 is given up. If one is wanted again, it must be an app-wide theme choice (a new ADR), not a surface-scoped block.
- **What stands of ADR 0360 and 0362.** The one token batch, the flat leaf primitives, `CapabilityGate`, the meter-zone aliases, the 14% badge fills and the `experimental` tone all stand. Only the booth block, and the checking of it as a third map, are superseded. The `StatusBadge` `Booth` story, which forced the document to dark, is deleted. `docs/ui/` still lists it until the next `pnpm --dir apps/ui docs:atlas` run.
- **Changing this decision.** To let any surface choose its own theme or palette, write a new ADR that supersedes this one (see [the ADR README](README.md)). `forcedThemeRules` and the `booth-dark` state will fail until that ADR's change also updates them.
