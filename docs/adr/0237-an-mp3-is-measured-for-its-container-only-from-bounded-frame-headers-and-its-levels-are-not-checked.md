# 0237. An MP3 is measured for its container only, from bounded frame headers, and its levels are not checked

**Status:** Proposed
**Date:** 2026-09-25

## Context

ACX asks for each uploaded file to be an MP3 at 192 kbps or more, constant bit rate (CBR). The app measures the WAV render, so the `acx.format` rule has read "not checked" since the profile shipped ([ADR 0179](0179-a-built-in-dated-acx-delivery-profile-ships-and-a-project-is-judged-against-its-selected-profile.md)). [Delivery Platform Profiles](../prds/delivery-platform-profiles.prd.md) Phase 6 asked for the format to be read from the MP3's frame headers without decoding it. Decoding (levels on MP3) belongs to the diagnostics PRD's DX-2 and is not built. The MP3's bytes are untrusted input parsed in the host.

## Decision

1. `measure.MeasureFile` reads a picked file as an MP3 when its first bytes are an ID3v2 tag or an MPEG frame sync, and as a WAV otherwise. It chooses by the bytes, not the name. The allowlist of picked paths ([ADR 0156](0156-measurement-reads-only-files-picked-this-session-as-one-job-and-fingerprints-the-bytes-it-read.md)) is unchanged, and the file is still fingerprinted whole.
2. `measure.ReadMP3` (`apps/desktop/internal/measure/mp3header.go`) steps over an ID3v2 tag, then walks MPEG-1, 2 and 2.5 Layer III frame headers, trusting a frame's length from its own header. It reads a Xing, Info or VBRI tag in the first frame and stops at a closing ID3v1 or APE tag. The file is CBR when every audio frame has the same bitrate and no Xing or VBRI tag says otherwise (LAME's "Info" tag marks a CBR file). The report is `Report.MP3` (version, bitrate, average bitrate, CBR, VBR tag, sample rate, channel mode, frames, length, ID3v2 size, bytes skipped), with sample rate, channels and length also set on the report itself and every level null. Reads are bounded (a 64 KiB buffer, at most one frame at a time, a 64 KiB search for a lost frame, 1 MiB of skipped bytes per file), and a header found by searching counts only if another frame of the same stream follows it. Free-format, reserved and other-layer headers are refused with the reason; a range of an MP3 is refused.
3. `acx.format` is measured: its value is the bitrate in kbps (the CBR rate, or the average for a VBR file), its minimum 192 (`Unit: kbps`, so a custom copy may change it), and a file that is not CBR misses it with the violation `not_cbr`. On an MP3, the rules measured from samples (RMS, peak, noise floor, room tone) are "not checked" with the reason that the file is not decoded; they raise no finding. On a WAV, `acx.format` is "not checked" with the reason that the uploaded MP3 is what to measure. Sample rate, file length and channels are judged on both kinds.
4. A custom copy saved before this change has no bound on `acx.format`. When the store reads it, it takes the built-in's bound and unit, as it takes the built-in's `checkedBy` ([ADR 0236](0236-room-tone-at-a-files-edges-is-timed-against-the-silence-floor-and-a-custom-copy-takes-how-a-rule-is-checked-from-its-built-in.md)). A rule with no bound was never one the narrator could change.

## Consequences

- A narrator can measure the MP3s they will upload beside the WAV renders. One job judges both, and the book's channel rule compares them.
- No level is ever claimed for an MP3: loudness, peaks and room tone after encoding stay unmeasured until DX-2 decodes MP3.
- A file whose headers lie is read as what they claim: a verdict can be wrong, but nothing is written, run or fetched (threat model row 6j). The fuzz test `FuzzReadMP3` guards the parser's bounds.
- The picker still offers WAV first. Offering "MP3 audio (*.mp3)" in its filter is a one-line change in `apps/desktop/measure_job.go` (lane A); until then, "All files" picks an MP3.
- Superseding this needs a new ADR, for example when DX-2 decodes MP3 and measures levels on it.
