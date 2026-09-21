# Component Accessibility: MeterBar, Tooltip, Field, Heading, Panel

**Supersedes:** `docs/design/known-ui-defects.md` (defect 5 [medium], defect 6 [medium], defect 7 [low]; the file's last revision is `b613933`, recover it with `git show b613933:docs/design/known-ui-defects.md`)

**Reshaped by:** the Base UI foundation ([ADR 0047](../adr/0047-the-ui-primitives-wrap-base-ui-and-app-code-never-imports-it.md); its PRD is delivered and deleted). Owner decision 2026-09-20: `Tooltip` and `Field` are built on Base UI behind our own wrappers instead of hand-written id wiring and child cloning. `MeterBar`, `Heading` and `Panel` stay custom. Where this PRD's Open Questions describe a hand-rolled mechanism (Q2, Q3, Q7, Q8), the notes marked "Reshaped" below win.

**Where it stands (stack S11, tracking issue #117):** defects 5 and 6 and the `Field` part of defect 7 are closed by stack S10a ([ADR 0049](../adr/0049-hints-are-base-ui-tooltips-that-meet-wcag-1-4-13-and-info-icons-are-buttons.md), [ADR 0050](../adr/0050-the-segmented-meter-is-an-image-named-by-its-segments-and-field-wires-its-hint-and-error.md)). `Heading` `level` and `Panel` `title`/`actions` are Phase 3, and Phase 4 is the sweep and the adoption of the `Panel` title at the call sites that hand-build one; the last of them deletes this PRD. The inline (flowing text) tooltip of Q8 was not built by S10a because nothing uses it: it moves to the teleprompter flags phase ([teleprompter-manuscript-integration](teleprompter-manuscript-integration.prd.md) Phase 7), which needs it and adds it to `TooltipTarget` (an `inline` option, or `render` on the trigger). The Evidence section is the record of the defects as found.

## Problem Statement

Five shared primitives have accessibility gaps that every page inherits: `MeterBar` means nothing to a screen reader, the `Tooltip` info icon and every tooltip target point at an element id that does not exist (and the icon is unreachable by keyboard), and `Field`, `Heading` and `Panel` cannot express an error, a heading level or a named region. Narrators who navigate by keyboard or screen reader miss the explanatory text behind the info icons and the recording-progress breakdown; developers keep working around the gaps page by page. The `Tooltip` fix is also a hard prerequisite for the planned teleprompter flagged-word review, which is designed around `TooltipTarget`.

## Evidence

Verified against `b9d348d` and re-checked at `d5cc994` (main after #42); this is the state before stack S10a, and each item carries what became of it. Severity in the retired defects register (scale: high blocks a user or fails a standard outright, medium degrades an experience, low is polish or hygiene): `MeterBar` medium, `Tooltip` medium, `Field`/`Heading`/`Panel` low.

- `MeterBar.tsx`: wrapper `div` with no role/label; each segment is a `TooltipTarget` span (so it carries `aria-describedby="tooltip-layer"`), never focusable; `transition-[flex-basis] duration-300` has no `motion-safe:` guard (also called out in `docs/design/motion-and-animation.md`). Single consumer: `home/AudiobookEstimatePanel.tsx`. **Fixed by S10a** (ADR 0050): defect 5. That call site already renders a visible caption ("N of M chapters finalized") and a legend, and each segment's `tooltip` string already holds the breakdown ("Finalized: 4 chapters · ~2h 10m finished audio"), so a text alternative can be composed without new copy.
- `Tooltip.tsx`: `TooltipTarget` sets `aria-describedby={shared || local ? 'tooltip-layer' : undefined}` on its wrapper span. With `TooltipProvider` mounted (`App.tsx:183`, and the Storybook decorator) `shared` is always defined, so every target permanently references `tooltip-layer`, which exists only while one tooltip shows, and all targets share that id. The reference sits on the wrapper span, not on the focusable child, so even while shown it is not associated with the button that has focus. `Tooltip`'s info icon is `<span aria-label="More information">` with no `tabIndex` or role. A disabled child gets a wrapper with `tabIndex=0` but no role or name. `ActiveTooltip.key = Date.now()` is written in three places and never read. Confirmed defect 6. `Tooltip.test.tsx` asserts `id === 'tooltip-layer'`, so it changes with the fix.
- Not in the old register: a tooltip cannot be dismissed with Escape, and it is `pointer-events-none`, so it is not hoverable (WCAG 1.4.13 asks for dismissible, hoverable, persistent). **Fixed by S10a** (ADR 0049, owner decision D6).
- Reach: `TooltipTarget` or `Tooltip` appears in 12 non-story files (`AudiobookEstimatePanel`, `Home`, `EntitySummary`, `Manuscript`, `MeterBar`, `NavButton`, `Pill`, `Results`, `Transcript`, `ScopedSetting`, `Guide`, `GuideDetail`); `Tooltip` (the icon) in 4 (`AudiobookEstimatePanel`, `Manuscript`, `Transcript`, `ScopedSetting`). Visual drivers depend on current markup: `getByLabel('More information')` (`home/info-tooltip`, `global/tooltip`) and `span[tabindex="0"]:visible:has(button:disabled)` (`proofing/disabled-button`).
- `Field.tsx` (38 lines): no `aria-invalid`, `aria-describedby`, hint or error slot. One consumer (`GuideDetail.tsx`); its control classes are duplicated in `ScopedSetting.tsx` (`controlClass`) and `AddNoteDialog.tsx`. **Fixed by S10a** (ADR 0050); the duplicated controls were then replaced by the text-field primitives (ADR 0053). Assumption - needs validation: any current form actually needs an inline error (no consumer validates inline today).
- `Heading.tsx` (fixed by Phase 3): always `<h1>`; 7 consumers (`Home`, `Manuscript`, `Transcript`, `Settings`, `Guide`, `TeleprompterPage`, `TracksPage`); the optional subtitle `<p>` has no overflow-wrap. The old register's claim that a long unbroken subtitle overflows at 390px is plausible but unproven (`LongSubtitleWraps` uses spaces); add a story with an unbroken token before asserting it.
- `Panel.tsx` (fixed by Phase 3): a bare `<section>` with no name or slot; 4 consumers (`AudiobookEstimatePanel`, `Transcript`, `TeleprompterPage`, `TracksPage`). Callers hand-build an `<h2>` inside it (`Panel.stories.tsx` shows the pattern).
- Teleprompter dependency (verified in `docs/architecture/manuscript-teleprompter.md`, "flagged word" design, and in the retired `docs/architecture/teleprompter-manuscript-integration.md` brief's phase 4, recoverable with `git show d5cc994:docs/architecture/teleprompter-manuscript-integration.md`; that plan is now `teleprompter-manuscript-integration.prd.md`): a flagged word is `<mark role="button" tabIndex>` wrapped in `TooltipTarget` showing what was heard. With today's `TooltipTarget` that wrapper is an `inline-flex` box (cannot wrap across lines inside running text), positions from `currentTarget.getBoundingClientRect()`, and puts the description on the wrapper rather than the mark. `teleprompter-manuscript-integration.prd.md` Phase 7 therefore depends on this PRD's Phase 1.
- `A11Y_DEBT` `Primitives/MeterBar` is a contrast entry caused by the story caption's faint text, not by `MeterBar`; it belongs to the palette PRD.

## Proposed Solution

Fix each primitive at its source, additively. `Tooltip`: make the info icon a real focusable `<button>` opening a popover, build the hint on Base UI so the description and its ids are wired by the library, dismiss on Escape, drop the dead `key` (all delivered by S10a; the flowing inline text moves to the teleprompter flags phase). `MeterBar`: give it a text alternative built from a required label plus the segment strings, and gate its transition on `motion-safe:`. `Field`, `Heading`, `Panel`: add optional props (`hint`/`error` with `aria-invalid`/`aria-describedby`; `level`; `title`/`actions` with `aria-labelledby`) that leave every current call site unchanged.

## Key Hypothesis

We believe giving these primitives correct semantics at the source will let keyboard and screen-reader narrators reach every explanation and progress figure the app shows, and let developers build the teleprompter flag review without inheriting broken tooltips. We'll know we're right when every `aria-describedby` in stories and app states resolves to an existing element (or is absent), the info icon is reachable with Tab and shows its text, `MeterBar` exposes a readable name and value, axe stays clean, the teleprompter PRD can start Phase 7 on it, and defects 5, 6 and 7 are closed (Phases 1-3 `complete`).

## What We're NOT Building

- Hand-written id wiring, child cloning or focus code for `Tooltip` and `Field`: those come from Base UI behind the wrappers (owner decision 2026-09-20; see the foundation PRD). `MeterBar` stays custom because Base UI's Meter is single-value.
- Focusable `MeterBar` segments (many tab stops for information the text alternative already carries).
- Migrating `ScopedSetting`/`AddNoteDialog` raw inputs to `Field` - separate refactor.
- A motion-token system (`motion-and-animation.md` stays a proposal); only the `motion-safe:` guard.
- A rich or interactive tooltip (links, buttons inside) - would need a popover pattern; not needed today.
- Dialog modality or `WorkDialog` semantics (the dialog PRD) and palette contrast (the palette PRD).
- Adopting the new `Panel`/`Heading` props at every call site in the same PRs (optional follow-up).

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Dangling `aria-describedby` / id references | 0 in all stories and Tooltip/MeterBar unit tests | New shared test helper asserting every `aria-describedby` id resolves; atlas |
| Info icon reachability | Tab reaches it, tooltip shows on focus, Escape hides it | Story `play()` with `userEvent.tab()`; Tooltip test |
| `MeterBar` accessible name and value | Announced as the composed label | RTL `getByRole` assertion; axe |
| Reduced motion | No `flex-basis` transition under `prefers-reduced-motion: reduce` | Unit test on the `motion-safe:` classes (the Storybook preview turns animation off, so the atlas cannot show it; ADR 0057) |
| Existing call sites unchanged | 0 visual diffs at 4 viewports for the 12 Tooltip consumers | `pnpm --dir apps/ui screenshots` + PNG review; the two Tooltip drivers still pass |
| Atlas health | No new `A11Y_DEBT` entries; existing entries not extended | `src/atlasCoverage.test.ts` |
| Defects closed | Defects 5, 6, 7 closed: Phases 1, 2, 3 marked `complete` in this PRD | Review |

## Open Questions

- [x] **1. What is a `MeterBar` semantically? - RESOLVED (D22, option (b); delivered by S10a, ADR 0050).** Original text: What is a `MeterBar` semantically? Options: (a) `role="meter"` with a single value (a segmented multi-status bar has no single scalar, so it under-describes); (b) `role="img"` with an `aria-label` composed from a required `label` prop plus the segment tooltip strings; (c) a visually hidden list of segments. Recommendation: (b). Segments stay pointer-only tooltips because the text alternative carries the same information.
- [x] **2. How does a tooltip attach its description? - RESOLVED (owner decision D1, Base UI; delivered by S10a, ADR 0049).** Original text: How does a tooltip attach its description? Options: (a) clone the single child element and inject `aria-describedby` (and use the child's rect); keep a wrapper only for non-element children and disabled buttons; (b) keep the wrapper and add `role="group"`; (c) wrap with `display: contents` (breaks `getBoundingClientRect`). Recommendation: (a). It is also what inline flagged words need. **Reshaped (2026-09-20):** Base UI `Tooltip.Trigger` with `render` attaches the description and handles the id wiring, so there is no hand-written cloning; the `Tooltip` wrapper exposes it. Inline flagged words use `render={<mark />}` (also covers Q8).
- [x] **3. Info icon as a real button? - RESOLVED (owner decision D6: a real button opening a popover; delivered by S10a, ADR 0049; the longer Settings tab order is accepted).** Original text: Info icon as a real button? Options: (a) `<button type="button" aria-label>` (adds a tab stop per icon; Settings has one per field); (b) keep a span and expose the text with `aria-description`/`title`. Recommendation: (a); one extra tab stop per explanation is the price of keyboard access. Confirm the user accepts longer tab order on Settings. **Reshaped (2026-09-20):** Base UI's docs treat Tooltip as sighted-only and recommend Popover for info icons; the foundation PRD's Q4 recommends a real button opening a Base UI Popover, keeping `aria-label="More information"`. The tab-stop trade-off is unchanged.
- [x] **4. How far to go on WCAG 1.4.13? - RESOLVED (owner decision D6: formal conformance, hoverable, persistent and Escape-dismissible; delivered by S10a, ADR 0049).** Original text: How far to go on WCAG 1.4.13? Options: (a) Escape dismiss only; (b) also make the tooltip hoverable and persistent (remove `pointer-events-none`, keep open while the pointer is over it); (c) neither. Recommendation: (a) now; (b) only if the user wants formal 1.4.13 conformance. **Reshaped:** check Base UI's hoverable-popup default (TBD - needs research, tracked in the foundation PRD) before choosing; it may already satisfy (b).
- [x] **5. `Heading` level API - RESOLVED (D22, option (a): a `level` of 1, 2 or 3, default 1, the tag only; delivered by Phase 3).** Original text: `Heading` level API. Options: (a) `level?: 1 | 2 | 3` (default 1) that changes the tag only, visuals unchanged; (b) tag plus a `size` prop; (c) a separate `SectionHeading`. Recommendation: (a); add `size` only when a caller needs a different look.
- [x] **6. `Panel` API - RESOLVED (D22, option (a): `title` renders an `<h2>` linked by `aria-labelledby`, `actions` in the header row; delivered by Phase 3, adopted at the call sites by Phase 4).** Original text: `Panel` API. Options: (a) `title?: string` renders an `<h2>` linked with `aria-labelledby`, plus `actions?: ReactNode` in a header row; (b) `label` (aria-label only); (c) no change. Recommendation: (a), additive, adoption at call sites deferred.
- [x] **7. `Field` error/hint now or on first need? - RESOLVED (D22, option (a) on Base UI `Field`; delivered by S10a, ADR 0050).** Original text: `Field` error/hint now or on first need? Options: (a) add `hint`, `error`, `aria-invalid`, `aria-describedby` now (cheap, listed defect); (b) wait for a consumer (YAGNI). Recommendation: (a) at Could priority in the last phase, so it can be dropped if scope tightens. **Reshaped (2026-09-20):** build `Field` on Base UI `Field` (Root, Label, Control, Description, Error); `aria-invalid` and `aria-describedby` come from the library, so this stops being hand-wiring and moves to foundation Phase 3.
- [x] **8. Inline mode for flowing text - RESOLVED (D22, adopted with a change: not built by S10a because nothing uses it; the teleprompter flags phase, teleprompter-manuscript-integration Phase 7, adds it to `TooltipTarget` when it needs it).** Original text: Inline mode for flowing text. Options: (a) `TooltipTarget` supports `as="span"` with `display: inline` and measures the child; (b) leave inline use to the teleprompter phase. Recommendation: (a) in this PRD's Phase 1, because it is the same code path as Q2.

## Users & Context

**Primary User**
- **Who**: a keyboard-only or screen-reader narrator (Windows, WebView2); secondarily the developer building teleprompter flags, findings review and new pages on these primitives.
- **Current behavior**: Tab skips every info icon; a screen reader announces a description reference to nothing; the recording-progress bar is silent; page headings are all level 1.
- **Trigger**: reading Settings explanations, checking Home recording progress, reviewing a flagged word in the teleprompter.
- **Success state**: every explanation is reachable and dismissible from the keyboard, the progress bar is announced with its breakdown, sections are named.

**Job to Be Done**: When the app explains or summarises something visually, I want the same information available to my keyboard and screen reader.

**Non-Users**: mouse-only narrators see no change; the mobile nav and dialog modality are other PRDs.

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability |
| --- | --- |
| Must | Unique tooltip id, referenced from the focusable child only while shown; drop `ActiveTooltip.key` |
| Must | Info icon is a focusable button with `aria-label`; tooltip shows on focus |
| Must | `MeterBar` text alternative and `motion-safe:` transition |
| Should | Tooltip dismisses on Escape; inline (flowing text) mode; disabled-child wrapper gets a role/name |
| Should | `Heading` `level`; `Panel` `title`/`actions` with `aria-labelledby` |
| Could | `Field` `hint`/`error`/`aria-invalid`; hoverable tooltip; adopt `Panel` title at call sites |
| Won't (here) | Focusable meter segments; `Field` migration of raw inputs; motion tokens |

### MVP Scope

Phases 1-3; Phase 4 is sweep and adoption.

### User Flow

1. On Settings the narrator tabs to the info icon next to "Default Whisper model"; the tooltip appears immediately; Escape hides it; the field's own tab stop is unaffected.
2. On Home a screen reader lands on the recording-progress bar and reads "Recording progress: Finalized 4 chapters, Proofing 2 chapters, ..." from the composed label.
3. In the teleprompter (later) Tab moves between flagged words; each announces what was heard.

## Technical Approach

**Feasibility**: HIGH. All five are small, self-contained files with existing stories and tests; the only cross-cutting risk is the `Tooltip` markup contract that visual drivers and 12 consumers rely on.

**Architecture Notes**
- Keep everything Tailwind with `var(--token)` classes (ADR 0009); no new legacy CSS (`legacyCss.test.ts`); state classes mutually exclusive (ADR 0017). `motion-safe:` is a Tailwind variant, so `styles.css` is not touched.
- `TooltipTarget` (delivered by S10a, ADR 0049): a Base UI Tooltip around its child, so the library wires the ids and the position; the disabled-button case keeps a `tabindex="0"` wrapper (the `proofing/disabled-button` driver selects it) with `role="group"` and the reason as its name.
- `MeterBar`: required `label`; `role="img"` `aria-label` = label + ": " + segments' tooltip strings (delivered, ADR 0050). ADR 0006 (caller controls segment order) is untouched.
- `Heading` and `Panel` (Phase 3): additive props (`level`; `title` with `actions`) that leave every current call site unchanged; `Panel`'s `useId` links the `<h2>` and the section.
- Tests: `primitives/ariaReferences.ts` asserts every `aria-describedby`/`aria-labelledby`/`aria-controls` id resolves (delivered, ADR 0049); stories carry `play()` for keyboard reach.

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Base UI `Tooltip.Trigger` `render` prop needs children that forward props/refs | Medium | Delivered and covered (ADR 0049). |
| Visual drivers or PNGs shift (icon becomes a button, focus ring) | Medium | Reset button styles to the current look; run the visual suite for `home/info-tooltip`, `global/tooltip`, `proofing/disabled-button`, `global/nav-rail-tooltip` at all viewports |
| More tab stops lengthen Settings navigation | Low | Accept per Q3, or revisit |
| Composed meter label too long for a screen reader | Low | Cap to segment count (5 statuses) |
| Escape handler fights dialog Escape (dialog PRD) | Low | Tooltip handles Escape only while shown and stops propagation only in that case |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Tooltip reachability | Delivered by foundation Phase 3 (Tooltip on Base UI: focusable info button/Popover, unique ids, Escape, inline mode via `render`, drop `key`, tests and stories); closes defect 6. **Delivered by foundation Phase 3a (stack S10a, [ADR 0049](../adr/0049-hints-are-base-ui-tooltips-that-meet-wcag-1-4-13-and-info-icons-are-buttons.md)):** the info icon is a button with a popover (hover, keyboard focus, press, Escape), tooltips are hoverable and persistent (Q4 answered: formal WCAG 1.4.13, owner decision D6), no dangling ids, the dead `key` is gone. **Not built:** the inline (flowing text) mode, which nothing uses yet; the teleprompter flags PRD adds it | complete | 2, 3 | Foundation 1 | - |
| 2 | MeterBar semantics | `label` + composed `role="img"`, `motion-safe:` transition, `AudiobookEstimatePanel` wiring, stories; closes defect 5 (stays custom; no Base UI dependency). **Delivered by foundation Phase 3b (stack S10a, [ADR 0050](../adr/0050-the-segmented-meter-is-an-image-named-by-its-segments-and-field-wires-its-hint-and-error.md))** | complete | 1, 3 | - | - |
| 3 | Field / Heading / Panel | `Heading` `level` and `Panel` `title`/`actions` as written; `Field` `hint`/`error`/`aria-invalid` delivered by foundation Phase 3 on Base UI `Field`; additive, stories and tests; closes defect 7. **Partly delivered:** `Field` (foundation Phase 3b, [ADR 0050](../adr/0050-the-segmented-meter-is-an-image-named-by-its-segments-and-field-wires-its-hint-and-error.md)). **Delivered by stack S11:** `Heading` `level` (1, 2 or 3; the tag only) and `Panel` `title`/`actions` (an `<h2>` and `aria-labelledby`), with tests and stories. The story with an unbroken-token subtitle proved the old overflow claim (a long file name pushed the page 449 px sideways at the narrow viewport), so `Heading`'s subtitle now wraps anywhere | complete | 1, 2 | Foundation 1 (Field only) | - |
| 4 | Sweep and adoption | PNG review of all Tooltip consumers, `docs/ui` regen, `design-system.md`, optional `Panel` title adoption at 4 call sites. **Adoption delivered by stack S11 ([ADR 0058](../adr/0058-heading-has-a-level-and-panel-names-its-region-with-a-level-2-title.md))** at the four call sites that hand-built a title (Proofing chapter choice, Teleprompter empty state, the two Tracks prompts); the Tracks states are pixel-identical. **Remaining:** the sweep and docs, in the last PR of the stack | pending (partial) | No | 1, 2, 3 | - |

### Phase Details

**Phase 1 - Tooltip reachability.** Goal: defect 6 gone and the teleprompter prerequisite met. Scope: `Tooltip.tsx`, `Tooltip.test.tsx`, `Tooltip.stories.tsx`; verify (change-impact-scan) `NavButton`, `Pill`, `MeterBar`, `EntitySummary`, `Manuscript`, `Home`, `Results`, `Transcript`, `Guide`, `GuideDetail`, `ScopedSetting`, `AudiobookEstimatePanel`. Success signal: no dangling ids, Tab shows the tooltip, the two drivers still work, PNGs unchanged at four viewports. **Reshaped:** no ADR here; the single Base UI ADR is written by foundation Phase 1. The Q3 tab-stop decision (the info icon becomes a tab stop) is still recorded, in that Phase 3 PR's description and `design-system.md`, because 12 consumers and the teleprompter flagged-word design rely on the `TooltipTarget` contract.

**Phase 2 - MeterBar.** Goal: defect 5 gone. Scope: `MeterBar.tsx`, `MeterBar.stories.tsx`, `AudiobookEstimatePanel.tsx` (pass `label`). Success signal: `getByRole('img', { name: /Recording progress/ })`, reduced-motion assertion, `home` states unchanged visually.

**Phase 3 - Field / Heading / Panel.** Goal: defect 7 gone, additively. Scope: the three primitives, stories (add an unbroken-token subtitle story to prove or disprove the overflow claim), tests. Success signal: all 7 `Heading`, 4 `Panel`, 1 `Field` consumers compile and render identically.

**Phase 4 - Sweep and adoption.** Goal: nothing stale. Scope: visual suite PNG review, atlas docs regen (`node tools/ui-atlas-kit/plugin/cli/ui-atlas.mjs docs --dir apps/ui`), `docs/design/design-system.md` primitives table (add Tooltip, WorkDialog, note reduced motion in `motion-and-animation.md`), doc-screenshot-sync only if a doc image changed. Success signal: `pnpm check` and atlas green.

### Parallelism Notes

Phases 1-3 touch disjoint files and can be developed concurrently; merge order preference 1, 2, 3 (Phase 2's segments render `TooltipTarget`).

### Parallel-session compatibility

Files owned: `primitives/Tooltip.tsx` (+test, stories), `MeterBar.tsx` (+stories), `Field.tsx`, `Heading.tsx`, `Panel.tsx` (+stories), `home/AudiobookEstimatePanel.tsx` (Phase 2 wiring; Phase 4 optional `Panel` title), optionally `TracksPage.tsx`, `Transcript.tsx`, `TeleprompterPage.tsx` (Phase 4 adoption only), the Status cells of this PRD's phase table. Does NOT touch `styles.css`, `Dialog*`, `WorkDialog`, `ConfirmDialog`, `NavButton.tsx`, `Highlight.tsx`, `ScopedSetting.tsx`, `tests/visual/*`, the ui-atlas-kit.
- Can run concurrently with: the dialog PRD (disjoint; only the Tooltip-in-dialog stacking follow-up crosses over), the palette PRD (disjoint files; both regenerate `docs/ui/**`), the settings-layout PRD (`ScopedSetting.tsx` renders `Tooltip` but is not edited here), the test-stability PRD's Go/frontend-test phases.
- Sequencing with other work: `teleprompter-manuscript-integration.prd.md` Phase 7 (flags UI) must start after Phase 1 here, which is delivered by foundation Phase 3 (`base-ui-primitive-foundation.prd.md`); Phases 1 and 3 here collide with foundation Phase 3 on `Tooltip.tsx` and `Field.tsx`, so run them as one stream; `review-dashboard-and-findings-adoption.prd.md` new primitives should use the fixed Tooltip. Phase 4's `Panel` adoption edits `TeleprompterPage.tsx`, which teleprompter phases also edit; keep it optional and rebase.
- Generated/shared files that always conflict: `docs/ui/**`, `docs/images/ui/*.webp`, `docs/design/design-system.md` (Phase 4 edits the primitives table; the dialog and palette PRDs edit other rows).

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Segment order is caller-controlled; chapter progress reverses status order (prior decision, ADR 0006) | Unchanged | Component-owned order | Not re-litigated |
| Tailwind utilities with `var(--token)` classes, no legacy CSS (prior decision, ADR 0009) | `motion-safe:` and token classes only | New CSS in `styles.css` | Guarded by `legacyCss.test.ts` |
| Mutually exclusive state classes (prior decision, ADR 0017) | Keep | Base + override | Stylesheet-order bugs |
| One `Highlight` primitive for highlighted text (prior decision, ADR 0016) | Teleprompter flags reuse it; only the tooltip wrapper changes here | New flagged-word component | Consistency |
| Atlas gate; debt list may only shrink; a11y gaps were noted not fixed (prior decision, ADR 0023) | Fix and add `play()` proof | Leave noted | This PRD |
| Reduced motion for MeterBar is wanted but unbuilt (prior decision, `motion-and-animation.md`) | Do it with `motion-safe:` now (delivered, ADR 0050) | Wait for a motion system | Cheapest correct step |
| Nothing merges without the user (prior decision, CLAUDE.md) | One PR per phase | - | - |
| MeterBar is `role="img"` with a composed label (proposed) | (b) | `role="meter"`, hidden list | Q1 |
| Description attaches through Base UI `Tooltip.Trigger` `render` (owner decision 2026-09-20; was: cloned child) | Base UI behind our `Tooltip` wrapper | Hand-written cloning, wrapper, `display: contents` | Q2; hand-rolling is extra work for behaviour and accessibility |
| Info icon is a real button opening a Base UI Popover (proposed in foundation Q4; was: button + tooltip) | Button + Popover | span + `aria-description` | Q3; Base UI documents Tooltip as sighted-only |
| Mechanism for `Tooltip` and `Field` is Base UI (owner decision 2026-09-20) | ADR 0047, ADR 0049, ADR 0050 | Radix, React Aria, hand-rolled | One library behind our own primitives |
| Tooltips meet WCAG 1.4.13 formally (owner decision D6) | Hoverable, persistent, Escape-dismissible; info icon is a button with a popover (ADR 0049) | Escape only | Q3, Q4 |
| `Heading` `level` changes the tag only (D22, Q5) | `level` of 1, 2 or 3, default 1, same look | A `size` prop; a `SectionHeading` | Add `size` when a caller needs a different look |
| `Panel` `title` is a level-2 heading and names the region (D22, Q6) | `title`, and `actions` only with a title | `label` (aria-label only); a `level` prop | A panel sits beneath the page's `<h1>`; YAGNI on the level |
| Inline (flowing text) tooltip is not built here (D22, Q8, changed) | Deferred to teleprompter-manuscript-integration Phase 7 | Build it now with no caller | Nothing uses it yet; the flags phase needs it and adds it |
| A long unbroken subtitle wraps anywhere (found by the story that proves the claim) | `[overflow-wrap:anywhere]` on the `Heading` subtitle and the `Panel` title | Leave it | The story overflowed 449 px at the narrow viewport before the fix |

## Research Summary

**Market Context**: WAI-ARIA describes `aria-describedby` as an id reference that must resolve; the tooltip pattern requires the trigger to be focusable and the tip dismissible with Escape; WCAG 1.4.13 (content on hover or focus) asks for dismissible, hoverable, persistent. `role="meter"` models a scalar within a range, which is why a segmented status bar fits `role="img"` better.

**Technical Context**: consumers are listed under Evidence (run `change-impact-scan` before each phase); atlas and story tests in `apps/ui/src/components/primitives/*.stories.tsx`; drivers at `apps/ui/tests/visual/app.drivers.ts` lines ~122, ~235, ~496; verification per CLAUDE.md (plan, change-impact-scan, TDD, `pnpm check`, `pnpm --dir apps/ui atlas`, Playwright visual suite with PNG review at all four viewports, design-spec-guard, feature-cleanup); `docs/ui/` regenerated with `node tools/ui-atlas-kit/plugin/cli/ui-atlas.mjs docs --dir apps/ui`.

---

*Generated: 2026-09-19*
*Status: DRAFT - needs validation*
