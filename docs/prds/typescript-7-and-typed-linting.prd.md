# TypeScript 7 and Typed Linting

**Source:** Dependabot pull requests #94 and #98 (TypeScript 5.9.3 to 7.0.2), which failed CI on 2026-09-20, and the follow-up request to specify the fix. Research read on 2026-09-20 from the [TypeScript 7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/), typescript-eslint's `package.json` peer range and its tracking issue [typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940). Nothing here is built yet; until phase 1 lands, `.github/dependabot.yml` ignores TypeScript major versions.

## Problem Statement

`apps/ui` cannot move to TypeScript 7 (the native Go port). TypeScript 7.0 ships no JavaScript API, and two things in the UI toolchain need one: typescript-eslint (ESLint refuses to load and exits) and two guard tests that parse source with the compiler API. The repo is therefore stuck on TypeScript 5.9 and gets no faster type checking, and every weekly Dependabot run would reopen the same failing bump.

## Evidence

- **Lint dies on TS 7.** With `typescript@7.0.2`, `eslint .` in `apps/ui` prints "typescript-eslint does not support TS 7.0" and crashes. typescript-eslint 8.70.0 (`latest`) declares `"typescript": ">=4.8.4 <6.1.0"`.
- **Two tests use the compiler API.** `apps/ui/src/baseUiBoundary.test.ts` and `apps/ui/src/rawNatives.test.ts` do `import ts from 'typescript'` and call `createSourceFile`, `ScriptKind`, `ScriptTarget`, `isJsxOpeningElement`, `isStringLiteralLike` and similar. Under TS 7, `tsc --noEmit` reports errors in those files (`Property 'createSourceFile' does not exist`), which also failed the `ui-dist / build` job on #94.
- **That is the announced design, not a bug.** The announcement says 7.0 "does not ship with an API" and that "TypeScript 7.1 [is expected] to ship with a new (and different) API". For tools that need the compiler in the meantime, Microsoft published `@typescript/typescript6`, which re-exports the 6.0 API and installs a `tsc6` binary, and documents holding both: `"@typescript/native": "npm:typescript@^7.0.2"` next to `"typescript": "npm:@typescript/typescript6@^6.0.2"`.
- **typescript-eslint has no date.** The maintainers said on 2026-07-09 there is nothing they can do until a stable JS API exists. A maintainer wrote on 2026-09-11 that they are working on it, with no estimate. Its ESLint error message tracks TS 7.1 or later.
- **Where TypeScript is used.** `apps/ui/package.json:9` (`"build": "tsc --noEmit && vite build"`), `:55` (`"typescript": "^5.6.3"`), `:56` (`typescript-eslint`), and the two tests above. No other package in the workspace lists it.

## Proposed Solution

Move in three steps that each leave `pnpm check` green, and stop at the step the ecosystem supports:

1. **Put the JS API on TypeScript 6.0.** typescript-eslint and the two tests keep working, and TypeScript is on the line the bridge package tracks.
2. **Type-check with TypeScript 7, keep the API on 6.** Add `@typescript/native` for `tsc` (the `build` script's `tsc --noEmit`) and keep `typescript` as the 6.0 API package for ESLint and the tests. This is the "latest tooling" that works today.
3. **Retire the bridge** when TypeScript 7.1 ships its API and a typescript-eslint release supports it. Blocked on upstream; nothing to build until then.

## Key Hypothesis

We believe running type checks on TypeScript 7 while ESLint and the AST tests stay on the 6.0 API will give us the native compiler's speed without losing typed linting. We'll know we're right when `apps/ui` `build` and `lint:ci` both pass with `tsc` resolving to 7.x and `typescript-eslint` resolving TS 6.0, with Dependabot proposing TypeScript updates again.

## What We're NOT Building

- Replacing typescript-eslint or moving off typed lint rules. Which rules in the `apps/ui` ESLint config actually need type information is checked in phase 1 (Q2) but not changed here.
- Rewriting the two guard tests around a different parser in this PRD unless Q3 chooses it.
- Any use of TypeScript 7's experimental or unstable APIs.
- Upgrading `typescript-eslint` past what supports the 6.0 API.

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Lint and tests pass with the API on 6.0 | `eslint . --max-warnings 0` and both guard tests green | `pnpm check`, CI `quality / js` |
| Type check runs on TypeScript 7 | `tsc --version` in the `build` script reports 7.x | Read the script output in CI |
| `ui-dist / build` passes | Green | CI |
| Dependabot bumps TypeScript again without breaking CI | No permanent ignore left | `.github/dependabot.yml` has no `typescript` ignore after phase 1 |

## Open Questions

- [ ] **Q1. Alias or plain 6.0?** Options: (a) `"typescript": "^6.0.2"` (plain, typescript-eslint's peer range accepts it); (b) `"typescript": "npm:@typescript/typescript6@^6.0.2"`, which is what the announcement documents and what phase 2 needs so that `typescript` and `@typescript/native` can coexist. Recommendation: (a) for phase 1, switch to (b) in phase 2.
- [ ] **Q2. Does the repo use typed rules at all?** Even with only non-type-aware presets, typescript-eslint's parser needs the API. Check `parserOptions.projectService` and the preset in use in `apps/ui`'s ESLint config, and record the answer here. Recommendation: read the config at the start of phase 1.
- [ ] **Q3. The two AST guard tests.** Options: (a) leave them on the 6.0 API through the alias (recommended until 7.1); (b) move them to a parser with no TypeScript dependency (for example `oxc-parser`; verify it is available and handles TSX) so they never block a TypeScript bump. Recommendation: (a), and revisit when 7.1's API is stable.
- [ ] **Q4. Binary names with both installed.** `@typescript/typescript6` installs `tsc6`; TypeScript 7 installs `tsc`. Confirm under pnpm 11 that `@typescript/native` puts `tsc` on the `apps/ui` script path and that the alias does not shadow it, before phase 2 commits to this layout. Recommendation: prove it on a branch first.
- [ ] **Q5. Does TypeScript 6 or 7 change `tsconfig` behavior?** Check `apps/ui/tsconfig*.json` for options removed or deprecated in TypeScript 6 and 7 (`moduleResolution`, `baseUrl`, `paths`), and run `tsc --noEmit` on both in phases 1 and 2. Not yet verified.

## Users & Context

**Primary User**: the maintainer and Dependabot. Nothing user-visible changes.
**Current behavior**: TypeScript major bumps fail CI and sit open until closed; type checking runs on 5.9.
**Success state**: lint and tests keep working, `tsc` is native, and TypeScript updates flow through Dependabot.
**Job to Be Done**: When TypeScript ships a major version, I want the repo to adopt the compiler without losing lint, so upgrades are routine.

## Solution Detail

| Priority | Capability |
| --- | --- |
| Must | `typescript` resolves to the 6.0 API for typescript-eslint and the two tests |
| Must | Dependabot's TypeScript major ignore is removed once phase 1 lands (and re-scoped if a later major needs it) |
| Should | `tsc` in `apps/ui` resolves to TypeScript 7 (`@typescript/native`) |
| Could | Guard tests moved to a TypeScript-free parser (Q3b) |
| Won't | Dropping typed linting; using unstable 7.x APIs |

**User flow**: none. This is toolchain work.

## Technical Approach

**Feasibility**: HIGH for phases 1 and 2 (both use published packages named in the announcement); phase 3 is blocked upstream.

**Architecture notes**
- Phase 1 is a dependency change in `apps/ui/package.json` and `pnpm-lock.yaml`. TypeScript 6.0 removed some long-deprecated `tsconfig` options; `tsc --noEmit` and the two tests are the check.
- Phase 2 splits the two roles: `@typescript/native` provides the compiler (`build`'s `tsc --noEmit`), `typescript` (alias of `@typescript/typescript6`) is what `import ts from 'typescript'` and typescript-eslint resolve. The `build` script may need to call a different binary name; see Q4.
- Phase 3 removes the alias once `typescript@7.1`'s API and a typescript-eslint release declare support, tracked by typescript-eslint#10940.

**Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| The two packages fight over the `typescript` name or `tsc` binary under pnpm | Medium | Prove on a branch (Q4) before committing to the layout |
| TypeScript 7 flags code TypeScript 5.9 accepted | Medium | Phase 2 fixes errors in the same PR; the `build` gate catches them |
| typescript-eslint's peer range `<6.1.0` excludes a later 6.x | Low | Pin `@typescript/typescript6` to `~6.0.2` |
| Storybook, Knip or another tool requires a TypeScript API and breaks on 7 | Low | They resolve the `typescript` name, which stays on 6.0; run `pnpm check` and `pnpm --dir apps/ui atlas` |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | TypeScript 6.0 API | Bump `typescript` to 6.0.x, fix `tsconfig` fallout, lift the Dependabot ignore | pending | - | - | - |
| 2 | Native type check | Add `@typescript/native`, alias `typescript` to `@typescript/typescript6`, run `tsc` on 7 in `build`, record Q4 and Q5 | pending | - | 1 | - |
| 3 | Retire the bridge | Drop the alias once TS 7.1's API and typescript-eslint support land | pending (blocked upstream) | - | 2 | - |

**Phase 1 - TypeScript 6.0 API.** Goal: the JS API is on the line typescript-eslint supports. Scope: `apps/ui/package.json`, lockfile, any `tsconfig` option TypeScript 6 rejects, `.github/dependabot.yml`. Success signal: `pnpm check` and `ui-dist / build` pass, and Dependabot stops proposing a TypeScript major that breaks lint (if it would still propose 7.0 before phase 2, keep an ignore scoped to 7 and lift it in phase 2).

**Phase 2 - Native type check.** Goal: `tsc` is TypeScript 7. Scope: the same files plus the `build` script. Success signal: `build` passes with `tsc` reporting 7.x, lint and both guard tests still pass on the 6.0 API.

**Phase 3 - Retire the bridge.** Goal: one TypeScript. Scope: dependencies only. Success signal: no `@typescript/typescript6` in the lockfile, `pnpm check` green. Check upstream before scheduling.

**Parallelism Notes**: phases are sequential. All three conflict only on `apps/ui/package.json` and the lockfile.

**Parallel-session compatibility**

| Phase | Files touched | Collision risk |
| --- | --- | --- |
| 1 | `apps/ui/package.json`, `pnpm-lock.yaml`, `apps/ui/tsconfig*.json`, `.github/dependabot.yml` | Any PR that changes UI dependencies; Dependabot bumps rewrite the same lockfile |
| 2 | `apps/ui/package.json`, `pnpm-lock.yaml` | Same |
| 3 | `apps/ui/package.json`, `pnpm-lock.yaml` | Same |

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Hold TypeScript for now (2026-09-20) | Dependabot ignores TypeScript majors; #94 and #98 closed | Migrate immediately with the side-by-side packages | Lint and tests break on 7.0; the migration is a tooling change worth its own PRD |
| One Dependabot npm entry (2026-09-20) | Root entry only | Keep `/apps/ui` | The `/apps/ui` entry cannot update the workspace lockfile and duplicated the root PRs |
| Approach | TS 6.0 API for ESLint and tests, TS 7 `tsc` for type checks (proposed) | Wait for 7.1 with no compiler upgrade; replace the guard tests' parser | Only option that works today and keeps typed linting |

## Research Summary

Read on 2026-09-20: the TypeScript 7.0 announcement (no API in 7.0, 7.1 expected to add a different one, `@typescript/typescript6` for side-by-side use), typescript-eslint 8.70.0's peer range, typescript-eslint#10940 (maintainers say no support possible until a stable API; work started 2026-09-11), the CI logs of #94 and #98, and the local repro (`eslint .` crashes and `tsc --noEmit` reports errors only in the two guard tests). Not verified: `@typescript/native`'s binary name and pnpm behavior with both packages (Q4), `tsconfig` fallout on TypeScript 6 and 7 (Q5), and whether the announcement's package versions are still current when phase 1 starts.

---

*Generated: 2026-09-20*
*Status: DRAFT - needs validation*
