# 0011. Documentation screenshots are curated from the Playwright visual suite, not captured separately

- Status: accepted
- Date: 2026-09-18

## Context

`docs/` had no images anywhere, and the app's screenshot output (`shared/ui/screenshots/`) is
gitignored scratch, so nothing durable existed to point user-facing documentation at. The request
was to add a screenshot-based user guide that stays accurate as the UI changes, without hand
capturing images separately (which drifts immediately) or building a pixel-diff CI gate (flaky
across machines/fonts, and inconsistent with this repo's existing manual-review approach to the
visual suite — no CI workflow runs Playwright today).

## Decision

`shared/ui/tests/visual/doc-screenshots.json` is a small curated manifest of `{page, state,
viewport, docName, caption}` entries, each required to match a row in the existing
`STATE_CATALOG` (enforced by `shared/ui/src/docScreenshots.test.ts`, part of `pnpm check`).
`shared/ui/scripts/sync-doc-screenshots.mjs` copies the matching screenshots out of the gitignored
`shared/ui/screenshots/` output, downsamples and compresses them to WebP (`sharp`, quality 80,
max width 1280), and writes them into the committed `docs/images/ui/`. The guide under
`docs/guides/using-the-app/` embeds those images. Two new skills own keeping this pipeline current: `visual-catalog-sync` (UI
change → `STATE_CATALOG`/`app.spec.ts` drivers stay accurate) and `doc-screenshot-sync` (visual
suite output → `docs/images/ui/` and the guide's prose stay accurate), both wired into
`full-verification-gate` and `feature-cleanup` respectively rather than a CLAUDE.md paragraph.

## Consequences

Doc screenshots can only show states that already exist in `STATE_CATALOG` with a working driver
— while building this, three existing catalog states (`manuscript/chapters-overlay-open`,
`manuscript/detail-sidebar-entity`, `manuscript/sticky-header-scrolled`) turned out to produce a
screenshot identical to the default view, so they were swapped for states confirmed to render
distinctly rather than fixed at the driver level (that's a separate, pre-existing visual-suite bug,
flagged out of scope). Sync is agent/developer-driven — nothing fails CI if a screenshot goes
stale after a UI change; the two skills are the enforcement, not a hard gate, so relying on them
being invoked is a real (accepted) gap compared to true automated staleness detection.

Update (2026-09-19): the guide was originally one file, `docs/guides/using-the-app.md`. It is now a
folder, `docs/guides/using-the-app/`, with an index (`README.md`) and one page per app page or large
feature, kept consistent by `shared/ui/src/docsGuide.test.ts`. The decision above is unchanged.
