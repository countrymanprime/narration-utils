# Audacity 4 scripting: what the published spec says (2026-09-28)

**Status: done, 2026-09-28. Desk research only; nothing was run in Audacity.** Written for stream N-B36 (the [Audacity integration PRD](../prds/audacity-integration.prd.md), phases 4 and 6 to 8) after the owner decided on 2026-09-28 to build the Audacity hookups for Audacity 4 from the published specs, with the owner's S-A1/S-A2 session turned into the verification pass ([ADR 0355](../adr/0355-audacity-is-driven-over-its-scripting-pipe-built-from-the-published-spec-and-verified-by-the-owners-pass.md), [the verification pass](../operations/audacity-verification-pass.md)). It supersedes nothing: the [launcher feasibility note](audacity-launcher-feasibility.md) found the same gap in 4.0.0 from its release notes.

Accessed 2026-09-28. Official sources only: the github.com/audacity/audacity repository (release notes, source, issues) and github.com/audacity/audacity-manual, which is the published source of manual.audacityteam.org.

## How the sources were read (and what could not be read)

- **Blocked:** `manual.audacityteam.org`, `support.audacityteam.org`, `forum.audacityteam.org`, `wiki.audacityteam.org` and `www.audacityteam.org`. The sandbox egress proxy refused every one of them (`EGRESS_BLOCKED` / HTTP 000). Nothing in this note comes from the forum, the wiki or the support site.
- **Manual text:** taken from the manual's source repo, `github.com/audacity/audacity-manual` (master `92794e4`, committed 2026-09-02). The pages are `manual/man/scripting.html` and `manual/man/scripting_reference.html`. Their footer reads "This version created on 2026-09-02". The repo README says the manual at manual.audacityteam.org is generated from this repo.
- **Audacity source:** shallow clones of `audacity/audacity` at three refs:
  - master `36146d8` (2026-09-25, "Remove cutline implementations (#12294)")
  - branch `release-4.0.0` = tag `Audacity-4.0.0` (`4c177d4`, 2026-09-03, "Update the changelog")
  - branch `release-4.0.1` (`9cdb48b`, 2026-09-25, "cherry-picked PR #12296")
- **Release-page HTML:** `curl` of github.com HTML pages was blocked. The release page and the issues were read through WebFetch, which returns a model's summary, so quotes from issues may be slightly paraphrased. Quotes taken from source files are exact.

---

## Q1. Is there a scripting pipe in Audacity 4.x?

### Answer: No

No shipped or in-progress 4.x build contains mod-script-pipe or any other external scripting interface.

**Evidence**

1. **The 4.0.0 release notes say it is missing.** This is the verbatim `CHANGELOG.txt` on branch `release-4.0.0` / tag `Audacity-4.0.0`, which matches the GitHub release body (<https://github.com/audacity/audacity/releases/tag/Audacity-4.0.0>, dated "03 Sep"):

   > ## Compatibility notes
   >
   > The following Audacity 3 features are not available in Audacity 4.0, but we're working on adding them in future releases.
   >
   > - Time Tracks
   > - Note/MIDI tracks
   > - Mixer
   > - Macro Manager and the scripting pipe
   > - VAMP and LADSPA plugin hosting
   > - Play-at-speed
   >
   > Sync-Lock and the old tool modes were replaced by the workflows described above.
   >
   > Additionally, Audacity 4 ships with some missing exporting and rendering features, analyzers, and effects.

   The same text is still in `CHANGELOG.txt` on `release-4.0.1` (line 66: "- Macro Manager and the scripting pipe").

2. **No later 4.x release exists.**
   - Tags matching 4.x (`git ls-remote --tags`): `Audacity-4.0.0-alpha-1`, `-alpha-2`, `-beta-2`, `-beta-4`, `Audacity-4.0.0`. There is **no `Audacity-4.0.1` tag and no 4.1 tag.**
   - Branch `release-4.0.1` exists (version.cmake PATCH "1", last commit 2026-09-25), so 4.0.1 is not released yet.
   - Milestones page (<https://github.com/audacity/audacity/milestones>): "Audacity 4.0.1" is 60/62 done. "Audacity 4.1" is 14/73. "Audacity 4.2" and "Audacity 5.0" are also open.

3. **The code is in the tree but is not built.**
   - The files exist on master, `release-4.0.0` and `release-4.0.1`: `au3/modules/scripting/mod-script-pipe/{CMakeLists.txt,PipeServer.cpp,ScripterCallback.cpp,ScripterCallback.h}`.
   - The legacy command engine is also still there, in `au3/src/commands/*` (CommandBuilder, ScriptCommandRelay, GetInfoCommand and others) and `au3/src/BatchCommands.cpp`.
   - The Audacity 4 build does not compile any of it.
     - `src/CMakeLists.txt` builds only the AU4 modules: appshell, shared, au3wrap, audio, au3cloud, context, project, preferences, usageinfo, projectscene, spectrogram, automation, extensions, trackedit, au3audio, playback, record, effects, importexport, uicomponents, stubs, app.
     - `src/au3wrap/CMakeLists.txt` pulls in only `${AU3_LIBRARIES}` (`au3/libraries`) and the import-export modules. On master that is `add_subdirectory(${AU3_MODULES}/import-export au3-import-export-modules)`. On 4.0.1 it is a `MODULE_SRC` list containing only `${IMPORT_EXPORT_MODULE}/...` files.
   - Nothing outside `au3/modules/` references `scripting` or `mod-script-pipe` in any CMake file, on master or on `release-4.0.1`.
   - `au3/src/` (which holds `commands/`, `BatchCommands.cpp` and `ScriptCommandRelay`) is never added as a subdirectory.
   - `src/automation/` is not scripting. It holds clip-gain envelope automation: `au3clipgaininteraction`, `clipgainmodel`.
   - A grep of AU4 `src/` for `ToSrvPipe|script-pipe|scripting|QLocalServer|WebSocket` finds only a comment in `src/effects/effects_base/internal/effectexecutionscenario.cpp` ("Search effect by id with a conviniece fallback to title for scripting"). There is no pipe server.
   - The only plugin-facing surface in AU4 is the in-app JS/QML extension API in `src/extensions/api/`: `AudioTransformApi`, `NativeApi`, `PreferencesApi`. It has no command dispatcher.

4. **The plan: a new "Script host" in 4.1, not mod-script-pipe.**
   - Issue #11734, "Automation Epic: Script host", opened 2026-08-20 by teetow. Open, priority Urgent, no milestone, project "[AU4] Backlog (Status: Review)". <https://github.com/audacity/audacity/issues/11734>
     > "Audacity 4.1 can execute scripts. Any action a user can trigger from the UI can be called from a script, with parameters."
     > "On language: use the JavaScript engine already in the app, and let other languages in from outside through the inter-process host."
     > (summarised) "Audacity uses its own action system rather than Qt actions, and 'with parameters' is the expensive half of this issue."

     The issue does not promise compatibility with the Audacity 3 pipe protocol, pipe names or command names. The WebFetch summary showed no such statement and no comments.
   - Issue #9407, "Macro manager". Open, label Task, **milestone "Audacity 4.1"**, opened 2025-09-18. <https://github.com/audacity/audacity/issues/9407>
     > "The macro manager allows the User to create and save a series of actions that can be used to automate various processes."
   - Issue #11783, "Automation Epic: Macro Manager". Opened 2026-08-25, closed as a duplicate of #9407, milestone Audacity 4.1. <https://github.com/audacity/audacity/issues/11783>
     - Its acceptance criteria include macros in "human-readable formats (YAML or JSON)". This is summarised, not verbatim.
     - It also notes (quoted): "Some Audacity 3 step semantics already have an Action behind them. Effects take parameters under their Audacity 3 names, and `set-selection` takes a start and an end."
   - Other automation epics: #11731 "Automation Epic: Command Palette" (open, 2026-08-20) and #11858 "Automation Epic: Extensions Manager" (open, 2026-08-31).
   - Issue #10533, "Will extensions be able to trigger actions in v4?", closed 2026-03 (completed). <https://github.com/audacity/audacity/issues/10533> The reporter wrote:
     > "With mod-script-pipe gone in v4, this is the only path for building automation tools".

     No maintainer reply was visible.
   - A PR search (<https://github.com/audacity/audacity/pulls?q=is%3Apr+script>) found no PR adding a script host, pipe or IPC server as of 2026-09-27.
   - Open mod-script-pipe issues are all Audacity 3 bugs (label "AU3-bug"): #9406, #8671, #11471, #3324, #3326, #8087.
   - **No dates are committed.** 4.1 has no due date on the milestones page.

**Bottom line for Q1.** A client for the Audacity 3 protocol (`\\.\pipe\ToSrvPipe` / `FromSrvPipe`) cannot connect to Audacity 4.0.0 on Windows, because nothing creates those pipes. The same holds for current master and the 4.0.1 branch. The planned 4.1 "script host" is a new, unspecified design (JS in the app plus an "inter-process host"). No published spec exists for it.

---

## Q2. The Audacity 3.x protocol

The authoritative copies of `pipe_test.py` and `pipeclient.py` are now at `au3/scripts/piped-work/` on master (formerly `scripts/piped-work/`).

### Enabling the module

Source: <https://github.com/audacity/audacity-manual/blob/master/manual/man/scripting.html> (= manual.audacityteam.org/man/scripting.html)

> "The plugin module "mod-script-pipe" is not enabled by default in Audacity, so must be enabled in Audacity preferences. After enabling it for the first time, you will need to restart Audacity."
> "Go into Edit > Preferences > Modules / Choose mod-script-pipe (which should show New) and change that to Enabled. / Restart Audacity / Check that it now does show Enabled."
> "Commands are sent to Audacity over a 'named pipe'."

### Pipes

`au3/scripts/piped-work/pipe_test.py`, verbatim:

```python
if sys.platform == 'win32':
    print("pipe-test.py, running on windows")
    TONAME = '\\\\.\\pipe\\ToSrvPipe'
    FROMNAME = '\\\\.\\pipe\\FromSrvPipe'
    EOL = '\r\n\0'
else:
    print("pipe-test.py, running on linux or mac")
    TONAME = '/tmp/audacity_script_pipe.to.' + str(os.getuid())
    FROMNAME = '/tmp/audacity_script_pipe.from.' + str(os.getuid())
    EOL = '\n'
```

- **Windows EOL is `"\r\n\0"`.** `"\n"` is used only on Linux and macOS.
- `pipeclient.py` uses the same values: `WRITE_NAME = '\\\\.\\pipe\\ToSrvPipe'`, `READ_NAME = '\\\\.\\pipe\\FromSrvPipe'`, `EOL = '\r\n\0'`. It opens files with `newline=''` and has an optional `encoding`.

`pipe_test.py` sends and reads like this, verbatim:

```python
TOFILE.write(command + EOL)
TOFILE.flush()
...
def get_response():
    result = ''
    line = ''
    while True:
        result += line
        line = FROMFILE.readline()
        if line == '\n' and len(result) > 0:
            break
    return result
```

`pipeclient.py` ends a reply the same way: `while pipe_ok and line != '\n'`. Its default timeout is 10 s: `-t, --timeout ... (default: 10)`.

### Windows server implementation

`au3/modules/scripting/mod-script-pipe/PipeServer.cpp` (the Windows branch):

- Both pipes are created with `CreateNamedPipe(name, PIPE_ACCESS_DUPLEX, PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS, PIPE_UNLIMITED_INSTANCES, nBuff, nBuff, 50, NULL)`, with `const int nBuff = 1024;`.
- Connection order is `ConnectNamedPipe(hPipeToSrv)` first, then `ConnectNamedPipe(hPipeFromSrv)`, with the comment "open from (outgoing) pipe second. This could block if there is no reader." A client should open ToSrvPipe for write and then FromSrvPipe for read.
- Each command is one `ReadFile(hPipeToSrv, chRequest, nBuff, ...)`, followed by `chRequest[cbBytesRead] = '\0';`. The consequences:
  - The whole command must arrive in one write, which is one message.
  - Keep a command under 1024 bytes, including the EOL. A read of exactly 1024 bytes would write one byte past the buffer.
  - A longer message makes `ReadFile` fail with more-data, and the server drops the connection because `!bSuccess` means break. This is inferred from the code and was not tested.
- The reply goes out as several `WriteFile` messages. Each is at most 1023 bytes of a line, and the trailing NUL is not sent.
- When the client disconnects (a read fails or returns 0 bytes), the server flushes, disconnects and closes both pipes, and `PipeServer()` returns. `ScriptCommandRelay::StartScriptServer` calls it again in `while (true)` on a detached thread, so the pipes are created again for the next client.

### Command intake

`ScripterCallback.cpp`, verbatim:

```cpp
wxString Str1(pIn, wxConvUTF8);
Str1.Replace(wxT("\r"), wxT(""));
Str1.Replace(wxT("\n"), wxT(""));
```

- Commands are UTF-8.
- **Every CR and LF in the incoming message is deleted**, including any inside a quoted value. A raw newline in a label text is simply removed. Two commands sent in one write would merge into one garbled line.
- The trailing `\0` of the Windows EOL ends the C string.

### Command syntax

Manual (scripting.html):

> "Each command name ends with a colon, and may be followed by parameters."
> "do_command("SetLabel: Text='Foo'")"

Scripting reference:

> "Boolean values must be given as 1 (true) or 0 (false)."
> "The Scripting Ids, parameters and defaults are all likely to change between versions."

`au3/src/commands/CommandBuilder.cpp`:

- The line is split at the first `:`.
- `"Syntax error!\nCommand is missing ':'"` is returned if there is no colon and there is a space.
- In the active (non-`OLD_BATCH_SYSTEM`) path, the text is handed to the `BatchCommand` wrapper as `CommandName` plus `ParamString`.

### Quoting and escaping

The `ParamString` is parsed by `CommandParameters::SetParameters` in `au3/libraries/au3-components/EffectAutomationParameters.h`, verbatim:

```cpp
auto parsed = wxCmdLineParser::ConvertStringToArgs(parms);
...
wxString key = parsed[i].BeforeFirst(wxT('=')).Trim(false).Trim(true);
wxString val = parsed[i].AfterFirst(wxT('=')).Trim(false).Trim(true);
if (!wxFileConfig::Write(key, Unescape(val))) {
...
wxString Unescape(wxString val)
{
    val.Replace(wxT("\\n"), wxT("\n"), true);
    val.Replace(wxT("\\\""), wxT("\""), true);
    val.Replace(wxT("\\\\"), wxT("\\"), true);
```

- Values are split into args by wxWidgets' command-line splitter (`ConvertStringToArgs`, default mode), which handles double quotes. A single-quoted form (`Text='Foo'`) appears in the manual example.
- After splitting, `Unescape` turns the two characters `\n` into a newline, `\"` into `"`, and `\\` into `\`. So **backslash escapes are supported** for newline, double quote and backslash. This happens after the splitter has already processed the quotes and backslashes, so the exact interplay needs testing.
- The old `ShuttleCli` / `OLD_BATCH_SYSTEM` path carries this comment: "Handling of quoted strings is quite limited. You start and end with a " or a '. There is no escaping in the string." That path is compiled out with `#ifdef OLD_BATCH_SYSTEM`.
- **Not verified:** how `wxCmdLineParser::ConvertStringToArgs` treats backslashes and single quotes. That is wxWidgets code, which is not an Audacity source.

### Reply framing

`au3/src/commands/Command.cpp`, `ApplyAndSendResponse::Apply`, verbatim:

```cpp
wxString response = wxT("\n");
response += GetSymbol().Internal();
// These three strings are deliberately not localised.
// They are used in script responses and always happen in English.
response += wxT(" finished: ");
if (result) {
    response += wxT("OK");
} else {
    response += wxT("Failed!");
}
mCtx->Status(response, true);
```

- The symbol is `BatchCommand`, because every command goes through `CommandDirectory::LookUp(wxT("BatchCommand"))`.
- `CommandBuilder::GetResponse()` appends a further `"\n"`. `DoSrv` then appends `'\n'` and splits the result into lines.
- So a reply is: the command output lines (for example the GetInfo JSON), then `BatchCommand finished: OK` (or `Failed!`), then an empty line. Clients stop at the first line that is exactly `"\n"`.
- A parse failure returns the error text instead, for example "Syntax error!..." or "Your batch command of %s was not recognized.".
- The manual does not describe this framing. It only says: "It's not straightforward to get 'output' responses from commands like GetInfo. You will need to parse the results in Python."
- The server blocks until the command finishes. `ResponseTarget::GetResponse()` does `mSemaphore.Wait()`, which is released by `Flush()` from `Status(..., true)`. There is no server-side timeout.
- A pitfall for the "blank line ends the reply" rule: GetInfo JSON puts `"\n" + padding` before strings of 15 characters or more. That produces indented lines, not empty ones. A value that itself contains a newline, however, could emit an empty line, so JSON output must be parsed with care.

---

## Q3. Commands

### Commands

All parameter lists below are verbatim from the scripting reference (<https://github.com/audacity/audacity-manual/blob/master/manual/man/scripting_reference.html>, = manual.audacityteam.org/man/scripting_reference.html).

### Commands with parameters

| Command | Parameters (verbatim) | Description (verbatim) |
|---|---|---|
| `SetLabel:` | int Label, (default:0); string Text, (default:unchanged); double Start, (default:unchanged); double End, (default:unchanged); bool Selected, (default:unchanged) | "Modifies an existing label. You must give it the label number." |
| `Select:` | double Start; double End; enum RelativeTo (ProjectStart, Project, ProjectEnd, SelectionStart, Selection, SelectionEnd); double High; double Low; double Track; double TrackCount; enum Mode (Set, Add, Remove). All default to unchanged. | "Selects audio. Start and End are time. …" |
| `SelectTime:` | double Start, (default:unchanged); double End, (default:unchanged); enum RelativeTo, (default:unchanged) ProjectStart / Project / ProjectEnd / SelectionStart / Selection / SelectionEnd | "Modifies the temporal selection. Start and End are time. … Note carefully that the Start time should be a negative number relative to the chosen start position." |
| `SelectTracks:` | double Track; double TrackCount; enum Mode (Set/Add/Remove) | "Modifies which tracks are selected." |
| `GetInfo:` | enum Type, (default:Commands) Commands / Menus / Preferences / Tracks / Clips / Envelopes / Labels / Boxes; enum Format, (default:JSON) JSON / LISP / Brief | "Gets information in a list in one of three formats." |
| `Message:` | string Text, (default:Some message) | "Used in testing. Sends the Text string back to you." |
| `Help:` | string Command, (default:Help); enum Format, (default:JSON) | "This is an extract from GetInfo Commands, with just one command." |
| `Import2:` | string Filename, (default:) | "Imports from a file. The automation command uses a text box to get the file name rather than a normal file-open dialog." Scriptables II page: "You have to give the full file name (including path and file name extension)." |
| `Export2:` | string Filename, (default:exported.wav); int NumChannels, (default:1) | "Exports selected audio to a named file. … the most recently used options for that format will be used. In the current implementation, NumChannels should be 1 (mono) or 2 (stereo)." |
| `OpenProject2:` | string Filename, (default:test.aup3); bool AddToHistory, (default:false) | "Opens a project." |
| `SaveProject2:` | string Filename, (default:name.aup3); bool AddToHistory, (default:False); bool Compress, (default:False) | "Saves a project." |
| `GetPreference:` | string Name, (default:) | "Gets a single preference setting." |
| `SetPreference:` | string Name; string Value; bool Reload, (default:False) | "Sets a single preference setting. …" |
| `SetProject:` | string Name; double Rate; int X; int Y; int Width; int Height | "Sets the project window to a particular location and size. …" |

### SetLabel

**How `SetLabel` counts labels** (`au3/src/commands/SetLabelCommand.cpp`):

- `Label` is a 0-based index counted across *all* label tracks in track order.
- An invalid index gives the error `"LabelIndex was invalid."` and `Failed!`.
- Setting `Selected` affects one label only: "Only one label can be selected."

**`Message:`** sends back its Text via `context.Status(mMessage)` (MessageCommand.cpp). That makes it useful as a ping or sync marker.

### Menu commands with no parameters (`none`)

- `AddLabel:` "Creates a new, empty label at the cursor or at the selection region."
- `AddLabelPlaying:`
- `ImportLabels:` "Launches a file selection window where you can choose to import a single text file…"
- `ExportLabels:`
- `Play:` "Play (or stop) audio"
- `Stop:` "Stop audio"
- `PlayStop:`
- `PlayStopSelect:`
- `Pause:`
- `CursProjectStart:`, `CursSelStart:` and the other `Curs*` and `Cursor*` commands
- `SelectAll:`, `SelectNone:`
- `SaveProject:`, `SaveCopy:`
- `NewLabelTrack:`
- `Close:`, `New:`

### Commands that do not exist, or have no parameters

- **`SetCursor:`** No such command. The cursor is moved with `Select: Start=t End=t` / `SelectTime:`, or with the `Curs*` menu commands.
- **Importing labels by path.** `ImportLabels:` takes no parameters and opens a file dialog.
  - `Import2` goes through `ProjectFileManager::Import` and then `Importer::Import`.
  - In au3 I found no importer plugin for label `.txt` files. The import modules are audio formats plus LOF (`mod-lof`) and AUP.
  - So a label text file cannot be imported by path through scripting. This is inferred from source and was not tested in a running Audacity 3.
- **Exporting labels by path.** `ExportLabels:` takes no parameters and opens a dialog. There is no path-taking label export command.
- **Looping.**
  - The scripting reference lists only `PlayAtSpeedLooped:` ("Loop Play-at-Speed").
  - The 3.x source (`au3/src/menus/TransportMenus.cpp`, menu "PlayRegion" / "&Looping") registers parameterless menu commands:
    - `TogglePlayRegion` (shortcut L)
    - `ClearPlayRegion` ("&Clear Loop")
    - `SetPlayRegionToSelection` ("&Set Loop to Selection")
    - `SetPlayRegionIn`
    - `SetPlayRegionOut`
  - These are reachable by scripting as menu commands. Issue #3326, "TogglePlayRegion does not work correctly via scripting", is open.
  - A loop can therefore be set with `Select: Start= End=` then `SetPlayRegionToSelection:`. Untested.

### GetInfo JSON shapes

These come from `au3/src/commands/GetInfoCommand.cpp`. The manual gives no JSON example; the Scriptables II page only says "Gets information in a list in one of three formats."

**`Type=Tracks`** returns an array of objects. Keys in emission order:

- all tracks: `name`, `focused`, `selected`
- wave tracks add: `kind:"wave"`, `start`, `end`, `pan`, `volume`, `channels`, `solo`, `mute`, `VZoomMin`, `VZoomMax`
- label tracks add `kind:"label"`; time tracks add `kind:"time"`; note tracks add `kind:"note"`

In 3.x source the gain key is `"volume"`. Older 3.x releases may have used `"gain"`; I did not verify this.

**`Type=Clips`** returns an array of `{ "track": <index over all tracks>, "start", "end", "color", "name" }`.

**`Type=Labels`** (default build) returns nested arrays, not objects:

```text
[ [ <trackIndex>, [ [start, end, "text"], [start, end, "text"], ... ] ], ... ]
```

The track index counts all tracks, not only label tracks. An object form `{track,start,end,text}` exists only under `#ifdef VERBOSE_LABELS_FORMATTING`.

**GetInfo JSON caveats** (`au3/libraries/au3-menus/CommandTargets.cpp`):

- **Only `"` is escaped:**

  ```cpp
  wxString CommandMessageTarget::Escaped(const wxString& str)
  {
      wxString Temp = str;
      Temp.Replace("\"", "\\\"");
      return Temp;
  }
  ```

  Backslashes and control characters in label text or names are emitted raw, which can produce invalid JSON.
- **Booleans are quoted strings:** `"%s\"%s\":\"%s\"", ... value ? "true" : "false"` gives `"selected":"true"`.
- **Numbers use `std::stringstream` with the C locale and default precision** (6 significant digits). Issue #4220, "Scripting: Don't limit precision of values from GetInfo", is open.
- Strings of 15 or more characters are preceded by a newline plus indentation.

---

## Q4. Concurrency, timeouts, Audacity not running

### Concurrency

- **One client at a time.**
  - The server creates a single handle per pipe and serves one connection until it disconnects, then recreates the pipes (see Q2).
  - Manual, Known Issues: "Scripting only works with one project at a time." and "You're advised not to use mod-script-pipe on a system with multiple simultaneous users."
  - Also from Known Issues: "For some menu commands, the project window must have focus for the command to succeed." and "There's no consistent way to abort or interrupt commands."
- **Audacity not running, or the module disabled.** The pipe does not exist. `pipe_test.py` checks `os.path.exists(TONAME)` and prints " ..does not exist.  Ensure Audacity is running with mod-script-pipe." On Windows an open would fail with file-not-found. This is inferred and not stated in the manual.
- **No project window open.**
  - `ScriptCommandRelay.cpp` has `if (auto pProject = ::GetActiveProject().lock()) {...} else { *pOut = wxString{} }`. The reply is then just `"\n"` with no "BatchCommand finished" line.
  - Issue #11471 (open, 2026-07-18, reported against 3.7.8), <https://github.com/audacity/audacity/issues/11471>: the pipe "silently consumes commands when no project window is open", returning `b'\n'` "with no terminator".
- **Timeouts.**
  - The server has none: it blocks until the command completes, including modal dialogs.
  - The `CreateNamedPipe` default timeout is 50 ms, with the comment "Timeout - always send straight away."
  - The reference client uses a 10 s default reply timeout (`pipeclient.py`).
  - The manual warns: "When things "do not work" you will rarely get a message from Audacity saying why."
- **Security.** The manual says: "Audacity does not police or sanitize the instructions that arrive on the pipe… If someone can write to the pipe they can get Audacity to read and write files and to execute code". `PIPE_REJECT_REMOTE_CLIENTS` limits the pipe to local clients.

---

## Not verified

- **Forum, wiki, support site and live manual.** All blocked by egress. The manual content comes from its GitHub source instead.
- **Real behaviour of the pipe.** Not exercised against a running Audacity 3.x. The 1024-byte limit, escaping details, the loop-command sequence and `.txt` label import via `Import2` are inferred from source.
- **wxWidgets quote/backslash rules.** How `ConvertStringToArgs` handles them is not checked.
- **Issue text.** Issue bodies and comments were read through WebFetch summaries. Some quotes may not be character-exact, and comments on #11734, #9407 and #10533 may have been missed.
- **Post-4.0 builds.** Whether a nightly or alpha contains any scripting interface: none is in master source as of 2026-09-25.

---

## What this means for the build

Audacity 4 publishes no scripting interface: the only published spec is Audacity 3's `mod-script-pipe`, described above, and 4.1's planned "script host" has no written protocol yet. So `apps/desktop/internal/audacitybridge` speaks the Audacity 3 protocol, behind a `Transport` interface, and the adapter reports "Audacity is not reachable" on an Audacity 4.0 install, whose pipe does not exist ([ADR 0355](../adr/0355-audacity-is-driven-over-its-scripting-pipe-built-from-the-published-spec-and-verified-by-the-owners-pass.md)). How each finding above shaped the client:

| Finding | What the client does |
| --- | --- |
| No pipe in 4.0.0, 4.0.1 or master | The client reports `ErrNotReachable`; the verification pass records the installed version first, and a 4.x script host is a new `Transport` (and possibly a new command dialect) when it has a spec |
| Pipe names and `\r\n\0` | Fixed in `pipe_windows.go` and `LineEnd`; never taken from a setting or the page |
| `ToSrvPipe` first, then `FromSrvPipe` | `dialPipes` opens them in that order |
| One 1024-byte read per command | `Command.Encode` refuses a line over 1020 bytes and a text value over 900 |
| CR and LF are deleted; `Unescape` replaces `\n`, `\"`, `\\` in that order | No escaping is safe, so a text value with a double quote, a backslash or a control character is refused (`SanitizeText` replaces them in label text first), and a path is written with forward slashes |
| A reply is lines, a terminator, an empty line | `readReply` is strict: exactly `BatchCommand finished: OK` or `Failed!`, then an empty line, or a `*ProtocolError` and the connection is dropped |
| No project window: a bare empty line | `ErrNoProject`, and the connection is kept |
| No server-side timeout; a modal dialog holds the answer | The client's timeout (5 s) closes the connection, and the next request reconnects, so a late answer is never read as the next command's |
| GetInfo JSON escapes only `"` and quotes booleans | `repairJSON` escapes a raw backslash or control character inside a string; `flexBool` reads `"true"`, `true` and `1` |
| Six significant digits in GetInfo times | A label is found by the finding identity in its text, never by exact time |
| `SetLabel` counts labels across every label track | The adapter re-reads the labels after `AddLabel` and names the new one by its index |
| No label import or export by path | Labels are added one at a time (`AddLabel` + `SetLabel`); a hand-off label file is written by the app from `GetInfo`, in Audacity's own label-file format |
| `Export2` picks the exporter by extension, and `CL` runs an external program | `Export` accepts only `.wav`, `.flac`, `.mp3`, `.ogg`, `.aiff` and `.aif` |
| `TogglePlayRegion` misbehaves when scripted | Loop is `SelectTime` then `PlayAtSpeedLooped` (stateless), and Stop is `Stop` |
| Anyone who can write to the pipe can make Audacity read and write files; `PIPE_REJECT_REMOTE_CLIENTS` | [Threat model](../architecture/threat-model.md) section 10 |
