# The Audacity verification pass

The Audacity adapter was built from Audacity's published scripting spec and tested against a fake pipe server. It was not tested against a running Audacity ([ADR 0355](../adr/0355-audacity-is-driven-over-its-scripting-pipe-built-from-the-published-spec-and-verified-by-the-owners-pass.md), [the spec note](../research/audacity-4-scripting-spec.md)). This pass is the owner's check of what only a real Audacity can show. It replaces the S-A1/S-A2 spike session of the [Audacity integration PRD](../prds/audacity-integration.prd.md), the same way the REAPER checks work ([ADR 0066](../adr/0066-the-lua-bridge-is-tested-by-a-harness-under-lua-5-4-and-reaper-api-behaviour-is-checked-in-reaper.md)). Until it passes, every Audacity capability stays **Experimental**, and it is tracked on [#510](https://github.com/countrymanprime/narration-utils/issues/510).

- **Part A** runs unattended in about a minute and writes a results file.
- **Part B** is five short checks by eye and ear.

Paste both into #510.

## Before you start

- **A Windows machine** with this repository checked out and bootstrapped. Part A is a Go test, so it needs the Go toolchain that `scripts/cloud/session-start.sh` or the bootstrap installs.
- **An Audacity with a scripting pipe.** Write down the version from Help > About Audacity; the results file asks for it.
  - **Audacity 4.0.x has no scripting pipe.** Part A will stop at A1 with "not reachable", and that is the expected result on 4.0 ([ADR 0355](../adr/0355-audacity-is-driven-over-its-scripting-pipe-built-from-the-published-spec-and-verified-by-the-owners-pass.md)). If a later Audacity 4 release notes mention a scripting pipe or script host, run the pass on it and say so on #510.
  - **Audacity 3.x:** Edit > Preferences > Modules, set **mod-script-pipe** to **Enabled**, then restart Audacity. Reopen Preferences > Modules and check that it now says Enabled.
- **A scratch project, never a real one.** In Audacity, File > New, so that one empty project window is open and no other Audacity window is. Part A refuses to run on a project that already has tracks or labels.
- **A scratch folder**, for example `C:\Temp\nu-audacity-pass`. Part A writes a test tone, one exported WAV, a label file and its results there.

## Part A (unattended)

In PowerShell, from the repository root:

```powershell
cd apps\desktop
$env:NU_AUDACITY_PASS = "1"
$env:NU_AUDACITY_PASS_DIR = "C:\Temp\nu-audacity-pass"
$env:NU_AUDACITY_VERSION = "3.7.x"   # what Help > About Audacity says
New-Item -ItemType Directory -Force $env:NU_AUDACITY_PASS_DIR | Out-Null
go test -tags audacitylive -run TestAudacityVerificationPass -v -count=1 ./internal/dawport/audacity/
```

It writes `audacity-pass-results.md` into the scratch folder and prints the same table. Leave Audacity alone while it runs, about 15 seconds.

### Expected results

| Step | What it does in Audacity | Expected |
| --- | --- | --- |
| A1 | `Message` echo | PASS. On Audacity 4.0, or with scripting off, FAIL "not reachable", and the run stops |
| A2 | 20 echoes | PASS, with the median and maximum round-trip time recorded. Anything under the 5 s timeout passes; note if the median is over 100 ms |
| A3 | `GetInfo` Tracks and Labels on the empty project | PASS, "0 tracks, 0 labels" |
| A4 | `Import2` a 12 s tone the test writes; `GetInfo` Clips | PASS: one clip |
| A5 | One label whose text has `’ ‘ — “ ” ∖ é % & < > { } ' =`; read it back | PASS: the text comes back unchanged. This is the escaping check |
| A6 | Import three findings as labels, then the same three again | PASS: 3 added, then 0 added and 3 skipped, all on one label track named "Narration Utils" |
| A7 | Mark `pass-2` reviewed | PASS: its label reads `[nu:pass-2 reviewed] …`, and the label count is unchanged |
| A8 | Go to `pass-3`'s label | PASS (Part B checks the selection) |
| A9 | Cursor to 3 s | PASS |
| A10 | Loop 3 to 7.5 s for 2 s (`PlayAtSpeedLooped`) | PASS (Part B checks that it looped at normal speed) |
| A11 | `Stop` | PASS: playback stops |
| A12 | Add the marker label "pass marker" at 10 s, twice | PASS: added once |
| A13 | `Export2` 1 to 6 s to `narration-utils\audacity\pass-chapter-01.wav` in the scratch folder | PASS: the file appears with audio in it |
| A14 | Write the reviewed labels to `narration-utils\audacity\reviewed-labels-01.txt` | PASS: one line, for `pass-2` |
| A15 | Ask for a `.CL` export (Audacity's external-program exporter) | PASS: refused by the app, nothing sent |

## Part B (by eye and ear, about five minutes)

Leave the scratch project open after Part A. Each run overwrites `audacity-pass-results.md`, so copy it aside first.

| Step | Do | Expected |
| --- | --- | --- |
| B1 | Look at the label track | One track, "Narration Utils", with five labels: `pass-0` to `pass-3` and "pass marker". `pass-2` reads "reviewed". No label shows `\` or a stray `"` |
| B2 | Run Part A again without closing the project | It stops at A3: "the open project is not empty". Nothing in the project changed |
| B3 | If Audacity can stay running with no project window (on Windows, closing the last window usually quits it; skip B3 then), run Part A | A1 fails quickly with "Audacity has no project open", not after a 5 s timeout ([audacity/audacity#11471](https://github.com/audacity/audacity/issues/11471)) |
| B4 | Open a new, empty project and a modal dialog (Edit > Preferences), then run Part A | Either A1 fails after about 5 s with "Audacity did not answer in time", or Audacity answers under the dialog. Record which. Then close the dialog and run Part A again on a new empty project: it passes. This is the reconnect check |
| B5 | Quit Audacity, then run Part A | A1 fails at once with "Audacity is not reachable" |

During B4's second run, watch the screen as it runs A8 to A10. You should see the selection jump to 8.25 to 9 s, the cursor move to 3 s, and a loop play between 3 and 7.5 s at normal pitch. Note anything else, such as Audacity asking to save or the tone playing sped up.

## What to paste into #510

Comment on #510, headed "Audacity 4 pass results", with:

- the results table from `audacity-pass-results.md`;
- one line per B step: as expected, or what happened instead;
- the Audacity version, and whether mod-script-pipe was enabled.

## What happens with the results

- **Everything passes:** a follow-up PR promotes `navigate` and `markers` from Experimental to Supported in `apps/desktop/internal/dawport/audacity/audacity.go`, records the pass in `docs/research/`, and updates [ADR 0355](../adr/0355-audacity-is-driven-over-its-scripting-pipe-built-from-the-published-spec-and-verified-by-the-owners-pass.md) to Accepted.
- **A step fails or behaves differently:** fix the client or adapter. Correct the fake (`apps/desktop/internal/audacitybridge/audacitybridgetest`) to match what Audacity really did, and add a test, as ADR 0066 does for REAPER. Then run the pass again.
- **A1 fails on Audacity 4:** nothing to fix. The owner's version decision on #510 (ADR 0355) decides whether to support Audacity 3.x now or wait for Audacity 4's script host.
