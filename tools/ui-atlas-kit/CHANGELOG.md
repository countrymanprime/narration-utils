# Changelog

`ui-atlas sync` refreshes the vendored core files (`plugin/templates/core`) and stamps the version. It does NOT touch
scaffold files (yours after `init`), so the **Adopt by hand** lines below are what to copy across on upgrade.

## 0.3.1

- **Core:** the atlas ignores fixed layers when sizing a tall story to its content and ignores off-canvas fixed layers
  when cropping (a closed slide-over parked below the fold used to make every screenshot two thirds blank); a `fullPage`
  capture taller than 6000px now fails instead of being silently cut off; the atlas config comment no longer says `pnpm`.
- **Core:** stale atlas screenshot folders are pruned (new vendored file `tests/atlas/global-setup.ts`, registered in `playwright.atlas.config.ts`); a story reports all its problems at once (`expect.soft`); axe `incomplete` results are attached as `axe-incomplete` annotations.
- **CLI:** `sync --dry-run` writes nothing; `docs` names pages by title when two titles share a component file (stable
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
