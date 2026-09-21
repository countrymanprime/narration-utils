# 0083. The public docs site is built by MkDocs with the Material theme straight from docs/, and a reviewed include list decides what is published

**Status:** Accepted
**Date:** 2026-09-21

## Context

The repository has no published documentation: readers use GitHub's file view, the wiki is disabled on purpose because an unreviewed copy drifts ([github-workflow](../operations/github-workflow.md)), and there is no link check anywhere. The [release-readiness PRD](../prds/release-readiness-provisioning-and-docs-site.prd.md) (phases 10 and 11) asked for a public site generated from `docs/` on every build, never a hand-kept copy, and the owner decided two things: compare VitePress and MkDocs Material on the real tree before choosing (question 8), and publish a curated include list, with `docs/research/` staying out until reviewed (question 9).

The [spike](../research/docs-site-generator-spike.md) built the real tree (187 Markdown files, 1,265 links, 26 of which need an answer: 5 dead, 3 to folders, 18 that leave `docs/`) with both tools outside the repository. The findings that decide it:

- The docs are GitHub-flavoured Markdown, read by GitHub and by `apps/ui/src/docsGuide.test.ts` with GitHub's rules. VitePress compiles Markdown as a Vue template and failed on 9 files (a bare `<title>` in an ADR, `{{` in a PRD); MkDocs built all of them unchanged.
- Every index in the tree is a `README.md`. MkDocs serves it as the folder index; VitePress does not, and the rewrite that makes it do so leaves the links to those files dead (48 dead references) without its checker noticing. Its heading slugs differ from GitHub's, which broke one working anchor.
- MkDocs' `--strict` build reported exactly the 26 links (and checks anchors); VitePress' checker missed the 6 links to `.json`/`.yml` files and does not check anchors.
- MkDocs generates the navigation from the folders; VitePress needs code for it.
- 29 wheels with no install script (MkDocs 1.6.1, Material 9.7.7) against 126 npm packages with one (VitePress 1.6.4, on Vite 5 and the `esbuild` the OSV baseline already reports).
- Neither tool can gate a link from a published page to a page the include list leaves out: VitePress reports it, MkDocs logs it at a fixed `INFO` level. MkDocs Material is in a maintenance line (MkDocs 2.0 will not run it), the reason the versions are pinned exactly.

## Decision

1. **The generator is MkDocs 1.6.1 with Material 9.7.7**, pinned exactly in a `docs` dependency group of the root `pyproject.toml` and locked with hashes in `uv.lock`. The group is one of the `default-groups`, so `uv sync` (and therefore `pnpm check`) can build the site; the Lua job and the docs job install only their own group (`--only-group`), and `pytest` and `ruff` sit in the docs group so that job needs nothing else. It is a build tool: nothing of it is in the desktop app or its sidecars. `mkdocs<2` is a hard constraint (Material's own).
2. **The site is generated from `docs/` and nothing is copied by hand.** The build reads `docs/` (`docs_dir`); a check fails when the site's source is anything else. Generated pages (the component atlas under `docs/ui/atlas/`) are produced into `docs/` by their own tool and read from there like any other page.
3. **What is published is one reviewed manifest, not a folder rule.** `tools/docs-site/include.txt` lists the paths and globs that are published; everything else (today `docs/prds/`, `docs/research/`, `docs/operations/`, `docs/workflows/`) is left out. Adding a page to the public site is a reviewed change to that file. `docs/research/` stays out until it is reviewed page by page.
4. **A link never silently dies.** `tools/docs-site/hooks.py` rewrites a link that leaves `docs/`, or that points at a page the manifest leaves out, to the GitHub file view of that path at the ref being built (a repository-relative link is not left to 404 on the site). Whatever is still unresolved after that fails `mkdocs build --strict`, and a second check reads the built HTML and fails on any internal `href`, `src` or `#fragment` that does not resolve. `nx run docs-site:build` runs both: `pnpm check`, the `quality / docs-site` job of `_quality.yml` (code pull requests) and the `Pages` workflow's build job (also a pull request that changes `docs/`, because `ci.yml` skips documentation-only pull requests) gate on it, and the same build is what Pages publishes.
5. **The site is deployed beside Storybook.** The Pages artifact holds the docs at the root and the Storybook atlas of phase 9 under `/storybook/`; the atlas pages in `docs/ui/atlas/` link to it. Pages is still enabled by the owner ([owner settings](../operations/github-workflow.md#repository-settings-that-only-the-owner-can-change)).

## Consequences

- One change to `docs/` is one change to the site: nothing to keep in step, and a docs pull request that breaks a link fails a job for the first time.
- Every published page must keep being valid GitHub Markdown; MkDocs does not reward writing for the generator, so the docs stay readable in the file view.
- The include list is a reviewed file, so a new ADR or guide page that should be public needs one added line. A page not listed is not public, which is the safe default for material such as `docs/research/`.
- A Python dependency group is added to the repository; Dependabot's `uv` entry (3-day cooldown) proposes its updates and OSV reads `uv.lock`. The two exact pins are the only direct dependencies; Material's 27 transitive dependencies are locked with hashes but not pinned by us, and `mergedeep`'s licence field is empty in its metadata (not looked up further).
- **Accepted risk: the MkDocs line is in maintenance.** MkDocs 1.6.1 is from 2024 and MkDocs 2.0 is incompatible with Material. If the pinned versions stop being fixable, the migration path is Zensical (announced as a drop-in for MkDocs 1.x) or VitePress; the manifest and the output check do not depend on MkDocs and the link-rewrite hook is a small script against its API, so the choice is reversible by a new ADR. Superseding this decision needs the spike's numbers re-run on the tree at that time.
- Material prints a warning banner about MkDocs 2.0 on every build; the site job sets `NO_MKDOCS_2_WARNING=true` so the log stays readable.
