# Rollout ledger

One row per React UI repository. Tier meanings are in [design.md](design.md). Each PR vendors the kit's core files
(`ui-atlas sync` refreshes them); all were upgraded from kit 0.1.0 to 0.2.0 after the first round of feedback, and the
kit is now 0.3.0 (see "Not yet synced").

| Repository | Stack | Tier | PR | Coverage | Escape hatches | Audit |
| --- | --- | --- | --- | --- | --- | --- |
| narration-utils (`shared/ui`) | React 19, Vite 8, Tailwind 4, pnpm | 2 | [#28](https://github.com/countrymanprime/narration-utils/pull/28) | 14 primitives, 119 stories, 71 app states x 4 viewports | 4 a11y debt (palette tokens), 10 sameAs | 95 |
| shelby-theatres | React 18, Tailwind 3, Vite 5, npm | 2 | [#7](https://github.com/countrymanprime/shelby-theatres/pull/7) | 4 components, 23 stories, 9 app states | 1 debt, 1 sameAs | 100 |
| sandbox-childcare-center | React 18, Tailwind 3, Vite 5, npm | 2 | [#18](https://github.com/countrymanprime/sandbox-childcare-center/pull/18) | 10 components (3 exempt), 44 stories, 20 app states x 5 viewports | 5 debt (brand contrast), 1 sameAs | 87 (audit undercounts exemptions; fixed in 0.3.0) |
| sensational-styles | React 19, Tailwind 3, Vite 6, npm | 1 | [#8](https://github.com/countrymanprime/sensational-styles/pull/8) | 7 components (extracted from a 400-line `App.tsx`), 32 stories, 8 app states | 0 debt, 1 sameAs | 100 |
| dev-site | React 19, Tailwind 4, Vite 7, npm | 1 | [#17](https://github.com/countrymanprime/dev-site/pull/17) | 7 components (2 exempt), 43 stories, 15 app states | 1 debt, 1 sameAs | 100 |
| fortune-and-son | React 18, Tailwind 4, Vite 7, npm | 1 | [#22](https://github.com/countrymanprime/fortune-and-son/pull/22) | 6 components with stories (3 exempt), 5 app states | 2 debt | 100 |
| coshocton-coffee-connection | React 18, Tailwind 3, Vite 4, npm | 0 | [#2](https://github.com/countrymanprime/coshocton-coffee-connection/pull/2) | 10 app states x 4 viewports (Vite 4 blocks Storybook 10) | none | 100 (tier 0) |
| expectantly | .NET | - | out of scope | No React UI package found. | | |

## Behaviour changes to review in the rollout PRs

The kit's job is to surface defects, and some PRs include the small fixes it found. These are product changes, easy to
revert on their own:

- **sandbox-childcare-center:** `tailwind.config.js` scanned `./app/**` instead of `./src/**`, so many utilities were
  missing from production CSS (its own commit). Two other real defects are documented, not fixed (form submit throws;
  "Schedule a Tour" links to a missing anchor).
- **coshocton-coffee-connection:** a malformed Google Fonts URL (HTTP 400) meant no web font ever loaded (its own commit).
- **sensational-styles:** seven components extracted from `App.tsx` so there is a library to test; the rendered DOM is
  unchanged; one contrast fix (`bg-gray-500` to `bg-gray-600`).
- **dev-site:** contrast fixes, an `inert` on the collapsed mobile menu, two dark-mode label fixes.
- **shelby-theatres:** `text-teal-600` to `text-teal-700` for contrast; dark-theme close buttons.
- **shelby-theatres:** `origin/main` has no Vitest/Playwright/tests; those and `MovieDetailOverlay` exist only as
  uncommitted work in the local checkout, so the PR added the tooling itself. The overlay will need catalog rows and a
  story when it lands.

## Not yet synced

Kit 0.3.0 (grow-the-viewport full-page capture, atlas broken-image check, `UI_REUSE_SERVER` opt-in, docs that group by
title and prune what they no longer generate, `sync` stamping the kit version) is in `narration-utils` only. Each other
repository adopts it with `ui-atlas sync --dir <ui-root>` and one re-run of its suites.
