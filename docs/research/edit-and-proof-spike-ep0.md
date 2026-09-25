# Edit and proof workspace, Phase 0: spike SF, the undo questions and the peaks cost

**Status: desk work done on 2026-09-25. The REAPER run is pending the owner ([#510](https://github.com/countrymanprime/narration-utils/issues/510), item 3).** This is Phase 0 of [edit-and-proof-workspace.prd.md](../prds/edit-and-proof-workspace.prd.md) (tracking issue [#546](https://github.com/countrymanprime/narration-utils/issues/546)). Nothing below has been observed in a running REAPER yet. The spike script is ready to run unattended, under owner decision D3.

## What changed since the PRD asked

The PRD's spike SF asked whether REAPER loads an `.RfxChain` onto a **take** by API. The owner has since decided ([ADR 0234](../adr/0234-fx-chains-go-on-tracks-and-a-passage-of-a-take-gets-one-plug-in-at-a-time.md)) that:

- a chain goes only on a **track** or the **master track**;
- a passage of a take gets one installed plug-in per request.

Stream B1 built the commands to that decision (`narration_workspace.lua`, #520), each with harness tests and mutation checks, behind the experimental switch ([ADR 0230](../adr/0230-reaper-commands-built-before-the-verification-pass-are-refused-by-the-host-while-the-experimental-switch-is-off.md)). So SF's questions now apply to those real commands, not to a prototype:

| PRD question (Phase 0) | Now answered by |
| --- | --- |
| Does a chain file load onto a take by API? | No longer asked: chains never go on a take (ADR 0234). The spike checks that `TrackFX_AddByName` with a chain's full path loads it onto a track and onto the master track (verification row A8). |
| What does a split do to take FX, markers and extension data? | `add_take_fx` splits, then adds one plug-in to the middle piece. The spike logs every piece's GUID, position, length, `D_STARTOFFS`, take FX, take markers, the item's line id, the take's `P_EXT` and the fades, before and after (row A8b). |
| Does `SetActiveTake` leave one undo point? | The spike runs `set_active_take` and checks for exactly one "Narration Utils: use take" point, that a second send adds none, and that one Undo restores take 1 (row A6). |
| FX folder listing | `list_fx_chains` against real `.RfxChain` files, including a nested folder and a file that is not a chain, written into the isolated resource folder (row A7). |
| Peaks cost on a 60-minute WAV | See [Peaks cost](#peaks-cost). |

## The script

`integrations/reaper/spikes/spike_ep0_workspace.lua` works like `navigation_check.lua`:

- It loads the **real** `narration_ui_bridge.lua` registry, with its real feature files.
- It calls each command the way the dispatcher does, then reads the answers back from `events.log`.
- It runs on a scratch project that it builds from `make_media.py`'s tones:
  - "Chapter 1" holds a two-take item, and a trimmed item (`D_STARTOFFS` 0.5 s, 2.5 s long) with a line id, take `P_EXT` and a take marker at 1.5 s.
  - "Chapter 2" holds one witness item.
- It builds the `.RfxChain` text from REAPER's own `<FXCHAIN>` output for ReaEQ, so no chain text is written by hand.

It writes `ep0-workspace-report.txt` in `-Out`, one PASS or FAIL per check, with the details alongside.

| Check | Rows of the [verification pass](../operations/reaper-verification-pass.md) |
| --- | --- |
| `set_active_take`: changed, then unchanged, one undo point, Undo restores, stale take refused | A6 |
| `list_fx_chains` lists both chains with forward slashes and leaves out `notes.txt`; `list_fx` lists ReaEQ and not the FX container | A7 |
| `apply_fx_chain` onto "Chapter 1" and onto `master`: one FX each, in the FX chain (not the input FX), one undo point each, two Undos remove both; a chain that isn't listed, `../reaper.ini` and `notes.txt` are refused before anything changes | A8 |
| `add_take_fx` on source 1.0–2.0 s of the trimmed item: two splits, the plug-in only on the middle piece, the answer names the middle piece, the left piece keeps the original GUID, the line id on all three, the middle piece starts at 1.0 s of source; a second plug-in splits nothing; two Undos remove it and then rejoin the item; the whole item splits nothing; a chain name and a take that does not play are refused | A8b |
| "Chapter 2"'s state chunk is unchanged after every write | A10 |
| After a save and a reload, the middle piece keeps its plug-in and the `.rpp` has a `<TAKEFX>` chunk | (new) |
| `GetMediaItemTake_Peaks` on a known tone: recorded only, to compare with the host's peaks (EP12 C) | (new) |

The script **records**, without asserting, what the PRD left open:

- which piece keeps the take marker;
- whether the take's `P_EXT` is copied onto the right-hand pieces;
- the fade and auto-fade lengths REAPER gives the pieces (its split crossfade);
- the exact `EnumInstalledFX` name of ReaEQ.

## Running it

On a Windows machine with REAPER 7.x installed, from the repository root:

```powershell
$out = "$env:TEMP\ep0-$(Get-Date -Format yyyyMMddHHmmss)"
python integrations/reaper/spikes/make_media.py $out\media
pwsh integrations/reaper/spikes/run-reaper.ps1 -Cfg "$env:TEMP\ep0-cfg" -Out $out `
  -Script integrations/reaper/spikes/spike_ep0_workspace.lua -Done $out\ep0-workspace-report.txt
Get-Content $out\ep0-workspace-report.txt
```

Copy the report into `integrations/reaper/spikes/results/ep0-workspace-report.txt` with the paths removed, and fill in [Results](#results).

Every check is unattended: nothing plays, records or needs an audio device. **Listening is not covered.** Hearing the passage's plug-in, and hearing REAPER's split crossfade, are part B of the verification pass and stay with the owner.

## Results

**Pending** (the REAPER run above). Until it runs, the facts the workspace relies on come from the API reference and the MCP-server cross-check in [reaper-api-for-planned-commands.md](reaper-api-for-planned-commands.md), and from the harness's fake REAPER, not from a real REAPER.

## Peaks cost

**Measured on 2026-09-25 with `measure.ComputePeaks`**, the host peaks for Phase 5 (EP12 A). Each bucket holds the lowest and highest sample over every channel, stored as two signed bytes scaled to ±127. The default is 50 buckets a second. The numbers come from `go test ./internal/measure -bench PeaksOneHour -benchtime 2x`, on the 4-core Linux container the stream ran in:

| Input | Peaks | Full analysis (`AnalyzeContext`), for comparison |
| --- | --- | --- |
| 60 minutes of 48 kHz stereo 24-bit WAV (1.04 GB of audio data), generated in memory | **3.4 s** (305 MB/s, about 1,000× real time) | 58.8 s (17.6 MB/s) |

- **Size:** an hour is 180,000 buckets, or 360 KB (about 480 KB as base64 in a binding's JSON). `TestAnHourOfPeaksIsSmall` pins it.
- **Where the time goes:** the time is the WAV reader decoding every sample to `float64`. The bucket loop itself was cut from 5.6 s to 3.4 s by stepping to each bucket's end instead of dividing on every frame.
- **What the host should do:** the budget is met without a cache for a chapter-length file (a chapter is usually under an hour, and a disk read adds to the in-memory figure). The PRD's evidence cache, keyed by source identity, still saves the time on every open after the first; that's the binding's job, in lane A.
- **Not measured:** a cold read from a spinning disk, and Windows. The owner's machine will differ from this container.
