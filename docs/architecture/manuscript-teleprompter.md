# Manuscript Teleprompter

**Status: Planned. Deferred work item — see [roadmap.md](../roadmap.md#deferred-work) — no implementation exists yet. This brief exists to make the deferred sentence concrete enough to plan tasks from, not to schedule it into a milestone.**

## Problem

The roadmap's deferred-work line names the feature in one sentence: local live
microphone listening with karaoke-style manuscript highlighting and
reviewable suspected word-level substitutions, skips, or misreads; it never
edits text or audio automatically. Everything else — how position tracking
behaves, which ASR approach is realistic in real time, how flags surface for
review, and how the UI renders — was undefined. This brief resolves those
open questions so implementation can be task-planned.

## Intended experience

A narrator opens the teleprompter view for a chapter already recording in
REAPER. The current paragraph's background is tinted; within it, the current
word is highlighted karaoke-style as the narrator reads. The view listens
continuously and needs no manual scrolling:

- While speech matches the upcoming script, the highlight advances
  word-by-word.
- If the narrator pauses, ad-libs, or drops off-script, the highlight stops
  advancing and a status indicator switches from "Listening" to "Waiting for
  you to return to the script." Nothing is blocked and nothing rewinds.
- The moment recognized speech matches the script again — whether that's the
  next word, a restart a sentence back, or a skip ahead — the highlight jumps
  to that point and resumes. The skipped or repeated span is not silently
  discarded; it becomes a flagged item.
- A suspected misread, skip, or substitution renders as a clickable flagged
  word (visually consistent with `InlineDiffRow`'s existing mismatch marks).
  Hovering shows what was actually heard via the existing `Tooltip` /
  `TooltipTarget` primitive. Clicking opens the same kind of detail/action
  panel a Story Bible entity or a Transcript Compare result row already
  opens, offering actions such as **Open in review**, **Add pronunciation
  equivalence** (reusing the existing single-word-misread action from
  Transcript Compare's `Results.tsx`), or dismissing the flag.

Nothing about this view edits the manuscript or the audio. It only tracks
position and produces reviewable flags, same as every other analyzer in this
product.

## Position-tracking behavior (resolves decisions #2 and #3 from initial planning)

Neither a hard gate ("don't advance until you say it exactly right") nor a
blind expected-pace clock with rewind. Both were considered and rejected:

- A hard gate fights natural reading rhythm and turns every filler word or
  ad-lib into a stall.
- A pace-based clock has no grounding in what was actually said — it would
  drift for slow readers, dense/technical passages, or any pause, and
  "rewinding" implies the system is scoring against a timeline rather than
  against the narrator's actual speech.

Instead, use continuous alignment with pause/resume, the same shape as
PromptSmart's VoiceTrack (the closest shipped analog — a commercial
voice-following teleprompter; no public implementation, but its documented
behavior validates this shape): keep a sliding window of upcoming manuscript
words (current paragraph plus the next), fuzzy-match incoming recognized
words against that window using the same word-diff primitive already used
offline in `InlineDiffRow.tsx` / `compare.py`, and:

1. Match nearby in the window → advance the cursor, extend the window.
2. No match for a short debounce → pause (status → "Waiting…"), hold the last
   confirmed word, do not advance.
3. Match resumes anywhere in the window (forward = skip, backward = restart)
   → jump to it, resume advancing, and record the skipped/repeated span as a
   flagged item via the shared findings contract.

Timing is entirely driven by recognized speech — there is no assumed pace.

## ASR approach (resolves decisions #2 continued)

**Port, do not depend on, WhisperLive's streaming core.**
[WhisperLive](https://github.com/collabora/WhisperLive) (MIT) already solves
the live-chunking problem: VAD-gated audio windows, rolling `faster-whisper`
decode, and real per-word timestamps (`word_timestamps=True`). That directly
answers the alignment-timing question better than fuzzy text-only matching.

Do not add it as a runtime dependency or run its WebSocket client/server:

- [daw-integration.md](daw-integration.md) explicitly rules out a loopback
  server, REST endpoint, or port for this app's Wails workspace — running
  WhisperLive's server component would reintroduce exactly that.
- It manages its own model cache, bypassing the existing versioned/hashed
  asset catalog in `shell/internal/whisper/catalog.go` and the
  [first-use dependency provisioning](first-use-dependency-provisioning.md)
  flow.
- Its own audio-capture client is redundant — mic capture and inference are
  both local here; no network client/server split is needed.

Instead, port its VAD-chunking + rolling-decode + word-timestamp loop into a
new Python sidecar module that captures the mic directly (consistent with
how `compare.py` already owns its own audio I/O via PyAV) and resolves its
model through the existing whisper asset catalog, not WhisperLive's
auto-download cache. See the license note below for the attribution this
requires.

**Vosk's grammar-constrained recognition was considered and rejected** for
the live matching signal specifically. Vosk (Kaldi-based, MIT, offline,
small models, true zero-latency streaming) can restrict decoding to a fixed
vocabulary — tempting since the upcoming script words are known in advance.
But a closed grammar force-fits whatever is said into the nearest allowed
word, which would mask genuine misreads — the opposite of what a review tool
needs. The existing `faster-whisper` `hotwords` mechanism `compare.py`
already uses is the right level of biasing (nudge probability, never
restrict vocabulary), and it carries over to the live case unchanged.

Karaoke-scoring games (UltraStar, SingStar-style pitch matching against a
fixed song score) were considered and ruled out — they score pitch against a
known melody, not free ASR against prose, and don't transfer.

Offline audiobook read-along prior art — Amazon Whispersync/Immersion
Reading, and open equivalents
[open-whispersync](https://github.com/jstriblet/open-whispersync),
[Storyteller](https://tildes.net/~books/1d3i/i_made_an_open_source_self_hostable_synced_narration_platform_for_ebooks),
[syncabook](https://github.com/r4victor/syncabook) — all do Whisper
transcription plus Levenshtein/DTW alignment against known text, which
validates the diff-based approach `compare.py` already takes, but all of it
is offline/post-hoc on a complete recording. It informs the existing
take-review side of the roadmap, not this live path.
[book-karaoke](https://github.com/liorwn/book-karaoke) (MIT) is the one
project doing live word-by-word karaoke rendering, but its alignment is
offline and Apple-MLX-specific — irrelevant here — though it confirms the
UI-rendering piece only needs a `{word, time}` event stream, decoupled from
whatever produces it.

## Findings and review (resolves decision #4)

Flagged misreads/skips/substitutions use the existing
[shared finding contract](findings-contract.md), the same way Transcript
Compare's results already do — not a parallel data model. A live flag needs
a project-time or take-relative anchor the same way an offline finding does;
if REAPER is recording concurrently, the anchor should point at the take
being recorded so **Open in review** can jump straight to it later, exactly
like `Results.tsx` already does for offline findings today.

## Streaming subprocess support (resolves decision #5)

`shell/internal/process.Supervisor.Start` currently drains stdout/stderr to
`io.Discard` for the two batch sidecars (Manuscript Guide, Transcript
Compare) — see `supervisor.go`. A live teleprompter sidecar needs a second,
additive code path: a streaming variant that reads NDJSON lines from the
child's stdout and relays each as a Wails event to the frontend, instead of
discarding it. This is new capability alongside the existing batch path, not
a change to it — the batch sidecars keep their current behavior.

## Where listening runs (resolves decision #1)

Inside the native Wails host, consistent with
[daw-integration.md](daw-integration.md)'s "no loopback server" rule. The
Python sidecar owns mic capture and inference (same ownership pattern as
Transcript Compare owning audio decode); Go owns process lifecycle, device
selection plumbing, and relaying streamed events to the React frontend.
REAPER Lua is not involved in the live loop at all — same boundary the DAW
integration doc already draws for take/marker mutation.

## UI (mirrors `ParagraphView.tsx`)

Reuse the existing paragraph gutter+text grid layout from
`shared/ui/src/components/manuscript/ParagraphView.tsx` rather than a new
layout: the current paragraph's row gets a background tint
(`--bg-accent-muted`/local equivalent), the current word renders as a
solid-filled span (mirrors the existing entity `<mark>` treatment), and a
flagged word renders as a clickable `<mark role="button" tabIndex>` wrapped
in the existing `TooltipTarget` primitive (`shared/ui/src/components/
primitives/Tooltip.tsx`) showing what was heard, with `onClick` opening a
detail panel — the same interaction `ParagraphView.tsx` already wires for
entity annotations (`openEntity`) and notes (`openNote`). The detail panel's
actions reuse existing Transcript Compare review actions
(`Results.tsx`: open in review, add pronunciation equivalence) rather than
inventing a new action set.

## Third-party license note

Porting WhisperLive's streaming-inference logic is permitted without
restriction — both this repository and WhisperLive are MIT-licensed. The
only condition is preserving attribution: the ported module needs a header
citing the source and copyright holder (`Copyright (c) 2023 Vineet Suryan,
Collabora Ltd.`), and this is the first entry of its kind (ported logic, not
a downloaded dependency) in
[local-dependency-evaluation.md](../research/local-dependency-evaluation.md).
This is engineering guidance, not legal advice — recheck upstream terms at
the exact commit ported from.

## Open items for task planning (not resolved here)

- Exact `faster-whisper` model size / latency tradeoff on CPU-only machines —
  needs a prototype before UI work is finalized.
- Mic device selection UX and where device enumeration lives (Go vs. Python).
- Whether a flagged span needs its own short rolling audio buffer captured
  for playback in the review panel (Results.tsx plays back heard audio for
  offline findings; the live case doesn't yet have an obvious source for
  that unless REAPER's concurrent recording is used as the anchor).

## Acceptance criteria

- The teleprompter view advances only in response to recognized speech,
  never a timer.
- Pausing, ad-libbing, or restarting never blocks the view and never
  requires an exact retry.
- Every flagged word is reviewable (tooltip + click-through actions) and
  none is auto-corrected in text or audio.
- No loopback server, REST endpoint, or browser tab is introduced.
- The existing batch sidecar behavior (Manuscript Guide, Transcript Compare)
  is unchanged.
