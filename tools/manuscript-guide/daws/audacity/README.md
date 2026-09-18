# Manuscript Guide — Audacity driver (placeholder)

Not implemented yet. The shared React workspace plus REAPER integration bridge are the reference
implementation for what an adapter needs to do: resolve the shared canonical manuscript JSON, run
`core/manuscript_guide.py` as a subprocess, and present its results (searchable entity list,
edit/lock fields, hotword export, audio preview playback) in the host's UI.

Audacity should reuse the same standalone React workspace rather than place a GUI inside its
script process. Its adapter needs only the host-specific selection and label-track mutations;
the layered Python settings store already requires no ExtState equivalent.
