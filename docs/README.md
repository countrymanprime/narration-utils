# Narration Utilities Documentation

This folder documents a local-first audiobook narration toolkit: how it is built (architecture, design and decision records), how it is used (guides and workflows), and what is planned next. Planned work is specified as PRDs under [prds/](prds/README.md). The roadmap and the PRDs describe intent, not a claim that the planned utilities already exist. A curated part of this folder (the user guide, the roadmap, the component atlas, the tool pages, selected architecture and every ADR) is published as a website, generated from these files on every build ([how](operations/ci-and-releases.md#the-public-docs-site)); to publish another page, list it in `tools/docs-site/include.txt`.

## Status legend

- **Implemented**: usable code exists in the code folders (`apps/`, `sidecars/`, `libs/`, `integrations/`).
- **Planned—foundation**: required before dependent utilities can start.
- **Planned**: intentionally specified future work.
- **Deferred**: valuable work held outside the current milestone sequence.

## Current inventory

| Utility | Status | What it does now |
| --- | --- | --- |
| [Manuscript Guide](utilities/manuscript-guide.md) | Implemented | Extracts editable characters, places, organizations, pronunciations, evidence, and narration notes from a Word manuscript. |
| [Transcript Compare](utilities/transcript-compare.md) | Implemented | Locally transcribes a REAPER chapter track, compares it to the manuscript, and adds take markers for discrepancies. |
| [Recording Check](utilities/recording-coverage.md) | Implemented | Checks a chapter's saved REAPER track against its text, in order, and lists what is missing; feeds the measured recorded length and the `recording` stage signal. |
| [Review](guides/using-the-app/review.md) | Implemented | One queue of the findings from Transcript Compare, the Story Bible and take review: filter, sort, see the evidence, accept, dismiss or defer with a note, and go to, loop or mark a finding in REAPER ([findings contract](architecture/findings-contract.md)). |
| [Take review](utilities/take-review.md) | Implemented; checks on a real chapter and in REAPER pending with the owner | Finds pickups, restarts and duplicate reads on a chapter track (plus a pickup track or stretch of the timeline), lists each group's reads on the Review page to go to, loop and audition, adds a chosen read as a take in one undo step, and compares a group's takes side by side per category, never ranked. |
| [Delivery](guides/using-the-app/delivery.md) | Implemented (first cut) | Measures rendered chapter WAV files as a job with real progress and Cancel (integrated loudness, RMS, sample and true peak, noise floor, length, digital silence), shows a value it could not measure as "Not measurable", and marks values outside the narrator's own limits; no distributor's numbers are built in ([diagnostics PRD](prds/diagnostics-delivery-and-cleanup-tools.prd.md)). |
| [Tracks](utilities/tracks.md) | Implemented | Reads a project's REAPER `.rpp` file to list its tracks and play their audio (play/pause, skip 30s, previous/next track), with no running REAPER needed. |
| [Manuscript Teleprompter](architecture/manuscript-teleprompter.md) | Implemented (first cut) | Listens to a microphone with a local Whisper model and highlights the current word of a chosen manuscript chapter as it is read. Microphone is typed by name and only Whisper is wired up; misread findings, Moonshine, and a device picker are planned in the [engines and input devices PRD](prds/teleprompter-engines-and-input-devices.prd.md) and the integration PRD below. |
| [Teleprompter–Manuscript integration](prds/teleprompter-manuscript-integration.prd.md) | Planned | Plans the teleprompter as a reading mode of the Manuscript page: modal, story bible and notes, misread marks, seek to a word, resume from the DAW track's last audio, and punch-and-roll cursor moves. |
| [REAPER shared helpers](architecture/daw-integration.md) | Implemented | Provides ExtState, path, and hidden-process helpers for ReaScripts. |
| [The REAPER bridge and its test harness](architecture/reaper-bridge.md) | Implemented | The file protocol between the app and REAPER's Lua bridge, every command and event, and the Lua 5.4 harness (a fake `reaper` table plus mutation checks) that tests it without REAPER. |
| [Going to and looping a finding in REAPER](architecture/reaper-navigation.md) | Implemented; checks in REAPER pending with the owner | Navigating to a finding by item GUID with the stale rule, looping its context and restoring the narrator's time selection and repeat on Stop, adding one approved take marker for an accepted finding, the verification record and the owner's checklist. |
| [First-use dependency provisioning and Local assets](architecture/first-use-dependency-provisioning.md) | Implemented | Voices (Piper), transcription models (Whisper) and the Story Bible language model (spaCy) are catalog-managed downloads that start only after the narrator confirms; Settings > Local assets lists, verifies, repairs and removes them. Nothing downloads at startup and no model is bundled. |
| [Windows release, setup program and in-app update](operations/ci-and-releases.md#the-windows-setup-program) | Implemented (Windows); macOS and Linux are previews | A per-user NSIS setup program and an update zip on each GitHub release, both unsigned, with build provenance; the app checks for a newer release once a day at most (two hours after a failed check) and replaces itself only after a confirmed click ([in-app update](architecture/in-app-update.md)). |
| [Threat model](architecture/threat-model.md) | Implemented (a reviewed table) | Every trust boundary of the app (downloads, the update, the webview, sidecars, the REAPER bridge, opened files, the release pipeline) with its STRIDE threats, the mitigation in code and the risk that is left, lined up with [SECURITY.md](../SECURITY.md). |
| Audacity adapters | Deferred | Placeholder directories only; no driver has been implemented. |

## Reading order

1. Start with the [roadmap](roadmap.md).
1. For a screenshot walkthrough of the app itself, see [Using the app](guides/using-the-app/README.md).
1. Before changing anything in `apps/ui/src/components/primitives/`, `apps/ui/src/styles.css`, or a behavior an ADR names, read the [ADR index](adr/README.md) and the [design system reference](design/design-system.md) — see the `design-spec-guard` skill.
2. Read the [findings contract](architecture/findings-contract.md) before adding any analyzer or dashboard action, and the [stage recommendations signal contract](architecture/stage-recommendations.md) before building a signal that suggests a chapter's next stage.
3. Use the workflow documents to understand how utilities combine: [manuscript/editorial](workflows/manuscript-and-editorial-review.md), [recording/comping](workflows/recording-and-comping.md), [character continuity](workflows/character-continuity.md), and [technical QC/handoff](workflows/technical-qc-and-handoff.md).
4. Planned utilities and known defects are specified as PRDs in [prds/](prds/README.md), which indexes them; [utilities/](utilities/) keeps the docs for implemented tools ([Manuscript Guide](utilities/manuscript-guide.md), [Transcript Compare](utilities/transcript-compare.md), [Recording Check](utilities/recording-coverage.md), [Tracks](utilities/tracks.md), [Take review](utilities/take-review.md)).
5. Before adding a local model, executable, or model pack, use the [local dependency evaluation and license plan](research/local-dependency-evaluation.md), and record the artifact in [model provenance](architecture/model-provenance.md) (a generated table: a catalog entry without a review row fails `pnpm check`).
6. Before adding a downloadable model, voice or tool pack, or changing how one is installed, verified or removed, use the
   [first-use dependency provisioning](architecture/first-use-dependency-provisioning.md) rules and their implementation notes.
7. For developer checks, GitHub Actions, release promotion, and the required
   one-time repository settings, use [CI and releases](operations/ci-and-releases.md);
   for coverage, property tests, fuzzing, dead-code and import checks, use
   [Verification and code-health tooling](operations/verification-tooling.md).
8. For issues, labels, milestones, and the project board, use
   [Tracking work on GitHub](operations/github-workflow.md).
   Before switching on a REAPER bridge command that ships behind the Experimental REAPER actions switch, run
   [the REAPER verification pass](operations/reaper-verification-pass.md); the calls each command makes are in
   [the ReaScript calls behind the planned commands](research/reaper-api-for-planned-commands.md).
9. Before changing what crosses a trust boundary (a download, the update, a sidecar's arguments, the REAPER bridge, the
   files the app opens), read the [threat model](architecture/threat-model.md) and update its row in the same pull request.

## Terms

- **Finding**: a confidence-ranked observation backed by evidence; it is not an edit.
- **Suggested action**: a reversible, narrator-approved operation associated with a finding.
- **Reference region**: a REAPER region explicitly approved as representative of a character voice.
- **Candidate take**: an alternate read collected for comparison; it is never automatically made active.
- **Project sidecar**: local metadata stored beside a project, not embedded in source audio.

All planned utilities are Windows-first, REAPER-first, local-first, and US-English-first. Every result remains subject to narrator review.
