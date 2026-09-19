# 0021. Live speech engines are interchangeable behind one event contract

**Status:** Accepted
**Date:** 2026-09-19

## Context

The Manuscript Teleprompter needs word-level speech recognition while the narrator is still talking. Prototyping two local engines on a Windows CPU gave different strengths and no clear winner. Whisper (`faster-whisper` tiny, re-decoded every 0.5s and confirmed by agreement between consecutive decodes) confirmed words with a median lag of about 1.2s. Moonshine streaming (Small and Tiny) processes at about 0.26x and 0.17x real time, emits partials with word timestamps every 0.5s, but its final line was identical to its last partial in 27 of 27 lines (it never corrects itself) and its word timestamps are often out of order. The user wants to evaluate both against real manuscript scrolling and animation before choosing a default. See `docs/architecture/manuscript-teleprompter.md`.

## Decision

1. An engine only produces hypotheses: the current reading of the open speech segment as words with times, final at a pause, size cap or end of input (`Hypothesis` in `tools/manuscript-teleprompter/core/live_asr.py`; `whisper_hypotheses`, `moonshine_hypotheses`).
2. One engine-independent layer (`confirmed_events`) turns hypotheses into three NDJSON events: `partial` (the whole current reading, replaced each time), `word` (confirmed by agreement between consecutive partials, append-only) and `segment_end`.
3. One engine-independent script tracker (`script_tracker.py`) consumes those events and emits `position` events (`read`, `committed`, `status`, `jump`). The script is a chapter of the canonical `manuscript.json` (`chapter_script.py`), announced by a one-off `script` event.
4. Word times are advisory. Only `end >= start` is guaranteed, and the tracker and any frontend must rely on word order and arrival time, not engine timestamps.
5. The desktop host launches the Whisper engine only. The Moonshine engine stays available from the CLI (`--engine moonshine`, run through an ephemeral `uv` environment) until its models are provisioned through the hashed asset catalog. This ADR does not choose a default engine; that is recorded after the UI evaluation.

## Consequences

- Adding or swapping an engine is one adapter; the tracker, host and UI do not change.
- The two engines can be compared on identical input and identical downstream logic.
- Engine timestamps cannot drive per-word animation pacing; the UI must pace itself.
- Moonshine is not a project dependency and is not bundled in releases, so its results cannot ship until provisioning and packaging are done.
- The confirmation rule adds roughly one second of lag to `word` events, which is why the tracker also follows `partial` events speculatively.
