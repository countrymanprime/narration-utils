# 0037. The visual suite captures no phone viewport

**Status:** Accepted (amends ADR-0023; amended by [ADR 0061](0061-settings-states-are-also-captured-at-a-390px-reflow-width.md), which also captures the Settings states at a 390 px reflow width; the default matrix below stands)
**Date:** 2026-09-19
**Supersedes:**

## Context

ADR-0023 made the visual suite a validated capture of every `{page, state, viewport}`, at four viewports: desktop (1440), small-desktop (1024), tablet (768) and mobile (390). Mobile was the slowest of the four (about 4.0s per test against about 2.6s for the others), so it was roughly a third of the `ui-visual` job's test time on its own.

Narration Utils is a companion to a DAW. Nobody runs it on a phone; the narrowest realistic window is a tablet. The desktop shell enforces this: `shell/main.go` sets `MinWidth: 960`, so the shipped window cannot get down to 390px (or to the 768px tablet size). The mobile layout (the hamburger button and slide-in nav drawer, which only exist below Tailwind's `md` breakpoint, 768px) was being screenshotted and gated for a size the shipped app cannot reach.

## Decision

`shared/ui/tests/visual/viewports.ts` lists three viewports: `desktop`, `small-desktop` and `tablet`. There is no `mobile` viewport.

The states that only exist below `md` are removed with it: the `global/nav-drawer-open` catalog row and driver, the hamburger fallback in `clickVisible` (`app.drivers.ts`), and the `nav-drawer-mobile` documentation screenshot. The `nav-sidebar-desktop` documentation screenshot is now captured from `home/default` at desktop, which is the same picture.

The app's own responsive CSS is unchanged. The mobile layout still exists; it is no longer captured or gated.

## Consequences

- The visual suite runs 222 tests instead of 300, and drops its slowest viewport.
- A layout regression below 768px is no longer caught by CI. It could only show in a browser, since the shell's minimum width is 960px. The known example is the Settings layout at 390px (planned in `docs/prds/settings-mobile-layout.prd.md`), which no longer has an automated regression check.
- Planned work that verifies at a phone viewport needs revisiting: `docs/prds/settings-mobile-layout.prd.md` (its assumption that narrators use narrow windows is answered here, and its success metrics count "all 300 captures" at four viewports) and the other PRDs that list `mobile` in their PNG review. This decision does not edit them; each is updated or closed when its work is picked up.
- The `tablet` viewport (768px) is kept, because the app is meant to work at tablet size and up. It is also below the shell's 960px minimum, so dropping it would be a further decision of its own.
- The component atlas (`tests/atlas`) still checks components at a 390px `narrow` width; that is a component-level check and was not changed.
- To capture a phone size again, add a viewport to `viewports.ts`, restore a state that opens the nav drawer, and write a new ADR that supersedes this one (see `docs/adr/README.md`).
