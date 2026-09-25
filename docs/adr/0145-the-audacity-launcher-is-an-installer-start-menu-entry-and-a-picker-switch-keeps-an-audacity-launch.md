# 0145. The Audacity launcher is an installer Start Menu entry, and a picker switch keeps an Audacity launch

- **Status:** Proposed
- **Date:** 2026-09-23
- **Related:** Amends [ADR-0144](0144-a-launch-names-its-daw-with-daw-and-an-audacity-launch-opens-no-reaper-bridge.md): replaces its consequence that expected a macro launcher to pass `--daw Audacity` and a project folder.

## Context and problem

REAPER narrators reach the app from REAPER's Action list: `NarrationUtils_Launcher.lua` starts it with `--daw REAPER` and the open project's folder and file. The owner first answered the [Audacity integration PRD](../prds/audacity-integration.prd.md)'s Question 3 with "a saved Audacity macro that launches the app", and Question 7 with "the release ships the macro file and `verify-installable.mjs` checks it".

The [launcher feasibility note](../research/audacity-launcher-feasibility.md) found that nothing Audacity loads can start a program, from Audacity's manual and its source. No macro or scripting command does it, Audacity compiles Nyquist's `system` as a stub, and a native module has to be rebuilt for every Audacity minor release. The one exec path is a side channel through the "(external program)" exporter. It overwrites a preference, blocks Audacity while the program runs and cannot pass the project, so it is not a launcher. Audacity 4.0 also has no macros and no scripting pipe. The owner revised both answers on 2026-09-23.

A launcher outside Audacity cannot know which Audacity project is open, so it starts the app with no folder and the narrator picks one. Until now `ProjectSwitch`, the one place the picker attaches a project, set `daw` to `Standalone` on every switch. For a REAPER launch that is right: the picked folder is not the project REAPER has open. For this launcher it would throw away the only thing the shortcut says.

## Decision drivers

- Nothing Audacity loads can start a program, and Audacity 4.0 has no macros and no scripting pipe (the launcher feasibility note).
- A launcher outside Audacity cannot know which Audacity project is open, so the narrator picks one.
- A picker switch that set `daw` to `Standalone` would throw away the only thing the shortcut says.

## Considered options

1. An installer Start Menu entry that starts the app with `--daw Audacity`
2. A saved Audacity macro that launches the app
3. Nyquist's `system`
4. A native Audacity module
5. The "(external program)" exporter

## Decision outcome

**Chosen option: an installer Start Menu entry that starts the app with `--daw Audacity`**, because nothing Audacity loads can start a program, so the launcher has to live outside Audacity.

- **The Audacity launcher is a Start Menu entry the installer makes.** `apps/desktop/build/windows/installer/project.nsi` always creates `$SMPROGRAMS\${INFO_PRODUCTNAME} for Audacity.lnk` in the required section, beside the app's own entry. It starts `$INSTDIR\narration-utils.exe` with exactly `--daw Audacity`: no project path and no other argument. The uninstaller deletes it with the other shortcuts. The desktop-shortcut choice is unchanged, and there is no desktop copy of the Audacity entry.
- **No Audacity-side artifact ships.** `scripts/release/verify-installable.mjs` and the release assets are unchanged. `scripts/release/installer.test.mjs` pins the entry, its exact target and arguments, and its removal.
- **A picker switch keeps an Audacity launch.** `ProjectSwitch` (and `ProjectCreateIn`, which ends in it) keeps the launch's own label when `dawadapter.Classify` says Audacity (`pickerSwitchDAW` in `apps/desktop/bindings.go`). Every other launch still becomes `Standalone`, a REAPER one included. The picked project therefore opens with the Audacity review adapter, and never with REAPER's bridge.

### Consequences

- **Neutral:** A narrator on Audacity pins "Narration Utils for Audacity" next to Audacity's own shortcut. They pick the project once per session, which a REAPER narrator does not have to do. The picker is the fallback the app already has for a launch with no folder ([ADR 0030](0030-the-app-starts-without-a-project-and-picks-one-from-recents.md)).
- **Good:** The shortcut works whatever version of Audacity is installed, or none. The Audacity integration itself targets Audacity 3.x, because 4.0 has no scripting pipe.
- **Good:** The shortcut's arguments are a constant in the installer, so it adds nothing a same-user process could not already pass ([threat model](../architecture/threat-model.md) rows 6f and 8b).
- **Neutral:** If the app is already running, starting the shortcut brings the window forward and does not change its DAW mode. `onSecondInstance` acts only on `--project-folder`, and switching an open session's DAW could displace a running job.
- **Neutral:** This replaces the consequence in [ADR 0144](0144-a-launch-names-its-daw-with-daw-and-an-audacity-launch-opens-no-reaper-bridge.md) that expected a macro launcher to pass `--daw Audacity` and a project folder. ADR 0082's installer decisions otherwise stand: the installer is still per user, unsigned and makes no network request.
- **Neutral:** Audacity stays out of the DAW catalog until an adapter works ([ADR 0144](0144-a-launch-names-its-daw-with-daw-and-an-audacity-launch-opens-no-reaper-bridge.md)).

### Confirmation

`scripts/release/installer.test.mjs` pins the entry, its exact target and arguments, and its removal.

## Pros and cons of the options

### A saved Audacity macro that launches the app

- Bad, because no macro or scripting command can start a program, and Audacity 4.0 has no macros.

### Nyquist's `system`

- Bad, because Audacity compiles it as a stub.

### A native Audacity module

- Bad, because it has to be rebuilt for every Audacity minor release.

### The "(external program)" exporter

- Bad, because it overwrites a preference, blocks Audacity while the program runs and cannot pass the project.
