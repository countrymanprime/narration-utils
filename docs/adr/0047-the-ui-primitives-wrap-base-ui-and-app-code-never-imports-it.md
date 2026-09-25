# 0047. The UI primitives wrap Base UI, and app code never imports it

- **Status:** Accepted
- **Date:** 2026-09-20
- **Deciders:** the owner

## Context and problem

The primitives in `apps/ui/src/components/primitives/` hand-rolled every interactive behaviour, and most of it was missing: `Dialog` declared `aria-modal` but was not modal, the tooltip pointed `aria-describedby` at an id that usually did not exist, `SlideOver` and the mobile nav drawer had no Escape or focus trap, and `Field` had no error slot. Writing a focus trap, layering and id wiring by hand, and proving them in both jsdom and Chromium, is a lot of subtle work for one maintainer, and the same work would come again for every menu, popover and select. The owner decided (implementation plan D1, 2026-09-20) to adopt a maintained headless library for behaviour and accessibility, keep our own Tailwind styling and API, and wrap every part in a primitive so every control is styled one way. Radix and React Aria were considered and rejected. The dialog PRD's earlier recommendation (native `<dialog>`, no library) is reversed. `@base-ui/react` is MIT-licensed, so it is compatible with the project's AGPL-3.0-or-later licence ([ADR 0039](0039-the-project-is-licensed-agpl-3-or-later.md)).

Phase 1 of the foundation PRD (`docs/prds/base-ui-primitive-foundation.prd.md`, deleted when the work was done; recover it from git history) ran a spike before any primitive changed (Base UI 1.8.0, Chromium 1208 through Playwright 1.63, jsdom 30.1, 2026-09-20). What it found:

| Question | Result |
| --- | --- |
| Outside content while a modal is open | `aria-hidden="true"` plus `data-base-ui-inert` on every body-level sibling of the portal (the app root, Storybook's roots). No element gets the `inert` attribute. axe-core 4.13 reports no violation, on the whole document or on `#storybook-root` alone (`aria-hidden-focus` passes because a modal is open). The popup is `role="dialog"` (or `alertdialog`) with `aria-labelledby` pointing at the Title; it does not set `aria-modal`. |
| Tab trap in Chromium | Two focus-guard spans (`aria-hidden`, `tabindex="0"`) bracket the popup and redirect focus. 60 Tab and Shift+Tab presses left focus inside the popup every time. Page scroll is locked with `overflow: hidden` on `<body>`. |
| Focus return with no Trigger | A dialog rendered conditionally (`{open && <Dialog/>}`, the app's pattern) returns focus to the element that held it when the dialog mounted, on Escape and when the parent unmounts it. If that element is gone by then, focus falls to `<body>`, so the wrapper must supply a `finalFocus` fallback (the page's `main` landmark). |
| Escape and backdrop | Escape closes the topmost dialog. A press on the backdrop closes it unless `disablePointerDismissal` is set; `AlertDialog` (role `alertdialog`) never closes on a backdrop press and still closes on Escape. |
| Tooltip above a dialog | Nothing enters the browser top layer, so a body-level tooltip at `z-index: 1000` stays above a dialog at `60`. A hover tooltip inside a dialog sits on top (checked with `elementFromPoint`). Escape while such a tooltip is showing closes the tooltip and the dialog together: the tooltip is not a child of the dialog in Base UI's floating tree. |
| Tooltip semantics | The popup has no role and the trigger no `aria-describedby`: Base UI documents Tooltip as a hint for sighted users. `disableHoverablePopup` defaults to `false`, so the popup is hoverable, and it dismisses on Escape and stays while hovered or focused (WCAG 1.4.13). Focus shows it only for keyboard focus (`:focus-visible`), not after a mouse click. |
| Popover as the info icon | A `Popover.Trigger openOnHover` is a real button with `aria-expanded` and `aria-controls`, opens on hover, click and Enter, is hoverable, and closes on Escape and when the pointer leaves. It does not open on keyboard focus alone. The popup is a non-modal `role="dialog"` with no name until the wrapper gives it one. |
| jsdom | Dialog, AlertDialog, Tooltip (focus and hover with fake timers), Popover, Drawer, Progress, Field (with a textarea control), Menu, Collapsible, Checkbox, Switch and Toggle all render and respond to `userEvent` under jsdom 30 with no polyfill: the library guards its use of `getAnimations` and `ResizeObserver`. `src/test-setup.ts` needs no change at 1.8.0. |
| Bundle size | Baseline `dist/assets/index-*.js` is 571,969 bytes raw (158,239 gzip). With a namespace import of Dialog, AlertDialog, Tooltip, Popover, Progress and Field it is 722,875 raw (+150,906, +26%; 207,283 gzip); adding Drawer, 763,943 raw; adding Menu, Collapsible, Checkbox, Switch and Toggle, 818,579 raw (+246,610, +43%; 237,665 gzip). These are upper bounds: a namespace import keeps every part, and the wrappers use fewer. CSS is unchanged (the library ships none). |

## Decision drivers

- Writing a focus trap, layering and id wiring by hand, and proving them in jsdom and Chromium, is a lot of subtle work for one maintainer, and it would come again for every menu, popover and select.
- Keep our own Tailwind styling and API, and wrap every part in a primitive so every control is styled one way.
- The library's licence must be compatible with AGPL-3.0-or-later.

## Considered options

1. Base UI (`@base-ui/react`), wrapped in our own primitives that only they import
2. Radix
3. React Aria
4. Native `<dialog>` and no library (the dialog PRD's earlier recommendation)
5. Keep the status quo: hand-rolled behaviour in every primitive
6. An ESLint `no-restricted-imports` block, instead of a Vitest test, for the boundary

## Decision outcome

**Chosen option: Base UI (`@base-ui/react`), wrapped in our own primitives that only they import**, because a maintained headless library supplies the behaviour and accessibility that are a lot of subtle work for one maintainer to write and prove, while the wrappers keep our own styling and API.

The UI primitives are built on Base UI (`@base-ui/react`), and only the primitives import it.

- **Dependency.** `@base-ui/react` is a dependency of `apps/ui` only, with a caret range (`^1.8.0`) like every other dependency, so it rides the `ui-dependencies` Dependabot group. The atlas and the visual suite are the gate on a minor bump; a bump that breaks a wrapper is held with a reason.
- **Wrapper convention.** One flat file per primitive in `apps/ui/src/components/primitives/`, each with a `<Name>.stories.tsx` (so `atlasCoverage.test.ts` and the generated `docs/ui` keep working). Import per component (`@base-ui/react/dialog`), never the package root, so tree-shaking works. The wrapper API is closed: it keeps or improves the props the call sites already use, adds only explicit new ones, never spreads Base UI props and never exports a Base UI type. It may accept `className` and standard DOM attributes as `Button` does. Base UI's parts that render a button are composed with our `Button` through `render`.
- **Styling.** Tailwind utilities with `var(--token)` values and data-attribute variants (`data-open:`, `data-starting-style:`, `data-disabled:`, `data-invalid:`) on the parts, chosen mutually exclusively ([ADR 0017](0017-no-legacy-css-shadowing-tailwind.md)), no new class in `styles.css` ([ADR 0009](0009-complete-tailwind-migration.md)), none of the library's example CSS, `--backdrop` for the scrim ([ADR 0010](0010-theme-switching.md)).
- **Stacking.** `#root` (`index.html`) and the Storybook decorator (`.storybook/preview.tsx`) carry `isolate`, so the popups the library portals to `<body>` are outside the app's stacking context and always above it. The existing numeric order stays (slide-over 50, dialog 60, selection menu 65, nav drawer 70), with tooltips and popovers at 1000, above everything.
- **The boundary is checked.** `apps/ui/src/baseUiBoundary.test.ts` parses every source file in `src`, `tests`, `scripts`, `.storybook` and the package root and fails on any import, type import, re-export, dynamic `import()`, `require()`, `import('...')` type, `declare module` or other call that takes a `@base-ui/*` name (`vi.mock`) outside `src/components/primitives/`. A bad fixture per form proves the scan fires. It runs in `pnpm check` with the rest of the Vitest run ([ADR 0046](0046-architecture-rules-taken-from-adrs-are-lint-and-test-rules.md)).

This extends [ADR 0009](0009-complete-tailwind-migration.md) and [ADR 0023](0023-visual-suite-capture-contract-and-storybook.md); it changes no decision in either. The behaviour of the dialog, tooltip, drawer and remaining widgets is recorded in the ADRs of the phases that build them.

### Consequences

- **Good:** Keyboard and screen-reader behaviour (trap, Escape, focus return, id wiring, roving focus) comes from a maintained library and is proved by story `play()` checks in the Chromium atlas; jsdom runs the same stories with no polyfill.
- **Neutral:** Pages and feature components stay unchanged by a library upgrade or swap: the edit is confined to `primitives/`. The cost is a wrapper per widget and a closed API that has to grow by hand when a page needs a new option.
- **Bad:** The bundle grows: an upper bound of about 247 KB raw (43%) if every family were kept whole, measured from the real wrappers at the end of the stack, where the budget is fixed. It is a desktop app served from disk, so the cost is parse time, not download.
- **Neutral:** Outside content is hidden with `aria-hidden`, not `inert`. Axe passes, and the trap keeps the keyboard inside, but a screen reader's virtual cursor is kept out only by `aria-hidden`. If a future assistive technology or axe version disagrees, the wrapper can add `inert` to the app root while a modal is open.
- **Bad:** Because the tooltip is not a floating-tree child of the dialog, Escape with a hint tooltip open inside a dialog would close both. No tooltip is inside a dialog today; the dialog wrapper is responsible for handling it when one is.
- **Neutral:** The boundary is a Vitest test rather than an ESLint `no-restricted-imports` block. ADR 0046 already puts mechanical import rules in the test runners, and the test shows it fires on a bad fixture for each way of naming the package (a type import, a re-export, a dynamic `import()`, `require`, `vi.mock`, `declare module`), which a lint pattern does not: `no-restricted-imports` does not see a dynamic import or `vi.mock`. The PRD had planned the ESLint block; the verification tooling PRD's phase 9 may add it as a second guard (with a dependency-cruiser layering rule), and this test can stay alongside it.
- **Neutral:** The library is 1.x with monthly minors. A wrapper hides the API, so a breaking change or a change of direction is a primitives-only edit, which is the reason for the boundary.
- **Neutral:** To change any of this (another library, an open wrapper API, imports outside the primitives), write a new ADR that supersedes this one.

### Confirmation

`apps/ui/src/baseUiBoundary.test.ts` fails on any `@base-ui/*` import outside `src/components/primitives/`, with a bad fixture per form, and runs in `pnpm check`; the atlas and the visual suite are the gate on a minor bump.

## Pros and cons of the options

### Keep the status quo: hand-rolled behaviour

- Bad, because most of it was missing: `Dialog` was not modal, the tooltip's `aria-describedby` usually pointed nowhere, `SlideOver` and the mobile nav drawer had no Escape or focus trap, and `Field` had no error slot.
- Bad, because writing and proving it by hand is a lot of subtle work for one maintainer, repeated for every menu, popover and select.

### An ESLint `no-restricted-imports` block

- Bad, because `no-restricted-imports` does not see a dynamic import or `vi.mock`.
- Bad, because a lint pattern does not show it fires on a bad fixture for each way of naming the package.
