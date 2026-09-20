# 0051. The slide-over and the navigation drawer are modal Base UI drawers

**Status:** Accepted
**Date:** 2026-09-20
**Supersedes:**

## Context

`SlideOver` (the Manuscript "Chapters & Search" and note or entity panels, and the Story Bible "Review entry" panel) and the narrow layout's navigation drawer in `AppShell` closed only on a press of their backdrop. They had no Escape, no focus trap, no focus return, and the page behind stayed readable to a screen reader. The dialog PRD had left them out (its question 7 chose the dialog family only). The owner decided (foundation PRD question 6a, D22) to put both on Base UI's Drawer with `modal` true, which reverses that. The navigation drawer was inline markup inside `AppShell.tsx` with a `z-[70]` div.

## Decision

- **`SlideOver`** (`primitives/SlideOver.tsx`) is a Base UI Drawer from the right edge, and **`NavDrawer`** (`primitives/NavDrawer.tsx`, new) a Drawer from the left for `AppShell`, which now imports only our primitive. Both are modal: the page behind is hidden from assistive technology and unreachable by Tab, Tab loops inside, page scroll is locked, Escape and a press on the backdrop close them, and focus returns to what opened them. Both are named dialogs (`SlideOver` by its title, as an `h3`; `NavDrawer` "Navigation", visually hidden).
- **API and markers unchanged.** `SlideOver` keeps `open`, `title`, `closeLabel`, `onClose`, `children`, the `data-slide-over` marker on the panel and `data-slide-over-backdrop` on its transparent backdrop (`z-[45]`, panel `z-50`), the width, the border and shadow and the slide-in from the right ([ADR 0017](0017-no-legacy-css-shadowing-tailwind.md): Tailwind only). `NavDrawer` keeps the app scrim (`--backdrop`, `z-[70]`), the width `min(17rem, 86vw)` and the Close button, and gains `data-nav-drawer-backdrop`. The Manuscript and Story Bible call sites are untouched.
- **A closed panel is not in the page.** The panel used to stay mounted and invisible so it could slide; the library now keeps it mounted while it slides out and removes it afterwards, so nothing closed can take focus or clicks. Tests that looked for `[data-slide-over]` while closed now assert its absence.
- **Swipe.** The Drawer's touch swipe-to-dismiss comes with it (`swipeDirection` right and left) and follows the pointer through `--drawer-swipe-movement-x`. In `SlideOver` the contents sit in `Drawer.Content`, which lets a mouse drag select text instead of starting a swipe (a review found that without it a rightward drag from the text dismissed the panel); touch still swipes, and the transition is off while dragging.
- **Focus return has a fallback.** Both drawers stay mounted and open through `open`, so `useReturnFocusTarget` (`primitives/focusReturn.ts`) remembers what had focus when they opened and, if that element is gone by the time they close, sends focus into `<main>` like `Dialog` does.
- **`NavDrawer` closes when the window grows past `md`** (48rem), where the menu button that opened it no longer exists and the desktop navigation is already on screen.
- **Tests.** RTL tests for both (`SlideOver.test.tsx`, `NavDrawer.test.tsx`), atlas stories for Escape, backdrop, Close button, the Tab loop, the hidden page and focus return. The visual suite captures no phone viewport ([ADR 0037](0037-visual-suite-captures-no-phone-viewport.md)), so the `NavDrawer` stories are its visual record; every existing visual state with a slide-over open is pixel-identical.

## Consequences

- A keyboard or screen-reader user can leave a panel with Escape, cannot tab into the page behind it, and lands back where they were.
- `Manuscript.tsx` still closes its sheet with its own `window` Escape listener; the drawer's own handling makes it redundant but harmless.
- A drawer's content unmounts after it slides out, so a caller that kept state inside a closed panel would lose it; neither caller does.
- The Drawer's touch swipe is a behaviour the app did not have. It suits the narrow layout's navigation and does no harm to the panels; if it proves unwanted, `SlideOver` can move to a positioned Dialog behind the same props, which is a primitives-only change.
- To change any of this, write a new ADR that supersedes this one.
