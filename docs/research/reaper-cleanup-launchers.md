# Cleanup launchers: what is known, and the REAPER check still pending

[Reaper automation follow-through PRD](../prds/reaper-automation-follow-through.prd.md) Phase 23, [ADR 0146](../adr/0146-cleanup-launchers-open-an-allow-listed-reaper-action-found-by-its-name-and-change-nothing-themselves.md). This note records where each fact the launcher relies on came from, and the scripted REAPER check that has not been run. No REAPER run was approved for this phase, so nothing here was observed in a running REAPER.

## What the launcher relies on

| Fact | Source | Status |
| --- | --- | --- |
| REAPER 7.80 added an `Edit > Repair Pops/Clicks` dialog that finds pops and clicks and applies a spectral repair, plus actions to go to the next/previous detected pop/click | REAPER's [changelog](https://www.reaper.fm/whatsnew.txt), v7.80 (also `whatsnew.txt` in the local REAPER 7.80 install) | Per docs |
| The dialog's names in REAPER 7.80 are "Repair Pops/Clicks...", "Repair pops/clicks..." and "Repair Pops/Clicks"; the neighbouring actions are "Take: Go to next/previous detected audio pop/click for …", "Adjust pop/click detection settings..." and "Detect pop/clicks and apply spectral repair..." | Strings in the local REAPER 7.80 `reaper.exe` (read as text, REAPER not started). Which of them is the Action list text, and under which category prefix, is not known | **Unverified** |
| The Repair Pops/Clicks action's numeric command ID | Not published, not in the binary as text | Unknown; the launcher does not need it (ADR 0146) |
| `kbd_enumerateActions(section, index)` returns the command ID and the action-list text, and 0 past the end; native since REAPER 6.71 | ReaScript API documentation (the SDK's `reaper_plugin_functions.h`, [X-Raym's API docs](https://www.extremraym.com/cloud/reascript-doc/)) | Per docs. The fake in `integrations/reaper/tests/fake_reaper.lua` copies this shape |
| `SectionFromUniqueID(0)` is the Main section | ReaScript API documentation | Per docs |
| A loaded ReaScript is named `Script: <file name>` in the Action list | REAPER's behaviour for every script this project imports (`Script: NarrationUtils_Launcher.lua`) | Seen in REAPER |
| Magnolius DeClick is `Scripts/declick/Magnolius_DeClick.lua` in [m-dahlberg/magnolius-reaper](https://github.com/m-dahlberg/magnolius-reaper) (GPL-3.0), installed through ReaPack or "Load ReaScript"; it works on one selected audio item and needs ReaImGui | That repository's tree and `Scripts/declick/README.md`, read 2026-09-23 | Per docs |

## Pending: the scripted check in REAPER (needs the owner's approval)

Run under the D3 rules in [`integrations/reaper/spikes/README.md`](../../integrations/reaper/spikes/README.md): an isolated `-cfgfile`, a scratch project with synthetic media, no audio device. Record the REAPER version and each result here.

1. **Pending.** Enumerate the Main section with `kbd_enumerateActions` and record: the exact text and ID of every action whose text contains "pop/click"; that the call answers `id, name` and `0` (with an empty name) past the end. If the Repair Pops/Clicks text is not matched by `narration_cleanup.lua`'s `TOOLS.repair_pops_clicks.matches`, add the real text and a harness test with it.
2. **Pending.** Load the real bridge, select one item, send `launch_cleanup_tool|t1|repair_pops_clicks` and confirm the `CLEANUP_LAUNCHED` event names the dialog's action, the dialog opens (the driver's dialog watcher sees its window), and the project's state change count is unchanged after the dialog is closed with Cancel.
3. **Pending.** With no item selected, confirm the command answers `ERROR|t1|Select the items to repair in REAPER first.` and no dialog opens.
4. **Pending, needs the owner.** In the owner's own REAPER with Magnolius DeClick installed through ReaPack: press **Cleanup tools… > Open Magnolius DeClick** in the app with one item selected, and confirm the script's panel opens. Then remove it and confirm the app says it is not installed.
5. **Pending, needs the owner.** Press **Open Repair Pops/Clicks** in the app on a real narration item, apply a repair in the dialog, and confirm one REAPER Undo takes it back (the repair is REAPER's edit, not the app's).

Until step 1 is run, a REAPER whose action text differs from the accepted names reports "This REAPER has no Repair Pops/Clicks dialog" instead of opening it. It cannot open a different action.
