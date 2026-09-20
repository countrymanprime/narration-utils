# Base UI Primitive Foundation

**Source:** owner decision of 2026-09-20 to stop hand-rolling interactive behaviour in `apps/ui` primitives; reshapes the mechanism in `dialog-modality-and-workdialog-a11y.prd.md` and `component-a11y-meter-tooltip-field-heading-panel.prd.md`, and resolves the library decision (L1, L2) of `ui-primitives-and-headless-library.prd.md`, which keeps the net-new primitives (wrapped natives, menus and disclosure, Table, Combobox) as its Phases 1, 4 and 5 on top of this foundation
**Supersedes:** Open Question 1 (mechanism, "native `<dialog>`, no library") and the "no new runtime dependency for one primitive" Not-Building bullet of the dialog PRD; the hand-rolled `Tooltip` mechanics (Open Questions 2, 3, 8) and hand-rolled `Field` error wiring of the a11y-components PRD. Those PRDs keep their defect scope, sweeps and success metrics.

**Reconciled 2026-09-20** with the owner decisions of [implementation-plan.md](implementation-plan.md) section 1 (stack S10a, issue #86): D1 (Base UI wrapped in our own Tailwind primitives, closed wrapper API), D4 (this PRD owns dialog modality; the dialog PRD keeps its defect scope), D5 (palette option B, unaffected here), D6 (tooltips meet WCAG 1.4.13 formally; info icons are real buttons opening a Popover; the 1000 ms delay stays), D12 (the six danger confirms), D17 (Base UI is MIT, compatible with AGPL) and D22 (every open question below adopts its recommendation, answered inline). `Switch` is added to Phase 5 (settings booleans need it). The visual suite has three viewports (desktop, small-desktop, tablet; there is no phone viewport, [ADR 0037](../adr/0037-visual-suite-captures-no-phone-viewport.md)), so every "three viewports" below means those three. Phase 1's spike results are in [ADR 0047](../adr/0047-the-ui-primitives-wrap-base-ui-and-app-code-never-imports-it.md) and under Research Summary.

Feature PRD. Citations are `file:line` on branch `claude/tech-stack-evaluation-7a3bd8` (main dc9d01a; `apps/ui/src` was unchanged by the last commits) for anything checked in code; Base UI facts were checked on 2026-09-20 against base-ui.com, the npm registry and GitHub raw source, and "TBD - needs research" marks what only a spike can settle. Nothing here changes product behaviour on its own; it changes how primitives are built.

## Problem Statement

The two open UI-defect PRDs plan to hand-write the hard parts of dialogs, tooltips and form fields: a focus trap, `inert`, Escape and focus restore for `Dialog` (a native `<dialog>` spike plus a jsdom polyfill), and id wiring, child cloning and Escape for `Tooltip`. That is a lot of subtle accessibility behaviour to own, test in two environments (jsdom and Chromium) and keep correct across three webviews, for a one-person project whose defects register is already mostly accessibility gaps. The owner decided to adopt a maintained headless library for behaviour and accessibility and keep our own styling and API. The cost of not doing it: roughly 100 lines of focus and layering code per widget that we must prove by hand, and the same work again for every future menu, popover, drawer and select (the app already hand-rolls a `role="menu"` and a `role="combobox"` in `GuideDetail.tsx`).

## Evidence

Verified in code (branch above):

- **Primitives today** are 14 hand-written files in `apps/ui/src/components/primitives/`, none with a runtime dependency beyond React and FontAwesome (`apps/ui/package.json:22-30`: React ^19.3.0, react-router-dom, four FontAwesome packages; Tailwind ^4.3.3 and jsdom ^30.0.1 are dev-only). No Radix, React Aria or Headless UI in the lockfile.
- **`Dialog.tsx:21`** is a `fixed inset-0 z-[60]` div with `role="dialog" aria-modal="true"`, no key handler, no focus call, no portal; the only keyboard work is `tabIndex={0}` on the body (`:39-41`, ADR 0023). **`SlideOver.tsx:25`** and **`AppShell.tsx:111-112`** (mobile nav drawer, `z-[70]`) close only on backdrop `onMouseDown`, with no Escape or trap.
- **`Tooltip.tsx:16-23`** portals to `document.body` at `z-[1000]` with `id="tooltip-layer"`; `:87` points every target's `aria-describedby` at that one id; `:102-103` the info icon is a `span` with `aria-label` and no tab stop; `:4,:31` write `key: Date.now()` that nothing reads. `:root` defines `--z-tooltip: 1000` (`styles.css:53`) but no source file uses it.
- **`Pill.tsx:17-24`** is a toggle chip with no `aria-pressed`; `MeterBar.tsx:12-27` has no role or label; `WorkDialog.tsx:32` builds its bar as a bare `div.progressbar`; `Field.tsx:16-37` has no error or description slot.
- **Hand-rolled widgets elsewhere:** `GuideDetail.tsx:242-247` (`role="menu"`/`menuitem` category menu, no arrow-key or Escape handling in the excerpt read), `:468` (`role="combobox"` alias input), `Home.tsx:290` (raw checkbox), `AudiobookEstimatePanel.tsx:93` (`aria-expanded` disclosure). Native controls in app code: 6 `<select>`, 12 `<input>`, 2 `<textarea>` (non-story files).
- **Consumer counts (JSX opening tags outside stories, tests and the primitive itself):** `Button` 43 in 14 files; `TooltipTarget` 41 in 13 (`Tooltip` icon 7 in 4); `ConfirmDialog` 12 in 6; `Panel` 8 in 4; `Heading` 7 in 7; `Pill` 7 in 4; `Field` 6 (all `GuideDetail.tsx`); `Highlight` 5 in 4; `NavButton` 4 (`AppShell.tsx`); `Dialog` 3 (`ConfirmDialog`, `WorkDialog`, `AddNoteDialog`); `SlideOver` 2 (`Manuscript.tsx`, `GuideDetail.tsx`); `WorkDialog` 2 (`Home.tsx`, `Guide.tsx`); `ErrorBoundary`, `TooltipProvider`, `MeterBar` 1 each. Visual drivers depend on markup: `getByRole('dialog', { name })` (`tests/visual/app.drivers.ts:131`), `getByLabel('More information')`, the `tabindex="0"` disabled-button wrapper, `[data-slide-over]` (ADR 0017).
- **Test environment.** `vite.config.ts` loads `src/test-setup.ts` for every Vitest file; today it only stubs `URL.createObjectURL` (`:36-37`). `src/stories.test.tsx:11-30` runs every story's `play()` in jsdom through `composeStories`. jsdom 30.1.0 has no dialog API (dialog PRD Evidence). The Chromium atlas (`playwright.atlas.config.ts`, `reducedMotion: 'reduce'`) runs axe, `play()`, overflow and console checks on every story, light and dark, two viewports; `atlasCoverage.test.ts` caps `A11Y_DEBT` at 4 entries and requires a story file per primitive.
- **Guards that constrain styling.** ADR 0009 (Tailwind utilities with `var(--token)`, no new legacy CSS), ADR 0017 (`legacyCss.test.ts` fails on new unlayered class rules; state classes mutually exclusive), ADR 0010 (`--backdrop` scrim, `data-theme` on `<html>`), `styles.css:1-5` fixes the layer order. `eslint.config.js:11-37` has no `no-restricted-imports` rule today.
- **Runtime target:** Wails v2.16.0 (`apps/desktop/go.mod:7`), so WebView2 (Chromium) on Windows, WKWebView and WebKitGTK on the optional macOS and Linux builds (ADR 0027).
- **Baseline size:** `apps/ui/dist/assets/index-*.js` is 570,212 bytes raw (local build of 2026-09-19; treat as approximate).

Verified about Base UI (2026-09-20):

- **Package:** `@base-ui/react` (the old `@mui/base` is a different, beta line). Latest 1.8.0 published 2026-09-04; 1.0.0 published 2025-12-11 (npm `time` and the releases page agree). License MIT. `sideEffects: false`, per-component subpath exports (`dialog`, `alert-dialog`, `drawer`, `tooltip`, `popover`, `field`, `input`, `meter`, `progress`, `menu`, `tabs`, `toggle`, `checkbox`, `collapsible`, `select`, `combobox`, and more), peers `react ^17 || ^18 || ^19`, dependencies `@floating-ui/react-dom`, `@floating-ui/utils`, `@base-ui/utils`, `use-sync-external-store`, `@babel/runtime`. The 1.0 release shipped 35 unstyled components; the docs list 37 now, including Drawer (stable, with a mobile-navigation example) and OTP Field (stabilised in 1.6). Maintainers include people behind Radix, Material UI and Floating UI. Browser policy: Baseline Widely Available (30 months); the exact list is in `.browserslistrc` (not read).
- **Dialog** is a `div`, not a native `<dialog>`: `FloatingFocusManager` (`modal` default true) for the trap and focus return, `useScrollLock`, Escape through Floating UI `useDismiss` for the topmost dialog only, `disablePointerDismissal`, `initialFocus`/`finalFocus`, `modal` of `true | false | 'trap-focus'`, `data-open`/`data-closed`/`data-starting-style`/`data-ending-style`, `keepMounted`, nested dialogs. **AlertDialog** has role `alertdialog` and disables pointer dismissal; Escape still closes. Because nothing enters the browser top layer, a body-level tooltip at `z-[1000]` stays above a dialog at `z-[60]`, so the dialog PRD's "top-layer dialog hides the tooltip layer" risk does not arise with this mechanism.
- **Tooltip** is documented as a hint for sighted mouse and keyboard users; the docs ask for an `aria-label` on the trigger matching the text and recommend Popover for info-icon triggers. **Meter** is a single value in a range (`role="meter"` family, no segments). **Progress** takes `value={null}` for indeterminate (`data-indeterminate`, `data-progressing`, `data-complete`) and sets `aria-valuenow`. **Field** has Root, Label, Control, Description, Error, Validity, Item with `data-invalid`, `data-dirty`, `data-touched`, `data-disabled`. Every part accepts `className` (string or state function), `style` and a `render` prop.
- **Styling:** unstyled, no CSS shipped; the docs' Tailwind example uses data-attribute variants (`data-starting-style:scale-95`, `data-highlighted:bg-...`) on parts. Setup asks for `isolation: isolate` on the app root so portalled popups stack above page content.
- **Ecosystem:** shadcn/ui made Base UI the default for new projects in July 2026 while keeping Radix supported (https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default).

## Proposed Solution

Add `@base-ui/react` to `apps/ui` and wrap every part we use inside our own primitive in `components/primitives/`, so app code (`components/`, pages) never imports it. Each wrapper keeps or improves the current prop API, applies Tailwind classes with `var(--token)` values and data-attribute variants over the Base UI parts, and owns the policies chosen elsewhere (for example dialog Escape and backdrop rules). Enforce the boundary with an ESLint `no-restricted-imports` rule. Deliver in phases: foundation, the Dialog family, Tooltip/Field/MeterBar, drawers, the remaining widgets, then a sweep. The mechanism work in the two defect PRDs is replaced by this; the defect fixes themselves (WorkDialog semantics, ConfirmDialog API, MeterBar label, Heading/Panel props) stay where they are.

## Key Hypothesis

We believe wrapping Base UI in our primitives gives keyboard and screen-reader narrators correct dialog, tooltip and form behaviour with less code we must prove ourselves, while leaving call sites and visuals unchanged. We will know we are right when every dialog story passes Escape, Tab-trap and focus-restore `play()` checks in the Chromium atlas, `A11Y_DEBT` does not grow, the three-viewport PNG review shows no unintended diffs, the boundary lint has zero exceptions, and the call-site edits needed are limited to the intentional API changes already planned in the defect PRDs.

## What We're NOT Building

- Direct Base UI imports in `components/` or pages, ever; a page needing a new behaviour gets a new primitive first.
- Base UI's styled or "example" CSS; we style with Tailwind and tokens only (ADR 0009).
- A second component library or a token system swap; `styles.css` tokens, `data-theme` and `--backdrop` stay (ADR 0010).
- A migration of the six native `<select>`s, the alias `combobox` in `GuideDetail.tsx` or any custom composite widget in this PRD (Open Questions 5 and 7); native controls are not hand-rolled behaviour.
- New product behaviour: open/close animation beyond what already exists, backdrop-click dismissal, stacked-dialog policy (the dialog PRD's Not-Building list stands).
- Re-deciding the owner's three decisions (Base UI, Tailwind data-attribute styling, wrap everything), or Radix/React Aria, which were considered and rejected.
- Toast (`layout/Toast.tsx`), `NavigationMenu`, `Tabs`, `Slider` and other Base UI parts we have no consumer for; add them when a page needs one.

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Base UI imports outside `primitives/` | 0 (including `import type` and stories outside primitives) | `src/baseUiBoundary.test.ts` in `pnpm check` (a Vitest scan of every way of naming the package, ADR 0047; an ESLint block is a second guard in the verification tooling PRD's phase 9); a deliberately bad fixture per import form proves it fires |
| Dialog keyboard contract | Escape closes where `onClose` exists, Tab and Shift+Tab stay inside, focus returns to the opener, on 100% of Dialog/ConfirmDialog/WorkDialog/AddNote stories | Chromium atlas `play()`; RTL test for one real consumer flow |
| Page behind a dialog | Not reachable by Tab and hidden from assistive tech while open | `play()` asserting attributes plus axe on the open story; TBD - which of `aria-hidden` or `inert` Base UI applies (Research Summary) |
| A11y debt | `A11Y_DEBT` entries not above 4 and none added by these phases | `atlasCoverage.test.ts`, atlas run |
| Story unit tests | `stories.test.tsx` green in jsdom; count of atlas-only keyboard stories recorded and not growing after Phase 2 | `pnpm --dir apps/ui test` |
| Visual regressions | 0 unintended diffs across affected states at 3 viewports | `pnpm --dir apps/ui screenshots` and PNG review per `CLAUDE.md` |
| Consumer stability | Call-site edits only where a planned API change forces them (ConfirmDialog `danger`, MeterBar `label`) | `git diff --stat` outside `primitives/` per phase |
| Bundle impact | Delta recorded at Phase 1 and after each phase; budget agreed after the spike | `pnpm --dir apps/ui build`, compare `dist/assets` raw and gzip to 570,212 B raw; Open Question 9 |
| Upgrade churn | A Base UI minor bump passes `pnpm check` and atlas or is held with a reason | Dependabot PR for `/apps/ui` |

## Open Questions

- [x] **1. Version policy.** Options: (a) caret `^1.8.0` like every other dependency, riding the `ui-dependencies` Dependabot group (`.github/dependabot.yml:12-18`); (b) exact pin, bumped by hand; (c) `~` minor pin. Recommendation: (a). Base UI is 1.x with monthly minors (1.6, 1.7 and 1.8 between roughly July and September 2026 per the releases page), and the atlas plus visual suite are the gate; nothing merges without the owner anyway. Revisit (c) if a minor ever breaks a wrapper. **Answer (D22): (a).** Caret `^1.8.0`, riding the `ui-dependencies` group; recorded in ADR 0047.
- [x] **2. Wrapper API shape.** Options: (a) closed: each wrapper keeps today's props, adds only explicit new ones, and never spreads Base UI props or exposes its types; (b) open: forward Base UI props and `render`. Recommendation: (a), because the point of decision 3 is that Base UI can be upgraded or replaced without touching pages. Wrappers may accept `className` and standard DOM attributes as `Button` already does (`Button.tsx:11-19`). **Answer (D1, owner: closed wrapper API): (a).**
- [x] **3. `ConfirmDialog` as `AlertDialog`.** Options: (a) all `ConfirmDialog`s use Base UI AlertDialog (role `alertdialog`, no pointer dismissal, Escape still cancels); (b) only destructive ones (the dialog PRD Q8 list) do; (c) all stay `Dialog`. Recommendation: (a): every confirm interrupts and needs an answer, and it makes the dialog PRD's Q6 (no backdrop dismissal) a library default. `Dialog` takes an internal `variant` so both share one shell (ADR 0001/0002 layout unchanged). **Answer (owner): (a).** Spike confirms the `alertdialog` role, no backdrop dismissal, Escape still closes.
- [x] **4. Info icon and tooltips.** Base UI says Tooltip is sighted-only and suggests Popover for info icons. Options: (a) the icon is a real `<button aria-label="More information">` opening a Base UI Popover on hover, focus or click, so its text is reachable by screen readers, and hint tooltips (NavButton, Pill, MeterBar segments, tables) stay Tooltip with the trigger's own label carrying the same text; (b) icon stays a Tooltip trigger with `aria-label` equal to the text (text becomes the button name, long strings read as a name); (c) keep both a Tooltip and a described-by text. Recommendation: (a). Revises the a11y PRD's Q2/Q3 (description attach and icon as button), keeps the `More information` label the visual drivers select, and leaves Q4 (hoverable and persistent) at "Escape only" unless Base UI's hoverable popup is on by default (TBD - verify `disableHoverablePopup` default). **Answer (owner, D6): (a), with WCAG 1.4.13 met formally.** Spike: `disableHoverablePopup` defaults to `false` (hoverable), Escape dismisses, the popup stays while hovered or focused, so hint tooltips satisfy 1.4.13 as they are; the info icon is a Popover trigger that opens on hover and click and, in the wrapper, on keyboard focus (Base UI does not open on focus alone). The 1000 ms hover delay stays.
- [x] **5. Native `<select>`.** Options: (a) keep native for now, wrap later only if a design need appears; (b) build `Select` on Base UI Select now. Recommendation: (a): six call sites, native selects work in all three webviews, and Base UI Select is a large visual and behaviour change. Put `Select` in the Could list of Phase 5. **Answer (owner): (a).** Native stays; `Select` is a Could item of Phase 5, not built here.
- [x] **6. `SlideOver` and the nav drawer.** Both use a backdrop that already blocks pointer input. Options: (a) Base UI Drawer with `modal` true for both (trap, Escape, focus return; backdrop click still closes); (b) `modal="trap-focus"` for `SlideOver` (peek panels) and full modal for the nav; (c) leave them (dialog PRD Q7 (a)). Recommendation: (a). This reverses Q7 of the dialog PRD because the library makes it cheap; keep `data-slide-over` and `data-open` attributes (ADR 0017, visual drivers) and mounted-while-closed behaviour if `keepMounted` supports it (TBD). **Answer (owner): (a).** Base UI Drawer, `modal` true, for both. This reverses Q7 of the dialog PRD.
- [x] **7. Which hand-rolled call sites convert.** Options: (a) Phase 5 covers Pill to Toggle, the category menu to Menu, the checkbox to Checkbox, the disclosure to Collapsible; the alias combobox stays bespoke; (b) all four plus the alias Combobox; (c) none. Recommendation: (a). The alias combobox has domain logic (matches, active index, selected id) and the highest regression risk; file a follow-up if wanted. **Answer (owner): (a), plus `Switch`.** The alias combobox stays bespoke.
- [x] **8. `Button`.** Options: (a) stays a native `<button>` styled by us; Base UI parts that render buttons (`Dialog.Close`, `Popover.Trigger`) use `render={<Button />}`; (b) wrap Base UI Button. Recommendation: (a): 43 usages, no behaviour gap today; revisit if `focusableWhenDisabled` (TBD - confirm the prop exists) is wanted for disabled buttons with tooltips. **Answer (owner): (a).** `Button` stays a native, styled button.
- [x] **9. Bundle budget.** Options: (a) measure first and set the budget after Phase 1; (b) fix a number now (proposal: raw JS growth under 15% of 570,212 B, about 85 KB); (c) no budget. Recommendation: (a), then adopt (b)'s form with the measured number. TBD - needs measurement (Floating UI comes in with Dialog and Tooltip). **Answer (owner): (a), measured after Phase 1.** Baseline 571,969 B raw JS (158,239 gzip). Upper bound with a namespace import of every family the PRD uses: 818,579 B raw (+246,610, +43%; 237,665 gzip); the six Phase 2 and 3 families alone: 722,875 B raw (+26%). The budget is fixed from the real wrapper build at Phase 6 and written in `design-system.md`; the number is recorded after each phase.

## Users & Context

**Primary user**: the maintainer and sessions adding UI, who today copy the nearest primitive and hand-roll behaviour; secondarily keyboard and screen-reader narrators on Windows (WebView2) who benefit from the behaviour.
- **Current behaviour**: each primitive owns its own accessibility, most of it missing; new widgets are re-invented.
- **Success state**: a new dialog, popover or menu is a wrapper with a story, behaviour comes from the library, and lint stops a page bypassing it.

**Job to Be Done**: When I need an accessible interactive widget, I want one wrapper with our styling and API to reach for, so behaviour is correct by default and the library stays an implementation detail.

**Non-users**: mouse-only narrators see no intended change.

## Solution Detail

### Primitive mapping (every current primitive)

| Primitive | Decision | Base UI part and notes |
| --- | --- | --- |
| `Dialog` | Wraps | `Dialog` (Root, Portal, Backdrop, Viewport, Popup, Title, Close); `AlertDialog` via internal `variant`. Wrapper owns Escape and backdrop policy, `initialFocus` on the body region, `finalFocus`, ADR 0001/0002 layout, `--backdrop`. Keeps `title`, `onClose`, `actions`, `actionsAlign`; may add `size` for the teleprompter PRD |
| `ConfirmDialog` | Wraps (via `Dialog`) | AlertDialog variant; API changes stay in the dialog PRD Phase 4 (`danger` needs `dangerLabel`, `confirmVariant`, `body: ReactNode`) |
| `WorkDialog` | Wraps (via `Dialog` and `Progress`) | Dialog plus `Progress` (`value={null}` when indeterminate, `aria-valuenow` otherwise); keeps the `progressbar` marker class (ADR 0009); message in a live region; reduced motion stays the dialog PRD's Phase 3 |
| `Tooltip`, `TooltipTarget`, `TooltipProvider` | Wrap | `Tooltip` (Provider, Root, Trigger with `render`, Portal, Positioner, Popup); info icon per Question 4 uses `Popover`. Keeps the 1000 ms hover delay and immediate focus show (`Tooltip.tsx:50-58`), the disabled-child wrapper the `proofing/disabled-button` driver selects, and inline use via `render={<mark />}` for teleprompter flags |
| `Field` | Wraps | `Field` (Root, Label, Control via `render` for the textarea, Description, Error); adds the hint/error slots of a11y PRD Q7 with automatic `aria-invalid`/`aria-describedby`; control classes stay ours |
| `MeterBar` | Stays custom | Base UI Meter is one scalar; the segmented bar keeps `role="img"` with a composed label (a11y PRD Q1). Its segment tooltips use our `TooltipTarget`; `motion-safe:` fix stays in the a11y PRD |
| `Pill` | Wraps (Phase 5) | `Toggle` (adds `aria-pressed`; `data-pressed` replaces the `active` class only if the mutually exclusive class rule of ADR 0017 is kept); group semantics deferred (Question 7) |
| `SlideOver` | Wraps (Phase 4) | `Drawer`, per Question 6; keeps `data-slide-over`, `data-open`, slide transition |
| Mobile nav drawer (`layout/AppShell.tsx:111-134`) | Moves into a primitive, wraps (Phase 4) | `Drawer`, `modal` true; today inline markup with `z-[70]`; needs a small `NavDrawer` (or a `SlideOver` `side` prop) so `AppShell` imports no Base UI |
| GuideDetail category menu | Wraps (Phase 5, new `Menu` primitive) | `Menu`; replaces hand-rolled `role="menu"` |
| `Button` | Stays custom (Question 8) | Composed into Base UI parts through `render` |
| `NavButton` | Stays custom | A `button` with `aria-current`; no Base UI part fits (NavigationMenu is for menus); its tooltip uses our `TooltipTarget` |
| `Heading`, `Panel` | Stay custom | Plain `h1` and `section`; a11y PRD Phase 3 adds `level`, `title`, `actions` |
| `Highlight` | Stays custom | A `mark`; ADR 0016 owns it; teleprompter flags reuse it inside our Tooltip |
| `ErrorBoundary` | Stays custom | A React class boundary, not a widget; uses `Button` |

### Core Capabilities (MoSCoW)

| Priority | Capability |
| --- | --- |
| Must | Dependency, wrapper convention, lint boundary, jsdom support, `isolate` root, ADR |
| Must | `Dialog`/`ConfirmDialog`/`WorkDialog` on Base UI with the modal contract and the Q3/Q6 policies |
| Must | `Tooltip` family on Base UI keeping the current contract; `Field` on Base UI Field |
| Should | Drawer for `SlideOver` and nav; `Toggle`, `Menu`, `Checkbox`, `Collapsible`, `Switch` primitives |
| Could | `Select`, `Combobox` (alias input), `Tabs`, `Toast`; a dependency-cruiser guard |
| Won't (here) | Anything in the Not-Building list |

**MVP scope:** Phases 1 to 3. **User flow** is unchanged for pages: a page renders `<ConfirmDialog>`, `<TooltipTarget>` or `<Field>` exactly as today; the library is invisible to it.

## Technical Approach

**Feasibility: MEDIUM.** The library fits (React 19, headless, Tailwind data variants, MIT). The risks are integration ones: jsdom, layering, visual drift and whether its outside-content hiding satisfies axe.

**Wrapper convention (proposed)**
- **Layout:** one flat file per primitive in `primitives/` (`Dialog.tsx`, `Tooltip.tsx`, new `Menu.tsx`, `Popover.tsx`, `Drawer.tsx`), each with `<Name>.stories.tsx`, which keeps `atlasCoverage.test.ts` and the generated `docs/ui` working unchanged. Import per component (`import { Dialog } from '@base-ui/react/dialog'`), never the barrel, so `sideEffects: false` tree-shaking is not defeated. A Base UI type never appears in a wrapper's exported props.
- **Styling:** Tailwind utilities with `var(--token)` classes on each part; state via data variants (`data-open:`, `data-starting-style:`, `data-ending-style:`, `data-disabled:`, `data-invalid:`), chosen mutually exclusively per ADR 0017, no new class in `styles.css`. Popups and backdrops portal to `body`, so the root needs the `isolate` utility (`index.html:33` `#root` and the Storybook decorator, `.storybook/preview.tsx`); z-index tokens become named (`--z-tooltip` exists unused) so the order is dialog under tooltip, drawer under dialog.
- **Stable API for consumers:** conditional rendering (`{open && <ConfirmDialog />}`) is kept by rendering Root with `open` on mount and calling the existing callback from `onOpenChange` only for the reasons the wrapper allows (`escape-key` when `onClose` exists and the job is dismissible; `outside-press` never).
- **Enforcement (as built):** `src/baseUiBoundary.test.ts` parses `src`, `tests` and `.storybook` and fails on any `@base-ui/*` import, type import, re-export, dynamic import or `require` outside `src/components/primitives/`; it replaced the planned flat-config `no-restricted-imports` block: a test also sees a dynamic `import()`, `vi.mock` and `declare module`, and ADR 0046 puts mechanical import rules in the test runners (ADR 0047). Optional second guard: a dependency-cruiser rule `not-to-base-ui-outside-primitives`, owned by `verification-and-code-health-tooling.prd.md` (being written in parallel), so this PRD depends only on the ESLint rule.
- **Verification:** the wrapper's story `play()` proves keyboard behaviour in the Chromium atlas; `stories.test.tsx` renders it in jsdom with polyfills added to `src/test-setup.ts` for what Base UI touches (`getAnimations`, `ResizeObserver`, layout-dependent focus checks; jsdom lacks the first two, TBD for the third), keyboard-only assertions flagged atlas-only as dialog PRD Q2 already decided.

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| jsdom cannot run Base UI popups (animations, ResizeObserver, tabbable checks) and `stories.test.tsx` fails wholesale | Medium-High | Phase 1 spike proves one Dialog and one Tooltip story in jsdom; polyfills in `test-setup.ts`; fallback: atlas-only flag on affected stories |
| Outside-content hiding is `aria-hidden` without `inert`, so axe `aria-hidden-focus` fails the Storybook root while a dialog is open and `A11Y_DEBT` would grow | Medium | Spike on the open-dialog story; if it fires, set the wrapper to mark siblings inert or fix the decorator; never add debt |
| Visual drift (portal, scroll-lock padding, focus rings, backdrop, stacking vs Toast `z-50`, tooltip `z-[1000]`) | Medium | `isolate` root, named z tokens, three-viewport PNG review per phase, doc screenshots regenerate |
| Behaviour differences from today (Escape, backdrop, initial focus, focus restore with no Trigger element because dialogs mount conditionally) | Medium | Wrapper owns policy (dialog PRD Q3/Q5/Q6 stand); `finalFocus` falls back to `main`; RTL test per policy; TBD - Base UI default restore target without a trigger |
| Tooltip semantics differ (no described-by, sighted-only) and a11y PRD promises change | Medium | Question 4; keep `aria-label` on triggers; screen-reader pass in Phase 3 |
| ADR 0009/0016/0017 and design-spec-guard flag wrapper styling or markers (`.progressbar`, `[data-slide-over]`) | Low-Medium | Run `design-spec-guard` per phase; keep marker classes and attributes; `legacyCss.test.ts` stays green |
| Upgrade churn from monthly 1.x minors | Medium | Question 1; wrappers hide the API; atlas and visual gates on the Dependabot PR; read release notes before merging |
| WebKit floors on optional macOS/Linux builds | Low-Medium | Windows is the gate (ADR 0027); TBD - per-platform Wails webview versions vs the Baseline policy |
| Base UI stops being maintained or changes direction | Low | Wrapper boundary makes a swap a primitives-only change (the reason for decision 3) |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Foundation | Dependency, convention doc, import boundary test, `isolate` root, jsdom check, spike (Dialog, Tooltip, Popover in jsdom and Chromium), bundle measurement, ADR | complete | - | - | - |
| 2 | Dialog family | `Dialog`, `ConfirmDialog`, `WorkDialog`, `AddNoteDialog` verified; absorbs dialog PRD phases 1-2 (mechanism, shared modal behaviour); also delivers dialog PRD phase 4 (`ConfirmDialog` API, the six danger confirms) and the progress semantics of its phase 3, [ADR 0048](../adr/0048-every-dialog-is-one-modal-shell-and-confirms-are-alert-dialogs.md) | complete | 3, 5 | 1 | - |
| 3 | Tooltip, Field, MeterBar | Tooltip family and info icon, `Field`, MeterBar semantics; absorbs the a11y PRD's mechanism (Phases 1 and 3 for Field). Delivered in two pull requests: 3a Tooltip and info icon ([ADR 0049](../adr/0049-hints-are-base-ui-tooltips-that-meet-wcag-1-4-13-and-info-icons-are-buttons.md)), 3b `Field` and `MeterBar` | complete | 2, 5 | 1 | - |
| 4 | Drawers and nav | `SlideOver` and the mobile nav drawer on Drawer ([ADR 0051](../adr/0051-the-slide-over-and-the-navigation-drawer-are-modal-base-ui-drawers.md)) | complete | 5 | 2 | - |
| 5 | Remaining widgets | `Pill` to Toggle, `Menu`, `Checkbox`, `Collapsible`, `Switch`; overlaps `ui-primitives-and-headless-library.prd.md` Phase 4 (menus and disclosure), so build each widget once, in whichever PRD reaches it first, and tick it off in both | pending | 2, 3, 4 | 1 | - |
| 6 | Sweep | `docs/ui` regen, three-viewport PNG review, doc screenshots, `design-system.md`, guide check | pending | No | 2, 3, 4, 5 | - |

### Phase Details

**Phase 1 - Foundation.** Goal: the boundary, environment and evidence exist before any primitive changes. Scope: `pnpm add @base-ui/react` in `apps/ui`; `src/baseUiBoundary.test.ts` (the boundary, with a bad fixture per import form); `isolate` on `#root` and the Storybook decorator; `src/test-setup.ts` polyfills; throwaway spike stories (a Base UI Dialog and Tooltip inside a story) run in jsdom and the Chromium atlas, recording answers to: outside content `aria-hidden` vs `inert`, Tab trap in Chromium, focus return without a Trigger, `getAnimations` handling, tooltip layer above the dialog, `dist` size delta, Escape ownership; a "Base UI wrappers" section in `docs/design/design-system.md`. Last commit, after the code above has landed in the PR: the ADR via `adr-author` (rule 4 of `docs/adr/README.md`), numbered at merge time (next free number 0039 today), which amends no ADR and extends ADR 0009 and 0023. Success: lint fails a direct import, `pnpm check` and atlas green, spike answers written in the PR.

**Phase 2 - Dialog family.** Goal: dialog defect 2 closed on Base UI. Scope: `Dialog.tsx` (shell, `AlertDialog` variant, policies), `ConfirmDialog.tsx`, `WorkDialog.tsx` (Progress; remaining semantics stay dialog PRD Phase 3), `manuscript/AddNoteDialog.tsx` check, stories with `play()` for Escape, Tab, restore, `ConfirmDialog.test.tsx`, one consumer test (Story Bible delete). Success: Success Metrics rows for dialogs; visuals unchanged at three viewports.

**Phase 3 - Tooltip, Field, MeterBar.** Goal: a11y defects 5-7 on the new mechanism. Scope: `Tooltip.tsx`, `Field.tsx`, `MeterBar.tsx` (custom, label and `motion-safe:`), `Popover.tsx` for the icon, tests and stories; verify the 12 `TooltipTarget` consumer files and the three drivers (`home/info-tooltip`, `global/tooltip`, `proofing/disabled-button`). Success: no dangling ids, Tab reaches the icon, Escape hides it, disabled wrapper unchanged.

**Phase 4 - Drawers and nav.** Goal: same modality for `SlideOver` and the nav. Scope: `SlideOver.tsx`, new nav-drawer primitive, `AppShell.tsx` (imports only our primitive), `Manuscript.tsx` and `GuideDetail.tsx` call sites unchanged. Success: Escape, trap, focus return; `[data-slide-over]` drivers pass.

**Phase 5 - Remaining widgets.** Goal: replace hand-rolled widgets. Scope: `Pill.tsx` (Toggle), new `Menu.tsx`, `Checkbox.tsx`, `Collapsible.tsx`, `Switch.tsx` (for the settings booleans; the Settings boolean kind itself is a later stack); call sites `GuideDetail.tsx`, `Home.tsx`, `AudiobookEstimatePanel.tsx` edited only to use the new primitives. Success: keyboard `play()` per widget; Pill tests select by role and pressed state.

**Phase 6 - Sweep.** Goal: nothing stale. Scope: `pnpm --dir apps/ui atlas` and Playwright suite; PNGs at every viewport in `tests/visual/viewports.ts` (three) for every dialog, drawer and tooltip state; `node tools/ui-atlas-kit/plugin/cli/ui-atlas.mjs docs --dir apps/ui`; `doc-screenshot-sync`; `visual-catalog-sync` if states changed; `design-system.md` table; delete this PRD when steady-state docs cover it.

### Parallelism Notes

Phase 1 first. Phases 2, 3 and 5 touch disjoint primitive files and can run concurrently; Phase 2 finishing first lets Phase 3 test a tooltip inside a dialog. Phase 4 follows Phase 2 to reuse its backdrop and policy code. The sweep is last.

### Parallel-session compatibility

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 1 | `apps/ui/package.json`, `pnpm-lock.yaml`, `src/baseUiBoundary.test.ts`, `index.html`, `.storybook/preview.tsx`, `src/test-setup.ts`, `docs/design/design-system.md`, `docs/adr/` | Medium: the verification-tooling PRD also edits lint and config; lockfile conflicts rebase; ADR number checked at merge |
| 2 | `Dialog*`, `ConfirmDialog*`, `WorkDialog*`, `AddNoteDialog.tsx` | High with the dialog PRD phases 3-4 and teleprompter Phase 1 (`size="full"`): serialize, or land Phase 2 first |
| 3 | `Tooltip*`, `Field*`, `MeterBar*`, `Popover.tsx`, `AudiobookEstimatePanel.tsx` | Medium with the a11y PRD and teleprompter Phase 7 (needs the tooltip contract) |
| 4 | `SlideOver*`, `AppShell.tsx`, new nav primitive | High if a nav-item PRD lands (`AppShell` NAV regenerates screenshots); one at a time |
| 5 | `Pill*`, new primitives, three call sites | Medium with settings-mobile-layout (`Settings.tsx`) |
| 6 | `docs/ui/**`, `docs/images/ui/*`, `design-system.md` | Always conflicts; regenerate, never merge binaries |

Cross-cutting: every phase follows `CLAUDE.md` (plan, `change-impact-scan`, TDD, `pnpm check`, atlas, Playwright visual suite with PNG review, `design-spec-guard`, `feature-cleanup`); no `integrations/reaper` change; no `hostAPIVersion` bump; the ADR is not written before Phase 1's code exists.

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Behaviour layer (owner decision, 2026-09-20) | Adopt Base UI (`@base-ui/react`) instead of hand-rolling | Hand-rolled primitives; native `<dialog>` | Rolling our own is extra work to get behaviour and accessibility right. This REVERSES the dialog PRD's Q1 recommendation ("native `<dialog>`, no library") and its "no new runtime dependency" bullet |
| Styling (owner decision, 2026-09-20) | Tailwind with data-attribute variants over Base UI parts | Base UI CSS, CSS modules | Matches ADR 0009 |
| Encapsulation (owner decision, 2026-09-20) | Every Base UI part we use is wrapped in a `primitives/` component; app code never imports it | Direct use in pages | Consistent styling and API; swappable library |
| Alternatives considered (owner decision, 2026-09-20; sources per the owner's brief, not re-verified) | Radix (still maintained, slower on complex widgets) and React Aria (strictest, larger) rejected | - | Owner chose Base UI; shadcn/ui made it the default for new projects in July 2026 |
| Dialog Escape and backdrop rules (dialog PRD Q3, Q6, prior proposal) | Still stand; wrapper makes them configurable | Library defaults | Dialog PRD stays the owner of policy |
| One `Dialog` primitive; layout and action placement (prior decisions, ADR 0001, 0002) | Unchanged | - | Wrapper keeps the shell |
| Tailwind utilities, no new legacy CSS; exclusive state classes; `--backdrop`; atlas gate (prior decisions, ADR 0009, 0017, 0010, 0023) | Keep | - | Guards stay green |
| Workflow and gates (prior decision, `CLAUDE.md`) | plan, impact scan, TDD, `pnpm check`, atlas, visuals | - | History of silent regressions |
| ADR timing (proposed) | Written after Phase 1 code lands, next free number at merge (0047, written by Phase 1) | Before code | `docs/adr/README.md` rule 4 |
| Wrapper API closed; per-component imports; flat files (proposed) | As stated | Open API; barrel; subfolder | Questions 2 and Solution Detail |
| Other open questions (D22, 2026-09-20) | Recommendations under Open Questions 1 to 9, answered inline | See there | Owner adopted every recommendation; Q3, Q4, Q6, Q7 are owner-stated (D1, D6, D12) |
| Foundation ADR (2026-09-20, Phase 1) | [ADR 0047](../adr/0047-the-ui-primitives-wrap-base-ui-and-app-code-never-imports-it.md): dependency, wrapper convention, `isolate` stacking, import boundary | One ADR per phase | One decision (docs/adr/README.md rule 3); later phases' ADRs record dialog, tooltip and drawer behaviour |
| Boundary enforcement (2026-09-20, Phase 1) | A Vitest scan (`src/baseUiBoundary.test.ts`), not an ESLint rule | ESLint `no-restricted-imports` in `eslint.config.js` | ADR 0046 already puts mechanical import rules in the test runners, and a test sees more forms than a lint pattern. Phase 9 of the verification PRD may still add the ESLint form as a second guard |
| Switch (owner, 2026-09-20) | Added to Phase 5 | Wait for the Settings PRD | Settings booleans need it (D8) |

## Research Summary

**Market Context**: Base UI is the successor effort from the Radix, Material UI and Floating UI authors, 1.0 in December 2025, monthly minors since. shadcn/ui defaults new projects to it since July 2026 (Radix stays supported). WAI-ARIA Authoring Practices "Dialog (Modal)" (initial focus inside, Tab loop, Escape, focus return) is what the library targets; its own docs say components follow WAI-ARIA patterns and are tested on multiple screen readers (no per-AT results read).

**Technical Context**: verified facts are under Evidence. **Phase 1 spike results (2026-09-20, Base UI 1.8.0, Chromium via Playwright 1.63, jsdom 30.1; full table in [ADR 0047](../adr/0047-the-ui-primitives-wrap-base-ui-and-app-code-never-imports-it.md)):** outside content is hidden with `aria-hidden` and `data-base-ui-inert`, not `inert`, and axe passes; the Tab trap held for 60 presses; focus returns to the opener on Escape and on parent unmount, but falls to `<body>` if the opener is gone, so the wrapper needs a `finalFocus` fallback; `AlertDialog` has no backdrop dismissal and still closes on Escape; a body-level tooltip stays above a dialog, and Escape with a tooltip open inside a dialog closes both; `disableHoverablePopup` defaults to false; the Popover trigger opens on hover, click and Enter but not on keyboard focus alone; `Field.Control` with `render={<textarea />}` works and wires `aria-invalid` and `aria-describedby`; every widget the PRD uses renders and responds to `userEvent` in jsdom with no polyfill; the bundle delta is in Open Question 9. Still not verified: `Button` `focusableWhenDisabled` (not needed, Q8 a); `Drawer` `keepMounted` (Phase 4); `.browserslistrc` versus each Wails webview (the package has no such file; the Windows WebView2 build is the gate, ADR 0027); NVDA results in WebView2 (one manual pass planned in the dialog PRD, an owner step).

---

*Generated: 2026-09-20*
*Status: in delivery (stack S10a, issue #86). Phase 1 complete.*
