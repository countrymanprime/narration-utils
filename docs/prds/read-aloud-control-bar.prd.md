# Read Aloud Control Bar: a Compact Media Bar That Never Scrolls Away, a Full-Height Reading Panel and an Aligned Resume Card

**Source:** owner report of 2026-09-24 on the Read aloud (teleprompter) dialog: "The reading panel key is in the middle of the right side instead of full modal height." "The 'Where you stopped' part is centred horizontally but not aligned with the main body of the text." "The configuration section is too large. Let's redesign that to be more like modern Slack/Teams communication bars mixed with multimedia bars, where you can mute/unmute (in this case we might play/pause), microphone settings to choose settings like how loud it is, which mic to use, or speakers so you can choose headphones vs speakers. And of course you can sync to the DAW, so you can start recording when you start playing the prompter." "We should not scroll the media controls out of view." Citations are `file:line` at `a62fcd6`. Nothing here is built yet.

**Sibling:** [Read Aloud Resume from the DAW](read-aloud-resume-from-daw.prd.md) (written in parallel, same day) owns what the "Where you stopped" card does: matching the DAW position to the script, its wording and confidence, and dismissing it once reading starts. This PRD owns only where that card sits in the layout, and says nothing about its content or behaviour. The two meet at three seams, agreed here: the `header` slot at the top of the text column that Phase 1 adds (the sibling's prompt and its "Checking where REAPER and your last reading are…" line render there), a start-point slot in the bar that Phase 3 adds (the sibling's RD9), and one read-only REAPER state command (the sibling's `chapter_track_state`, which Phase 6 here extends rather than duplicates).

## Problem Statement

- **The controls scroll away.** Before a session starts, the Microphone, Engine and Model fields and Start reading are one large card in the scrolling body of the dialog, so reading down the chapter to find a starting word takes the Start button out of view. The card only sticks to the top once a session runs.
- **The configuration is too big for what it does.** Four stacked fields fill the top of a full-screen dialog that exists to show text. Engine and model are set once per machine and rarely touched again; they take as much room as the microphone and the Start button, which are used every session.
- **It is not a media bar.** There is Start and Stop, but no pause, no live sign that the microphone hears anything, and no link to REAPER's transport. The narrator reads in the app and records in REAPER, so every take starts with two separate button presses in two programs and ends with two more.
- **Two layout defects.** The reading panel (Key, Flags, Notes, Story bible) starts halfway down the right side and is only as tall as its content, instead of a full-height column. The resume card is centred on the whole dialog while the text is centred on the column left of the panel, so the two are visibly off-axis.

## Evidence

**The dialog and its layout.**

- `ReadAloudDialog` renders `<Dialog size="full" actions={null}>` (`apps/ui/src/components/teleprompter/ReadAloudDialog.tsx:118`). The full size is fixed at `calc(100dvh - 2rem)` and only its body scrolls (`primitives/Dialog.tsx:100-110`, the body `min-h-0 flex-1 overflow-y-auto` at `:120-124`; [ADR 0094](../adr/0094-dialog-gains-a-full-size-variant-that-fills-the-viewport-with-a-margin.md)). The dialog already has a region that never scrolls: the action row, `flex-none` below the body (`Dialog.tsx:132-140`), unused here (`actions={null}`).
- **Why the resume card is off-axis.** The card is placed by the dialog, above and outside the reading layout: `<div className="mx-auto mb-4 max-w-3xl">` across the full body width (`ReadAloudDialog.tsx:120-124`). The text column is `mx-auto w-full max-w-3xl` (`ReadAlongView.tsx:44`) inside the first track of a two-column grid, `md:grid-cols-[minmax(0,1fr)_auto]`, whose second track is the rail (`ReadAlongView.tsx:173-178`). So the card is centred on the body and the text on the body minus the rail (`md:w-[19rem] lg:w-[20rem]`, `ReaderRail.tsx:63`) and the 1rem gap: at the 1440 px desktop viewport the two axes are about 170 px apart (half of 20rem + 1rem). With the rail hidden (a 2.5rem chevron column, `ReaderRail.tsx:46-55`) the offset shrinks but does not vanish.
- **Why the reading panel floats mid-height.** Three causes add up. (1) The rail is a sibling of the text column in the grid, and the grid starts *below* the resume card (`ReadAloudDialog.tsx:120-150`), so on open the panel's top edge is wherever the card ends. (2) The grid is `items-start` (`ReadAlongView.tsx:174`), so the rail is only as tall as its content; the Key tab is a short list. (3) Its height cap is tied to the window, not the dialog body: `md:sticky md:top-0 md:max-h-[calc(100dvh-8rem)] md:overflow-y-auto` (`ReaderRail.tsx:63`). Once scrolled it sticks at the top of the body, but at rest it sits below the card and ends mid-way, which is the screenshot the owner describes.
- **What scrolls and what sticks.** Everything in the dialog body scrolls: the resume card, the configuration card and the text. The configuration `Panel` is sticky only while a session is active: `className={t.active ? 'sticky top-0 z-10' : ''}` (`ReadAlongView.tsx:45`). While idle (every state the owner sees before pressing Start) it scrolls out with the text. The rail is sticky at `md` and above (`ReaderRail.tsx:48,63`). The tablet viewport (768 px) is exactly `md`, so the grid and the sticky rail apply there too.
- **The configuration card** (`ReadAlongView.tsx:47-117`), while idle: a two-column grid at `lg` beside the rail (`:49`) holding `MicrophoneField` (a full-width `Select` labelled Microphone with a text Refresh link, `MicrophoneField.tsx:70-89`; the Refresh link is a raw `<button>` under the ceiling in `apps/ui/src/rawNatives.test.ts:37`), the Engine `ToggleGroup` only when the host offers more than one engine (`ReadAlongView.tsx:59-65`; Moonshine is Windows-only, [ADR 0107](../adr/0107-moonshine-ships-inside-the-windows-teleprompter-sidecar-and-runs-only-from-a-verified-catalog-install.md)), the Model `ToggleGroup` Tiny/Small (`:66-75`), then a status line and Start reading (`:78-117`). While active the fields vanish and the same card shows status, "N of M words", "Heard: …", Follow and Stop (`:78-110`).
- **The standalone Teleprompter page shares the view.** `TeleprompterPage` mounts the same `ReadAlongView` without an `aside` and passes its chapter picker as `extraSetupFields` (`ReadAlongView.tsx:22,50`); it is retired by [Teleprompter Manuscript Integration](teleprompter-manuscript-integration.prd.md) Phase 13.
- **Popups inside this dialog.** The dialog layer is `z-[60]` (`Dialog.tsx:94-95`). The `Menu` primitive's popup is `z-[55]` (`primitives/Menu.tsx:44`), below the dialog, so a `Menu` opened inside Read aloud would draw behind it. Tooltips and info popovers are `z-[1000]` (`Tooltip.tsx:53,120`). There is no general `Popover` primitive (the primitives are listed in `apps/ui/src/components/primitives/`), and `Menu` items are actions only (`Menu.tsx:4-10`), with no radio or checkbox items.
- **Visual and aria coverage today.** Twenty-one `manuscript/read-aloud-*` rows (`apps/ui/tests/visual/state-catalog.ts:296-415`) and one aria snapshot, `dialog-read-aloud-resume.aria.yml` (`tests/aria/dialogs.spec.ts:22-26`), which pins the order resume region, `combobox "Microphone"`, the Start reading group, `region "Chapter text"`. Both change with this work ([ADR 0064](../adr/0064-the-visual-suite-runs-axe-on-every-app-state-and-a-violation-fails-unless-it-is-declared-debt.md), [ADR 0065](../adr/0065-aria-snapshots-pin-the-role-trees-of-the-dialogs-the-slide-over-and-the-navigation.md)).

**The settings the card exposes and where they live.**

- Microphone, engine and model are global settings under the `Teleprompter` tool: `input_device`, `engine`, `model` (`apps/desktop/app.go:1112-1116`), refused at project scope (`app.go:1210`). The UI reads them on mount and writes each choice at once (`useTeleprompterSession.ts:42-45,188-220,274-288`; catalog row `interactionFeedback.catalog.ts:349`), so a change in the dialog is what Settings shows. The rail's open state and tab and the flag-kind visibility are per-viewer `localStorage` preferences (`readerPreferences.ts`; `ReadAloudDialog.tsx:76-77`).

**What audio the app actually controls.**

- **Input devices come from the sidecar, not the webview.** `TeleprompterDevices` runs the sidecar's `--list-devices`, which lists Windows DirectShow (`dshow`) capture devices through PyAV's FFmpeg log (`sidecars/manuscript-teleprompter/core/devices.py:1-40`); capture opens the same name with `av.open(file=f"audio={device_name}", format="dshow")` (`live_asr.py:453`). Capture is Windows-only ([ADR 0022](../adr/0022-live-sidecar-events-over-wails-and-stop-file.md)). The picker is dropdown-only and never typed (`MicrophoneField.tsx:22-27`, the input-devices PRD's decision).
- **No level is measured anywhere.** The sidecar resamples 0.32 s chunks (`CHUNK_SECONDS`, `live_asr.py:132`) to 16 kHz mono and feeds them to the engine (`:444-471`); no RMS or peak is computed or emitted, and the event contract has no level event. `MeterBar` is a static segmented bar named as an image ([ADR 0050](../adr/0050-the-segmented-meter-is-an-image-named-by-its-segments-and-field-wires-its-hint-and-error.md)), not a live meter.
- **No gain control exists, and dshow offers none.** FFmpeg's dshow input has no input-gain option; the only gain on Windows is the endpoint's system-wide microphone level (Core Audio `IAudioEndpointVolume`), which changes the level for every program on the machine and does nothing for an ASIO device, which is how REAPER usually records. The app can therefore **meter** the microphone; it could apply a **software gain to what the recognizer hears** (a multiply before the engine); it should not set the system level.
- **The webview is not used for audio input.** No `getUserMedia` or `enumerateDevices` anywhere in `apps/ui/src`. If it were, Wails would grant it silently: its Windows frontend calls `chromium.SetGlobalPermission(edge.CoreWebView2PermissionStateAllow)` (`wailsapp/wails/v2@v2.16.0 internal/frontend/desktop/windows/frontend.go:612`), so every WebView2 permission, microphone included, is allowed with no prompt. The threat model does not record this (`docs/architecture/threat-model.md`, row 3 and table 4 have no permission row). Webview device labels are WASAPI endpoint names and do not always equal dshow names (dshow's WaveIn-derived names can be truncated), so a meter from the webview can measure a different string than the one the sidecar opens.
- **Nothing plays in this dialog.** The app plays audio elsewhere through `HTMLAudioElement` (`components/tracks/useRangePlayer.ts:25`, `useTrackPlayback.ts:17`, `components/storybible/usePreviewAudio.ts:140`), always on the default output; there is no `setSinkId` anywhere. The rail shows pronunciations as IPA text only (`manuscript/EntitySummary.tsx:64`). So there is no output in Read aloud to route; "headphones vs speakers" while recording is REAPER's monitoring, which the app does not touch.

**Pause, stop and seek.**

- The session has `start`, `stop` and `seek` only (`useTeleprompterSession.ts:247-265`). Stop is a stop file (ADR 0022); seek is a line in a tailed control file, `{"cmd":"seek","word":N}` (`control_channel.py:1-20`, polled once per chunk in `live_asr.py:637-675`; [ADR 0104](../adr/0104-seek-reaches-a-running-teleprompter-session-through-a-tailed-control-file.md)). A session can start at a word (`startWord`, `useTeleprompterSession.ts:129,251`). There is no pause: ending a session keeps its flags as findings ([ADR 0117](../adr/0117-live-flags-are-kept-as-suspected-findings-merged-per-chapter-when-a-session-ends.md), `ReadAloudDialog.tsx:84-91`) and a restart reloads the model.
- The tracker already has a notion of the narrator pausing (status `waiting` after 1.5 s without progress, [ADR 0033](../adr/0033-the-teleprompter-follows-speech-with-continuous-alignment-and-pause-resume.md)), and a session stops itself five seconds after `done` ([ADR 0106](../adr/0106-a-teleprompter-session-stops-itself-five-seconds-after-the-tracker-reports-done.md)).
- **Keys:** Space is one of the scroll keys that pause following ([ADR 0119](../adr/0119-a-hand-scroll-pauses-following-until-the-current-word-is-back-in-the-band.md) decision 2; `useFollowCursor.ts:12`), unless something already handled it (`isScrollKey` returns false on `defaultPrevented`, `:59-60`). The follow band is measured against `window.innerHeight` (`useFollowCursor.ts:47,54`), not the scroll container, and the current word is centred with `scrollIntoView` (`:55`).

**REAPER transport over the bridge.**

- **The app already plays and stops REAPER, never records.** `loop_context` sets a loop and calls `reaper.OnPlayButton()` (`integrations/reaper/narration_navigation.lua:202-257`, `:254`); `stop_loop` calls `OnStopButton()` only when playing and not recording (`:259-272`). Every navigation command refuses while REAPER is recording ("REAPER is recording. Stop recording first.", `:134,214,293`). The play state is read from `GetPlayState()` bits 1/2/4 (`:105-112`) and reported in `PONG` (`:325`; `apps/desktop/internal/bridge/wire.go:89`). [ADR 0121](../adr/0121-going-to-and-looping-a-finding-is-by-guid-and-source-time-makes-no-undo-point-and-stop-restores-what-the-loop-changed.md) records why these make no undo point; threat-model rows 5d and 5f cover a forged or unasked transport command.
- **No bridge command records, arms or reads the armed track live.** The registered commands are the ones in `narration_*.lua` (`registry.register` in `narration_navigation.lua:330-342`, `narration_pickups.lua:235-247`, and the rest); `1013` (Transport: Record) appears only in a spike's action list (`spikes/spike_s5_render.lua:73`). The armed track is read only from the *saved* `.rpp` (`REC`, [ADR 0113](../adr/0113-the-teleprompter-suggests-a-chapter-from-the-saved-armed-track-and-preselects-only-a-confident-match.md)).
- **Recording was ruled out before, for punch.** [Teleprompter Manuscript Integration](teleprompter-manuscript-integration.prd.md) lists "Record arm, transport control" under What We're NOT Building (`:55`), "Arm/record" as Won't (`:145`), and "First punch scope: cursor plus pre-roll only; smallest safe mutation" (`:314`). The owner's request here is a new, explicit ask for record-with-reading; it reopens that line for this feature only (Decisions Log).
- **Planned work next to this.** That PRD's Phase 11 adds a read-only Lua `chapter_track_state` and "identify the microphone REAPER uses" (`:208,268-271`); its Phase 12 adds a play-position command and `punch_to` (`:209,273-276`). [REAPER Automation Follow-Through](reaper-automation-follow-through.prd.md) D3 approves REAPER spikes only on copies with an isolated `-cfgfile`, and its spikes are written so that "no script plays or records" (`spikes/navigation_check.lua:7`); S4 (play-position, Phase 15) needs audio hardware and the owner. "Transport" in that PRD's phases 18-21 means the channel (web/OSC vs files), not play/record.
- **Availability** is read from the bridge heartbeat, never asked of REAPER on a timer (`FindingsReaperStatus`, `apps/desktop/bindings_navigation.go:105-107`; [ADR 0122](../adr/0122-the-review-page-asks-reaper-only-on-a-click-and-only-while-it-answers-and-a-refusal-is-an-answer.md)). A bridge answer waits at most 3 s (`internal/bridge/navigation.go:31`). A new event goes in the table in `wire.go`; a new command gets harness tests first ([ADR 0066](../adr/0066-the-lua-bridge-is-tested-by-a-harness-under-lua-5-4-and-reaper-api-behaviour-is-checked-in-reaper.md), [ADR 0067](../adr/0067-bridge-commands-are-registered-by-name-and-each-feature-lives-in-its-own-lua-file.md)).
- `hostAPIVersion` is 47 (`apps/desktop/app.go:52`); the highest ADR is 0170, so 0171 is next at this commit (sibling PRDs drafted today may claim it first).

## Proposed Solution

1. **Layout fixes (UI only).** The reading panel becomes a full-height column: the rail's grid track starts at the top of the dialog body and the rail fills the body's height and scrolls on its own. The resume card moves inside the text column, so it shares the text's `max-w-3xl` axis whether the rail is open or hidden. (This PRD moves the card's container only; what the card does is the sibling PRD's.)
2. **A control bar that never scrolls.** The configuration card is replaced by one compact bar, 48-56 px tall, in a region of the dialog outside the scrolling body, so it is visible in every state, idle or reading. Left to right (bottom placement recommended, Q1):
   - **Play / Pause** (the primary button; Play is today's Start reading) and **Stop**;
   - **status** ("Ready", "Listening", "Paused", "Waiting for you…", "Stopping…") with "N of M words", and "Heard: …" truncated;
   - a **start point** chip while idle, filled by the sibling PRD ("Starts at '…the door opened'" with a clear button, its RD9), empty when reading starts from the top;
   - **Follow** (only while following is paused, as today);
   - **Microphone**: a button showing the device name and a live **input level meter**; it opens a popover with the device list, Refresh, the meter at a larger size and, if the owner wants it, a recognizer gain (Q5);
   - **REAPER**: a "Record in REAPER" toggle with a clear state: *off*, *ready (Chapter 3 armed)*, *● Recording*, or *can't record (why)*;
   - **Settings** (gear): a popover with Engine and Model (Q2).
3. **Pause** that keeps the session: the sidecar stops feeding the recognizer and the tracker holds its place until Play; flags are not kept on a pause, only on Stop (Q3).
4. **Record in REAPER with reading.** With the toggle on, Play asks REAPER to record first and starts listening once REAPER says it is recording; Stop stops both. It records only when the one armed track is the chapter's linked track, asks once per project before the first time, never arms or disarms without a click, and never touches a recording it did not start (Q6 to Q9).

No output (speaker) picker, because nothing plays in this dialog (Q4).

## Key Hypothesis

We believe a single always-visible bar with Play/Pause, a microphone with a live level, and a "Record in REAPER" toggle will let the narrator start and stop a take with one press, check their microphone before speaking, and never lose the controls while scrolling, and that a full-height panel and an aligned resume card will make the dialog read as one layout. We'll know we're right when the owner starts a recorded take from the app alone, the bar is in view in every captured state at every viewport, and the resume card and text share one left edge.

## What We're NOT Building

- **The resume card's behaviour or content**: DAW position matching, confidence, wording, dismissing it once reading starts. That is [Read Aloud Resume from the DAW](read-aloud-resume-from-daw.prd.md). This PRD moves its container only.
- **An output device picker** (Q4). Nothing plays in Read aloud; REAPER owns monitoring.
- **Setting the system microphone level** (Windows endpoint volume). It is machine-wide and does not reach REAPER's ASIO input.
- **Arming, disarming or creating tracks on the narrator's behalf** without a click (Q7), **punch-in**, **time-selection auto-punch**, **pre-roll or count-in**. Punch remains [Teleprompter Manuscript Integration](teleprompter-manuscript-integration.prd.md) Phase 12.
- **Recording in the app itself** (that is [Native Recording Suite](native-recording-suite.prd.md)); the app never writes audio.
- **A web/OSC transport** to REAPER; the file bridge's latency (one defer tick plus the host's poll) is acceptable for a record start the narrator waits on.
- **A general redesign of the standalone Teleprompter page**; it gets the same bar only because it shares `ReadAlongView` (Q11), and it is retired by Phase 13 of the integration PRD.
- **New reading behaviour**: follow, flags, marks, seek and auto-stop at Done are unchanged.

## Success Metrics

| Metric | Target | How measured |
| --- | --- | --- |
| Controls never scroll away | Play/Stop, microphone and REAPER toggle are inside the visible dialog in every `read-aloud-*` state at every viewport, idle and active, scrolled to the end of the text | A visual-suite driver that scrolls the body to the bottom before capture on a new row; a Vitest that the bar is outside the scrolling body |
| Bar is compact | One row at desktop and small-desktop, at most two at tablet, no collapsed control (ADR 0060) and no sideways overflow at reflow | Visual suite at every viewport plus reflow |
| Reading panel is full height | The rail's top equals the body's content top and its bottom the body's bottom at `md` and above, with the resume card present | Vitest on layout classes; PNGs at desktop, small-desktop, tablet |
| Resume card aligned | The card's left and right edges equal the text column's (±1 px), rail open and hidden | A Playwright bounding-box assertion in the driver; PNGs |
| Level meter is live | The meter moves within 0.5 s of sound and rests near the floor in silence, on the device the sidecar opens | Sidecar unit test on synthetic chunks; mock level stream in the visual suite; owner-pending check with a real microphone |
| Pause keeps the place | Pause then Play resumes at the same word, keeps flags un-saved until Stop, and reloads no model | Sidecar and Go service tests; `ReadAloudDialog` test |
| Record in REAPER is safe | Never records when the armed set is not exactly the chapter's linked track, when REAPER is already recording, or when the bridge is down; the first use in a project asks first; Stop stops only a recording the app started | Lua harness tests for every refusal; Go tests; UI tests; scripted REAPER run on a copy (API behaviour); owner-pending real take |
| One press per take | With the toggle on, Play starts REAPER recording and listening; Stop ends both | Owner run in their REAPER, recorded in the verification note |
| Gate | `pnpm check`, visual suite (axe included), `pnpm --dir apps/ui run aria`, the atlas for the new primitive | `full-verification-gate` |

## Open Questions

- [x] **Q1. Where is the bar?** Options: (A) **bottom**, in a non-scrolling footer region of the dialog (like a media player or a Teams call bar); (B) **top**, directly under the dialog title, above the resume card and the text; (C) sticky inside the scrolling body (top or bottom). Recommendation: A. The reader's eyes sit in the 25%-70% follow band, the resume card stays at the top of the text where the sibling PRD puts it, and a region outside the scroll container never overlaps a word, never runs the scrollbar under it and needs no `scroll-padding`. C is the smallest code change but the sticky element overlaps text and fights the follow band's `window.innerHeight` arithmetic (`useFollowCursor.ts:47`). With A, the sibling PRD's status line ("under the control bar" in its user flow) sits at the top of the text column in the Phase 1 `header` slot instead; with B it sits directly under the bar. **Answered (owner, 2026-09-24, D39):** the recommendation.
- [x] **Q2. What lives in the bar and what goes in a popover?** Recommendation: in the bar, Play/Pause, Stop, status and word count, Follow (when paused), the microphone button with its meter, the REAPER toggle, and a gear. In the microphone popover: device list, Refresh, a larger meter, gain if Q5 says yes. In the gear popover: Engine (only when the host offers more than one) and Model, each with its caption, and a "More in Settings" link. The flag-kind visibility stays in the rail's Flags tab. Engine and Model are locked while a session runs (as today, where they are hidden). **Answered (owner, 2026-09-24, D39):** the recommendation.
- [x] **Q3. What do Play/Pause and "mute" mean here?** Options: (A) **Play** starts (or resumes) listening; **Pause** keeps the session alive but ignores audio: the sidecar stops feeding the recognizer, the tracker holds its word and does not report `waiting`, the status says "Paused"; **Stop** ends the session and keeps its flags; no separate mute; (B) Pause is Stop plus "resume at the current word" through `startWord` (no sidecar change, but each pause ends a session, keeps its flags and reloads the model, a few seconds); (C) no pause, Play/Stop only, plus a mute toggle that is the same as A's pause. Recommendation: A. A mute that leaves the session running is A's pause under another name; one control is clearer. **Answered (owner, 2026-09-24, D39):** the recommendation.
- [x] **Q4. Output device (speakers or headphones)?** Options: (A) none until something plays in Read aloud; (B) a Speakers picker now through `HTMLMediaElement.setSinkId` for future playback (a pronunciation play button in the rail, a start cue); (C) one app-wide output device in Settings for every player. Recommendation: A, and say in the guide that monitoring (what the narrator hears while recording) is set in REAPER. If a start cue or pronunciation audio is wanted later, C is the right home. **Answered (owner, 2026-09-24, D39):** the recommendation.
- [x] **Q5. Input level: meter only, or gain too?** Options: (A) a meter only; (B) a meter plus a "recognizer gain" slider that multiplies what the recognizer hears (helps a quiet microphone be tracked; does not change what REAPER records, and the label must say so); (C) set the Windows microphone level (system-wide, no effect on ASIO). Recommendation: A first; B only if the owner reports quiet-mic tracking misses. C is out (What We're NOT Building). **Answered (owner, 2026-09-24, D37):** A, a meter only.
- [x] **Q6. Where does the meter's level come from?** Options: (A) **the sidecar**: a `level` event per chunk (peak and RMS in dBFS) during a session, plus a short **meter-only mode** (`--meter`, no model, no recognizer) the popover runs while open before Start, so the narrator can check the microphone first; (B) **the webview**: `getUserMedia` plus an `AnalyserNode` on the device with the matching label; no sidecar change, but the name may not match the dshow device and it opens the microphone through a path that Wails grants silently (Evidence); (C) the sidecar during a session only, nothing before Start. Recommendation: A. It measures exactly what the recognizer hears, on the name the sidecar opens, and adds no new microphone path. The meter-only mode is released when the popover closes and never runs during a session. **Answered (owner, 2026-09-24, D39):** the recommendation.
- [x] **Q7. Record in REAPER: which track counts as right?** Options: (A) record only when **exactly one** track is armed and it is the chapter's linked track (the Tracks page's link, confirmed or accepted from auto-sync); otherwise the toggle says why ("Chapter 3's track is not armed", "2 tracks are armed", "This chapter has no linked track") and offers **Arm Chapter 3 only**, which arms it and disarms the others after a click; (B) the app arms the linked track itself when Play is pressed; (C) record whatever is armed, after showing its names once. Recommendation: A. It is the one rule that cannot record a chapter onto another chapter's track, and the arm change is a visible, clicked action (REAPER's arm is not in its undo history, so an unasked change could not be undone). **Answered (owner, 2026-09-24, D28):** record on the chapter's linked track, and arming it disarms every other track first and restores them when a recording the app started stops (see the Decisions Log).
- [x] **Q8. What do Stop, Pause and the auto-stop at Done do to REAPER?** Options for **Stop**: (A) stop REAPER's recording, but only one the app started (the bridge remembers the run); (B) leave REAPER recording. For **Pause**: (A) stop REAPER's recording too, so Play starts a new take; (B) REAPER's own record-pause, continuing the same item; (C) keep REAPER recording through the pause. For **auto-stop at Done** (five seconds after the last word, ADR 0106): (A) stop REAPER too, after the same five seconds; (B) keep REAPER recording until the narrator presses Stop. Recommendation: Stop A, Pause A (a paused take is a take boundary, the behaviour of REAPER's pause while recording is to be checked in the scripted run first), Done B, with the bar saying "Reading finished. REAPER is still recording" and Stop highlighted, so a tail of room tone or an ad-lib is never cut off. **Answered (owner, 2026-09-24, D28/D39):** the recommendation; the app only ever stops a recording it started.
- [x] **Q9. The toggle's default and memory, and the first-time confirm.** Options: (A) off by default, remembered **per project**, and the first time it is turned on in a project a confirm names the track it will record on and what Stop does; (B) off by default, remembered globally (a machine fact, like the microphone); (C) on by default when the bridge is connected. Recommendation: A; B would carry the choice into a project that has no REAPER link. The per-project flag goes in the project's manifest or project-scope settings (Technical Approach). **Answered (owner, 2026-09-24, D28):** A, off by default, per project, a confirm the first time.
- [x] **Q10. Keyboard shortcuts.** Options: (A) **Space** toggles Play/Pause when focus is not in a field, button, tab or other widget (it then no longer scrolls or pauses following, amending ADR 0119 decision 2), and **Esc** keeps closing the dialog (asking first while listening, as today); (B) **Ctrl+Space** or **K** (the video-player key) for Play/Pause, leaving Space as a scroll key; (C) no shortcuts. Recommendation: A, since a narrator with hands off the mouse expects Space; and **R** for the REAPER toggle is not recommended (too easy to hit while reading). Whatever is chosen shows in the buttons' tooltips. **Answered (owner, 2026-09-24, D39):** the recommendation.
- [x] **Q11. The standalone Teleprompter page.** Options: (A) the bar replaces the card on both surfaces (one `ReadAlongView`), with the page's chapter picker left above it and the REAPER toggle there too; (B) the bar in the dialog only, the page keeps the old card until it is retired. Recommendation: A without the REAPER toggle on the page (it has no fixed chapter until chosen; it gains it for free once the page is retired). B keeps two layouts of the same controls alive and doubles the visual rows. **Answered (owner, 2026-09-24, D39):** the recommendation.
- [x] **Q12. Narrow widths.** At tablet (768 px) and the 390 px reflow width (a desktop at high zoom, see [App Navigation and Zoom Controls](app-navigation-and-zoom-controls.prd.md)) the bar cannot fit labels. Options: (A) icons with accessible names and tooltips below `lg`, the status on its own line above the buttons; (B) a "More" popover for the REAPER toggle and the gear below `md`. Recommendation: A, and B only if the reflow capture still overflows. **Answered (owner, 2026-09-24, D39):** the recommendation.

## Users & Context

The narrator, recording a chapter at a desk with REAPER open beside the app (or on a second screen), wearing headphones monitored through REAPER. They open Read aloud from a chapter header, glance at where they stopped, check the microphone is live, press one button to start reading and recording, read for five to forty minutes with their hands mostly off the mouse, pause for a drink, and stop at the end. They scroll ahead or back to look at a passage and expect the controls to stay where they are. They need to trust that the app never records onto the wrong chapter and never leaves REAPER recording by surprise.

## Solution Detail

| Priority | Capability | Phase |
| --- | --- | --- |
| Must | Reading panel a full-height column; resume card in the text column, on the text's axis | 1 |
| Must | A `Popover` primitive that layers above a dialog (story, atlas, ADR) | 2 |
| Must | The control bar, outside the scrolling body, replacing the configuration card: Play (Start), Stop, status, word count, Follow, microphone button and popover (device, Refresh), gear popover (engine, model) (Q1, Q2, Q11, Q12) | 3 |
| Must | Keyboard shortcut for Play/Pause (Q10) | 3 |
| Should | Live input level: sidecar `level` events in a session and a meter-only mode before Start (Q6) | 4 |
| Should | Pause/resume that keeps the session (Q3) | 5 |
| Should | Read REAPER's live transport and armed tracks over the bridge, shown in the bar | 6 |
| Should | Record in REAPER with reading: guarded record start and stop, first-time confirm, per-project toggle (Q7, Q8, Q9) | 7 |
| Could | Recognizer gain in the microphone popover (Q5 B) | after 4 |
| Could | "Arm Chapter N only" button (part of Q7 A) | 7 |
| Won't | Output device picker (Q4 A), system microphone level, arming without a click, punch, count-in, web/OSC transport | - |

**MVP scope:** Phases 1 to 3 answer three of the owner's four points (panel height, resume alignment, a compact bar that never scrolls). Phases 4 to 7 add the media-bar and DAW behaviour; 6 and 7 carry the most risk and the REAPER checks.

**User flow (recommended answers).** The narrator opens Read aloud on Chapter 3. The text column starts with the resume card (the sibling PRD's content), left-aligned with the text; the reading panel fills the right side from top to bottom. At the bottom is one bar: `[▶ Play] [■]  Ready · 0 of 4,212 words  …  [🎙 Shure MV7 ▮▮▮▯▯] [⏺ Record in REAPER: Chapter 3 armed] [⚙]`. They click the microphone button; the popover shows the device list and a meter that moves as they speak (meter-only mode). They turn on Record in REAPER; the first time, a confirm says "Play will start recording in REAPER on track 'Ch 3' and Stop will stop it. Nothing is recorded on any other track." They press Play (or Space): the toggle shows "● Recording", then the status "Listening". They scroll ahead to check a name; the bar does not move. They press Pause: REAPER stops, the status says "Paused at word 1,204". They press Play: REAPER records a new take and listening resumes at word 1,204. At the end the reader finishes; the bar says "Reading finished. REAPER is still recording" and they press Stop.

**Bar anatomy and names.** A `toolbar` named "Reading controls" (arrow keys move between its buttons). Play is a toggle button, `aria-pressed` false/true, named "Play" and "Pause" by state; Stop is "Stop reading". The meter is `role="meter"` named "Input level" with its dBFS value as `aria-valuetext`, throttled so a screen reader is not flooded; it is decorative-only (`aria-hidden`) in the bar button, whose name is "Microphone: Shure MV7". The REAPER toggle is a switch-like button named "Record in REAPER", with its state in the visible text and `aria-describedby` for the reason when disabled. The status keeps `role="status"`.

## Technical Approach

**Feasibility.** Phases 1 to 3 are UI only (plus one primitive). Phase 4 is a sidecar event and mode, a Go service method, a binding and a wire contract. Phase 5 is a control-channel command. Phases 6 and 7 are new Lua commands, a Go bridge client, bindings and a threat-model change. Everything reuses existing channels: the stop and control files, Wails events, and the file bridge.

**Layout (Phase 1).** Move the resume card from `ReadAloudDialog` into `ReadAlongView`'s main column through a new `header` slot (rendered first in the `max-w-3xl` column), so it shares the text's axis with the rail open or hidden. Make the rail's grid track full-height: the reading layout becomes `h-full` in the body, the grid `md:items-stretch` with the rail `md:h-full md:overflow-y-auto` (dropping the `100dvh-8rem` cap), and the text column scrolls in its own region or the body scrolls with the rail sticky at `top-0` and `height: 100%` of the body's viewport. Pick the one that keeps `useFollowCursor`'s scroll root (the nearest `overflow-y: auto` ancestor, `useFollowCursor.ts:78-84`) and its manual-scroll detection working; its tests cover both. In credits mode ([Manuscript Credits Card Parity](manuscript-credits-card-parity.prd.md) Phase 2, no resume card) the slot is empty and nothing shifts.

**Popover primitive (Phase 2).** `primitives/Popover.tsx` wrapping Base UI's Popover ([ADR 0047](../adr/0047-the-ui-primitives-wrap-base-ui-and-app-code-never-imports-it.md)): a trigger, a labelled popup with focus moved in and returned, Escape closing the popover before the dialog (the dialog already cancels Escape when a hint is open, `Dialog.tsx:88-89`; the same check must cover this popover), positioned above the dialog layer (`z-[70]`, between the dialogs and hints), and collision-aware. It brings `Popover.stories.tsx` (inside a `Dialog` too), atlas coverage in light and dark at both widths, `design-spec-guard`, a row in `docs/design/design-system.md`, and an ADR. Fix `Menu`'s `z-[55]` in the same phase only if a Menu is needed inside a dialog (not planned here).

**Control bar (Phase 3).** A new `ReadingControlBar` in `components/teleprompter/`, built from `Button`, `IconButton`, `Select` (inside the microphone popover), `ToggleGroup` (inside the gear popover), `TooltipTarget` and `Popover`; no raw native control (the ceilings in `rawNatives.test.ts`; `MicrophoneField`'s raw Refresh link becomes a `Button` variant and its ceiling drops to 0). `ReadAlongView` stops rendering the configuration `Panel`; the bar receives the session. Placement per Q1 A: `Dialog` gains a `footer` slot (a `flex-none` region between body and actions, or `actions` extended to take a full-width node with `actionsAlign`), which is a primitive change: an amendment of ADR 0094 in the Phase 2 or 3 ADR, a story, and `design-spec-guard`. On the standalone page (Q11 A) the bar renders at the bottom of the page's own column as `sticky bottom-0` (the page has no dialog footer). Space for Play/Pause (Q10 A) is a `keydown` on the dialog popup that ignores events from editable elements, buttons, tabs and roles in `KEY_WIDGET_ROLES` and calls `preventDefault`, so `isScrollKey` (which already skips a prevented event, `useFollowCursor.ts:59-60`) does not pause following; ADR 0119 is amended by the phase's ADR. `startReason` tooltips stay on Play.

**Input level (Phase 4).**
- Sidecar: after resampling, each chunk's peak and RMS in dBFS go out as `{"type":"level","peak":-12.3,"rms":-24.1}` at most every chunk (0.32 s is too coarse for a meter; split the computation to about 50 ms windows inside the chunk and send the maximum over each 100 ms, so about 10 events per second). A `--meter` mode opens the device and emits only `level` events, with no model and no `--script`, and ends on the stop file. Tests on synthetic chunks (silence, a sine at a known level, clipping).
- Go: `teleprompter.Service` relays `level` like any event (ADR 0022) during a session. A second, separate child for meter mode: `TeleprompterMeterStart(device)` and `TeleprompterMeterStop()` bindings, refused while a session runs, stopped when a session starts, when the popover closes and on shutdown; at most one meter child. `hostAPIVersion` to the value on `main` + 1 (serialization point; 54 when delivered), `hostrace_test.go` row if it reads services.
- **Wire contract** (`CLAUDE.md`): the `level` event in `apps/ui/src/api/contracts/teleprompter.ts` and a Zod schema in `api/schemas/`, a golden payload written by a Python test into `tests/fixtures/contracts/` (`UPDATE_CONTRACTS=1`), a row in `api/wireContracts.test.ts`, the mock stream (`teleprompterMock.ts`) emitting levels, and a `?mockLevel=` for a still capture. The meter in the UI smooths with a peak-hold and respects reduced motion (no animated fall).
- The level events are **not** reduced into the session model (`readerModel.ts`), only into a small `useInputLevel` hook, so a burst of events does not re-render the rows.

**Pause (Phase 5).** A `{"cmd":"pause"}` / `{"cmd":"resume"}` pair on the existing control channel (`control_channel.py`, ADR 0104's mechanism): while paused, `live_asr.py` drains and discards chunks (the device stays open, so resume is instant), the tracker's clock is frozen so it does not report `waiting`, and the host's state gains `paused` (phase or flag, decided in the ADR). `TeleprompterPause(paused bool)` binding, host API bump, contract and mock. The dialog does not keep flags on pause, only on Stop (ADR 0117 unchanged). Auto-stop at Done is not armed while paused.

**REAPER state (Phase 6).** One read-only command serves the sibling's resume work, Integration Phase 11 and this bar: `chapter_track_state` in `integrations/reaper/narration_track_state.lua`, as [Read Aloud Resume from the DAW](read-aloud-resume-from-daw.prd.md) Phase 4 specifies it (`TRACK_STATE|run|guid|playState|editCursor|playPosition|rpp|unsaved`, then its items). This phase adds what the bar needs to it: whether the named track is armed and how many tracks are armed in all (fields on `TRACK_STATE`, or a `TRACK_ARMED|run|armedCount|thisArmed` line; the bit `playState & 4` already says recording). If the sibling's Phase 4 has not landed, this phase builds the command to that spec with the armed fields, and the sibling rebases onto it. **Harness tests first** (none, one or several armed; the named track armed or not; recording), mutation checks, and the `wire.go` row. Go: a `ReadAloudReaperState(chapterId)` binding over the same bridge client the sibling adds, comparing the armed set with the chapter's linked track (`internal/tracks` mapping, [ADR 0100](../adr/0100-analysis-evidence-is-two-hash-keys-one-ledger-record-per-run-and-a-narrator-confirmed-track-map.md)) and answering `ready`, `not_armed`, `other_armed`, `several_armed`, `no_link`, `recording_elsewhere` or `unavailable`. It asks REAPER only when the dialog opens, when the toggle is turned on, before Play, and on a Refresh press, never on a timer (ADR 0122); availability comes from the heartbeat first. Wire: a Zod schema and golden payload for the binding result, `wireContracts.test.ts`, the mock.

**Record with reading (Phase 7).**
- Lua in a new `narration_transport.lua` (the write side, kept apart from the read-only state file; listed in `FEATURE_FILES`, `scripts/release/reaper-files.mjs` and `apps/desktop/smoke.go`'s `smokeReaperFiles`): `record_start(run, trackGuid)` refuses unless REAPER is stopped (not playing, not recording), exactly one track is armed and its GUID is `trackGuid`; then it runs Transport: Record (`CSurf_OnRecord` or `Main_OnCommand(1013, 0)`, whichever the scripted run shows respects the project's record mode) and answers `RECORD_STARTED|run|position` after `GetPlayState()` reports bit 4, else `ERROR`. It remembers the run in the bridge state. `record_stop(run)` stops only if REAPER is recording **and** the recording is the one this bridge started (else `RECORD_NOT_OURS`), with `OnStopButton()` (which follows REAPER's own "prompt to save recorded media" preference; the app never answers that prompt). `arm_only(run, trackGuid)` (Q7 A's button) sets `I_RECARM` 1 on that track and 0 on the rest, refusing while recording. Harness tests first for every accept and refusal; mutation checks; `wire.go` rows for `RECORD_STARTED`, `RECORD_STOPPED`, `RECORD_NOT_OURS`, `ARMED`.
- Go: bindings `ReadAloudRecordStart(chapterId)`, `ReadAloudRecordStop()`, `ReadAloudArmOnly(chapterId)`, sent only from a click (or the Space shortcut on Play), with the track GUID taken from the host's mapping, never from the UI. Play with the toggle on: record start, wait for `RECORD_STARTED` (3 s timeout; on a refusal or timeout nothing starts listening and the bar says why), then `TeleprompterStart`. Stop: `TeleprompterStop` then `ReadAloudRecordStop`. Closing the dialog while recording uses the existing "Stop reading?" confirm with the text extended ("… and stops REAPER's recording"), and the host stops a recording it started when the app shuts down.
- Per-project toggle and first-time confirm (Q9 A): a project-scope setting (a new `ReadAloud` tool with `record_in_reaper` and `record_confirmed`, allowed at project scope) or an additive manifest field like `ChapterSync` in the auto-sync PRD; the ADR picks one. The confirm is a `ConfirmDialog` (ADR 0048).
- Credits mode: no chapter track, so the toggle is disabled with "Credits have no linked track" unless the owner wants a track picker there (a follow-up).
- **Trust boundary:** new threat-model rows under table 5: "5j T, E: a forged or unasked command starts or stops recording in REAPER, or changes which tracks are armed" (mitigations: registered command names only, track GUID from the host's mapping, the exactly-one-armed rule, stop only one's own recording, sent only from a click, the folder ACL of 5a) and a row for the meter child (4a's argv rule applies: `--meter --mic <name>`). Update `SECURITY.md`'s bridge scope bullet ("… and the commands that start and stop recording"). If Q6 B were chosen instead, record the silent WebView2 microphone permission in row 3. Update `docs/architecture/reaper-bridge.md` (command list) and the teleprompter flow diagram in `docs/architecture/manuscript-teleprompter.md`.
- **REAPER verification (ADR 0066):** the harness proves the protocol and refusals; REAPER's own behaviour (does `1013` respect record mode; what pausing while recording does; does `OnStopButton` save or prompt; `I_RECARM` and undo) is run scripted on a copy of a project with an isolated `-cfgfile`, which records into the temp folder, so it needs the owner's approval under D3 (it records, which D3 excluded) and a silent or virtual input; a real take with a microphone is owner-pending.

**Visual and aria suites.**
- Rows added or changed in `state-catalog.ts` / `app.drivers.ts`: every existing `manuscript/read-aloud-*` row re-captures (the bar replaces the card); new `read-aloud-scrolled-to-end` (the driver scrolls the body to the bottom; the bar is in view), `read-aloud-mic-popover` (open, with `?mockLevel=-18`), `read-aloud-settings-popover`, `read-aloud-paused`, `read-aloud-reaper-ready`, `read-aloud-reaper-not-armed`, `read-aloud-reaper-recording`, `read-aloud-reaper-finished-still-recording`, `read-aloud-reaper-first-confirm`, `read-aloud-rail-full-height` (resume card present, rail open) with a bounding-box assertion for the card's alignment. The Phase 3 rows take `extraViewports: [REFLOW_VIEWPORT]` for the bar at 390 px. Every PNG looked at for desktop, small-desktop, tablet and reflow (`CLAUDE.md`).
- Axe runs on every capture; a `meter` inside a `toolbar` and a live `role="status"` are the likely rules to check.
- Aria (ADR 0065): `dialog-read-aloud-resume.aria.yml` changes (the combobox and the Start group become the toolbar), so read the diff; add `dialog-read-aloud-controls.aria.yml` pinning the toolbar (Play/Pause pressed state, Stop, Microphone, Record in REAPER, Settings) and `popover-read-aloud-microphone.aria.yml`.
- `interactionFeedback.catalog.ts`: rows for Play, Pause, Stop, the meter start and stop, the REAPER state read, record start and stop, arm-only, and the per-project toggle save.

**Risks.**
1. REAPER behaviour the harness cannot prove (record mode, pause while recording, the save-media prompt): the scripted REAPER run comes before Phase 7's UI, and anything it cannot answer blocks that phase.
2. A second capture child (meter mode) and a session at once would fight over a dshow device: the host refuses and stops the meter before a session, tested.
3. Level events add about 10 events per second through Wails (ADR 0022 noted event cost as unmeasured); measure in Phase 4 and lower the rate if the reader stutters.
4. A footer in `Dialog` changes the one modal shell used by every dialog; keep it opt-in and covered by the Dialog stories.
5. The file bridge's answer time (one defer tick plus the host's read) delays listening after Play by a fraction of a second; the bar says "Starting REAPER…" so the narrator waits for "Recording".
6. Record-with-reading reverses a recorded scope line of the integration PRD; the ADR must say so, and that PRD's What We're NOT Building gets a pointer here in the Phase 7 PR.

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Layout fixes | Resume card into the text column (a `header` slot on `ReadAlongView`); rail a full-height column; tests, visual rows with an alignment assertion, aria re-read | complete | 2, 4, 6 | - | - |
| 2 | Popover primitive | `Popover` on Base UI above the dialog layer; Escape order with the dialog; story, atlas, design-system row, ADR | complete | 1, 4, 6 | - | - |
| 3 | Control bar | `ReadingControlBar` outside the scroll (Dialog footer slot, Q1), microphone and gear popovers, Play/Stop/status/Follow, the start-point slot (sibling RD9), Space shortcut (Q10), narrow layout (Q12), standalone page (Q11); visual rows with reflow, aria snapshots, catalog, guide, ADR | partial — pending owner: confirm the visual and atlas suites are green outside this sandbox (a pre-existing, unrelated `/favicon.ico` 404 fails every state/story here, verified on untouched content too) and regenerate `docs/ui/` and the two guides' screenshots, both blocked by the same sandbox issue | 4, 6 | 1, 2, Q1, Q2, Q10, Q11, Q12 | - |
| 4 | Input level | Sidecar `level` events and `--meter` mode; Go relay and meter child; bindings; wire contract, golden, mock; meter in the bar and popover | partial — sidecar, host, bindings (host API 54), wire contract and mock delivered ([ADR 0247](../adr/0247-the-input-level-comes-from-the-sidecars-own-capture-and-a-model-free-meter-child-runs-before-start.md)); the meter in the bar and popover (`useInputLevel`) is the UI lane's (stream C5); pending owner: the meter moves with their own microphone, and the reader does not stutter at ten level events a second (#510) | 1, 2, 6 (sidecar and Go half); UI half after 3 | Q6 | - |
| 5 | Pause | Control-channel pause/resume, frozen tracker clock, `paused` state, binding, contract, mock; Pause in the bar | partial — the sidecar's pause and resume, the frozen clock, the host's `paused` flag and auto-stop rule, `TeleprompterPause` (host API 55), the contract and the mock delivered ([ADR 0248](../adr/0248-pause-is-a-pause-and-resume-pair-on-the-control-file-and-a-paused-session-stays-running.md)); Pause in the bar is the UI lane's (stream C5) | 6 | 3, Q3 | - |
| 6 | REAPER transport state | Armed-track fields on the shared read-only `chapter_track_state` (built here to the sibling's spec if its Phase 4 has not landed), harness tests first; `ReadAloudReaperState`; wire rows; toggle state shown read-only in the bar | pending | 1, 2, 4 | The sibling's Phase 4 (soft); Integration Phase 11 | - |
| 7 | Record in REAPER | `record_start`, `record_stop`, `arm_only` with harness tests first; scripted REAPER run on a copy; bindings; first-time confirm; per-project toggle; threat model, `SECURITY.md`, bridge docs, ADR; owner-pending real take | pending | - | 3, 5 (for Pause's REAPER behaviour), 6, Q7, Q8, Q9 | - |

### Phase Details

**Phase 1 - Layout fixes**
- **Scope:** `ReadAlongView.tsx` (a `header` prop in the main column; the grid stretched; the rail's track full-height), `ReaderRail.tsx` (height and overflow classes), `ReadAloudDialog.tsx` (passes `ResumeCard` as `header` instead of rendering it above); their tests; visual rows `read-aloud-setup`, `read-aloud-rail-hidden` and the new `read-aloud-rail-full-height` with a bounding-box check; `dialog-read-aloud-resume.aria.yml` re-read (the order does not change). No change to `ResumeCard.tsx`.
- **Success signal:** metrics rows 3 and 4; the PNGs at every viewport show the panel from top to bottom and the card on the text's edges.
- **Verification:** `pnpm check`; `npx playwright test tests/visual/app.spec.ts -g "manuscript.*read-aloud"` and every PNG; `pnpm --dir apps/ui run aria`.

**Phase 2 - Popover primitive**
- **Scope:** `primitives/Popover.tsx`, `Popover.stories.tsx` (standalone and inside a full `Dialog`), `Popover.test.tsx`, `baseUiBoundary.test.ts` unchanged (the import is inside primitives), `Dialog.tsx` Escape check extended to an open popover, `docs/design/design-system.md` row, `docs/ui/` regenerated, ADR.
- **Verification:** `pnpm --dir apps/ui atlas`; `design-spec-guard`; `pnpm check`.

**Phase 3 - Control bar**
- **Scope:** new `ReadingControlBar.tsx` and tests; `ReadAlongView.tsx` (the configuration `Panel` removed); `MicrophoneField.tsx` reshaped for the popover (Refresh as a `Button`; `rawNatives.test.ts` ceiling 1 → 0); `Dialog.tsx` footer slot and its story (Q1 A); `TeleprompterPage.tsx` (Q11); the Space handler; `interactionFeedback.catalog.ts`; every `manuscript/read-aloud-*` and `teleprompter/*` visual row re-captured plus the new ones; aria snapshots; `docs/guides/using-the-app/{manuscript.md,teleprompter.md}` and their screenshots; ADR (the bar, the footer slot amending ADR 0094, Space amending ADR 0119).
- **Success signal:** metrics rows 1 and 2.
- **Verification:** as Phase 1, plus `pnpm --dir apps/ui atlas` for the Dialog change, `design-spec-guard`, and the reflow PNGs.

**Phase 4 - Input level**
- **Scope:** `sidecars/manuscript-teleprompter/core/live_asr.py` (level computation, `--meter`), its tests; `apps/desktop/internal/teleprompter/service.go` (relay; meter child), bindings, `app.go`/`app_test.go`/`hostApi.ts` version, `Host.{js,d.ts}`; `apps/ui/src/api/{contracts/teleprompter.ts,schemas/,wailsClient.ts,mockApi.ts,teleprompterMock.ts,wireContracts.test.ts}`, `tests/fixtures/contracts/`; `useInputLevel` hook and the meter; threat-model row for the meter child.
- **Success signal:** metrics row 5; the owner confirms the meter moves with their microphone (pending).

**Phase 5 - Pause**
- **Scope:** `control_channel.py`, `live_asr.py`, `script_tracker.py` (clock freeze), their tests; `service.go`, binding, version; contract, schema, golden, mock; the bar's Pause; `ReadAloudDialog.tsx` (flags kept on Stop only, unchanged); ADR amending ADR 0104's command set.
- **Success signal:** metrics row 6.

**Phase 6 - REAPER transport state**
- **Scope:** `integrations/reaper/narration_track_state.lua` (the armed fields; or the whole command to the sibling's spec) and `tests/track_state_test.lua`, `tests/mutations.json`, `narration_ui_bridge.lua` `FEATURE_FILES`, `scripts/release/reaper-files.mjs`, `apps/desktop/smoke.go`; `apps/desktop/internal/bridge/wire.go` and the shared client; binding `ReadAloudReaperState`, version; contract, schema, golden, mock; the bar's read-only REAPER state.
- **Verification:** harness first (`pnpm check` runs it); a scripted REAPER run on a copy for the `GetPlayState` and `I_RECARM` reads.

**Phase 7 - Record in REAPER**
- **Scope:** new `narration_transport.lua` write commands and `tests/transport_test.lua` first (plus `FEATURE_FILES`, `reaper-files.mjs`, `smoke.go`); `bridge/transport.go`; bindings; project-scope setting or manifest field; the toggle, confirm, Play/Stop orchestration, close confirm text; `docs/architecture/{threat-model.md,reaper-bridge.md,manuscript-teleprompter.md}`, `SECURITY.md`; guide; ADR; a verification note in `docs/research/` for the scripted REAPER run; a pointer from the integration PRD's What We're NOT Building.
- **Success signal:** metrics rows 7 and 8; the owner's real take recorded as pass or fail.

### Parallelism Notes

Phases 1 and 2 are independent and small; land Phase 1 first because the owner sees it at once. The sidecar and Go halves of Phase 4 and all of Phase 6 touch no UI and can run beside 1 to 3; their UI halves follow Phase 3. Phase 5 follows 3 (the button lives in the bar). Phase 7 is last and needs 6 and the owner's answers. Every UI phase re-captures the same `read-aloud-*` rows, so land 1, 3, 4 (UI), 5 and 7 one at a time.

**Parallel-session compatibility**

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 1 | `components/teleprompter/{ReadAlongView.tsx,ReaderRail.tsx,ReadAloudDialog.tsx}` and tests, `tests/visual/{state-catalog.ts,app.drivers.ts}`, `tests/aria/snapshots/dialog-read-aloud-resume.aria.yml` | **High with [Read Aloud Resume from the DAW](read-aloud-resume-from-daw.prd.md) Phase 1** (same dialog; it changes `ResumeCard`/`ResumeOffer`, adds `ResumePrompt` and the card's lifetime, this moves its container into the `header` slot: that PRD asks for this layout to land first, so land Phase 1 here first, and neither edits the other's component files); **[Manuscript Credits Card Parity](manuscript-credits-card-parity.prd.md) Phase 2** (`ReadAloudDialog` gains a `source` union and a credits mode with no resume card); Integration Phase 12 ("Punch from here" in the rail) |
| 2 | `components/primitives/{Popover.tsx,Popover.stories.tsx,Popover.test.tsx,Dialog.tsx}`, `docs/design/design-system.md`, `docs/ui/`, `docs/adr/` | Any PRD adding a primitive or editing `Dialog.tsx` or `styles.css`; ADR number |
| 3 | Phase 1's files, new `ReadingControlBar.tsx` (with the start-point slot the sibling fills), `MicrophoneField.tsx`, `TeleprompterPage.tsx`, `primitives/Dialog.tsx`, `rawNatives.test.ts`, `interactionFeedback.catalog.ts`, visual and aria files, `docs/guides/using-the-app/{manuscript.md,teleprompter.md}`, `docs/images/ui/*` for those guides, `docs/adr/` | The resume sibling and credits parity as above; **Integration Phase 11** (preselecting "the microphone REAPER uses" lands in `MicrophoneField`/the mic popover) and **Phase 13** (deletes `TeleprompterPage.tsx`: if 13 lands first, drop Q11); [Teleprompter Engines and Input Devices](teleprompter-engines-and-input-devices.prd.md) Phase 12 (the same guides and docs); [App Navigation and Zoom Controls](app-navigation-and-zoom-controls.prd.md) (its document-level key listener is ignored while a modal is open, so Space does not collide, but both add shortcuts to the guide) |
| 4 | `sidecars/manuscript-teleprompter/core/live_asr.py` and tests, `apps/desktop/internal/teleprompter/`, `apps/desktop/{app.go,app_test.go,bindings.go}`, `hostApi.ts`, `api/*`, `tests/fixtures/contracts/`, `Host.{js,d.ts}`, threat model | `hostAPIVersion` (every PRD adding a binding); `live_asr.py` (Integration Phase 12's alignment mode, [Recording Check Model Cascade](recording-check-model-cascade.prd.md) if it touches the shared sidecar code) |
| 5 | `control_channel.py`, `live_asr.py`, `script_tracker.py`, `service.go`, bindings, contracts | Phase 4 (same files; sequence them); Integration Phase 12 (`punch_to` seeks the tracker; a punch while paused must resume or refuse) |
| 6 | `integrations/reaper/narration_track_state.lua` and `tests/track_state_test.lua`, `tests/mutations.json`, `narration_ui_bridge.lua` `FEATURE_FILES`, `scripts/release/reaper-files.mjs`, `apps/desktop/smoke.go`, `internal/bridge/wire.go` and the shared client, bindings, contracts | **High with [Read Aloud Resume from the DAW](read-aloud-resume-from-daw.prd.md) Phase 4** (the same command and file: whichever lands second adds its fields, not a second command); **Integration Phase 11** (reserves the same `chapter_track_state` name, plus a device read); [REAPER Automation Follow-Through](reaper-automation-follow-through.prd.md) (registry, `FEATURE_FILES`, `wire.go`, mutation list); `hostAPIVersion` |
| 7 | new `integrations/reaper/narration_transport.lua` and `tests/transport_test.lua`, `FEATURE_FILES`, `reaper-files.mjs`, `smoke.go`, `internal/bridge/wire.go`, bindings, project settings or `project.Manifest`, `ReadAloudDialog.tsx`, the bar, `docs/architecture/{threat-model.md,reaper-bridge.md,manuscript-teleprompter.md}`, `SECURITY.md`, `docs/research/`, `teleprompter-manuscript-integration.prd.md` (one pointer line) | [DAW Chapter-Track Auto-Sync](daw-chapter-track-auto-sync.prd.md) (the mapping v2 and its `origin` decide which links count for Q7; its manifest field if the toggle goes on the manifest); [Chapter Track Link Control](chapter-track-link-control.prd.md) (relinking changes the target track); Integration Phase 12 (`punch_to` must refuse while a recording the app started is running, as navigation already does); REAPER Automation D3 (a scripted run that records needs the owner's approval); threat model and `SECURITY.md` (any PRD adding a bridge command) |

Cross-cutting: each phase follows `CLAUDE.md`: an issue and `Closes #<n>`; `change-impact-scan` (`ReadAlongView` and `useTeleprompterSession` are shared with the standalone page; `Dialog.tsx` with every dialog; `integrations/reaper` with the harness tests of each command it touches); TDD (harness tests first for every Lua command); `full-verification-gate` (`pnpm check`, the visual suite with every PNG looked at for all viewports and reflow, `pnpm --dir apps/ui run aria` since the dialog's tree changes, the atlas when a primitive changes); `design-spec-guard` for phases 2 and 3; `feature-cleanup` with the trust-boundary check for phases 4 (a sidecar's arguments), 6 and 7 (the REAPER bridge).

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Scope split with the resume sibling | This PRD owns the card's container and position, the `header` slot and the bar's start-point slot; [Read Aloud Resume from the DAW](read-aloud-resume-from-daw.prd.md) owns the card's content and lifetime; both use one read-only `chapter_track_state` command | One PRD for the whole dialog; two REAPER read commands | Two sessions writing in parallel; the container move is small and does not depend on the card's logic; one read command is one harness surface and one threat-model row |
| Bar placement (proposed, Q1 A) | A non-scrolling footer region of the dialog | Top; sticky inside the scroll | Never overlaps text or the follow band; matches the media-bar model the owner named |
| Meter source (proposed, Q6 A) | The sidecar's own capture, plus a meter-only mode before Start | `getUserMedia` in the webview | Measures the device the recognizer hears, by the name it opens; adds no silent webview microphone path |
| Gain (proposed, Q5 A) | Meter only | Recognizer gain; system microphone level | The system level is machine-wide and does not reach REAPER's ASIO input |
| Output device (proposed, Q4 A) | None | A speakers picker | Nothing plays in Read aloud; REAPER owns monitoring |
| Record with reading (owner request) | Reopens "Arm/record" from Teleprompter Manuscript Integration's Won't list for this feature only, behind the exactly-one-armed-linked-track rule | Keep it out | The owner asked for it explicitly; the guard keeps the "smallest safe mutation" intent of that PRD's punch decision |
| ADRs expected | Phase 2: the Popover primitive. Phase 3: the read-aloud control bar, the Dialog footer slot (amends ADR 0094) and Space (amends ADR 0119). Phase 4 or 5: the teleprompter's `level` event, meter mode and pause command (extends ADR 0022 and ADR 0104). Phase 7: "The app records in REAPER only on the narrator's press, only on the one armed track linked to the chapter, and stops only what it started". Next free number at merge (0171 at this commit) | Fewer, broader ADRs | Each is a decision someone will look for by itself |
| Open questions (owner, 2026-09-24) | Every open question takes this PRD's recommended answer, as shown in its approved Visual Spec mockups, except where a row below says otherwise | Answer each question separately | The owner approved the mockups that depict the recommendations; see D39 in the [implementation plan](implementation-plan.md#6-owner-decisions-2026-09-24) |
| Unbuilt data in the real app (owner, 2026-09-24, D24) | Visible UI is built in full; in mock mode it runs on sample data, and in the real app a surface whose data is not built yet shows an honest "not available yet" state. Controls that would act on REAPER stay disabled with the reason | Hide unbuilt UI until its data exists | The owner can use and judge every screen now; each backend phase switches on a screen that already exists |
| REAPER commands before the owner's verification pass (owner, 2026-09-24, D38) | Built in full with harness tests, their ReaScript calls documented from the API reference, and behind an "Experimental REAPER actions" Settings switch (off) until the owner and Claude verify them on a copy of a test project; commands that write to REAPER stay off until then | Wait to build them until the owner can test | Nothing waits on hardware, and nothing touches a real project before it is verified |
| Record in REAPER (owner, 2026-09-24, Q7-Q9, D28) | Yes. Arming the chapter's track **disarms every other track** first and remembers which tracks were armed, restoring them when a recording the app started stops; off by default, remembered per project, a confirm the first time; the app only ever stops a recording it started; one owner-approved test recording on a copy of a project | Only record when exactly one track is already armed; no recording | The owner wants the right track guaranteed; restoring the previous arms leaves the session as the narrator had it |
| Gain (owner, 2026-09-24, Q5, D37) | Level meter only | A gain on what the recognizer hears | Recording level belongs in REAPER and the audio interface |
| How a meter says it ended (Phase 4) | The host adds `{"type": "meter_stopped", "error"}` when the meter child ends, with the sidecar's last stderr line when it failed by itself | No event (the meter just goes quiet) | A microphone that will not open must not look like a silent one ([ADR 0247](../adr/0247-the-input-level-comes-from-the-sidecars-own-capture-and-a-model-free-meter-child-runs-before-start.md)) |
| Mock levels (Phase 4) | Each replay step carries a level; the mock meter sends one level on start; `?mockLevel=` fixes the RMS | A level timer in the mock | A timer of its own would never end under `vi.runAllTimers` and would make every capture move |
| Paused: a phase or a flag (Phase 5) | A `paused` flag on a `running` state, "Paused." as the message | A `paused` phase | Every "is a session running" check (Busy, the meter, detach, Seek) stays as it is ([ADR 0248](../adr/0248-pause-is-a-pause-and-resume-pair-on-the-control-file-and-a-paused-session-stays-running.md)) |

## Research Summary

- **Read:** `apps/ui/src/components/teleprompter/{ReadAloudDialog.tsx,ReadAlongView.tsx,ReaderRail.tsx,MicrophoneField.tsx,ResumeCard.tsx,useTeleprompterSession.ts,useFollowCursor.ts}`, `components/primitives/{Dialog.tsx,Menu.tsx,MeterBar.tsx,Tooltip.tsx}` and the primitives list, `rawNatives.test.ts`, `interactionFeedback.catalog.ts`, `tests/visual/{state-catalog.ts,viewports.ts}`, `tests/aria/dialogs.spec.ts` and `dialog-read-aloud-resume.aria.yml`; `sidecars/manuscript-teleprompter/core/{devices.py,live_asr.py,control_channel.py}`; `apps/desktop/app.go` (Teleprompter settings, host API), `bindings_navigation.go`, `internal/bridge/{navigation.go,wire.go}`; `integrations/reaper/{narration_navigation.lua,narration_ui_bridge.lua}` and the command registrations, `spikes/{navigation_check.lua,spike_s5_render.lua}`; Wails v2.16.0 `internal/frontend/desktop/windows/frontend.go`; ADRs 0022, 0033, 0047, 0050, 0064, 0065, 0066, 0067, 0094, 0100, 0104, 0106, 0107, 0112, 0113, 0117, 0119, 0121, 0122; `docs/architecture/threat-model.md`; the PRDs Teleprompter Manuscript Integration, Teleprompter Engines and Input Devices, REAPER Automation Follow-Through, Manuscript Credits Card Parity, App Navigation and Zoom Controls, DAW Chapter-Track Auto-Sync, Native Recording Suite.
- **Not done:** the app was not run; the layout causes are read from the classes and checked by arithmetic against the viewports, and Phase 1's visual rows confirm them. REAPER's behaviour for Transport: Record under each record mode, pausing while recording, and the save-media prompt on stop are not established; Phase 7's scripted run answers them. Whether dshow and WASAPI names differ on the owner's machine was not checked (it matters only if Q6 B is chosen).

## Visual Spec

Mockups approved by the owner on 2026-09-24. They were rendered from the real app (dark theme, the app's own fonts and components) with throwaway edits and invented sample data, so names, numbers and body text are placeholders; the layout, controls, states and wording are the spec. Each shows the recommended answer to the open questions unless its caption says it is an alternative. Where a mockup and the text above disagree, raise it before building rather than silently following either.

![Before 1024](mockups/read-aloud-control-bar/00-before-1024.webp)

*Before 1024* (`00-before-1024.webp`)

![Before](mockups/read-aloud-control-bar/00-before.webp)

*Before* (`00-before.webp`)

![Idle 1024](mockups/read-aloud-control-bar/01-idle-1024.webp)

*Idle 1024* (`01-idle-1024.webp`)

![Idle](mockups/read-aloud-control-bar/01-idle.webp)

*Idle* (`01-idle.webp`)

![Alternative (not the recommendation): Bar top 1024](mockups/read-aloud-control-bar/01b-alt-bar-top-1024.webp)

*Alternative (not the recommendation): Bar top 1024* (`01b-alt-bar-top-1024.webp`)

![Alternative (not the recommendation): Bar top](mockups/read-aloud-control-bar/01b-alt-bar-top.webp)

*Alternative (not the recommendation): Bar top* (`01b-alt-bar-top.webp`)

![Reading scrolled 1024](mockups/read-aloud-control-bar/02-reading-scrolled-1024.webp)

*Reading scrolled 1024* (`02-reading-scrolled-1024.webp`)

![Reading scrolled](mockups/read-aloud-control-bar/02-reading-scrolled.webp)

*Reading scrolled* (`02-reading-scrolled.webp`)

![Mic popover 1024](mockups/read-aloud-control-bar/03-mic-popover-1024.webp)

*Mic popover 1024* (`03-mic-popover-1024.webp`)

![Mic popover](mockups/read-aloud-control-bar/03-mic-popover.webp)

*Mic popover* (`03-mic-popover.webp`)

![Gear popover 1024](mockups/read-aloud-control-bar/04-gear-popover-1024.webp)

*Gear popover 1024* (`04-gear-popover-1024.webp`)

![Gear popover](mockups/read-aloud-control-bar/04-gear-popover.webp)

*Gear popover* (`04-gear-popover.webp`)

![Reaper first confirm 1024](mockups/read-aloud-control-bar/05-reaper-first-confirm-1024.webp)

*Reaper first confirm 1024* (`05-reaper-first-confirm-1024.webp`)

![Reaper first confirm](mockups/read-aloud-control-bar/05-reaper-first-confirm.webp)

*Reaper first confirm* (`05-reaper-first-confirm.webp`)

![Reaper armed 1024](mockups/read-aloud-control-bar/06-reaper-armed-1024.webp)

*Reaper armed 1024* (`06-reaper-armed-1024.webp`)

![Reaper armed](mockups/read-aloud-control-bar/06-reaper-armed.webp)

*Reaper armed* (`06-reaper-armed.webp`)

![Reaper recording 1024](mockups/read-aloud-control-bar/07-reaper-recording-1024.webp)

*Reaper recording 1024* (`07-reaper-recording-1024.webp`)

![Reaper recording](mockups/read-aloud-control-bar/07-reaper-recording.webp)

*Reaper recording* (`07-reaper-recording.webp`)

![Reaper not armed 1024](mockups/read-aloud-control-bar/08-reaper-not-armed-1024.webp)

*Reaper not armed 1024* (`08-reaper-not-armed-1024.webp`)

![Reaper not armed](mockups/read-aloud-control-bar/08-reaper-not-armed.webp)

*Reaper not armed* (`08-reaper-not-armed.webp`)

![Paused 1024](mockups/read-aloud-control-bar/09-paused-1024.webp)

*Paused 1024* (`09-paused-1024.webp`)

![Paused](mockups/read-aloud-control-bar/09-paused.webp)

*Paused* (`09-paused.webp`)

![Finished still recording 1024](mockups/read-aloud-control-bar/10-finished-still-recording-1024.webp)

*Finished still recording 1024* (`10-finished-still-recording-1024.webp`)

![Finished still recording](mockups/read-aloud-control-bar/10-finished-still-recording.webp)

*Finished still recording* (`10-finished-still-recording.webp`)
