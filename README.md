# narration-utils

A group of utilities and plugins to assist with audio narration workflows. Each tool's business
logic is DAW-agnostic; a thin per-DAW driver wires it into a specific host.

- [`sidecars/manuscript-guide/`](sidecars/manuscript-guide/README.md) — builds a narrator reference
  (characters, places, organizations, pronunciations) from a Word manuscript.
- [`sidecars/transcript-compare/`](sidecars/transcript-compare/README.md) — transcribes a recorded
  chapter and diffs it against the manuscript, dropping take markers at every discrepancy.

Both tools share one native UI, shown below on the Home page. See
[Using the app](docs/guides/using-the-app/README.md) for a full screenshot walkthrough.

![Home, manuscript found](docs/images/ui/home-default.webp)

## Layout

```
narration-utils/
  apps/
    desktop/                   Go/Wails desktop host: app.go, bindings.go, internal/, build/ icons
    ui/                        React + Tailwind workspace (built static assets); its tests/ hold the visual and atlas suites
  sidecars/                    Python programs frozen into the app and run on demand
    manuscript-guide/          core/ CLI backend, tests/
    manuscript-teleprompter/   core/ CLI backend, tests/, spikes/
    transcript-compare/        core/ CLI backend, tests/
  libs/
    python/narration_common/   DAW-agnostic helpers shared by the sidecars
  integrations/
    reaper/                    REAPER launcher and Lua bridge
    audacity/                  placeholder notes for a future Audacity driver
  config/                      shipped JSON: defaults, asset catalogs, roadmap
  tests/fixtures/              manuscripts used by tests across projects
  tools/ui-atlas-kit/          the reusable UI-atlas plugin (development tooling)
  scripts/                     repo automation, release and CI tooling
  docs/                        documentation, ADRs and PRDs
```

Each sidecar's `core/` has zero DAW-API calls: it is a plain CLI backend (docx parsing, NLP,
diffing, transcription) that the desktop host runs. All REAPER coupling lives in
`integrations/reaper/`. Path resolution throughout (config lookup, backend location) is derived
from each script's own location at runtime, so a checkout works unmodified at any install path.
The layout and its test rule are recorded in
[`docs/architecture/codebase-map.md`](docs/architecture/codebase-map.md).

## Supported DAWs

- **Reaper** — supported. Load `integrations/reaper/NarrationUtils_Launcher.lua` as
  the one action; it opens the centered Narration Utils workspace for both
  utilities and their global/project settings.
- **Audacity** — planned, not yet implemented. Audacity's scripting model
  (mod-script-pipe, label tracks instead of take markers, no ExtState-equivalent settings
  store) is different enough from Reaper's that it needs its own driver design rather than a
  port of the Reaper one. Placeholder notes live under `integrations/audacity/`.

## Developer bootstrap

The UI is a local React + Tailwind workspace, shown in its own native window
(`apps/desktop/`, a Go/Wails app) with generated native bindings. Python is
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

A compiled release is one program, `narration-utils` (`narration-utils.exe` on Windows), that knows its own version
(Settings > About & updates). Once a day at most it asks GitHub whether a newer release of this repository exists (switch
it off there), and on Windows, after your confirmed click, it downloads that release, checks it and replaces itself; it
never downloads or installs anything on its own. See [in-app update](docs/architecture/in-app-update.md).

Legacy `.piper`, `.runtime` and `.bootstrap` directories created by the retired
bootstrap scripts are ignored, never adopted: a voice or model in one of them is not
treated as installed, because nothing verified it against the catalog (see
[first-use dependency provisioning](docs/architecture/first-use-dependency-provisioning.md#migration-from-the-retired-bootstrap)).
After a successful bootstrap, review and remove them manually if no older checkout still
needs them; the app downloads and verifies its own copy on first use.

Developers who need the optional assets without waiting for the first-use download (offline
tests, packaging checks) can seed them explicitly. `pnpm run assets:seed -- --list` shows
every approved asset and whether it is installed; `pnpm run assets:seed -- tts whisper/tiny
spacy/en_core_web_sm` (a kind, `kind/id`, or `all`) installs them into the same per-user cache
the app reads, hash-verified, from the same pinned catalogs. Bootstrap never runs it.

While iterating on the shell without a full release build, `pnpm --dir apps/desktop run
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
- **`integrations/reaper/`** — `reaper_common_core.lua` (ExtState access, file/path helpers) and
  `reaper_common_process.lua` (hidden-subprocess launching, the pipe-delimited protocol used by
  each tool's Python backend). Every reascript loads these via `dofile`, resolved relative to
  its own script path.
- **`libs/python/narration_common/`** — cross-tool contracts including canonical manuscript,
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
