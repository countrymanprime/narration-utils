# narration-utils

A group of utilities and plugins to assist with audio narration workflows. Each tool's business
logic is DAW-agnostic; a thin per-DAW driver wires it into a specific host.

- [`tools/manuscript-guide/`](tools/manuscript-guide/README.md) — builds a narrator reference
  (characters, places, organizations, pronunciations) from a Word manuscript.
- [`tools/transcript-compare/`](tools/transcript-compare/README.md) — transcribes a recorded
  chapter and diffs it against the manuscript, dropping take markers at every discrepancy.

## Layout

```
narration-utils/
  shared/
    python/narration_common/   DAW-agnostic helpers shared by both tools' backends
    reaper/                    REAPER-specific shared Lua helpers (ExtState, subprocess launch)
    audacity/                  placeholder for future Audacity-specific shared helpers
  tools/
    manuscript-guide/
      core/                    DAW-agnostic Python backend, requirements, tests
      daws/reaper/             REAPER ReaScript driver
      daws/audacity/           placeholder
    transcript-compare/
      core/                    DAW-agnostic Python backend, requirements
      daws/reaper/             REAPER ReaScript driver
      daws/audacity/           placeholder
```

Each tool's `core/` has zero DAW-API calls — it's a plain CLI backend (docx parsing, NLP,
diffing, transcription) invoked by whichever `daws/<daw>/` driver is running it. All DAW
coupling lives under `daws/`. Path resolution throughout (`shared/` lookup, backend location)
is derived from each script's own location at runtime, so a checkout works unmodified at any
install path.

## Supported DAWs

- **Reaper** — supported. Load `shared/reaper/NarrationUtils_Launcher.lua` as
  the one action; it opens the centered Narration Utils workspace for both
  utilities and their global/project settings.
- **Audacity** — planned, not yet implemented. Audacity's scripting model
  (mod-script-pipe, label tracks instead of take markers, no ExtState-equivalent settings
  store) is different enough from Reaper's that it needs its own driver design rather than a
  port of the Reaper one. Placeholder folders exist under `daws/audacity/` in each tool and
  under `shared/audacity/`.

## Shared library

Both tools are independently runnable (own venv, own DAW actions) and each has its own README
with install/usage details. What they share:

- **`<project folder>\Manuscript.docx`** — the one intentional data contract between the two
  tools. Either tool's "Select Manuscript" action can (re)write it; neither reads the other's
  settings or output.
- **`shared/reaper/`** — `reaper_common_core.lua` (ExtState access, file/path helpers) and
  `reaper_common_process.lua` (hidden-subprocess launching, the pipe-delimited protocol used by
  each tool's Python backend). Every reascript loads these via `dofile`, resolved relative to
  its own script path.
- **`shared/python/narration_common/`** — `docx_chapters.py` (shared docx-opening/paragraph-
  walking primitive), `progress.py` (the `stage|pct|message` progress-file writer,
  retry-hardened against Windows sharing violations), and `logging_utils.py` (stderr[+file]
  logging). Each backend adds this to `sys.path` relative to its own file, so no shared virtual
  environment is needed — `narration_common` only touches the stdlib plus `python-docx`, which
  both venvs already have.

## Dependencies

Each tool keeps its own `.venv` and `requirements.txt` under `core/`, since their dependency
sets are large and unrelated (spaCy/pronouncing/phonemizer vs. faster-whisper/ctranslate2/av).
Set up each one from its own `core/` folder:

```bash
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```
