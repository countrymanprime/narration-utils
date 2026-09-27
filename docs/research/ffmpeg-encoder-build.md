# FFmpeg encoder build: choice and verification

**Date:** 2026-09-27. **Stream:** N-V1, [render-encode-master](../prds/render-encode-master.prd.md) Phase 0. **Answers:** Q1 (what encodes the audio) at the level of an exact build: which FFmpeg, from where, under which licence class, and whether what it writes passes this app's own MP3 checks.

**Verdict: go, with two owner checks pending (below).** Catalog the FFmpeg 7.1 "essentials" static Windows build (gyan.dev, GPL-3.0-or-later build configuration) as it is published inside the `imageio-ffmpeg` 0.6.0 `win_amd64` wheel on PyPI, keep only `ffmpeg.exe` from it at install, and run it as a separate process. Encode MP3 with `libmp3lame` at a constant bit rate, with no Xing/Info frame and no ID3v2 tag (`-write_xing 0 -id3v2_version 0`): that output passes `acx.format` and `acx.sample_rate`, and both of the app's MP3 frame readers agree on its length to the microsecond. [ADR 0342](../adr/0342-the-mp3-encoder-is-a-pinned-gpl-ffmpeg-build-run-as-a-separate-process-and-writes-no-tag-frame.md) (Proposed) records the decision.

## Why this build, and why from PyPI

The PRD's recommendation is a catalogued static FFmpeg build (Q1 A) run by the Go host as a child process (Q2 A). A catalog row needs an immutable URL, an exact size and a SHA-256 ([first-use provisioning](../architecture/first-use-dependency-provisioning.md), [required dependency record](local-dependency-evaluation.md#required-dependency-record)). The candidates:

| Source | Licence class | Pinnable | Reached from this session |
| --- | --- | --- | --- |
| gyan.dev release archives (`www.gyan.dev/ffmpeg/builds/`) | GPL-3.0-or-later (essentials and full) | Versioned file names; how long old releases stay up was not checked | No: the egress proxy refused `www.gyan.dev` (403) |
| gyan.dev's GitHub mirror (`GyanD/codexffmpeg` releases) | GPL-3.0-or-later | Versioned release tags | No: `api.github.com` and `github.com` answered 403 |
| BtbN `FFmpeg-Builds` (GitHub) | LGPL or GPL variants | Daily `autobuild-*` tags, which (per its README, not re-checked here) are pruned after a while, so a pinned URL can go dead | No (GitHub, as above) |
| `imageio-ffmpeg` 0.6.0 wheel on PyPI, which carries gyan.dev's FFmpeg 7.1 essentials build | GPL-3.0-or-later (the binary); BSD-2-Clause (the Python wrapper, unused) | Yes: PyPI files are immutable, never pruned, and PyPI publishes the SHA-256 | Yes |

The PyPI wheel is the only source that is both reachable here and pinnable for as long as a release is supported: a file on `files.pythonhosted.org` cannot be replaced (a new upload needs a new version), and PyPI's own JSON API publishes its size and SHA-256. The host answers `Range` requests (`206 Partial Content`, checked), so the asset manager's resume works. The wheel is a zip, which the asset manager already unpacks (the spaCy wheels are the precedent, [ADR 0080](../adr/0080-the-story-bible-language-model-is-a-catalog-asset-unpacked-at-install-and-the-build-asks-before-it-downloads.md)).

An LGPL build (BtbN's `lgpl` variant) would be the narrower licence class, but its URLs do not stay up, and it could not be reached to be hashed. The GPL class is already accepted for this project: Narration Utils is AGPL-3.0-or-later ([ADR 0039](../adr/0039-the-project-is-licensed-agpl-3-or-later.md)), and the [licence classes](local-dependency-evaluation.md#license-classes) table allows a GPL-3.0-or-later component, preferring a separate executable, which this is.

## The exact build

| Field | Record |
| --- | --- |
| Download | `https://files.pythonhosted.org/packages/2c/c6/fa760e12a2483469e2bf5058c5faff664acf66cadb4df2ad6205b016a73d/imageio_ffmpeg-0.6.0-py3-none-win_amd64.whl` |
| Download SHA-256, size | `02fa47c83703c37df6bfe4896aab339013f62bf02c5ebf2dce6da56af04ffc0a`, 31,246,824 bytes (matches PyPI's published digest; uploaded 2025-01-16, not yanked) |
| Kept file | `imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe`, 87,638,016 bytes, SHA-256 `2ce797a0f88d7f067180338fb227f7b1928ea727bd9a4d7a1d022f7c52af71a3`; a PE32+ x86-64 console executable |
| Version string | `ffmpeg version 7.1-essentials_build-www.gyan.dev` (read from the binary) |
| Build configuration (read from the binary) | `--enable-gpl --enable-version3 --enable-static --disable-w32threads --disable-autodetect ... --enable-libmp3lame ... --enable-libopus --enable-libvorbis ...`; no `--enable-nonfree` |
| Licence class | GPL-3.0-or-later (`--enable-gpl --enable-version3`); the wrapper package is BSD-2-Clause and is not used |
| How it runs | A separate process the Go host starts (Q2 A); nothing links it |
| Platforms | Windows x86-64 only (the PRD's Windows-first scope); macOS and Linux have no catalog row |

## What was run

In a Linux cloud session, 2026-09-27. Nothing downloaded was committed.

1. Read the wheel list and digests from `https://pypi.org/pypi/imageio-ffmpeg/json`, downloaded the `win_amd64` and `manylinux2014_x86_64` wheels, and checked both SHA-256 against PyPI's.
2. Unpacked both and read the Windows executable's version and build configuration from its strings (the Windows binary cannot run here).
3. Ran the same wheel family's Linux binary (`ffmpeg version 7.0.2-static https://johnvansickle.com/ffmpeg/`, also `--enable-gpl --enable-version3 --enable-libmp3lame`) as a stand-in for the encode itself: two fixture WAVs (3 s, a 220 Hz tone; 44.1 kHz 16-bit mono and 48 kHz 24-bit stereo), each encoded at 192, 256 and 320 kbps with
   `ffmpeg -hide_banner -nostdin -nostats -loglevel error -i <wav> -map 0:a:0 -map_metadata -1 -c:a libmp3lame -b:a <n>k -ar 44100 -write_xing 0 -id3v2_version 0 -f mp3 <out>`.
4. Ran each MP3 through the app's own readers, from a throwaway Go test inside the module: `measure.MeasureFile` (the MP3 container check, [ADR 0237](../adr/0237-an-mp3-is-measured-for-its-container-only-from-bounded-frame-headers-and-its-levels-are-not-checked.md)), `deliveryprofile.EvaluateFile` against the built-in ACX profile, and `chaptertags`' `mp3Duration` (the chapter timeline's reader).

## Results

| Input | Bitrate | `measure.ReadMP3` | `acx.format` | `acx.sample_rate` | `measure` length | `chaptertags` length |
| --- | --- | --- | --- | --- | --- | --- |
| 44.1 kHz mono 16-bit | 192 | MPEG-1 Layer III, CBR 192, mono, 116 frames, 0 lost bytes | met (192) | met (44100) | 3.030204 s | 3.030204 s |
| 48 kHz stereo 24-bit | 192 | CBR 192, joint stereo, 116 frames, 0 lost bytes | met (192) | met (44100, resampled) | 3.030204 s | 3.030204 s |
| both | 256 | CBR 256, 0 lost bytes | met (256) | met | 3.030204 s | 3.030204 s |
| both | 320 | CBR 320, 0 lost bytes | met (320) | met | 3.030204 s | 3.030204 s |

**Why the encode writes no Info frame.** With FFmpeg's defaults (an Info frame and an ID3v2 tag), the mono file passed too, but the stereo one exposed a mismatch between the two readers the PRD's Q6 risk names: FFmpeg's MP3 muxer writes the Info frame's header as plain stereo while LAME encodes the audio as joint stereo, so `measure`'s same-stream check skipped the Info frame as 626 lost bytes (still CBR, still met), and `chaptertags` counted it as a frame of audio (3.056 s against 3.030 s, 26 ms per file on a chapter timeline). With `-write_xing 0 -id3v2_version 0` there is nothing but audio frames, both readers agree exactly, and nothing is lost. For a CBR file the Info frame carries nothing a delivery needs (its length follows from the size), and the ID3 tags a delivery does need are written later by a Packager (`internal/chaptertags` today, Phase 4). Q6 stays answered "no merge": the encoder is configured so that the two existing readers agree, rather than changing either reader.

## Encode and decode paths this PRD exercises

| Path | Phase | FFmpeg component | Licence of that component |
| --- | --- | --- | --- |
| WAV (PCM 16/24/32-bit, float) read | 1, 2 | `wav` demuxer, `pcm_*` decoders | LGPL-2.1-or-later (FFmpeg core) |
| Resample to 44.1 kHz and channel down-mix when a spec asks | 1, 2 | `libswresample` | LGPL-2.1-or-later |
| MP3 encode, CBR | 1 | `libmp3lame` (LAME; its exact version was not read) | LGPL-2.0-or-later |
| MP3 mux, no Info frame, no ID3v2 | 1 | `mp3` muxer | LGPL-2.1-or-later |
| AAC encode | 2 | native `aac` encoder | LGPL-2.1-or-later |
| MP4/M4B mux with chapters | 2 | `mp4`/`ipod` muxer | LGPL-2.1-or-later |

Every path used is LGPL code; the build as a whole is GPL-3.0-or-later because of components this PRD never calls (x264, x265 and others). A later move to an LGPL-only build, once one can be pinned, changes the catalog row and nothing else.

## What this session did not verify (owner, pending)

- **The Windows binary running on Windows.** Only its bytes, version and configuration were read here; the encode was run with the Linux build of the same family. The Phase 1 real-binary test (`NARRATION_UTILS_FFMPEG=<path to ffmpeg.exe> go test ./internal/encodeport/...`) is the check to run on Windows once the asset is installed. Filed on [#510](https://github.com/countrymanprime/narration-utils/issues/510).
- **The source offer and the choice of distributor.** The binary is GPL-3.0-or-later, and it reaches the narrator from PyPI (imageio's upload of gyan.dev's build), not from this project's release, so this project does not convey it; the notices name it, its licence and where its source is. Whether the owner would rather pin gyan.dev's own archive (not reachable from this session to hash) is a question for [#510](https://github.com/countrymanprime/narration-utils/issues/510), and changing it is a catalog row, not code.
- **Listening.** The encode is LAME at a fixed CBR; no listening check was done, and none is needed for the container checks this phase proves.
