# Narration Utilities Documentation

This folder records planned work for a local-first audiobook narration toolkit. It is a product and implementation roadmap, not a claim that the described utilities already exist.

## Status legend

- **Implemented**: usable code exists in `tools/`.
- **Planned—foundation**: required before dependent utilities can start.
- **Planned**: intentionally specified future work.
- **Deferred**: valuable work held outside the current milestone sequence.

## Current inventory

| Utility | Status | What it does now |
| --- | --- | --- |
| [Manuscript Guide](utilities/manuscript-guide.md) | Implemented | Extracts editable characters, places, organizations, pronunciations, evidence, and narration notes from a Word manuscript. |
| [Transcript Compare](utilities/transcript-compare.md) | Implemented | Locally transcribes a REAPER chapter track, compares it to the manuscript, and adds take markers for discrepancies. |
| [Tracks](utilities/tracks.md) | Implemented | Reads a project's REAPER `.rpp` file to list its tracks and play their audio (play/pause, skip 30s, previous/next track), with no running REAPER needed. |
| [Manuscript Teleprompter](architecture/manuscript-teleprompter.md) | Implemented (first cut) | Listens to a microphone with a local Whisper model and highlights the current word of a chosen manuscript chapter as it is read. Microphone is typed by name and only Whisper is wired up; misread findings, Moonshine, and a device picker are still open in the brief. |
| [Teleprompter–Manuscript integration](architecture/teleprompter-manuscript-integration.md) | Planned | Plans the teleprompter as a reading mode of the Manuscript page: modal, story bible and notes, misread marks, seek to a word, resume from the DAW track's last audio, and punch-and-roll cursor moves. |
| [REAPER shared helpers](architecture/daw-integration.md) | Implemented | Provides ExtState, path, and hidden-process helpers for ReaScripts. |
| Audacity adapters | Deferred | Placeholder directories only; no driver has been implemented. |

## Reading order

1. Start with the [roadmap](roadmap.md).
1. For a screenshot walkthrough of the app itself, see [Using the app](guides/using-the-app.md).
1. Before changing anything in `shared/ui/src/components/primitives/`, `shared/ui/src/styles.css`, or a behavior an ADR names, read the [ADR index](adr/README.md) and the [design system reference](design/design-system.md) — see the `design-spec-guard` skill.
2. Read the [findings contract](architecture/findings-contract.md) before adding any analyzer or dashboard action.
3. Use the workflow documents to understand how utilities combine: [manuscript/editorial](workflows/manuscript-and-editorial-review.md), [recording/comping](workflows/recording-and-comping.md), [character continuity](workflows/character-continuity.md), and [technical QC/handoff](workflows/technical-qc-and-handoff.md).
4. Each planned utility has a dedicated implementation brief in [utilities/](utilities/).
5. Before adding a local model, executable, or model pack, use the [local dependency evaluation and license plan](research/local-dependency-evaluation.md).
6. For the planned move from developer bootstrap downloads to packaged-release
   first-use downloads, use the [first-use dependency provisioning brief](architecture/first-use-dependency-provisioning.md).
7. For developer checks, GitHub Actions, release promotion, and the required
   one-time repository settings, use [CI and releases](operations/ci-and-releases.md).

## Terms

- **Finding**: a confidence-ranked observation backed by evidence; it is not an edit.
- **Suggested action**: a reversible, narrator-approved operation associated with a finding.
- **Reference region**: a REAPER region explicitly approved as representative of a character voice.
- **Candidate take**: an alternate read collected for comparison; it is never automatically made active.
- **Project sidecar**: local metadata stored beside a project, not embedded in source audio.

All planned utilities are Windows-first, REAPER-first, local-first, and US-English-first. Every result remains subject to narrator review.
