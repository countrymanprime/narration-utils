# Audacity launcher feasibility (audacity-integration Phase 10)

**Status: done, 2026-09-23. Desk research only: Audacity's manual and its source at the release tags named below. Nothing was run in Audacity.** This note answers the question Phase 10 of the [Audacity integration PRD](../prds/audacity-integration.prd.md) has to settle before anything is built: can an Audacity-side artifact (a macro, a Nyquist plug-in, anything else Audacity loads) launch the app's executable with arguments on Windows, the way [`NarrationUtils_Launcher.lua`](../../integrations/reaper/NarrationUtils_Launcher.lua) launches it from REAPER with `--daw REAPER` and the project folder?

## What it settles

| Question | Answer |
| --- | --- |
| Can an Audacity macro launch a program? | **No, not with any command built for that.** No macro or scripting command starts an external program. The only way found is a side channel through the "(external program)" exporter, described below. It overwrites one of the narrator's Audacity preferences, renders audio into the process it starts, blocks Audacity until that process exits, and cannot pass the project folder. It is not a launcher. |
| Can a Nyquist plug-in launch a program? | **No.** Audacity compiles Nyquist's `system` function as a stub that refuses to run the command. |
| Can anything else Audacity loads launch a program? | Only a native C++ module (the mechanism `mod-script-pipe` uses). Audacity refuses a module built for a different major.minor version, so it would have to be rebuilt for every Audacity minor release. That is disproportionate for a launcher. |
| Does a macro artifact reach Audacity 4? | **No.** Audacity 4.0.0 (released 2026-09-03) ships without the Macro Manager or the scripting pipe. |

So Phase 10 as written, "a saved Audacity macro that launches the app's executable with `--daw Audacity` and the project folder", cannot be built. The phase is marked `blocked`, and Questions 3 and 7 need the owner again. The owner's recorded answers in the PRD are left as they are.

## Evidence

### Macros and scripting commands

- The [Macros manual page](https://manual.audacityteam.org/man/macros.html) lists what a macro may hold: effects, generators and analyzers in any plug-in format, Select commands, export commands, and the menu commands with parameters. None of these starts a program.
- The [Scripting Reference](https://manual.audacityteam.org/man/scripting_reference.html) lists every command a macro or `mod-script-pipe` can call. None of them runs an external program, opens a URL you choose, or runs a shell command.
- A macro is a static list of commands whose parameters are literal text in the `.txt` macro file. It has no variables, so it cannot pass "the folder of the project that is open now". The REAPER launcher reads that folder from `reaper.EnumProjects` and passes it with `--project-folder`/`--project-file`. Audacity macros have nothing equivalent.

### Nyquist

The `system` function exists in Audacity's copy of Nyquist, but Audacity compiles it as a stub. `xsystem` in `lib-src/libnyquist/nyx.c` at tags `Audacity-3.7.4` and `Audacity-3.7.5` (and `src/effects/nyquist/libnyquist/nyx.c` on `master`) only prints `Will not execute system command: %s` to stderr and returns `t`. A Nyquist plug-in can read and write files, but it cannot start a process.

### The one exec path: the "(external program)" exporter

Audacity's command-line exporter (`modules/import-export/mod-cl/ExportCL.cpp`, `Audacity-3.7.5`) calls `wxExecute(context.cmd, wxEXEC_ASYNC, &process)`. A macro can get there:

1. `SetPreference: Name="/FileFormats/ExternalProgramExportCommand" Value="<command>"`. `SetPreference` is an Audacity command, so `MacroCommandsCatalog` in `src/BatchCommands.cpp` offers it to macros.
2. `Export2: Filename="<anything>.CL"`. `ExportCommand::Apply` (`src/commands/ImportExportCommands.cpp`) takes the upper-cased extension. `ExportPluginRegistry::FindFormat` matches it against each exporter's format ID, and the external-program exporter's ID is `CL`. The exporter then loads its command from that preference and replaces `%f` with the export path.

On paper this starts a program from a macro. In practice it cannot serve as the launcher:

- **It overwrites the narrator's own setting.** The preference is the command Audacity uses for every "(external program)" export. A macro can set it but has no way to put the old value back afterwards.
- **It renders audio into the program's standard input.** The export needs a non-empty selection. Audacity writes a WAV stream to the program's stdin, and `Process` writes until the program exits or the pipe fails.
- **It blocks Audacity until the program exits.** After writing, `Process` waits in a loop while `process.IsActive()`. Starting the app directly would freeze Audacity for as long as the app stays open. To avoid that, the command would have to be a shell trampoline (`cmd /c start "" "<exe>" --daw Audacity`). The export then succeeds only if the rendered audio fits in the pipe buffer before `cmd` exits. Otherwise the write fails and Audacity reports an export error.
- **It cannot pass the project folder.** `%f` is the export file name, not the project, and macros have no variables (above).
- **It puts the install path in the macro.** The executable's absolute path has to be written into the preference value, per user and per install, instead of being resolved at run time the way the REAPER launcher reads `narration-utils-app-path.txt`.
- **It adds a new trust boundary.** The artifact we would ship would be a macro that makes Audacity run a shell command line. That is harder to review and explain than a shortcut.
- **It is unverified.** Nothing above was run in Audacity. It rests on how these commands happen to fit together, not on anything documented.

Building it would make the phase look done while giving a narrator none of what the REAPER launcher gives them. That is the "faking it" the task rules out.

### Native modules

`mod-script-pipe` is a native module: a DLL in Audacity's `modules` folder that the narrator enables in Preferences > Modules. A module can run any code. `Module::Load` (`libraries/lib-module-manager/ModuleManager.cpp`, `Audacity-3.7.5`) requires it to export `GetVersionString`. `IsVersionCompatible` rejects the module unless its major and minor version equal Audacity's ("It will not be loaded."). A launcher module would therefore mean a C++ build against Audacity's headers, rebuilt and shipped for every Audacity minor release, running native code inside Audacity's process. This research did not check whether Audacity 4 loads such modules at all. Not recommended.

### Audacity 4.0

The [Audacity 4.0.0 release notes](https://github.com/audacity/audacity/releases/tag/Audacity-4.0.0) (published 2026-09-03) list, under "Compatibility notes", features "not available in Audacity 4.0". The list includes "Macro Manager and the scripting pipe". Even the side channel above would not work for a narrator on Audacity 4.

**This reaches beyond Phase 10.** Phases 1, 2, 4 and 6 to 8 build on `mod-script-pipe`, which Audacity 4.0 does not have. The PRD assumes Audacity 3.x without saying so. The machine used for this research has Audacity 3.7.8 installed, with `modules\mod-script-pipe.dll` present, so the owner-present spikes S-A1/S-A2 can still run on 3.x. Whether the adapter targets 3.x only, or waits for Audacity 4 to bring the pipe back, is a decision for the owner.

## Realistic alternatives

Each of these gets the narrator into the app's workspace with `--daw Audacity` without Audacity starting anything.

1. **An installer shortcut "Narration Utils for Audacity" (recommended).** `apps/desktop/build/windows/installer/project.nsi` already creates the Start Menu entry and an optional desktop shortcut. NSIS `CreateShortcut` takes command-line parameters, so a second entry can start `narration-utils.exe --daw Audacity`. The narrator pins it next to Audacity's own shortcut. The app then opens its project picker, the same fallback the REAPER launcher uses for an unsaved project. The release check becomes an `installer.test.mjs` assertion, next to the existing shortcut tests. It is cheap, reviewable and it works with Audacity 3 and 4. The narrator still picks the project folder once per session, which the REAPER launcher does not require.
2. **An "Open for Audacity" choice inside the app.** The standalone launch that already ships, plus a way to switch the open project to Audacity mode. There is nothing new to install. It is the PRD's original recommendation (b) for Question 3.
3. **Project discovery through the pipe, later.** Once the Phase 4 pipe client exists, an app started with `--daw Audacity` could ask a running Audacity 3.x which project is open, so the narrator would not need to pick it. Whether the scripting commands expose the open project's path is not established here. That belongs to spike S-A1.
4. **The exporter side channel (not recommended).** Only if the owner accepts every drawback above, and only after an owner-present spike on a copy of the Audacity settings shows it works.
5. **A native module (not recommended).** It has to be rebuilt for every Audacity minor release, it runs native code in Audacity's process, and it is not known to work in Audacity 4.

## What needs the owner

- **Question 3.** Choose one of the alternatives above in place of "a saved macro that launches the app". Option 1 keeps the goal, one click to the workspace in Audacity mode, without an Audacity-side artifact.
- **Question 7.** It follows from Question 3. With option 1 there is no Audacity-side file to ship or to list beside `scripts/release/reaper-files.mjs`, and the release check becomes an installer assertion.
- **Audacity versions.** Whether the Audacity adapter targets Audacity 3.x only, given that 4.0 has no scripting pipe.
