# 0065. Aria snapshots pin the role trees of the dialogs, the slide-over and the navigation

- **Status:** Accepted
- **Date:** 2026-09-21
- **Deciders:** the owner

## Context and problem

The Base UI stack ([ADR 0047](0047-the-ui-primitives-wrap-base-ui-and-app-code-never-imports-it.md) to [ADR 0058](0058-heading-has-a-level-and-panel-names-its-region-with-a-level-2-title.md)) made the dialogs, the slide-over and the navigation drawer real modals with roles, names and an inert page behind them. Nothing pinned that: the atlas checks keyboard behaviour in `play()` and axe checks for violations, but a dialog that stopped being an `alertdialog`, lost its name or its Close button, or stopped hiding the page behind it would pass both. The verification tooling PRD planned aria snapshots for this once the trees had settled, sequenced after the dialog and drawer work and the Playwright traces (owner decision D22, question 9).

## Decision drivers

- Nothing pinned the modals' roles, names and inert page: the atlas `play()` checks and axe would both pass a dialog that lost its role, name or Close button, or stopped hiding the page.
- The owner's decision D22 (question 9): aria snapshots once the trees had settled, after the dialog and drawer work and the Playwright traces.
- How a state is reached should live in one place (the visual suite's drivers).

## Considered options

1. A separate Playwright aria-snapshot run (`tests/aria/`) that compares role trees with `toMatchAriaSnapshot`
2. Make the snapshots part of the visual suite
3. Keep the status quo: rely on the atlas `play()` checks and axe

## Decision outcome

**Chosen option: a separate Playwright aria-snapshot run (`tests/aria/`) that compares role trees with `toMatchAriaSnapshot`**, because the atlas and axe would both pass a dialog that lost its role, name or Close button or stopped hiding the page, and the visual suite is one screenshot per catalog state at three fixed viewports, which a snapshot is not.

**A second Playwright run, `tests/aria/`, with its own config `apps/ui/playwright.aria.config.ts`,** compares role trees with `toMatchAriaSnapshot`. It is not part of the visual suite: that suite is one screenshot per catalog state at three fixed viewports (ADR 0023, [ADR 0037](0037-visual-suite-captures-no-phone-viewport.md)) and a snapshot is neither. The aria run reuses the visual suite's drivers (`APP_DRIVERS`, so how a state is reached lives in one place) and the same production mock build, on port 4174 (the visual suite uses 4173), with a build folder of its own (so a visual run and an aria run never wipe each other's bundle), no retries, `trace: 'retain-on-failure'`, and comparison-only on CI (`updateSnapshots: 'none'`, so a missing or renamed snapshot fails instead of being rewritten). Its `outputDir` is `test-results/aria`, so it does not empty the visual traces that the `ui-visual` job uploads. It runs as `pnpm --dir apps/ui run aria` (Nx target `aria`), as an extra step of the `ui-visual` job after the screenshots, and it may open the navigation drawer at 390 px because it is not held to the visual matrix.

**What is pinned** (snapshots in `tests/aria/snapshots/*.aria.yml`, hand-trimmed and commented):

- Each modal, snapshotted from `<body>` with `/children: equal` at the root: while it is open the rest of the page is `aria-hidden`, so the dialog is the only thing in the tree. One snapshot therefore pins the role (`alertdialog` for the three confirms, `dialog` for the add-note form, the slide-over and the drawer), the name, the heading level, the controls and that nothing else is in the accessibility tree (it says nothing about `inert`, the focus trap or pointer blocking, which the atlas covers). A canary test removes the hiding and expects the same snapshot to stop matching, so the mechanism is proven to fail and not only to pass. The confirms are Story Bible's delete entry, the manuscript import and the unsaved settings; the others are the Manuscript add-note dialog, the chapters slide-over and the navigation drawer at 390 px.
- The navigation lists in all three shapes (sidebar, icon rail, drawer) with `/children: equal` on the list, so a page added, removed or reordered fails.
- The info icon (a button that is `[expanded]` while its hint shows) and the tooltip.

Beyond those two `children: equal` uses (the root of a modal's snapshot and the item lists of the navigation), everything is matched partially, which is Playwright's default: what a snapshot lists must be there in order and extra nodes are fine, so a copy change to a paragraph or an added chapter button does not fail but a lost role, name, heading or button does. Expressions are regular expressions where text is data (the file name, a paragraph count).

**Updating.** `pnpm --dir apps/ui run aria --update-snapshots` (pnpm passes arguments after the script name through; a `--` would reach Playwright as a literal) rewrites the files with the full tree; trim them back to what matters and read the diff, because a changed tree is a changed screen-reader experience.

**Not pinned:** the `WorkDialog` (the mock completes a job at once, so no driver reaches it; its atlas stories carry the `play()` checks), keyboard behaviour (Escape, the Tab trap, focus return: the atlas), and what a screen reader says, which no tree proves. The NVDA pass stays with the owner.

### Consequences

- **Good:** A dialog that drops its role or name, a confirm that stops being an alert dialog, a modal that stops hiding the page, or a navigation list that changes fails a named test with the tree diff.
- **Neutral:** Measured on one Windows machine (the CI run on Linux is the real check, and this ADR is not proof that two systems agree): the 9 snapshot tests and the canary pass 200 of 200 over 20 repeats and 50 of 50 at four workers, and take about 10 s with the build. Failures leave a trace.
- **Neutral:** The trees record what ships, including a gap the suite found: the icon rail has no `navigation` landmark and the sidebar's and the drawer's are unnamed (#159). The rail snapshot says so and changes with the fix.
- **Neutral:** A new dialog or drawer gets a state in `app.drivers.ts` (the visual suite needs it anyway) and one entry in `tests/aria/dialogs.spec.ts`.
- **Neutral:** To pin more (every popover, the tab strips), add a test and a snapshot; to drop the suite or move to inline snapshots, write a new ADR that supersedes this one.

### Confirmation

A canary test removes the hiding and expects the same snapshot to stop matching, so the mechanism is proven to fail and not only to pass. On CI the run is comparison-only (`updateSnapshots: 'none'`), so a missing or renamed snapshot fails, and it runs as a step of the `ui-visual` job.

## Pros and cons of the options

### Make the snapshots part of the visual suite

- Bad, because that suite is one screenshot per catalog state at three fixed viewports (ADR 0023, ADR 0037) and a snapshot is neither.

### Keep the status quo: the atlas `play()` checks and axe

- Bad, because a dialog that stopped being an `alertdialog`, lost its name or its Close button, or stopped hiding the page behind it would pass both.
