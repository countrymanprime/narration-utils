---
name: ui-state-catalog
description: Use when a page, modal, panel or reachable app state is added, removed or visibly changed, or when the app visual suite fails on identical screenshots, a stale sameAs, overflow or console errors.
---

# ui-state-catalog

## Why this exists

The catalog is the one list of every `{page, state}` the app can be in, and the drivers are how each is reached. Left
alone it drifts: a markup change makes the text-selection driver select nothing, the state still "passes", and two
screenshots become identical with nobody noticing. The reference repo found that, a mobile drawer opened over a page
that was merely still rendering, and a 63 px overflow at 390 px, all only after the checks below were switched on.

## When to use this

- After a change to `<ui-root>/src` that adds, removes, renames or visibly changes a page or state.
- When `tests/visual` fails: `identical screenshots`, `sameAs no longer holds`, `blank screenshot`, overflow, or a
  problem list from the app.
- Not for single-component states (`ui-story-authoring`) or the capture rules themselves (`ui-capture-contract`).

## What to do

1. Add a row to `STATE_CATALOG` in `<ui-root>/tests/visual/state-catalog.ts` (the `StateEntry` type is in `lib/types.ts`):
   `page`, `state`, `description`. Only the catalog, `app.drivers.ts` and `viewports.ts` are repo-owned; `app.spec.ts`,
   `global-setup.ts`, `lib/` and `helpers/` are vendored, so change them in the kit and `ui-atlas sync`. Optional
   fields: `undriven` (why there is no driver; the count may only shrink, `MAX_UNDRIVEN` in `visualSuite.test.ts`),
   `sameAs: { of: 'page/state', reason, viewports? }` (renders identically to another row, checked), `mask` (CSS
   selectors of live regions painted over) and `pointer: 'keep'` (the shot needs the hover or focus the driver left).
2. Add the driver to `APP_DRIVERS[page][state]` in `app.drivers.ts`: `async (page) => {...}` reaching the state
   through real interaction with accessible-name selectors. The runner has already done `goto('/')` and
   `settlePage`. Reuse `clickVisible`, `clickNav` and `freezeClock` (scaffolded in `app.drivers.ts`) and write repo-specific helpers
   beside them (the reference has `goToPage`, `selectFirstParagraphText`). A driver that reloads with
   `page.goto('/?mockNoManuscript=1')` must import `settlePage` from `helpers/settle` and call it again.
3. Boot alternate data through URL-param seams read at startup and honoured only in the mock build (reference: `main.tsx`
   reads `?mockNoProject=1`, `?mockNoRpp=1`, ...). If a state has no seam, add one to the mock, or mark the row
   `undriven` with a real reason; never write a driver that only sometimes works.
4. Wait on conditions, never `waitForTimeout`: a role/text/selector (`getByRole('tooltip').waitFor()`), a rendered
   row (`tr[data-row]`), or a value (`getByText(/^0:0\d \/ 10:00$/)`). Freeze timers only inside the one driver whose
   timer races the shot (the toast fades on a real 2.25 s timer); a page-wide fake clock breaks React 19 transitions.
5. Apply the lessons written into the drivers:
   - `clickVisible` is a plain auto-waiting click and never opens a menu; `clickNav` is the one helper that opens the
     mobile drawer, and only when the layout shows the menu button instead of the item (no timeout to tune). A
     "wait 1.5 s, then open the menu" heuristic opens the drawer over a page that is merely slow, and the drawer's
     backdrop then intercepts the click. At mobile the rail exists only inside the drawer.
   - End every navigation with a wait for the destination: its heading, then its content (the heading renders before the
     data). A click returns when it is dispatched, so a bare navigation photographs the page it just left, which shows up
     as `identical screenshots` and a stale `sameAs`. Prove a new driver with `UI_CPU_THROTTLE=20` (the scaffolded
     `beforeCapture` slows the page's CPU 20 times): a driver that races the render fails there on demand.
   - Select text by building a `Range` on a Text node of 20+ characters and dispatching `mouseup` yourself; synthetic
     Playwright drags do not reliably produce a selection. Wait for real prose first.
   - Tooltips show after 1 s on hover and at once on focus: wait for `getByRole('tooltip')` and set `pointer: 'keep'`.
   - Scope duplicate labels (`.settings-nav`); exclude notes containing another highlight (nested `mark` stops click
     propagation); a state that is a no-op at some viewports declares `sameAs` with `viewports`.
6. Run the integrity check (`<pm> test`: unique rows, driver or `undriven`, no orphan drivers, `sameAs` target exists and
   has a reason, real viewport names), then one state: `npx playwright test tests/visual -g "<page> / <state>"`.
   Open `screenshots/app/<page>/<state>/<viewport>.png` for all four viewports in `viewports.ts`, not one.
7. Finish with a full `npx playwright test tests/visual`. The duplicate and stale-`sameAs` checks run in
   `global-setup.ts`'s teardown over that run's records only, so a filtered run cannot see a duplicate of a state it did
   not capture.
8. Triage failures:
   - `identical screenshots at <vp>: a == b`: open both. A driver that no-ops means fix the driver; if they are
     truly the same, declare `sameAs` on one row with a reason (limit `viewports` if it holds at some widths).
   - `sameAs no longer holds`: the pair now differs; delete the declaration, or fix the regression if it was meant to match.
   - `page scrolls sideways by Npx` (tolerance 1 px): a real layout defect at that viewport; fix the CSS.
   - `the app reported problems`: page error, `console.error`, failed request or HTTP 400+. Fix the cause or seam.
   - `blank screenshot`: the page did not render; check the driver and startup errors.

## What this skill is not

It does not write component stories (`ui-story-authoring`), explain why the same state differs between two runs
(`ui-capture-contract`), or judge whether a picture looks right (`ui-visual-review`). It does not make a green run
mean the layout is correct: the suite gates errors, overflow, blanks and duplicates, and is not a pixel diff.

## Optional per-row and per-repo seams

- `fullPage: true` on a catalog row captures the whole scrollable page, for long routes.
- `export async function beforeCapture(page)` in `app.drivers.ts` installs `page.route` stubs before the app loads (third-party
  embeds, non-deterministic network).
- A repo that already has a `playwright.config.ts` for e2e keeps it: `ui-atlas init --app-config playwright.visual.config.ts`
  writes the kit's app config under that name and adds `screenshots: playwright test -c <name>`.

