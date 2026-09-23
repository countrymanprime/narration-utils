# 0107. Moonshine ships inside the Windows Teleprompter sidecar and runs only from a verified catalog install

**Status:** Proposed
**Date:** 2026-09-23

## Context

ADR 0021 put Whisper and Moonshine behind one event contract, but until now Moonshine ran only from a developer's
ephemeral `uv` environment: `moonshine-voice` was not a project dependency, the frozen `manuscript-teleprompter`
sidecar left it out, and without `--model-dir` the library downloaded its model from Moonshine's servers into its own
cache, checked only by CRC32C. `docs/prds/teleprompter-engines-and-input-devices.prd.md` Phase 5 put the English
`tiny` and `small` streaming models in the hashed catalog (`config/moonshine-assets.json`, SHA-256 per file, ADR 0079);
Phase 6 has to make the shipped program use them. The owner chose (2026-09-23) to freeze `moonshine-voice` into the
existing sidecar rather than a second executable, falling back to one only if the size cost was unacceptable.

What was found while doing it:

- `moonshine-voice` 0.1.5 has wheels for Windows x64, Linux and macOS arm64, and none for macOS Intel. The PRD scopes
  Moonshine to Windows.
- The package loads `moonshine.dll`, and the `onnxruntime.dll` it ships beside it, with `ctypes` from its own folder.
  PyInstaller cannot see a `ctypes` load, so a freeze without them still starts and answers `--help`.
- The package's own data (sample WAVs, TTS embeddings, about 8 MB) is never needed to transcribe, and `sounddevice`
  (PortAudio for four architectures, about 2 MB) is imported only by its microphone, agent and TTS helpers, never by
  `Transcriber`. Capture here is PyAV `dshow`. `google-crc32c` is optional (imported in a `try`) and only speeds up the
  checksum of the library's own downloader.
- The library's own offline manifest for `en` with word timestamps names exactly the nine files, URLs and sizes the
  catalog pins (the attention decoder `decoder_kv_with_attention.ort` included). The PRD records that a directory
  without that decoder degrades word timings silently instead of failing.

## Decision

1. `pyproject.toml` pins `moonshine-voice==0.1.5 ; sys_platform == 'win32'`; `uv.lock` records it with its hashes. Other
   platforms neither install nor freeze it, so their Teleprompter offers Whisper only.
2. `scripts/release/prepare-resources.py` freezes it into `manuscript-teleprompter` with `--collect-binaries
   moonshine_voice` (Windows only) and `--exclude-module` for `sounddevice` and `google_crc32c`, and collects none of its
   data.
   `scripts/release/verify-installable.mjs` requires both DLLs in a Windows tree, and `narration-utils --smoke` runs
   `manuscript-teleprompter --check-moonshine`, which asks the native library for its language catalog (no model, no
   network) and fails the build if it cannot.
3. `sidecars/manuscript-teleprompter/core/moonshine_engine.py` owns which files Moonshine loads. With `--model-dir` it
   loads that directory as is, after checking it holds every file the catalog pins, and refuses (exit 1, naming the
   missing files) otherwise. Without `--model-dir` the frozen sidecar refuses to run Moonshine at all; only a source
   run keeps the library's downloader, as a developer tool. The sidecar checks presence, not hashes: the host verified
   every file by SHA-256 when it installed it (`apps/desktop/internal/moonshine`, `internal/assets`), as it does for
   Whisper.
4. A test holds the sidecar's file list, the catalog and the pinned library's own manifest to each other, so a library
   upgrade that changes the model layout or version fails in CI rather than at a narrator's first session.

## Consequences

- The Windows sidecar grows by 24,058,709 bytes (255,370,066 to 279,428,775, 243.5 MiB to 266.5 MiB, +9.4%; the two
  DLLs, 23.8 MB, are almost all of it), or 11.2 MB (+11.1%) compressed (tar and gzip -6 of the folder), measured on
  2026-09-23. Without the two exclusions it would have grown by 26.4 MB. No numeric limit
  was set; a second executable would carry its own Python runtime, numpy and PyAV and cost more than this, so the
  fallback is not taken. The owner reviews the figure with this ADR.
- The shipped program has no path to Moonshine's servers: the one download of a Moonshine model is the host's, from
  the pinned catalog URLs, verified by SHA-256.
- `moonshine-voice` is the first dependency with an environment marker. A Linux or macOS developer cannot run
  `--engine moonshine` from `uv sync` alone; they add it themselves or wait for a cross-platform decision (a new ADR).
- The wheel carries its own ONNX Runtime 1.23, separate from the `onnxruntime` package faster-whisper uses. A session
  loads one engine, so the two never share a process today; a change that loads both in one process must check which
  DLL each gets.
- Moving to another `moonshine-voice` version means re-checking its licence (D17), its wheel list and its DLL names, and
  updating the catalog if the manifest test fails.
