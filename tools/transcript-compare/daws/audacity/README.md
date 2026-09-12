# Transcript Compare — Audacity driver (placeholder)

Not implemented yet. The Reaper driver in [`../reaper/`](../reaper/) is the reference
implementation for what a driver needs to do: locate the selected audio for a chapter, run
`core/compare.py` as a subprocess, and turn its `MARKER|...` output lines into visible
discrepancy markers in the host, plus surface the saved diff file.

Audacity has no take-marker equivalent — its closest analog is a
[label track](https://manual.audacityteam.org/man/label_tracks.html), which this driver would
need to populate instead of REAPER's `SetTakeMarker`. Audacity is scripted via
[mod-script-pipe](https://manual.audacityteam.org/man/scripting.html) rather than an in-process
Lua API, so audio selection/track enumeration will need different plumbing than
`daws/reaper/TranscriptCompare_Run.lua` uses.
