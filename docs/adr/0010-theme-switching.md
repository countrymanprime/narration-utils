# 0010. Tri-state Light/Dark/System theme switching

**Status:** Accepted
**Date:** 2026-09-18

## Context

`styles.css` already carried dark-mode color values in two places: an OS-driven `@media (prefers-color-scheme: dark)` block and a separate `:root[data-theme='dark']` block, apparently from an earlier, incomplete attempt at a manual override. Nothing in the app ever set the `data-theme` attribute, so the second block was dead CSS, and the two blocks had already drifted — the media-query block adjusted `--shadow`/`--shadow-lg` for dark surfaces, the attribute block didn't. The user asked for "more cohesive theming with tokenized items and a way to swap between themes," i.e. an actual switcher, not just an OS-follow default.

## Decision

Dark values now live in exactly one place, `:root[data-theme='dark']` in `shared/ui/src/styles.css`, restored to include the shadow overrides the media-query copy had. A new `ThemeProvider`/`useTheme` React Context (`shared/ui/src/theme/theme.ts`, `ThemeContext.tsx`) holds a tri-state preference (`'light' | 'dark' | 'system'`), persists it to `localStorage` (`narration-ui-theme`), resolves `'system'` via `matchMedia('(prefers-color-scheme: dark)')` and subscribes to OS changes while on that setting, and writes the `data-theme` attribute onto `<html>` — light is simply the attribute's absence. `main.tsx` wraps the app in `ThemeProvider`; `index.html` carries a small inline bootstrap script that reads the same `localStorage` key and sets the attribute before first paint, so there's no flash of the wrong theme while React mounts. A new "Appearance" category in `Settings.tsx` exposes the three-way choice via the existing `Pill` primitive.

While consolidating, two other tokenization gaps got fixed the same way this ADR aims for: `AppShell.tsx`'s hardcoded `rgba(20,17,12,0.42)` drawer scrim and `Dialog.tsx`'s unrelated `bg-black/40` modal scrim were both replaced with one shared `--backdrop` token, and a small set of additive `--space-*`/`--font-size-*` custom properties were added to `styles.css`, grounded in the rem values already repeated across the file and the primitives — not a full migration, just tokens for new/touched code (the theme switcher itself) to converge on instead of picking another one-off value. This builds on [ADR 0003](0003-tailwind-tokenized-primitives.md)/[ADR 0009](0009-complete-tailwind-migration.md)'s mechanism (CSS custom properties consumed via Tailwind arbitrary-value syntax, no `tailwind.config.js` token system) rather than replacing it.

## Consequences

- There is exactly one CSS-side definition of the dark palette to maintain; the shadow-drift bug this ADR fixes can't reoccur by construction.
- `systemTheme()`/the OS-change subscription both guard `typeof window.matchMedia !== 'function'`, since jsdom (this package's unit-test DOM) doesn't implement it — real browsers and the Wails webview always do, so this is purely a test-environment accommodation, not a runtime fallback path users hit.
- The inline bootstrap script in `index.html` duplicates `theme.ts`'s resolution logic in plain JS, because an inline `<script>` can't import a module. The two must be kept in sync by hand if the storage key or resolution rule ever changes.
- `--space-*`/`--font-size-*` are additive and unenforced — nothing stops new code from writing another arbitrary rem value instead of reaching for a token. They exist to converge toward, not a lint-enforced rule.
