---
name: ui-atlas-ci
description: Use when adding, changing or debugging the CI jobs that run the app visual suite and the component atlas, including path filters, Playwright setup, artifacts, container pinning, nightly runs and optional Storybook publishing.
---

# ui-atlas-ci

## Why this exists

A visual suite that runs only when someone remembers is decoration. ADR 0023 records that the suite had no CI job
and drifted until turning the checks on found real overflow and never-driven states. CI is what makes the capture
contract a gate. The reference implementation is `.github/workflows/_quality.yml` in this repo, called from
`ci.yml`; a consuming repo should reproduce the same shape rather than invent one.

## When to use this

- Wiring a repo to the atlas for the first time (tier 1 or 2), after `ui-atlas-init` created the scripts.
- A visual job is red, slow, or flaky in CI but green locally.
- Adding a nightly run, a flake check, or a published Storybook.

## What to do

1. Keep the fast job separate from the visual jobs. The fast job (`js` in the reference) runs
   `pnpm --dir <ui-root> run lint:ci`, `run format:check`, `test`, and `run build`. `test` (Vitest) already runs every
   story through `composeStories` (`src/stories.test.tsx`) and the coverage ratchets in `src/atlasCoverage.test.ts`
   and `src/visualSuite.test.ts`; "coverage" here means every primitive has a story or a reasoned exemption, not line
   coverage. It must not need a browser, so it stays quick and always runs.
2. Add one job per capture suite, mirroring the reference:
   - `ui-visual`: `pnpm --dir <ui-root> exec playwright install --with-deps chromium`, then
     `pnpm --dir <ui-root> run screenshots`. Reference timeout 20 minutes.
   - `ui-atlas`: the same install step, then `pnpm --dir <ui-root> run atlas` (which builds Storybook first).
     Reference timeout 15 minutes.
   Both use the repo's toolchain setup action, `retries: 0` from the Playwright config, and `workers: 4`. At tier 2,
   `ui-atlas init` writes ready-made copies of both jobs to `<ui-root>/.ui-atlas/ci-jobs.yml` (with a TODO for the
   repo's own install step); paste them under `jobs:` instead of retyping.
3. Upload the pictures even when the job fails, because a failing run is exactly when the PNGs are needed:
   `actions/upload-artifact` with `if: always()`, `path: <ui-root>/screenshots` (or `.../screenshots/atlas`),
   `if-no-files-found: ignore`, `retention-days: 7`.
4. Path filters. The reference workflow uses only a workflow-level `paths-ignore` (`docs/**`, `**/*.md`) on
   `pull_request`; it has no per-job filter. To skip the visual jobs on changes that cannot affect them, add a
   `changes` job (for example `dorny/paths-filter`) whose output gates `ui-visual` and `ui-atlas` on `<ui-root>/src/**`,
   `<ui-root>/tests/**`, `<ui-root>/.storybook/**`, the Playwright configs and `package.json`/lockfile. Never
   filter the fast job.
5. Pin the environment. `ubuntu-latest` plus `playwright install --with-deps` is acceptable while nothing compares
   stored pixels. If a repo adopts pixel baselines, run the visual jobs in `container:
   mcr.microsoft.com/playwright:v<version>-jammy` with `<version>` equal to the installed `@playwright/test`, and
   produce baselines only there (see `ui-visual-review`).
6. Nightly full run and flake check (not in the reference workflow; add it as a `schedule:` workflow). Run the
   visual suite twice in one job, copying `screenshots/app` to another folder between runs, then compare bytes:
   `diff -rq screenshots-run1 screenshots-run2`. Any difference is nondeterminism: fail the job and hand the pair
   to the `ui-flake-doctor` agent (the procedure is in `ui-capture-contract`). Do the same for `screenshots/atlas`.
7. Optional: publish Storybook. `pnpm --dir <ui-root> run build-storybook` yields `storybook-static/`, a static
   site. Cloudflare Pages: `npx wrangler pages deploy <ui-root>/storybook-static --project-name <name>` (needs a
   Cloudflare API token secret). GitHub Pages: `actions/upload-pages-artifact` with that path, then
   `actions/deploy-pages` (needs `pages: write` and `id-token: write`). Both are optional and require account
   secrets or settings the user must create; ask before adding them.
8. Verify the workflow with `actionlint` if available, and push a branch; a local read is not proof a job runs.

## What this skill is not

It does not decide what to test (`ui-state-catalog`, `ui-story-authoring`) or review the images
(`ui-visual-review`). It does not run the local gate (`ui-atlas-gate`). It does not commit or push on its own; a
workflow change goes through the normal review flow.
