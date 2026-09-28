# 0416. LibriVox readings of the demo script are fetched from archive.org, and only their markers and recipes are committed

**Status:** Proposed
**Date:** 2026-09-27

## Context

Several deferred PRD items wait for real narration: the recording check's uncalibrated defaults ([#425](https://github.com/countrymanprime/narration-utils/issues/425) item 3), the character-continuity Phase 1 trial run only on synthetic voices (N-D22, [character-continuity-acoustic-trial.md](../research/character-continuity-acoustic-trial.md)), and the editing and delivery diagnostics checked only on analytic fixtures (the owner queue, [#510](https://github.com/countrymanprime/narration-utils/issues/510)). LibriVox recordings are public domain, and several read *Alice's Adventures in Wonderland* from the Project Gutenberg text that `apps/ui/src/api/fixtures/alice-in-wonderland.txt` already holds byte for byte.

[ADR 0125](0125-recording-coverage-ground-truth-is-scripted-recordings-with-paragraph-labels-and-a-corpus-directory-variable.md) keeps audio out of the repository. A first version of this change committed the MP3s (about 45 MB), because cloud agent sessions could not reach archive.org. On 2026-09-27 the owner added archive.org to the cloud sessions' allow list and asked for the audio to be downloaded where it is used, with the repository holding what is needed to find the markers and rebuild the test states.

## Decision

The recordings are fetched, not committed. `tests/fixtures/audio/librivox-alice/sources.json` names seven LibriVox chapter recordings: Kara Shallenberg's solo reading of Chapters I, II, VII, IX, X and XI, and Eric Leach's Chapter I as a second narrator. For each it gives the archive.org URL of LibriVox's own 64 kbps MP3, its reader and chapter, and its MD5 and SHA-256. `build.py fetch` (and every build) downloads any missing recording into `NARRATION_LIBRIVOX_DIR`, or `~/.cache/narration-utils/librivox-alice`, outside the repository, and keeps a file only when its SHA-256 matches.

The repository holds what cannot be fetched:

- `alignment/<id>.words.json`: Whisper `large-v3-turbo` word timings for each recording.
- `alignment/<id>.markers.json`: where every paragraph and sentence of the script sits in the recording, each cut point between them, and whether that cut is in a real pause.
- `recipes/*.json`: how to build each test state from those markers.

`build.py` turns the recordings and recipes into three corpora outside the repository: the recording-check corpus in ADR 0125's layout (`NARRATION_COVERAGE_CORPUS`), the character-continuity trial's `manifest.json` layout, and a signal corpus of defects placed at known times (`NARRATION_SIGNAL_CORPUS`, read by `TestLibriVoxSignalCorpus` in `apps/desktop/internal/measure`). Labels come from the recipes by construction. A defect the tools are known to miss carries a `knownIssue` that the check logs, and the check fails once the defect is found, so the note is removed rather than left stale.

## Consequences

- `pnpm check` needs no network: `test_librivox_alice_corpus.py` checks the word timings, the markers and every recipe's labels from the committed files alone. The checks that need the recordings (the checksums, that the committed markers are the ones the recordings give, a signal build) run only after `build.py fetch`, and are skipped otherwise.
- A session that builds the corpora downloads about 45 MB from archive.org once per machine. If archive.org is unreachable or a file changes, the build stops and names the file; nothing unverified is used.
- The markers depend on the exact published file. If archive.org ever replaces a recording, its SHA-256 no longer matches, and `sources.json`, the word timings and the markers must be regenerated together (`transcribe.py`, then `build.py markers`).
- LibriVox audio is 64 kbps MP3 at 22.05 kHz: good for word, pause and level work, but not a delivery master, and it cannot validate ACX's sample-rate or format rules.
- One reader is a narrow sample for the character trial, and two readers are a narrow sample for the recording check. The results are recorded as "LibriVox real speech", not as calibration on the owner's own recordings (implementation plan D19).
- ADR 0125 stands: no audio is committed. Committing a recording would take a new ADR that supersedes this one.
