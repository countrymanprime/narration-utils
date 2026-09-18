# Interaction feedback / response-time backlog

**Status: Backlog — not an exhaustive audit.** Per the user's explicit direction, this session did not do a full sweep of the app for missing/slow feedback; this records the specific cases already found, as a running backlog category.

## Known cases (confirmed and fixed this session)

- **TTS "Download Voice" gave no visible progress or completion signal** (item 16) — `TtsInstallJob.percent` existed but was never rendered, and a successful install transitioned silently into audio playback with no toast. Fixed: a progress bar was added to the dialog, plus a completion toast before playback starts.
- **A misleading "something went wrong" on the first Story Bible build** (item 11) — a stale-render race (fire-and-forget `load()`) tripped the route `ErrorBoundary` once, which read exactly like the build itself had failed, even though it had actually succeeded. Fixed: `load()` is now awaited before the dialog closes.

## Known cases (not yet addressed — candidates for a future audit)

Neither of these was scoped for this pass; recorded here so they aren't lost:

- General "did anything happen?" gaps elsewhere in the app were raised as a category during this session's review, without a specific second instance identified yet — worth a deliberate audit pass (not folded into this bug-fix session) that walks every async action in the app (button click → network/subprocess call → UI update) and checks it against a simple standard: does the user get *some* visible acknowledgment within roughly 100ms (immediate feedback, even if just a disabled/pressed state) and a completion signal that doesn't require they were still looking at the exact spot where they clicked?
- Any interaction that shells out to a Python subprocess (most Story Bible operations — create/edit/rescan/merge — go through `shell/internal/process/supervisor.go`'s per-call subprocess spawn) is a candidate for feeling slower than a typical UI action, given cold-start import costs noted elsewhere in this session's research (spaCy/piper/phonemizer imports). Worth measuring real latencies before assuming any specific one needs a loading state it doesn't have.

## Organizational question raised, not resolved

The user asked whether a dedicated issue tracker (e.g. Jira) would be worth adopting for this kind of backlog and other design decisions, versus keeping it in-repo as Markdown. Explicitly flagged as "too early to tell" — recorded here as an open question for a future decision, not something this session decided. Tradeoffs to weigh when it's revisited: an in-repo Markdown backlog (like this file) stays version-controlled and co-located with the code it describes, and needs no new tool/account; an external tracker gives structured status/priority/assignment but adds a second source of truth to keep in sync with `docs/adr/` and the codebase itself.
