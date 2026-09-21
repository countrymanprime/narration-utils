# Settings Mobile Layout

**Supersedes:** `docs/design/known-ui-defects.md` (defect 8 [medium]; the file's last revision is `b613933`, recover it with `git show b613933:docs/design/known-ui-defects.md`)

## Reconciliation with the implementation plan (stack S12b, issue #143)

Applied by the first pull request of the stack, so the text below is read with these corrections ([implementation plan](implementation-plan.md) sections 1 and 3).

- **Paths and primitives.** The UI lives in `apps/ui` (layout stack, [ADR 0040](../adr/0040-the-repository-is-laid-out-by-role-and-each-project-is-an-nx-project.md)) and every control in a Settings row is now a wrapped primitive (`TextField`, `Select`; D1, [ADR 0053](../adr/0053-icon-buttons-text-fields-and-selects-wrap-the-native-controls.md)), and the info icon is a real button (D6, [ADR 0049](../adr/0049-hints-are-base-ui-tooltips-that-meet-wcag-1-4-13-and-info-icons-are-buttons.md)). The `TooltipTarget` wrapper of the select takes a `className`, so no primitive changes.
- **Viewports.** [ADR 0037](../adr/0037-visual-suite-captures-no-phone-viewport.md) removed the 390 px viewport, so the suite captures desktop (1440), small-desktop (1024) and tablet (768), 222 tests, and the desktop shell cannot go below 960 px wide. The bug is still real (below 768 px, and at a high browser zoom, WCAG 1.4.10 Reflow), so Phase 1 was verified with a scratch run at 390 px and Phase 2 records how the check reaches that width (see its Decisions Log row). Every "four viewports" and "300 captures" below means the captured viewports plus 390 px.
- **Boolean kind (D8).** Notifications and Build Story Bible after import default to on and need a Switch. The `bool` Settings kind is delivered as its own small pull request in this stack, before Phase 2; the check exempts checkboxes and switches by type (Q2).
- **`settings/reset-override`.** S10b declared it `sameAs` `settings/project-proofing` because the mock had no project override. It is a real state now: the driver saves one override and shows Reset on that row. Getting there exposed that Save sent every field of the category (unset ones as empty strings, which the host rejects), fixed first in its own pull request.
- **Open questions.** Every question adopts its recommendation (D22); see the ticked list and the Decisions Log.

## Problem Statement

On narrow widths (390px) every Settings row that has a select or a colour input renders its control as a blank sliver: the model and chunk-length selects are about 45px wide and the colour swatch and hex input are squeezed to nothing, so a narrator with a narrow app window (for example tiled beside REAPER) cannot read or change the setting. The visual suite that exists to catch layout bugs did not flag it because it only measures page-level sideways overflow, and other in-flight work that adds Settings fields inherits the same broken row.

## Evidence

Verified against `b9d348d` and re-checked at `d5cc994` (main after #42): `ScopedSetting.tsx`, `Settings.tsx`, `Tooltip.tsx`, the visual suite and the kit's code are unchanged; the only `apps/ui` changes since are the docs-guide tests. The retired defects register rated this medium (scale: high blocks a user or fails a standard outright, medium degrades an experience, low is polish or hygiene).

- **Cause confirmed in `settings/ScopedSetting.tsx`.** Each row is `grid grid-cols-[minmax(12rem,16rem)_minmax(0,1fr)] items-start gap-5` with no breakpoint. Arithmetic at 390px: viewport 390, minus `AppShell` content padding `p-4` (2 x 16), minus the card border (2), minus the card body padding `p-[1.1rem]` (2 x 17.6) leaves 320.8px; minus the 20px gap leaves 300.8px. CSS grid maximizes the fixed-range first track (up to 16rem = 256px) before a flexible `1fr` track receives anything, so the control column gets 300.8 - 256 = **44.8px**. The colour swatch alone is `size-[2.35rem]` (37.6px) plus a 9.6px gap, so the hex input gets roughly 0.
- **Reproduce (from the retired register):** run `pnpm --dir apps/ui screenshots`, then open `apps/ui/screenshots/app/settings/global-proofing/mobile.png`, or resize any Settings category to 390px. **Screenshot evidence.** That PNG (gitignored scratch from an earlier local run) shows exactly this: two empty ~45px select boxes and, for each marker colour, a thin bar and an empty box. No other Settings row layout at that width looks broken (the local Whisper models card and the category rail render fine; the category rail scrolls horizontally by design).
- **Secondary, at tablet** (`tablet.png`, 768px): the two-column layout applies (`md` = 768px) and the controls are usable, but the select widths differ (`small` vs `1m`) because the select sits in a `TooltipTarget` wrapper (`inline-flex`, auto width) so `w-full` resolves against shrink-to-fit. Cosmetic, fixed by the same change.
- **Suite gap.** `tests/visual/lib/capture.ts` (vendored from the kit) fails on page errors, failed requests, `documentElement.scrollWidth - clientWidth > 1`, blank screenshots and undeclared duplicates. Collapsed controls do not overflow (they shrink), so nothing measures per-control geometry. The state `settings/global-proofing` at mobile shows the bug but only a human reading the PNG sees it, exactly as the retired register said. Confirmed defect 8.
- **Ownership of the suite files.** `app.spec.ts`, `lib/capture.ts`, `lib/validators.ts`, `global-setup.ts`, `helpers/settle.ts` carry "ui-atlas-kit 0.3.1 vendored: do not edit here"; the change belongs in `tools/ui-atlas-kit/plugin/templates/core/tests/visual/` followed by `ui-atlas sync` (which needs a kit version bump, a `CHANGELOG.md` entry, and passes the kit's drift test in CI job `ui-atlas-kit`). `app.drivers.ts`, `state-catalog.ts`, `viewports.ts` are project-owned.
- **Calibration data.** The app has 12 `<input>` and 6 `<select>` elements in non-story components, and a same-line grep found none with a small fixed `w-`/`size-` class (multi-line class attributes were not checked). A threshold near 64px is unlikely to false-positive on current controls, but the exact value is TBD - needs one calibration run of the suite on the fixed layout.
- **Other work is exposed.** `teleprompter-engines-and-input-devices.prd.md` (new Settings fields) already cites defect 8; `diagnostics-delivery-and-cleanup-tools.prd.md` adds a numeric settings kind. Both edit `Settings.tsx`/`ScopedSetting.tsx`.
- Assumption - needs validation: narrators actually use narrow windows (the responsive layout and mobile nav drawer suggest it is a supported case; no usage data).

## Proposed Solution

Make the Settings row responsive: below the `md` breakpoint stack the label above the control (one column), keep today's two-column grid from `md` up; give controls `min-w-0 w-full` and the select's `TooltipTarget` wrapper `w-full`, let the colour row wrap, and place "Reset" predictably. Then add a suite check that fails when a visible text-like control is narrower than a minimum, so this class of bug is caught by the gate rather than by a reviewer's eye, and sweep whatever else it finds.

## Key Hypothesis

We believe stacking Settings rows below `md` and adding a control-width check to the visual suite will make every Settings control usable at 390px and prevent recurrence, for narrators on narrow windows and for developers adding fields. We'll know we're right when every select and text/hex input in every Settings category is at least 200px wide at 390px (about 45px today), the new check fails on the pre-fix commit and passes on the fix, all four viewports have been viewed as PNGs, and defect 8 is closed (Phase 1 `complete`).

## What We're NOT Building

- A redesign of Settings, its categories or the category rail - layout of one row only.
- New Settings fields (owned by the teleprompter-engines and diagnostics PRDs).
- Pixel baselines or a general layout linter - only a per-control minimum-width check.
- Changes to `Tooltip.tsx` or other primitives - the row uses the existing `className` prop.
- Changes to the Settings page grid or category rail (`grid-cols-1 md:grid-cols-[13rem_minmax(0,1fr)]` already works).

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Control width at 390px | Every select and text/hex input >= 200px in all Settings categories (was ~45px) | New suite check plus PNG review of every Settings state |
| Regression guard | The new check fails on the parent commit of the fix and passes after | Run once against the pre-fix commit; recorded in the PR |
| Other viewports unchanged | No visual diff at desktop, small-desktop, tablet except uniform select width | PNG review at all four viewports |
| Suite health | No new false positives across all 300 captures | One full local suite run plus CI `ui-visual` |
| Kit integrity | Vendored files match the kit; `ui-atlas-kit` CI job green | `node --test tools/ui-atlas-kit/test/*.test.mjs` |
| Defect closed | Defect 8 closed: Phase 1 marked `complete` in this PRD | Review |

## Open Questions

- [x] **1. Where does the assertion live?** Options: (a) generic check in the kit core `capture.ts`/`validators.ts` (every repo using the kit gets it; needs kit 0.3.2, `ui-atlas sync`, changelog, unit tests in `src/visualSuite.test.ts`); (b) a project-local hook (new optional `afterDrive` export in `app.drivers.ts`, like `beforeCapture`); (c) a Settings-only assertion in the Settings drivers. Recommendation: (a) with a per-row opt-out in `state-catalog.ts` carrying a required reason, mirroring `sameAs`/`undriven`. Note it extends ADR 0023's contract, so record it in a short ADR (amends 0023) via `adr-author`. **Answered:** (a), generic check in the kit core with a reasoned per-row opt-out (Phase 2; kit 0.3.3, because S07 already released 0.3.2), and an ADR amending 0023.
- [x] **2. Threshold and scope.** Options: text-like controls (`input` except color/checkbox/radio/range/file/hidden, `select`, `textarea`) at >= 64px; or a fraction of the container; or >= 96px. Recommendation: 64px flat, calibrated by one suite run on the fixed layout that logs the minimum observed width per capture; colour swatches and checkboxes are exempt by type. **Answered:** 64 px flat; text-like controls only, colour swatches, checkboxes and switches exempt by type; calibrated by one logged suite run in Phase 2.
- [x] **3. Mobile layout.** Options: (a) stack label above control below `md`; (b) keep two columns but shrink the label column to `minmax(8rem,10rem)` (control about 150px at 390); (c) move controls to a per-row disclosure. Recommendation: (a): labels carry a tooltip icon and wrap poorly in a narrow column, and `md` is already the app's layout breakpoint. **Answered:** (a), with one refinement found by looking at the tablet PNG: from `md` to `lg` the label column is a fixed 12rem (the category list stands beside the panel, so the control got 127 px and a spaCy model name was clipped), and it may grow to 16rem from `lg`.
- [x] **4. Control width on wider screens.** Options: fill the column; fill up to `max-w-md`; keep shrink-to-fit. Recommendation: fill up to `max-w-md` so `small` and `1m` selects match at tablet. **Answered:** fill up to `max-w-md` (28rem), so every select is the same width from `md` up.
- [x] **5. "Reset" placement when stacked.** Options: inline right (wraps under the control when tight); always below the control right-aligned. Recommendation: `flex-wrap` on the control row so Reset drops below only when needed. **Answered:** `flex-wrap` on the control row, and the control has a 10rem flex basis, so Reset shares the line and drops under the control only when there is no room (it does at tablet width).
- [x] **6. Sequencing against other Settings PRDs.** Options: land Phase 1 before their Settings work; or let them rebase. Recommendation: land Phase 1 first (small, no dependencies) and tell the other PRDs' owners; it removes a known visual defect from their screenshots. **Answered:** moot: the teleprompter and diagnostics Settings phases run later in the train (S21, S22), so they inherit the fixed row.
- [x] **7. Sweep scope.** Options: fix only what the new check flags on Settings; or everything it flags app-wide in Phase 3. Recommendation: app-wide but bounded by the check's output; anything that needs design input is filed as a GitHub bug issue (`area:ui`, see `docs/operations/github-workflow.md`) instead of fixed here. **Answered:** app-wide but bounded by the check's output; anything that needs design input is filed as an `area:ui` issue.

## Users & Context

**Primary User**
- **Who**: a narrator on a narrow window (tiled beside REAPER, or a small display) using Settings; secondarily any developer adding a field to Settings.
- **Current behavior**: opens Settings, sees empty boxes instead of the model, chunk length and marker colours, and cannot tell what is set or change it.
- **Trigger**: opening any Settings category with a select or colour field below 768px wide.
- **Success state**: each row shows its label with the control full width beneath it, readable and operable.

**Job to Be Done**: When I open Settings in a narrow window, I want to read and change every value without widening the window.

**Non-Users**: wide-window users see the current two-column layout unchanged (except uniform select widths).

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability |
| --- | --- |
| Must | Stacked label-over-control layout below `md`; two-column unchanged from `md` |
| Must | `min-w-0 w-full` controls; select wrapper `w-full`; colour swatch + hex input on one wrapping row |
| Must | Suite check for collapsed controls, unit-tested, proven red on the pre-fix commit |
| Should | Uniform control width at tablet (`max-w-md`); ADR amending 0023; per-row opt-out with reason |
| Could | Sweep of other collapsed controls the check finds |
| Won't (here) | Settings redesign; new fields; pixel baselines |

### MVP Scope

Phases 1 and 2. Phase 3 is the bounded sweep.

### User Flow

1. The narrator opens Settings > Proofing at 390px.
2. "Default Whisper model" appears with the select full width below it; "Misread marker color" shows the swatch and a readable hex field on one row.
3. They change the value and Save; nothing changes for wide layouts.
4. A future developer adds a field that collapses; the visual suite fails naming the control and its width.

## Technical Approach

**Feasibility**: HIGH for the layout (one component, class changes). MEDIUM for the assertion because it crosses the kit release process.

**Architecture Notes**
- Tailwind only, `var(--token)` classes (ADR 0009); state classes mutually exclusive (ADR 0017); no `styles.css` edit. Because no primitive or `styles.css` is touched, `design-spec-guard` is not triggered unless the change grows.
- Proposed row: `grid grid-cols-1 gap-2 md:grid-cols-[minmax(12rem,16rem)_minmax(0,1fr)] md:gap-5`; label `md:pt-2`; control wrapper `flex min-w-0 flex-wrap items-center gap-[0.6rem]`; the select's `TooltipTarget` gets `className="w-full min-w-0 md:max-w-md"`; text and hex inputs `min-w-0 w-full`.
- Check design: `capture.ts` runs a `page.evaluate` after the driver settles and before the screenshot, returning `{ label, type, width }` for each visible text-like control; a pure `findCollapsedControls(measurements, min)` in `validators.ts` (unit-tested in `visualSuite.test.ts`) turns them into problems added to the existing `problems` list, so a failure names the state, viewport and control. Per-row `minControlWidth`/allowlist override goes through `state-catalog.ts` types with a mandatory reason, like `sameAs`.
- Kit release: edit `plugin/templates/core/tests/visual/lib/*`, bump `plugin.json` and `ui-atlas.config.json` to the next patch version, add a `CHANGELOG.md` entry (mark "Adopt by hand: none"), run `ui-atlas sync`, keep the drift/dogfood tests green.
- Verification per CLAUDE.md "Visual bug fixes require screenshot verification": `cd apps/ui && npx playwright test tests/visual/app.spec.ts -g "settings.*"`, then open `screenshots/app/settings/<state>/<viewport>.png` for desktop, small-desktop, tablet and mobile for every Settings state (`global-general`, `global-manuscript`, `global-proofing`, `global-storybible`, `global-daw`, `global-tts`, `global-appearance`, `project-proofing`, `project-storybible`, `project-data`, `dirty-footer`, `navigate-away-confirm`, `reset-override`). `global-general`, `global-manuscript`, `global-appearance` and `project-data` are desktop doc images, so run doc-screenshot-sync only if they changed (they should not).

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Threshold false-positives on legitimate small controls | Medium | Exempt by type; calibration run; per-row opt-out with reason |
| Kit change collides with another kit release | Medium | Serialize kit releases with the test-stability PRD's kit phases |
| Stacked layout changes `dirty-footer` or Reset placement | Low | PNG review of those states at four viewports |
| The check fails on unrelated pages, blocking CI | Medium | Land the check only after Phase 3-style triage, or keep the sweep in the same PR as the check |
| Screenshots differ between local Windows and CI Linux | Low | The check reads geometry, not pixels |
| Merge conflicts with the teleprompter-engines and diagnostics PRDs in `Settings.tsx`/`ScopedSetting.tsx` | High | Land Phase 1 first (Q6) |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Responsive Settings row | Stack below `md`, `min-w-0 w-full` controls, select wrapper width, wrapping colour row, Reset placement; PNG review of all Settings states at 4 viewports; closes defect 8 | complete | No | - | - |
| 2 | Collapsed-control check | Kit core check + unit tests + optional per-row opt-out + ADR amending 0023 + kit version bump + `ui-atlas sync`; demonstrate red on the pre-fix commit | complete | No | 1 | - |
| 3 | Sweep | Fix or record whatever else the check flags across all states and viewports | pending | No | 2 | - |

### Phase Details

**Phase 1 - Responsive Settings row.** Goal: controls usable at 390px. Scope: `settings/ScopedSetting.tsx` (and `Settings.tsx` only if row wrappers need it). Success signal: at 390px every select and hex input is at least 200px in every Settings category; PNGs viewed at all four viewports; wide layouts unchanged apart from uniform select width; `pnpm check` green; Phase 1 marked `complete` (closes defect 8).

**Phase 2 - Collapsed-control check.** Goal: this bug class fails the gate. Scope: `tools/ui-atlas-kit/plugin/templates/core/tests/visual/lib/{capture,validators}.ts`, the state-catalog type for opt-outs, `plugin.json`/`ui-atlas.config.json` version, `CHANGELOG.md`, vendored copies via `ui-atlas sync`, `src/visualSuite.test.ts`, the ADR. Success signal: checking out the commit before Phase 1 and running `npx playwright test tests/visual -g "settings / global-proofing / mobile"` fails with the new message; on main it passes; the full suite passes on CI.

**Phase 3 - Sweep.** Goal: no other collapsed control ships unnoticed. Scope: whatever Phase 2's check reports on a full local run; each finding either fixed (with PNG review) or filed as a GitHub bug issue (`area:ui`) with severity, reproduction and the PNG path. Success signal: check passes on all 300 captures; any filed issues carry those fields.

### Parallelism Notes

Sequential by design: the check needs the fix to be green, and the sweep needs the check. Phase 1 has no dependencies and should merge first.

### Parallel-session compatibility

Files owned: `settings/ScopedSetting.tsx` (Phase 1), the row wrappers in `settings/Settings.tsx` (Phase 1, minimal), `tools/ui-atlas-kit/plugin/templates/core/tests/visual/lib/*`, `tools/ui-atlas-kit/CHANGELOG.md` and its version files, vendored `apps/ui/tests/visual/lib/*` and `apps/ui/ui-atlas.config.json` (Phase 2, via sync), `apps/ui/src/visualSuite.test.ts`, `apps/ui/tests/visual/state-catalog.ts` (only the opt-out type), the ADR, the Status cells of this PRD's phase table. Does NOT touch `styles.css` or any primitive.
- Can run concurrently with: the dialog PRD and the a11y-components PRD (disjoint), the test-stability PRD's Go and frontend-test phases.
- Do not run concurrently with: the test-stability PRD's kit phases (driver waits in the scaffold, axe on app states): both bump the kit version and edit `capture.ts`/scaffold, so serialize them or bundle one kit release; the teleprompter-engines and diagnostics PRDs' Settings phases (rebase; Phase 1 should merge first).
- Generated/shared files that always conflict: the kit version files and `CHANGELOG.md`, any regenerated vendored file.

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Tailwind utilities referencing tokens; no new legacy CSS (prior decision, ADR 0009) | Class changes only | New CSS | Guarded by `legacyCss.test.ts` |
| Mutually exclusive state classes (prior decision, ADR 0017) | Keep | Base + override | Stylesheet-order bugs |
| The suite is a gate on what it can prove; not a pixel-diff gate; no retries; `sameAs`/`undriven` escapes need a reason (prior decision, ADR 0023) | Add a geometry check with a reasoned opt-out | Pixel baselines | Same contract style |
| Visual fixes are verified by viewing PNGs at every viewport (prior decision, CLAUDE.md) | Required for Phases 1 and 3 | Code review only | A fix at one width is not verified |
| `apps/ui` is upstream of the kit; vendored files are not edited in place (prior decision, kit header) | Change kit core then sync | Edit vendored files | Avoids drift failure |
| Nothing merges without the user (prior decision, CLAUDE.md) | One PR per phase | - | - |
| Stack below `md`, keep two columns from `md` (Q3, D22) | Option (a) | Shrink label column; disclosure | Q3 |
| Between `md` and `lg` the label column is 12rem, from `lg` it is `minmax(12rem,16rem)` (Phase 1) | Two templates | One template from `md` | At 768 px the panel is about 490 px wide beside the category list; the 16rem label left the control 127 px and clipped "English - small (fast)". 191 px fits; 1024 px and up are unchanged |
| A control takes the free width up to `max-w-md` and wraps below 10rem; the hex box has a 4.5rem minimum (Phase 1) | `flex-[1_1_10rem]` on selects and text, `flex-[1_1_0%]` on the hex box | Fixed widths; `w-full` per control | Q4, Q5: Reset shares the line unless it cannot; the swatch and the hex box never separate |
| Save sends only the fields the narrator changed (its own pull request) | `changedValues` | Fix in the host | The host rejects an empty choice or colour, and an unset field is an empty string in the form |
| Generic check in the kit with a reasoned opt-out (Q1, D22; ADR 0060) | Option (a) | Project-local hook; Settings-only | Q1 |
| The check runs at the captured viewports plus a 390 px `reflow` viewport that only the 13 Settings rows opt into with `extraViewports` (Phase 2; Proposed ADR 0061, amends ADR 0037) | `REFLOW_VIEWPORT`, `clickNav` opens the drawer | Add `mobile` back to the whole matrix (ADR 0037 dropped it); check only at the three widths | At the three widths the pre-fix layout passes (127 px at tablet), so the check could not have caught its own bug; 13 more captures cost about 5 s |
| 64 px minimum, calibrated (Phase 2) | Narrowest control of a full run: 119 px (Home), 143.6 px (Settings, tablet), 273.6 px (Settings, reflow); collapsed layout 44.8 px and 26 px | 96 px; a fraction of the container | Q2: leaves 1.5 to 2.5 times either side |
| Class-contract tests of `ScopedSetting` removed (Phase 2) | The collapsed-control check proves the layout in a browser | Keep the jsdom class-string tests | A review found they pin strings, not layout, and stay green if the parent changes the width |

## Research Summary

**Market Context**: CSS Grid track sizing gives a fixed-range track precedence over a flexible track when free space is distributed, which is why a `minmax(12rem,16rem)` column starves an `1fr` column on narrow containers; the standard pattern is a single column below a breakpoint. WCAG 1.4.10 (Reflow) expects content usable at 320 CSS px without two-dimensional scrolling.

**Technical Context**: `ScopedSetting` renders three control kinds (colour, text, select) for every Settings category in both scopes; `TooltipTarget` (`primitives/Tooltip.tsx`) wraps the select; layout breakpoints are Tailwind defaults (`md` = 768px); viewports in `tests/visual/viewports.ts` are 1440, 1024, 768 and 390 wide; per CLAUDE.md run the workflow (plan, change-impact-scan for `ScopedSetting` consumers, TDD where testable, `pnpm check`, visual suite with PNG review at all four viewports, feature-cleanup); mark each phase `complete` in the same PR that lands it.

---

*Generated: 2026-09-19*
*Status: IN DELIVERY - stack S12b, issue #143*
