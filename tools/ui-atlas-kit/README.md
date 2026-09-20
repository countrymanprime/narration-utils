# ui-atlas kit

Test and self-document a React UI through a validated visual capture contract and a Storybook component atlas.
Extracted from the working implementation in [`apps/ui`](../../apps/ui) of this repository; that directory is
the upstream of the kit's vendored files, and `test/dogfood.test.mjs` fails if the two drift apart.

Read [docs/design.md](docs/design.md) for the design (tiers, folder structure, capture contract, rubric) and
[docs/rollout-ledger.md](docs/rollout-ledger.md) for which repositories use it.

## What is in the box

| Path | What |
| --- | --- |
| `plugin/` | One Claude Code plugin, `ui-atlas`: 9 skills, 5 agents, 4 commands, 2 hooks. |
| `plugin/cli/ui-atlas.mjs` | Dependency-free CLI: `init`, `audit`, `docs`, `sync`. |
| `plugin/templates/` | `core/` (vendored, refreshed by `sync`), `scaffold/` (copied once, then yours), `ci/`, a CLAUDE.md snippet. |
| `test/` | `node:test` suites for the CLI, the hooks, and the dogfood drift check. |
| `scripts/refresh-core.mjs` | Copies `apps/ui`'s vendored files into `plugin/templates/core` after you change them. |

## Use it

Install the plugin from this directory (a local marketplace), or point Claude Code at it for one session:

```bash
claude plugin marketplace add ./tools/ui-atlas-kit
claude plugin install ui-atlas@ui-atlas-kit
# or, for one session:
claude --plugin-dir ./tools/ui-atlas-kit/plugin
```

Then, inside a React repo:

```bash
node <plugin>/cli/ui-atlas.mjs init --dir <ui-root> --dry-run   # detect the stack and show what would be written
node <plugin>/cli/ui-atlas.mjs init --dir <ui-root>
node <plugin>/cli/ui-atlas.mjs audit --dir <ui-root>             # 0-100 scorecard and a gap list
node <plugin>/cli/ui-atlas.mjs docs --dir <ui-root>              # docs/ui/atlas/*.md + inventory.json + images
node <plugin>/cli/ui-atlas.mjs sync --dir <ui-root> --check      # drift in the vendored files
```

or use `/ui-atlas:init`, `/ui-atlas:audit`, `/ui-atlas:sync`, `/ui-atlas:review`.

## Tests

```bash
node --test tools/ui-atlas-kit/test/*.test.mjs
```

## Moving it to its own repository

Everything the kit needs is under this directory (plus `apps/ui` as the dogfood upstream). To extract it:
`git subtree split --prefix tools/ui-atlas-kit -b ui-atlas-kit`, push that branch to a new repository, and change
`test/dogfood.test.mjs` to point at a checkout of this repo (or drop it there). It lives here for now so it can be
reviewed and versioned together with the implementation it was extracted from.
