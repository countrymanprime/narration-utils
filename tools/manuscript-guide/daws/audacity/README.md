# Manuscript Guide — Audacity driver (placeholder)

Not implemented yet. The Reaper driver in [`../reaper/`](../reaper/) is the reference
implementation for what a driver needs to do: resolve/copy the shared `Manuscript.docx`, run
`core/manuscript_guide.py` as a subprocess, and present its results (searchable entity list,
edit/lock fields, hotword export, audio preview playback) in the host's UI.

Audacity has no built-in immediate-mode GUI toolkit equivalent to REAPER's `gfx.*`, so this
driver's UI will likely need to be a small standalone window (e.g. a Python GUI launched
alongside Audacity) rather than a script running inside Audacity itself. Settings persistence
will also need its own mechanism, since Audacity has no ExtState equivalent.
