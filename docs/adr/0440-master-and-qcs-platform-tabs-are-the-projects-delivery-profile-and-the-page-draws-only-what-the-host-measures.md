# 0440. Master & QC's platform tabs are the project's delivery profile, and the page draws only what the host measures

**Status:** Proposed
**Date:** 2026-09-28

## Context

Stage navigation and page replacement (`docs/prds/stage-navigation-and-page-replacement.prd.md`, delivered and deleted) Phase 8 replaces the Delivery page with **Master & QC** at `/master`, built to mock 05 ([ADR 0407](0407-a-new-page-replaces-its-old-counterpart-in-the-same-change-and-the-navigation-is-grouped-by-production-stage.md); the owner's D85 on [#509](https://github.com/countrymanprime/narration-utils/issues/509): the approved mocks win). The visual mockup divergence audit (deleted 2026-09-29, D96) lists what the mock draws that the Delivery page did not (MQ1 to MQ7). Several of the mock's elements have no data behind them, and the PRD left four questions open:

- **What a platform tab is.** The PRD says "the profile `Select` becomes mock 05's platform tabs (one tab per profile, custom profiles included)", but not whether pressing a tab changes the project's saved choice or only the view. The host judges a measurement against the project's profile as it is when the job is read ([ADR 0179](0179-a-built-in-dated-acx-delivery-profile-ships-and-a-project-is-judged-against-its-selected-profile.md)); a view-only tab would need a second judge in the UI.
- **Which primitive draws them.** `Tabs` draws an underlined strip; the mock draws a segmented row of chips. A segmented `Tabs` variant is a primitive change (lane U, [ADR 0360](0360-studio-primitives-land-as-flat-leaf-files-after-one-token-batch-and-capability-gating-is-a-primitive.md)).
- **Where Diagnostics goes.** The PRD says "the Diagnostics tab stays a tab", but mock 05 has no view tabs: the one strip in its header is the platforms.
- **The mastering chain** (MQ5, flagged for the owner in the audit): the chain is fixed and un-editable ([ADR 0321](0321-the-mastering-chain-is-a-fixed-high-pass-limiter-and-gain-that-masters-to-the-profiles-own-measured-rms-and-sample-peak.md)), but nothing told the UI its steps before a file was mastered.

## Decision

1. **A platform tab is the project's own choice of delivery profile.** Pressing one saves it (`deliverySelectProfile('project', …)`, the same call Settings > Delivery makes) and reads the measurement again, which the host re-judges against it; the package panel is named after it. There is one tab per profile the host lists, labelled by the platform for a built-in ("ACX") and by its name for a custom profile. Only ACX is built in today, so mock 05's INaudio, Google Play, Apple (M4B) and Kobo tabs appear when their profiles exist, not before.
2. **The tabs are a `ToggleGroup`** named "Delivery platform" (chips with `aria-pressed`), which is the mock's segmented look and says what it is: a choice of one, not a set of panels. No primitive changes.
3. **Diagnostics and the report are sections of the page**, below the mastering chain, not tabs: the page has no view tabs, as the mock draws it. Their content, calls and states are unchanged (`DiagnosticsSection.tsx`, `ReportExportPanel.tsx`).
4. **The mastering chain is shown as its steps, read-only.** `masteringport.Capabilities` gains `Chain []Step`: the row's own fixed chain in words that hold for any profile. The built-in row declares EQ (high-pass 80 Hz), Limiter (0.5 dB under the peak limit) and Gain (to the RMS target) from `internal/mastering`'s own constants; the DAW row declares none (the project's FX chain decides) and `daw.go` is unchanged. `MasteringProviders` carries it as an additive `chain` field (no `hostAPIVersion` bump, `docs/architecture/wire-contracts.md` rule 5), with its Zod schema, regenerated goldens and mock. "Edit chain" is not drawn (ADR 0321).
5. **The page draws only what the host measures or reports, and leaves the rest out rather than drawing it empty.** Left out until a source exists: the Clicks and Text columns (nothing measures mouth clicks or text coverage per rendered file), "Quietest 5 s" and "Open in REAPER" (the host cannot play a stretch of a rendered file or open one in the DAW), "A/B raw ↔ mastered" (no player for a rendered file), and "Preview naming" (nothing reports the package's file names before it is built; Outputs lists them after).
6. **A file's result is the host's judgement in one word:** **Fail** when any rule is not met, **Not judged** when a value it should have could not be measured (a silent render) or nothing was judged, **Pass** otherwise; the rules the app did not judge are counted under it ("1 to check yourself"), never counted as met. "Why it fails" gives each missed rule with a suggested fix that promises only what the built-in chain does (RMS and peaks); a noise floor or a sample rate is sent back to the DAW.

## Consequences

- One choice of profile, shared with Settings: a narrator who presses Kobo on Master & QC finds Kobo chosen in Settings, and the report and Proof's delivery checks judge against it too.
- Adding a platform is adding its profile; the page grows a tab with no UI change.
- The mock's missing columns and buttons each wait on a data source, and each is a small UI change once it exists: a per-file clicks count, a text-coverage score for a render, a rendered-file player (for Quietest 5 s and A/B), a package naming preview.
- A segmented `Tabs` look, a view-tab layout, or an editable chain would each need an ADR superseding the matching point here.
