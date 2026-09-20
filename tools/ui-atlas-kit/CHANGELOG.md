# Changelog

`ui-atlas sync` refreshes the vendored core files (`plugin/templates/core`) and stamps the version. It does NOT touch
scaffold files (yours after `init`), so the **Adopt by hand** lines below are what to copy across on upgrade.

## 0.3.2

- **Scaffold only** (the vendored core files are unchanged, so `ui-atlas sync` has nothing to refresh and their
  headers still say 0.3.1): `clickVisible` no longer waits 1.5 s and then opens the mobile menu. That heuristic opened
  the drawer over a page that was merely slow, and the drawer's `fixed inset-0` backdrop then intercepted the click
  (measured: a control that renders after 2.5 s at 375 px timed out with "subtree intercepts pointer events"). It is now
  a plain auto-waiting click. New `clickNav(page, name, role = 'link')` is the one helper that opens the drawer, and
  only when the layout shows the menu button instead of the item: it waits for whichever is visible first (no timeout).
  `beforeCapture` is now real code and carries `UI_CPU_THROTTLE=<factor>`, a stress mode that slows the page's CPU so a
  driver that races the render fails on demand (a bare navigation photographed the wrong page at 20x in the reference
  repo, the same failure a busy CI runner produced once in twenty runs); a mistyped value throws.
- **Skills:** `ui-state-catalog` describes the two helpers, the destination wait every navigation needs, and the stress mode.
- **Adopt by hand:** in your `app.drivers.ts` replace `clickVisible`, add `clickNav` and switch every call that clicks a
  navigation item to it (a nav `clickVisible` no longer opens the drawer, so at a phone width it now times out), make each
  `goToPage`-style helper wait for the destination (heading, then content), and add the `UI_CPU_THROTTLE` body to
  `beforeCapture` (keep your `page.route` stubs in it). Then run the suite once with `UI_CPU_THROTTLE=20`.

## 0.3.1

- **Core:** the atlas ignores fixed layers when sizing a tall story to its content and ignores off-canvas fixed layers
  when cropping (a closed slide-over parked below the fold used to make every screenshot two thirds blank); a `fullPage`
  capture taller than 6000px now fails instead of being silently cut off; the atlas config comment no longer says `pnpm`.
- **Core:** stale atlas screenshot folders are pruned (new vendored file `tests/atlas/global-setup.ts`, registered in `playwright.atlas.config.ts`); a story reports all its problems at once (`expect.soft`); axe `incomplete` results are attached as `axe-incomplete` annotations.
- **CLI:** `audit` matches an exemption keyed by a component's path (`'layout/Spacer'`) as well as its file name; the atlas scrolls to the top with `behavior: 'instant'`; `sync --dry-run` writes nothing; `docs` names pages by title when two titles share a component file (stable
  whatever Storybook's index order) and finds importers by the file's name; the docs index pluralises "1 story".
- **Adopt by hand:** none.

## 0.3.0

- **Core:** a tall story is shown whole by growing the viewport (not Playwright's `fullPage`, which stretched fixed
  elements and broke crops after a scrolling `play()`); the atlas fails on images that loaded with no pixels; the atlas
  server is only reused when `UI_REUSE_SERVER` is set; capture rows with `fullPage` grow the viewport; empty page folders
  are pruned.
- **CLI:** `docs` groups by story title with unique names, adopts an existing inventory's casing and deletes generated
  pages/images it no longer produces; `sync` stamps the version; `audit` understands path-keyed exemptions.
- **Adopt by hand:** in your app `playwright.config.ts` use `reuseExistingServer: Boolean(process.env.UI_REUSE_SERVER)`.

## 0.2.0

- **Core:** no raw NUL bytes in `validators.ts` (git treated it as binary); optional `beforeCapture(page)` export in
  `app.drivers.ts`; per-row `fullPage`; `net::ERR_ABORTED` is not a failed request; stale screenshot folders are pruned;
  the atlas emulates `prefers-color-scheme`, honours `UI_ATLAS_THEMES`; Chromium partial raster disabled.
- **Adopt by hand:** `launchOptions: { args: ['--disable-partial-raster'] }` and a `UI_APP_PORT` env in your app
  `playwright.config.ts`; a full-height wrapper in `.storybook/preview.tsx`; your own web fonts in `preview-head.html`.

## 0.1.0

First extraction from `shared/ui`.
