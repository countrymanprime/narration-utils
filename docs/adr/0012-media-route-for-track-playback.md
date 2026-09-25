# 0012. Local track audio is streamed through a Wails asset-server route, not the base64-binding pattern

- **Status:** Accepted
- **Date:** 2026-09-18

## Context and problem

The Tracks feature (`shell/internal/tracks`, `shared/ui/src/components/tracks`) parses a project's `.rpp` file and gives the narrator play/pause, skip-30s, and next/previous-track transport controls over the resulting tracks' audio. The only existing precedent for playing audio from the Go host, `usePreviewAudio.ts` (Story Bible pronunciation previews), sends the whole clip as base64 inside a JSON binding response and hands it to the browser as an object URL. That pattern is fine for short pronunciation clips but wrong here: track items can be chapter-length WAV files, too large to hold twice in memory (Go-side base64 buffer plus the browser's decoded copy), and it offers no way to seek without first downloading the entire file - which "skip 30s" needs to do cheaply.

## Decision drivers

- Track items can be chapter-length WAV files, too large to hold twice in memory.
- "Skip 30s" needs to seek cheaply, without first downloading the entire file.
- The "no loopback server, REST endpoint, browser tab, or port override" rule in `docs/architecture/daw-integration.md`.

## Considered options

1. A `GET /media` route on Wails' asset-server Middleware, served with `http.ServeContent`
2. The base64-over-JSON binding pattern used by `usePreviewAudio.ts`
3. A real network port

## Decision outcome

**Chosen option: a `GET /media` route on Wails' asset-server Middleware, served with `http.ServeContent`**, because it gives Range-request seeking without holding a whole file twice in memory, and stays in-process rather than opening a port.

`shell/media.go` adds a `GET /media?path=<source file>` route, wired into Wails' `assetserver.Options.Middleware` (`shell/main.go`). This is the first use of that Middleware hook in the codebase; every prior use of `AssetServer` only served the embedded frontend build (`Assets: assets`). The handler uses `http.ServeContent`, which gives Range-request support (206 Partial Content) for free, so the frontend's `<audio>` element can seek without loading a whole file. On every request, `authorizedMediaSource` re-resolves the current project's tracks via `tracksList()` and refuses to serve any path that isn't one of that project's own resolved item sources - it is not a general local-file server, and it re-checks on every request rather than trusting a cache, so a project switch or a re-selected `.rpp` takes effect immediately.

This stays in-process rather than opening a real network port: Wails' asset server intercepts webview resource requests directly (on Windows, WebView2's virtual-host-mapped scheme handler), which is consistent with `docs/architecture/daw-integration.md`'s "no loopback server, REST endpoint, browser tab, or port override" rule - confirmed by reading the installed `github.com/wailsapp/wails/v2` module source rather than assuming.

### Consequences

- **Good:** Track playback can seek instantly via native HTTP Range support instead of loading a whole file, and the Go side never holds two copies of a large audio file in memory.
- **Neutral:** The codebase now has two different audio-delivery patterns for two different sizes of problem: base64-over-JSON (`usePreviewAudio.ts`, short clips) and the `/media` streaming route (`useTrackPlayback.ts`, arbitrary-length files). A future audio feature should pick the pattern that matches its file-size/seek needs rather than default to whichever is closer at hand.
- **Neutral:** Any new consumer of `/media` must go through `authorizedMediaSource`'s project-track-source check; nothing should ever add a raw-path passthrough to this route, or it becomes an arbitrary local file read.
- **Neutral:** If a future change needs the same in-process-streaming shape for a different kind of local file, it should reuse this Middleware registration point rather than adding a second one - a future ADR should supersede this one if the authorization model itself needs to change (e.g. serving files outside the current project's track sources).

### Confirmation

Not recorded when this decision was made.

## Pros and cons of the options

### The base64-over-JSON binding pattern

- Good, because it is fine for short pronunciation clips.
- Bad, because a chapter-length file would be held twice in memory (Go-side base64 buffer plus the browser's decoded copy).
- Bad, because it offers no way to seek without first downloading the entire file.

### A real network port

- Bad, because it would break the "no loopback server, REST endpoint, browser tab, or port override" rule.
