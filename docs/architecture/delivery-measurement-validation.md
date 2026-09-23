# Delivery measurement validation against the EBU loudness test set

This note records how the Go `measure` package (`apps/desktop/internal/measure`) is checked against the EBU's official loudness test signals, and the result of each run. It is Phase 3 of the [diagnostics, delivery and cleanup tools PRD](../prds/diagnostics-delivery-and-cleanup-tools.prd.md). [ADR 0025](../adr/0025-delivery-measurements-in-go-profiles-deferred.md) records that the DSP had been checked only against BS.1770's published 48 kHz coefficients and against analytic signals, because the EBU files were not available offline.

## What is checked

The reference is EBU Tech 3341 Table 1 and EBU Tech 3342 Table 1 (both November 2023), measured on the EBU loudness test set v5.0. The expected values and tolerances are committed in [`expected.json`](../../apps/desktop/internal/measure/testdata/ebu/expected.json):

| Cases | Measure | Expected | Tolerance | Checked by |
| --- | --- | --- | --- | --- |
| Tech 3341, 1 to 5 | Integrated loudness | -23.0 LUFS (case 2: -33.0) | ±0.1 LU | The official files. Also, in every `pnpm check`, signals rebuilt from the Table 1 descriptions. |
| Tech 3341, 7 and 8 (authentic programmes) | Integrated loudness | -23.0 LUFS | ±0.1 LU | The official files only |
| Tech 3341, 15 to 19 | True peak | -6.0 dBTP (case 19: +3.0) | +0.2 / -0.4 dB | The official files. Also, in every `pnpm check`, signals rebuilt from the Table 1 descriptions. |
| Tech 3341, 20 to 23 (inter-sample peaks made at 4 fs) | True peak | 0.0 dBTP | +0.2 / -0.4 dB | The official files only |
| Tech 3341, 6 (5.0 surround) | None: the file must be refused | An error | - | The official files. Surround weights are not implemented (ADR 0025). |
| Tech 3341, 9 to 14 | Momentary or short-term loudness | - | - | Not applicable: `measure` has no momentary or short-term meter |
| Tech 3342, 1 to 6 | Loudness range (LRA) | - | - | Not applicable: `measure` does not compute LRA |

The gated test is `TestEBULoudnessTestSet`. It runs only when `NARRATION_EBU_DIR` names the unpacked set. [`testdata/ebu/README.md`](../../apps/desktop/internal/measure/testdata/ebu/README.md) explains how to get the files and run the test.

## Why the files are not committed or fetched by CI

The EBU's terms of use for its audio test sequences (July 2019, v1.0) allow use only to assess equipment and systems in internal research and development. They forbid copying, publishing or distributing the sequences. So the audio stays outside the repository, and CI cannot download it. The EBU site's browser check refuses scripted downloads, and downloading the files means accepting the terms, which a person must do. What the repository keeps is the table of published numbers, the gated test, a test that runs the gated runner over stand-in files named like the set's files, and the Table 1 signals rebuilt in code. The rebuilt signals run in every `pnpm check`. This settles Open Question 6 of the PRD with option (b). No DSP decision changed, so there is no new ADR.

Whether this project's use counts as "internal research and development" rather than a "business, commercial or for-profit" use is for the owner to judge before running the check.

## Results

| Date | Commit | Test set | Result |
| --- | --- | --- | --- |
| 2026-09-23 | This change | v5.0 | **Pending.** The zip could not be fetched without a person: `tech.ebu.ch` answered the scripted download with HTTP 403 and a browser check. The owner downloads it by hand and records the run here. |

In every `pnpm check`, the signals rebuilt from the Table 1 descriptions pass. At 48 kHz, 24-bit stereo, cases 1 to 5 read within ±0.1 LU of the expected loudness, and cases 15 to 19 read within +0.2 / -0.4 dB of the expected true peak. These are rebuilt from the table, not the EBU's files, so they do not replace the recorded run.

When a run is recorded, add a row above and paste the test's `-v` lines under it. Open an issue for any case outside tolerance, and link it from the row.
