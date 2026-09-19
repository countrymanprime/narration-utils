# Rollout ledger

One row per React UI repository, updated by the `ui-atlas-rollout` agent. Tier meanings are in [design.md](design.md).

| Repository | Stack | Tier | Status | Notes |
| --- | --- | --- | --- | --- |
| narration-utils (`shared/ui`) | React 19, Vite 8, Tailwind 4, pnpm | 2 | done | The upstream of the kit; audit score in `docs/ui/`. |
| shelby-theatres | React 18, MUI + Tailwind 3, Vite 5, vitest, Playwright | - | pending | |
| sandbox-childcare-center | React 18, Tailwind 3, Vite 5, vitest 4, Playwright | - | pending | |
| sensational-styles | React 19, Tailwind 3, Vite 6, no tests | - | pending | |
| dev-site | React 19, Tailwind 4, Vite 7, no tests | - | pending | |
| fortune-and-son | React 18, Tailwind 4, Vite 7, no tests | - | pending | |
| coshocton-coffee-connection | React 18, Tailwind 3, Vite 4 | 0 | pending | Vite 4 blocks Storybook 10; tier 0 unless Vite is upgraded. |
| expectantly | .NET | - | out of scope | No React UI package found. |
