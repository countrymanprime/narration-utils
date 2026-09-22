# REAPER spike S5: render details

**Status: done, 2026-09-22. Everything below was observed in REAPER 7.80/x64 on Windows; a different version may differ.** Spike S5 of the [REAPER automation research](reaper-automation-surface.md) (section 6, section 9 item 5) and phase 10 of [reaper-automation-follow-through.prd.md](../prds/reaper-automation-follow-through.prd.md). It ran in a real REAPER 7.80 under owner decision D3 (isolated resource directory, a scratch project only, never `Challenges_001.rpp` or any owner file). It verifies what phase 11 (per-chapter render configuration) is allowed to assume.

## What it settles

| Question | Answer | Unblocks |
| --- | --- | --- |
| Does `$region` in `RENDER_PATTERN` resolve to the region name, one file per region, when `RENDER_BOUNDSFLAG` is "all regions"? | Yes. Three regions named "Chapter 1"/"Chapter 2"/"Chapter 3" rendered to exactly `Chapter 1.wav`, `Chapter 2.wav`, `Chapter 3.wav`. `RENDER_TARGETS`, read *before* rendering, predicted the same three paths exactly. | Phase 11: the chapter-render pattern can be `$region` with bounds "all regions" and region names as the chapter titles. |
| What does the `RENDER_STATS`/`RENDER_STATS_SUMMARY` key actually return? | **Unconfirmed, and the getter is not safe to poke at with an arbitrary action ID.** With the true dry-run/analysis action (42437, no items selected) it returned an empty string, both via the getter alone and after nothing else changed on disk. Passing the *real* multi-region render action (42230) to the same getter did **not** just return stats — it re-invoked rendering and produced a "Files already exist" dialog for the same three chapter files, after this script had already rendered and deleted them once in the same run. See "Surprise" below. | Phase 11 should not call `RENDER_STATS`/`RENDER_STATS_SUMMARY` with a file-writing render action's ID. If a later phase needs render stats, it must use a true dry-run action (research's own example, 42437, which this run confirms exists and is named "Calculate loudness of selected items, including take and track FX and settings, via dry run render") with items actually selected, and treat the result format as still unknown pending that follow-up. |
| Marker-to-chapter mapping for per-region rendering | Confirmed by the same run as the `$region` result above: REAPER's own region is the unit `$region` names files after; no separate "marker-to-chapter" mapping step is needed for filenames as long as chapters are represented as regions (as phase 7's chapter regions already produce), not point markers. ID3 `CHAP`/`CTOC` embedding (a different, byte-level question, phase 12's scope) was not tested here. | Phase 11 can rely on regions named per chapter; phase 12 (chapter tag embedding) still needs its own verification, unchanged from the PRD's existing "TBD - needs research" on that phase. |
| Are the action IDs research section 2 and 6 cited still correct in REAPER 7.80? | Yes, all 15 checked resolve to a live action with a name matching or refining the research's guess (below). None were missing or renumbered. | Phase 11 and any future phase citing these IDs can use them as-is; re-verify only if REAPER's major version changes. |
| Can a render be validated/previewed without writing files (a "dry-run" mode)? | **Partially, and only for the dry-run-specific action, not for a real render action.** `Render_Execute` and `Render_EnumerateOutputMode` (names in the task brief) do not exist in this REAPER's ReaScript API (`APIExists` false for both) — they are not real API entry points. There is a genuine dry-run action (42437), described by its own action-list text as computing loudness "via dry run render" without writing files (confirmed: the renders directory was unchanged before and after the getter call with 42437's ID), but it needs selected items to do anything (we had none selected, so its stats string came back empty) and, per the research doc, "shows UI, cancellable" when actually executed as an action rather than queried through the getter — untested here to avoid an unattended hang risk (see Open below). There is no dry-run mode for a real multi-file "render all regions" pass: the getter itself triggers real rendering when given a real render action's ID (see Surprise). | Phase 11's UI should not promise a preview render with zero file writes; "Prepare chapter render" (Open Question 7's "configure only") is the right shape — configure, then the narrator presses the real Render action, which is the only path proven to write exactly the intended files. |

## Method

- **Machine and build.** Same machine as spike S0: Windows 11, REAPER 7.80/x64. `reaper.Audio_Quit()` was called first and `Audio_IsRunning() == 0` was asserted before anything else ran; the script never armed, recorded or played anything.
- **Isolation.** `reaper.exe -cfgfile <temp>\spike-s5-cfg\reaper.ini -nosplash -newinst -noactivate spike_s5_render.lua`, driven by the existing `integrations/reaper/spikes/run-reaper.ps1` (unchanged) under owner decision D3. No project file was opened — the script builds its own scratch project (one track, three items on synthetic tones from `make_media.py`, three regions bounding them) entirely via the API, so `Challenges_001.rpp` was not touched at all for this spike.
- **Script.** New: [`integrations/reaper/spikes/spike_s5_render.lua`](../../integrations/reaper/spikes/spike_s5_render.lua) (kept, per the spikes README convention; not shipped — `scripts/release/prepare-resources.py` already excludes this whole folder). It writes `report.txt` after every stage (not just at the end), specifically so that if a later, riskier stage hangs on a modal dialog, the earlier findings are not lost.
- **Output.** Everything was written under a scratch `%TEMP%\spike-s5-render` folder and a scratch `%TEMP%\spike-s5-cfg` resource directory, both deleted after this write-up was drafted from the run's `report.txt`. No file under `C:\Users\Count\Documents\REAPER Media\` was read, written, or opened. The run left no REAPER process behind (`tasklist` confirmed after the run and again after cleanup).

## Findings in detail

### 1. Action IDs (research section 2 and 6)

`kbd_getTextFromCmd` against `SectionFromUniqueID(0)` (the main section) confirmed every ID research cited from the older Ultraschall snapshot:

| ID | Research's label | REAPER 7.80's own name |
| --- | --- | --- |
| 1013 | Record | Transport: Record |
| 1016 | Stop | Transport: Stop |
| 40044 | Play/stop | Transport: Play/stop |
| 40252 | Record mode: normal | Record: Set record mode to normal |
| 40076 | Record mode: time-selection auto-punch | Record: Set record mode to time selection auto-punch |
| 40253 | Record mode: selected-item auto-punch | Record: Set record mode to selected item auto-punch |
| 40364 | Toggle metronome | Options: Toggle metronome |
| 40363 | Metronome and pre-roll settings | Options: Show metronome/pre-roll settings |
| 41818 | Pre-roll on play | Pre-roll: Toggle pre-roll on play |
| 41819 | Pre-roll on record | Pre-roll: Toggle pre-roll on record |
| 40012 | Split at cursor | Item: Split items at edit or play cursor (select right) |
| 42230 | Render, most recent settings | File: Render project, using the most recent render settings, auto-close render dialog |
| 41823 | Add to render queue | File: Add project to render queue, using the most recent render settings |
| 40209 | Apply track/take FX to items | Item: Apply track/take FX to items |
| 42437 | (research section 5.3's dry-run example) | Calculate loudness of selected items, including take and track FX and settings, via dry run render |

None were empty (empty would mean "no such action in this build"). Verdict: **confirmed, use as-is.**

### 2. API surface

`reaper.APIExists(name)` results:

| Name | Exists |
| --- | --- |
| `GetSetProjectInfo_String` | true |
| `GetSetProjectInfo` | true |
| `Render_Execute` | **false** |
| `Render_EnumerateOutputMode` | **false** |
| `RenderFileSection` | true |
| `SetRegionRenderMatrix` | true |
| `EnumRegionRenderMatrix` | true |
| `ResolveWildcards` | true |
| `AddRegionOrMarker` | true |
| `AddProjectMarker2` | true |
| `CF_GetCommandText` | false (SWS extension; not installed in the isolated `-cfgfile`, as expected) |

`Render_Execute` and `Render_EnumerateOutputMode` (names given in this task's brief) are **not real ReaScript API functions** in this build; render is driven only through actions (`Main_OnCommand`) and the `RENDER_*` project-info keys, matching what the research doc already documented. This is a correction to the task brief, not a finding about REAPER changing.

`ResolveWildcards(0, 0, "$region")` was attempted (to check literal-vs-resolved `RENDER_PATTERN` reads) but errored: `bad argument #4 to '?' (string expected, got no value)`. The function exists but needs a fourth argument this script did not supply (likely an in/out buffer or a flags parameter); **the exact signature is unverified** and is not load-bearing for phase 11 (which only needs the render pipeline's own resolution, proven directly below, not a manual wildcard resolve).

### 3. `$region` naming and marker-to-chapter mapping

Scratch project: track "Narration", three items on synthetic tones, three regions named "Chapter 1" (0-3s), "Chapter 2" (4-7s), "Chapter 3" (8-11s). Render configured with `RENDER_FILE` = a scratch `renders/` folder, `RENDER_PATTERN` = `$region`, `RENDER_BOUNDSFLAG` = 3 ("all regions"), `RENDER_ADDTOPROJ` = 0.

- `RENDER_PATTERN` read back **literally** (`$region`, not resolved) — confirming the getter for that key is a plain string store/read, not a resolver.
- `RENDER_TARGETS`, read *before* any render ran, returned exactly:
  `...\renders\Chapter 1.wav;...\renders\Chapter 2.wav;...\renders\Chapter 3.wav`
- After running action 42230 ("File: Render project, using the most recent render settings"), the `renders/` folder contained exactly those three files, with those exact names.

**Verdict: confirmed.** `$region` with bounds "all regions" produces one file per region, named after the region's own name field, and `RENDER_TARGETS` can be read beforehand to show the narrator the resulting file names without rendering — which is exactly the confirmation Phase 11's success signal asks for ("a confirmation showing the resulting file names").

`RENDER_FORMAT`, read before any change, was `ZXZhdxgAAQ==` — a base64 blob whose decoded bytes begin `evaw` (WAV reversed, as the research doc's example format predicted), confirming it is an opaque sink-config blob the first render slice should never write, only read/carry forward (as Open Question 7 already decided).

### 4. `RENDER_STATS` / `RENDER_STATS_SUMMARY`, and a surprise

Two experiments, in this order (safe one first):

1. **Getter only, dry-run action ID, no items selected, no `Main_OnCommand`.** `GetSetProjectInfo_String(0, 'RENDER_STATS', '42437', false)` and the `_SUMMARY` variant both returned `true` with an **empty string**. The `renders/` directory was empty before and after (confirmed by `EnumerateFiles`, cache-cleared with index `-1` per the existing `narration_bridge_core.lua` pattern). No file was written by this call. This is consistent with "dry run" in the sense of not writing files, but the empty stats string is inconclusive: no items were selected, and action 42437's own name ("loudness of selected *items*") suggests it needs a selection to have anything to report. **The key format itself is not confirmed** — only that calling the getter this way is safe (no writes) and returns nothing useful without a selection.
2. **Getter with a real, file-writing render action's ID, after that action had actually already rendered once.** `GetSetProjectInfo_String(0, 'RENDER_STATS', '42230', false)` (called *after* the real render in step 6 of the script, once the three files had already been rendered and then deleted by the script's own cleanup) also returned an empty string via the getter call itself — but a **"Render Warning: Files already exist"** modal dialog (naming all three chapter files) appeared moments later, during REAPER's shutdown sequence (after the script had already written its report and called the quit action). The `run-reaper.ps1` driver does not recognize this dialog text, logs it as `UNKNOWN DIALOG`, and does not click it; REAPER was closed by the driver's timeout-triggered force-close instead, cleanly, with no process left behind.

**Reading of the surprise:** passing a real, file-writing render action's ID to the `RENDER_STATS` getter does not behave as a pure read of already-computed stats — it appears to re-invoke that render action, including its own "files already exist" prompt, asynchronously relative to the calling script (the dialog appeared only after the script had already finished and requested REAPER quit). This means **`RENDER_STATS`/`RENDER_STATS_SUMMARY` must never be called with a file-writing render action's ID in unattended code** — only with a genuine dry-run/analysis action such as 42437, and even then, with a selection made and (per the research doc's own caveat) "shows UI, cancellable" — so a fully headless, dialog-free stats read is **not proven** by this spike. Phase 11 should not add a "render stats" feature until a follow-up spike drives 42437 correctly (a real item selection, `Main_OnCommand` invoked and watched for a dialog rather than assumed silent) or the narrator explicitly accepts an interactive dry-run step.

### 5. Dry-run behavior overall

Honest summary against the task's four questions:

- **`RENDER_STATS` key format**: not confirmed (both attempts returned empty; the safe attempt lacked a selection, the unsafe attempt triggered a real render instead of a pure query). Left open.
- **Marker-to-chapter mapping / `$region` naming**: confirmed, as above.
- **Current action IDs**: confirmed, as above, all 15 stable in 7.80.
- **Dry-run behavior**: confirmed for the *file-write* question — the true dry-run action (42437) writes nothing when called through the getter alone — but not confirmed as a source of any usable stats output, and confirmed **unsafe** to substitute a real render action's ID for the dry-run action's ID when calling the same getter.

## Not exercised / left open (say so rather than guess)

- **42437 driven via `Main_OnCommand` with a real selection.** Not attempted in this run, specifically to avoid the unattended-hang risk the research doc itself flags ("Shows UI, cancellable"). A follow-up spike should select items first, trigger 42437 through `Main_OnCommand`, and give `run-reaper.ps1` a dialog handler for whatever text that action's own dialog uses (or confirm it truly never shows one when items are selected and nothing is wrong).
- **`ResolveWildcards`'s exact signature.** Exists, but the 4-argument call used here was wrong; not load-bearing for phase 11's success signal since `RENDER_TARGETS` already answers the "what file names result" question directly.
- **ID3 `CHAP`/`CTOC` embedding from a `CHAP=Title` marker name.** Out of this spike's scope (owned by phase 12, already marked "TBD - needs research" in the PRD); nothing here changes that status.
- **Region render matrix (`SetRegionRenderMatrix`/`EnumRegionRenderMatrix`).** Confirmed to exist (`APIExists` true for both) but not exercised — the plain "all regions" bounds flag was sufficient to prove `$region` naming for a single-track project, and phase 11's scope (per the PRD) does not require per-region track selection.

## Effect on Phase 11 scope

- Phase 11's `configure_chapter_render` can safely set `RENDER_BOUNDSFLAG=3` (all regions), `RENDER_PATTERN='$region'`, and `RENDER_FILE` to the chosen folder, then read `RENDER_TARGETS` to show the narrator the resulting file names before they press Render — exactly the "configuration ... narrator clicks Render" shape Open Question 7 already chose, now with confirmed evidence instead of "per docs, verify."
- Phase 11 must **not** add a "render stats" or "preview" feature built on `RENDER_STATS`/`RENDER_STATS_SUMMARY` yet: the key's format is unconfirmed and this spike found a real footgun (a real render action's ID triggers a real render through that getter). If a stats/preview feature is wanted later, it needs its own follow-up spike per the "Not exercised" section above, not an assumption from this one.
- No code changes result from this phase; it is research only, as the PRD's phase table describes it.
