# Audacity integration (placeholder)

Not implemented yet. Once an Audacity driver exists for one of the sidecars under `sidecars/`, any
logic it needs to share with the other sidecars' Audacity drivers belongs here (each sidecar's own
placeholder note sits in a folder beside this file) — mirroring how
`integrations/reaper/` holds the Lua helpers common to both tools' Reaper drivers.

Audacity is scripted via [mod-script-pipe](https://manual.audacityteam.org/man/scripting.html)
(named pipes carrying text commands), which has no equivalent to REAPER's ExtState
(settings would need their own storage) or take markers (Audacity's label tracks are the
closest analog). A real driver here will need its own design, not a port of `integrations/reaper/`.

There is deliberately no Audacity-side launcher in this folder. Nothing Audacity loads can start a program
([feasibility note](../../docs/research/audacity-launcher-feasibility.md)), so the installer adds a Start Menu entry,
"Narration Studio for Audacity", that starts the app with `--daw Audacity`
([ADR 0145](../../docs/adr/0145-the-audacity-launcher-is-an-installer-start-menu-entry-and-a-picker-switch-keeps-an-audacity-launch.md)).
The integration targets Audacity 3.x, because Audacity 4.0 ships without `mod-script-pipe`. The pipe client and the
adapter live in the desktop host, not here: `apps/desktop/internal/audacitybridge` and `apps/desktop/internal/dawport/audacity`
([ADR 0355](../../docs/adr/0355-audacity-is-driven-over-its-scripting-pipe-built-from-the-published-spec-and-verified-by-the-owners-pass.md)).
