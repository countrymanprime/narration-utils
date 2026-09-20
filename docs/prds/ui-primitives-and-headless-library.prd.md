# UI Primitives and a Headless Library

**Reconciled 2026-09-20 (stack S10b, tracking issue #104):** the owner decided the library in [implementation-plan.md](implementation-plan.md) D1: **Base UI, wrapped in our own Tailwind primitives so every control is styled one way, and app code never imports it**. The foundation stack S10a delivered it ([ADR 0047](../adr/0047-the-ui-primitives-wrap-base-ui-and-app-code-never-imports-it.md) to [ADR 0052](../adr/0052-toggle-menu-checkbox-collapsible-and-switch-replace-the-hand-rolled-widgets.md)) and its PRD is deleted. Its Dialog family, Tooltip and info icon, Field, MeterBar, SlideOver, NavDrawer, Pill (a Base UI Toggle), Menu, Checkbox, Collapsible and Switch are done, so Phases 0, 2 and 3 below are moved and what remains is Phase 1 (wrapped natives), Phase 4 (what is left of menus and disclosure: Tabs, ToggleGroup, TagInput) and Phase 5 (Table). Where the text below says Radix, read Base UI: the Radix analysis stays only as the record of what was compared. The answers to L3 to L10 are ticked in Open Questions and recorded in the Decisions Log.

**Source:** user request of 2026-09-20 (item 25): "we need more primitives and slightly larger reusable components like a datatable or dropdown (with options). Native browser elements should probably all be wrapped. Can we look at bringing in something like Radix?" Citations are `file:line` on branch `claude/narration-utils-planning-00e3c8` at dc9d01a; npm and vendor facts were read on 2026-09-20 (sources marked). Nothing here is built yet. **This PRD reopens Q1 of [dialog-modality-and-workdialog-a11y.prd.md](dialog-modality-and-workdialog-a11y.prd.md), which recommends no library.** Several other PRDs need the primitives below: [manuscript-reader-search-and-controls.prd.md](manuscript-reader-search-and-controls.prd.md), [story-bible-entries-and-actions.prd.md](story-bible-entries-and-actions.prd.md), [proofing-vocabulary-hints.prd.md](proofing-vocabulary-hints.prd.md), [import-review-redesign.prd.md](import-review-redesign.prd.md).

## Problem Statement

The UI has only 14 primitives and none of them is a form control other than a text `Field`, so every page hand-rolls selects, checkboxes, menus, tabs, disclosures, tables, icon buttons and tag inputs from raw native elements, with inconsistent styling and uneven accessibility (no menu keyboard handling, keyboard-inert clickable rows, tooltips that dangle, modals that do not trap focus).

## Evidence

- **Primitive inventory** (`apps/ui/src/components/primitives/`): Button (variants primary/ghost/danger), Dialog (`role="dialog" aria-modal` but no Escape, focus or inert handling, `Dialog.tsx:21`), ConfirmDialog (`body: string`), WorkDialog, Field (`label, value, onChange, onBlur, disabled, textarea`; no error, hint or aria props), Pill (no `aria-pressed`), NavButton, Tooltip/TooltipTarget/TooltipProvider (custom portal at `z-[1000]`, 1000 ms hover, `Tooltip.tsx:57`), MeterBar, Panel, Heading, Highlight, SlideOver, ErrorBoundary. Only 4 have `.test.tsx` (ConfirmDialog, Pill, NavButton, Tooltip); the rest are covered by stories run as jsdom tests (`src/stories.test.tsx`). `docs/design/design-system.md:19-26` lists only 6 of the 14 (doc drift).
- **Raw native elements outside `primitives/`:** 57 `<button>` in 16 files (37 uses of `<Button>`), 11 `<input>` (one checkbox, one color, one `type="text"`, the rest untyped), 6 `<select>` (`Home.tsx:220,255`, `AudiobookEstimatePanel.tsx:188`, `TeleprompterPage.tsx:259`, `ScopedSetting.tsx:72`, `GuideDetail.tsx:687`), 1 `<textarea>` (`AddNoteDialog.tsx:28`), 5 `<table>` in 4 files (`AudiobookEstimatePanel.tsx:143`, `Results.tsx:96`, `Guide.tsx:210`, `GuideDetail.tsx:414,638`); no `window.confirm/alert`, `<dialog>` or `<details>`. One exact 32px icon-button class string is pasted 28 times outside primitives in 10 files (14 in `GuideDetail.tsx`), plus in `Dialog.tsx:30` and `SlideOver.tsx:35`; the input class string is duplicated in 11 places (`FIELD_CLASS` `TeleprompterPage.tsx:34`, `controlClass` `ScopedSetting.tsx:43`, inline copies). One native `title=` tooltip (`tracks/TracksPage.tsx:61`).
- **Components acting as primitives outside `primitives/`:** category menu, hand-built `role="menu"` (`GuideDetail.tsx:229-261`; closes only on item choice, no Escape, outside-click or arrow keys); alias combobox with listbox (`:465-556`); selection toolbar with its own positioning (`SelectionMenu.tsx:16-63`); Toast (`layout/Toast.tsx:5-27`, one string, 2.4 s); tabs built from buttons with no `role="tab"` (`Guide.tsx:172-180`, `Settings.tsx:145,157`); disclosure chevron (`AudiobookEstimatePanel.tsx:91-99`); vocabulary chips and input (`Transcript.tsx:319-367`); mobile nav drawer (`AppShell.tsx:111-126`); chip classes (`EntitySummary.tsx:18`). Clickable `<tr onClick>` rows are not keyboard-operable (`Guide.tsx:233`, `Results.tsx:113`), sort headers lack `aria-sort` (`Guide.tsx:213-229`), and Pill groups are labelled by `<label>` with no `htmlFor` or fieldset (`Transcript.tsx:258,275,293,315`).
- **Rules that shape any new primitive.** `atlasCoverage.test.ts:10-20`: `ATLAS_EXEMPT` is empty and every top-level `Name.tsx` in `primitives/` needs a `Name.stories.tsx` (so a helper file at that level demands a story, and a subfolder silently escapes the rule); `A11Y_DEBT` is capped at 4 (`:35`, `tests/atlas/a11y-debt.ts`); axe runs on stories in light and dark at 1024 and 390 px (`tests/atlas/atlas.spec.ts:26-31`); `PRIMITIVES_DIR` is set in `ui-atlas.config.json`; the atlas kit is vendored at v0.3.1 and `atlas.spec.ts` is marked "do not edit here". ADR 0003 is superseded by ADR 0009 (Tailwind utilities with `var(--token)`); ADR 0009 keeps `table.dtable` as a deliberate exception and says a future `Table` primitive would supersede only that part; ADR 0017 (mutually exclusive state classes, guarded by `legacyCss.test.ts`); ADR 0010 (`data-theme` on `<html>`); ADR 0016 (Highlight); ADR 0023 (Storybook and the atlas). `CLAUDE.md` step 5 triggers `design-spec-guard`. Global element rules style bare `select`, `input[type=text]` and `textarea` (`components.css:41-70`), which wrapping must move into Tailwind. Doc drift: ADR 0023 and `.storybook/main.ts:5` say Vitest 2; `package.json` has Vitest 4.
- **Overlapping PRDs.** Dialog PRD: modals declare `aria-modal` but Escape does nothing and focus is not moved, trapped or restored (`:7`); jsdom has no dialog API (`:21`; its claim that `vite.config.ts` has no `setupFiles` is stale, `vite.config.ts:16` loads `./src/test-setup.ts`); no focus-trap, Radix, react-aria or headlessui is installed (`:22`); a top-layer `<dialog>` would hide the body-level Tooltip (`:23,125`); "a new runtime dependency for one primitive" is under "NOT building" (`:43`); Q1 offers native `<dialog>`, hand-rolled, or a library (Radix Dialog, react-aria FocusScope) and recommends native with no library (`:61`); SlideOver and the nav drawer are out of scope (`:67`); WebKitGTK and WKWebView floors are TBD (`:126`). Tooltip/Field PRD (`component-a11y-meter-tooltip-field-heading-panel.prd.md`): the info icon becomes a real button, `useId` and `aria-describedby` on the focusable child, Escape dismissal, inline text (Q2, Q3, Q4, Q8); optional Field `hint`, `error`, `aria-invalid` at "Could"; migrating raw inputs to `Field` is "a separate refactor". No PRD plans a Select primitive (`import-review-redesign.prd.md:20` notes "`Field` has no select variant"). Palette PRD: no API changes. Other PRDs plan `Disclosure` (import-review I5), a Popover (chapter-stage Q11, recommends SlideOver), `Dialog size="full"` (teleprompter integration `:196`), and "primitives only where needed" (review dashboard `:23,196`); several edit `Dialog.tsx` and `Tooltip.tsx`.
- **Stack.** `apps/ui/package.json`: React and react-dom `^19.3.0`, react-router-dom `^7.18.4`, FontAwesome 7.3.1 and react-fontawesome `^3.5.0`; dev: Tailwind and `@tailwindcss/vite` `^4.3.3`, Vite `^8.3.0`, Vitest `^4.1.11`, jsdom `^30`, Testing Library react 16 and user-event 14, Storybook 10.6.0 with addon-a11y, Playwright 1.63; no headless UI library. `apps/ui/dist/assets` holds a 570,212-byte JS file and 41,742-byte CSS (build of Sep 19); no bundle-size gate exists. License policy (`docs/research/local-dependency-evaluation.md:75-85`) allows MIT, BSD and Apache-2.0 with notices, but concerns local tools and models, not npm UI dependencies; `dependency-review.yml` is advisory (`fail-on-severity: high`). The UI is embedded by Wails (`apps/desktop/main.go:16,34`, `scripts/copy-wails-frontend.mjs`); Windows is WebView2; Linux and macOS builds are optional attach jobs.
- **Library facts** (npm metadata and vendor docs read 2026-09-20; secondary sources marked): the unified `radix-ui` package is 1.6.7 (MIT, last published 2026-07-31, peer React `^16.8 ... ^19.0`), also published as individual `@radix-ui/react-*` packages (dialog, select, dropdown-menu, tooltip, popover, checkbox, switch, collapsible, accordion, tabs, scroll-area, toast, slider, toggle, toggle-group, alert-dialog, radio-group, progress, toolbar, visually-hidden), tree-shakable, with React 19 compatibility ([releases](https://www.radix-ui.com/primitives/docs/overview/releases)). There is no Radix combobox or autocomplete (npm E404). Radix Themes is pre-styled and would fight the token system. Radix Dialog is not a native `<dialog>`: focus is trapped, Esc closes, the rest is inert, `Portal` defaults to `document.body` with a `container` prop ([docs](https://www.radix-ui.com/primitives/docs/components/dialog)); Select renders a hidden native select for forms and exposes `data-state`, `data-highlighted` and CSS variables ([docs](https://www.radix-ui.com/primitives/docs/components/select)); Tooltip opens on focus, closes on Escape, default delay 700 ms ([docs](https://www.radix-ui.com/primitives/docs/components/tooltip)). Tailwind 4 supports `data-[state=open]:` variants ([docs](https://tailwindcss.com/docs/hover-focus-and-other-states)), compatible with ADR 0017 because state is a data attribute. `data-theme` is on `<html>`, so CSS variables cascade into body-level portals; `TooltipProvider` (`App.tsx:183`) and the Storybook decorator already have the shape of `Tooltip.Provider`. MDN: a `showModal()` dialog sits in the top layer above any non-top-layer content regardless of z-index, so with a native `<dialog>` every Radix Select, Menu, Popover and Tooltip opened inside it would render behind it unless portaled into the dialog element ([MDN](https://developer.mozilla.org/en-US/docs/Glossary/Top_layer)). Alternatives (npm and vendor docs): Base UI (`@base-ui/react` 1.8.0, MIT, MUI-maintained, 40+ components, [docs](https://base-ui.com/react/overview/quick-start)); React Aria Components 1.21.1 (Apache-2.0, best a11y and i18n, about 6.6 MB unpacked, [styling](https://react-aria.adobe.com/styling)); Ark UI 5.39.2 (MIT, state machines); Headless UI 2.2.10 (MIT, thin set); shadcn/ui as a copy-paste pattern layer over Radix or Base UI (shadcn made Base UI its default in July 2026 and says Radix is not being deprecated, [changelog](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default)); TanStack Table 9.2.4 (MIT, headless, [docs](https://tanstack.com/table/latest)). A secondary source reports a slower Radix cadence after its acquisition, which contradicts the July 2026 npm publishes; treat as unverified.
- **Test and driver coupling.** `App.test.tsx:210` and `AudiobookEstimatePanel.test.tsx:69` do `fireEvent.change` on a native select; `tests/visual/app.drivers.ts:473-483` uses Playwright `selectOption`, which works only on a native `<select>`. Radix Select and menus open on `pointerdown` and keyboard, so `fireEvent.click` (used in `Pill.test.tsx`, `Tooltip.test.tsx`) will not open them; portaled content is queried from `document.body`; community write-ups list jsdom gaps needing shims (`ResizeObserver`, pointer-capture methods, `scrollIntoView`, `matchMedia`, `DOMRect`), to be confirmed in a spike (secondary). `Tooltip.test.tsx` asserts `id === 'tooltip-layer'` and a 1000 ms delay.

## Proposed Solution

Own the primitive API and hide the library (Base UI) behind it:

1. **Wrap natives first, zero dependencies:** `IconButton`, `TextField`, `SearchField` (with clear), `Select`, `Checkbox`, `Textarea`, and a presentational `Table`, keeping native `<select>`, `<input>`, `<textarea>` under the hood so existing `fireEvent.change` and Playwright `selectOption` keep working.
2. **Behavior-heavy pieces come from Base UI** (`@base-ui/react`): Dialog family, Tooltip, Menu, Popover, Collapsible, Switch (delivered by S10a) and Tabs (Phase 4). Call sites never import the library; `baseUiBoundary.test.ts` enforces that (ADR 0047).
3. **Custom where the library has no clean answer:** the alias combobox stays bespoke (S10a, ADR 0052) and the tag input is a wrapped input plus chips.
4. **The Dialog mechanism is decided and built** (Base UI Dialog, ADR 0048), so no top-layer clash is left to design around.

The wrapper layer keeps a later swap of the library to the `primitives/` folder alone.

## Key Hypothesis

We believe a small in-house primitive set (natives wrapped, behavior from Base UI) will give consistent styling and accessible behavior while removing about 30 pasted class strings and the hand-built menus. We'll know we're right when no page imports the library or renders a raw `select`, `input`, `textarea`, `table` or icon `button` outside `primitives/`, axe stays clean in the atlas, and every primitive has stories.

## What We're NOT Building

- Any pre-styled component layer, or a second styling system beside Tailwind tokens (ADR 0009).
- A general design-system rewrite or new visual design; primitives adopt the existing tokens.
- TanStack Table now (only when sort, filter or selection needs multiply beyond the presentational `Table`).
- Native `<dialog>` (Base UI Dialog was chosen), a general `Popover` primitive with no caller (the info icon already is a Base UI Popover inside `Tooltip`), and a Base UI `Select` (L3: native-wrapped).
- A CI bundle-size gate (L4: the budget is a documented number, not a gate).

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Raw natives outside `primitives/` | `<select>`, `<input>`, `<textarea>`, `<table>` and the pasted icon-button look reach 0; the remaining raw `<button>` count only goes down | `rawNatives.test.ts`, a Vitest scan with a per-file ceiling ([ADR 0053](../adr/0053-icon-buttons-text-fields-and-selects-wrap-the-native-controls.md)), in the pattern of `baseUiBoundary.test.ts` |
| Library imports outside `primitives/` | 0 | `baseUiBoundary.test.ts` (delivered by S10a, ADR 0047) |
| Stories | Every new primitive has a `.stories.tsx` with a `play()`; `A11Y_DEBT` does not grow | `atlasCoverage.test.ts`, atlas axe |
| Existing tests | `fireEvent.change` and `selectOption` on wrapped selects still pass unchanged | `pnpm check`, visual suite |
| Keyboard | Menu, Select, Tabs and Dialog operable with keyboard only; Escape and focus return work | Storybook `play()` plus `userEvent` tests |
| Bundle | Under the 800,000-byte raw budget S10a recorded (L4); each PR records the size | `pnpm --dir apps/ui build` output |
| jsdom | Base UI components render and open in Vitest with no polyfill (proved by S10a) | `stories.test.tsx` runs all stories |
| Visual | No sideways overflow; open menus and selects visible and not clipped at four viewports | Playwright suite, atlas |

## Open Questions

- [x] **L1 - RESOLVED 2026-09-20 (owner decision): a library Dialog, Base UI, behind our `Dialog` wrapper; supersedes the dialog PRD's "no library" recommendation (delivered by foundation Phase 2).** Original question: does this reopen the dialog PRD's Q1? Options: (a) Radix Dialog (consistent behavior in jsdom and Chromium, portals just work); (b) native `<dialog>`, with every Radix layer opened inside it portaled to the dialog element; (c) hand-rolled. Recommendation: (a), superseding the dialog PRD's "no library" recommendation. This needs the owner's decision first.
- [x] **L2 - RESOLVED 2026-09-20 (owner decision): Base UI, wrapped in our own primitives, styled with Tailwind; Radix and React Aria not adopted.** Original question, which library? Radix (`radix-ui`, best-known Dialog, Menu, Tooltip, Popover, Tabs, Collapsible; data-attribute styling suits Tailwind 4; no combobox) versus Base UI (younger, MUI-maintained, reportedly has Combobox and Autocomplete) versus React Aria Components (heaviest, best a11y). Recommendation: Radix, Base UI as the fallback behind the wrapper.
- [x] **L3. Select strategy - RESOLVED 2026-09-20 (owner, plan D22): native-wrapped.** A `Select` around the native `<select>` keeps `fireEvent.change` and Playwright `selectOption`, the platform pickers and forms working (S10a question 5 kept the six selects native for the same reason). A Base UI `Select` is not built.
- [x] **L4. Bundle budget - RESOLVED 2026-09-20 (owner: use the number S10a recorded).** 800,000 bytes raw for `dist/assets/index-*.js` (S10a measured 787,619 with every wrapper in it). It is a documented budget in `docs/design/design-system.md`, not a CI gate; a change that takes the bundle past it says why in its pull request, and each PR of this stack records the size.
- [x] **L5. Keyboard and screen-reader users - RESOLVED (plan D22, adopts the recommendation): accessibility is required regardless.** Every primitive here has a keyboard `play()` in its story and a role, name and state a screen reader announces.
- [x] **L6. License notice - RESOLVED (plan D22): nothing new to add.** This stack adds no npm dependency: `@base-ui/react` (MIT) is already a dependency and its licence is compatible with the project's AGPL-3.0-or-later ([ADR 0039](../adr/0039-the-project-is-licensed-agpl-3-or-later.md)); the MIT notice is retained by the package.
- [x] **L7. Tooltip behavior - RESOLVED and built (plan D6): 1000 ms stays.** Delivered by S10a ([ADR 0049](../adr/0049-hints-are-base-ui-tooltips-that-meet-wcag-1-4-13-and-info-icons-are-buttons.md)), which also meets WCAG 1.4.13 formally.
- [x] **L8. Table now - RESOLVED 2026-09-20 (owner): yes.** A presentational `Table` with row keyboard activation and `aria-sort` in Phase 5, superseding ADR 0009's `table.dtable` exception through a new ADR; TanStack Table stays a later option.
- [x] **L9. Ownership order with the Tooltip PRD - RESOLVED and built:** the Tooltip contract (button-based info icon, Escape, the hint text as the accessible description) is implemented on Base UI by S10a (ADR 0049).
- [x] **L10. Scope of "all native elements" - RESOLVED 2026-09-20 (owner): icon buttons and form controls only.** Text buttons already have `Button`. The raw `<button>` count is a ratchet, not a ban ([ADR 0053](../adr/0053-icon-buttons-text-fields-and-selects-wrap-the-native-controls.md)).

## Users & Context

**Primary User**: the maintainer and contributors building the UI, and indirectly every narrator (keyboard, screen-reader and touch behavior).
**Current behavior**: each feature pastes markup and classes, so new controls diverge and accessibility is uneven.
**Trigger**: any new select, menu, dropdown, table or tag input.
**Success state**: a feature composes primitives that already behave and look right.
**Job to Be Done**: When I build a screen, I want tested, accessible primitives, so I do not re-implement menus, selects and icon buttons.
**Non-Users**: narrators do not see this directly.

## Solution Detail

Candidate primitives, with the call sites that motivate each:

| Priority | Primitive | Motivating call sites | Phase |
| --- | --- | --- | --- |
| Must | `IconButton` (required label, optional tooltip, disabled and danger states) | 28 pasted copies in 10 files; Toast `layout/Toast.tsx:21`, `ChapterNav.tsx:92`, `Transcript.tsx:326` | 1 |
| Must | `Select` (native-wrapped) | The 6 selects | 1 |
| Must | `TextField`, `SearchField` (with clear), `Textarea`, `Checkbox` | 11 inputs; `Guide.tsx:188-205`, `SearchBar.tsx:7-15`; `Home.tsx:289` | 1 |
| Must | `Tooltip` on the library (contract from the Tooltip PRD) | 12 consumer files | 2 (delivered by S10a) |
| Must | Dialog family (Dialog, ConfirmDialog, WorkDialog, SlideOver optional) | Dialog PRD | 3 (delivered by S10a) |
| Should | `DropdownMenu` (built as `Menu`) | `GuideDetail.tsx:229-261` | 4 (delivered by S10a) |
| Should | `Disclosure/Collapsible` (delivered by S10a), `Tabs`, `ToggleGroup` (exclusive Pill groups), `Popover` (not built: no caller) | `AudiobookEstimatePanel.tsx:91-99`, import review; `Guide.tsx:172-180`, `Settings.tsx:145,157`; `Transcript.tsx:263-311`; `SelectionMenu.tsx` | 4 |
| Should | `Table` (presentational, keyboard rows, `aria-sort`) | The 5 tables; `Guide.tsx:233`, `Results.tsx:113` | 5 |
| Should | `TagInput` | `Transcript.tsx:319-367` | 4 |
| Could | `Switch` (delivered by S10a) | None today; planned settings boolean and "master switch" (`chapter-stage-recommendations.prd.md:212`) | 4 |
| Could | Custom `Combobox` (stays bespoke, S10a; its input is a `TextField`) | `GuideDetail.tsx:465-556`, relation picker `:687` | 5 |
| Could | `DataTable` on TanStack Table | Future sort/filter/selection needs | later |
| Won't | A pre-styled component layer, a second styling system | - | - |

**Migration strategy:** wrap, then replace call sites behind the same primitive API; add ESLint `no-restricted-imports` (library outside `primitives/`) and either `no-restricted-syntax` or a ratchet test for raw `select`, `input`, `textarea`, `table` and icon `button` outside `primitives/` (ESLint currently has no restriction rules, `eslint.config.js`).

## Technical Approach

**Feasibility**: HIGH for wrapped natives; MEDIUM for the library steps (jsdom shims, portal and top-layer decisions, atlas capture of open layers).

**Architecture notes**
- **Tests:** Base UI needs no jsdom polyfill (S10a); open and close tests use `userEvent`, and portaled content is queried from `document.body` (as `Tooltip.stories.tsx` does). A native-wrapped control keeps `fireEvent.change`.
- **Atlas:** `contentClip` and `fitViewportToContent` capture portaled open states but exclude fixed layers from height sizing, so an open menu near the bottom may be clipped; modal layers set `aria-hidden` on siblings and lock scroll, so re-check axe and screenshots. Each primitive needs a story per variant with `play()`, and `docs/ui/` regenerated (`node tools/ui-atlas-kit/plugin/cli/ui-atlas.mjs docs --dir apps/ui`).
- **Styling:** Tailwind utilities and `var(--token)` values, `data-[state=...]` variants, mutually exclusive state classes (ADR 0017); move the global `select`/`input`/`textarea` rules out of `components.css` as each wrapper lands (legacy CSS guard).
- **Sequencing rule for helper files:** a helper at the top level of `primitives/` needs its own story; place multi-part primitives in a subfolder only with an explicit atlas exemption decision.
- **ADRs and docs:** one ADR for the library choice and the wrapper rule, written once by foundation Phase 1 (next free number, 0039 at 155c275; it supersedes the "no library" line of the dialog PRD and the `table.dtable` exception of ADR 0009 when the Table lands); update `design-system.md` (also fixing the 6-of-14 drift); `design-spec-guard` on every primitive change.
- **Gates:** `change-impact-scan` (about 12 tooltip consumers, 10 files of icon buttons), the Playwright suite with PNG review at four viewports, `doc-screenshot-sync`.

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Dialog decision (native vs library) blocks or splits the work | Resolved | Base UI Dialog, ADR 0048 |
| Top-layer clash hides portaled layers if native `<dialog>` is chosen | Resolved | Base UI Dialog does not use the top layer (ADR 0047) |
| Base UI is 1.x with monthly minors | Low-Medium | The wrapper layer confines a breaking change to `primitives/` (ADR 0047) |
| Wrapped and library primitives change test semantics (`selectOption`, `fireEvent`) | Low | Native-wrapped selects; `userEvent` for library layers |
| Bundle growth | Low | 800,000-byte budget (L4); measured each PR |
| Many PRDs edit `Dialog.tsx`, `Tooltip.tsx`, `Field.tsx` | High | Sequence: this PRD's Phase 1-2 first or fold those PRDs' phases into it |
| Visual and doc-screenshot churn from replacing widespread controls | High | Land per primitive; `doc-screenshot-sync` per PR |
| Portaled layers clipped in atlas captures | Medium | Verify capture; adjust stories, not the vendored kit |
| jsdom shims fragile | Resolved | None needed (S10a) |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Decision and spike | **Absorbed.** L1 and L2 are decided (Base UI); the spike, bundle measurement and ADR are foundation Phase 1. L3 and L4 remain open | moved | - | - | - |
| 1 | Wrapped natives | **1a** `IconButton` and the sweep of the pasted icon-button look, plus the `rawNatives.test.ts` ratchet; **1b** `TextField`, `SearchField`, `Select` and `Field` (covers the textarea), the sweep, the global form CSS removed. `Checkbox` was delivered by S10a | complete: 1a and 1b ([ADR 0053](../adr/0053-icon-buttons-text-fields-and-selects-wrap-the-native-controls.md)) | - | 0 | - |
| 2 | Library setup and Tooltip | **Moved.** Delivered by foundation Phases 1 and 3 (Base UI dependency, jsdom shims, ESLint import rule, Tooltip and Field on the library) | moved | 1 | Foundation 1 | - |
| 3 | Dialog family | **Moved.** Delivered by foundation Phase 2 (Dialog, ConfirmDialog, WorkDialog) and Phase 4 (SlideOver, nav drawer) | moved | - | Foundation 1 | - |
| 4 | Menus and disclosure | `DropdownMenu` (`Menu`), `Disclosure` (`Collapsible`) and `Switch` were delivered by S10a; **4a** `Tabs` and `ToggleGroup`; **4b** `TagInput`. `Popover` is not built (no caller) | pending | 5 | 2 | - |
| 5 | Tables and combobox | Presentational `Table`, keyboard rows, `aria-sort`; supersede the ADR 0009 table exception. The alias combobox stays bespoke (S10a): only its input is wrapped | pending | 4 | 1 | - |

**Phase 0.** Goal: the decision and evidence. Scope: owner answers L1-L3, an ADR draft, a spike branch measuring shims and bundle. Success: a written decision.
**Phase 1.** Goal: no raw form controls or pasted icon buttons. Scope: primitives with stories and `play()`, call-site migration in slices, ratchet test. Success: counts drop; `selectOption` drivers unchanged; PNGs reviewed.
**Phase 2.** Goal: the library is available and enforced. Scope: dependency, shims, ESLint rule, Tooltip. Success: Tooltip contract of the Tooltip PRD met; stories pass in jsdom.
**Phase 3.** Goal: accessible modals. Success: Escape closes, focus moves in, is trapped and returns; tests for each.
**Phase 4.** Goal: replace hand-built menus and disclosure widgets. Success: category menu keyboard-operable; no dangling tooltip ids.
**Phase 5.** Goal: accessible tables and the alias picker. Success: rows keyboard-activatable; sorted headers announce sort.

**Parallelism Notes**: after S10a the remaining phases run in the order 1a, 1b, 4a, 4b, 5 as one stacked train, each branching from the last.

**Parallel-session compatibility**

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 0 | `docs/adr/`, `docs/prds/`, a scratch branch | ADR numbering |
| 1 | `components/primitives/*`, about 16 component files, `components.css`, `docs/design/design-system.md`, `docs/ui/`, catalog and drivers | Every UI PRD (all edit the same components); test-stability PRD (drivers) |
| 2 | `package.json`, lockfile, `src/test-setup.ts`, `eslint.config.js`, `Tooltip.tsx` | Tooltip/Field PRD Phase 1, dialog PRD |
| 3 | `Dialog.tsx`, `ConfirmDialog.tsx`, `WorkDialog.tsx`, `Home.tsx`, `GuideDetail.tsx`, `Settings.tsx`, `Manuscript.tsx` | Dialog PRD phases 2-5, import-review, teleprompter integration (`Dialog size="full"`) |
| 4 | `GuideDetail.tsx`, `Guide.tsx`, `Settings.tsx`, `AudiobookEstimatePanel.tsx`, `Transcript.tsx`, `SelectionMenu.tsx` | Story Bible, proofing-hint and import-review PRDs |
| 5 | `Guide.tsx`, `Results.tsx`, `AudiobookEstimatePanel.tsx`, `GuideDetail.tsx`, ADR 0009 | Review dashboard PRD (new tables), take-review PRD |

Cross-cutting: `hostAPIVersion` unaffected; ADR numbering re-checked at merge; each phase follows `CLAUDE.md`: plan, `change-impact-scan`, TDD, `full-verification-gate`, `design-spec-guard`, `feature-cleanup`; `visual-catalog-sync`, the Playwright suite with PNG review at four viewports, `doc-screenshot-sync`, the atlas.

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Tailwind tokens, no legacy CSS (prior, ADR 0009/0017) | Primitives use tokens and data-attribute variants | Component library styling | Standing decisions |
| Every primitive has a story and an atlas page (prior, ADR 0023) | Kept | Exemptions | Standing decision |
| The dialog PRD recommends native `<dialog>` and no library (prior, draft) | Reopened; proposed to supersede with Radix Dialog (L1) | Native or hand-rolled | Tooltip/Select/Menu inside a top-layer dialog conflict |
| Wrapper layer | Call sites never import the library (proposed) | Direct imports | Cheap swap, one lint rule |
| Select | Native-wrapped by default (proposed) | Radix Select | Keeps `selectOption` and mobile pickers |
| Library | Base UI (owner decision 2026-09-20; was: `radix-ui` proposed, Base UI fallback) | Radix, React Aria, Ark, Headless UI | Owner choice; hand-rolling is extra work for behaviour and accessibility; wrappers keep a swap cheap |
| L3 Select | Native-wrapped `Select`; no Base UI `Select` (2026-09-20, plan D22) | Base UI Select | Keeps `fireEvent.change`, `selectOption`, platform pickers and forms |
| L4 Bundle | Budget 800,000 bytes raw, documented, not a CI gate (2026-09-20, owner) | A gate; no budget | S10a's number; measured each PR |
| L8 Table | A presentational `Table` now, superseding ADR 0009's `table.dtable` exception (2026-09-20, owner) | Wait for TanStack Table | Five tables share one look and no keyboard access |
| L10 Scope | Icon buttons and form controls only (2026-09-20, owner) | Wrap all 57 `<button>`s | Text buttons already have `Button`; raw `<button>` is a ratchet |
| Hint on an icon button | Composed, `<TooltipTarget><IconButton/></TooltipTarget>`, not a prop of `IconButton` (2026-09-20) | A `hint` prop | The hint often says more than the label and its wrapper sometimes needs a layout class |
| Textarea | `Field` with `textarea`; no separate `Textarea` primitive (2026-09-20) | A `Textarea` beside `Field` | One labelled control, one wiring of label, hint and error |
| Popover | Not built (2026-09-20) | A general `Popover` | No caller; the info icon already is a Base UI Popover in `Tooltip` |
| ToggleGroup | A named `role="group"` of `Pill`s, no library part (2026-09-20) | Base UI ToggleGroup, RadioGroup | Keeps every chip a tab stop and the look unchanged; radio semantics deferred (ADR 0052) |
| Combobox | Bespoke alias combobox stays (2026-09-20, follows S10a question 7) | A Base UI Combobox wrap | Domain matching and an active index are the riskiest to regress; its input is a `TextField` |

## Research Summary

**Market and Technical Context**: primitive inventory, raw native counts, hand-built widgets, atlas and ADR rules, PRD overlaps, dependency and embedding constraints were verified in code and docs on this branch. Library facts come from npm metadata and vendor docs read 2026-09-20 (links above); comparisons of alternatives and jsdom shim lists partly come from secondary sources and are marked.
**Not verified**: behavior in Linux and macOS webviews. Settled by S10a: the bundle effect (787,619 bytes raw with every wrapper), and that no jsdom shim is needed. An overflow menu has no caller and is not built.

---

*Generated: 2026-09-20*
*Status: IN DELIVERY (stack S10b) - phases 0, 2 and 3 moved to S10a*
