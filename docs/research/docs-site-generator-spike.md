# Docs-site generator spike: VitePress or MkDocs Material

**Date:** 2026-09-21. **Stack:** S16, release-readiness phase 10. **Answers:** owner decision Q8 of the [release-readiness PRD](../prds/release-readiness-provisioning-and-docs-site.prd.md): compare VitePress and MkDocs Material on the repository's real cross-folder links, then decide. The decision is [ADR 0083](../adr/0083-the-public-docs-site-is-built-by-mkdocs-with-the-material-theme-straight-from-docs-and-a-reviewed-include-list.md).

**Verdict: MkDocs (1.6.1) with the Material theme (9.7.7).** It reads this tree as GitHub-flavoured Markdown without changes, treats `README.md` as the folder index, reports every one of the 26 links that need attention (no false negatives, no false positives), and has automatic navigation from the folders. VitePress needed a rewrite workaround for `README.md`, a slug override, a navigation generator, and it fails to compile 9 of the 187 files because it treats prose as a Vue template. Both tools built the tree in under 7 seconds. Neither tool can fail the build for a link to a page the include list leaves out (VitePress can, MkDocs only logs it), so the include list needs link rewriting whichever tool is used; that is phase 11's job.

## What was measured, and how

Everything ran in scratch directories outside the repository (`pnpm install --ignore-workspace` for VitePress, `uv venv` and `uv pip install` for MkDocs); nothing was added to the repository's `package.json`, `pnpm-lock.yaml`, `pyproject.toml` or `uv.lock`. Windows 11, Node 22.18, pnpm 11.27, uv, Python 3.12. The tree is `docs/` at the phase 9 tip: **187 Markdown files, 260 files, 4.9 MB, 84 ADR files**.

**Ground truth.** A throwaway Node script read every Markdown link and image outside code fences and classified it (its rules: a link is external if it has a scheme; otherwise it resolves against the file's folder; an anchor is checked against GitHub's heading slug, which is also what `apps/ui/src/docsGuide.test.ts` uses):

| Class | Count |
| --- | --- |
| Links and images in total | 1,265 (189 external, 14 anchor-only) |
| Relative links to a page or file inside `docs/` | 1,041 (72 of the images) |
| Relative links to a **folder** inside `docs/` (`utilities/`, `../research/`) | 3 |
| Relative links that **leave `docs/`** (`../../apps/...`, `../../SECURITY.md`, `../../CLAUDE.md`, `../config/roadmap.json`, `../../.github/...`) | 18: 7 to `.md` files, 2 to folders, 9 to other files (`.json`, `.yml`, `.lua`, `.py`) |
| Links to a file that does not exist | **5** (PRDs that other stacks deleted: `release-artifact-naming`, `ui-primitives-and-headless-library` twice, `dialog-modality-and-workdialog-a11y`, `verification-and-code-health-tooling`) |
| Anchors with no matching heading | **0** |

So there are **26 links a site build has to have an answer for**: 5 dead, 3 to folders, 18 that leave `docs/`. The leaving links are the ones the PRD called out; none of them is a broken link on GitHub.

A second, tool-neutral check read the **built HTML** and confirmed that every relative `href` and `src` resolves to a file in the output folder and every `#fragment` to an `id` on that page. It found what the generators' own checkers missed (below).

## Results

| | VitePress 1.6.4 | MkDocs 1.6.1 + Material 9.7.7 |
| --- | --- | --- |
| Builds the tree unchanged | **No.** The Markdown is compiled as a Vue template: 9 of 187 files fail (ADR 0048 and 8 PRDs: a bare `<title>` or `<name>` in prose, `{{` in a PRD). `markdown.config: md => md.set({ html: false })` leaves 1 (`{{` in a PRD). A future ADR that writes `<tag>` in prose breaks the build unless that option is on. | Yes, no configuration for the content. Raw HTML in prose is passed through as HTML. |
| `README.md` as a folder index (the ADR, PRD and guide indexes are all `README.md`, and `docsGuide.test.ts` requires `guides/using-the-app/README.md`) | Not a rule: `README.md` is served as `/README`, so the site root and `/dir/` have no page. A `rewrites` map to `index.md` moves the page **but the links to `README.md` still emit `README.html`**: 48 dead references in the output (about 22 of them README links the built-in checker does not report). Rewriting only the root `README.md` gives 26 dead references, all in the ground-truth classes. Path-to-regexp rewrites cannot say "any depth", so a per-folder map has to be computed. | Native: `README.md` becomes the folder's `index.html` and links to it resolve. |
| Dead-link check that fails the build | `ignoreDeadLinks: false` (default) fails with exit 1: 22 reports with the `README.md` rewrites and one PRD excluded (7 are the missing files, of which 2 come from that exclusion; 3 folders; 12 leaving links). **Misses** the 6 leaving links to `.json`/`.yml` files (it only checks page-like links) and does not check anchors at all. | `mkdocs build --strict` with `validation.{absolute_links,unrecognized_links,anchors}: warn` fails with exit 1 on **26 warnings = exactly the 26 ground-truth links**; anchors are checked (0 found). |
| Anchors | Its heading slug is not GitHub's: `` ## REAPER events (`apps/desktop/internal/bridge/wire.go`) `` becomes `reaper-events-apps-desktop-internal-bridge-wire-go`, so the link `wire-contracts.md#reaper-events-appsdesktopinternalbridgewirego`, correct on GitHub and in `docsGuide.test.ts`, is dead on the site (1 link today). A `markdown.anchor.slugify` override fixes it; the checker does not notice. | The Python-Markdown slug matched GitHub's for every link in the tree (0 dead in the output). |
| Links that leave `docs/` | Left as relative links that resolve to nothing (`./../../SECURITY.html`); reported as dead (except non-page files). | Left as is with a warning; a hook can rewrite them. |
| Links to a page the include list leaves out | 67 reported when `prds/`, `research/`, `operations/` and `workflows/` are excluded (correct: the build fails). | **Not gated:** 61 `INFO` lines (the level is fixed, `omitted_files` does not change it) and 56 dead references in the output. |
| Navigation from the folders | None: no sidebar unless `themeConfig.sidebar` is generated by code (or a plugin). | Automatic: 208 entries in the home page's navigation, ADRs in numeric order, titles from each file's first heading; folder names are capitalised (`Adr`), so the top level needs a `nav:` or a title convention. |
| Images (`docs/images/ui`, 43 WebP files, 2.4 MB) | Bundled and content-hashed by Vite (`/assets/home-default.CmBybWwi.webp`); embeds in the guide worked. | Copied as they are (72 `.webp` in the output, every embed worked). |
| Curated include list | `srcExclude` (fast-glob ignore list; no negation), so an include list is written as exclusions. | `exclude_docs` (gitignore syntax) with negation works: `/*` then `!/guides/`, `!/adr/` and so on gave 147 pages in 2.8 s. **Pitfall:** `/*` also drops the theme's own `assets/`, so `!/assets/` is needed. |
| Build time (full tree, 187 pages) | 5.3 to 6.7 s (3.2 s for the curated set) | 4.5 to 6.6 s (2.8 s curated) |
| Output size | 14 MB, 626 files (187 HTML plus 375 per-page JS chunks) | 26 MB, 307 files (curated: 15 MB, 147 pages), with a search index |
| Base path for Pages (`/narration-utils/`) | `base: '/narration-utils/'` (absolute URLs in the output; the output check passed under that base) | `site_url` with the path; the output uses relative URLs and works under any sub-path |
| Search | Local (minisearch); Algolia optional | Local (lunr); no service |

## Licence and supply-chain footprint

| | VitePress 1.6.4 | MkDocs 1.6.1 + Material 9.7.7 |
| --- | --- | --- |
| Own licence | MIT | MkDocs BSD-2-Clause, Material MIT |
| Packages installed | 126 (npm), 94 MB in the virtual store | 29 (PyPI wheels), no build step |
| Licences of what was installed | 118 MIT, 2 ISC, 2 BSD-3-Clause, 1 BSD-2-Clause, 1 CC0-1.0 | MIT (12), BSD (BSD-2, BSD-3, "BSD License": 9), Apache-2.0 (4), dual Apache/BSD (1), MPL-2.0 (2), 1 with an empty licence field (`mergedeep`, not looked up further) |
| Install scripts | `esbuild@0.21.5` `node install.js` (`strictDepBuilds` would need it in `allowBuilds`; the repository already allows esbuild) | none |
| Known advisory | Pins Vite 5, hence `esbuild` 0.21.5, the version OSV already reports for the repository (GHSA-67mh-4wv8-2f99, dev server only) | none checked |
| AGPL-3.0 compatibility (the repository is AGPL-3.0-or-later) | All permissive | All permissive except MPL-2.0 (2 packages: MPL 2.0 section 3.3 allows combination with GPL/AGPL). The tools are build-time only and nothing they contain is shipped in the app. |
| Release cadence and maintenance | 1.6.4 is the last 1.x (2025-08-05); 2.0.0-alpha.20 (2026-09-04) is the active line and is an alpha | MkDocs 1.6.1 (2024-08-30) is the last MkDocs release; Material 9.7.7 (2026-07-17). Material pins `mkdocs<2` and states MkDocs 2.0 has no plugin system, a rewritten theme system and, when checked, no licence; the Material team's announcement of its successor (Zensical, described as a drop-in for MkDocs 1.x) is the migration path. Material prints a warning banner on every build (`NO_MKDOCS_2_WARNING=true` silences it). |

## Why MkDocs

1. **The docs are written for GitHub, not for Vue.** The tree is Markdown that GitHub renders and that tests (`docsGuide.test.ts`) read with GitHub's rules. MkDocs accepts it as it is; VitePress needs an option set to keep prose from being compiled and still fails on `{{`.
2. **It needs no code to be correct.** `README.md` indexes, GitHub-compatible anchors, automatic navigation and a checker that matches the ground truth exactly came from about a dozen lines of YAML. VitePress needed a computed rewrite map (and still emitted dead README links), a slug override and a sidebar generator.
3. **Footprint.** 29 wheels with no install script against 126 npm packages with one, and it lives in the uv environment the repository already locks and Dependabot already watches. A dedicated `docs` dependency group does not touch the desktop runtime.

What it costs, recorded in the ADR: the MkDocs/Material line is in maintenance with a successor announced, so the pins are exact and `mkdocs<2` is a hard constraint; a `hooks` script is still needed for links that leave `docs/` and for links to pages the include list omits, because MkDocs only logs the latter.

## What was not verified

- **A deploy.** Everything was built and browsed locally; Pages is not enabled ([phase 9](../operations/ci-and-releases.md#the-pages-workflow)).
- **The site as a reader sees it.** The spike compared link and build behaviour and read output HTML; theme appearance, dark mode and mobile were not judged. Phase 11 browses the real site.
- **Material's remaining maintenance window.** The announcement page fetched on 2026-09-21 gave no end date for critical fixes; a date remembered from an earlier announcement was not confirmed.
- **Zensical, Docusaurus, Starlight** were not built (the owner's question named two candidates).
- **`mergedeep`'s licence** (empty in its metadata) and the licences of transitive dependencies of later versions.
- **VitePress 2.0 alpha** was not tried: an alpha is not a base for a public site.
- **Windows only:** no Linux run, though both tools are pure-Node or pure-Python here.
- **VitePress with a custom link-rewrite plugin.** It was compared out of the box plus the smallest workaround for each defect, not with the plugin that would fix every one.

## Reproduce

```bash
# ground truth: 26 links to answer for, 0 dead anchors (script kept out of the repository; the rules are described above)
# MkDocs
uv venv .venv && uv pip install --python .venv/Scripts/python.exe mkdocs==1.6.1 mkdocs-material==9.7.7
cat > mkdocs.yml <<'EOF'
site_name: narration-utils
site_url: https://countrymanprime.github.io/narration-utils/
docs_dir: <path to the repository's docs>
theme: { name: material }
validation: { omitted_files: warn, absolute_links: warn, unrecognized_links: warn, anchors: warn }
EOF
.venv/Scripts/python.exe -m mkdocs build --strict     # exit 1, 26 warnings
# curated variant: add to mkdocs.yml
#   exclude_docs: |
#     /*
#     !/README.md
#     !/roadmap.md
#     !/guides/
#     !/ui/
#     !/images/
#     !/adr/
#     !/architecture/
#     !/design/
#     !/utilities/
#     !/assets/
# VitePress (copy docs/ into the project first: a docs folder outside it cannot resolve `vue`)
pnpm install --ignore-workspace          # package.json: { "devDependencies": { "vitepress": "1.6.4" } }
# .vitepress/config.mjs: base '/narration-utils/', srcDir 'docs', rewrites { 'README.md': 'index.md' },
#   markdown.config md => md.set({ html: false }), srcExclude for prds/audiobook-credits-templates.prd.md
npx vitepress build .                    # exit 1, 22 dead links (ignoreDeadLinks: true builds it)
```
