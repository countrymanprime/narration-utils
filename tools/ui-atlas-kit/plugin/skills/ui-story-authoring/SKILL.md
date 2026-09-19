---
name: ui-story-authoring
description: Use when writing or changing a Storybook story file for a component, or when the atlas fails a story on a play() error, axe violation, overflow or console error.
---

# ui-story-authoring

## Why this exists

A story is both the catalog entry and its driver, and the atlas fails it on a throwing `play()`, any axe violation,
sideways overflow or a `console.error`. Stories written from habit hit each of those: clicking a disabled button
throws, hover tooltips race a 1000 ms timer, and an error boundary logs on purpose and fails the run.

## When to use this

- A component has no `<Name>.stories.tsx` (the reference `atlasCoverage.test.ts` fails a primitive without one).
- A component gains a variant, state or interaction, or an atlas or `stories.test.tsx` run fails on a story.
- Not for app-level page states (`ui-state-catalog`).

## What to do

1. Create `<Name>.stories.tsx` next to the component (the coverage test looks for exactly that name). Follow
   `src/components/primitives/Button.stories.tsx`:
   ```tsx
   import type { Meta, StoryObj } from '@storybook/react-vite';
   import { expect, fn, userEvent, within } from 'storybook/test';
   const meta = { title: 'Primitives/Button', component: Button, args: { children: 'Save', onClick: fn() } } satisfies Meta<typeof Button>;
   export default meta;
   type Story = StoryObj<typeof meta>;
   ```
   The title is `<Group>/<Name>`; `Primitives/<Name>` is what `a11y-debt.ts` matches. Put shared props in `meta.args`,
   one PascalCase named export per story. Stories are picked up by glob (`.storybook/main.ts`,
   `stories.test.tsx`); use `.tsx` and register nothing.
2. Cover the variant x state matrix as plain stories with no `play()`: one per variant, and each disabled variant
   (`Primary`, `Ghost`, `Danger`, `PrimaryDisabled`, ...). Add stories for empty, long-content and overflow cases:
   an unbroken 150-character path, 30 to 60 rows, an empty list (`Dialog` `LongUnbrokenToken`, `WorkDialog`
   `LongLogs`, `MeterBar` `Empty`).
   Depth by tier is in `ui-component-inventory`; composites need representative states, not the full matrix.
3. Add a `play()` for each primary interaction, named for the behaviour (`ClickInvokesHandler`,
   `CloseButtonInvokesOnClose`): query with `within(canvasElement)` by role and accessible name, act with
   `userEvent`, assert on an `fn()` arg (`toHaveBeenCalledOnce`). Do not test what a plain story already shows.
4. Handle the awkward cases as the reference does:
   - Disabled controls: assert `toBeDisabled()` and that the handler was not called. Do not `userEvent.click` it; a
     `pointer-events-none` control makes that throw (`DisabledIsInert`).
   - Tooltips: show them by focus, not hover (hover waits 1000 ms). `button.focus()` then
     `within(document.body).findByRole('tooltip')`, since the tooltip lives outside the canvas. A non-tabbable icon uses
     `fireEvent.focusIn`. A disabled button's wrapper span is the tab stop: `userEvent.tab()`.
   - Modals, drawers: render them open (the dialog stories render the component directly; `SlideOver` passes
     `open: true`) and query the `dialog` by name. A panel that stays mounted while closed gets a `Closed` story
     asserting `data-open` and `aria-hidden`.
   - Error boundaries: the caught error is logged with `console.error`, which fails the atlas. Define a helper in the
     story file that replaces `console.error` and returns a function restoring the original, and set it as
     `beforeEach` on the throwing stories only (`ErrorBoundary.stories.tsx`). Healthy stories keep the real one.
   - Overflow: assert layout in the play (`body.scrollWidth <= body.clientWidth`); jsdom has no layout, so only the
     atlas browser run proves it. The atlas separately fails a page that scrolls sideways at 390 px.
5. Write semantic markup so axe passes: labelled dialogs (`role="dialog"`, `aria-modal`, accessible name), named
   buttons (`aria-label` on icon-only), and scroll regions reachable by keyboard (`tabIndex={0}`, as `Dialog` needed).
   Show colour-coded data with a text legend. Fix the component, not the story.
6. Run the unit path, then the browser path: the repo's unit test command (`stories.test.tsx` runs every story's
   `play()` under jsdom via `composeStories`), then `<pm> run atlas`. Look at
   `screenshots/atlas/<title>/<story>--<theme>-<viewport>.png` for at least one light and one narrow story.
7. If axe reports a real failure, fix the component first. Only when the fix is a design decision (a palette token, for
   example) record debt in `<ui-root>/tests/atlas/a11y-debt.ts`: the story `title`, the axe rule ids, and a reason that
   says where the fix belongs (the coverage test requires a reason over 20 characters). A new entry beyond the current
   count means raising `MAX_DEBT_ENTRIES` in `atlasCoverage.test.ts`, which shows in review; debt is meant to shrink. Never turn the rule off in `preview.tsx` or a story's `parameters.a11y`.

## What this skill is not

It does not choose which components need stories (`ui-component-inventory`), edit `state-catalog.ts` or
`app.drivers.ts` (`ui-state-catalog`), or explain byte differences between runs (`ui-capture-contract`). It does
not judge how a story looks; that is `ui-visual-review`.

## Lessons from the first six rollouts

- `play()` can run in the browser before passive effects flush (it passed in jsdom): when the interaction depends on a listener
  an effect registers, wait for the outcome with `waitFor` / `findBy*`, not a bare assertion.
- An element with `display: none` has no accessible name, so `getByRole(..., { hidden: true })` cannot find it: query it a
  different way, or make the story render it visible (a component that is `md:hidden` needs a story at the narrow viewport
  or a forced-visible wrapper).
- A story that shows a native validation bubble ("Please fill out this field") is non-deterministic: blur the field or fill it.
- A component that is taller than the atlas viewport is captured whole (the screenshot is full page and cropped to the story's
  content), so tall stories are fine.
- An app with a single theme runs every story twice for identical output: set `UI_ATLAS_THEMES=light`. An app that themes with
  the OS setting (Tailwind's default `dark:` variant) is flipped by the atlas through `emulateMedia({ colorScheme })`; an app
  that themes with a class or attribute needs the decorator in `.storybook/preview.tsx` (`ui-atlas init --theme-class dark`).
- Components that read a router, i18n or theme context need those providers in the story decorator (`MemoryRouter` for routed
  components), not mocks inside the component.

