# Shared Audacity helpers (placeholder)

Not implemented yet. Once an Audacity driver exists for one of the tools under `tools/`, any
logic it needs to share with other tools' Audacity drivers belongs here — mirroring how
`shared/reaper/` holds the Lua helpers common to both tools' Reaper drivers.

Audacity is scripted via [mod-script-pipe](https://manual.audacityteam.org/man/scripting.html)
(named pipes carrying text commands), which has no equivalent to REAPER's ExtState
(settings would need their own storage) or take markers (Audacity's label tracks are the
closest analog). A real driver here will need its own design, not a port of `shared/reaper/`.
