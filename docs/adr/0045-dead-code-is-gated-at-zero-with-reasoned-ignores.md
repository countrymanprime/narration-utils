# 0045. Dead code is gated at zero, and every ignore says why

- **Status:** Accepted
- **Date:** 2026-09-20
- **Deciders:** the owner

## Context and problem

Finding dead code was a manual step: `feature-cleanup` told an agent to grep for references, and neither `tsc` (`noUnusedLocals` is off) nor ESLint (`no-unused-vars` is a warning) sees an unused export, file or dependency. Knip (6.37) reported 130 findings on the first run with no configuration. After triage, 121 were false positives from a handful of classes and 9 were real: two dead files, six exports and a type that nothing else imports. Turning on entry-file exports found eight more in the scripts and the atlas kit. The owner adopted the PRD's recommendation (implementation plan D22, question 6): report, then one cleanup pull request, then gate at zero.

## Decision drivers

- Neither `tsc` nor ESLint sees an unused export, file or dependency, so finding dead code was a manual grep step.
- Knip's first run with no configuration gave 130 findings, 121 of them false positives from a handful of classes.

## Considered options

1. Knip as a gate at zero findings, with a reason on every ignore (report, then one cleanup pull request, then gate at zero)
2. Keep the status quo: a manual grep step in `feature-cleanup`
3. A baseline, or report-only
4. Knip's `--production` mode

## Decision outcome

**Chosen option: Knip as a gate at zero findings, with a reason on every ignore**, because nothing else in the toolchain sees an unused export, file or dependency, and the owner adopted the PRD's report, cleanup, then gate-at-zero path.

Knip is a gate. `nx run narration-utils:knip` (also `pnpm knip`) runs in `pnpm check` (`scripts/quality.mjs`) and in the CI `js` job on every pull request, and the repository is at zero findings.

- Configuration lives in `knip.jsonc`. Every `ignore`, `ignoreIssues`, `ignoreDependencies` and `ignoreBinaries` entry has a comment giving its reason: generated code (`apps/ui/wailsjs`), files another repository receives by copy (`tools/ui-atlas-kit/plugin/templates`), external tools, byte-identical vendored files, wire-contract types, and `@nx/js`, which `nx release` loads.
- `includeEntryExports` is on, so an export of a script or kit entry file is reported once nothing imports it.
- A finding is fixed by deleting the code or dropping the `export`. An ignore is added only for a class Knip cannot see through, never to quiet one finding, and a new dependency it cannot see through (a schema library, `@base-ui/react`) is checked when it is added.
- Default mode is used, not `--production`, which also flags exports that only tests use and the Vite plugin the config loads.

### Consequences

- **Good:** Dead files, exports and dependencies fail the build with a file and line, and `feature-cleanup`'s dead-code step becomes confirmation.
- **Neutral:** Knip reads JavaScript and TypeScript only. Go, Python, Lua and docs still rely on the linters and on `feature-cleanup`'s grep.
- **Neutral:** Knip treats test files as users, so an export that only a test imports is not reported in default mode. That is deliberate but leaves some exports that exist for tests.
- **Bad:** A new package that Knip's plugins do not understand can produce a wave of false positives; the fix is a documented ignore or a plugin option, not turning the gate off.
- **Neutral:** To relax this (a baseline, report-only), write a new ADR that supersedes this one.

### Confirmation

`nx run narration-utils:knip` (also `pnpm knip`) runs in `pnpm check` (`scripts/quality.mjs`) and in the CI `js` job on every pull request.

## Pros and cons of the options

### Knip's `--production` mode

- Bad, because it also flags exports that only tests use and the Vite plugin the config loads.
