# 0062. UI import rules are a dependency-cruiser config and a `<mark>` scan that name their ADR

**Status:** Accepted
**Date:** 2026-09-21
**Supersedes:**

## Context

[ADR 0046](0046-architecture-rules-taken-from-adrs-are-lint-and-test-rules.md) put the Go and Python import rules into the existing lint and test runners and said the UI rules would follow the Base UI stack and get their own ADR. That stack is delivered ([ADR 0047](0047-the-ui-primitives-wrap-base-ui-and-app-code-never-imports-it.md) to [ADR 0058](0058-heading-has-a-level-and-panel-names-its-region-with-a-level-2-title.md)), so the primitives are what they will be and the rules can be written against them. Three facts about `apps/ui` are mechanical and had only review behind them:

- `components/primitives/` is the bottom layer. Every primitive has a story in the atlas, so a primitive that imports a feature component drags that component's tree into the story. One did: `MeterBar.stories.tsx` imported the chapter status labels from `manuscript/ChapterNav`.
- The generated `wailsjs/` bindings are reached only through `src/api/wailsClient.ts`, which the mock backend replaces in tests and in the visual suite.
- [ADR 0016](0016-highlight-primitive.md) says `Highlight` is the only way to render highlighted text, and one file, `proofing/InlineDiffRow.tsx`, writes its own `<mark>`.

The owner adopted the PRD's recommendations (implementation plan D22, questions 7 and 8): fix the story import, and start the ADR 0016 rule with a one-entry, reasoned allowlist that goes to the owner as a design question ([ADR 0063](0063-the-proofing-diff-marks-its-own-words-and-adr-0016-covers-entry-highlights.md), Proposed).

## Decision

**Import-graph rules are a dependency-cruiser config.** `apps/ui/.dependency-cruiser.mjs` holds three forbidden-dependency rules, run over `src` and `tests` by the `architecture` Nx target of `narration-utils-ui` (`pnpm --dir apps/ui architecture`), which `pnpm check` and the `js` CI job run (about 2 s). The rule names appear in a failure and each has a `comment` that says what to do instead.

| Rule | Forbids | Why |
| --- | --- | --- |
| `primitives-are-leaves` | a file in `components/primitives/` (a story or a test too) importing anything else under `components/` | a primitive is documented and tested alone in the atlas; shared data goes above the feature folders (`src/chapterStatus.ts` for the status labels, order and colours) |
| `wails-bindings-only-in-api` | any file outside `src/api/` importing `wailsjs/` | the host is called through the API client so the mock covers it |
| `base-ui-only-in-primitives` | any file in `src` or `tests` outside `components/primitives/` importing `@base-ui/*` | a second guard behind `baseUiBoundary.test.ts` (ADR 0047), which stays the first because it also sees `import()`, `vi.mock` and `declare module` |

**The `<mark>` rule is a scan, not a lint rule.** `src/highlightBoundary.test.ts` reads the TypeScript syntax tree of `src`, `tests` and `.storybook` and fails on a `<mark>` element (JSX or `createElement('mark')`) in any file but `primitives/Highlight.tsx` and the allowlist. The allowlist has one entry, `proofing/InlineDiffRow.tsx`, with the number of `<mark>` it may write (one) and a reason; the test fails if an entry stops matching or loses its reason. It also reads `jsx('mark')` calls and `.js` and `.jsx` files; a tag held in a variable or passed as a prop (`as="mark"`) is not seen. The PRD planned an ESLint `no-restricted-syntax` rule, but the tooling's config-protection hook refuses edits to `eslint.config.js` and that guard is not bypassed; ADR 0047 already keeps its boundary as a scan for the same reason plus its bad fixtures, so this follows it.

**Each rule proves it fires.** `src/architectureRules.test.ts` writes a small tree under `node_modules/.cache` with one deliberate violation per rule and a legal look-alike, cruises it with the same rule set, and expects exactly the named rule. `highlightBoundary.test.ts` has a bad fixture for each way of writing a `<mark>`. A rule whose pattern stops matching (a renamed folder) fails there instead of passing for ever on the real tree.

`design-spec-guard` stays for judgement (which tokens, which look) and cites these rules so it stops re-checking them.

## Consequences

- A primitive cannot depend on a feature, a component cannot call the host around the API client, and a second `<mark>` cannot appear, without a red check that names the rule.
- `dependency-cruiser` 18.3.1 (MIT, dev-only, AGPL-compatible per [ADR 0039](0039-the-project-is-licensed-agpl-3-or-later.md)) is a devDependency of `apps/ui`. The lockfile pins it; the newer 18.4.0 was inside the repository's minimum release age, so it was not taken.
- A new feature folder needs no edit: `primitives-are-leaves` forbids everything under `components/` but `primitives/`. A new layer rule (for example that features do not import each other) is one more entry in the file.
- The rules read imports. A module name built at run time, or a `<mark>` produced by a string of HTML, is not seen.
- To drop or reshape a rule, write a new ADR that supersedes this one.
