---
name: ui-visual-review
description: Use after a capture run (app visual suite or atlas) to look at every screenshot at every viewport and theme, decide whether each is a real defect, and record an approve or reject verdict backed by what was seen.
---

# ui-visual-review

## Why this exists

The capture suites are gates on what a machine can prove: page errors, failed requests, sideways overflow, blank
images, byte-identical duplicates, axe violations, a throwing `play()`. They cannot say a layout looks right, and they
are deliberately not pixel-diff gates. A green run therefore means "nothing mechanical broke", not "the UI is
correct". This skill is the human-grade check that closes that gap, and it only counts if the images were actually
opened. Reviewing one viewport, or trusting the pass count, is how a clipped label at 390px ships.

## When to use this

- After `ui-atlas-gate` reaches the "look at the screenshots" step.
- After any change to a component, a page, `styles.css`, a theme token, a story, or a driver.
- When a reviewer (or the `ui-visual-reviewer` agent) is asked to judge captures independently of the author.

## What to do

1. Locate the captures for the states you changed. Paths (relative to the UI root):
   - App suite: `screenshots/app/<page>/<state>/<viewport>.png`, viewports `desktop` 1440x900, `small-desktop`
     1024x768, `tablet` 768x1024, `mobile` 390x844 (`tests/visual/viewports.ts`).
   - Atlas: `screenshots/atlas/<component-slug>/<story-slug>--<theme>-<viewport>.png`, themes `light` and `dark`,
     viewports `wide` 1024x640 and `narrow` 390x640 (`tests/atlas/atlas.spec.ts`).
   To re-capture one state: `npx playwright test tests/visual/app.spec.ts -g "<page> / <state>"` (app) or
   `npx playwright test -c playwright.atlas.config.ts -g "<Title> / <Story>"` (atlas, after `pnpm atlas` built
   `storybook-static`).
2. Read the intent first: the row's `description` in `tests/visual/state-catalog.ts`, or the story's name and its
   comments. You are judging the picture against that sentence, not against your taste.
3. Open EVERY image for the state with the Read tool: all four app viewports, or all four atlas theme/viewport
   combinations. Never sample one and infer the rest; responsive bugs reproduce at one breakpoint only.
4. For each image run this checklist and write down the answer, even when it is "fine":
   - Overflow: any horizontal scrollbar, content running off the right edge, a card wider than the frame.
   - Clipped or overlapped text: truncated labels, text over another element, ellipsis where the meaning is lost.
   - Touch targets (tablet and mobile): controls visibly smaller than roughly 24x24 CSS px (WCAG 2.2 minimum), or
     cramped enough that two targets touch.
   - Focus ring: if the state is meant to show focus or hover (`pointer: 'keep'`, a `play()` that focuses), the ring
     must be visible and not clipped by a parent.
   - Dark theme: text against its background, disabled and muted text, borders that vanish, icons that stay dark.
   - Empty or blank canvas: a state that shows only a shell, a spinner, an error display, or the same picture as its
     sibling. Compare against the description: does it show the thing it claims to?
5. Classify each finding. A defect is reproducible layout, text, colour or state content that contradicts the
   description. Not a defect: one-pixel edge shimmer, sub-pixel text weight differences, font smoothing, a caret or
   animation frame. Re-run the single state twice; if the images are visually identical and only bytes differ, it is
   anti-aliasing noise (`ui-capture-contract` covers real nondeterminism, and the `ui-flake-doctor` agent locates it).
6. Verdict per state: APPROVE (every image checked, nothing found), or REJECT with the file path, viewport/theme, and
   the observation. Fix the UI or the driver and repeat from step 1. Do not add a `sameAs`, `undriven`, or a11y-debt
   entry to make a rejected state pass unless there is a real reason, written down.
7. Report the evidence: number of images opened, per state the viewports covered, defects found and fixed. "Looks
   good" without a count is not evidence.
8. Baselines: this kit's suites do not compare against stored pixels. If a consuming repo adds pixel baselines,
   `--update-snapshots` may only run inside the pinned Linux container CI uses (Playwright image tag matching the
   installed `@playwright/test` version), never on a developer machine, and the updated images are reviewed like any
   other change.

## What this skill is not

It is not the test runner (`ui-atlas-gate` orders the commands) and not a flake diagnosis (`ui-flake-doctor` and the
`ui-capture-contract` skill). It does not decide accessibility policy: axe results and recorded debt are handled
in the atlas spec and `tests/atlas/a11y-debt.ts`. It never approves a state whose images were not all opened.
