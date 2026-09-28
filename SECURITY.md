# Security policy

## Supported versions

Narration Utils is pre-1.0. Only the latest release (including the latest pre-release candidate) receives fixes. Windows x64 is the only supported platform ([ADR 0412](docs/adr/0412-windows-is-the-only-supported-platform-for-now.md)): a report that applies only to a macOS or Linux build is out of scope, because no such build is released.

## Reporting a vulnerability

Please report it privately through GitHub: **Security → Report a vulnerability** on this repository, or
<https://github.com/countrymanprime/narration-utils/security/advisories/new>. Do not open a public issue for a
vulnerability.

Include what you found, the version, and steps to reproduce. There is one maintainer, so expect an acknowledgement
within about a week and a fix or a plan as soon as practical. Reports are credited unless you ask otherwise.

## What is in scope

Narration Utils runs locally and processes your manuscripts and audio on your machine. Reports about these are
especially welcome:

- Anything that sends manuscript, audio, or project content off the machine without an explicit action.
- Downloads of models, voices, the reader's offline dictionary or binaries (the MP3/M4B/FLAC encoder's FFmpeg build,
  [ADR 0342](docs/adr/0342-the-mp3-encoder-is-a-pinned-gpl-ffmpeg-build-run-as-a-separate-process-and-writes-no-tag-frame.md)) that skip the integrity checks described in
  [first-use dependency provisioning](docs/architecture/first-use-dependency-provisioning.md), a downloaded executable that runs without matching its pinned hash, and a downloaded dataset or the lookup index
  the app builds from it (the dictionary, [ADR 0097](docs/adr/0097-the-manuscript-reader-word-lookup-uses-the-open-english-wordnet-as-a-downloadable-asset.md))
  that can crash the app, exhaust its memory or reach outside its install folder when it is parsed or read.
- The in-app update ([ADR 0072](docs/adr/0072-the-app-updates-itself-from-this-repositorys-releases-and-never-installs-without-a-click.md)): once a day the app asks GitHub for the list of releases of this repository (it sends no identifier beyond the program name and version, and it can be switched off in Settings). Reports about that request revealing more than that, about the app trusting the release list beyond what it validates, or about an update being applied without the narrator's click are in scope.
- Path traversal, command injection, or unsafe file handling when opening projects, manuscripts, or archives, including the
  recorded audio a REAPER project names (the teleprompter reads the last seconds of a chapter's recording to find where to resume,
  [ADR 0111](docs/adr/0111-the-resume-point-comes-from-transcribing-the-recorded-tail-and-placing-it-with-the-tracker.md)), or when a
  sidecar reads the audio and writes the per-item cache files an analysis names (for example the recording-coverage manifest,
  which the host builds from the saved REAPER project; the app's only input to a check is a chapter id and, since the
  model cascade, an options flag that only ever narrows what runs), or the audio
  an analysis manifest names (for example the per-take divergence manifest the take comparison writes, which the app
  builds only from the saved REAPER project, never from what the page sends), or the rendered audio files the narrator
  measures or checks for diagnostics, including an MP3, whose container is always read for its frame headers only, and whose levels are additionally decoded through the same downloaded FFmpeg build the encoder uses (delivery-platform-profiles Phase 8) when it is installed, writing only to a temporary WAV that is never kept (the app reads only files chosen in its own file picker in that session, and never writes to them,
  [ADR 0156](docs/adr/0156-measurement-reads-only-files-picked-this-session-as-one-job-and-fingerprints-the-bytes-it-read.md)),
  and the Delivery report it writes (only into the project's `narration-utils/delivery` folder, never over an earlier report, and without
  any local path, audio or manuscript text unless the narrator chooses to include file locations); a report that leaks a path the narrator
  did not include is in scope. The same holds for the pronunciation query CSV the Story Bible exports for the narrator to send to an
  author ([ADR 0347](docs/adr/0347-the-pronunciation-query-export-is-csv-with-its-ids-last-and-a-formula-guard-and-is-a-download.md)): a
  cell that runs as a formula when the file is opened in a spreadsheet, or a row that carries more than the columns it names, is in scope.
  Reading that file back once the author has answered it (`GuidePronunciationImportQueriesCSV`,
  [ADR 0352](docs/adr/0352-a-re-imported-query-answer-is-matched-by-entry-id-and-alias-index-and-a-blank-note-column-leaves-the-note-alone.md))
  is also in scope: a row matching the wrong entry or alias, a status or note applying beyond the single name its own id and alias number
  name, an import starting anything beyond the existing status-and-note sidecar call, or a blank note column clearing a note it should
  leave alone, is a vulnerability.
- The run log every tool run writes (`logs/run.jsonl`, `logs/runs/*.stderr.jsonl`; [ADR 0251](docs/adr/0251-tool-runs-are-logged-as-json-lines-through-slog-with-a-run-id-and-content-is-never-logged.md)) and the diagnostics bundle Settings can save from it (`SystemCopyDiagnostics`) or the folder it can open (`SystemOpenLogFolder`): manuscript, audio or transcript text reaching either is in scope, as is the export landing anywhere but the folder the narrator picked in that session's file picker.
- The script markup the narrator places in the reader (`narration-utils/prep/markup.json` in the project,
  [ADR 0382](docs/adr/0382-script-markup-is-a-chapter-keyed-sidecar-of-line-offsets-checked-on-read-and-drawn-without-changing-the-text.md)):
  a file that makes the app run, open, fetch or write anything else, that puts markup into the page, or that is drawn without
  being checked against the current text is in scope; one that only changes which prep marks the narrator sees is the
  documented residual risk (threat model row 6p).
- The delivery profiles the app reads back to judge the rendered files (the user-level `delivery-profiles.json` beside
  `credit-templates.json`, and the project's choice in `project.json`,
  [ADR 0180](docs/adr/0180-custom-delivery-profiles-are-copies-of-a-built-in-kept-in-a-user-level-file.md)): a file that makes the app
  run, open, fetch or write anything, or that is used without being validated, is in scope; one that only changes a verdict is the
  documented residual risk (threat model row 6i).
- The stage-timer log the app keeps in a project (`narration-utils/production/sessions.json`) and the deadline, contracted amount
  and milestones it keeps in `project.json`: a file that makes the app run, open, fetch or write anything, or that is read as
  something it is not instead of being kept aside and reported or refused, is in scope; one that only changes the narrator's own
  logged hours, dates or amount is the documented residual risk (threat model rows 6n and 6o).
- The production status report it writes (only into the project's `narration-utils/production/reports` folder, never over an
  earlier report, and without the narrator's contracted amount or effective rate unless they tick the box to include them,
  [ADR 0406](docs/adr/0406-the-status-report-leaves-out-the-contracted-amount-and-effective-rate-unless-the-narrator-opts-in.md)); a
  report that leaks the rate the narrator did not include is in scope.
- Weaknesses in the release pipeline (for example an installer or checksum that does not match the reviewed build, or a release asset without valid build provenance). What the pipeline promises, and what it does not: every release asset has a SHA-256 file (it detects a damaged download, not a tampered one) and a build-provenance attestation you can check with `gh attestation verify` ([Build provenance](docs/operations/ci-and-releases.md#build-provenance)); the releases are **unsigned** by decision, so Windows SmartScreen warns and that warning alone is not a vulnerability; and the owner-only settings that back the pipeline (rulesets, the `production` environment, immutable releases, action pinning) are listed in [Tracking work on GitHub](docs/operations/github-workflow.md#repository-settings-that-only-the-owner-can-change).

- The arguments and session files the app hands its local sidecars and the FFmpeg encoder, for example a value from the interface becoming a
  sidecar option, a file path FFmpeg reads as an option or a URL, an encode that writes over its source or an existing file, or the teleprompter's stop, control and credits-text files in the session folder
  ([ADR 0150](docs/adr/0150-the-teleprompter-reads-credits-as-a-host-rendered-script-file-not-a-chapter.md)).
- The built-in recorder's capture engine (the capture port's Experimental `wasapi` row,
  [ADR 0357](docs/adr/0357-the-built-in-recorders-capture-engine-is-a-wasapi-shared-mode-row-of-the-capture-port-through-portaudio-in-the-sidecar.md)),
  which opens a microphone and writes a new WAV take: a take that overwrites or truncates an existing file, a device opened that
  the narrator did not choose, a file written anywhere but the path the app gave it, or captured audio that leaves the machine is
  in scope. Nothing in the app calls it yet; the Booth's recorder will (native-recording-suite Phase 2).
- The delivery package the app assembles into a folder the narrator chooses (`internal/packager`, render-encode-master PRD Phase 4): a file
  name it builds from a chapter's title using a character a file system cannot hold, or a package that overwrites an existing file or its own
  source, is in scope; every file it writes is a new copy of an already-encoded file, and the source is never changed.
- The file protocol between the app and REAPER (the session folder under REAPER's resource path, the command files the Lua bridge reads, the paths it opens from a command, the commands that move REAPER's selection, cursor, time selection and transport, which the Review page sends only when the narrator presses Go to, Loop or Stop, on a finding or on one read of a pickup or duplicate group, and only while REAPER is answering, the one that adds an approved take marker, which it sends only for an accepted finding after the narrator confirms, the one allow-listed REAPER action launcher, and the retake-lane pick, which changes which lane of a track plays, and the experimental commands that ship switched off until they are verified in a real REAPER, behind the Experimental REAPER actions setting or each one's own per-capability DAW setting, starting with the read-only transport and track state, the one that selects a track, and the commands that arm tracks and start and stop a recording the app started, make a take active, add one of the narrator's own FX chains to a track or one installed plug-in to a passage, and create or move regions; and, once it is built, a render through the project's own FX for the mastering port's DAW row (`render_with_fx`, [ADR 0306](docs/adr/0306-mastering-is-a-provider-port-and-measurement-stays-one-in-process-judge.md), declared and not sent by this version), which must run only after the narrator approves that one render and only into a folder the app made inside the project: a render the narrator did not approve, or a rendered file written outside that folder or over an existing file, is a vulnerability), the arguments a DAW or a shortcut starts the app with (`--daw REAPER` from the REAPER launcher, `--daw Audacity` from the installer's "Narration Utils for Audacity" Start Menu entry, `--project-folder`, `--session-dir`), and the local `/media` route that plays a project's audio.
- The Audacity scripting pipe (`mod-script-pipe`, [ADR 0355](docs/adr/0355-audacity-is-driven-over-its-scripting-pipe-built-from-the-published-spec-and-verified-by-the-owners-pass.md)): a label text, path or other value from the app that changes the command Audacity runs, an export that writes anywhere but a local file with an audio extension, or a reply from the pipe that the app uses as anything but data.
- The desktop shell itself: it runs on the Wails v3 beta, pinned at v3.0.0-beta.25 ([ADR 0200](docs/adr/0200-the-desktop-shell-runs-on-wails-v3-beta-pinned-at-v3-0-0-beta-25.md)). A way for the page, or anything else, to call the app beyond its own bindings, or to reach the app's Wails runtime endpoint from anything but its own window, is in scope.
- Device input the webview reads directly: a MIDI footswitch or controller through the Web MIDI API, or a HID pedal or button device through the WebHID API, feature-detected and read only where a webview exposes them ([the Web MIDI/WebHID spike](docs/research/web-midi-hid-webview-spike.md); [ADR 0361](docs/adr/0361-app-commands-go-through-one-registry-and-keyboard-midi-and-hid-are-input-sources-bound-by-a-remappable-keymap.md)). What either produces is a command already reachable from the keyboard; a malformed, oversized or out-of-range device message crashing the app or reaching further than a normalised press instead of being dropped is in scope.
- A one-click web pronunciation lookup (Forvo, YouGlish, Merriam-Webster, Howjsay; [prep-depth PRD](docs/prds/prep-depth.prd.md) Phase 2, `PronunciationLookupOpen`) opens the narrator's default browser to one of four fixed URL templates with the manuscript's own word path-escaped into it; the app never fetches, scrapes or caches any of the four sites and sends no request of its own. A lookup that reaches a host other than that site's own, or that is usable to run or replace something outside the browser, is in scope.

Problems in a third-party dependency belong upstream, but tell us if we ship a version that is affected. The desktop shell's Wails is a pre-release; a Wails advisory that affects the pinned beta counts.

## What the app does on the network

There is no telemetry, no account and no listening port. The only requests the shipped program makes are the once-a-day release check above (off with one setting), the downloads of models, voices, the offline dictionary, the MP3 encoder and an update that you confirm with a click. Encoding to MP3, M4B or FLAC, and measuring an MP3's levels, all run the downloaded FFmpeg on your computer, on files only: it is given no network protocol. Looking a word up in the manuscript reader reads that dictionary on your computer: it sends nothing. The interface's fonts ship with the program, so opening it contacts no font host ([#238](https://github.com/countrymanprime/narration-utils/issues/238)). The Teleprompter's Moonshine engine (Windows) comes with a library that has a downloader of its own; the shipped program never uses it and runs Moonshine only from a model installed and hash-checked through Settings > Local assets ([ADR 0107](docs/adr/0107-moonshine-ships-inside-the-windows-teleprompter-sidecar-and-runs-only-from-a-verified-catalog-install.md)), so a request from it to Moonshine's servers is a vulnerability. The [threat model](docs/architecture/threat-model.md) lists every boundary, what protects it in the code and what risk is left with its owner; a report about a risk it already lists is still welcome, but it is a known limit, not a new vulnerability.
