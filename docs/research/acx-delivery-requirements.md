# ACX Delivery Requirements, as the Built-in Profile Records Them

**Status:** Phase 0 of [Delivery Platform Profiles](../prds/delivery-platform-profiles.prd.md), partial: **pending owner** for reading ACX's page and for the comparison with Audacity's ACX Check.

**Profile:** `acx@2026-09` (`apps/desktop/internal/deliveryprofile/acx.go`). The Go table test `TestTheACXProfileHoldsEveryRequirementOfTheCheckedInTable` holds the same rows as the table below; change both together.

## Sources and what was (and was not) read

- **Primary source:** ACX, [Audio Submission Requirements](https://help.acx.com/s/article/what-are-the-acx-audio-submission-requirements).
- **Not reachable from agent sessions.** The help site is blocked by the environment's egress proxy (checked again on 2026-09-24: the proxy refuses the CONNECT). Nothing below was read on ACX's page in the session that wrote this note.
- **What the repository recorded from ACX's page:**
  - 2026-09-20, [Audiobook Credits Templates](../prds/audiobook-credits-templates.prd.md) (Evidence, "ACX conventions"): separate opening and closing credits files ("Opening and closing credits should be separate files", ACX's words), a retail sample of 5 minutes or less, "1 to 5 seconds of room tone at the beginning and end of each file", each file no longer than 120 minutes and starting with a section header.
  - Recorded 2026-09-23, [REAPER automation surface](reaper-automation-surface.md) (section 5, "ACX requirements", citing the same page): RMS between −23 and −18 dB, peak below −3 dB, noise floor below −60 dB RMS, MP3 at 192 kbps or higher CBR at 44.1 kHz.
- **Secondary sources (2025-2026, searched 2026-09-24 by the PRD):** [narrationbox](https://narrationbox.com/blog/acx-audio-specs-explained-2025-2026), [ChapterPass](https://chapterpass.com/learn/acx-audio-requirements), [Hanna Eng](https://www.hanna-eng.com/guides/acx-audiobook-requirements/). They agree with the numbers above except the room tone at the head (0.5 to 1 s).

Because only paraphrases were recorded (except the credits line), the profile marks each requirement as a paraphrase (`quoted: false`) and the Delivery page shows it without quotation marks. ACX's own words replace them when the owner reads the page (a new profile version, per PRD P5).

## Rules

"Verified" means the repository recorded the requirement from ACX's own page on the date given. It does not mean the app's measurement has been compared with ACX's own check: that comparison is the last section.

| Rule | Requirement (paraphrase unless quoted) | Scope | How the app checks it | Verification | What is left |
| --- | --- | --- | --- | --- | --- |
| `acx.rms` | Each file between −23 dB and −18 dB RMS | file | Measured: `rms_dbfs` −23 to −18 | to verify | RMS definition: the app measures the whole file, silences included, over every channel; compare with ACX Check |
| `acx.peak` | Peak values no higher than −3 dB | file | Measured: `sample_peak_dbfs` at most −3; true peak above −3 dBTP shown as advice (PRD P8) | to verify | Whether ACX means sample or true peak |
| `acx.noise_floor` | Noise floor no higher than −60 dB RMS | file | Measured: `noise_floor_dbfs` at most −60 (quietest 0.5 s window, digital silence excluded) | to verify | Window definition; compare with ACX Check |
| `acx.sample_rate` | 44.1 kHz | file | Measured on the WAV render: `sample_rate` = 44100 | verified (2026-09-23) | Checked on the MP3 after PRD Phase 6 |
| `acx.file_length` | Each file 120 minutes or shorter | file | Measured: `duration_seconds` at most 7200 | verified (2026-09-20) | |
| `acx.room_tone_head` | Room tone at the beginning of each file | file | Measured since PRD Phase 5 (ADR 0236): judged 0.5 to 5 s (PRD P4, the looser reading), digital silence in the head is advice | **conflicting** | ACX's page was read as 1 to 5 s; the guides say 0.5 to 1 s. The owner reads the page |
| `acx.room_tone_tail` | 1 to 5 s of room tone at the end of each file | file | Measured since PRD Phase 5 (ADR 0236): judged 1 to 5 s, digital silence in the tail is advice | verified (2026-09-20) | |
| `acx.format` | MP3, 192 kbps or higher, constant bit rate | file | Not checked by the app: the WAV render is measured; the MP3 container check is PRD Phase 6 | verified (2026-09-23) | |
| `acx.channels` | Mono or stereo, the same in every file | book | Measured: every file mono or stereo, and the same in every file | to verify | The "same in every file" wording and any mono preference |
| `acx.one_section_per_file` | One chapter or section per file, starting with a section header | book | Listen | verified (2026-09-20) | Later: the chapter-track mapping can flag a file with two chapter titles |
| `acx.credits` | "Opening and closing credits should be separate files" | book | Not checked by the app until the book checklist (PRD Phase 7) | verified (2026-09-20) | |
| `acx.retail_sample` | A retail sample of 5 minutes or less | book | Not checked by the app until the book checklist (PRD Phase 7) | verified (2026-09-20) | The 1 minute minimum some guides give |
| `acx.consistency` | Consistent sound and formatting, no extraneous sounds | book | Listen | to verify | ACX's own wording (recorded from guides) |
| (none) | Integrated loudness (LUFS) | file | Reported for information, not a rule | to verify | Whether ACX states a LUFS target (the guides say it does not) |

Left out on purpose: the PRD's `acx.no_digital_silence` advice row. The approved mockups list the thirteen rules above, and the digital-silence wording is unverified; it belongs with the room-tone measurement of PRD Phase 5.

## Open questions settled by the PRD's recommendations (owner-approved mockups)

- **P4.** A conflicting rule is judged against the looser reading with the conflict shown (room tone at the head, 0.5 to 5 s); an unverified rule is judged as written with a "to verify" badge.
- **P5.** The profile is pinned to the month the page was read (`acx@2026-09`); a new reading is a new version, offered, not forced.
- **P8.** ACX's peak is judged as the sample peak; the true peak is shown as advice.

## Comparison with Audacity's ACX Check (pending owner)

Not run: it needs Audacity with ACX Check, run by hand on the `internal/measure` test fixtures and two real chapters. Record per rule (RMS, peak, noise floor) the app's value, ACX Check's value and both verdicts in [delivery-measurement-validation.md](../architecture/delivery-measurement-validation.md). The PRD's target is the same verdict per rule and values within 0.5 dB.
