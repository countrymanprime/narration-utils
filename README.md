# narration-utils

A group of utilities and plugins to assist with audio narration workflows. Each tool's business
logic is DAW-agnostic; a thin per-DAW driver wires it into a specific host.

- [`tools/manuscript-guide/`](tools/manuscript-guide/README.md) — builds a narrator reference
  (characters, places, organizations, pronunciations) from a Word manuscript.
- [`tools/transcript-compare/`](tools/transcript-compare/README.md) — transcribes a recorded
  chapter and diffs it against the manuscript, dropping take markers at every discrepancy.

Both tools share one native UI, shown below on the Home page. See
[Using the app](docs/guides/using-the-app/README.md) for a full screenshot walkthrough.

![Home, manuscript found](docs/images/ui/home-default.webp)

## Layout

```
narration-utils/
  shell/
    app.go, bindings.go        Native Go/Wails shell and generated binding boundary
  shared/
    (Go importer lives under shell/cmd/manuscript-import)
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

## Developer bootstrap

The UI is a local React + Tailwind workspace, shown in its own native window
(`shell/`, a Go/Wails app) with generated native bindings. Python is
used only for the two analysis tools the shell starts on demand. From the
checkout root, run:

```sh
pnpm run bootstrap
```

The bootstrap validates Node.js 22, Python 3.12, and Go;
creates the checkout-local `.venv`; installs locked Python, Node, and quality
tool dependencies; builds the UI; and builds the native workspace binary. It
uses the pinned Wails CLI and Go tooling declared by the repository, never
Cargo or a Rust toolchain.
Windows needs Visual Studio's Desktop development with C++ workload; macOS
needs Xcode Command Line Tools; Linux needs the WebKit/GTK development packages
listed in CI. The bootstrap does not install operating-system prerequisites.

On Windows the command uses the Python Launcher (`py -3.12`) by default. Use
`pnpm run bootstrap -- --python /path/to/python` to select Python explicitly,
`--skip-install` to build from existing local environments, `--refresh` to
recreate them from the committed lockfiles, or `--release` to build the Wails
release binary. It does not build installers and
does not download spaCy models or Piper voices. Without a spaCy model, Story
Bible uses its supported rules-only extraction fallback; Piper voices remain
catalog-managed, explicit first-use downloads.

This is the current **developer-checkout** workflow, not the intended release
installation path. Compiled GitHub releases package their own sidecars and
installer resources, and never call this command.

Legacy `.runtime` and `.bootstrap` directories created by the retired Windows
bootstrap are ignored but unused. After a successful bootstrap, review and
remove them manually if no older checkout still needs them.

While iterating on the shell without a full release build, `pnpm --dir shell run
dev` runs the native Wails window directly. The shipped Go importer accepts
Markdown and DOCX; PDF remains intentionally disabled pending corpus parity.

The launcher is intentionally the only REAPER action. It starts the companion
window; REAPER continues to service only selection, take-marker, and cursor
requests while the window is open.

## Shared library

Both tools retain their own DAW-agnostic Python backends. What they share:

- **`<project folder>\narration-utils\manuscript\manuscript.json`** — the one intentional,
  project-owned data contract between the two tools. DOCX and Markdown files are imported once;
  their preserved source copies are provenance only and are never reparsed. Existing v1
  PDF-derived canonical data remains readable, but new PDF import is fail-closed pending corpus
  parity.
- **`shared/reaper/`** — `reaper_common_core.lua` (ExtState access, file/path helpers) and
  `reaper_common_process.lua` (hidden-subprocess launching, the pipe-delimited protocol used by
  each tool's Python backend). Every reascript loads these via `dofile`, resolved relative to
  its own script path.
- **`shared/python/narration_common/`** — cross-tool contracts including canonical manuscript,
  settings, bridge, logging, and `progress.py` (the `stage|pct|message` progress-file writer,
  retry-hardened against Windows sharing violations), and `logging_utils.py` (stderr[+file]
  logging). Each backend adds this to `sys.path` relative to its own file.

See [`docs/architecture/codebase-map.md`](docs/architecture/codebase-map.md) for runtime
ownership and the staged module boundaries.

## Dependencies

All first-party Python tools (Manuscript Guide and Transcript Compare) share one
gitignored virtual environment at the repo root (`.venv/`), built from the
committed `uv.lock` by `pnpm run bootstrap`.

## License

Narration Utils is free software, licensed under the
[GNU Affero General Public License v3.0 or later](LICENSE) (AGPL-3.0-or-later). It is built to
help narrators for free and to stay that way: anyone who distributes it, or runs a modified
copy as a network service, must offer the corresponding source under the same terms. See
[ADR 0039](docs/adr/0039-the-project-is-licensed-agpl-3-or-later.md). Releases up to and
including v0.2.7-rc were published under the MIT license and remain available under it.
