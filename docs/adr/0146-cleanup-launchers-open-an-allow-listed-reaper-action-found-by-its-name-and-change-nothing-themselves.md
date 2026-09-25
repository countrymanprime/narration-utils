# 0146. Cleanup launchers open an allow-listed REAPER action found by its name, and change nothing themselves

- **Status:** Proposed
- **Date:** 2026-09-23

## Context and problem

The [REAPER automation follow-through PRD](../prds/reaper-automation-follow-through.prd.md) Phase 23 asks for one-click launch of REAPER's own repair dialog on the selected items: an "allow-listed named-action command", with "action IDs verified in the Action list", and third-party tools "only if installed and never bundled" (Magnolius is GPL-3.0). The success signal is "the dialog opens; the app changes nothing itself".

REAPER 7.80 added `Edit > Repair Pops/Clicks` ([changelog](https://www.reaper.fm/whatsnew.txt)). Its numeric action ID is not published, and no REAPER run was approved for this phase to read it from the Action list. REAPER 7.80's own binary carries the texts "Repair pops/clicks..." and "Repair Pops/Clicks..." but not the ID they are bound to. A third-party ReaScript such as Magnolius's `Magnolius_DeClick.lua` has no fixed ID at all: REAPER gives a loaded script a `_RS…` command ID derived from where it was installed, and names it `Script: <file name>`.

This is the first bridge command that calls `Main_OnCommand`. Every earlier feature file avoids it on purpose (`narration_render.lua` has a harness test that fails if it is ever called), because one action ID is all it takes to render, apply FX or run any script. The bridge's commands folder is written by the host, so it is a trust boundary ([threat model](../architecture/threat-model.md), section 5).

## Decision drivers

- The PRD asks for an "allow-listed named-action command", with action IDs verified in the Action list, and third-party tools only if installed and never bundled.
- The success signal: the dialog opens, and the app changes nothing itself.
- Repair Pops/Clicks' numeric action ID is not published, and no REAPER run was approved to read it; a third-party ReaScript has no fixed ID at all.
- One action ID is all it takes to render, apply FX or run any script, and the bridge's commands folder is a trust boundary (threat model, section 5).

## Considered options

1. An allow-listed tool key from the host, with the action found by its action-list name at launch
2. A hard-coded numeric action ID
3. Passing an action ID from the host

## Decision outcome

**Chosen option: an allow-listed tool key from the host, with the action found by its action-list name at launch**, because the action's numeric ID is not published, a script has no fixed ID, and one action ID is all it takes to render, apply FX or run any script.

- **The host sends a tool key, never an action.** `launch_cleanup_tool` in `integrations/reaper/narration_cleanup.lua` takes `run_id` and a key from its own `TOOLS` table: `repair_pops_clicks` and `magnolius_declick`, nothing else. The Go service (`apps/desktop/internal/cleanuptools`, `Tools`) holds the same allow-list and refuses anything else before writing a command; the Lua side refuses again before it reads the action list. Adding a tool means adding it to both tables with its harness and Go tests.
- **The action is found by its action-list name, at launch, not by a hard-coded ID.** The command walks the Main section (`kbd_enumerateActions` over `SectionFromUniqueID(0)`) and matches each tool's name: Repair Pops/Clicks as `repair pops/clicks` with or without a trailing `...`, under any category prefix except the narrator's own `Script:` and `Custom:`; Magnolius DeClick exactly as `Script: Magnolius_DeClick.lua`. No match reports the tool as missing (REAPER too old, or not installed); more than one match launches nothing rather than guess. Verifying the ID "in the Action list" becomes a check the code makes on every launch instead of a number copied once.
- **A launch is one `Main_OnCommand(id, 0)` and nothing else.** It needs at least one selected item and says so otherwise. It opens no undo block and changes no item, marker, cursor or project setting; the dialog it opens is the narrator's to apply or cancel, as their own undoable edit. The command reports `CLEANUP_LAUNCHED|run|tool|action-name`, so the narrator sees which action opened.
- **Third-party tools are launched only if the narrator installed them.** Nothing is bundled, downloaded or installed; "not installed" is a message that tells the narrator how to install it themselves.

### Consequences

- **Good:** The bridge still cannot be used to run an arbitrary REAPER action: the only `Main_OnCommand` in the Lua is reached through the allow-list, and `cleanup_test.lua` plus five mutation entries pin the key check, the ambiguity check, the selection check, the API guard and the `Script:`/`Custom:` exclusion.
- **Neutral:** A REAPER that renames the action, or a locale that translates action names, makes Repair Pops/Clicks "missing" instead of opening the wrong thing. The fix is a new accepted name in `TOOLS`, found in a scripted REAPER run.
- **Bad:** The exact action-list text and the `kbd_enumerateActions` return shape come from the ReaScript documentation and REAPER 7.80's strings, not from a REAPER run. Until the scripted check in [the evidence note](../research/reaper-cleanup-launchers.md) is run, the feature may report the dialog as missing on a REAPER that has it; it cannot open anything else.
- **Bad:** Walking the action list costs a few thousand calls per launch, once per button press.
- **Neutral:** Launching by a fixed numeric ID, or passing an ID from the host, would need a new ADR that supersedes this one.

### Confirmation

`cleanup_test.lua` plus five mutation entries pin the key check, the ambiguity check, the selection check, the API guard and the `Script:`/`Custom:` exclusion. Adding a tool means adding it to both allow-lists with its harness and Go tests.

## Pros and cons of the options

### A hard-coded numeric action ID

- Bad, because Repair Pops/Clicks' numeric action ID is not published, and a third-party ReaScript has no fixed ID at all.

### Passing an action ID from the host

- Bad, because one action ID is all it takes to render, apply FX or run any script, and the bridge's commands folder is a trust boundary.
