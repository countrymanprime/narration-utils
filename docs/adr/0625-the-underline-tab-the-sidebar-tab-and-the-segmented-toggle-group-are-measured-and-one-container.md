# 0625. The underline tab, the sidebar tab and the segmented `ToggleGroup` are measured, and the segmented look is one container

**Status:** Proposed (Phase 5 of the mock fidelity PRD, stream F-P5 on [#509](https://github.com/countrymanprime/narration-utils/issues/509))
**Date:** 2026-09-28
**Supersedes:** [ADR 0440](0440-master-and-qcs-platform-tabs-are-the-projects-delivery-profile-and-the-page-draws-only-what-the-host-measures.md) point 2 (the Master platform switch draws with `ToggleGroup look="segmented"`, not the default chip look it called "no primitive changes")
**Amends:** [ADR 0054](0054-tabs-and-toggle-groups-name-and-link-what-the-hand-built-strips-left-anonymous.md) (`Tabs` and `ToggleGroup` gain the measured spec and a `look`; the roles, links and keyboard behaviour it decided are unchanged)

## Context

D91 on #509: the owner saw the Production board's pills as one thing that wasn't uniform, and the mock fidelity audit found the same style drift in every primitive, tabs and toggle groups included. The benchmark mocks (`docs/research/mockups/audiobook-studio-benchmark/`, D92) were measured again for this phase, at 1440 px:

| Shape | Where (mock) | Measured |
| --- | --- | --- |
| Underline tab | Script prep rail categories (02) | selected text `--accent-strong`, not `--text` (the dark sets draw it muted or `--text`, and the benchmark wins, Q1 on the mock fidelity PRD); 2 px `--accent` underline over a 1 px `--border` rule, spanning the label plus ≈10 px each side; Barlow Condensed ≈13 px 600, tracking ≈0.06 em (`--tracking-button`); ≈25 px between labels |
| Sidebar tab | Settings categories (dark sets) | unchanged size (208×42); selected fill moves from an ad hoc `color-mix(in srgb, var(--accent) 10%, var(--surface))` to the `--accent-soft` token (Phase 0b, [ADR 0590](0590-the-mock-fidelity-token-batch-fills-badges-with-opaque-soft-tokens-and-names-the-mocks-sizes-and-type.md)) |
| Segmented control | Master platform switch (05) | one container ≈33 px, 1 px `--border`, `--bg` fill, radius ≈6; the chosen segment inset 3–4 px, `--accent` fill, `--accent-contrast` text, radius ≈4–5; the rest carry no fill, `--text`; Barlow Condensed ≈13 px, **title case**, not uppercase |
| Toggle chip (unchanged shape) | Proof's flag filter, the dark sets' Whisper model/chunk length rows | 32 px (`--button-height`), unchanged otherwise: its own 1 px border, uppercase, `--text-muted` when off |

ADR 0440 (Proposed, from the Master & QC page's own PRD) already put the platform switch on `ToggleGroup`, reasoning that its plain chip look was close enough and calling it "no primitive changes." Measured against mock 05 directly, it isn't: the mock draws one bordered container with an inset fill, not a row of individually bordered chips, and its labels are `ACX`, `iNaudio`, `Google Play` in their own case, not shouted capitals. That gap is exactly D91's complaint restated for this primitive, so this phase gives `ToggleGroup` the container ADR 0440 assumed it didn't need, rather than let Master's page phase (14) restyle it locally.

## Decision

1. **`Tabs`'s underline variant** takes the measured type, tracking, gap and selected colour above. The sidebar variant's selected fill moves onto `--accent-soft`. Neither changes role, structure or keyboard behaviour (ADR 0054 stands).
2. **`Pill` gains `look: 'chip' | 'segmented'`.** `chip` (the default) is the existing standalone toggle, now 32 px (`--button-height`) with `--radius-button` and `--tracking-button`, still bordered and uppercase. `segmented` is one segment of a segmented `ToggleGroup`: no border of its own (the container draws it), no case transform (the label keeps its own case), and its height fills the container's inset.
3. **`ToggleGroup` gains `look: 'default' | 'segmented'`.** `default` is unchanged (a flex row of chips). `segmented` wraps its `Pill`s in one bordered, `--bg`-filled, `--radius-button` container and passes `look="segmented"` to each; the chosen one is `Pill`'s active segment fill.
4. **Group semantics are unchanged.** A segmented `ToggleGroup` is still `role="group"` with `aria-pressed` chips (ADR 0054's deferral of radio semantics stands); the container is a visual grouping, not a new role.
5. **The hand-drawn step strip in `proof/CompareRun.tsx`** (three spans reading "1 · Setup", "2 · Running", "3 · Results", tinted by hand) moves onto `ToggleGroup look="segmented"`. It has no real choice to make — the comparison's phase advances on its own — so `onChange` is a no-op rather than `disabled` (which would also dim the current step's fill). This is a net accessibility gain: the previous strip carried no group, button or state semantics at all.
6. **`manuscript/SelectionMenu.tsx`'s `rounded-none` Buttons stay as Phase 10 (`#889`) left them.** The mock fidelity PRD's migrate list called them "Buttons pretending to be a segmented group," written against an earlier version of the file. Since Phase 10 wrapped them in a `Toolbar`, they are four independent actions (Note, Mark up, Story Bible, Look up) glued visually into one strip, not a single choice among them — `ToggleGroup`'s group-of-one-pressed-chip semantics would misdescribe them. `src/tabsAndToggleShapes.test.ts` records this as a permanent, reasoned allowance rather than converting it.
7. **A guard.** `src/tabsAndToggleShapes.test.ts` counts, per file outside the primitives, a hand-drawn underline tab (`border-b-2` with `uppercase`) or a hand-drawn segmented group (`rounded-none` with `border-l`). The one allowance is point 6 above; an allowance only shrinks.

## Consequences

- Every underline tab strip in the app (the Story Bible categories, Settings' scope, the Booth's panel sections, the Script prep rail) reads its selected label in `--accent-strong`, and Settings' sidebar categories fill with the named token instead of an ad hoc mix.
- `ToggleGroup look="segmented"` is available for Phase 14's Master platform switch to compose directly; that phase draws no container or fill of its own (ADR 0440 point 2 no longer holds).
- `CompareRun`'s progress strip is a named, stateful control for the first time, at the cost of looking like something a mouse could click (it cannot change the phase, since `onChange` is a no-op) — accepted here as strictly better than the plain, semantics-free spans it replaces.
- A new hand-drawn underline tab or segmented group outside the primitives fails `tabsAndToggleShapes.test.ts`.
- To change any of this (a fourth look, radio semantics, `SelectionMenu`'s toolbar becoming a real choice), write a new ADR that supersedes this one.
