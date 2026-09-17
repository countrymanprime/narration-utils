# OS-level native notifications

**Status: Planned — not implemented.**

## Problem

The app has exactly one notification channel today: an in-app toast (`shared/ui/src/components/layout/Toast.tsx`), a single fixed-duration (~2.4s) status string surfaced via `App.tsx`'s `notice`/`setNotice` state — only one toast can show at a time, and it disappears whether or not the user saw it. There is no OS-level notification, and the Go backend exposes no notification binding at all (Wails' `runtime` package is only used for `EventsEmit`, not `runtime.Notification` or similar).

## Candidate events worth surfacing at the OS level

- TTS preview-voice download complete (item 16's fix already adds a toast + progress bar in-app; an OS notification would matter if the user alt-tabs away during a multi-hundred-MB download).
- Story Bible build complete (`Guide.tsx`'s build flow) — a background operation the user might not be watching.
- Manuscript import complete, if it ever becomes a longer-running operation than it is today.

## Proposal

1. Add a Go-side binding, e.g. `Host.NotifyOS(title, body string)`, using Wails' `runtime` package if it exposes a cross-platform notification API, or a small platform-specific fallback (Windows toast via `runtime.exec` of a PowerShell `BurntToast`-style call, or a minimal native call) if not — needs research into what Wails v2.16 actually offers before committing to an approach.
2. Frontend calls this alongside (not instead of) the existing toast for events judged worth it — the toast stays the always-available in-app record; the OS notification is for "you were looking at something else."
3. **Fallback**: OS notifications can be unavailable (permission denied, unsupported platform, notifications disabled at the OS level). The call must fail silently from the user's perspective — never block on it, never surface an error if it can't fire, since the in-app toast is always the source of truth.
4. Likely wants a Settings toggle (global) to let a user opt out entirely.

## Open question

Whether this needs a permission-prompt flow (macOS/Windows both gate notifications behind user consent) and how that consent request should be timed — probably on first use, not app startup.
