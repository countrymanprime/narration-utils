# 0362. The studio token batch aliases meter and badge colours, and the booth block overrides only what it must

**Status:** Proposed
**Date:** 2026-09-26
**Supersedes:**

## Context

[ADR 0360](0360-studio-primitives-land-as-flat-leaf-files-after-one-token-batch-and-capability-gating-is-a-primitive.md) decided *that* every studio-primitive colour token lands in one phase, alone, and *that* the booth look is a scoped `[data-surface='booth']` block rather than a third app theme. It left the exact token names, the exact colours, and how much of the palette the booth block actually overrides to the phase that implements it (Phase 1 of [Studio UI Primitives](../prds/studio-ui-primitives.prd.md)). Three concrete choices came out of doing that work, verified against `tokenContrast.ts`'s own arithmetic rather than picked by eye:

1. `LevelMeter`'s four zones (floor, body, hot, over) need distinguishable colours, but the app already has four tones with exactly that meaning (`--non-text`, `--ok`, `--warn`, `--danger`), each already a declared, passing pair.
2. `StatusBadge`'s chip fill needs a tint of each tone that holds 4.5:1 against that tone's own `-text` colour. The entity badges' established 18% tint ([ADR 0059](0059-text-colours-meet-wcag-aa-with-two-text-levels-a-non-text-token-and-derived-on-tint-text.md)) does not: `--danger-text` on an 18% `--danger` tint measures 4.29:1 in the dark theme (checked with `tokenContrast.ts`'s own `resolveContrast`, not estimated).
3. `[data-surface='booth']` needs to be dark and high-contrast (ADR 0360 Q1) and to be checked as a third map by the palette guard, but "checked as a third map" only has teeth if the booth block actually changes some of the tokens `PAIRS` already measures — otherwise every existing pair would just repeat its dark-theme number.

## Decision

**The meter zones are aliases, not new hues.** `--meter-floor: var(--non-text)`, `--meter-body: var(--ok)`, `--meter-hot: var(--warn)`, `--meter-over: var(--danger)`, declared once in the base `:root` block of `apps/ui/src/styles.css`, the same way `--row-alt` is derived once and resolves per theme through whatever `--surface`/`--text` are active. Each still gets its own row in `PAIRS` (`paletteContrast.test.ts`), as a mark (3:1) over `--surface`, so a later phase that repoints one alias to a new hex fails the guard on the meter specifically.

**The badge fills are a dedicated 14% tint, not the entity badges' 18%.** `--badge-ok-fill`, `--badge-warn-fill`, `--badge-info-fill`, `--badge-danger-fill` and `--badge-experimental-fill` are each `color-mix(in srgb, var(--<tone>) 14%, transparent)`, declared once. 14% is the highest round percentage that holds 4.5:1 for all five tones' `-text` colour on `--surface`, in light, dark and booth alike (checked, not assumed, before it was picked).

**`experimental` is a fifth status tone**, a teal (`#1f7a7a` light, `#4fbdbd` dark) chosen to sit apart from every existing kind and status hue, in particular `--org`'s purple and `--item`/`--info`'s blues. Its `-text` companion follows the existing `--danger-text`/`--info-text`/`--ok-text` recipe (darkened toward `--text` in light, the raw colour in dark).

**The booth block overrides only `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--border`, `--text`, `--text-muted` and `--non-text`, plus `--font-size-booth-script`.** Everything else a booth-mode screen draws — the kind colours, `--accent`, `--danger`/`--warn`/`--info`/`--ok` and their `-text` companions, the meter zones and badge fills above — is a token the booth block does not list, so it falls through from the dark theme by the same cascade mechanism `:root[data-theme='dark']` uses to fall through from light. `tokenContrast.ts` composes it the same way: `boothTokens()` reads the block, and `parseThemes()` layers it over `dark` (not `light`) as `booth`, its third returned map. `paletteContrast.test.ts` runs every declared pair — old and new — over all three (`THEME_NAMES = ['light', 'dark', 'booth']`), which is what makes overriding only the surface/text tokens a meaningful check: most existing pairs read one of those as `fg` or as the `over` surface, so the booth override changes their number, while pairs that sit on an opaque soft fill (`--review-soft`, `--accent-soft`) are unaffected, correctly, because the booth block does not need to change them to be higher-contrast.

## Consequences

- **Fewer new colours to maintain.** The meter zones cost nothing to keep in sync with `--ok`/`--warn`/`--danger`/`--non-text`, because they are the same value, not a copy of it.
- **One badge-fill percentage, everywhere.** A future tone added to `StatusBadge` reuses 14% unless it fails the same check this ADR ran, in which case it needs its own dedicated percentage the way this batch would have needed one for `--danger` alone if the other three tones hadn't also been checked.
- **The booth palette is deliberately incomplete.** A future primitive that draws a colour the booth block does not override (an entity kind, `--accent`) gets the dark theme's value while inside `FocusShell`, not a booth-tuned one. If a primitive is found to need a booth-specific version of one of those, that is a new decision (a new booth override, checked the same way this one was) and, per ADR 0360, waits for a follow-up token batch — it is not added to a feature phase's own pull request.
- **Changing this decision.** To rename a meter zone or badge fill token, change the 14% figure, or override more of the palette inside `[data-surface='booth']`, write a new ADR in lane U's block (0362–0379) that supersedes this one, and re-run `paletteContrast.test.ts` (it will fail loudly if the new value does not hold 4.5:1/3:1 in all three maps).
