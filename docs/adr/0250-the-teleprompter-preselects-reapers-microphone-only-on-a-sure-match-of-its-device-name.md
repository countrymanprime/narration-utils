# 0250. The teleprompter preselects REAPER's microphone only on a sure match of its device name

**Status:** Accepted
**Date:** 2026-09-25

## Context

[Teleprompter Manuscript Integration](../prds/teleprompter-manuscript-integration.prd.md) Phase 11 asks the app to identify the microphone REAPER uses and preselect it in the teleprompter's picker "only on a confident match, and say why". The read is already there: `chapter_track_state` reports REAPER's open input device (`GetAudioDeviceInfo("IDENT_IN")`, [ADR 0231](0231-chapter-track-state-is-one-read-only-answer-of-the-transport-the-arms-the-input-device-and-one-tracks-items.md)). The names still differ:

- REAPER names the device by its driver: "Focusrite USB ASIO" under ASIO; under WASAPI, probably the Windows endpoint name.
- The teleprompter opens microphones by their `dshow` names, such as "Microphone (Focusrite USB Audio)" or "Microphone (2- Shure MV7)".
- One interface often shows several `dshow` inputs ("Microphone …", "Line …").

What REAPER actually answers for each driver is unverified (spike 2 in the PRD, the verification pass's B1 and B7). The PRD's risk table asks for best-effort detection with a full-list fallback, and never to steal the device.

## Decision

- **A pure matcher** (`daw.MatchInputDevice`) compares REAPER's name with the device list:
  - The same name, ignoring case and spacing, is a match.
  - Otherwise each name is cut into its distinctive words. Generic words (`asio`, `wasapi`, `usb`, `audio`, `microphone`, `line`, `input`, `driver`, …) are dropped, and so is a lone digit (Windows numbers duplicates "2- …").
  - A device matches when it shares more than half of REAPER's distinctive words and more of them than any other device.
  - A tie is `uncertain`, with the tied devices as candidates (two inputs of one interface). Anything less is `no_match`.
- **One binding, `TeleprompterReaperInput()`** (host API 57), asks REAPER once, read-only, never on a timer. It reads the transport, the arms and the device: `chapter_track_state` with no track. It then lists the microphones through the sidecar as the picker does and answers `{status, reason?, message, reaperDevice?, device?, candidates}`.
  - `device` is set only on `matched`, and `message` is the reason to show ("REAPER records from "Shure MV7", so "Microphone (2- Shure MV7)" is selected.").
  - Each of these answers `unavailable` with a reason: no heartbeat, the experimental switch off (ADR 0230), a timeout ("uncertain", never a guess), REAPER naming no device, or a failed listing.
- **The picker only preselects.** A match never overrides a microphone the narrator already chose for this session, and every other answer leaves the full list as it is. Nothing opens or holds the device to detect it.

## Consequences

- The match is only as good as the name pairs seen so far. The rule errs toward `uncertain` and `no_match`, which cost the narrator one pick, never the wrong microphone. The owner's B7 run records the real `IDENT_IN` names for ASIO and WASAPI; a pair that does not match becomes a test case, and the generic-word list grows from evidence.
- Whether the teleprompter can open the microphone while REAPER holds it (exclusive ASIO or WASAPI) is the owner's B8 run. A failed open is reported by the meter and the session (ADR 0247), not hidden.
- Preselecting in `MicrophoneField` and the microphone popover, with the reason shown, is the UI half, built on this binding by the UI lane. The mock answers each status (`?mockReaperInput=`).
