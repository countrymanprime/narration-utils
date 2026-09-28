# 0415. While Pages is paused, docs are checked by lychee and a changed-file markdownlint, not by building the site

**Status:** Accepted
**Date:** 2026-09-27

## Context

D75 paused `pages.yml`'s deploy job (no more publishing on a push to `main`), but left its `build` job running on
every pull request that touches `docs/`, `tools/docs-site/`, the Storybook config, `pyproject.toml`, `uv.lock` or the
workflow itself, as the docs link check for those pull requests (`ci.yml` skips documentation-only pull requests).
`_quality.yml`'s `quick-ubuntu` job separately ran the same MkDocs strict build and HTML link check
(`docs-site:build`) on every pull request that is not docs-only, and `pnpm check` ran it on every full local gate.

That is three places building the site to catch the same class of problem `Docs / Links (offline)`
(`.github/workflows/docs.yml`, lychee, `--offline`, anchor-only fragments) already catches on **every** pull request
with no path filter: a dead relative link or a dead `#fragment`. The MkDocs strict build catches slightly more (a page
missing from `mkdocs.yml`'s nav, or an `include.txt` line matching nothing), but that only matters once the site is
being published again, and building Storybook plus the demo plus a full MkDocs site on every non-docs pull request is
pure cost while nothing is served.

Markdown style (heading levels, list formatting, stray bare URLs) had no check at all: nothing caught it until a
person read the diff.

## Decision

While GitHub Pages stays paused (D75):

1. `pages.yml` drops its `pull_request` trigger entirely and keeps only `workflow_dispatch`. Its header comment
   carries the trigger block to restore (both `push: branches: [main]` and the `pull_request` path list) when Pages
   resumes.
2. The MkDocs strict build and its HTML link check (`tools/docs-site/project.json`'s site-build target, renamed from
   `build` to `build-site` so it falls outside `pnpm check`'s and `_quality.yml`'s default `lint format architecture
   knip test test-node build` target set) run only from `pages.yml`'s own manual build, which still needs the built
   site to add Storybook and the demo beside it. `_quality.yml`'s `docs-site` step and `pnpm check` keep the project's
   `lint` and `test` targets (ruff, and the unit tests of the include list, the link rewriting and the output link
   check against a tiny fixture tree).
3. Every pull request's Markdown is checked two ways instead: `Docs / Links (offline)` (unchanged: lychee, every
   Markdown file, every pull request) for dead links and anchors, and a new `Docs / Markdown lint (changed files)`
   job (`.github/workflows/docs.yml`, `scripts/ci/lint-markdown-changed.mjs` and `scripts/ci/changed-markdown.mjs`)
   for Markdown style, scoped to only the `.md` files the pull request adds or changes (a merge-base diff, so a
   rename lands on its new path and a deletion is left out) — not a full-repo baseline. It runs markdownlint-cli2
   against `.markdownlint-cli2.jsonc`'s starter rule set (the default rules minus line length and every rule that
   fired only on the repo's own deliberate style: template list formatting, angle-bracket placeholders, bold lead-in
   labels used as headings, footnote-style citation markers, and the ADR/PRD/generated-docs table styles) and fails
   the job on a violation, with a job summary pointing at `pnpm lint:md:fix`. `pnpm lint:md` runs the same check
   locally, and lint-staged runs `markdownlint-cli2 --fix` on staged `*.md` files so most of it is fixed before a
   commit exists.

## Consequences

- A non-docs pull request no longer builds Storybook, the demo or the MkDocs site at all; a docs-only pull request
  no longer does either (that path only ran through `pages.yml`, now `workflow_dispatch`-only). Both keep the same
  link coverage through lychee, plus new Markdown style coverage neither had before.
- `pnpm check` runs faster and no longer needs the `docs` `uv` group's site-build step; `tools/docs-site`'s own tests
  (fixture-tree MkDocs builds included) still run everywhere they did.
- The docs site itself is unverified between now and when Pages resumes, except by a manual `workflow_dispatch` run
  or the release-adjacent judgment of a person reading the diff. That is the accepted cost of D75: nothing is
  published in the meantime, so nothing regresses in front of a reader.
- Resuming Pages needs three changes, all reversible from a comment left where the change was made: restore
  `pages.yml`'s `pull_request` trigger (the header comment carries the path list), rename `docs-site`'s `build-site`
  target back to `build` and add it back to `pnpm check`'s target list and `_quality.yml`'s `docs-site` step. The
  Markdown lint job and its scripts stay either way: they check style, which matters whether or not the site is
  published.
- A future change that wants Markdown style checked across the whole repository, not just changed files, needs its
  own decision: today's starter rule set was tuned against the current tree's exceptions, not audited for a
  repo-wide sweep, and a wider rollout would need to work through the existing debt this ADR's rule choices were
  built to route around.
