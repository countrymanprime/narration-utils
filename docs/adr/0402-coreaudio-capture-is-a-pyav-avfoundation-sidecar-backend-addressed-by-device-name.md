# 0402. CoreAudio capture is a PyAV `avfoundation` sidecar backend, addressed by device name

**Status:** Proposed
**Date:** 2026-09-27

## Context

The capture port (ADR 0301) has one registered row, `dshow`, declaring `platforms: ("windows",)` (`libs/python/narration_common/ports/capture.py:40-45`). It is implemented entirely in the Python sidecar (`sidecars/manuscript-teleprompter/core/capture_dshow.py`), wrapping PyAV's `dshow` demuxer; the Go side (`apps/desktop/internal/captureport/captureport.go`) only declares the row's name and platforms and never opens a device itself (`captureport.go:10-11`: "Nothing calls this yet except the provider capabilities binding").

[Native Recording Suite](../prds/native-recording-suite.prd.md) (still draft, unscheduled) separately asked, in its own Q3, whether a *future* recording product's capture engine should be a CGo/WASAPI binding in Go, a dedicated Go audio package, or a Python sidecar — and flagged CGo/cross-compilation as a real risk to "the existing pure-Go Wails build pipeline" (`native-recording-suite.prd.md:108`). That question was never answered for its own (different, record-to-file) use case. But Provider Ports P10/P11 already answered the narrower question of *where the teleprompter's existing, already-shipping microphone path lives*: in the Python sidecar, behind a port whose Go half only declares data.

[CoreAudio Capture](../prds/coreaudio-capture.prd.md) extends that same teleprompter capture path to macOS by adding a `coreaudio` row. Three shapes were available: a native binding to `AVAudioEngine` (Swift/Objective-C), a native binding to the Core Audio HAL (C), or PyAV's `avfoundation` demuxer — the FFmpeg-provided, macOS-native-API-backed input device that plays the same role for macOS that `dshow` plays for Windows.

`avfoundation` addresses input devices by index (`av.open(file=":0", format="avfoundation")`), not by name, unlike `dshow` (`av.open(file=f"audio={device}", format="dshow")`). The capture port's `CaptureBackend.chunks(device: str, ...)` and `InputDevice.name` assume the name a device is listed under is the name that opens it (`capture.py`'s module docstring, `capture.py:10-12`).

## Decision

The `coreaudio` capture backend is a new PyAV adapter, `sidecars/manuscript-teleprompter/core/capture_avfoundation.py`, registered into the same `narration_common.ports.capture.BACKENDS` registry `dshow` uses, with `descriptor = CaptureDescriptor(name="coreaudio", label="Core Audio", platforms=("darwin",))`. It opens devices through FFmpeg's `avfoundation` demuxer (`av.open(format="avfoundation", ...)`), the same PyAV dependency the `dshow` adapter already uses — not a native `AVAudioEngine` or Core Audio HAL binding, and not any new dependency.

The Go side gets one new declaration-only row in `apps/desktop/internal/captureport/captureport.go` (`const CoreAudio = "coreaudio"`, `Platforms: []string{"darwin"}`), exactly mirroring `dshow`'s row. No Go code opens a capture device for either platform; this holds for the new row too.

Because `avfoundation` addresses devices by index rather than name, `CoreAudioBackend` resolves the name it reported from `list_devices()` back to FFmpeg's index internally, inside `chunks()`, before calling `av.open`. The `CaptureBackend` Protocol's contract — a caller opens the device using the exact string `list_devices()` returned — is unchanged for every existing and future caller; the index translation is private to the `coreaudio` adapter.

## Consequences

- No new dependency, no CGo, no new sidecar language, no change to the Go host's build pipeline — the risk [Native Recording Suite](../prds/native-recording-suite.prd.md)'s own Technical Risks table flagged for a different capture problem is avoided here by construction, not by mitigation.
- `teleprompter`'s live session and level-meter callers (`live_asr.py`) need no change to gain macOS support: they already resolve backends generically through the registry.
- The name→index translation is a real, if small, extra responsibility `dshow`'s adapter doesn't carry. If real-hardware verification (unavailable while this ADR was written — see [CoreAudio Capture](../prds/coreaudio-capture.prd.md) Q2, Q3) shows `avfoundation` device indices are unstable across hot-plug or reboot in a way that breaks this translation, this decision should be revisited with a new ADR, not silently patched.
- This decision says nothing about [Native Recording Suite](../prds/native-recording-suite.prd.md)'s own, separate, still-unanswered Q3 (a record-to-file product's capture engine choice) — that PRD is unscheduled and this ADR does not resolve it, though a future spike there may find this ADR's reasoning (PyAV avoids CGo risk) relevant precedent.
