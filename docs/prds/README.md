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
| [Interaction Feedback Audit](interaction-feedback-audit.prd.md) | Defect (audit, then fixes) | 7 | `docs/architecture/interaction-feedback-backlog.md` |
| [Dialog Modality and WorkDialog Accessibility](dialog-modality-and-workdialog-a11y.prd.md) | Defect | 5 (Phases 1 and 2 moved to the Base UI foundation PRD) | `docs/design/known-ui-defects.md`, defects 2 to 4 |
| [Component Accessibility: MeterBar, Tooltip, Field, Heading, Panel](component-a11y-meter-tooltip-field-heading-panel.prd.md) | Defect | 4 | `docs/design/known-ui-defects.md`, defects 5 to 7 |
| [Palette Contrast to WCAG AA](palette-contrast-wcag-aa.prd.md) | Defect | 6 | `docs/design/known-ui-defects.md`, defect 1 |
| [Settings Mobile Layout](settings-mobile-layout.prd.md) | Defect | 3 | `docs/design/known-ui-defects.md`, defect 8 |
| [Test Flakiness and Visual Suite Stability](test-flakiness-and-visual-suite-stability.prd.md) | Defect | 7 | `docs/design/known-ui-defects.md`, "Tooling limits" section |
| [Base UI Primitive Foundation](base-ui-primitive-foundation.prd.md) | Feature | 6 | The mechanism parts of the dialog and component-accessibility PRDs (Dialog, Tooltip, Field) |
| [Runtime Schema Validation at the Data Boundaries](boundary-schema-validation.prd.md) | Feature (hardening) | 7 | None |
| [Release Supply-Chain Hardening](release-supply-chain-hardening.prd.md) | Feature (CI and security) | 10 | None; the signing question stays in the release-readiness PRD |
| [Verification and Code Health Tooling](verification-and-code-health-tooling.prd.md) | Feature (tooling) | 12 | None |
| [Docs Security and Hygiene](docs-security-and-hygiene.prd.md) | Feature (docs) | 11 | None |
| [Release Artifact Naming](release-artifact-naming.prd.md) | Feature | 2 | None; the "one asset per platform" line of [ADR 0027](../adr/0027-windows-gates-and-creates-the-release.md) may need an ADR |
| [Project Workspace: Projects Directory, New Project Dialog and DAW Project Link](project-workspace-and-daw-link.prd.md) | Feature | 8 | None; amends the create and recents decisions of [ADR 0030](../adr/0030-the-app-starts-without-a-project-and-picks-one-from-recents.md) and `docs/architecture/standalone-launch.md` when delivered |
| [Import Review Redesign](import-review-redesign.prd.md) | Feature | 3 | None; takes the subtitle-display half out of Phase 5 of [Story Bible and Import UX Briefs](story-bible-and-import-ux-briefs.prd.md) |
| [Import Structure: Table of Contents and Characters](import-structure-toc-and-characters.prd.md) | Feature (with defects) | 4 | None |
| [TXT and EPUB Manuscript Import](txt-and-epub-import.prd.md) | Feature | 4 | None; its Phase 4 amends the extension list of [ADR 0019](../adr/0019-detected-manuscript-is-offered-not-imported.md) with a new ADR |
| [Manuscript Reader: Search and Controls](manuscript-reader-search-and-controls.prd.md) | Feature (with defects) | 5 | None; its Phase 5 reverses the reader half of [ADR 0005](../adr/0005-reference-material-excluded-from-chapter-nav.md) |
| [Story Bible Entries: Properties, Actions and Pronunciation](story-bible-entries-and-actions.prd.md) | Feature | 3 | None; supersedes the "actions regardless of mode" clause of [ADR 0018](../adr/0018-story-bible-entries-read-only-until-edit.md) |
| [Story Bible Preview: TTS Failures](story-bible-preview-tts-failures.prd.md) | Defect | 3 | None |
| [Proofing Vocabulary Hints](proofing-vocabulary-hints.prd.md) | Defect, then feature | 2 | None |
| [Proofing Preview Suggestion](proofing-preview-suggestion.prd.md) | Feature | 8 | None; unscheduled like the chapter stage recommendations set |
| [Audiobook Credits Templates](audiobook-credits-templates.prd.md) | Feature | 5 | None |
| [UI Primitives and a Headless Library](ui-primitives-and-headless-library.prd.md) | Feature (infrastructure) | 6 (including a phase 0 decision) | None; reopens Q1 of [Dialog Modality and WorkDialog Accessibility](dialog-modality-and-workdialog-a11y.prd.md) |

## Replaced briefs

These 19 planned-work files were removed when the PRDs landed (a twentieth, `host-binding-concurrency.md`, is back as the steady-state description of the delivered host binding work). Each original is recoverable from git, for example `git show d5cc994:docs/utilities/review-dashboard.md`.

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
| `docs/architecture/interaction-feedback-backlog.md` | [interaction-feedback-audit.prd.md](interaction-feedback-audit.prd.md) |
| `docs/architecture/component-showcase-and-docs-site.md` | [release-readiness-provisioning-and-docs-site.prd.md](release-readiness-provisioning-and-docs-site.prd.md) |
| `docs/architecture/teleprompter-manuscript-integration.md` | [teleprompter-manuscript-integration.prd.md](teleprompter-manuscript-integration.prd.md) |
| `docs/architecture/story-bible-readonly-views.md` | [ADR 0018](../adr/0018-story-bible-entries-read-only-until-edit.md) (the behavior shipped; the ADR records it) |
| `docs/design/known-ui-defects.md` | One PRD per defect group: [dialogs](dialog-modality-and-workdialog-a11y.prd.md), [MeterBar, Tooltip, Field, Heading, Panel](component-a11y-meter-tooltip-field-heading-panel.prd.md), [palette contrast](palette-contrast-wcag-aa.prd.md), [Settings on mobile](settings-mobile-layout.prd.md), [tooling limits and flaky tests](test-flakiness-and-visual-suite-stability.prd.md). `git show d5cc994:docs/design/known-ui-defects.md` recovers it. |

Three planned-work documents stay because they hold rules or design records that shipped code and other docs cite. [`first-use-dependency-provisioning.md`](../architecture/first-use-dependency-provisioning.md) keeps the normative provisioning rules, [`manuscript-teleprompter.md`](../architecture/manuscript-teleprompter.md) is the design record of the shipped sidecar, host relay and page, and [`standalone-launch.md`](../architecture/standalone-launch.md) records the shipped project picker. Their remaining planned work is specified in the PRDs above.

## Cross-PRD sequencing

The order the PRDs are delivered in, the owner's answers to their open questions and the rules every stack follows are in [implementation-plan.md](implementation-plan.md); it is deleted with the last PRD.

These serialization points are named inside the PRDs themselves. Several PRDs run in parallel sessions, so check each before starting a phase that touches one.

- **Host API version.** `hostAPIVersion` lives in three places, all `5` at the time the PRDs were written: `apps/desktop/app.go`, `apps/desktop/app_test.go` and `apps/ui/src/hostApi.ts`. Every phase that adds a binding bumps it (and regenerates `Host.{js,d.ts}`), so it is a merge-time serialization point: the later pull request rebases and bumps again. The host binding data race work (delivered) was the exception: it changed no signatures and did not bump.
- **Next free ADR number.** `0027` when the PRDs were written; `0037` once ADRs 0027-0036 had merged, `0039` once ADRs 0037 and 0038 (visual suite) had merged, `0041` once ADR 0039 (licence) and ADR 0040 (layout) had merged, `0042` once ADR 0041 (host binding accessor) had merged, and `0043` once the Proposed ADR 0042 (Proofing vocabulary suggestions) had been opened (the Base UI ADR is planned as the next one, written by foundation Phase 1 after its code lands). Numbers can collide with open pull requests, so re-check `docs/adr/` at merge time before numbering.
- **Adding a nav item.** A new page adds an entry to `AppShell.tsx` NAV, which regenerates every doc screenshot under `docs/images/ui/`. Land nav additions one at a time (Review dashboard, Delivery, character continuity and take review pages, and the teleprompter PRD's final phase that retires the standalone page).
- **Lua dispatcher.** `integrations/reaper/narration_ui_bridge.lua` dispatches every bridge command through one `if/elseif` chain, and `integrations/reaper` has no automated tests. The review dashboard, take review, diagnostics, teleprompter integration and REAPER automation PRDs all add commands there. The REAPER automation PRD's registry phase (Phase 4, conditional) is meant to run alone and early.
- **`apps/desktop/bindings.go` and the host accessor.** Delivered (see [host binding concurrency](../architecture/host-binding-concurrency.md) and [ADR 0041](../adr/0041-host-bindings-read-project-services-through-one-snapshot-accessor.md)): every binding reads the project-scoped services through `h.services()`, and `hostguard_test.go` fails `go test` on a direct read. A PRD that adds a binding writes it on the accessor and adds a row to `stressReaders` in `hostrace_test.go`.
- **Base UI foundation.** `base-ui-primitive-foundation.prd.md` resolves the library decision of [UI Primitives and a Headless Library](ui-primitives-and-headless-library.prd.md) (its L1 and L2: Base UI, owner decision 2026-09-20), so that PRD's Phases 2 and 3 are delivered by foundation Phases 1 to 3, and its Phases 1, 4 and 5 (wrapped natives, menus and disclosure, Table and combobox) build on Base UI after foundation Phase 1. Foundation Phase 1 adds the dependency and edits `apps/ui/package.json`, `pnpm-lock.yaml` and `eslint.config.js`; `boundary-schema-validation.prd.md` Phase 1 and the verification-tooling PRD's `fast-check` and Knip phases edit the same files, so land those dependency changes one at a time. Foundation Phases 2 to 4 own `Dialog*`, `Tooltip*`, `Field*`, `SlideOver*` and `AppShell.tsx` and replace the dialog PRD's Phases 1 and 2 and the mechanism parts of the component-accessibility PRD; the dialog PRD's Phases 3 and 4 follow foundation Phase 2.
- **Workflow files.** `release-supply-chain-hardening.prd.md` Phase 2 rewrites every `uses:` line, so land it early and alone; the test-flakiness PRD (`_quality.yml`), the verification-tooling PRD (`_quality.yml`, `setup-toolchain`) and the release-readiness PRD (`prerelease.yml`, installer) edit the same workflows. Any action added by another PRD must arrive SHA-pinned. Signing (release-readiness Phase 15) must run before the attestation step.
- **The REAPER launcher and its executable name.** [Release Artifact Naming](release-artifact-naming.prd.md) Phase 1 renames the program the launcher looks for (`NarrationUtils_Launcher.lua:60`), and [Project Workspace](project-workspace-and-daw-link.prd.md) Phase 5 adds `--project-file` to the same launcher. Both edit the Lua with no automated tests, so each needs its own manual REAPER sign-off; land them one at a time.
- **`Home.tsx` and the import review dialog.** [Import Review Redesign](import-review-redesign.prd.md) extracts the review body from `Home.tsx` in its Phase 1; the Story Bible and import briefs (phases 2, 3, 5), the dialog modality PRD (phases 3, 4), the interaction audit and the chapter stage recommendations PRDs all edit the same file. Land the extraction first and rebase the others onto it.
- **Primitives first.** [UI Primitives and a Headless Library](ui-primitives-and-headless-library.prd.md) Phase 0 (a library decision that reopens the dialog PRD's Q1) and Phases 1-2 (`IconButton`, `Select`, `TextField`, `SearchField`, `Checkbox`, Tooltip) come before the icon-only buttons, the search field, the controls bar, the tag input and the red delete button that the reader, Story Bible and Proofing PRDs specify. Until then those PRDs reuse the pasted icon-button class string; the dialog and Tooltip/Field PRDs should be folded into or sequenced behind it.
- **`GuideDetail.tsx`, `Guide.tsx` and `Transcript.tsx`.** [Story Bible Entries](story-bible-entries-and-actions.prd.md), [Story Bible Preview TTS Failures](story-bible-preview-tts-failures.prd.md), the briefs PRD (phases 2, 9-11), the interaction audit (phases 3, 4), the dialog PRD and the release-readiness install-flow phase all edit these files; [Proofing Vocabulary Hints](proofing-vocabulary-hints.prd.md) edits `Transcript.tsx`. Land the small correctness fixes (TTS failures Phase 1, vocabulary hints Phase 1) before the layout changes.
- **Accepted ADRs reversed by PRDs.** The reader PRD Phase 5 and the import-structure PRD Phase 2 supersede the reader half of ADR 0005; the Story Bible entries PRD Phase 2 supersedes a clause of ADR 0018; the project workspace PRD supersedes decisions of ADR 0030; the primitives PRD supersedes ADR 0009's `table.dtable` exception. Each needs its own new ADR (ADRs are immutable) and `design-spec-guard`; check the next free number at merge time.
- **Import path.** [Import Review Redesign](import-review-redesign.prd.md) (Phase 1 extraction first), [Import Structure](import-structure-toc-and-characters.prd.md) (importer, `model.go`, `docx.go`) and the briefs PRD Phase 5 all touch the importer or the review dialog; the structure PRD's Phase 3 needs the Story Bible entries PRD's properties schema (Phase 1) first.
- **`ProjectCreate` and the projects directory.** [Project Workspace](project-workspace-and-daw-link.prd.md) Phase 2 replaces `ProjectCreate` with `ProjectCreateIn` (a `hostAPIVersion` bump) on top of the delivered host accessor work, which already made `ProjectCreate` check for a busy host before it creates the folder and require an absolute path.
- **The layout move.** [ADR 0040](../adr/0040-the-repository-is-laid-out-by-role-and-each-project-is-an-nx-project.md) records the layout; the move renamed nearly every tracked path into role-based folders (`apps/`, `libs/`, `sidecars/`, `integrations/`, `config/`, `tests/`; the old-to-new map is `scripts/ci/layout.json`). Every path cited in the other PRDs was rewritten by its codemap. A branch or worktree that predates the move merges `main` (git follows the renames) and then runs `node scripts/ci/apply-path-map.mjs` to rewrite the path text inside its files, and `pnpm install` to refresh the workspace links.
- **Kit release.** Settings mobile layout Phase 2 and the test stability PRD's kit phases (Phases 3 and 6) each bump the `tools/ui-atlas-kit` version and edit the same capture and scaffold files, so serialize them (settings first) or bundle one kit release.
