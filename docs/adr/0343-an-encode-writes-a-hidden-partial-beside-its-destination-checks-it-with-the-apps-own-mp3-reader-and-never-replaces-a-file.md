# 0343. An encode writes a hidden partial beside its destination, checks it with the app's own MP3 reader, and never replaces a file

**Status:** Proposed
**Date:** 2026-09-27

## Context

[Render, Encode and Master](../prds/render-encode-master.prd.md) Phase 1 adds the first `Encoder` row, `ffmpeg`, which runs the FFmpeg build [ADR 0342](0342-the-mp3-encoder-is-a-pinned-gpl-ffmpeg-build-run-as-a-separate-process-and-writes-no-tag-frame.md) catalogues. The port promises that an encode never changes its WAV and leaves nothing at `dst` on a failure or a cancel (`internal/encodeport/encodeport.go`). The PRD asks for the same chain of custody that `internal/chaptertags` keeps ("new copy, never the source"). It also asks for tests that cancellation leaves no partial output and that a source path never equals a destination. An external encoder writes its output as it goes, so a killed process leaves half a file wherever it was told to write. FFmpeg also reads its input and output names as options or URLs as well as paths. Finally, the Phase 0 finding showed that FFmpeg's defaults can write an MP3 that the app's two readers disagree on.

## Decision

`encodeport.FFmpeg.Encode` (`apps/desktop/internal/encodeport/ffmpeg.go`) works as follows:

- **Refused before anything runs:** a format other than `mp3`; a spec no MPEG-1 Layer III file can have; a source that is not a WAV the app's own reader accepts; a `dst` that is the source (the same path after `filepath.Abs`, case-insensitively on Windows, or the same file by `os.SameFile`, which covers a hard link: `ErrSameFile`); and a `dst` where any file already exists (`ErrDestinationExists`). An encode never replaces a file. Choosing another name, or removing the old one, is the caller's decision, made with the narrator.
- **Output:** FFmpeg writes a hidden, uniquely named partial file beside `dst`, so the final rename stays on one disk. When FFmpeg exits 0, the partial is read back with `measure.ReadMP3`. It is renamed to `dst` only when it is CBR at the asked bitrate, sample rate and channel count, with no lost bytes. Any failure, the time limit (twice the audio's length plus five minutes) or a cancel removes the partial.
- **Sample rate:** a spec that leaves the rate open keeps the WAV's rate when MPEG-1 can hold it (32, 44.1 or 48 kHz). Otherwise it resamples to 44.1 kHz, so a low-rate source never becomes MPEG-2, which cannot reach ACX's 192 kbps.
- **Arguments:** both paths reach FFmpeg as absolute `file:` URLs with `-protocol_whitelist file`, alongside `-nostdin`. The process runs under the host's supervisor (`internal/process`, the Job Object), so closing the app ends it.
- **Progress:** `Spec.Progress` hears FFmpeg's `out_time_us`, capped at the WAV's length.
- **The row itself** is declared for Windows only, because the catalogued build is a Windows executable. It finds its executable through `encodeport.UseFFmpeg`, which the host sets at start to `ffmpeg.Manager.Path`. That answers `ErrEncoderNotInstalled` until the asset is installed and has been read in full once in the session.

## Consequences

- A cancelled, failed or timed-out encode leaves the destination folder as it was. The checks are pinned by `apps/desktop/internal/encodeport/ffmpeg_test.go`, which drives the real code path through a fake FFmpeg (the test binary itself), and by an opt-in run against a real FFmpeg (`NARRATION_UTILS_FFMPEG`).
- Every MP3 the app writes has already passed the reader that `acx.format` judges. A future FFmpeg build that changes its output is refused at encode time rather than shipped.
- Re-encoding over an earlier output needs an explicit delete or a new name. The packager and the export flow (Phases 4 and 5) decide how to offer that; the encoder does not.
- A second hidden file briefly sits beside the destination during an encode. An app crash mid-encode can leave it behind (its name ends `.encoding`); it is never read as a delivery file.
- Proposed until the owner has run an encode with the catalogued `ffmpeg.exe` on Windows (#510).
