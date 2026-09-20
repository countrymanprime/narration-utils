# Audacity integration (placeholder)

Not implemented yet. Once an Audacity driver exists for one of the sidecars under `sidecars/`, any
logic it needs to share with the other sidecars' Audacity drivers belongs here (each sidecar's own
placeholder note sits in a folder beside this file) — mirroring how
`integrations/reaper/` holds the Lua helpers common to both tools' Reaper drivers.

Audacity is scripted via [mod-script-pipe](https://manual.audacityteam.org/man/scripting.html)
(named pipes carrying text commands), which has no equivalent to REAPER's ExtState
(settings would need their own storage) or take markers (Audacity's label tracks are the
closest analog). A real driver here will need its own design, not a port of `integrations/reaper/`.
