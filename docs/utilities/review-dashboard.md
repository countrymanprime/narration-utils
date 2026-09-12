# Review Dashboard

**Status: Planned—first new utility.**

## User problem

Findings from alignment, manuscript, character, take, and technical analyzers should be triaged in one REAPER-native place instead of scattered across marker lists and generated files.

## Target workflow

Open a REAPER panel, choose a chapter or filter set, select a finding, jump to and loop its context, inspect evidence, then accept, dismiss, defer, or invoke one explicit suggested action.

## Inputs and outputs

- Inputs: versioned shared finding files and project-sidecar review state.
- Outputs: updated review state, explicit REAPER actions such as selecting/looping or adding an approved marker, and an optional filtered report.
- Narrator actions: filter by chapter/category/severity/status/character, listen, add notes, and make every decision.

## Planned features

### MVP

- REAPER panel listing transcript and Manuscript Guide findings.
- Filters, sortable columns, chapter grouping, finding detail, source navigation, and loop controls.
- Review state transitions: `unreviewed`, `accepted`, `dismissed`, and `deferred`.
- Safe stale-reference handling and a visible analyzer/run timestamp.

### Later work

- Bulk review actions, saved views, audio snippets, and cross-project reports.
- Ingestion of pickup, take, character, and QC analyzers.

## Non-goals and review boundary

The panel does not analyze audio itself, silently alter a project, or hide findings solely because they are inconvenient. Only a narrator-approved action may mutate REAPER state.

## Acceptance and risks

- Selecting a valid finding selects and loops the exact target context.
- Every decision persists across panel restarts and is attributable to the finding evidence version.
- Stale project identities fail safely without selecting a nearby item.
- Main risks: UI responsiveness for large books and ID stability after extensive editing.
