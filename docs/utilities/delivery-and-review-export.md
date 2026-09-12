# Delivery and Review Export

**Status: Planned.**

## User problem

Before delivery, narrators and reviewers need a concise, reproducible view of what was measured, what was reviewed, and what remains open—without relying on scattered DAW markers or claiming distributor certification.

## Target workflow

Select a project/chapter scope and generic measurement profile; run or collect available findings; review unresolved items; export a local report or reviewer package; retain its analyzer and source versions.

## Inputs and outputs

- Inputs: shared findings, review decisions, measurement summaries, chapter metadata, and optional local audio references.
- Outputs: human-readable report plus structured export that preserves finding IDs, evidence summaries, timestamp ranges, and review state.
- Narrator actions: select scope/profile, decide whether to include paths/audio references, and explicitly generate the export.

## Planned features

### MVP

- Generic audiobook measurement profiles with visible thresholds and units.
- HTML/Markdown and JSON exports of chapter status, unresolved findings, decisions, and measurement summaries.
- Reviewer-oriented timestamp, manuscript-context, and evidence fields.
- Local-path redaction option for shareable reports.

### Later work

- Configurable distributor profile packs after each requirement is specified, versioned, and tested.
- Batch chapter reports and optional handoff checklists.

## Non-goals and review boundary

The export does not upload audio, guarantee acceptance by ACX or another distributor, replace an engineer's review, or conceal unresolved findings.

## Acceptance and risks

- A recipient can identify every included finding and navigate it from its timestamp/context.
- Structured and human-readable exports contain the same finding IDs and review states.
- Tests cover missing media, unresolved findings, privacy redaction, and mixed chapter status.
- Main risks: profile drift, incomplete source coverage, and accidentally sharing local paths or private manuscript excerpts.
