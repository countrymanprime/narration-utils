# narration-utils

A group of utilities and plugins to assist with audio narration workflows. Each tool's business
logic is DAW-agnostic; a thin per-DAW driver wires it into a specific host.

- [Manuscript Guide](docs/utilities/manuscript-guide.md) (`sidecars/manuscript-guide/`, the Story Bible page) — builds a
  narrator reference (characters, places, organizations, pronunciations) from a manuscript. A downloadable spaCy language
  model makes it more accurate; without one it uses its rules-only fallback.
- [Transcript Compare](docs/utilities/transcript-compare.md) (`sidecars/transcript-compare/`, the Proofing page) —
  transcribes a recorded chapter with a local Whisper model and diffs it against the manuscript, dropping take markers at
  every discrepancy.
- [Tracks](docs/utilities/tracks.md) (the Tracks page) — lists the tracks of a project's REAPER `.rpp` file and plays their
  audio, with no running REAPER needed.
- [Manuscript Teleprompter](docs/architecture/manuscript-teleprompter.md) (`sidecars/manuscript-teleprompter/`, the
  Teleprompter page) — first cut: listens to a microphone with a local Whisper model and highlights the word you are
  reading in a chosen chapter.

The tools share one native UI, shown below on the Home page, plus a manuscript reader and a Settings page that also lists,
verifies and removes the voices and models the app has downloaded (Settings > Local assets). See
[Using the app](docs/guides/using-the-app/README.md) for a full screenshot walkthrough. The UI's component library is a
Storybook atlas (`pnpm --dir apps/ui run storybook`, checked in CI by the `ui-atlas` job); its generated reference is in
[`docs/ui/atlas/`](docs/ui/atlas/index.md) and the design rules in the [design system reference](docs/design/design-system.md).

![Home, manuscript found](docs/images/ui/home-default.webp)

## Layout

```
narration-utils/
  apps/
    desktop/                   Go/Wails desktop host: app.go, bindings*.go, internal/ (domain services, the asset manager),
                               cmd/ (seed-assets, manuscript-import), build/ (icons, the Windows setup program definition)
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

## Install on Windows

The supported way to get the app is a GitHub release. From the [releases page](https://github.com/countrymanprime/narration-utils/releases):

1. Download `narration-utils-windows-x64-setup.exe` (and, to check it, `narration-utils-windows-x64-setup.exe.sha256`).
2. Run it. It installs for your user account only, so it asks for no administrator rights, puts the program in
   `%LOCALAPPDATA%\Programs\Narration Utils`, adds a Start Menu entry and, if you leave it ticked, a desktop shortcut, and
   installs the Microsoft WebView2 runtime only if your computer does not have it yet.
3. **The release is unsigned**, so Windows SmartScreen may say it "prevented an unrecognized app from starting". Choose
   **More info**, then **Run anyway**. The warning is about the missing signature, not about anything found in the file. To
   check the file yourself before you run it:
   - the checksum, which only detects a damaged download: `(Get-FileHash .\narration-utils-windows-x64-setup.exe).Hash` in
     PowerShell must equal the hash in the `.sha256` file;
   - where it was built, with the [GitHub CLI](https://cli.github.com):
     `gh attestation verify narration-utils-windows-x64-setup.exe --repo countrymanprime/narration-utils`. Success names the
     workflow, commit and run that built it (see [CI and releases](docs/operations/ci-and-releases.md#build-provenance)).
4. Start **Narration Utils** from the Start Menu. Nothing is downloaded until a feature that needs a model asks you first.

The app updates itself from these releases after you click (Settings > About & updates); it never installs an update on its
own. That works because the install folder is yours to write to. `narration-utils-windows-x64.zip` on the release is the update
package the app fetches, not something to run by hand.

**Uninstall** from Settings > Apps > Installed apps. That removes the program and its shortcuts and **leaves your settings**
(`%APPDATA%\narration-utils`), **the voices and models you downloaded** (`%LOCALAPPDATA%\narration-utils`, also where the
update staging lives) **and everything in your project folders** alone; the uninstall page says so. Delete those folders by hand
if you want them gone. macOS and Linux builds are previews without an installer.

## Developer bootstrap

The UI is a local React + Tailwind workspace, shown in its own native window
(`apps/desktop/`, a Go/Wails app) with generated native bindings. Python is
used only for the three sidecar tools the shell starts on demand. From the
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
release binary. It does not build the Windows setup program (CI does, see [CI and
releases](docs/operations/ci-and-releases.md#the-windows-setup-program)) and
does not download any spaCy model, Whisper model or Piper voice: they are
catalog-managed and the app asks before it downloads each one, the first time a
feature needs it. Without a spaCy model, Story Bible offers its supported
rules-only extraction fallback.

This is the current **developer-checkout** workflow, not the intended release
installation path. Compiled GitHub releases package their own sidecars and
installer resources, and never call this command.

A compiled release is one program, `narration-utils` (`narration-utils.exe` on Windows), that knows its own version
(Settings > About & updates). Once a day at most it asks GitHub whether a newer release of this repository exists (switch
it off there), and on Windows, after your confirmed click, it downloads that release, checks it and replaces itself; it
never downloads or installs anything on its own. See [in-app update](docs/architecture/in-app-update.md).

A built program can check itself without opening a window: `narration-utils --smoke` unpacks its bundled resources, starts
each frozen sidecar, checks the Story Bible sidecar's dictionary and speech data and the approved asset catalogs, and exits
non-zero on any failure. CI runs it on the Windows build before packaging; see
[CI and releases](docs/operations/ci-and-releases.md#the-packaged-app-smoke-test).

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

The tools keep their own DAW-agnostic Python backends. What they share:

- **`<project folder>\narration-utils\manuscript\manuscript.json`** — the one intentional,
  project-owned data contract between the tools. DOCX and Markdown files are imported once;
  their preserved source copies are provenance only and are never reparsed. Existing v1
  PDF-derived canonical data remains readable, but new PDF import is fail-closed pending corpus
  parity.
- **`integrations/reaper/`** — `reaper_common_core.lua` (ExtState access, file/path helpers) and
  `reaper_common_process.lua` (hidden-subprocess launching, the pipe-delimited protocol used by
  each tool's Python backend). The launcher loads these via `dofile`, resolved relative to
  its own script path; the bridge's file protocol is in [the REAPER bridge](docs/architecture/reaper-bridge.md).
- **`libs/python/narration_common/`** — cross-tool contracts including canonical manuscript,
  settings, bridge, logging, and `progress.py` (the `stage|pct|message` progress-file writer,
  retry-hardened against Windows sharing violations), and `logging_utils.py` (stderr[+file]
  logging). Each backend adds this to `sys.path` relative to its own file.

See [`docs/architecture/codebase-map.md`](docs/architecture/codebase-map.md) for runtime
ownership and the staged module boundaries.

## Dependencies

All first-party Python tools (the three sidecars) share one
gitignored virtual environment at the repo root (`.venv/`), built from the
committed `uv.lock` by `pnpm run bootstrap`.

## License

Narration Utils is free software, licensed under the
[GNU Affero General Public License v3.0 or later](LICENSE) (AGPL-3.0-or-later). It is built to
help narrators for free and to stay that way: anyone who distributes it, or runs a modified
copy as a network service, must offer the corresponding source under the same terms. See
[ADR 0039](docs/adr/0039-the-project-is-licensed-agpl-3-or-later.md). Releases up to and
including v0.2.7-rc were published under the MIT license and remain available under it.
