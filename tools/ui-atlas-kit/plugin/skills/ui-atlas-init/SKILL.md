---
name: ui-atlas-init
description: Use when a repo has a React UI and no visual gate yet, or the user asks to set up the UI atlas, visual tests, Storybook or docs/ui in a repo.
---

# ui-atlas-init

## Why this exists

A copied template runs but proves nothing until the two repo-specific seams are wired: the theme/provider decorator
that Storybook renders every story under, and the mock-data seam the app states boot from. Skipping them gives a
green run over an unstyled UI or a real backend, and a tier chosen without checking the toolchain fails later on a
peer dependency (the reference repo skipped `@storybook/addon-vitest` because it needs Vitest 3+ and the repo was on 2).

## When to use this

- The repo has React components and no `tests/visual/` or `.storybook/`.
- The user asks to "set up the atlas", "add visual tests" or "add Storybook" to a repo.
- Not when `ui-atlas.config.json` already exists: use `ui-story-authoring`, `ui-state-catalog` or `/ui-atlas:sync`.

## What to do

1. Find `<ui-root>`, the directory holding the UI `package.json` and `src/components` (ask if there are several
   candidates), and read its stack: package manager (lockfile), React, Vite, TypeScript, Vitest or Jest, Playwright.
2. Pick a tier with the user (`tools/ui-atlas-kit/docs/design.md`):
   - Tier 0: app page-state capture (`tests/visual/`). Needs Playwright and an app mode that runs on mock data.
   - Tier 1: tier 0 plus the Storybook atlas (`.storybook/`, `*.stories.tsx`, `tests/atlas/`, `src/atlasCoverage.test.ts`).
   - Tier 2: tier 1 plus `docs/ui/`, coverage ratchets, CI jobs (`.ui-atlas/ci-jobs.yml`) and hooks.
3. Check what blocks the tier. `init` reports a blocker for no React, no Vite, Vite below 5 (Storybook 10 peer range is
   Vite 5 to 8) and no TypeScript (the templates are `.ts`/`.tsx`); any blocker means tier 0 unless the user upgrades.
   A webpack, Next or CRA app is in that group. Tier 1 also needs `storybook`, `@storybook/react-vite` and
   `@storybook/addon-a11y` on one pinned major. `@storybook/addon-vitest` needs Vitest >= 3: on Vitest < 3 or Jest keep
   `composeStories` (`src/stories.test.tsx`, what the reference does) and do not install the addon.
4. Preview, then write, passing what only the repo knows:
   `node "${CLAUDE_PLUGIN_ROOT}/cli/ui-atlas.mjs" init --dir <ui-root> --tier <n> --dev-command "<pm> run dev:mock" --dry-run`
   Drop `--dry-run` once the user agrees. Other flags: `--base-url`, `--theme-attr` (default `data-theme`),
   `--primitives-dir` (default `components/primitives`). The default `--dev-command` is the plain dev server, which
   is the wrong answer for a repo whose app needs a backend. It never overwrites a file; each skipped path (typically an
   existing `.storybook/` or `playwright.config.ts`) needs a manual merge. Read its notes: packages to install (not
   run), scripts added (`screenshots`, and at tier 1 `storybook`, `build-storybook`, `atlas`), `.gitignore` lines, and the
   reminder to exclude `tests/visual/**` and `tests/atlas/**` from the unit runner.
5. Adapt the two things a template cannot know:
   - `<ui-root>/.storybook/preview.tsx` (marked TODO): import the app's global stylesheet, apply the theme
     synchronously in the `withTheme` decorator from `context.globals.theme` (in render, not an effect, so the first
     paint carries the palette), and wrap stories in the providers components need (tooltip, router, i18n, store).
     Keep `a11y: { test: 'error' }` so an axe violation fails the story.
   - The mock seam: the app must run with no backend under `webServer.command` in `playwright.config.ts`. The reference
     uses a build mode (`vite --mode mock`, `VITE_USE_MOCK_API=1`) plus URL params read at startup (`?mockNoProject=1`)
     that boot alternate data. Find the repo's equivalent (API client, MSW, fixtures) and name it for `ui-state-catalog`.
     Also check the fonts in `.storybook/preview-head.html` match the app.
6. Do not edit the vendored files (the ones headed `ui-atlas-kit ... vendored`: `tests/visual/app.spec.ts`,
   `lib/`, `helpers/`, `tests/atlas/atlas.spec.ts`, `playwright.atlas.config.ts`). Repo-owned files are the catalog,
   drivers, viewports, `a11y-debt.ts`, `.storybook/`, and the three `src/*.test.ts(x)` files.
7. Verify with the repo's own commands: its unit test command (runs `visualSuite.test.ts`, `atlasCoverage.test.ts`,
   `stories.test.tsx`), `npx playwright test tests/visual` for tier 0, `<pm> run atlas` for tier 1 (builds Storybook,
   then `playwright.atlas.config.ts`). A primitive without a story failing is expected: hand off to
   `ui-component-inventory` and `ui-story-authoring`; catalog rows go to `ui-state-catalog`. Then run
   `node "${CLAUDE_PLUGIN_ROOT}/cli/ui-atlas.mjs" audit --dir <ui-root>` for the baseline score.
8. Record the tier: `init` writes `ui-atlas.config.json` (`kit`, `tier`, `stack`, `vars`) only if absent. Confirm the
   `tier` is the one chosen; `sync` uses it to decide which vendored files apply. Note the tier and the two
   adaptations in the repo's testing docs.

## What this skill is not

It does not write stories (`ui-story-authoring`), state rows or drivers (`ui-state-catalog`), classify components
(`ui-component-inventory`), or merge the CI jobs (`ui-atlas-ci`). It does not generate baseline images: the kit
captures, validates and documents, it does not pixel-diff (see `ui-capture-contract`).
