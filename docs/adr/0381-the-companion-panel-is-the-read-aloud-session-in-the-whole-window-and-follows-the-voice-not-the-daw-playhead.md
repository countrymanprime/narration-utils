# 0381. The companion panel is the read-aloud session in the whole window, and its script follows the voice, not the DAW playhead

**Status:** Proposed
**Date:** 2026-09-27

## Context

[Booth Mode and Companion Panel](../prds/booth-mode-and-companion-panel.prd.md) Phase 7 builds the layout that fills the narrowed, pinned window from Phase 6 ([ADR 0401](0401-companion-mode-resizes-and-pins-the-one-existing-window-and-never-opens-a-second-one.md)): `CompanionShell.tsx` on `CompactShell`, with the script, a "Following playhead" status, placeholder note-at-playhead and pickups sections, a hotkey list and "Full app". Doing that work left three choices the PRD does not settle:

1. **Where it mounts.** Booth mode sits inside `ReadAloudDialog`'s `Dialog size="full"` (Open Question 2). `CompactShell` always renders its own `<main>` and has no `asMain` switch, and a Base UI dialog leaves the page's own `<main>` in the accessibility tree, so the same approach would put two `main` landmarks on the page (axe `landmark-no-duplicate-main`). Primitives are lane U's to change.
2. **What "Following playhead" means.** The mock shows the script tracking REAPER's playhead. The UI has REAPER's transport and position in seconds, live (`daw_transport_changed`, DAW port PRD Phase 9, ADR 0305), but nothing maps a project time to a word of the chapter while REAPER plays. `TeleprompterLocate` (ADR 0111) answers one "where does the recording end" question by transcribing, which is too slow to follow a playhead.
3. **What "Full app" does to a reading in progress.**

## Decision

- **The companion is a third surface of the same `ReadAloudDialog` session.** `mode: 'companion'` renders `CompanionShell` in place of the `Dialog` (the same `useTeleprompterSession`, follow cursor, Record-in-REAPER orchestration and `booth` command scope as the dialog and the booth). There is still exactly one session, and `reading.toggle` (Space) is registered by whichever surface is mounted.
- **It is the whole window.** `CompanionShell` renders through a portal to `<body>` as a fixed, full-viewport layer. While it shows, it sets `aria-hidden` and `inert` on every other child of `<body>` and restores them exactly on unmount. `CompactShell`'s banner and main are therefore the only landmarks, and the full app behind can't be tabbed into. The full app's own toast live regions are hidden with it, which matches the booth's "nothing interrupts the narrator" rule. The aria snapshot `companion-panel.aria.yml` pins this with `children: equal` at the root.
- **The window follows the surface's life.** `CompanionModeEnter` runs when the surface mounts and `CompanionModeExit` when it unmounts. Unmounting covers every way out (Full app, the double Escape, the dialog closing), and the host's exit is a no-op when nothing was entered, so no path leaves the window narrow and pinned. A failed enter shows an inline alert, and the panel stays usable.
- **The script follows the narrator's voice, as it does in the dialog and the booth. The header reports REAPER's playhead; it doesn't steer the script.** The badge reads "Playhead m:ss.t" while REAPER plays, "Recording · m:ss.t" while it records, and "Playhead stopped" otherwise. Nothing in the panel claims that the text is tracking the DAW.
- **"Full app" (and the second Escape within 3 s) switches the same dialog to the normal Read aloud layout.** A reading in progress carries on at full size instead of stopping or asking to stop.

## Consequences

- No primitive changed. If lane U later gives `CompactShell` an `asMain` switch, the companion could live inside a `Dialog` instead; the whole-window portal would still be the better fit for a window that shows nothing else.
- **Owner question (on #510):** should the companion's script follow REAPER's *playhead* (as the concept mock implies) rather than the narrator's voice? That needs a live project-time-to-word mapping, for example from a chapter's aligned transcript (Transcript Compare's word timings) offset by the linked track's position. That is its own phase and is not built here. Until then the status badge reports the playhead, and the script follows reading as everywhere else.
- The companion's hotkeys work only while the app's window has focus, and it says so. Global hotkeys are Input Commands and Pedals Phase 12's spike.
- The window's minimum width: Wails' `SetSize` lowers the window's minimum to the companion width to fit it, and `CompanionModeExit` does not restore the original 960 px minimum, so after leaving companion mode the full app can be dragged narrower than before. This is a small lane A follow-up in `bindings_companion.go` (`SetMinSize` on exit), raised on #509.
