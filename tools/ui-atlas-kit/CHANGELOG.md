# Changelog

`ui-atlas sync` refreshes the vendored core files (`plugin/templates/core`) and stamps the version. It does NOT touch
scaffold files (yours after `init`), so the **Adopt by hand** lines below are what to copy across on upgrade.

## 0.3.6

- **Core, opt-in:** a project can declare `export const documentScroll = 'locked'` from its `app.drivers.ts` to turn on
  two checks the suite runs on every capture, with no per-row escape hatch: `lib/capture.ts` measures
  `documentElement.scrollHeight - clientHeight` (`measureVerticalOverflow`) and scans `#root` for a rendered,
  `position: absolute` element whose `offsetParent` is `<body>` or `null` (`findEscapedAbsolutes`) - a containing block
  that escaped the app's shell and lays out against the document instead. Both are recorded on `CaptureRecord`
  (`overflowYPx`, `escapedAbsolutes`) on every run; `lib/validators.ts`'s `checkDocumentScroll` only turns either into a
  failure when the project opted in. A structural check, not a captured-size one: it catches a zoom-only escape (a page
  that only overflows at one window height and zoom level) that no viewport in the matrix happens to reproduce.
  **Adopt by hand:** nothing to migrate for a project that does not declare `documentScroll`; one that does should expect
  new failures until every page scrolls inside its own container and nothing escapes the shell.

## 0.3.5

- **Core:** the app suite loads and drives each state once and resizes through the viewports, instead of loading and
  driving it again for every viewport. `app.spec.ts` makes one test per `{page, state}` (`<page> / <state>`) with a
  `test.step` per viewport, and `lib/capture.ts` gains `captureAcrossViewports`: boot at the first viewport, drive once, then
  for each viewport resize, settle and make the same captures and checks as before (screenshot to the same path, record,
  overflow, collapsed controls, axe). Every viewport is captured and checked even when an earlier one fails, and the
  failure names the viewport. The test's timeout is the per-test timeout times the number of viewports. A row's
  `extraViewports` each get a freshly loaded page (a width where the layout switches, which a resize from a wide window
  does not reproduce). A driver that freezes the page clock needs `reloadPerViewport`: axe lets time run again after the
  first shot, so the state moves on, and the fake clock belongs to the browser context, so a second page in it cannot
  freeze it again. The test fails with that advice when such a row lacks it. Loading and driving was about two thirds of a capture's own time (measured on this repo's
  suite: load 0.77 s, drive 0.64 s, axe 0.45 s, the rest 0.2 s, median over 138 captures).
- **Core:** `StateEntry.reloadPerViewport` (in `lib/types.ts`) keeps the old shape for one row: a test per viewport
  (`<page> / <state> / <viewport>`), each on a freshly loaded page, for a state whose driving or rendering depends on the
  width it was reached at.
- **Adopt by hand:** `-g "<page>.*<state>"` still selects a state; a viewport is now a step, not a test, so `-g` can no
  longer pick one viewport of a row. Run the suite once before and once after the upgrade and compare the PNGs
  (`screenshots/app`): a picture that differs is a state that remembers its first viewport, so give its row
  `reloadPerViewport: true` with the reason, or fix the page. In this repo 24 of 150 rows needed it: tooltips (a resize
  closes them), states whose driver scrolled something at the first width, a popup anchored where it opened, and live
  progress. A spinner caught at another angle is not a different state.

## 0.3.4

- **Core:** axe runs on the app's states, not only on stories. After each capture's screenshot the suite injects `axe-core`
  (read only when axe runs, so a repo that never turns it on needs no dependency) and groups the page's violations by rule.
  Three modes, from `lib/validators.ts` `resolveAxeMode`: **off** by default; **gate** when the project's `app.drivers.ts`
  exports `axeDebt` (a list of `AxeDebt { page, state, rules, reason, viewports? }`), where a violation the list does not
  declare fails the capture with the rule, the node count, the first selectors and axe's advice, and a declared rule that
  is no longer reported fails too (the list only shrinks, like `sameAs`); and **report only** with `UI_AXE=1`, which
  fails nothing and makes the teardown print how many elements axe found over how many captures, per rule, and one line
  per state (the baseline to measure before gating). `UI_AXE=0` skips it for a quick local run, `UI_AXE=gate` forces the
  gate for a repo with no list yet, and any other value throws. `lib/validators.ts` gains `AxeFinding`, `AxeDebt`,
  `RawAxeViolation`, `summariseAxeViolations`, `checkAxeFindings`, `resolveAxeMode`, `summariseAxeRun`, `AXE_TARGET_LIMIT`
  and an optional `CaptureRecord.axe`. A driver that froze the page clock stopped axe (it waits on timers, and the run hung
  until the test timed out): the run resumes the clock first, after the picture is taken, and only when a clock was installed
  (`clock.resume()` on a page without one installs a fake clock). The teardown prints `axe mode: <mode>` on every run; a
  mistyped `UI_AXE` fails at the start of the run; and on CI (`CI` set) a project that declares `axeDebt` fails if `UI_AXE`
  is 0 or 1 (`checkAxeModeForCi`), so a leftover shell variable cannot pass a run without the gate.
- **Skills and docs:** `ui-state-catalog`, `ui-atlas-gate`, `ui-capture-contract` and `design.md` describe the modes and the debt list.
- **Adopt by hand:** to turn it on, add `axe-core` (the version your Storybook addon already uses) as a devDependency, run
  `UI_AXE=1 <pm> run screenshots` once to see the baseline, fix what is cheap, then export `axeDebt` from `app.drivers.ts`
  (`export { AXE_DEBT as axeDebt } from './axe-debt'`, the list in a file of your own) with a reason and a tracking issue per
  entry. In your `src/visualSuite.test.ts` copy the new `describe` blocks (`summariseAxeViolations`, `checkAxeFindings`,
  `resolveAxeMode`, `summariseAxeRun`) and an `axe debt` block that caps the list (`MAX_AXE_DEBT_RULES`, like `MAX_UNDRIVEN`)
  and checks that each entry names a catalog row, a rule and a reason. Expect the first run to find real defects (unnamed
  buttons, pages with no main landmark or level-1 heading).

## 0.3.3

- **Core:** the app suite fails a collapsed control: a visible text box, select or textarea (an `<input>` except
  color, checkbox, radio, range, file, hidden and the button types) narrower than 64px, which shrinks instead of
  overflowing, so the sideways-overflow check never saw it. The failure names the control, its width and the viewport, and
  is reported after the screenshot is taken. `lib/validators.ts` gains the pure `findCollapsedControls`,
  `checkControlWidths`, `findNarrowestControl`, `MIN_CONTROL_WIDTH_PX` and `NON_TEXT_INPUT_TYPES`, `CaptureRecord` gains
  `narrowestControlPx`, and the teardown prints the run's narrowest control (what the 64px was calibrated from). Controls in
  an `aria-hidden` or `inert` subtree, or one pixel tall or less (screen-reader-only inputs), are not measured; a repeated name is
  numbered (`disambiguateLabels`, "Model (2)") so a declaration or a failure addresses one control.
- **Core:** two optional `StateEntry` fields. `narrowControls: { labels, reason, viewports? }` is the per-row opt-out for a
  control that is narrow on purpose; it needs a reason and is checked like `sameAs` (it fails when the control is no longer
  narrow). `extraViewports: Viewport[]` captures a state at widths beyond the `viewports.ts` matrix, for a layout that only
  changes at one width, without every state paying for it (`app.spec.ts` now loops `[...VIEWPORTS, ...extraViewports]`).
- **Core:** the teardown also prunes screenshots of a viewport a row no longer captures (it pruned only whole state folders).
- **Skills and docs:** `ui-state-catalog`, `ui-atlas-gate` and `design.md` describe the two fields and the check.
- **Adopt by hand:** in your `src/visualSuite.test.ts` copy the new `describe` blocks (`findCollapsedControls`,
  `NON_TEXT_INPUT_TYPES`, `checkControlWidths`, `disambiguateLabels`, `findNarrowestControl`), the `narrowestControlPx: null` default in the
  `record` helper, and the two catalog-integrity tests for `extraViewports` and `narrowControls`; make the `sameAs` viewport
  test include extra viewport names. The first run may flag controls that were already collapsed: fix the layout, or declare
  them in `narrowControls` with a reason. To use `extraViewports` at a width where the layout shows a menu button instead of
  the navigation, your `clickNav` must open the drawer (the 0.3.2 scaffold does).

## 0.3.2

- **Scaffold only** (the vendored core files are unchanged, so `ui-atlas sync` has nothing to refresh and their
  headers still say 0.3.1): `clickVisible` no longer waits 1.5 s and then opens the mobile menu. That heuristic opened
  the drawer over a page that was merely slow, and the drawer's `fixed inset-0` backdrop then intercepted the click
  (measured: a control that renders after 2.5 s at 375 px timed out with "subtree intercepts pointer events"). It is now
  a plain auto-waiting click. New `clickNav(page, name, role = 'link')` is the one helper that opens the drawer, and
  only when the layout shows the menu button instead of the item: it waits for whichever is visible first (no timeout).
  `beforeCapture` is now real code and carries `UI_CPU_THROTTLE=<factor>`, a stress mode that slows the page's CPU so a
  driver that races the render fails on demand (a bare navigation photographed the wrong page at 20x in the reference
  repo, the same failure a busy CI runner produced once in twenty runs); a mistyped value throws.
- **Skills:** `ui-state-catalog` describes the two helpers, the destination wait every navigation needs, and the stress mode.
- **Adopt by hand:** in your `app.drivers.ts` replace `clickVisible`, add `clickNav` and switch every call that clicks a
  navigation item to it (a nav `clickVisible` no longer opens the drawer, so at a phone width it now times out), make each
  `goToPage`-style helper wait for the destination (heading, then content), and add the `UI_CPU_THROTTLE` body to
  `beforeCapture` (keep your `page.route` stubs in it). Then run the suite once with `UI_CPU_THROTTLE=20`.

## 0.3.1

- **Core:** the atlas ignores fixed layers when sizing a tall story to its content and ignores off-canvas fixed layers
  when cropping (a closed slide-over parked below the fold used to make every screenshot two thirds blank); a `fullPage`
  capture taller than 6000px now fails instead of being silently cut off; the atlas config comment no longer says `pnpm`.
- **Core:** stale atlas screenshot folders are pruned (new vendored file `tests/atlas/global-setup.ts`, registered in `playwright.atlas.config.ts`); a story reports all its problems at once (`expect.soft`); axe `incomplete` results are attached as `axe-incomplete` annotations.
- **CLI:** `audit` matches an exemption keyed by a component's path (`'layout/Spacer'`) as well as its file name; the atlas scrolls to the top with `behavior: 'instant'`; `sync --dry-run` writes nothing; `docs` names pages by title when two titles share a component file (stable
  whatever Storybook's index order) and finds importers by the file's name; the docs index pluralises "1 story".
- **Adopt by hand:** none.

## 0.3.0

- **Core:** a tall story is shown whole by growing the viewport (not Playwright's `fullPage`, which stretched fixed
  elements and broke crops after a scrolling `play()`); the atlas fails on images that loaded with no pixels; the atlas
  server is only reused when `UI_REUSE_SERVER` is set; capture rows with `fullPage` grow the viewport; empty page folders
  are pruned.
- **CLI:** `docs` groups by story title with unique names, adopts an existing inventory's casing and deletes generated
  pages/images it no longer produces; `sync` stamps the version; `audit` understands path-keyed exemptions.
- **Adopt by hand:** in your app `playwright.config.ts` use `reuseExistingServer: Boolean(process.env.UI_REUSE_SERVER)`.

## 0.2.0

- **Core:** no raw NUL bytes in `validators.ts` (git treated it as binary); optional `beforeCapture(page)` export in
  `app.drivers.ts`; per-row `fullPage`; `net::ERR_ABORTED` is not a failed request; stale screenshot folders are pruned;
  the atlas emulates `prefers-color-scheme`, honours `UI_ATLAS_THEMES`; Chromium partial raster disabled.
- **Adopt by hand:** `launchOptions: { args: ['--disable-partial-raster'] }` and a `UI_APP_PORT` env in your app
  `playwright.config.ts`; a full-height wrapper in `.storybook/preview.tsx`; your own web fonts in `preview-head.html`.

## 0.1.0

First extraction from `shared/ui`.
