# 0866. Voice samples play in the app's own audio, served by id, and never through the DAW

**Status:** Proposed
**Significance:** An interface between parts and an authorization rule. The `/media` route's authorization model ([ADR 0012](0012-media-route-for-track-playback.md)) gains a second class of file, and every later audio feature that is not a project track source would copy or contradict the choice.
**Date:** 2026-10-17
**Supersedes:** none. It amends [ADR 0012](0012-media-route-for-track-playback.md), which asks for a new ADR "if the authorization model itself needs to change".

## Context

A voice sample is a clip in the project's own folder ([ADR 0865](0865-a-voice-sample-is-a-clip-copied-into-the-project-folder-and-its-source-is-kept-as-provenance-only.md)). The narrator plays it from the Story Bible and, while recording, from the Booth ([PRD](../prds/character-voice-samples.prd.md)).

`/media` serves only a path that equals a source of the parsed `.rpp`, or a take of the built-in recorder (`apps/desktop/media.go`, threat-model row 6b). A clip is neither. The DAW can play part of a file (`file_preview`), but only REAPER does, through SWS, as Experimental, and it refuses while the engine records ([capabilities](../reference/daw/capabilities.md#file_preview)); Audacity and the built-in recorder do not. The Booth is DAW-neutral and a sample is most useful there.

**Considered options:**

- **Play through the DAW's file preview**: REAPER-only, needs SWS and the DAW running, refuses while recording. A sample would not play in a standalone launch or with another engine.
- **Base64 over a binding** (`usePreviewAudio.ts`): no route change, but up to 5.8 MB of JSON a play, which adds latency in the Booth, and no seek. [ADR 0012](0012-media-route-for-track-playback.md) reserves that pattern for short clips; a 30 s clip is on the other side of its line.
- **Authorize a clip by path** in `/media`: widens the route toward a general local-file read, the thing the ADR forbids.
- **Serve by id from the host's own list** (chosen).

## Decision

1. **A sample plays in the app's own audio**: one `Audio` in the page, over the same in-process asset-server handler as track audio. The DAW is not asked to play, insert or preview anything, and no DAW capability is added.
2. **`GET /media?sample=<id>` is a second branch of the existing `mediaMiddleware`** (one registration, as [ADR 0012](0012-media-route-for-track-playback.md) asks). The handler looks the id up in `samples.json`, checks the clip exists, its size matches and its hash matches, and serves `clips/<id>.wav` with `http.ServeContent`. It never takes a path for this class: a request with both `path` and `sample`, or a `sample` that is not 32 lowercase hex, is a 404, as is an id the file does not list.
3. **Playback is refused while a take records.** The player reads the Booth's recording state and refuses with the sentence the Booth already uses ("Not while recording. Stop the take first."). When a DAW is configured and its state has gone quiet, the refusal says it cannot tell and offers **Check again**.
4. **A Booth session that is listening to the narrator pauses its listening while a sample plays** and resumes after, because the app's output reaches a microphone the recognition follows. The phase 5 spike settles whether the existing pause control can be driven from a sample play; until it does, play is refused during a listening session.
5. **A sample kept only as a DAW label plays from its source range in the same player**, over the existing path-authorized `/media` route for a project track source, with the range applied in the page. That is the `daw` storage of [ADR 0865](0865-a-voice-sample-is-a-clip-copied-into-the-project-folder-and-its-source-is-kept-as-provenance-only.md) and is built in phase 6; it still asks the DAW for nothing and does not move its transport or cursor.
6. **One sample plays at a time.** A new play stops the last, and Editing's playback and the Booth's read-aloud speech stop when a sample starts.

## Consequences

- A sample plays in a standalone launch, with any engine or none, with REAPER closed, and with no SWS.
- Row 6b of the [threat model](../architecture/threat-model.md) is updated in the phase that builds the handler: the route serves a project's track sources, the built-in recorder's takes, and a clip named by an id the host lists. A reporter's scope in [SECURITY.md](../../SECURITY.md) does not change, because the route stays reachable only from the app's own webview.
- The app's audio goes to the system's default output, so a narrator on speakers can still reach a microphone while no take records; the Booth's listening pause covers the app's own recognition, and nothing covers a DAW that is armed but not recording. The PRD records this as a risk.
- The output device is not choosable in the first release.
- Serving a sibling project's clips for the series view needs another authorized class and its own ADR.
- To change this, write an ADR that supersedes it.
