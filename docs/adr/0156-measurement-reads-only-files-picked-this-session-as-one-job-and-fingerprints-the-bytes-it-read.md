# 0156. Measurement reads only files picked this session, as one job, and fingerprints the bytes it read

- **Status:** Proposed
- **Date:** 2026-09-23

## Context and problem

`internal/measure` could measure a WAV file but nothing in the app called it for the narrator's own files. Phase 1 of
[the diagnostics PRD](../prds/diagnostics-delivery-and-cleanup-tools.prd.md) exposes it through bindings. That opens a
new path from the webview to a file the Go host opens: whatever path the UI sends, the host reads. Every earlier
boundary of that kind keeps the page from naming a path: `/media` serves only a source of the current project's `.rpp`
(ADR 0012), a recording check takes a chapter id, a take comparison a finding id. A measurement also runs for as long as
it takes to read the files (about 90 s per hour of 48 kHz stereo on the development machine), so it has to report real
progress and stop when the narrator asks (ADR 0015). And the PRD's Open Question 5 recommends that a finding keep its
id when the audio changes and carry a fingerprint of the audio as evidence instead.

## Decision drivers

- Whatever path the UI sends, the host reads, and every earlier boundary of that kind keeps the page from naming a path.
- A measurement runs for as long as it takes to read the files, so it has to report real progress and stop when the narrator asks (ADR 0015).
- Open Question 5 recommends that a finding keep its id when the audio changes and carry a fingerprint of the audio as evidence.

## Considered options

1. Measure only files picked in a native dialog this session, as one job, fingerprinting the bytes read

No alternatives were recorded when this decision was made.

## Decision outcome

**Chosen option: measure only files picked in a native dialog this session, as one job, fingerprinting the bytes read**, because the page must not be able to make the host read any file but one the narrator chose, and a long measurement has to report real progress and stop when asked.

1. **Only picked files.** `MeasurePickFiles` opens the operating system's multiple-file picker (WAV first, "All files"
   second) and the host remembers every absolute path it chose, for the rest of the app session; it is not per project.
   `MeasureAnalyze(paths)` refuses a path the picker did not choose, a relative path, an empty list and more than 500
   files, and measures a path sent twice once (`apps/desktop/measure_job.go`). The page can make the host read only a
   file the narrator chose in a native dialog.
2. **One job.** A measurement is one job at a time, in the shape of the host's other jobs (`MeasureJob`, kind
   `measurement`, phases idle, running, success, cancelled, error), ending with one `job:ended` event (ADR 0076). Its
   percent is the share of all the files' bytes read so far: each file's audio bytes read (`measure.Progress`) weighted
   by its size, never backwards, 100 only on success. `MeasureCancel` stops mid-file at the next block of 4096 frames;
   files measured before keep their results. A running measurement makes the host busy, so a project switch or an update
   install waits for it.
3. **A file that cannot be measured is a result, not a failure of the job.** Each file answers `measured` with its
   `measure.Report` (a level that cannot be measured is `null`, ADR 0025), or `failed` with the reason (not a WAV, more
   than two channels, missing, changed while read). The job's `error` phase is only for the measurement itself breaking
   (a panic, recovered).
4. **The fingerprint is the bytes read.** `measure.MeasureFile` hashes the file with SHA-256 while it measures it and reads
   on to the end, so the hash always covers the whole file, even for a range. The fingerprint is the size, the modified
   time (UTC, RFC 3339) and that hash. A file whose size or modified time changed between the start and the end is
   refused (`measure.ErrFileChanged`), because its report and its fingerprint would describe different audio; a file
   still being recorded is measured again once it is finished. `measure.FingerprintFile` fingerprints a file on its own.
5. **Read-only.** The files are opened read-only and nothing is written: no cache, no sidecar file, no log of the paths.

### Consequences

- **Good:** The page cannot turn the host into a reader of arbitrary files: the worst a hostile page can do is re-measure a file the
  narrator already picked. Threat model row 6g.
- **Neutral:** A later phase that measures something other than a picked file (the items of a REAPER project, Phase 8; a report's
  re-measure) needs its own source of paths, built by the host (for example from the saved `.rpp`, as `/media` does),
  not a wider allowlist. Measuring again after a restart means picking the files again.
- **Bad:** Measuring a range of a long file costs a read to the end of the file for the fingerprint. Per-item measurement (Phase
  11) that does not need a fingerprint keeps using `AnalyzeFileRange`.
- **Neutral:** The throughput baseline is recorded by `BenchmarkAnalyzeOneHourStereo48k`; the true-peak oversampler takes about 80% of
  the time, so that is where a target would be met.
- **Neutral:** Owner review: this ADR is Proposed; it records a trust-boundary choice (point 1) the PRD left to the implementation.

### Confirmation

Not recorded when this decision was made.
