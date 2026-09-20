# Dialog Modality and WorkDialog Accessibility

**Supersedes:** `docs/design/known-ui-defects.md` (defect 2 [high], defect 3 [medium], defect 4 [low]; the file's last revision is `b613933`, recover it with `git show b613933:docs/design/known-ui-defects.md`)

**Reshaped by:** the Base UI foundation ([ADR 0047](../adr/0047-the-ui-primitives-wrap-base-ui-and-app-code-never-imports-it.md); its PRD is delivered and deleted). Owner decision 2026-09-20: Base UI's Dialog and AlertDialog, behind our own `Dialog`/`ConfirmDialog` wrappers, replace the native `<dialog>` or hand-rolled mechanism this PRD first recommended. Phases 1 and 2 moved into the foundation and were delivered by stack S10a ([ADR 0048](../adr/0048-every-dialog-is-one-modal-shell-and-confirms-are-alert-dialogs.md)). Notes marked "Reshaped" below win over the original text.

**Where it stands (stack S11, tracking issue #116):** defects 2 and 4 are closed by S10a (modality; the `ConfirmDialog` API and the six red confirms, owner decision D12, checked against the code: Clear derived project data, Remove local preview voice, Remove local Whisper model, Delete entry, Merge and delete source, Replace and reset). What S10a left of defect 3, reduced motion and the status line for a job with no Cancel, is Phase 3 here ([ADR 0057](../adr/0057-a-running-job-that-cannot-be-cancelled-keeps-its-dialog-blocking-and-says-so.md)). Phase 5 is the sweep and the steady-state docs, and deletes this PRD. The Evidence section below is the record of the defects as found; every item in it about `Dialog`, `ConfirmDialog` and the dialog's semantics is now fixed.

## Problem Statement

Every modal in the app (`Dialog`, `ConfirmDialog`, `WorkDialog`, and `AddNoteDialog` built on `Dialog`) declares `aria-modal="true"` but is not modal: Escape does nothing, focus is neither moved in nor trapped nor restored, and the page behind stays focusable and readable. A keyboard-only or screen-reader narrator confirming "Delete entry", importing a manuscript or rebuilding the Story Bible can tab out into the page behind the dialog, lose their place, and cannot dismiss the dialog from the keyboard. This was the only high-severity entry in the retired defects register (`docs/design/known-ui-defects.md`, defect 2). The same primitives also have three smaller gaps (progress bar semantics, empty action row, ConfirmDialog API) that are cheapest to fix in the same pass because they share files.

## Evidence

Verified against `b9d348d` (main at PR #34) and re-checked at `d5cc994` (main after #42); this is the state before stack S10a. Each item below carries what became of it.

- **Reproduce (from the retired register):** open any confirm dialog (Story Bible delete), press Tab repeatedly, or press Escape. The register's severity scale, kept here so the ratings stay comparable: **high** blocks a user or fails an accessibility standard outright, **medium** degrades an experience, **low** is polish or hygiene. Defect 2 was high, defect 3 medium, defect 4 low. Its "caught by" notes: the atlas asserts roles and names but its stories cannot prove a focus trap (add a `play()` that tabs past the last control); the `RunningWithoutCancel` story shows the empty action row but nothing asserts progress semantics.

- `primitives/Dialog.tsx`: a `fixed inset-0 z-[60]` div with `role="dialog" aria-modal="true" aria-label={title}`. No key handler, no focus call, no `inert`, no portal. The only keyboard work in it is `tabIndex={0}` on the scroll body (ADR 0023). **Fixed by S10a** (ADR 0048): defect 2.
- `ConfirmDialog.tsx`: `danger` renders `{dangerLabel}` and `dangerLabel` is optional, so `danger` without a label is an unnamed button. The confirm button is always `variant="primary"`. `body: string` only. **Fixed by S10a** (ADR 0048): defect 4.
- `WorkDialog.tsx`: the bar is `div.progressbar` with no role or `aria-valuenow`; the indeterminate state is `animate-[work-progress-slide_1.15s_ease-in-out_infinite]` with no `motion-safe:` guard; the message is not in a live region. The role, the value and the live region are **fixed by S10a**; the `motion-safe:` guard and the empty action row are **fixed by Phase 3** (ADR 0057): defect 3.
- **The empty action row is wider than the old register said.** `WorkDialog` renders Cancel only if `cancel && running` and Close only if `close && !running`. `Guide.tsx:276` (Story Bible rebuild) passes no `cancel`, and `Home.tsx:328` (manuscript import) passes `cancel` only while `phase === 'preparing'`, so the import dialog also has an empty action row in `running` and `committing`. I found no Story Bible build cancel endpoint in `api/contracts/` or `types.ts` (TBD - confirm in `apps/desktop/bindings.go`).
- Consumers (change-impact-scan input): `ConfirmDialog` 12 usages in 6 files (`App.tsx`, `Home.tsx` x2, `Transcript.tsx`, `Settings.tsx` x4, `GuideDetail.tsx` x3, `TeleprompterPage.tsx`); `WorkDialog` in `Home.tsx` and `Guide.tsx`; `Dialog` directly in `manuscript/AddNoteDialog.tsx` (the old register omitted this fourth consumer; `docs/ui/atlas/Dialog.md` lists it). Existing tests: `ConfirmDialog.test.tsx` and stories only; nothing exercises the keyboard.
- Stories assert `aria-modal="true"` (`Dialog.stories.tsx` `CloseButtonInvokesOnClose`) but no story presses Escape or Tab.
- (Historic, and moot with Base UI: jsdom 30.1.0 has no `<dialog>` API and no `inert`; the spike found Base UI needs no polyfill under jsdom, ADR 0047.)
- (Historic: no focus-trap library was installed; Base UI is now the dependency, ADR 0047.)
- (Historic: a top-layer `<dialog>` would have drawn above the tooltip layer; Base UI's Dialog is a `div` and the tooltip layer stays above it, ADR 0047.)
- Not in the old register: the mobile nav drawer (`AppShell.tsx:112`) and `SlideOver` had the same gap. **Fixed by S10a** as Base UI drawers (ADR 0051).
- `playwright.atlas.config.ts` sets `reducedMotion: 'reduce'`, but the Storybook preview also switches every animation and transition off (`.storybook/preview-head.html`), so a reduced-motion assertion cannot be made on a story: **Phase 3 guards it with a unit test on the `motion-safe:` classes** (as `MeterBar` does, ADR 0050).
- Assumption - needs validation: the narrator population includes keyboard-only or screen-reader users on Windows (WebView2). No usage data exists; ask the user, and plan one manual NVDA pass.

## Proposed Solution

Give `Dialog` one shared modal behaviour that all four consumers inherit: focus moves in on open (an `autoFocus` child wins, otherwise the body region), Tab is trapped, Escape calls `onClose` when one exists, the page behind is inert to focus and to assistive technology, and focus returns to the opener on unmount. The mechanism is Base UI's Dialog behind our `Dialog` wrapper (owner decision 2026-09-20, delivered by stack S10a, ADR 0048; the original native `<dialog>` spike was dropped). Then fix `WorkDialog` (progressbar semantics, status announcement, reduced motion, never an empty action row; the semantics by S10a, the rest by Phase 3) and `ConfirmDialog` (danger label required with `danger`, `confirmVariant`, `body` as `ReactNode`) and mark the destructive confirms (both S10a).

## Key Hypothesis

We believe making the shared dialog genuinely modal and its progress dialog semantic will let keyboard and screen-reader narrators complete import, delete, merge and rebuild flows without losing their place or being unable to dismiss a dialog. We'll know we're right when a Chromium atlas `play()` proves Tab cannot leave, Escape closes and focus returns for every dialog story, axe reports no new violations, a manual NVDA pass on the Story Bible delete and manuscript import flows works (an owner step, still pending), and defects 2, 3 and 4 are closed (Phases 2-4 `complete`).

## What We're NOT Building

- Modality for the mobile nav drawer and `SlideOver` in this PRD - **Reshaped:** they move to Base UI Drawer in foundation Phase 4, not here.
- A cancel endpoint for the Story Bible rebuild - Go/Python work; this PRD only makes the UI honest about it.
- Backdrop-click dismissal (see Open Questions; recommended off).
- A stacked-dialog manager - no dialogs stack today; the mechanism only has to not corrupt state if two mount.
- Open/close animation, new visual design, width or overflow changes - ADR 0001/0002 stand.
- Hand-rolling modal behaviour. **Reshaped:** the earlier "no new runtime dependency for one primitive" stance is reversed; the mechanism is Base UI Dialog/AlertDialog behind our wrappers, per the foundation PRD.

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Escape closes every dialog that has `onClose` | 100% of Dialog/ConfirmDialog/AddNote stories | Atlas `play()` (real Chromium) |
| Tab cannot leave the dialog | Focus stays inside after Tab and Shift+Tab past the last/first control | Atlas `play()` |
| Focus returns to the opener on close | 100% of consumer flows | RTL test per consumer plus a story |
| Page behind is inert | Background not focusable and hidden from AT while open | `play()` asserting `:modal`/`inert`; axe; one manual NVDA pass |
| Progress semantics | `role="progressbar"`, `aria-valuenow` when determinate, none when indeterminate | Story `play()` + RTL |
| Reduced motion | No running animation on `RunningIndeterminate` | Atlas (already `reducedMotion: 'reduce'`) computed-style assertion |
| Empty action rows | 0 dialog states with no focusable control | Story assertion over every WorkDialog phase |
| Visual regressions | 0 unintended diffs across dialog states at 4 viewports | `pnpm --dir apps/ui screenshots` + PNG review |
| Defects closed | Defects 2, 3, 4 closed: Phases 2, 3, 4 marked `complete` in this PRD | Review |

## Open Questions

- [x] **1. Mechanism - RESOLVED 2026-09-20 (owner decision): (c) a library, Base UI, wrapped in `Dialog`; no spike between native and hand-rolled.** Original analysis kept for the record. Options: (a) native `<dialog>` + `showModal()` (browser-provided inertness, Escape via `cancel`, top layer; needs a jsdom polyfill and a Wails webview floor check); (b) hand-rolled: portal to `body`, `inert` on siblings, Tab-wrap keydown, focus restore (identical behaviour in jsdom and Chromium, roughly 100 lines to own); (c) a library (Radix Dialog, react-aria FocusScope, focus-trap-react; a new dependency in a repo that has almost none). Recommendation: (a), after a one-day spike (Phase 1) that confirms the webview floor, the jsdom polyfill and Tooltip stacking; fall back to (b) if any fails; no library. Rationale: native gives the accessibility tree a real modal, which `aria-modal` alone does not on every screen reader.
- [x] **2. Where is the keyboard behaviour proven? - RESOLVED (D22, adopted the recommendation; as built the same stories run in the Chromium atlas and in jsdom, which needs no polyfill for Base UI, ADR 0047 and ADR 0048).** Original text: Where is the keyboard behaviour proven? Options: (a) the Chromium atlas `play()` is the proof and the jsdom run skips it (a story parameter) while a minimal polyfill only lets dialogs render; (b) make the jsdom run exercise a JS trap (only possible with mechanism b). Recommendation: (a) with the skip flagged in the story, because CLAUDE.md wants behaviour proven in a real browser anyway. **Reshaped:** jsdom polyfills for Base UI live in `src/test-setup.ts` (foundation Phase 1).
- [x] **3. Escape on a running `WorkDialog` - RESOLVED (D22, adopted the recommendation; delivered, ADR 0048).** Original text: Escape on a running `WorkDialog` with a `cancel` (manuscript import `preparing`).** Options: ignore; act as Cancel; close and keep running. Recommendation: ignore while running (cancel is a deliberate action), work as Close once finished. Note `teleprompter-manuscript-integration.prd.md` has a related "Escape must not silently stop a live session" question; keep the same rule. **Reshaped:** Q3, Q5 and Q6 stand; the `Dialog` wrapper configures Base UI to match (Escape decided via `onOpenChange` reason, backdrop dismissal disabled, initial focus on the body region).
- [x] **4. Running job with no cancel - RESOLVED (owner decision D8 keeps option (a); delivered by Phase 3, ADR 0057).** Build-after-import is on by default (D8), so the blocking, non-cancellable rebuild dialog is on screen after every import and the choice is load-bearing; a later stack (the interaction feedback audit's phase 5, host completion events) may relax it to option (b) with a new ADR. Original text: Running job with no cancel (Story Bible rebuild, import `running`/`committing`).** Options: (a) keep it blocking, show an explicit non-cancellable status line, focus lands on the body/status region so the dialog is never a focus dead end; (b) offer Close and let the job continue in the background (needs the Guide polling loop to survive an unmounted dialog and a non-modal progress indicator); (c) add a real cancel endpoint (Go/Python, out of scope). Recommendation: (a) now, (c) as a separate PRD if wanted. This narrows the old register's "always offer Close or Cancel".
- [x] **5. Initial focus target - RESOLVED (D22, option (c); delivered, ADR 0048).** Original text: Initial focus target. Options: (a) first tabbable (the header Close X); (b) the dismissive action (Cancel); (c) the body region (already `tabIndex={0}`), so screen readers read the message first; an `autoFocus` child (AddNoteDialog's textarea) always wins. Recommendation: (c). (The old register's suggested fix said "focus the first control"; this is a deliberate change.)
- [x] **6. Backdrop click - RESOLVED (D22, none; delivered, ADR 0048).** Original text: Backdrop click. Options: none; only plain `Dialog` with `onClose`; all but `WorkDialog`. Recommendation: none. Escape, Close and Cancel are the dismissal paths; an accidental click on a scrim should not discard a destructive confirm. (The old register listed the missing backdrop click as a gap; this is a deliberate reversal.)
- [x] **7. Scope of the modal mechanism - RESOLVED (D22, option (a); the drawers were delivered by S10a, ADR 0051).** Original text: Scope of the modal mechanism. Options: (a) Dialog family only; (b) also `SlideOver` and the nav drawer in the same PRs. Recommendation: (a); write the behaviour so it is reusable, open a follow-up phase for (b). **Reshaped:** (b) is now foundation Phase 4 (`SlideOver` and the nav drawer on Base UI Drawer); this PRD stays Dialog family only.
- [x] **8. `ConfirmDialog` API and which confirms are destructive - RESOLVED (owner decision D12 confirms the list; delivered, ADR 0048; the six call sites re-checked in stack S11).** Original text: `ConfirmDialog` API and which confirms are destructive. Options: discriminated union (`danger` requires `dangerLabel`) plus `confirmVariant?: 'primary' | 'danger'`. Recommendation: yes; set `danger` on "Clear derived project data", "Remove local preview voice", "Remove local Whisper model", "Delete entry", "Merge & delete source", "Replace and reset". Confirm the list with the user. **Reshaped:** `ConfirmDialog` is built on Base UI AlertDialog (foundation Q3), which also covers the Could item `role="alertdialog"`.
- [x] **9. Ownership overlap - RESOLVED (owner decision D4: the Base UI foundation owns modality; delivered, ADR 0048).** Original text: Ownership overlap. `teleprompter-manuscript-integration.prd.md` Phase 1 also plans Dialog modality plus a `size="full"` variant. Options: (a) this PRD owns modality and that Phase 1 shrinks to the `size` variant and depends on this PRD's Phase 2; (b) the teleprompter PRD owns it. Recommendation: (a), because modality is a defect fix for all consumers, not a feature. `teleprompter-manuscript-integration.prd.md` already assumes (a): its Phase 1 is now only the `size="full"` variant, it plans no modality ADR, and it depends on this PRD's Phase 2; the user confirms.

## Users & Context

**Primary User**
- **Who**: a narrator using the desktop app (Windows, WebView2) who navigates by keyboard or with a screen reader.
- **Current behavior**: opens a confirm or progress dialog, presses Tab and lands on controls behind it, presses Escape and nothing happens, must reach the mouse to close.
- **Trigger**: any modal: import, delete entry, merge, unsaved-settings guard, add note, Story Bible rebuild.
- **Success state**: focus is inside the dialog, Escape dismisses it when dismissal is safe, focus returns to where they were, and the page behind is silent to a screen reader.

**Job to Be Done**: When a dialog interrupts my work, I want to answer it and return to exactly where I was, using only the keyboard.

**Non-Users**: mouse-only narrators are unaffected except for gaining Escape; developers gain a single behaviour to build dialogs on.

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability |
| --- | --- |
| Must | Escape closes when `onClose` exists; initial focus; Tab trap; page behind inert (focus and AT); focus restored on close |
| Must | `WorkDialog` `role="progressbar"` (+ `aria-valuenow` only when determinate), status announcement, `motion-safe:` on the slide animation |
| Must | No dialog state without a focusable control or focus target (empty action row resolved) |
| Must | `ConfirmDialog`: `danger` requires `dangerLabel` (type-level), `confirmVariant`, `body: ReactNode` |
| Should | `aria-labelledby` instead of `aria-label` duplicating the visible `h2`; page scroll lock while open |
| Should | Atlas `play()` for Tab-past-last-control, Escape and focus restore on every dialog story |
| Could | `role="alertdialog"` for destructive confirms; Tooltip layer inside a top-layer dialog |
| Won't (here) | Drawer/SlideOver modality; cancel endpoint; backdrop dismissal; animation |

### MVP Scope

Phases 1-4 below. Phase 5 is the sweep and docs.

### User Flow

1. Keyboard user activates "Delete entity" in Story Bible. The dialog opens, focus lands on the body region, a screen reader reads the title then the message.
2. Tab moves Cancel, Delete entry, Close, body, wrapping; nothing behind is reachable.
3. Escape closes; focus returns to the "Delete entity" button. Enter on Delete entry confirms.
4. For a running Story Bible rebuild the dialog announces progress, states that it cannot be cancelled, focus rests on the body region; when the job finishes Close appears and Escape works.

## Technical Approach

**Feasibility**: MEDIUM. The behaviour is well understood; the risk is the interaction of the mechanism with jsdom (`stories.test.tsx`), the body-level tooltip layer, and three desktop webviews.

**Architecture Notes**
- Behaviour lives only in `Dialog.tsx`; `ConfirmDialog`, `WorkDialog`, `AddNoteDialog` inherit it, matching ADR 0001/0002's "everything goes through `Dialog`".
- Styling stays Tailwind with `var(--…)` tokens (ADR 0009; ADR 0003 is superseded) and the `--backdrop` token from ADR 0010; no new legacy class (guarded by `legacyCss.test.ts`), and no edit to `styles.css`, so this PRD does not contend with the palette PRD. State classes stay mutually exclusive (ADR 0017).
- Mount/unmount model: dialogs are conditionally rendered (`{open && <ConfirmDialog/>}`), so the wrapper opens on mount and restores focus on unmount by capturing `document.activeElement` on mount; if the opener is gone, focus falls back to the page's `main` landmark (delivered, ADR 0048).
- `WorkDialog`: indeterminate (`percent === 0 && running`) omits `aria-valuenow`; message in `role="status"`; keep the `progressbar` marker class that `tests` select (ADR 0009); the fill's transition and slide are `motion-safe:` only (Phase 3).
- Every new behaviour ships as a story `play()` (atlas gate, ADR 0023) and must not grow `A11Y_DEBT`.

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| **Reshaped:** jsdom gaps for Base UI; `stories.test.tsx` runs `play()` in jsdom | High | Polyfills in `src/test-setup.ts` (foundation Phase 1); keyboard stories flagged atlas-only (Q2) |
| **Reshaped:** webview floor for Base UI's browser support | Low-Medium | Tracked by the foundation (ADR 0047); WebView2 is Chromium-based. The original top-layer Tooltip stacking risk no longer applies: Base UI's Dialog is a `div`, not a top-layer `<dialog>` |
| Focus restore target unmounted (opener disappears after the action) | Medium | Fallback to `main`; covered by a test |
| Many dialog screenshots change (the scrim now covers the whole window, ADR 0048) | Medium | PNG review of every dialog state at every viewport (there is no phone viewport, ADR 0037); doc images `home-import-confirm`, `manuscript-add-note`, `home-manuscript-offer`, `home-import-activity` regenerate |
| Screen readers behave differently in WebView2 (UIA) | Medium | One manual NVDA pass; record result in the ADR |
| Escape swallowed by a child (e.g. an open `<select>`) | Low | Only close on Escape when the event was not already handled |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Mechanism spike and ADR | **Moved.** Superseded by foundation Phase 1 (dependency, wrapper convention, jsdom polyfills, spike stories, the single Base UI ADR written after the code lands) | moved | - | - | - |
| 2 | Shared modal behaviour in `Dialog` | **Moved.** Delivered by foundation Phase 2 (Dialog family on Base UI: Escape, initial focus, trap, inert or aria-hidden, focus restore, aria-labelledby; stories `play()`; RTL tests; AddNoteDialog verified); closes defect 2 | moved | No | Foundation 1 | - |
| 3 | `WorkDialog` semantics | progressbar role/value (Base UI `Progress`), status live region, `motion-safe`, no empty action row per Q4; stories per phase; closes defect 3. **Partly delivered by foundation Phase 2 (stack S10a):** progressbar role and `aria-valuenow` (only when determinate), the status/alert live region and Escape-when-finished are done and covered by stories. **Delivered by stack S11 ([ADR 0057](../adr/0057-a-running-job-that-cannot-be-cancelled-keeps-its-dialog-blocking-and-says-so.md)):** `motion-safe:` on the fill's transition and slide (guarded by a unit test on the classes), the "cannot be cancelled" notice as the dialog's description for a running job with no Cancel, and no action row when there is nothing to press (`Dialog` draws none for `actions={null}`) | complete | 4 | Foundation 2 | - |
| 4 | `ConfirmDialog` API | Discriminated `danger`/`dangerLabel`, `confirmVariant`, `body: ReactNode`; mark destructive callers; closes defect 4. **Delivered by foundation Phase 2 (stack S10a)** together with the `alertdialog` role (owner decision D12: the six red confirms are Clear derived project data, Remove local preview voice, Remove local Whisper model, Delete entry, Merge & delete source, Replace and reset), [ADR 0048](../adr/0048-every-dialog-is-one-modal-shell-and-confirms-are-alert-dialogs.md) | complete | 3 | Foundation 2 | - |
| 5 | Sweep and docs | Four-viewport PNG review of every dialog state, `docs/ui` regen, doc-screenshot refresh, `design-system.md` row, manual NVDA pass | pending | No | 3, 4, Foundation 2 | - |

### Phase Details

**Phase 1 - Mechanism spike and ADR.** Goal: pick the mechanism on evidence. Scope: no production change; a throwaway story or branch; measure (a) does the polyfill let `stories.test.tsx` render dialogs, (b) does `showModal` work in each Wails webview, (c) tooltip stacking, (d) Tab behaviour in Chromium. Output: ADR via `adr-author` (amends none; it extends ADR 0001/0002's "one Dialog primitive"), docs-only PR. Success signal: the ADR states the mechanism, the test approach and the fallback.

**Phase 2 - Shared modal behaviour.** Goal: defect 2 gone for all consumers. Scope: `Dialog.tsx`, `Dialog.stories.tsx` (`play()` that tabs past the last control, Escape, restore), `ConfirmDialog.test.tsx`, a consumer test for restore in one real flow (Story Bible delete), `AddNoteDialog` check, optional test setup file. Success signal: atlas green with no new debt; Tab cannot leave; existing dialog screenshots visually unchanged at 4 viewports except intended scrim/UA differences.

**Phase 3 - WorkDialog.** Goal: defect 3 gone. Scope: `WorkDialog.tsx`, stories for every phase incl. `RunningWithoutCancel`, the Home import `cancel` logic in `Home.tsx` only if Q4 changes it. Success signal: axe clean, reduced-motion assertion, no empty action row in any phase.

**Phase 4 - ConfirmDialog.** Goal: defect 4 gone. Scope: `ConfirmDialog.tsx`, tests (type-level via `// @ts-expect-error`), callers in `Settings.tsx`, `GuideDetail.tsx`, `Home.tsx`. Success signal: `pnpm check` type-checks all 12 call sites; destructive confirms use the danger style.

**Phase 5 - Sweep and docs.** Goal: leave nothing stale. Scope: PNG review at desktop, small-desktop, tablet, mobile for `home/import-confirm`, `home/manuscript-candidate-offer`, `manuscript/add-note-dialog`, `storybible/delete-confirm`, `settings/navigate-away-confirm`, `global/confirm-dialog`; `node tools/ui-atlas-kit/plugin/cli/ui-atlas.mjs docs --dir apps/ui`; doc-screenshot-sync (the guide is now the multi-page `docs/guides/using-the-app/`, whose index, links and screenshot embeds `apps/ui/src/docsGuide.test.ts` guards); `visual-catalog-sync` if states changed.

### Parallelism Notes

Phases 3 and 4 are disjoint files and can run concurrently after 2 (both touch `Dialog.stories.tsx`-adjacent stories only via their own files). Phase 1 is docs-only and can start immediately.

### Parallel-session compatibility

Files owned: `primitives/Dialog.tsx`, `ConfirmDialog.tsx`, `WorkDialog.tsx` and their `.stories.tsx`/`.test.tsx`; `manuscript/AddNoteDialog.tsx`; call-site edits in `Home.tsx` (Phase 3/4), `Guide.tsx`, `GuideDetail.tsx`, `Settings.tsx` (Phase 4, only `ConfirmDialog` props); optional new `vitest` setup file; the ADR; the Status cells of this PRD's phase table. Does NOT touch `styles.css`, `Tooltip.tsx`, `MeterBar.tsx`, `NavButton.tsx`, `Highlight.tsx`, `ScopedSetting.tsx`, `tests/visual/*` or the ui-atlas-kit.
- Can run concurrently with: the a11y-components PRD (`Tooltip`/`MeterBar`/`Field`/`Heading`/`Panel`; disjoint), the settings-layout PRD (only overlap is `Settings.tsx`, different regions; second to merge rebases), the test-stability PRD's Go and frontend-test phases.
- Do not run concurrently with: foundation Phase 2 (`base-ui-primitive-foundation.prd.md`, same `Dialog.tsx`, `ConfirmDialog.tsx`, `WorkDialog.tsx`; Phases 3 and 4 here follow it), the palette PRD's debt-removal phase if it has not waited for Phase 3 (WorkDialog's `A11Y_DEBT` entry and its markup both change; the palette PRD's final phase lands after this one), and `teleprompter-manuscript-integration.prd.md` Phase 1 (same `Dialog.tsx`; resolve ownership per Q9 first).
- Generated/shared files that always conflict: `docs/ui/**` (re-run the generator on rebase), `docs/images/ui/*.webp` (regenerate after rebase, never merge binaries).

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| All dialogs go through one `Dialog` primitive (prior decision, ADR 0001/0002) | Behaviour lives in `Dialog` only | Per-dialog logic | Consumers inherit fixes |
| Dialog width 70vw, `overflow-x-hidden` + `break-words` body (prior decision, ADR 0001) | Unchanged | - | Not re-litigated |
| Cancel on the opposite side from affirmative actions; `actionsAlign="end"` for WorkDialog (prior decision, ADR 0002) | Unchanged | - | Not re-litigated |
| Tailwind utilities referencing `var(--token)`, no new legacy CSS (prior decision, ADR 0009; ADR 0003 superseded) | Any dialog styling is Tailwind | New CSS classes | Guarded by `legacyCss.test.ts` |
| Single `--backdrop` scrim token (prior decision, ADR 0010) | Keep | Per-dialog scrims | Theme consistency |
| Mutually exclusive state classes (prior decision, ADR 0017) | Keep | Base + override | Stylesheet-order bugs |
| Atlas is the gate; debt list may only shrink; keyboard gaps were noted, not fixed (prior decision, ADR 0023) | Fix them and add `play()` proof | Leave noted | This PRD |
| Nothing merges without the user (prior decision, CLAUDE.md) | Each phase is a PR for review | - | - |
| Mechanism (owner decision 2026-09-20; was: native `<dialog>` after a spike) | Base UI Dialog/AlertDialog behind our `Dialog`/`ConfirmDialog` wrappers | Native `<dialog>`, hand-rolled trap plus `inert`, Radix, React Aria | Q1; hand-rolling is extra work to get behaviour and accessibility right |
| ADR for the mechanism | Written by foundation Phase 1 after the code lands, not by this PRD | One ADR per PRD | One decision, one ADR (docs/adr/README.md rule 3) |
| Escape ignored while a cancellable job runs; backdrop click off (adopted, D22; ADR 0048) | As stated | Escape cancels; backdrop dismiss | Q3, Q6 |
| Non-cancellable jobs stay blocking with an honest status (owner decision D8; ADR 0057) | Blocking, with "This step cannot be cancelled. Close appears when it finishes." as the dialog's description and no empty action row | Close-and-continue (needs completion events, the interaction audit's phase 5); a cancel binding (Go and Python) | Q4; build-after-import is on by default (D8), so the dialog is on screen after every import; a later stack may relax it with a new ADR |
| Initial focus on the body region; Escape only when the dialog has somewhere to go; the scrim never dismisses (adopted, D22; ADR 0048) | As stated | First control; Cancel; backdrop dismiss | Q5, Q3, Q6 |
| Modality is owned by the Base UI foundation, not by the teleprompter PRD (owner decision D4) | ADR 0048 | Teleprompter phase 1 owns it | Q9 |
| The six red confirms (owner decision D12) | `confirmVariant="danger"` on Clear derived project data, Remove local preview voice, Remove local Whisper model, Delete entry, Merge and delete source, Replace and reset | More or fewer | Q8; delivered by S10a and re-checked in S11 |
| Reduced motion for the progress fill is guarded by a unit test, not the atlas (ADR 0057) | `WorkDialog.test.tsx` asserts the `motion-safe:` classes | An atlas computed-style assertion | The Storybook preview turns every animation off, so a story cannot show it |

## Research Summary

**Market Context**: the WAI-ARIA Authoring Practices "Dialog (Modal)" pattern requires initial focus inside, a Tab loop, Escape to close, and focus return to the invoker; `aria-modal` alone is inconsistently honoured by screen readers, which is why the library hides the page behind with `aria-hidden` and traps focus. The mechanism is Base UI ([ADR 0047](../adr/0047-the-ui-primitives-wrap-base-ui-and-app-code-never-imports-it.md)).

**Technical Context**: primitives in `apps/ui/src/components/primitives/`; consumers listed under Evidence; verification per CLAUDE.md (plan, change-impact-scan on every `Dialog` consumer, TDD, `pnpm check`, `pnpm --dir apps/ui atlas`, Playwright visual suite with PNG review at all four viewports, design-spec-guard, feature-cleanup); `docs/ui/` regenerated with `node tools/ui-atlas-kit/plugin/cli/ui-atlas.mjs docs --dir apps/ui`; mark each phase `complete` in the same PR that lands it.

---

*Generated: 2026-09-19*
*Status: DRAFT - needs validation*
