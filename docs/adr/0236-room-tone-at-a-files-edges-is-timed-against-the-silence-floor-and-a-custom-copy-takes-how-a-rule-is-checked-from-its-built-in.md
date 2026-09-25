# 0236. Room tone at a file's edges is timed against the silence floor, and a custom copy takes how a rule is checked from its built-in

**Status:** Proposed
**Date:** 2026-09-25

## Context

The built-in ACX profile ([ADR 0179](0179-a-built-in-dated-acx-delivery-profile-ships-and-a-project-is-judged-against-its-selected-profile.md)) lists room tone at the head (0.5 to 5 s, the looser of two readings) and at the tail (1 to 5 s) of each file, but until [Delivery Platform Profiles](../prds/delivery-platform-profiles.prd.md) Phase 5 the app did not measure them, so both rules read "not checked by the app yet". The PRD asked for a definition of "speech starts" that agrees with ACX Check, using the silence map's floor ([ADR 0158](0158-windowed-diagnostics-are-one-read-pass-with-fixed-windows-narrator-thresholds-and-candidate-findings.md), −50 dBFS). ACX also asks for room tone, not digital silence, at the edges. Custom profiles ([ADR 0180](0180-custom-delivery-profiles-are-copies-of-a-built-in-kept-in-a-user-level-file.md)) are full copies of a built-in written to `delivery-profiles.json`, including each rule's `checkedBy`, so a copy saved before Phase 5 would have said "not checked" forever.

## Decision

1. `measure.Report` times the edges in the same read pass as every other measurement (`apps/desktop/internal/measure/edges.go`): the head is from the start of the audio to the first 50 ms window whose RMS over all channels is at or above −50 dBFS, and the tail from the end of the last such window to the end of the audio. The same pass counts the exact-zero windows within each edge. The four values are `head_room_tone_seconds`, `tail_room_tone_seconds`, `head_digital_silence_seconds` and `tail_digital_silence_seconds`, all null when no window reaches the floor (a file of room tone or silence has no edge to time from, so the rules are "not measurable", never met). The floor is fixed, not a narrator setting: it is what separates room tone from reading, not a delivery limit.
2. `acx.room_tone_head` and `acx.room_tone_tail` are measured against those values with their existing bounds, and each carries advice (a warning, not a miss) when its edge holds any digital silence. The profile's version stays `acx@2026-09`: its requirements did not change, only whether the app checks them.
3. How a rule is checked (`checkedBy`, the reason it is not checked, its advice) belongs to the build of the app, not to the narrator. When the store reads a custom profile it takes those three fields from the built-in rule with the same id; the narrator's numbers, names and switches are kept.

## Consequences

- Both room-tone rules are judged on every measured WAV, and their findings carry the ids ADR 0179 defined, so nothing already reviewed changes id.
- A render with speech in its first 50 ms has 0 s of head room tone and misses ACX's minimum, which is the point. A render whose reading never rises above −50 dBFS (a whisper at a very low level) reads as having no edges; the rule is then "not measurable", not met.
- The window and floor are the app's, not ACX Check's. Phase 0 of the PRD (the comparison with Audacity's ACX Check, owner-run) may move them; that change is a new ADR and a new `AnalyzerVersion`.
- A custom copy can no longer freeze an old check. The cost is that a future build that stops checking a rule also stops for every copy; that is intended.
- Superseding this needs a new ADR, for example to make the floor a profile rule or a narrator setting.
