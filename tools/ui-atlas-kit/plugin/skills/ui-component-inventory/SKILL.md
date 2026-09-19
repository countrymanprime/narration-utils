---
name: ui-component-inventory
description: Use when starting the atlas rollout, adding or moving components, or deciding whether a component needs stories, a state-catalog row, or an atlas-exempt reason.
---

# ui-component-inventory

## Why this exists

Without a written classification, test depth is decided per component by whoever remembers it: a two-variant
primitive gets one story, a layout wrapper gets a full matrix, and nothing says why. The reference repo's coverage
check only trusts two answers for a primitive, a story file or a recorded exemption with a reason, and this skill
produces the reasoning that feeds both.

## When to use this

- Before writing stories for a repo for the first time (after `ui-atlas-init`).
- When components are added, renamed, moved between folders or deleted.
- When a component is proposed for `ATLAS_EXEMPT`, or when an existing exemption looks stale.

## What to do

1. List candidate components under `<ui-root>/src/components` (one exported component per `PascalCase.tsx`).
   Ignore hooks, utilities, types and `*.stories.tsx` / `*.test.tsx`. The coverage test and `ui-atlas audit` only scan one
   flat directory for `^[A-Z][A-Za-z]*\.tsx$` (`vars.PRIMITIVES_DIR` in `ui-atlas.config.json`, `components/primitives` by
   default), so a primitive outside it is not enforced until it is moved or that setting and the test's path change.
2. For each, count consumers: the number of distinct files importing it (`Grep` for the import path or symbol,
   excluding its own stories and tests). Note whether it holds its own state, fetches or reads app context,
   and whether it is routed.
3. Classify with the rubric in `tools/ui-atlas-kit/docs/design.md`, and record one sentence of rationale:
   - primitive: has variants or state logic, or 2+ consumers, and takes everything through props.
   - composite: assembles primitives into a reusable block with no routing and no data ownership.
   - feature: owns app state or data access for one area of a page.
   - page: a routed top-level view.
   Tie-breakers (working definitions, not in the design doc): a component with two or more consumers is not "single-use
   glue"; a component that reads context or calls the API is a feature or page, never a primitive.
4. Assign test depth from the tier:
   - primitive: full variant x state x theme matrix, keyboard/focus, axe, wide and narrow viewport (the atlas
     runs each story in light and dark at 1024 and 390 px).
   - composite: representative states in stories, 2 viewports.
   - feature/page: state-catalog rows driven through real interaction at every viewport (`ui-state-catalog`).
   - exempt: only pure layout wrappers, single-use glue, and third-party re-exports.
5. For every exempt component, write a reason a reviewer can disagree with (the reference test rejects fewer than 10
   characters, and fails a stale exemption for a component that gained a story or no longer exists). Add it to the
   `ATLAS_EXEMPT` record in `<ui-root>/src/atlasCoverage.test.ts`, one `Name: 'reason'` line each (the audit reads that
   shape). Adding one is a review-visible decision; the list is meant to shrink, so re-check existing entries each pass.
6. Write `docs/ui/inventory.json` as `{ "components": [ ... ] }`, one object per component, sorted by `name`. Keep the
   keys `ui-atlas docs` writes so the two agree: `name`, `title` (Storybook title or `null`), `source` (path), `stories`
   (story names, `[]` if none), `consumers` (importing files), `a11yDebt` (boolean). Add `tier` (`primitive | composite |
   feature | page`), `depth` (`matrix | representative | catalog | exempt`), `states` (feature/page: their `page/state`
   keys from `state-catalog.ts`, else `[]`), `atlasExempt` (reason or `null`) and `rationale`. Caution: `ui-atlas docs`
   regenerates the fields Storybook knows (`title`, `name`, `source`, `stories`, `consumers`, `a11yDebt`) and MERGES with
   what is already in the file: your classification fields, and entries for components with no stories, are kept. Run `docs`
   after you write the classification and nothing is lost.
7. Hand the gaps to the next skills: components with `depth` set and `story: null` go to `ui-story-authoring`;
   feature/page components with no catalog rows go to `ui-state-catalog`. Then run the repo's unit test command so
   `atlasCoverage.test.ts` confirms the exemptions and coverage.

## What this skill is not

It does not write stories (`ui-story-authoring`) or state rows and drivers (`ui-state-catalog`), and it does not
audit quality or produce the 0-100 score (`/ui-atlas:audit`). It classifies and records; it never lowers a depth
just because a component is hard to test. A hard-to-test primitive is a finding, not an exemption.
