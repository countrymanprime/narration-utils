---
name: ui-atlas-docs-sync
description: Use after the atlas has been rebuilt and re-run to regenerate docs/ui/atlas/*.md, docs/ui/inventory.json and docs/ui/images/ so the component documentation matches the code, and to check for staleness.
---

# ui-atlas-docs-sync

## Why this exists

`docs/ui/` is the component library written down for people and agents: one page per component, a machine-readable
`inventory.json`, and screenshots. Screenshots under `<ui-root>/screenshots/` are gitignored scratch output, so
committed images are copies. If nothing refreshes them, the UI changes, every gate stays green, and the docs keep
showing last month's component. The `ui-atlas docs` command derives the docs from `storybook-static/index.json` and
`screenshots/atlas/`, which makes staleness detectable and fixable in one step instead of a matter of memory.

## When to use this

- After a change to a component, a story, a theme token, or `styles.css`, once the atlas has been re-run.
- After adding or removing a story or a component (the inventory changes even if no pixels do).
- When `ui-atlas audit` reports generated docs as stale, or a reviewer sees an image that no longer matches.

## What to do

1. Rebuild the atlas so its inputs are current. From the UI root (for example `apps/ui`):
   ```bash
   pnpm atlas
   ```
   This builds Storybook into `storybook-static/` and captures every story into `screenshots/atlas/`. A red atlas is
   fixed first (see `ui-atlas-gate`); docs generated from a broken run document a broken UI.
2. Regenerate the documentation:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/cli/ui-atlas.mjs" docs --dir <ui-root>
   ```
   `--dir` must be the UI root that holds `storybook-static/`; without `pnpm atlas` the command stops with an
   error. It writes `docs/ui/atlas/<Component>.md` (stories, consumers, recorded a11y debt), `docs/ui/atlas/index.md`,
   `docs/ui/inventory.json`, and one WebP per component (its first story, light theme, wide viewport) into
   `docs/ui/images/`. `docs/ui` lands at the repo root when the git root is two levels above the UI root (as in
   `apps/ui`), otherwise under `<ui-root>/docs/ui`. Without `sharp` installed, the pages are written but images
   are skipped.
3. Read the git diff of `docs/ui/`. A changed page should correspond to a component you touched. An image or page
   that changed for a component you did not touch means the capture is not deterministic (hand it to the
   `ui-flake-doctor` agent) or another change slipped in. A large jump in image size for one entry deserves a look.
4. Curate or regenerate:
   - Regenerate (default): everything under `docs/ui/atlas/`, `inventory.json` and its images is generated. Do not
     hand-edit these files; assume the next `docs` run overwrites them. Prose that should persist belongs in a
     guide outside `docs/ui/atlas/`.
   - Curate: hand-picked screenshots for a narrative guide (in this repo `tests/visual/doc-screenshots.json` plus
     `node scripts/sync-doc-screenshots.mjs`, which writes `docs/images/ui/*.webp` for the `docs/guides/using-the-app/` pages)
     are a separate, human-selected set. Keep them in their own manifest; refresh an entry only when its source
     `{page, state, viewport}` changed, and re-read the caption and the surrounding text.
5. If a component or state was removed, confirm its page and images are gone from `docs/ui/` and that no guide still
   links to them. Do not leave a broken image reference.
6. Check staleness without changing files:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/cli/ui-atlas.mjs" audit --dir <ui-root> --json
   ```
   Read the "generated docs fresh" part. It only compares `inventory.json` with the newest `.stories.tsx`, so it
   misses a component or style change that touched no story: regenerate after every UI change regardless of what the
   audit says, and treat a clean audit as a floor.
7. Commit the regenerated `docs/ui/` files in the same change as the UI edit, so a reader of the PR sees code and
   docs move together.

## What this skill is not

It does not run the visual suite or judge whether a screenshot is correct (`ui-visual-review`), and it does not add
stories (`ui-story-authoring`). It does not publish Storybook to a website (`ui-atlas-ci`). It does not fix the
component when the docs reveal a defect; record the defect and route it to a normal change.
