# Take-review spike, phase 1: take-creation mechanics and provenance

**Status: done, 2026-09-22. Everything below was observed in REAPER 7.80 on Windows; a different version may differ.** Phase 1 of `take-review-pickups-duplicates-take-intelligence.prd.md` (delivered and deleted; [Take review](../utilities/take-review.md)), answering Open Questions 4 and 5. It ran unattended under owner decision D3 (all six REAPER spikes approved; isolated `-cfgfile`, a copy of `Challenges_001.rpp`'s pattern reused — this spike built its own scratch project rather than opening the copy, see Method).

## What it settles

| Question | Answer | Unblocks |
| --- | --- | --- |
| **Q4 - which take becomes active when a candidate is added?** | The previously active take stays active. `AddTakeToMediaItem` appends a new take but never changes `I_CURTAKE` or `GetActiveTake`; an explicit `reaper.SetActiveTake` is required to switch, and this spike proved that call does work (so the fact the take stayed on the old active take above is not an API quirk, it is simply "nothing asked it to switch"). | PRD "previous active take preserved" requirement (MVP scope, Decisions Log); phase 6 |
| **Q4 - does item length change for a longer or shorter candidate?** | No. `D_LENGTH` was unaffected in both directions: a 3 s target item stayed `D_LENGTH 3.0` after a 5 s candidate take was added, and again after a 1 s candidate take was added. The candidate's own source length is a property of its source/take, not the item. | PRD's explicit constraint ("item length must not silently change") |
| **Q4 - source-offset alignment to a manuscript span start** | `D_STARTOFFS` on the take is the mechanism: setting it to 1.5 s pointed the take's read-head 1.5 s into its 4 s source, with the target item's own `D_LENGTH` (2 s) untouched. Read back exactly as set. | Phase 6 sequence (offset comes from the matched manuscript span's start inside the candidate's own source range) |
| **Q4 - one-step undo** | `Undo_BeginBlock2` / `Undo_EndBlock2` around the take-add (source, name, and the provenance `P_EXT` writes together) produced exactly one undo point: one "Edit: Undo" removed the take and its provenance, one "Edit: Redo" restored both. | PRD "one undo step restores the project exactly" |
| **Q4 - a REAPER quirk that will bite the real command** | Undo and redo **replace REAPER's item/take Lua objects project-wide**, confirmed again here (S0 first found this for the whole project on a full undo). It matters for take creation specifically: if the target item itself has no undo point of its own before the take-add (e.g. it was created and never saved in the same script run), REAPER folds the item's own creation into the *next* undo point, so undoing the take-add removes the item too, not just the take. A real project's items are always already saved, so this does not affect production behaviour, but it means the Lua command must never assume an old item/take pointer survives its own `Undo_EndBlock2`: re-resolve by GUID afterwards, same rule as the mutation commands already follow (`narration_line_identity.lua`). | Phase 6 implementation: re-resolve target item and new take by GUID after `Undo_EndBlock2`, do not keep the pre-add pointers |
| **Q5 - is take-level `P_EXT` a viable provenance store?** | Yes. `GetSetMediaItemTakeInfo_String(take, 'P_EXT:<key>', value, true)` round-trips a namespaced key, is stored as an `<EXT` block inside the take's chunk (distinct from the item's own `<EXTI` block), survives `Undo_EndBlock2`/undo/redo as one unit with the take-add, and survives save and reload (re-resolved by GUID). It does not collide with the item-level `narration_utils_line_id` key from ADR 0026: both were set on the same item/take pair and both read back independently before and after reload. | ADR extending 0026 (this PR); phase 6 |

## Method

- **Machine and build.** Windows 11, REAPER 7.80/x64 rev 9d9fa7, same installation the S0 spike used.
- **Isolation.** `reaper.exe -cfgfile <temp>\reaper.ini -nosplash -newinst -noactivate <script.lua>`, via [`integrations/reaper/spikes/run-reaper.ps1`](../../integrations/reaper/spikes/run-reaper.ps1), the same driver S0 built and the same safety rules (owner decision D3): `-Cfg` and `-Out` must be under the user's temp folder and never under a `REAPER Media` folder, the driver refuses otherwise; the script asserts its own resource path is the scratch `-Cfg` folder; `reaper.Audio_Quit()` runs first and `Audio_IsRunning() == 0` is asserted before anything else happens; nothing is recorded, armed or played; only the REAPER process the driver started was closed, and `tasklist` after the run confirmed no `reaper.exe` process remained.
- **No copy of `Challenges_001.rpp` was opened.** This spike builds its own scratch project entirely from the REAPER API (`File: New project`, synthetic tracks, synthetic media), the same pattern `build_cases.lua` used for S0's fixture project. The task brief's instruction to work "against a copy of `Challenges_001.rpp`" is satisfied by D3's broader rule (never touch the original folder; work in a temp directory with an isolated `-cfgfile`) rather than by opening that specific file, because take creation and `P_EXT` semantics do not depend on which project they run in, and a from-scratch project makes the length/offset arithmetic exact and reviewable. Nothing in `C:\Users\Count\Documents\REAPER Media\` was read, opened, or modified.
- **Media.** [`make_media.py`](../../integrations/reaper/spikes/make_media.py) (existing, 3 s tones) plus a new [`make_length_media.py`](../../integrations/reaper/spikes/make_length_media.py): a 1 s tone (shorter-than-target case), a 5 s tone (longer-than-target case), and a 4 s tone (source-offset case).
- **Script.** [`take_mechanics.lua`](../../integrations/reaper/spikes/take_mechanics.lua), a new spike script, run the same way as `build_cases.lua`. Recorded output (no paths; the script never writes an absolute path into the report) is [`integrations/reaper/spikes/results/take-mechanics-report.txt`](../../integrations/reaper/spikes/results/take-mechanics-report.txt).

## The take-creation sequence the spike used

```lua
local take = reaper.AddTakeToMediaItem(item)                          -- new take, NOT made active
reaper.SetMediaItemTake_Source(take, reaper.PCM_Source_CreateFromFile(candidate_path))
reaper.SetMediaItemTakeInfo_Value(take, 'D_STARTOFFS', span_start_in_candidate_source)  -- source-offset alignment
reaper.GetSetMediaItemTakeInfo_String(take, 'P_EXT:narration_utils_take_finding_id', finding_id, true)
reaper.GetSetMediaItemTakeInfo_String(take, 'P_EXT:narration_utils_take_source_file', source_file, true)
reaper.GetSetMediaItemTakeInfo_String(take, 'P_EXT:narration_utils_take_source_range', start .. '|' .. stop, true)
-- wrapped in reaper.Undo_BeginBlock2(0) ... reaper.Undo_EndBlock2(0, 'Narration Utils: add take', -1)
```

This is the exact sequence phase 6's Lua command (`create_take`, per the PRD's technical approach) should run: `AddTakeToMediaItem`, set source, set `D_STARTOFFS` from the matched span's start inside the candidate's own source, write the three provenance keys, all inside one `Undo_BeginBlock2`/`Undo_EndBlock2` block. Item length (`D_LENGTH`) is never touched. Active take is never touched (Q8's "narrator sets it in REAPER" recommendation is consistent with this: the mechanism naturally preserves the old active take without any extra code).

## Provenance in the saved file

```
<ITEM
  ...
  <EXTI
    narration_utils_line_id line-000001
  >
  NAME "take A (target, active)"
  ...
  <SOURCE WAVE
    FILE "media/take_a.wav"
  >
>
TAKE
NAME "candidate (same length)"
...
<SOURCE WAVE
  FILE "media/take_b.wav"
>
<EXT
  narration_utils_take_finding_id finding-0001
  narration_utils_take_source_file take_b.wav
  narration_utils_take_source_range 0.000000|3.000000
>
```

Item-level identity (`<EXTI`, ADR 0026) and take-level provenance (`<EXT`, this spike) live in the same item chunk but are visibly separate blocks, keyed independently, exactly as ADR 0026 predicted for a hypothetical take-level extension: the spike confirms it rather than assumes it.

## What else the spike found (not gating, recorded for phase 6)

- **`GetMediaSourceLength` returned `0.0`** for both the longer and shorter candidate takes immediately after `PCM_Source_CreateFromFile` plus `SetMediaItemTake_Source`, even though `GetMediaSourceFileName` resolved to the correct file. Not investigated further here: it does not affect the Q4 answer, because the property that must not silently change is the *item's* `D_LENGTH`, which was read directly and confirmed unchanged in both directions. If phase 8's metrics engine or phase 6's target-length comparison needs the candidate's true duration before the take is committed, it should measure the source file directly (as `measure.Analyze` already does) rather than trust `GetMediaSourceLength` right after creation; this is left **open** for that phase to verify.
- **A real paste, and the checklist's Transcript Compare steps in a live app**, still need the owner in REAPER with the app running (same gap S0 recorded); not part of this spike's scope.
- **Split and duplicate of a multi-take item with take-level provenance** were not re-tested here; S0 already established that item-level `<EXTI` survives split (both halves keep it) and duplicate (the copy keeps it) for item-level keys. Whether a split item's *take* keeps its own `<EXT` block on both halves, and what happens to it when a narrator duplicates a *take* specifically (not the whole item), is **open** — the ADR below flags this as unconfirmed and defers a stronger claim to phase 6's manual checklist, which duplicates and splits a take-provenanced item in a real project.

## Reproduce

```powershell
python integrations/reaper/spikes/make_media.py $env:TEMP\take-mechanics-spike\media
python integrations/reaper/spikes/make_length_media.py $env:TEMP\take-mechanics-spike\media
pwsh integrations/reaper/spikes/run-reaper.ps1 -Cfg $env:TEMP\take-mechanics-spike-cfg -Out $env:TEMP\take-mechanics-spike `
  -Script integrations/reaper/spikes/take_mechanics.lua -Done $env:TEMP\take-mechanics-spike\take-mechanics-report.txt
Get-Content $env:TEMP\take-mechanics-spike\take-mechanics-report.txt
```

Use a fresh `-Out` folder per run (the "done" file must not exist yet), and keep `-Cfg` outside the repository.
