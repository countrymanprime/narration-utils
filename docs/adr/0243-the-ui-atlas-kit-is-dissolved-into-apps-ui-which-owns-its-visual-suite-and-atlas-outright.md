# 0243. The UI atlas kit is dissolved into apps/ui, which owns its visual suite and atlas outright

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** the owner
- **Related:** Amends [ADR-0023](0023-visual-suite-capture-contract-and-storybook.md), point 3: "The reusable parts move to a shared kit"

## Context and problem

ADR 0023 moved the reusable half of the visual suite and the Storybook atlas into `tools/ui-atlas-kit`: a Claude Code
plugin (skills, agents, commands, hooks), a dependency-free CLI (`init`, `audit`, `docs`, `sync`) and templates, kept in
this repository with `apps/ui` as the upstream of its vendored files. Six other repositories of the owner copied those
files at kit 0.3.x.

In this repository the kit cost more than it gave. Nine files under `apps/ui` carried "vendored: do not edit here"
headers whose direction was the reverse of the real one (`apps/ui` was the upstream and `scripts/refresh-core.mjs` copied
it into the kit), so every change to the capture contract was a two-place edit, a kit version bump and a drift test
(ADR 0060 and 0105 both paid it). Knip had to exempt the vendored exports as "the kit's API". The plugin was not enabled
here (`.claude/settings.json`), so its skills, agents and hooks did nothing for this repository. The kit had its own CI
job. Of the CLI, `apps/ui` used one command: `docs`, which writes `docs/ui/`.

The owner chose to dissolve it rather than keep it or move it to its own repository (2026-09-25), knowing the other
repositories lose the tool that refreshed their copies.

## Decision drivers

- Every change to the capture contract was a two-place edit, a kit version bump and a drift test, under "vendored" headers that pointed the wrong way.
- Knip had to exempt the vendored exports.
- The plugin was not enabled here, so its skills, agents and hooks did nothing for this repository.
- The kit had its own CI job, and `apps/ui` used one CLI command, `docs`.

## Considered options

1. Dissolve the kit into `apps/ui`
2. Keep the kit
3. Move the kit to its own repository

## Decision outcome

**Chosen option: dissolve the kit into `apps/ui`**, because in this repository the kit cost more than it gave.

`apps/ui` owns its visual suite and component atlas outright; there is no kit and no vendored file.

- `tools/ui-atlas-kit` is deleted: the plugin, the CLI, the templates, `refresh-core.mjs`, the drift and audit tests, the
  rollout ledger and `apps/ui/ui-atlas.config.json`.
- The `docs` command is kept as `apps/ui/scripts/atlas-docs.mjs` (`pnpm --dir apps/ui docs:atlas`), with its tests as
  `apps/ui/scripts/atlas-docs.test.mjs` (the `test-node` target of `narration-utils-ui`, run by the `js` CI job).
- The files under `apps/ui/tests/visual` and `tests/atlas` and `playwright.atlas.config.ts` lose their vendored headers
  and are edited in place like any other test code. Knip reports their exports like any other file.
- "Every primitive has a story" stays enforced by `apps/ui/src/atlasCoverage.test.ts`, as before; the kit's scored
  `audit` goes.

### Consequences

- **Good:** A change to the capture contract is one edit in `apps/ui`, reviewed and tested there. The sharded visual suite
  (ADR 0244) was written this way.
- **Good:** One CI job fewer, and the `area:ui` label, Knip, Prettier and the layout guard no longer carry kit entries.
- **Bad:** The six other repositories keep working on their copies of kit 0.3.x, but nothing refreshes them. The kit's last
  state is in this repository's history (`git log -- tools/ui-atlas-kit`); `git subtree split` on a commit before its
  removal recreates it, if it is ever wanted as its own repository.
- **Neutral:** The ADRs that describe kit steps (0023 point 3, 0060's "It is a kit change", 0105's vendoring note) are history: the
  checks they record stay, in `apps/ui`.

### Confirmation

"Every primitive has a story" stays enforced by `apps/ui/src/atlasCoverage.test.ts`, and the `docs` script is tested by `apps/ui/scripts/atlas-docs.test.mjs`.

## Pros and cons of the options

### Dissolve the kit into `apps/ui`

- Good, because a change to the capture contract is one edit in `apps/ui`, reviewed and tested there.
- Bad, because the other repositories lose the tool that refreshed their copies.

### Keep the kit

- Bad, because every change to the capture contract was a two-place edit, a kit version bump and a drift test.
- Bad, because its plugin was not enabled here, so its skills, agents and hooks did nothing for this repository.
