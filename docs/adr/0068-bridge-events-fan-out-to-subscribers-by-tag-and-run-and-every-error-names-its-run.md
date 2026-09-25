# 0068. Bridge events fan out to subscribers by tag and run, and every error names its run

- **Status:** Accepted
- **Date:** 2026-09-21
- **Deciders:** the owner

## Context and problem

The Go bridge client had one event cursor. `Client.ReadEvents` advanced a single offset over `events.log`, and the host's 150 ms loop drained it through the Transcript Compare service, which acted on the events of its own run and ignored the rest. A second consumer (line identity, the teleprompter's live state) that read the same client would have either lost events to the first reader or stolen them from it; and any `LINES_*` or `REGIONS_CREATED` event emitted today would have been consumed and thrown away within 150 ms. `ERROR` events made it worse: they carried only a message, so no consumer could tell whose they were, and the transcript service, which treats the first argument of every event as a run ID, dropped every `ERROR|<message>` because the message never equalled its run ID: a REAPER-side failure never reached the Transcript Compare state. A scripted run in a real REAPER 7.80 found where such an `ERROR` really came from: `reaper.EnumerateFiles` caches the commands folder listing, so the bridge reported `ERROR||Unsupported hub protocol` once or twice after every command (a removed command file still listed); the same change makes the bridge refresh the listing and skip a vanished file, or attributing that error to the run in progress would have failed every Transcript Compare run. The REAPER automation follow-through PRD (phase 2, open question 12, recommendation adopted by owner decision D22) planned the fix before either consumer existed.

## Decision drivers

- A second consumer reading the same client would either lose events to the first reader or steal them from it, and any `LINES_*` or `REGIONS_CREATED` event would be consumed and thrown away within 150 ms.
- `ERROR` events carried only a message, so no consumer could tell whose they were, and a REAPER-side failure never reached the Transcript Compare state.
- The REAPER automation follow-through PRD (phase 2, open question 12, adopted by owner decision D22) planned the fix before either consumer existed.

## Considered options

1. The client is the one reader of `events.log` and fans events out to subscribers by tag and run
2. Keep the status quo: one event cursor (`Client.ReadEvents`) drained by the Transcript Compare service

## Decision outcome

**Chosen option: the client is the one reader of `events.log` and fans events out to subscribers by tag and run**, because with one cursor a second consumer would lose or steal events, and an `ERROR` that named no run never reached the Transcript Compare state.

1. **The client is the one reader of `events.log` and fans events out.** `Client.Subscribe(Subscription{Tags, Owns, Handle})` registers a consumer; `Client.Dispatch()` reads the whole lines appended since the last call, decodes them, and delivers each, in log order and once, to every consumer whose `Tags` match (exact names, or a prefix ending in `*`) and, for an event that carries a run ID, whose `Owns` is nil or accepts the run. An event with an empty run ID goes to every consumer whose tags match. Events nobody accepts and lines that do not decode are counted, not silently lost (`Undelivered`, `Malformed`). `ReadEvents` is removed.
2. **The first argument of every bridge event is its run ID,** the first argument of the command that caused it. `ERROR` follows the rule: `ERROR|<run_id>|<message>`, with an empty run ID for a session-level error (`ERROR||Unsupported hub protocol`) and the command's first argument for an unknown command. This is the Lua half of the change and lands after the command registry ([ADR 0067](0067-bridge-commands-are-registered-by-name-and-each-feature-lives-in-its-own-lua-file.md)), in the feature files.
3. **The transcript service is the first subscriber** (`COMPARE_*` and `ERROR`, owning its current run) and is otherwise unchanged; `Drain` now calls `Dispatch`. An error with an empty run ID fails a run in progress and is ignored when idle; an `ERROR` without a run ID (the older shape) is ignored, as it effectively was.
4. **Only whole lines are consumed.** A line REAPER is still writing waits for the next `Dispatch` instead of being cut in two, and a log that is shorter than what was already read is treated as replaced and read from its start (it used to be skipped).

### Consequences

- **Good:** A new consumer only subscribes; it neither reads the log nor coordinates with the others. The line identity client (phase 6 of the PRD) and the teleprompter integration build on this.
- **Good:** REAPER-side failures now reach the Transcript Compare state (before: never). A REAPER already running an older launcher against a newer app still emits `ERROR|<message>`, which the transcript service ignores as before.
- **Neutral:** Handlers run on the goroutine that calls `Dispatch` and must not call it. Any consumer's poll dispatches for all, so there is no scheduling contract between them; a host-level pump (one `Dispatch` per tick, independent of any service) is a small change when the second consumer arrives.
- **Neutral:** The wire format changed for `ERROR` only (one field added); `hostAPIVersion` is unchanged because no binding changed.
- **Neutral:** To route differently (a channel per consumer, or a transport that pushes), write a new ADR that supersedes this one.

### Confirmation

Not recorded when this decision was made.

## Pros and cons of the options

### Keep the status quo: one event cursor

- Bad, because a second consumer (line identity, the teleprompter's live state) that read the same client would have either lost events to the first reader or stolen them from it.
- Bad, because the transcript service dropped every `ERROR|<message>`, so a REAPER-side failure never reached the Transcript Compare state.
