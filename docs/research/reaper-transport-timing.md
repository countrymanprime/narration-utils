# Research: what the REAPER-scripting community knows about `GetPlayState()`/`GetPlayPosition()` timing

**Status: done, 2026-09-27.** Standalone research (Refs #510), not a PRD phase. PR #693 (DAW port PRD Phase 9, merged) added `GetPlayState()`/`GetPlayPosition()` to the REAPER heartbeat (`narration_ui_bridge.lua`, [ADR 0305](../adr/0305-the-daw-heartbeat-carries-the-transport-and-is-sent-at-once-when-it-changes.md)) and left one item pending on #510 ([comment](https://github.com/countrymanprime/narration-utils/issues/510#issuecomment-5852148420)): confirm inside real REAPER that a Record/Stop/Play/Pause press flips the heartbeat within a defer cycle, and what `GetPlayPosition()` reports mid-recording. The Lua harness fakes `reaper`, so it can't prove either. This note does not fake that confirmation; it researches what the wider REAPER-scripting community already knows and documents, and gives an honest recommendation on how far that evidence goes.

## The two open questions

1. **Defer-cycle timing.** `narration_ui_bridge.lua`'s `heartbeat()` reads `reaper.GetPlayState()` once per `tick()`, and sends a `PROJECT_STATUS` line at once when the value differs from the last-sent one (`reachability_test.lua`: "a transport change sends a heartbeat at once, without waiting out the interval"). Does `GetPlayState()` itself reflect a Record/Stop/Pause transition by the very next defer tick, however that transition was triggered (REAPER's own transport buttons, a keyboard shortcut, a control surface) — or can it lag?
2. **`GetPlayPosition()` mid-recording.** `daw.Transport.Position` (`apps/desktop/internal/daw/reachability.go`) and ADR 0305 both assume `GetPlayPosition()` gives a live, moving value while recording, coarse only because the heartbeat is ~1.5s apart. Is that assumption right, or does `GetPlayPosition()` behave differently during Record than during Play?

## What it settles

| Question | Answer | Confidence | Bears on |
| --- | --- | --- | --- |
| Does `GetPlayState()` have its own propagation delay once REAPER's transport has actually changed? | No first-hand evidence of one. OSARA (a screen reader, where a stale read would misreport a narrator's own transport to them) reads `GetPlayState()` synchronously, in the same call stack, immediately after triggering the very command that changes it — no wait, no next-tick check | Medium-High — direct, on-point, from the project most exposed to this exact failure mode, but it exercises the *action-dispatch* path, not an externally-triggered one | Question 1, partially |
| How often does a Lua/external `defer()` loop actually tick? | "REAPER typically executes around 30 deferred calls per second" (reapy docs) — roughly one tick every 16–33 ms | High — an explicit, quantified, first-party statement from a project whose own bridge loop is structurally the same shape as `narration_ui_bridge.lua`'s | Question 1: bounds the worst case, doesn't confirm it |
| Is there any documented case of a REAPER transport-state *notification* being delayed? | Yes, one: OSARA's control-surface-based announcement of transport changes triggered by *other* control surfaces (PR #196) — its own author: "the notifications from the surface are sometimes delayed," which needed a 100ms rate-limit workaround | Medium — real and citable, but about REAPER's `SetPlayState` surface-callback push path, not a raw `GetPlayState()` poll | Question 1: the one real caveat found, not directly transferable |
| Does `GetPlayPosition()` move meaningfully while a recording is actually in progress? | Yes, per a real, citable bug report: a script that calls `GetPlayPosition()` while recording is still active gets the correct, moving position; the same call made just after `Main_OnCommand` (Stop) gets `0`, because the transport has already stopped by then | Medium-High — first-hand, specific, and about exactly this call during exactly this transport state | Question 2, directly |
| Does the SWS Extension document anything on point? | Nothing found. `GetPlayState()`/`GetPlayPosition()` are used across many SWS features, but no timing/reliability discussion or workaround was found in its issues, wiki entries, or reachable source | Low (absence, not a negative finding) | Neither, conclusively |
| What do the official ReaScript docs and the Cockos forum say? | Unknown — every host that would carry it was blocked (see [Method](#method)) | — | Neither |

## Method

Desk research only, from this cloud container: no REAPER, no Windows/macOS/Linux desktop session, nothing to press Record on. Research used:

- **`WebSearch`**, which returned synthesized, citation-backed results even where a direct fetch of the same host failed.
- **Direct fetches of GitHub-hosted content** (`raw.githubusercontent.com`, `github.com` file/PR pages) — reachable throughout, including a local `curl` download of OSARA's full `src/reaper_osara.cpp` (7,077 lines) so it could be `grep`ped directly rather than summarized piecemeal.
- **This repository's own PR #693, ADR 0305, `reachability.go` and `reachability_test.lua`**, to know exactly what claim needs supporting.

Research could **not** use, all returning `EGRESS_BLOCKED` from this session's network egress proxy (an organization-level policy denial, per `/root/.ccr/README.md`, not a transient failure):

- `www.reaper.fm` (the official ReaScript API docs)
- `forum.cockos.com` / `forums.cockos.com` (the ReaScript subforum — including the two threads WebSearch itself surfaced, "Defer() speed" and "ReaScript API - Set playback position")
- `wiki.cockos.com` (the CockosWiki API reference)
- `python-reapy.readthedocs.io` (reapy's own hosted docs — worked around by reading its `docs/source/*.rst` source directly from GitHub instead)
- `www.extremraym.com` and `reaperapidocs.vercel.app` (third-party ReaScript doc mirrors)

This is the same class of gap the Phase 8 spike for [input commands and pedals](../prds/input-commands-and-pedals.prd.md) hit on a different set of hosts (`webkit.org`, `learn.microsoft.com`, `caniuse.com`, `developer.mozilla.org`) — see [`web-midi-hid-webview-spike.md`](web-midi-hid-webview-spike.md#not-done-and-why). Every host that would have carried the single most authoritative source (REAPER's own documentation of `GetPlayState`/`GetPlayPosition`, and the forum threads where narrators and script authors discuss them directly) was unreachable, so this note's confidence rests on GitHub-hosted primary sources and `WebSearch` synthesis instead, at the confidence levels that supports — not asserted higher.

`api.github.com` was also unavailable for repositories outside this session's scope (`countrymanprime/narration-utils` only) — SWS's, OSARA's and reapy's own repos weren't attached via `add_repo`, since this is read-only research on public code, not a checkout to build or modify. Their raw file content and web (PR/issue) pages were fetched directly instead, which covered everything actually found below.

## Results

### `python-reapy` (RomeoDespres/reapy) — the defer-loop cadence, and a "buggy" `play_state` precedent

reapy is a Python wrapper that talks to a running REAPER through a Lua `defer()`-driven bridge script — the same shape as `narration_ui_bridge.lua` talking to the Go host, an external process polling REAPER's own state through a script REAPER runs in its own defer loop, not calling the native API in-process.

- **`docs/source/api_guide.rst`** (fetched directly from GitHub, since `python-reapy.readthedocs.io` was blocked), verbatim: "since external API calls are processed in a `defer` loop inside REAPER, there can only be around 30 to 60 of them per second," and later, "REAPER typically executes around 30 deferred calls per second." This is a direct, quantified answer to "how often does the mechanism our heartbeat depends on actually run" — about 1 tick every 16–33 ms — from a project with the same defer-loop shape, not a general claim about REAPER's audio engine or UI refresh rate.
- **`CHANGELOG.md`**, `0.5.0` (2019-11-23): "`Project.play_state` property. It was buggy and has been replaced by the four play states properties [`is_playing`, `is_paused`, `is_recording`, `is_stopped`]." The current implementation (`reapy/core/project/project.py`, read directly): `is_playing = bool(RPR.GetPlayStateEx(self.id) & 1)`, `is_paused = & 2`, `is_recording = & 4` — the identical bit layout ADR 0305 and `wire.go` use. No commit message or issue explaining *why* the old property was buggy could be found (the GitHub commit-history page for `CHANGELOG.md` doesn't go back far enough, and reapy's own issue tracker has no open or closed issue matching a search for it), so this is reported as a precedent that a bitmask/state-decoding property here has a real history of getting it wrong — worth double-checking `reachability.go`'s own bit math is right (it matches reapy's) — not as evidence about defer-cycle *timing* specifically. It doesn't settle question 1; it's a caution, not a citation for it.

### OSARA (jcsteh/osara) — synchronous `GetPlayState()` reads, and one documented delay in a different path

OSARA is the accessibility screen-reader extension for REAPER (canonical repo confirmed as `github.com/jcsteh/osara` — several forks exist under other usernames, but `jcsteh` is the original author's, has the active issue tracker, PRs, and the linked `osara.reaperaccessibility.com` docs site). It is the strongest source asked for, because a screen-reader user who presses Record has no visual cue at all if OSARA's own read of `GetPlayState()` lags — this is exactly the failure mode our defer-cycle question is about, just for a human instead of our host.

Downloaded `src/reaper_osara.cpp` directly (7,077 lines) and grepped it rather than relying on piecemeal summaries:

- **`cmdChangeTransportState()`** (around line 6223):
  ```cpp
  void cmdChangeTransportState(int command) {
      int before = GetPlayState();
      Main_OnCommand(command, 0);
      int after = GetPlayState();
      reportTransportState(before, after);
  }
  ```
  This calls `GetPlayState()` again in the very next line after `Main_OnCommand` runs the transport action (Play/Stop/Record/Pause), in the same synchronous call — no wait, no re-check on a later tick — and then announces the new state from that read. That `GetPlayState()` is trustworthy read *immediately* after the state-changing call, with zero propagation delay of its own, is about as direct as evidence gets for "the value itself isn't stale" — it just doesn't cover a transition our script didn't trigger.
- **`reportTransportState()`** (around line 2096) uses the identical bit semantics as ADR 0305: "REAPER play state bits: 1 = playing, 2 = paused, 4 = recording," with an explicit comment "Recording also sets the playing bit, so handle record before play" — the same fact ADR 0305 states as "`Playing` is the play bit alone, so it is also true while recording."
- **The gap this doesn't cover:** `cmdChangeTransportState` only fires for actions OSARA itself dispatches through REAPER's `hookcommand2`/`hookcommand` action-handling path (registered near the end of the file, with its own noted REAPER quirk: "actions triggered by user-defined actions don't trigger `hookcommand2` … IMO, this is a REAPER bug"). A transport change made by REAPER's own UI transport buttons, an OSC surface, or a hardware controller that doesn't go through that path isn't covered by this function at all.
- **[PR #196](https://github.com/jcsteh/osara/pull/196)**, "Implement a custom control surface to speak actions invoked by other surfaces, such as Komplete Kontrol": OSARA had to add a second mechanism — REAPER's `IReaperControlSurface`/`SetPlayState`-style push notification, registered via `plugin_register("csurf_inst", …)` — specifically because transport changes triggered by *other* control surfaces weren't caught by the action-hook path above. In review, the author (`jcsteh`) wrote: "Yes, I recall that the notifications from the surface are sometimes delayed. Honestly this code is too old to recall correctly, but I at least recall that I started with an implementation that solely relied on `isHandlingCommand`" — and the shipped fix adds a 100ms minimum interval between surface-driven announcements. This is the one real, citable, first-party admission of a REAPER transport-notification timing quirk found anywhere in this research. It is about a *different* API path than a raw `GetPlayState()` poll (REAPER's control-surface push callback, not a value read on a timer), so it doesn't directly contradict the synchronous-read evidence above — but it is concrete proof that REAPER's transport-change plumbing isn't uniformly instantaneous everywhere, which is exactly the kind of thing a Lua `defer()` heartbeat (a third mechanism, closer to reapy's shape than either of OSARA's two) could plausibly also be affected by, and which no source here directly rules out for that third mechanism.

### ReapOBS (Zesseth/ReapOBS) — `GetPlayPosition()` mid-recording, from a real bug report

**[Issue #10](https://github.com/Zesseth/ReapOBS/issues/10)**, "REC STOP marker is always placed at position 0.0": a script places a `REC START` marker (via `add_marker()`, which calls `GetPlayPosition()`) while a recording is already underway, and a `REC STOP` marker after calling `Main_OnCommand(1016)` (Transport: Stop). The start marker lands correctly; the stop marker always lands at `0.0`. The issue's own diagnosis: "`add_marker()` uses `reaper.GetPlayPosition()`, which returns 0 when the transport is no longer playing/recording," and "the start marker is unaffected because it is added while recording is still active." The fix direction given is to capture the position *before* issuing the stop command.

This is a small, narrow, but directly on-point finding for question 2: it's first-hand confirmation that `GetPlayPosition()` gives the correct, live, moving position while a recording is actually in progress (exactly what `daw.Transport.Position` needs from it), and that the failure mode is specific to reading it *after* the transport has already stopped — which is exactly why ADR 0305 already restricts `position` to being sent "only while playing or recording," and why `narration_ui_bridge.lua` reads it inside the same `heartbeat()` tick as `GetPlayState()`, never after a separate stop check. The existing design already avoids the one failure mode this source documents.

### SWS Extension (reaper-oss/sws) — checked, nothing on point found

Searched the SWS wiki, its GitHub issues (`GetPlayState`, "play state," "toolbar update delay," and related terms) and its README/changelog for anything about `GetPlayState`/`GetPlayPosition` timing or reliability. Found only unrelated toolbar-icon-refresh issues (e.g. [#35](https://github.com/reaper-oss/sws/issues/35), [#636](https://github.com/reaper-oss/sws/issues/636)), about toggle-action icon state on a toolbar button, not about transport-state polling. Could not browse SWS's C++ source tree directly (GitHub's code-search UI needs a browser session this container doesn't have, `api.github.com` isn't available for a repository outside this session's scope, and guessing plausible file names for its transport-related code — `Prefs/Playback.cpp`, `Misc/Playback.cpp`, etc. — only produced 404s). This is reported as **absence of evidence, not evidence of absence**: SWS almost certainly polls `GetPlayState()` somewhere for its own transport-aware features, but nothing citable about how or with what reliability was found from this container.

### Official ReaScript docs and the Cockos forum — blocked

Every host that would carry REAPER's own documentation of these two calls, or the forum threads where script authors have presumably discussed exactly this before, was `EGRESS_BLOCKED` (listed in [Method](#method)). `WebSearch` surfaced the existence of two on-point-sounding forum threads ("Defer() speed," "ReaScript API - Set playback position/Jump to position") but could not fetch their content, so nothing from them is cited here beyond the fact that they exist and their titles.

## Recommendation

**(b): the evidence meaningfully narrows the pending #510 item, but doesn't close it.**

What it settles, reasonably confidently:
- `GetPlayState()` has no propagation delay of its own once REAPER's transport has actually transitioned (OSARA's synchronous same-call-stack read), and the defer mechanism our heartbeat depends on ticks roughly 30–60 times a second (reapy) — so a defer-based read, whenever it next runs after any transition, should see the correct value within about one tick (16–33 ms), not the full 1.5 s interval. This matches what `narration_ui_bridge.lua`'s own "send at once on change" design already assumes.
- `GetPlayPosition()` genuinely reports a live, moving position while a recording is in progress (ReapOBS), and the one documented failure mode (reading it after the transport already stopped) is exactly the case ADR 0305 already designed around by gating `position` on playing-or-recording.

What it doesn't settle:
- No source here measures the specific case our heartbeat cares about most: a transport change the narrator triggers directly in REAPER's own UI or hardware, observed from a **`defer()`-polling Lua script** (not an action-hook callback, and not a `SetPlayState`-surface push). OSARA's synchronous-read evidence covers the action-hook path; its PR #196 caveat is about the surface-push path; reapy's cadence number is about the defer loop's *frequency*, not about whether an externally-triggered transition is visible on the very next tick. None of the three is `narration_ui_bridge.lua`'s exact access pattern, and the one clear negative signal found ("notifications from the surface are sometimes delayed," from the single project most likely to have hit this) means "REAPER's transport plumbing is always instantaneous" cannot be asserted as settled, even though nothing found contradicts it for a plain `GetPlayState()` poll specifically.
- Whether a **paused recording** (`GetPlayState()` returning `6`, i.e. bits 2+4) is something REAPER actually produces in practice — does pressing Pause while Recording really yield that value, or does REAPER refuse/ignore Pause during Record? — wasn't confirmed or contradicted by any source found. ADR 0305's "a paused recording counts as recording" clause rests on this.

This narrows the original pending item ("checking inside REAPER that `GetPlayState()` flips the heartbeat within a defer cycle on Record, Stop and Pause, and what `GetPlayPosition()` reports mid-recording") to something much smaller: a single, short, real-REAPER spot-check rather than an open-ended investigation. See [For #510](#for-510) below.

## Not done, and why

- **No real REAPER session.** This container has none; nothing here presses Record, Stop, Play or Pause and watches `events.log`. That confirmation is exactly what's left for the owner, scoped down below.
- **`www.reaper.fm`, `forum.cockos.com`/`forums.cockos.com`, `wiki.cockos.com`, `python-reapy.readthedocs.io`, `www.extremraym.com`, `reaperapidocs.vercel.app`** were all `EGRESS_BLOCKED` — see [Method](#method). The official API docs' own wording for `GetPlayState`/`GetPlayPosition`, and any forum discussion of exactly this timing question, could not be read directly.
- **SWS's C++ source tree** could not be browsed for its own transport-polling code (see the SWS Extension entry under [Results](#results)); this is a real gap, not a considered "nothing there."
- **No Proposed ADR from this note.** Nothing here reverses ADR 0305; it either supports its existing assumptions (the bit layout, the recording-gates-position rule) or leaves a narrower gap for the owner to close by hand.

## For #510

Proposed narrowing of the pending item on PR #693 (not closing it — that's the owner's call):

- [ ] On a copy of a project with an isolated `-cfgfile` (D3): press Record, Stop, Play and Pause once each, and confirm each appends a new `PROJECT_STATUS` line to `events.log` right away rather than waiting out the 1.5 s interval (a stopwatch/eyeball check is enough; the community evidence above makes "within one defer tick" the expected result, not an open question).
- [ ] While that recording is running, confirm the 7th field (`GetPlayPosition`) is visibly increasing across the ~1.5 s heartbeats, not stuck or reset (the community evidence above makes this the expected result too, but it costs nothing extra to glance at while already doing the above).
- [ ] Specifically check whether pressing Pause **while Recording** is even possible in REAPER, and if so, whether the heartbeat's 6th field then reads `6` (bits 2+4) as ADR 0305 assumes — this is the one part no community source addressed either way.

This comment has also been posted to #510 itself, proposing this same narrowing.

---

*Sources cited above:* [reapy `api_guide.rst`](https://github.com/RomeoDespres/reapy/blob/master/docs/source/api_guide.rst) · [reapy `CHANGELOG.md`](https://github.com/RomeoDespres/reapy/blob/master/CHANGELOG.md) · [reapy `project.py`](https://github.com/RomeoDespres/reapy/blob/master/reapy/core/project/project.py) · [OSARA `reaper_osara.cpp`](https://github.com/jcsteh/osara/blob/master/src/reaper_osara.cpp) · [OSARA PR #196](https://github.com/jcsteh/osara/pull/196) · [ReapOBS issue #10](https://github.com/Zesseth/ReapOBS/issues/10) · [SWS issue #35](https://github.com/reaper-oss/sws/issues/35) · [SWS issue #636](https://github.com/reaper-oss/sws/issues/636).
