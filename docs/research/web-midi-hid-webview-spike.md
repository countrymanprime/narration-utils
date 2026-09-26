# Spike: Web MIDI and WebHID availability and permission behaviour in WebView2, WKWebView and WebKitGTK 6.0

**Status: done (desk research only), 2026-09-26.** Phase 8 of the [Input Commands and Pedals PRD](../prds/input-commands-and-pedals.prd.md) (tracking issue [#646](https://github.com/countrymanprime/narration-utils/issues/646)). Answers the questions the PRD's Technical Approach and [ADR 0361](../adr/0361-app-commands-go-through-one-registry-and-keyboard-midi-and-hid-are-input-sources-bound-by-a-remappable-keymap.md) leave open before any `MidiSource` (Phase 9) or `HidSource` (Phase 11) work starts. **No live Wails v3 build was run** — see [Method](#method) and [Not done, and why](#not-done-and-why).

## What it settles

| Question | Answer | Confidence | Unblocks |
| --- | --- | --- | --- |
| Does WebView2 expose `navigator.requestMIDIAccess`? | Yes, in principle: it is a stable Chromium/Blink feature and WebView2 embeds the full Chromium web platform. Whether Wails v3's WebView2 host answers or blocks the resulting permission request was not confirmed | Medium (API presence), Low (permission plumbing) | Phase 9 can target Windows first |
| Does WebView2 expose `navigator.hid` and can `requestDevice()` show its chooser? | The `navigator.hid` object should exist (Blink feature since Chrome 89), but a second-hand community report describes `requestDevice()` producing no chooser UI inside WebView2 even though it works from a DevTools console. Not confirmed first-hand | Low | Phase 11 must re-verify before starting; do not assume it works |
| Where is a WebView2 permission request answered? | Through the host's `CoreWebView2.PermissionRequested` event (`CoreWebView2PermissionKind`). Whether that enum carries a distinct kind for MIDI sysex or for HID/device-chooser requests — and what Wails v3 beta.25 itself already does with an unhandled one — could not be verified against Microsoft's own reference (blocked, see Method) | Low | Needs a real-build check, see [#510 items](#for-510-owner-or-hardware-needed) |
| Does WKWebView (macOS) expose either API? | No. WebKit has never implemented `navigator.requestMIDIAccess` or `navigator.hid`, on any Apple platform | High | Rules out a macOS webview path; a macOS `MidiSource`/`HidSource` would need a host-side (native) reader instead |
| Does WebKitGTK 6.0 (Linux) expose either API? | No. WebKitGTK shares WebCore and the JS bindings with the macOS/iOS WebKit port; neither API is implemented upstream, and no GTK-port-specific patch adding either was found | High | Same conclusion as WKWebView for Linux |
| Does `navigator.keyboard.getLayoutMap()` (Q1's dependency) vary by webview, the way MIDI/HID do? | Yes, and the same way: it is a Blink-only feature, shipped on Windows/Linux/ChromeOS Chrome but never on macOS Chrome, and not implemented by WebKit at all. So it is plausible on WebView2, absent on WKWebView and WebKitGTK 6.0 | Medium | Confirms Q1's existing fallback-to-US-layout recommendation is required on two of three platforms, not just a hypothetical |

## Method

This is desk research, run from a cloud container with no Windows/macOS/GTK desktop session, no Wails v3 build, and no MIDI or HID hardware attached — the spike could not be, and was not asked to be, faked with a description of what a real test would show.

Research used:
- **`WebSearch`**, which returned synthesized, citation-backed results even when direct fetches failed (see below).
- **Direct fetches of GitHub-hosted content** (issues and discussions on `MicrosoftEdge/WebView2Feedback`, source files in `mdn/content`), which succeeded — `github.com` is reachable from this container.
- **This repository's own PRD, ADR 0361 and `wails-v3-migration.prd.md`**, which already record verified facts about the exact Wails v3 beta.25 / WebView2 / WKWebView / WebKitGTK 6.0 stack this app builds against.

Research could **not** use:
- Direct fetches to `webkit.org`, `bugs.webkit.org`, `caniuse.com`, `developer.mozilla.org` or `learn.microsoft.com` — every one returned `EGRESS_BLOCKED` from this session's network egress proxy. Per `/root/.ccr/README.md`, that is an organization-level policy denial, not a transient failure, and is reported here rather than retried or worked around.

Where a finding rests only on a WebSearch synthesis or a single secondary source (a community bug report, not a vendor statement), it is marked **Low** confidence above and listed under [For #510](#for-510-owner-or-hardware-needed) rather than asserted as settled. Findings marked **High** are corroborated by multiple independent sources agreeing (WebKit's non-support of Web MIDI and WebHID is well documented across the Web MIDI API's own MDN browser-support notes, general "Chromium-only capability API" commentary, and this PRD's own Research Summary, which already states the same thing) and match this repository's existing (already-Accepted) ADR 0361 text.

## Results

### WebView2 (Windows, Chromium)

- **Web MIDI.** Chromium/Blink has shipped `navigator.requestMIDIAccess` since Chrome 43 (2015); Edge (79+, Chromium-based) inherited it. WebView2 embeds the same Chromium web platform Edge ships, and no Wails- or WebView2-specific removal of the API is documented anywhere found. The API's *presence* is high-confidence.
- **Permission.** In a full browser, Web MIDI's permission is a simple allow/deny prompt. Inside an embedded WebView2 host there is no browser chrome to render that prompt; the host application answers it through `CoreWebView2.PermissionRequested`, using a `CoreWebView2PermissionKind` value. Whether that enum has a value specific to MIDI (some public discussion of newer WebView2 SDK releases mentions a MIDI-sysex-specific kind being added at some point) and, if so, whether Wails v3 beta.25's own WebView2 host code already has a default handler that denies or silently ignores it before the page ever sees a resolved/rejected promise, is not something this spike could confirm — `learn.microsoft.com` was unreachable. This is the single biggest unknown for Phase 9's Windows path and is listed below for a real-build check.
- **WebHID.** Blink shipped `navigator.hid` and `requestDevice()` from Chrome 89 (2021). Unlike Web MIDI's prompt, the browser renders a native device-chooser dialog (a list of matching connected devices) when `requestDevice()` is called from a user gesture. A GitHub discussion on `MicrosoftEdge/WebView2Feedback` (#4725) reports that calling `navigator.hid.requestDevice()` inside WebView2 shows no chooser at all, while the identical call from a DevTools console does work — suggesting the JS-visible API exists, but the device-picker *surface* WebView2 needs to render it is not wired up the way Chrome's own browser chrome is. No response from Microsoft is recorded in that thread confirming, denying, or explaining this. A separate WebView2Feedback report (#4740) shows `PermissionRequested.args.Handled = true` failing to suppress the native permission dialog for camera/microphone in some SDK version — unrelated to HID directly, but evidence that WebView2's permission plumbing for less-common request kinds has known rough edges, which raises rather than lowers the risk that HID's device-chooser path is unfinished or undocumented for embedders.
- **Net:** treat Web MIDI on WebView2 as "probably works, permission path unverified" and WebHID on WebView2 as "API object may exist, chooser UI unconfirmed and plausibly broken for an embedder" until a real build is checked.

### WKWebView (macOS, WebKit)

- **Web MIDI.** Not implemented. Apple/WebKit has never shipped `navigator.requestMIDIAccess` on macOS Safari, WKWebView, or iOS/iPadOS (where every browser, including Chrome and Edge, is required to use WebKit under App Store rules, so the gap is engine-wide, not Safari-specific). Public commentary on WebKit's own bug tracker (a long-open Web MIDI bug, opened 2013, with no active implementation) attributes the non-implementation to fingerprinting and privacy concerns, consistent with Apple's general position on capability-discovery APIs.
- **WebHID.** Not implemented, for the same reason WebUSB and WebSerial are also WebKit gaps: Apple has consistently declined to ship raw-device-access web platform APIs.
- **Net:** high confidence that macOS gets neither API from the webview, full stop, independent of anything Wails does. A macOS `MidiSource`/`HidSource` is only possible through a host-side native reader (Go/CGo talking to CoreMIDI/IOKit, exposed as a new binding) — a lane A host feature, not a webview capability, and out of this PRD's `src/input/` scope as written.

### WebKitGTK 6.0 (Linux)

- Both APIs live in WebKit's shared `WebCore`/JS-bindings layer, which every WebKit "port" (macOS/iOS, GTK, WPE, …) reuses; a port does not reimplement JS-exposed platform APIs independently unless it patches WebCore itself. No evidence of a GTK-port-specific patch adding Web MIDI or WebHID was found.
- One search result (a niche Linux "embed a browser as a VST instrument" project) claimed WebKitGTK "with modern User-Agent emulation" supports Web Audio *and* Web MIDI. This is not credible as stated: Web Audio genuinely is implemented by WebKit (so that half is true), but Web MIDI is not, and spoofing the `User-Agent` string cannot add a JS API the engine's bindings don't expose — UA spoofing only changes what a site's own feature-detection *believes*, not what `navigator` actually contains. Not treated as evidence for or against; noted here so it doesn't get mistaken for a real signal if it resurfaces.
- **Net:** same conclusion as WKWebView — no Web MIDI, no WebHID, from the webview on Linux either.

### `navigator.keyboard.getLayoutMap()` (Q1's dependency, cross-referenced by the PRD)

- Q1's recommendation ("show the key's label through `getLayoutMap()` where the webview has it … TBD, needs the Phase 8 spike") depends on the same kind of per-engine gap: `getLayoutMap()` is a Blink-only Keyboard API feature, shipped on Chromium for Windows, Linux and ChromeOS, but **never** on macOS Chrome (a documented platform limitation, not a bug — the OS doesn't give Chromium the layout data it needs there) or Android. WebKit and Gecko have not implemented the Keyboard API at all.
- So: WebView2 (Windows) — plausible. WKWebView (macOS) — absent (both because WebKit lacks it and because even Chromium lacks it on macOS). WebKitGTK 6.0 (Linux) — absent (WebKit lacks the Keyboard API entirely; the Linux exception above is a Blink-desktop fact, not one WebKitGTK inherits).
- This confirms Q1's existing fallback path (US-layout key names) is load-bearing on two of the three target platforms, not a rare edge case.

## Recommendations

1. **Keep Phase 9 (MidiSource) Windows-first and feature-detected**, exactly as the PRD's risk table already anticipates: gate on `'requestMIDIAccess' in navigator` so macOS and Linux builds simply report the source unavailable, with no per-OS branching in `src/input/`. This needs no ADR change — it sharpens ADR 0361's existing "may be Windows-only" language rather than reversing it.
2. **Do not start Phase 11 (HidSource) implementation before a real Wails v3 WebView2 build confirms `navigator.hid.requestDevice()` actually renders a chooser and returns a device.** The one piece of direct-ish evidence found here (a community bug report, not a vendor statement) suggests it currently does not. If a real check confirms that, Phase 11 closes as won't-do exactly the way the PRD phase table already allows ("Otherwise the phase closes as won't-do with the spike's reason") — no new ADR needed either way, since the PRD already carries that contingency.
3. **File the permission-plumbing and device-chooser questions to #510** (below) rather than guess further from here; they need a Windows machine running the actual pinned Wails v3 beta.25 / WebView2 combination, plus a MIDI controller and a HID device to press.
4. **No Proposed ADR from this spike.** Nothing here reverses a decision ADR 0361 already made; it only firms up the risk the PRD's Technical Approach and Risks table already named.

## Not done, and why

- **No live Wails v3 build was launched on any platform.** This container has no Windows, macOS or Linux desktop session, and no MIDI or HID hardware. The task scoped this as desk research, not a fabricated hands-on report.
- **Direct fetches to `webkit.org`, `bugs.webkit.org`, `caniuse.com`, `developer.mozilla.org` and `learn.microsoft.com` all returned `EGRESS_BLOCKED`** — this session's network egress proxy denies those hosts at the organization-policy level (confirmed via `/root/.ccr/__agentproxy/status` conventions in `/root/.ccr/README.md`: a 403/407-class denial is reported, not retried). Specifics that live only on those pages — the exact current `CoreWebView2PermissionKind` enum list, WebKit's `webkit.org/status` classification text for these two features, caniuse's version-by-version tables — could not be read directly. The findings above rely instead on `WebSearch` synthesis and GitHub-hosted primary sources (issues, discussions, MDN's own GitHub source repo), cross-checked against each other and against this repository's existing PRD/ADR text, and are reported at the confidence level that supports.

## For #510 (owner or hardware needed)

- [ ] Confirm in a real Wails v3 beta.25 (WebView2) build on Windows: does `navigator.requestMIDIAccess()` resolve without the app doing anything, and does a MIDI footswitch (the benchmark's cited Nektar PACER, or any note-on/CC-64 device) deliver events to it?
- [ ] Confirm in the same build: does `navigator.hid.requestDevice()` show a device chooser at all inside WebView2, or does it silently no-op the way the community report describes?
- [ ] Confirm which `CoreWebView2PermissionKind` (if any) a MIDI or HID permission request surfaces as in the exact WebView2 SDK version Wails v3 beta.25 pins, and whether Wails' own host code answers or blocks it before the page's promise ever settles.
- [ ] If time allows: a quick manual check of `navigator.hid`/`navigator.requestMIDIAccess` presence (both should log `undefined`) in a WKWebView (macOS) and a WebKitGTK 6.0 (Linux) build, purely to convert this note's "no known implementation" into a first-hand "confirmed absent on our exact build."
