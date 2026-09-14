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
    reaper/                    REAPER launcher and non-UI integration bridge
    ui/                        React + Tailwind workspace (built static assets)
    audacity/                  placeholder for future Audacity-specific shared helpers
  tools/
    manuscript-guide/
      core/                    DAW-agnostic Python backend, requirements, tests
      daws/reaper/             reserved for future REAPER tool-specific adapters
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

## Quickstart

The supported UI is a local React + Tailwind workspace, opened in the user's
default browser and served by a Python API host (`shared/server`). From the
checkout root, run either:

```powershell
.\scripts\Quickstart.ps1
```

or double-click `scripts\Quickstart.cmd`. The script downloads a private Python
runtime, creates and maintains one shared gitignored virtual environment for
every first-party tool (Manuscript Guide, Transcript Compare, and the shared
server), installs their dependencies, downloads the default spaCy model,
installs UI packages, and builds the production UI bundle. It also installs
the local Piper preview runtime and a U.S. English medium voice. Node.js/npm
is the machine-level prerequisite. Python, Piper, packages, and the
downloaded bootstrap files remain in gitignored folders in this checkout;
REAPER does not discover or run a global or VST-folder Python.

If desired, an existing Python interpreter can still be used only to create
the private environments; it is never retained as a REAPER dependency:

```powershell
.\scripts\Quickstart.ps1 -BootstrapPython C:\path\to\python.exe
```

The launcher is intentionally the only REAPER action. It starts the companion
window; REAPER continues to service only selection, take-marker, and cursor
requests while the window is open.

## Shared library

Both tools retain their own DAW-agnostic Python backends. What they share:

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
  logging). Each backend adds this to `sys.path` relative to its own file.

## Dependencies

All first-party Python tools (Manuscript Guide, Transcript Compare, and the shared server/config
code) share one gitignored virtual environment at the repo root (`.venv/`), built from the
repo-root `requirements.txt`. `scripts\Quickstart.ps1` manages this environment together with
the UI host.
