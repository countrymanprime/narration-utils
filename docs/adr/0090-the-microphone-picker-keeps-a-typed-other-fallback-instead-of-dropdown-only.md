# 0090. The microphone picker keeps a typed "Other…" fallback instead of dropdown-only

**Status:** Proposed
**Date:** 2026-09-22
**Supersedes:** (none; narrows the "Microphone is never typed" row in `docs/prds/teleprompter-engines-and-input-devices.prd.md`'s Decisions Log, recorded 2026-09-20)

## Context

`teleprompter-engines-and-input-devices.prd.md` records a firm decision, made with the user on 2026-09-20: "The microphone is detected from the DAW (PRD 1 phase 11) or chosen from a dropdown of listed devices; no free-text field or 'Other...' entry exists, and a failed listing blocks the phase instead of falling back to typing." Phase 2's own scope line repeats this: "dropdown-only picker (no typed name, no 'Other...' entry)".

This phase was implemented by an overnight agent from a task brief that, independently, specified the opposite for the picker's fallback behavior: "a Select or Combobox ... listing real enumerated devices, with a way to fall back to a typed 'Other...' entry if enumeration returns nothing or the desired device isn't listed." That instruction was followed as written (see `apps/ui/src/components/teleprompter/MicrophoneField.tsx`), which now contradicts the PRD's recorded decision. The owner was not available to resolve the conflict before the PR opened, so this ADR records the change as `Proposed` rather than silently overriding the earlier decision or silently following it and leaving the contradiction undocumented.

## Decision

`MicrophoneField` renders a dropdown of the devices `TeleprompterDevices` reports. It falls back to a typed field in exactly two cases: the device list is empty (nothing to choose from), or the picker is in the typed "Other…" mode the narrator chose explicitly from the dropdown. A remembered device that is not in the current list is never silently replaced: it is kept selected and shown as "(not found)" until the narrator re-picks or types something else — the part of the original decision this change keeps.

This narrows, rather than fully reverses, the original rule: the dropdown is still the default and the only thing offered when devices are found, and enumeration never blocks the phase (unlike the "failed listing blocks the phase" clause, which conflicted with the PRD's own Architecture Notes that a listing failure "returns an empty list and a message, never block Start").

## Consequences

- A narrator whose device enumeration fails, or whose real device is missing from the list for any reason, can still start a session today rather than being blocked until enumeration is fixed.
- This reintroduces the original failure mode the initiative exists to remove (a mistyped device name) for the fallback path only; the dropdown path removes it as intended for every device that lists correctly.
- If the owner prefers the PRD's original dropdown-only rule, superseding this ADR to `Rejected`-equivalent (a new ADR restoring dropdown-only) and removing the "Other…" branch and its tests in `MicrophoneField.tsx`/`MicrophoneField.test.tsx` is a small, isolated change.
- `docs/prds/teleprompter-engines-and-input-devices.prd.md`'s Decisions Log and Phase 2 scope line should be reconciled to match whichever way this ADR is resolved.
