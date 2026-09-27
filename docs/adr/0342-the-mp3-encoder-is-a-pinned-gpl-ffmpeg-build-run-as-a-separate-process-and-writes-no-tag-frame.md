# 0342. The MP3 encoder is a pinned GPL FFmpeg build, run as a separate process, and writes no tag frame

**Status:** Proposed
**Date:** 2026-09-27

## Context

[Render, Encode and Master](../prds/render-encode-master.prd.md) Phase 0 has to settle which encoder the `Encoder` port's first row runs before anything is catalogued. The PRD recommends (Q1 A, Q2 A, taken per D22) a catalogued, hash-verified static FFmpeg build that the Go host runs as a child process. The [research note](../research/ffmpeg-encoder-build.md) compared the sources: gyan.dev and GitHub-hosted builds (gyan.dev's mirror, BtbN) could not be reached from the working session (the egress proxy refused them), and BtbN's LGPL builds sit on tags that are pruned, so a pinned URL goes dead. The `imageio-ffmpeg` 0.6.0 `win_amd64` wheel on PyPI carries gyan.dev's FFmpeg 7.1 essentials build at an immutable URL with a published SHA-256, and answers range requests.

Encoding fixture WAVs with FFmpeg's defaults showed that its MP3 muxer's Info frame is headed "stereo" while LAME's audio is joint stereo: `internal/measure` skipped that frame as lost bytes and `internal/chaptertags` counted it as 26 ms of audio, so the app's two MP3 readers disagreed on a file the app itself would write.

## Decision

- The encoder asset is FFmpeg 7.1 essentials (gyan.dev), GPL-3.0-or-later build configuration, downloaded from the pinned PyPI wheel above (SHA-256 `02fa47c8...0a`, 31,246,824 bytes), of which the install keeps only `ffmpeg.exe` (SHA-256 `2ce797a0...a3`). It is Windows x86-64 only.
- It is never linked and never bundled: it is a first-use asset the narrator downloads on an explicit action, like every other (`config/encoder-assets.json` from Phase 1), and the Go host runs it as a separate process.
- MP3 is written with `libmp3lame` at a constant bit rate (192 kbps unless asked for more), with `-write_xing 0 -id3v2_version 0 -map_metadata -1`: the file holds MPEG audio frames and nothing else, so `measure` and `chaptertags` read the same frames and the same length. Tags and chapters are a Packager's job (`internal/chaptertags` today).

## Consequences

- The build's GPL-3.0-or-later class is compatible with the project's AGPL-3.0-or-later licence (ADR 0039) and is recorded with the notices; this project does not convey the binary (PyPI does), and the notices say where its source is.
- Only LGPL components of the build are exercised (the WAV reader, `libswresample`, `libmp3lame`, the `mp3` and MP4 muxers, the native AAC encoder). Moving to an LGPL-only build, or to gyan.dev's own archive, is a catalog change (URL, size, hashes) and a new ADR if the licence class changes; the encoder code does not change.
- A player cannot read gapless-playback padding from the file, since there is no Info frame; for a CBR delivery file that is split per chapter this is not needed, and a later format that needs it (M4B, Phase 2) has its own container.
- Proposed until the owner has run the Windows binary once on Windows (the real-binary test of Phase 1) and agreed to the distributor (#510).
