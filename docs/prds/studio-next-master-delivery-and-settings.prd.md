# Studio Next Master, Delivery and Settings: Capability-Driven Settings and Delivery Brought to the Mock

**Source:** owner request of 2026-10-10 ([Studio Next Rebuild](studio-next-rebuild.prd.md)); the Settings, Master and Delivery behaviour in the mock's `studio-next/src/pages/Settings.tsx`, `studio-next/src/pages/Master.tsx`, `studio-next/src/pages/Delivery.tsx` and the delivery-profile rulings (ACX only; checkpoint as a template; payment type) in `studio-next/research/repo-compare-decisions.md`; the owner's rulings of 2026-10-11 (see Decisions).

**Builds on:** the delivered Master & QC page, delivery profiles and mastering ([ADR 0179](../adr/0179-a-built-in-dated-acx-delivery-profile-ships-and-a-project-is-judged-against-its-selected-profile.md), [ADR 0180](../adr/0180-custom-delivery-profiles-are-copies-of-a-built-in-kept-in-a-user-level-file.md), [ADR 0440](../adr/0440-master-and-qcs-platform-tabs-are-the-projects-delivery-profile-and-the-page-draws-only-what-the-host-measures.md), [ADR 0170](../adr/0170-the-delivery-report-is-built-by-the-host-into-the-project-sidecar-without-paths-and-the-host-judges-the-limits.md), [ADR 0321](../adr/0321-the-mastering-chain-is-a-fixed-high-pass-limiter-and-gain-that-masters-to-the-profiles-own-measured-rms-and-sample-peak.md), [ADR 0322](../adr/0322-delivery-findings-are-saved-for-review-per-measured-file-versioned-by-the-audio-and-the-rules-bound.md), [ADR 0306](../adr/0306-mastering-is-a-provider-port-and-measurement-stays-one-in-process-judge.md)), the Settings page and scoped settings (`apps/ui/src/components/settings/`), the capability toggles ([ADR 0304](../adr/0304-bridge-actions-asks-a-per-command-gate-and-the-daw-ports-resolver-answers-it-from-the-per-capability-settings.md)) and the keyboard panel ([ADR 0361](../adr/0361-app-commands-go-through-one-registry-and-keyboard-midi-and-hid-are-input-sources-bound-by-a-remappable-keymap.md)). It carries over two owner-side validation phases (overview table).

**Status (2026-10-12):** the swap is in review (SN-M5, #1286): `/settings`, `/master` and `/delivery` mount the Studio Next pages, Delivery has its rail item beside Master & QC, and the old pages and equivalents are deleted. The mock's Story Bible types panel is built (SN-M53, #1539); its Recording, Definitions, Reader text and Marks panels have no host model yet and are not built. The owner's rulings of 2026-10-11 are applied. The Studio Next mock is the only spec for Settings, Master & QC and Delivery. **2026-10-13:** the old `Settings` component, which SN-M5 left stacked under the new panels, is deleted (#1698): its categories are panels of the page's one column, each two-scope panel with its own Global / This project switch, and Story Bible analysis is the mock's own panel.

**Settings redesign (2026-10-17, proposed):** [ADR 0865](../adr/0865-settings-are-grouped-by-what-is-configured-with-a-scope-and-a-used-by-list-on-every-setting-and-a-model-list-that-owns-the-downloads.md) replaces the Settings behaviour above (the page's one column of panels, each two-scope panel with its own Global / This project switch) with eight categories, a scope and used-by list on every setting, one downloads list and search. The Studio Next mock's Settings page now draws it and supersedes its single-column predecessor. Nothing in `apps/ui` changes until the owner accepts the ADR; the Master and Delivery text here stands.

## Problem Statement

Settings in the mock is where the new seams become visible: the DAW capabilities with their reasons, destructive flags and modes; the manuscript replace action (moved here from the Script reader); Audacity backups (window and retention) shown only for DAWs with the capability; the Story Bible analysis tools; the key list from the command catalogue; the delivery profile choice (ACX or none, chosen on first import and changed here). Master and Delivery in the mock show only what the profile can check and word DAW things from capabilities. The real Settings and Master pages exist and are measured to the benchmark mocks, and Delivery is a panel; the mock has all three as pages and replaces them (SNM-5).

## Evidence

- **Mock.** `studio-next/src/pages/Settings.tsx`, `studio-next/src/pages/settings/AnalysisTools.tsx`, `studio-next/src/selectors/platform.ts` and `studio-next/src/fixtures/platforms.ts` (`platformOf`, `platformHas`), `studio-next/src/state/commands/settings.ts`, `studio-next/src/state/commands/delivery.ts`, `studio-next/src/selectors/master.ts`, `studio-next/src/pages/Master.tsx`, `studio-next/src/pages/Delivery.tsx`; backups settings in `studio-next/src/pages/editing/BackupsTab.tsx` and `studio-next/src/selectors/backups.ts`. Tests: `studio-next/tests/settings.test.tsx`, `studio-next/tests/master.test.tsx`, `studio-next/tests/delivery.test.tsx`, `studio-next/tests/delivery-profile.test.tsx`.
- **Repo.** `apps/ui/src/components/settings/{Settings,DawCatalogPanel,KeyboardPanel,DeliveryProfilesPanel,DeliveryProfileEditor,ScopedSetting,AboutPanel,OnlineDictionaryPanel,CreditsPanel,RecordingCheckSummary,RetailSamplePanel}.tsx`; `apps/ui/src/components/master/*` (profile panel, per-file checks, diagnostics, mastering chain, multi-platform export, report); capability toggles in settings (`DAW.capability.<name>`, [ADR 0304](../adr/0304-bridge-actions-asks-a-per-command-gate-and-the-daw-ports-resolver-answers-it-from-the-per-capability-settings.md)); Settings categories and anchors in `App.tsx`.

| Mock behaviour | Real today |
| --- | --- |
| Capabilities listed with reason, destructive, mode | Capability toggles per name with level; reason message from the resolver; no destructive or mode |
| Replace manuscript only in Settings | Replace on the import review and manuscript surfaces to verify |
| Backups settings, only for DAWs with the capability | None |
| Analysis tools section | None |
| Key list from catalogue, shows remapped keys | `KeyboardPanel` remaps from the catalogue |
| Delivery profile chosen on first import, changed in Settings | Profile selection per project and global default ([ADR 0179](../adr/0179-a-built-in-dated-acx-delivery-profile-ships-and-a-project-is-judged-against-its-selected-profile.md)) |
| Checkpoint measure only when the profile has it | 15-minute checkpoint is a milestone like any other (Production) |

## Proposed Solution

1. **Capabilities in Settings** show the resolver's reason, the `destructive` flag (a warning chip) and the `mode`, using the extended capability payload.
2. **Settings > Manuscript** carries Replace manuscript (the one place); the Script reader's icon goes.
3. **Backups** (window minutes, retention days) shown only when the DAW reports the `backups` capability.
4. **Story Bible analysis** section: the installed tools, sizes, remove, "ask before scanning" preference, using the [Extraction and Analysis Tools](studio-next-extraction-and-analysis-tools.prd.md) consent flow.
5. **Keys** list generated from the catalogue and the narrator's keymap.
6. **Delivery.** `platformHas(profile, capability)` is the one lookup for what a profile unlocks (templates, measures, payment types); the first import asks for the profile (ACX or none) and Settings changes it; Master & QC draws only what the host measures ([ADR 0440](../adr/0440-master-and-qcs-platform-tabs-are-the-projects-delivery-profile-and-the-page-draws-only-what-the-host-measures.md)); DAW wording on Master and Delivery comes from capabilities.
7. **Reflow.** Settings states are captured at 390 px ([ADR 0061](../adr/0061-settings-states-are-also-captured-at-a-390px-reflow-width.md)); the mock's breakpoints apply to the reported width.
8. **Swap.** Settings, Master & QC and a new Delivery page (own rail item, `studio-next/src/pages/Delivery.tsx`) replace their counterparts in SNM-5, which deletes the old Settings and Master pages, the Delivery panel and every old equivalent of what the mock shows. What has no equivalent in the mock stays as built (Phase 5 lists it).

## Key Hypothesis

If Settings is generated from capabilities, the catalogue and the registry, no new feature needs a hand-built Settings row. We are wrong if a seam slice has to edit `Settings.tsx` by hand after SNM-1.

## What We're NOT Building

- Distribution profiles other than ACX (and the existing custom profiles); an export of profile files.
- Anything the mock does not show.
- Settings for the Companion; any Series settings change (no equivalent in the mock; untouched).
- A rewrite of the mastering chain or measurement ([ADR 0321](../adr/0321-the-mastering-chain-is-a-fixed-high-pass-limiter-and-gain-that-masters-to-the-profiles-own-measured-rms-and-sample-peak.md), [ADR 0306](../adr/0306-mastering-is-a-provider-port-and-measurement-stays-one-in-process-judge.md) stand).

## Success Metrics

| Metric | Target | Measured by |
| --- | --- | --- |
| Settings rows hand-written for a capability | 0 | Scan: capability rows come from the report |
| Reflow overflow at 390 | 0 | Visual suite reflow rows |
| Profile-gated features | All via `platformHas` | Scan for profile ids in components |

## Decisions

Owner rulings of 2026-10-11; none is open.

| Id | Ruling | Consequence here |
| --- | --- | --- |
| SN0-Q1 / DQ-1 | Studio Next is the spec, tokens and layouts included | Benchmark mock 05 and ADRs 0665 to 0667 are superseded where the mock differs |
| SN0-Q2 / DQ-2 | Replace, one PR, no flag | SNM-5 swaps the routes and deletes the old pages |
| DQ-14 / SN0-Q6 | Schedule and Delivery are pages with their own rail items | ADR 0407 decision 5 is superseded; SNM-5 adds the Delivery route and rail item |
| DQ-12 / DQ-13 | Series and Companion have no equivalent in the mock | Their settings stay as built |
| SNM-Q1 | The profile is chosen in the import review, as the mock's `studio-next/src/pages/production/ImportFlow.tsx` does (default taken, standing instruction) | Phase 4 |
| SNM-Q2 | Backups default to 2 minutes either side and 7 days (default taken; the DAW PRD owns the values) | Two settings rows |
| SNM-Q3 | Settings keeps "Experimental REAPER actions" until the DAW PRD's promotion plan empties the list ([ADR 0230](../adr/0230-reaper-commands-built-before-the-verification-pass-are-refused-by-the-host-while-the-experimental-switch-is-off.md)) (default taken; the mock has no such row, so it is not re-skinned) | Left as built |

## Users & Context

A narrator setting up a project (profile, DAW, keys) and checking a rendered chapter against ACX. Accessibility: the Settings page reflows to 390 px.

## Solution Detail

### Acceptance criteria tied to the mock

| Behaviour | Mock reference | Acceptance |
| --- | --- | --- |
| Capability row | `studio-next/tests/daw-wording.test.tsx`, `studio-next/tests/settings.test.tsx` | Level, reason, destructive chip and mode shown for each capability the host reports |
| Replace manuscript only here | `studio-next/tests/import.test.tsx` | Script reader has no replace icon; Settings > Manuscript does |
| Backups only when supported | `studio-next/src/selectors/backups.ts` | Hidden for REAPER; shown for Audacity |
| Profile lookup | `studio-next/tests/delivery-profile.test.tsx` | "Other / none" hides ACX-only measures and templates |
| Master draws what is measured | `studio-next/tests/master.test.tsx` | No row for an unmeasured rule |

### Supersedes / depends on ADRs

On conflict this PRD, and the ADR written when its phase lands, is the source of truth; old ADRs stay in force for unmigrated code ([register](studio-next-adr-register.prd.md)).

| ADR | Class | Note |
| --- | --- | --- |
| [ADR 0304](../adr/0304-bridge-actions-asks-a-per-command-gate-and-the-daw-ports-resolver-answers-it-from-the-per-capability-settings.md), [ADR 0230](../adr/0230-reaper-commands-built-before-the-verification-pass-are-refused-by-the-host-while-the-experimental-switch-is-off.md), [ADR 0400](../adr/0400-promoting-a-reaper-command-from-experimental-to-supported-is-a-one-line-daw-port-declaration-change.md) | KEEP / EXTEND | Toggles; reasons and flags shown |
| [ADR 0179](../adr/0179-a-built-in-dated-acx-delivery-profile-ships-and-a-project-is-judged-against-its-selected-profile.md), [ADR 0180](../adr/0180-custom-delivery-profiles-are-copies-of-a-built-in-kept-in-a-user-level-file.md), [ADR 0440](../adr/0440-master-and-qcs-platform-tabs-are-the-projects-delivery-profile-and-the-page-draws-only-what-the-host-measures.md) | EXTEND | Capability lookup |
| [ADR 0061](../adr/0061-settings-states-are-also-captured-at-a-390px-reflow-width.md), [ADR 0465](../adr/0465-the-shells-header-states-are-also-captured-at-the-reflow-width-because-thats-what-a-narrator-sees-at-high-zoom.md) | KEEP | Reflow |
| [ADR 0585](../adr/0585-mock-fidelity-is-a-pixel-match-at-the-mocks-own-size-and-theme-scored-by-a-tool-that-reports-and-does-not-gate.md), [ADR 0665](../adr/0665-master-s-rule-marks-compose-statusbadge-warn-and-muted-keep-their-outline-look.md) to [ADR 0667](../adr/0667-the-mastering-chain-s-steps-are-badges-and-the-last-one-is-accent-soft.md) | SUPERSEDE (DQ-1) | Studio Next Master replaces benchmark mock 05 as the spec |
| [ADR 0407](../adr/0407-a-new-page-replaces-its-old-counterpart-in-the-same-change-and-the-navigation-is-grouped-by-production-stage.md) | KEEP decision 1, SUPERSEDE decision 5 (DQ-2, DQ-14) | Delivery is a page with its own rail item |
| [ADR 0079](../adr/0079-every-downloadable-asset-is-listed-installed-verified-and-removed-through-one-registry-of-providers.md), [ADR 0081](../adr/0081-local-assets-is-a-settings-list-built-from-the-registry-whose-rows-own-their-download-verify-and-remove.md) | EXTEND | Local assets list shows analysis tools |
| [ADR 0361](../adr/0361-app-commands-go-through-one-registry-and-keyboard-midi-and-hid-are-input-sources-bound-by-a-remappable-keymap.md) | EXTEND | Key list from the catalogue |

## Technical Approach

**Interfaces.** Settings reads the capability report (`useCapability` and `dawCapabilities()`), the asset list, the catalogue and keymap, the delivery-profile bindings; no new binding is required except any the Backups settings need (two settings rows, append-only in `config/defaults.json`, `internal/settings/store.go`, `fieldSchemas`).

**Contracts.** Additive capability fields from the DAW PRD; settings rows have the existing wire shape; `wireContracts.test.ts` rows for any new binding.

**Architecture.** Settings sections as feature components using `ScopedSetting` and primitives; sections register through a small list so SNM-1 is the last hand edit.

**Test plan.** Port the mock's tests; visual rows for each Settings category and Master and Delivery states at all viewports plus reflow; aria; the existing Settings contract tests.

**Rollout.** Phases 1 to 4 build sections, lookups and the Delivery page as components and ports with no route; the old pages are untouched. SNM-5 swaps Settings, Master & QC and Delivery to the mock's pages in one PR per page (SNM-5 may be split into SNM-5a..c if the coordinator sizes it so), each deleting its old page, rows, guide text and screenshots. No flag.

**ADRs.** None new except those owned by other PRDs.

**Trust boundaries.** Backups retention deletes files under the project folder (DAW PRD); the threat model is updated there.

**Risks.** Settings is a textual hot spot (append-only rows serial point); the swap deleting an old control the mock lacks (mitigation: the change-impact scan lists each consumer, and only items with a mock equivalent are deleted).

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | Est. (pw) | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Capability section | Reason, destructive, mode in Settings; section registry | done (SN-M1 [#1079](https://github.com/countrymanprime/narration-utils/issues/1079)) | 2 | SND-2 | 0.8 | - |
| 2 | Manuscript and keys | Replace in Settings only; key list from catalogue | done (SN-M2 [#1087](https://github.com/countrymanprime/narration-utils/issues/1087); the key list in SN-M52 [#1281](https://github.com/countrymanprime/narration-utils/issues/1281)) | 1 | SNR-6 | 0.7 | - |
| 3 | Backups and analysis tools | Backups settings; tools section | done (SN-M32 [#1270](https://github.com/countrymanprime/narration-utils/issues/1270), SN-M33 [#1273](https://github.com/countrymanprime/narration-utils/issues/1273)) | - | 1, SND-8, SNX-6 | 0.8 | - |
| 4 | Delivery lookup and page | `platformHas`, profile on first import, Master wording from capabilities, Delivery page components (no route) | done (SN-M41 to SN-M45, [#1275](https://github.com/countrymanprime/narration-utils/issues/1275) to [#1280](https://github.com/countrymanprime/narration-utils/issues/1280)) | - | SNP-3 | 1.0 | - |
| 5 | Swap and close-out | Swap Settings, Master & QC and Delivery routes and the Delivery rail item; delete the old pages and equivalents; visual rows incl. reflow; guides; carried-over owner validation | in review (SN-M5 [#1286](https://github.com/countrymanprime/narration-utils/issues/1286); the SN-M51 audit note is deleted, its tables acted on) | - | 1 to 4 | 0.7 | - |

### Phase Details

- **Phase 5.** Carried over, pending on #510: the owner's reading of the ACX page and the EBU validation run; neither blocks a merge. Kept as built, with no mock equivalent: the Settings categories the mock does not draw (below its panels, with the scope tabs), the Global default profile with Duplicate, Edit and Delete, a file's every-rule list, Master to spec, the mastering chain, Diagnostics, the report export, the multi-platform export and the profile's rules and their sources (on Delivery). The mock's failing-file count on Master & QC's rail item is not drawn (no cheap host read yet).

### Parallelism Notes

1 and 2 are independent; 3 waits for DAW and extraction slices; 4 for the Production lookup.

### Parallel-session compatibility

| Phase | Files touched | Collides with |
| --- | --- | --- |
| 1, 2, 3 | `components/settings/*`, `config/defaults.json`, `internal/settings/store.go`, `app.go` `fieldSchemas` | Any settings PRD (append-only serial rows) |
| 4, 5 | `components/master/*`, `components/settings/DeliveryProfilesPanel.tsx`, navigation | Production slices; the navigation serial point |

### Slices

| Slice | Scope | Depends on | Parallel-safe | Verification |
| --- | --- | --- | --- | --- |
| SNM-1 | Phase 1 | SND-2 | yes | Ported tests; visual; contract tests |
| SNM-2 | Phase 2 | SNR-6 | yes | Ported tests; visual |
| SNM-3 | Phase 3 | SNM-1, SND-8, SNX-6 | yes | Visual; registry tests |
| SNM-4 | Phase 4 | SNP-3 | yes | Ported tests; visual |
| SNM-5 | Phase 5 | SNM-1..4 | no (page swap) | Visual suite incl. reflow; Screenshots against the mock pages; deleted code gone from Knip |

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Generate, do not hand-write (proposed) | Rows from the report, catalogue, registry | Per-feature Settings edits | Open/closed |
| ACX only (owner) | Profile ids as data | More platforms | "Right now, I only want to support ACX" |

## Research Summary

Read: the mock's settings, master, delivery and platform files; the real settings and master component lists; ADRs 0179, 0304, 0440. Not done: Settings categories were not audited row by row.

## Visual Spec

Mock pages: Settings, Master & QC, Delivery (`studio-next/src/pages/Settings.tsx`, `Master.tsx`, `Delivery.tsx`).
