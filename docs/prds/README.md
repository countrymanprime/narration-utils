# Product requirements documents (PRDs)

Planned work in this repository is specified here as PRDs: one file per feature or defect group, named `<topic>.prd.md`. A PRD says what problem is being solved, what evidence supports it, what is and is not being built, and how the work is cut into phases that can be delivered and reviewed one at a time.

## PRDs, ADRs and the other docs

| Kind | Where | What it holds |
| --- | --- | --- |
| **PRD** | `docs/prds/` | Specifies planned work: problem, evidence, scope, open questions, phased delivery. It describes something that is not built yet (or not fully). |
| **ADR** | [`docs/adr/`](../adr/README.md) | Records a decision that was actually made and applied to the code. Immutable once accepted; a changed decision gets a new ADR that supersedes the old one. |
| Docs for shipped behavior | `docs/architecture/`, `docs/design/`, `docs/utilities/`, `docs/guides/`, `docs/workflows/` | Describe how the code works today, how to use it, and the design records of what shipped. |

PRDs never replace ADRs. A PRD names the decisions it expects to make and links the ADR when it is written; an ADR that came out of PRD work links back to the PRD. When a phase settles a real decision, record it with the `adr-author` workflow after the code lands, and check the next free ADR number at merge time (see [Cross-PRD sequencing](#cross-prd-sequencing)).

## Lifecycle of a PRD

1. **Draft:** the PRD is written with its open questions; the owner answers them before phases are planned.
2. **In delivery:** each phase becomes a PRP plan and a pull request. The PR that delivers a phase sets that phase's `Status` to `complete` in the PRD's phase table (and links the plan in `PRP Plan`). Work in flight is tracked on GitHub issues per [Tracking work on GitHub](../operations/github-workflow.md), with `Closes #<n>` in the PR.
3. **Done:** once the work is implemented and has become steady state, the PRD is deleted in favor of steady-state documentation: `docs/architecture/`, `docs/utilities/`, `docs/guides/` and the ADRs record how it works and why. Delete the PRD in the PR that completes its last phase, and make sure that PR also writes the steady-state docs first. Git history keeps the PRD (`git show <commit>:docs/prds/<name>.prd.md`).

Nothing in a PRD that is still true and useful after delivery is lost by deleting it: move durable rules to the steady-state doc, decisions to an ADR, and the rest to git history. The decision is recorded in [ADR 0028](../adr/0028-planned-work-is-specified-as-prds-and-deleted-when-built.md).

## PRD template

Every PRD uses the same sections, in this order:

1. Problem Statement
2. Evidence
3. Proposed Solution
4. Key Hypothesis
5. What We're NOT Building
6. Success Metrics
7. Open Questions
8. Users & Context
9. Solution Detail (core capabilities by MoSCoW priority, MVP scope, user flow)
10. Technical Approach (feasibility, architecture, risks)
11. Implementation Phases: the phase table (`#`, Phase, Description, Status, Parallel, Depends, PRP Plan), Phase Details, Parallelism Notes and a Parallel-session compatibility table of the files each phase touches and who else collides with them
12. Decisions Log
13. Research Summary

Most PRDs open with a `**Supersedes:**` or `**Source:**` line naming what they replace or draw from. Each PRD's phase table has one `Status` cell per phase; the pull request that delivers a phase updates that cell.

## Index

Phase counts are the rows of each PRD's phase table.

| PRD | Type | Phases | Replaces |
| --- | --- | --- | --- |
| [Review Dashboard and Findings Adoption](review-dashboard-and-findings-adoption.prd.md) | Feature | 8 | `docs/utilities/review-dashboard.md` |
| [Take Review: Pickups, Duplicates, and Take Intelligence](take-review-pickups-duplicates-take-intelligence.prd.md) | Feature | 10 | `docs/utilities/duplicate-and-pickup-finder.md`, `docs/utilities/take-intelligence.md` |
| [Character Continuity Review](character-continuity-review.prd.md) | Feature | 8 | `docs/utilities/character-continuity-review.md` |
| [Diagnostics, Delivery Reports and Cleanup Tools](diagnostics-delivery-and-cleanup-tools.prd.md) | Feature | 11 | `docs/utilities/narration-diagnostics.md`, `delivery-and-review-export.md`, `silence-cleanup.md`, `clause-split-and-level-normalize.md`, `daw-project-scan.md` |
| [REAPER Automation Follow-Through](reaper-automation-follow-through.prd.md) | Feature | 25 | None; sourced from `docs/research/reaper-automation-surface.md` section 9 |
| [Teleprompter Manuscript Integration (Reading Mode)](teleprompter-manuscript-integration.prd.md) | Feature | 13 | `docs/architecture/teleprompter-manuscript-integration.md`, plus the flag, review and punch parts of `docs/architecture/manuscript-teleprompter.md` |
| [Teleprompter Engines and Input Devices](teleprompter-engines-and-input-devices.prd.md) | Feature | 12 | The open items of `docs/architecture/manuscript-teleprompter.md` (engine, Moonshine, device selection) |
| [Story Bible and Import UX Briefs](story-bible-and-import-ux-briefs.prd.md) | Feature | 11 | `docs/architecture/native-notifications.md`, `story-bible-concurrent-build.md`, `import-settings-workflow.md`, `dictionary-thesaurus-integration.md`, `pronunciation-provider-selection.md` |
| [Release Readiness: Provisioning, Docs Site and Release Pipeline](release-readiness-provisioning-and-docs-site.prd.md) | Feature | 16 | `docs/architecture/component-showcase-and-docs-site.md`, and the "Delivery slices" plan of `first-use-dependency-provisioning.md` |
| [Host Binding Data Race](host-binding-data-race.prd.md) | Defect | 4 | `docs/architecture/host-binding-concurrency.md` |
| [Interaction Feedback Audit](interaction-feedback-audit.prd.md) | Defect (audit, then fixes) | 7 | `docs/architecture/interaction-feedback-backlog.md` |
| [Dialog Modality and WorkDialog Accessibility](dialog-modality-and-workdialog-a11y.prd.md) | Defect | 5 | `docs/design/known-ui-defects.md`, defects 2 to 4 |
| [Component Accessibility: MeterBar, Tooltip, Field, Heading, Panel](component-a11y-meter-tooltip-field-heading-panel.prd.md) | Defect | 4 | `docs/design/known-ui-defects.md`, defects 5 to 7 |
| [Palette Contrast to WCAG AA](palette-contrast-wcag-aa.prd.md) | Defect | 6 | `docs/design/known-ui-defects.md`, defect 1 |
| [Settings Mobile Layout](settings-mobile-layout.prd.md) | Defect | 3 | `docs/design/known-ui-defects.md`, defect 8 |
| [Test Flakiness and Visual Suite Stability](test-flakiness-and-visual-suite-stability.prd.md) | Defect | 7 | `docs/design/known-ui-defects.md`, "Tooling limits" section |

## Replaced briefs

These 20 planned-work files were removed when the PRDs landed. Each original is recoverable from git, for example `git show d5cc994:docs/utilities/review-dashboard.md`.

| Removed file | Now specified in |
| --- | --- |
| `docs/utilities/review-dashboard.md` | [review-dashboard-and-findings-adoption.prd.md](review-dashboard-and-findings-adoption.prd.md) |
| `docs/utilities/duplicate-and-pickup-finder.md` | [take-review-pickups-duplicates-take-intelligence.prd.md](take-review-pickups-duplicates-take-intelligence.prd.md) |
| `docs/utilities/take-intelligence.md` | [take-review-pickups-duplicates-take-intelligence.prd.md](take-review-pickups-duplicates-take-intelligence.prd.md) |
| `docs/utilities/character-continuity-review.md` | [character-continuity-review.prd.md](character-continuity-review.prd.md) |
| `docs/utilities/narration-diagnostics.md` | [diagnostics-delivery-and-cleanup-tools.prd.md](diagnostics-delivery-and-cleanup-tools.prd.md) |
| `docs/utilities/delivery-and-review-export.md` | [diagnostics-delivery-and-cleanup-tools.prd.md](diagnostics-delivery-and-cleanup-tools.prd.md) |
| `docs/utilities/silence-cleanup.md` | [diagnostics-delivery-and-cleanup-tools.prd.md](diagnostics-delivery-and-cleanup-tools.prd.md) |
| `docs/utilities/clause-split-and-level-normalize.md` | [diagnostics-delivery-and-cleanup-tools.prd.md](diagnostics-delivery-and-cleanup-tools.prd.md) |
| `docs/utilities/daw-project-scan.md` | [diagnostics-delivery-and-cleanup-tools.prd.md](diagnostics-delivery-and-cleanup-tools.prd.md) |
| `docs/architecture/dictionary-thesaurus-integration.md` | [story-bible-and-import-ux-briefs.prd.md](story-bible-and-import-ux-briefs.prd.md) |
| `docs/architecture/import-settings-workflow.md` | [story-bible-and-import-ux-briefs.prd.md](story-bible-and-import-ux-briefs.prd.md) |
| `docs/architecture/native-notifications.md` | [story-bible-and-import-ux-briefs.prd.md](story-bible-and-import-ux-briefs.prd.md) |
| `docs/architecture/pronunciation-provider-selection.md` | [story-bible-and-import-ux-briefs.prd.md](story-bible-and-import-ux-briefs.prd.md) |
| `docs/architecture/story-bible-concurrent-build.md` | [story-bible-and-import-ux-briefs.prd.md](story-bible-and-import-ux-briefs.prd.md) |
| `docs/architecture/host-binding-concurrency.md` | [host-binding-data-race.prd.md](host-binding-data-race.prd.md) |
| `docs/architecture/interaction-feedback-backlog.md` | [interaction-feedback-audit.prd.md](interaction-feedback-audit.prd.md) |
| `docs/architecture/component-showcase-and-docs-site.md` | [release-readiness-provisioning-and-docs-site.prd.md](release-readiness-provisioning-and-docs-site.prd.md) |
| `docs/architecture/teleprompter-manuscript-integration.md` | [teleprompter-manuscript-integration.prd.md](teleprompter-manuscript-integration.prd.md) |
| `docs/architecture/story-bible-readonly-views.md` | [ADR 0018](../adr/0018-story-bible-entries-read-only-until-edit.md) (the behavior shipped; the ADR records it) |
| `docs/design/known-ui-defects.md` | One PRD per defect group: [dialogs](dialog-modality-and-workdialog-a11y.prd.md), [MeterBar, Tooltip, Field, Heading, Panel](component-a11y-meter-tooltip-field-heading-panel.prd.md), [palette contrast](palette-contrast-wcag-aa.prd.md), [Settings on mobile](settings-mobile-layout.prd.md), [tooling limits and flaky tests](test-flakiness-and-visual-suite-stability.prd.md). `git show d5cc994:docs/design/known-ui-defects.md` recovers it. |

Three planned-work documents stay because they hold rules or design records that shipped code and other docs cite. [`first-use-dependency-provisioning.md`](../architecture/first-use-dependency-provisioning.md) keeps the normative provisioning rules, [`manuscript-teleprompter.md`](../architecture/manuscript-teleprompter.md) is the design record of the shipped sidecar, host relay and page, and [`standalone-launch.md`](../architecture/standalone-launch.md) records the shipped project picker. Their remaining planned work is specified in the PRDs above.

## Cross-PRD sequencing

These serialization points are named inside the PRDs themselves. Several PRDs run in parallel sessions, so check each before starting a phase that touches one.

- **Host API version.** `hostAPIVersion` lives in three places, all `5` at the time the PRDs were written: `shell/app.go`, `shell/app_test.go` and `shared/ui/src/hostApi.ts`. Every phase that adds a binding bumps it (and regenerates `Host.{js,d.ts}`), so it is a merge-time serialization point: the later pull request rebases and bumps again. The host binding data race PRD is the exception; it changes no signatures and does not bump.
- **Next free ADR number.** `0027` when the PRDs were written; `0037` once ADRs 0027-0036 had merged. Numbers can collide with open pull requests, so re-check `docs/adr/` at merge time before numbering.
- **Adding a nav item.** A new page adds an entry to `AppShell.tsx` NAV, which regenerates every doc screenshot under `docs/images/ui/`. Land nav additions one at a time (Review dashboard, Delivery, character continuity and take review pages, and the teleprompter PRD's final phase that retires the standalone page).
- **Lua dispatcher.** `shared/reaper/narration_ui_bridge.lua` dispatches every bridge command through one `if/elseif` chain, and `shared/reaper` has no automated tests. The review dashboard, take review, diagnostics, teleprompter integration and REAPER automation PRDs all add commands there. The REAPER automation PRD's registry phase (Phase 4, conditional) is meant to run alone and early.
- **`shell/bindings.go` and the host binding fix.** The host binding data race PRD rewrites nearly every binding body, so its Phase 1 (the `h.services()` accessor and guard test) merges first, Phases 2 and 3 follow back to back, and PRDs that add bindings meanwhile build on the accessor or rebase onto those phases.
- **Kit release.** Settings mobile layout Phase 2 and the test stability PRD's kit phases (Phases 3 and 6) each bump the `tools/ui-atlas-kit` version and edit the same capture and scaffold files, so serialize them (settings first) or bundle one kit release.
