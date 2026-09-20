# Architecture & Design Decision Records (ADRs)

**Status: implemented.**

This folder is the fix for a recurring problem: agentic refactoring sessions have silently reverted deliberate decisions (styling, naming, behavior) because too much code and too many commits pile up between when a decision was made and when a later agent "cleans up" without knowing it was deliberate. An ADR is the durable record that a future agent — or person — checks *before* changing something, not after.

## Format: lightweight Nygard-style ADRs

We use a lightweight, Nygard-style format: Status, Date, Context, Decision, Consequences. It is deliberately not [MADR](https://adr.github.io/madr/) (no YAML front matter, no Decision Drivers or Considered Options sections): for one maintainer the extra sections are overhead, so the alternatives that mattered are named in Context. Each ADR is one file: `NNNN-short-title.md`, numbered sequentially starting at `0001`. Use [`template.md`](template.md) for the section structure.

## Rules

1. **Immutable once Accepted.** Never edit an accepted ADR's Decision or Consequences to reflect a change of mind. If a decision changes, write a **new** ADR that supersedes the old one.
2. **Superseding, not deleting.** The old ADR's `Status` line becomes `Superseded by ADR-NNNN`, and the new ADR's front matter links back (`Supersedes ADR-NNNN`). The old file stays — it's still useful history.
3. **One decision per ADR.** Don't bundle unrelated decisions; a future agent needs to be able to supersede one without touching the others.
4. **Concrete, not aspirational.** An ADR records a decision that was actually made and applied to the code, with a pointer to where. It is not a proposal — proposals for future work belong in `docs/prds/` (see its [README](../prds/README.md) for the format).

## How this is enforced

The `design-spec-guard` skill (`.claude/skills/design-spec-guard/`) reads this folder plus [`docs/design/design-system.md`](../design/design-system.md) before/during a refactor and flags any change that contradicts a recorded decision, unless that exact change is listed in an approved plan. The `adr-author` skill (`.claude/skills/adr-author/`) scaffolds new ADRs and handles the supersede bookkeeping so numbering and cross-links stay consistent.

## Index

| # | Title | Status |
| --- | --- | --- |
| [0001](0001-import-dialog-max-width-and-overflow.md) | Import dialog max-width and overflow behavior | Accepted |
| [0002](0002-dialog-action-button-placement.md) | Dialog action buttons on opposite sides | Accepted |
| [0003](0003-tailwind-tokenized-primitives.md) | Tailwind-based tokenized primitives over ad hoc custom CSS classes | Superseded by ADR-0009 |
| [0004](0004-front-matter-naming.md) | "Front Matter" as the canonical front-matter section name | Accepted |
| [0005](0005-reference-material-excluded-from-chapter-nav.md) | Reference-material sections excluded from chapter navigation, retained in source data | Accepted |
| [0006](0006-chapter-progress-bar-ordering.md) | Chapter progress bar ordered finalized-to-not-started, left to right | Accepted |
| [0007](0007-story-bible-locked-entry-enforcement.md) | Story Bible locked-entry enforcement is server-side authoritative | Accepted |
| [0008](0008-timing-confidence-over-forced-alignment-model-for-transcript-compare.md) | Timing-confidence signal over a forced-alignment model for Transcript Compare, for now | Accepted |
| [0009](0009-complete-tailwind-migration.md) | Complete the Tailwind migration; retire the legacy custom-CSS system | Accepted |
| [0010](0010-theme-switching.md) | Tri-state Light/Dark/System theme switching | Accepted |
| [0011](0011-doc-screenshots-curated-from-visual-suite.md) | Documentation screenshots are curated from the Playwright visual suite, not captured separately | Accepted |
| [0012](0012-media-route-for-track-playback.md) | Local track audio is streamed through a Wails asset-server route, not the base64-binding pattern | Accepted |
| [0013](0013-import-preserves-structural-whitespace.md) | Manuscript import preserves structural whitespace and repairs glued headings | Accepted |
| [0014](0014-inline-formatting-as-offset-spans.md) | Inline formatting is stored as offset spans over canonical plain text | Accepted |
| [0015](0015-real-progress-only.md) | Progress bars and activity logs show real work only | Accepted |
| [0016](0016-highlight-primitive.md) | One `Highlight` primitive for entity, note and review highlights | Accepted (amends ADR-0009) |
| [0017](0017-no-legacy-css-shadowing-tailwind.md) | No unlayered legacy CSS or contradictory utilities shadow Tailwind | Accepted (amends ADR-0009) |
| [0018](0018-story-bible-entries-read-only-until-edit.md) | Story Bible entries are read-only until Edit is pressed | Accepted |
| [0019](0019-detected-manuscript-is-offered-not-imported.md) | A manuscript found in the project folder is offered, never imported automatically | Accepted |
| [0020](0020-entity-extraction-precision-over-recall.md) | Story Bible entity extraction favors precision over recall | Accepted |
| [0021](0021-live-speech-engines-behind-one-event-contract.md) | Live speech engines are interchangeable behind one event contract | Accepted |
| [0022](0022-live-sidecar-events-over-wails-and-stop-file.md) | The host relays live sidecar events over Wails events and stops the sidecar with a stop file | Accepted |
| [0023](0023-visual-suite-capture-contract-and-storybook.md) | The visual suite is a validated capture contract, and Storybook is the component layer | Accepted |
| [0024](0024-teleprompter-highlight-follows-the-sidecars-spans.md) | The teleprompter highlight follows the sidecar's spans and only ever catches up to the real position | Accepted (amends ADR-0016) |
| [0025](0025-delivery-measurements-in-go-profiles-deferred.md) | Delivery measurements are computed in Go, and no distributor profile ships yet | Accepted |
| [0026](0026-manuscript-line-identity-in-item-extension-data.md) | Manuscript line identity is stored in REAPER item extension data and read back through the bridge | Accepted |
| [0027](0027-windows-gates-and-creates-the-release.md) | Windows gates pull requests and creates the release; macOS and Linux are optional, separate builds | Accepted |
| [0028](0028-planned-work-is-specified-as-prds-and-deleted-when-built.md) | Planned work is specified as PRDs, kept apart from ADRs, and a PRD is deleted once its work is built | Proposed |
| [0029](0029-work-is-tracked-on-github-and-decided-in-the-repo.md) | Work is tracked on GitHub, generated from files in the repo, and decisions and docs stay in the repo | Proposed |
| [0030](0030-the-app-starts-without-a-project-and-picks-one-from-recents.md) | The app can start without a project and picks one from a per-user recents list | Proposed |
| [0031](0031-reaper-integration-is-a-lua-file-bridge-verified-by-hand.md) | REAPER integration stays a Lua file bridge, and Lua changes are verified by hand | Proposed |
| [0032](0032-analyzers-report-findings-and-never-change-audio-or-manuscript-on-their-own.md) | Analyzers report findings and never change the narrator's audio or manuscript on their own | Proposed |
| [0033](0033-the-teleprompter-follows-speech-with-continuous-alignment-and-pause-resume.md) | The teleprompter follows what was said, with continuous alignment and pause/resume | Proposed |
| [0034](0034-live-recognition-is-unconstrained-and-never-restricted-to-the-script.md) | Live recognition is unconstrained and is never restricted to the script's words | Proposed |
| [0035](0035-live-transcription-techniques-are-ported-not-depended-on.md) | Live transcription techniques are ported into the sidecar, not taken as dependencies | Proposed |
| [0036](0036-story-bible-read-only-view-is-the-disabled-form-not-entitysummary.md) | The Story Bible's read-only view is the same form with disabled controls, not `EntitySummary` | Proposed (amends ADR-0018) |
| [0037](0037-visual-suite-captures-no-phone-viewport.md) | The visual suite captures no phone viewport | Accepted (amends ADR-0023) |
| [0038](0038-visual-suite-captures-the-production-build.md) | The visual suite captures the production build, not the dev server | Accepted (amends ADR-0023) |
| [0039](0039-the-project-is-licensed-agpl-3-or-later.md) | The project is licensed AGPL-3.0-or-later | Accepted |
| [0040](0040-the-repository-is-laid-out-by-role-and-each-project-is-an-nx-project.md) | The repository is laid out by role, and each project is an Nx project | Accepted |
| [0041](0041-host-bindings-read-project-services-through-one-snapshot-accessor.md) | Host bindings read the project-scoped services through one snapshot accessor | Accepted |
