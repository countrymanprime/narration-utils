# 0321. The mastering chain is a fixed high-pass, limiter and gain that masters to the profile's own measured RMS and sample peak

**Status:** Proposed
**Date:** 2026-09-27
**Supersedes:** none

## Context

[Render, Encode and Master](../prds/render-encode-master.prd.md) Phase 3 adds a built-in mastering chain, in ACX's own order: EQ, then a limiter, then gain into the RMS window [W3]. The PRD took these recommendations under D22:

- Q3: a built-in Go chain, not a REAPER FX chain.
- Q4: fixed parameters, with the targets read from the selected delivery profile.

Implementing it needed choices the PRD left open:

- what the EQ does;
- which RMS and peak definitions the chain aims at;
- where in the window it aims;
- how far under the peak limit the limiter holds;
- how the gain and the limiter settle together;
- what the chain does to the source file.

The delivery checker (`internal/deliveryprofile`, fed by `internal/measure`) judges:

- RMS over every sample of every channel, silences included (`measure.go`, `meterSet.Report`);
- the sample peak over every channel.

A chain that mastered to any other definition, such as speech-gated RMS, LUFS or a per-channel RMS, would "master" a file that the app's own checker then rejects.

## Decision

`apps/desktop/internal/mastering` is the chain. `Master(ctx, Request{Source, Destination, Profile}, Options)` runs it.

- **Targets come from the profile's rules, found by metric.** The chain reads the file rule with metric `rms_dbfs` and the one with `sample_peak_dbfs`. A rule counts only when it is measured by the app and not turned off. The chain does not look rules up by ID or profile, so a custom copy of ACX with other numbers, or a later platform's profile, masters to its own numbers with no code change (PRD Q4).
- **Where the chain aims:**
  - It aims at the middle of the RMS window: −20.5 dBFS for ACX.
  - With a one-sided bound it aims 2 dB inside that bound.
  - With no RMS rule it refuses (`ErrNoRMSTarget`).
- **Peak ceiling:**
  - The limiter holds the sample peak 0.5 dB under the profile's peak limit: −3.5 dBFS for ACX. The margin leaves room for sample rounding and an encoder's overshoot.
  - With no peak rule, it holds the peak 0.5 dB under full scale.
  - A target not below the ceiling is refused (`ErrUnreachableTarget`).
- **The EQ is a fixed 80 Hz second-order Butterworth high-pass and nothing else.** It takes out rumble and DC offset. It never shapes the voice itself: tonal EQ is the narrator's call, not "master to spec".
- **The limiter is a look-ahead sample-peak limiter:**
  - look-ahead 5 ms, release 100 ms;
  - one gain for all channels;
  - a min-hold, then a box-average of the needed gain, with the audio delayed by the look-ahead. This provably keeps every output sample at or under the ceiling. A final clamp absorbs floating-point rounding.
  - Output is aligned with the input and has the same length.
- **How the gain is found:**
  - The chain reads the source once for the EQ'd RMS. That gives the first gain.
  - Then up to four more read passes run with the limiter, each correcting the gain by the RMS it missed by, until it is within 0.05 dB.
  - The limiter sits before the gain, at the ceiling less the gain, which is ACX's order. So the limited RMS rises by at most each step, and the correction converges from below.
  - The gain is capped at +30 dB.
  - The file is streamed on every pass, never held in memory.
- **Chain of custody:**
  - The source is opened read-only, with `os.Open` only.
  - These destinations are refused (`ErrSameFile`):
    - the source's own path, however it is spelt;
    - a hard link to the source;
    - a symbolic link to the source.
  - Any other existing destination is refused too (`ErrDestinationExists`). Mastering never replaces a file. The existing-file check runs again just before the move into place.
  - The chain writes to a temporary file beside the destination and renames it only when it is complete. A failed or cancelled master leaves nothing behind.
  - The output keeps the source's sample rate, channels and sample format.
- **The output is re-measured, not predicted.** The result carries:
  - `measure`'s report of the source;
  - `measure`'s report of the written file;
  - `deliveryprofile.EvaluateFile` of the written file against the profile.

  So the narrator sees what the checker will say, including a rule the chain does not master to, such as the noise floor.

## Consequences

- Mastering and checking cannot disagree about RMS or peak: both use `internal/measure`'s definitions, and the result is the checker's own judgement.
- Gain raises the noise floor with the voice. A quiet recording mastered up into the window can fail the profile's noise-floor rule, and the judgement says so. The chain has no noise reduction or gate, by design, so it does not repair what it did not record.
- The chain limits the sample peak, not the true peak. On the analytic fixtures, ACX's −3 dBTP advice was met with 0.1 dB to spare. On real speech an intersample peak can exceed it, and the checker already shows that as advice. Holding the true peak would need an oversampled detector in this package, since `measure`'s is unexported. That would be a follow-up if the owner's listening check or the MP3 encode shows overshoot.
- PCM output is rounded, not dithered. At 24-bit that is inaudible. At 16-bit it adds quantisation distortion on very quiet passages. TPDF dither is a small later addition.
- Mastering reads the source several times, about 3 to 7 passes. For a chapter-length WAV that is disk-bound work of seconds, which Phase 5's job progress covers (`Options.Progress`).
- The fixed parameters (80 Hz corner, 5 ms look-ahead, 100 ms release, 0.5 dB margin, window middle) are tuned by numbers, not by ear. Whether the result sounds acceptable is an owner listening check (PRD risk table), filed on #510. Changing a parameter is a new ADR that supersedes this one.
- No binding, UI or wire contract is added here; Phase 5 adds them, along with the threat-model row for the narrator-chosen destination path.
