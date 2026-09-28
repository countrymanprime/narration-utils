# 0416. Public-domain LibriVox readings of the demo script are committed as test audio, and the corpora are built from them

**Status:** Proposed
**Date:** 2026-09-27
**Supersedes:** ADR-0125, in part (its rule that no audio is committed; its format and directory variable stand)

## Context

Several deferred PRD items wait for real narration: the recording check's uncalibrated defaults ([#425](https://github.com/countrymanprime/narration-utils/issues/425) item 3), the character-continuity Phase 1 trial run only on synthetic voices (N-D22, [character-continuity-acoustic-trial.md](../research/character-continuity-acoustic-trial.md)), and the editing and delivery diagnostics checked only on analytic fixtures (the owner queue, [#510](https://github.com/countrymanprime/narration-utils/issues/510)). Cloud agent sessions cannot fetch audio: their egress proxy refuses `librivox.org` and `archive.org` with a 403. [ADR 0125](0125-recording-coverage-ground-truth-is-scripted-recordings-with-paragraph-labels-and-a-corpus-directory-variable.md) kept all audio outside the repository, for size and because a narrator's own recordings or a manuscript may be under copyright. On 2026-09-27 the owner asked for real sample audio that matches the demo script and is in the repository, so that cloud agents can use it.

LibriVox recordings are public domain, and several read *Alice's Adventures in Wonderland* from the Project Gutenberg text that `apps/ui/src/api/fixtures/alice-in-wonderland.txt` already holds byte for byte.

## Decision

Seven LibriVox chapter recordings are committed unmodified under `tests/fixtures/audio/librivox-alice/source/` (about 45 MB): Kara Shallenberg's solo reading of Chapters I, II, VII, IX, X and XI, and Eric Leach's Chapter I as a second narrator. They are LibriVox's own 64 kbps mono MP3s, and `sources.json` pins each file's archive.org URL, MD5 and SHA-256. Word timings from Whisper `large-v3-turbo` are committed beside them (`alignment/`), so nothing downstream needs a model or a network.

The defective recordings are not committed. `build.py` derives them deterministically from the sources and JSON recipes (`recipes/`) into a directory outside the repository: the recording-check corpus in ADR 0125's layout (`NARRATION_COVERAGE_CORPUS`), the character-continuity trial's `manifest.json` layout, and a signal corpus of defects placed at known times (`NARRATION_SIGNAL_CORPUS`, read by `TestLibriVoxSignalCorpus` in `apps/desktop/internal/measure`). Labels come from the recipes by construction. A defect the tools are known to miss carries a `knownIssue` that the check logs, and the check fails once the defect is found, so the note is removed rather than left stale.

Only public-domain audio of public-domain text is committed. A narrator's own recordings, and anything permissioned, stay outside the repository as ADR 0125 says.

## Consequences

- Every session, including a cloud one with no network, can build and run real-speech corpora in about 10 seconds with the sidecar's own environment (numpy and PyAV). `test_librivox_alice_corpus.py` checks the checksums, the alignment and every recipe in `pnpm check`.
- The repository grows by about 45 MB, once. Adding a recording is another permanent addition, so a new source needs a reason a recipe over the existing ones cannot meet.
- LibriVox audio is 64 kbps MP3 at 22.05 kHz: good for word, pause and level work, but not a delivery master. Its noise floor is shaped by the encoder, and it cannot validate ACX's sample-rate or format rules.
- One reader is a narrow sample for the character trial, and two readers are a narrow sample for the recording check. The results are recorded as "LibriVox real speech", not as calibration on the owner's own recordings (implementation plan D19).
- Committing a narrator's own or a permissioned recording would take a new ADR that supersedes this one.
