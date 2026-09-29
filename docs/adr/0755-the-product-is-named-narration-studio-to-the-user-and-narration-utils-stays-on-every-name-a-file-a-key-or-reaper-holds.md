# 0755. The product is named Narration Studio to the user, and `narration-utils` stays on every name a file, a key or REAPER holds

**Status:** Accepted (owner ruling D101, 2026-09-29; stream N-F3 on [#509](https://github.com/countrymanprime/narration-utils/issues/509))
**Date:** 2026-09-29

## Context

The app was called "Narration Utils", then "Narration Console" on its header, and [ADR 0725](0725-the-rail-draws-a-count-badge-only-from-a-count-the-host-reports-and-the-product-is-named-studio.md) and PR #865 moved the wordmark, the HTML title and the loading heading to Studio. The owner ruled (D101) that the user-facing name is **Narration Studio** everywhere: window title, About, Update dialogs, Settings. The executable and file names follow [ADR 0073](0073-the-executable-is-named-narration-utils-and-carries-its-version.md) unless an ADR says otherwise.

## Decision

**Renamed to "Narration Studio"** (text a narrator reads):

- The window title and the Wails application name, the About panel, Settings copy, every Update panel, dialog, download and install message (`internal/update`, `update_job.go`, `update_install.go`, the mock host), the busy and error messages the host returns, the model-download prompts and the startup screen.
- `apps/desktop/wails.json` `productName`, `companyName` and `copyright`. They feed the Windows version resource, the installer's welcome, uninstall and Start Menu texts and the install folder for a new install (`%LOCALAPPDATA%\Programs\Narration Studio`). The setup program still finds an existing install through the fixed `HKCU` uninstall key `NarrationUtils`, so an upgrade goes where the old version was, and it deletes the old "Narration Utils" Start Menu entries and desktop shortcut it finds.
- The name in the delivery and production reports' `app.name`, the release notes text, the GitHub issue template, `README.md`, `SECURITY.md`, `CONTRIBUTING.md` and the guides and architecture pages a user reads.

**Stays `narration-utils` / "Narration Utils"** (a name something else holds):

- The executable `narration-utils.exe`, the release asset names, the module paths and packages, the `narration-utils` config and data folders, the settings file names, the `HKCU` uninstall key name and the `narration-utils-<n>` notification IDs (not shown to the user). These are ADR 0073 and the update mechanism's file names; a changed asset name would stop every installed copy from finding its update.
- REAPER's side: the script `NarrationUtils_Launcher.lua` and its action, so a message that says "the Narration Utils action" or "the Narration Utils script in REAPER" names what the narrator sees in REAPER's Actions list; the Lua message boxes and the undo labels `Narration Utils: …` (pinned by the harness and its mutation checks, and their wording needs a REAPER pass).
- The Audacity label track is named "Narration Utils" (`LabelTrackName`): it is looked up by name in projects the narrator already has, so renaming it would add a second track to each.
- Accepted ADRs and `docs/research/` are history and are not edited.

An in-app update replaces only the program, so a narrator who never runs the setup program keeps the old Start Menu shortcut names until they do.

## Consequences

- A fresh install, the window, About, Settings, every Update message and the exported reports say Narration Studio. The executable and folders on disk still say `narration-utils`.
- The REAPER Lua strings and undo labels, and the Audacity label track, are left to a later change with a REAPER and Audacity pass (owner checks wait for QA, D103); the question is on [#510](https://github.com/countrymanprime/narration-utils/issues/510).
- `scripts/release` tests that name the raw Wails installer file use the new product name, since Wails derives it from `productName`; the release asset name is unchanged.
