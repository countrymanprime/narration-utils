# Manuscript Teleprompter

**Status: Planned. Deferred work item — see [roadmap.md](../roadmap.md#deferred-work). Only a prototype ASR sidecar exists ([`tools/manuscript-teleprompter/core/live_asr.py`](../../tools/manuscript-teleprompter/core/live_asr.py)); there is no UI, Go integration, or shipped feature yet. This brief exists to make the deferred sentence concrete enough to plan tasks from, not to schedule it into a milestone.**

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

## Prototype findings and live-engine direction

*Added 2026-09-19 after measuring the prototype on a real mic; supersedes the
"Port, do not depend on, WhisperLive" plan above wherever they disagree.*

**What was measured.** The first prototype decoded only after a confirmed
pause, which delivered a whole utterance at once and could not drive a live
highlight. It was replaced by a rolling re-decode of the open segment every
0.5s that emits a word only once two consecutive decodes agree on it
(LocalAgreement-2). On a real mic with `faster-whisper` `tiny` on CPU: word
lag behind the speaker had a median of about 1.2s (typically 0.5–1.5s, peaks
about 2.1s), and each decode took about 0.15–0.2s, so decoding keeps up.
Waiting for agreement puts a floor of roughly 1s on lag regardless of model
size, which is too slow to follow mid-sentence reading reliably.

**How comparable projects avoid the delay** (surveyed 2026-09-19; their
claims are unverified by us):

- [Autocue](https://github.com/EdNutting/autocue) (MIT): a streaming Vosk or
  Sherpa-ONNX engine plus a fuzzy script matcher that runs on every *partial*
  hypothesis as a speculative "what if" from the last committed position. The
  display advances but never moves backward on partials, and final results
  re-anchor it. The author claims sub-250ms.
- [whisper_streaming](https://github.com/ufal/whisper_streaming)
  (LocalAgreement): what the prototype adopted; its paper reports about 3.3s
  latency on long-form speech.
- [SimulStreaming](https://github.com/ufal/SimulStreaming) (AlignAtt): lower
  latency, but built on PyTorch and aimed at GPUs (its README calls CPU "too
  slow for real-time"). Not a fit for this stack.
- [Moonshine](https://github.com/moonshine-ai/moonshine) (MIT, English
  streaming models): caches encoder state instead of re-decoding, supports
  word timestamps in streaming mode and `set_context()` biasing toward the
  current script text, and ships a Windows wheel. Its accuracy and latency
  figures are the vendor's own.
- Browser Web Speech API teleprompters: cloud speech, excluded by the
  local-first boundary.

The earlier rejection of Vosk above applies only to grammar-constrained
decoding, which still masks misreads. Unconstrained streaming partials plus
fuzzy matching against the script is the ordinary open-source pattern.

**Direction, in order.**

1. **Speculative advance.** The cursor advances from the latest unconfirmed
   hypothesis (never backward on partials) and is corrected by confirmed
   words. This works with any engine and needs the sidecar to emit partial
   events in addition to confirmed words. Expected lag with Whisper: about
   0.5–0.8s.
2. **Two selectable live engines (decided 2026-09-19).** Support both
   `faster-whisper` and Moonshine behind one event contract, let the narrator
   choose in settings, and evaluate both against real manuscript scrolling
   and animation before picking a default. Engines only produce partial
   hypotheses (words with timestamps, replaced as the segment grows) and a
   segment-end signal; one shared layer applies the LocalAgreement rule to
   turn consecutive partials into append-only confirmed words, and one shared
   script tracker consumes both. Neither engine is baked into the tracker or
   the UI. The contract is implemented in `live_asr.py` as three NDJSON event
   types: `partial` (the whole current reading of the open segment, replaced
   each time), `word` (confirmed, append-only, never retracted) and
   `segment_end`. Both engines are implemented behind it
   (`--engine whisper|moonshine`). Two things the Moonshine adapter taught us:
   its line text is authoritative (its timing list can omit a word the text
   contains, so timings are aligned onto the text's words), and its word
   timestamps are noisy, especially in partials (on a synthetic clip, 6 of 23
   partials had out-of-order or inverted word times). The event contract
   therefore treats word times as advisory: only `end >= start` is
   guaranteed, and the script tracker must rely on word order and arrival
   time, not engine timestamps. Karaoke-style word animation should pace
   itself instead of trusting per-word times.

   The script tracker is implemented (`script_tracker.py`, enabled with
   `live_asr.py --script FILE`, which adds `position` events to the stream:
   `read` = index of the next script word, `committed`, `status` of
   listening / waiting / done, and `jump` restart / skip with the skipped
   span). It keeps a forward-only speculative cursor driven by partials and a
   committed position driven by confirmed words, ignores heard words that fit
   nothing nearby, and jumps elsewhere in the script only when 3 or more words
   match and beat the nearby alignment by 2. `replay.py` runs recorded
   Moonshine spike output through the real adapter, event layer and tracker
   offline. Replaying three real mic readings of a 55-word script (Small with
   context, Small without, Tiny): the cursor reached the end every time, with
   no false restarts or skips, 0 or 1 backward moves, and the speculative
   cursor reached each word a median of about 0.5s (p90 0.5 to 1.1s) before
   confirmed words alone would have. The one backward move was a real
   one-word correction (a partial heard a word that Moonshine's final line
   dropped), so the UI should not animate a one-word backward step. Pause
   status appeared 0 to 2 times per reading, detected at the next record
   after the pause.
3. **Spike results that shaped this** (Moonshine Small and Tiny Streaming, real
   mic and one synthetic recording, Windows CPU, 16–25 s of reading per run;
   small samples):
   processing cost about 0.26x real time (Small) and 0.17x (Tiny); word
   timestamps present on nearly every partial; partial updates every 0.5s by
   default; roughly 1 in 7 shown words later revised, worst in the first one
   or two words of a line; the final line was identical to the last partial in
   all 27 lines, so **Moonshine's own final result does not correct earlier
   mistakes**; word error rate 2–6% against the read script; download about
   215 MB (Small, including the 78 MB attention decoder that timestamps need)
   or 74 MB (Tiny). Estimated word lag is about 0.3–0.8s, but the probe's own
   lag metric was unreliable (it matched words by position) and needs fixing
   before comparing engines. Whisper with speculative partials is expected to
   land in the same range; Moonshine's expected edge is flat cost as a
   segment grows, cheaper short update intervals, and `set_context()`.
4. **Record the default and the rationale** in an ADR once the UI evaluation
   is done. `faster-whisper` stays for offline Transcript Compare either way.

## Confirming suspected misreads

A live ASR result is never proof of a misread. Even a final, locked result
only means the engine will not revise that line; a wrong word from the engine
and a genuine misread by the narrator look identical. Flags stay "suspected".
The existing Transcript Compare pass over the recorded take remains the
authoritative review.

**Phase 1 — recheck on click (build first).** When the narrator opens a flag,
re-decode only that short audio span with `faster-whisper` (a larger model
than the live path may be used) and show whether it agrees with what the live
engine heard. No continuous second pass. Needs a source for that span's audio
(see open items).

**Phase 2 — trailing confirmation pass (deferred; come back to this).** Run
`faster-whisper` a few seconds *behind* the live engine, over flagged spans or
over each closed segment, so flags are confirmed or cleared automatically and
the narrator mostly sees flags that have already been double-checked. Not to be
scheduled until Phase 1 and the engine spike are done. Questions to resolve
first:

- CPU budget: the live engine must stay real-time on a CPU-only machine while
  a second model runs; may force checking only flagged spans, or only when
  idle.
- Whether to check only flagged spans or every closed segment.
- Lag budget (how many seconds behind is acceptable) and which model size.
- How a flag moves from pending to confirmed or cleared in the UI without
  flicker.
- Whether a cleared flag is kept as a dismissed, auditable finding, per the
  [findings contract](findings-contract.md).
- Where the audio for a span comes from (rolling buffer vs. REAPER's
  concurrent recording).

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
the exact commit ported from. The LocalAgreement policy added later comes from
[whisper_streaming](https://github.com/ufal/whisper_streaming) (MIT,
`Copyright (c) 2023 ÚFAL`) and is attributed the same way.

## Open items for task planning (not resolved here)

- `faster-whisper` model size / latency tradeoff on CPU-only machines:
  partly answered (`tiny`: median lag about 1.2s, decode keeps up); `base` and
  `small` are untested, and the engine spike above may supersede this.
- Engine evaluation: run both engines against the real scrolling UI and
  animation, then record the default in an ADR (Sherpa-ONNX stays a fallback
  candidate only).
- Moonshine provisioning: its library downloads models from its own servers,
  but this product provisions models through the hashed, versioned asset
  catalog. Needs catalog entries (URL and SHA-256 per file, about 10 files) and
  loading from a pre-placed directory, not the library's own downloader.
- Moonshine packaging: `moonshine-voice` is not a project dependency yet, and
  its native wheels would have to bundle correctly with PyInstaller on every
  supported platform (no macOS Intel wheel is published).
- Script tracker placement and source: decided. The sidecar hosts it and reads
  the script from a chapter of the project's canonical `manuscript.json`
  (`--manuscript FILE --chapter ID_OR_TITLE`, narration chapters only): the
  chapter title, then each paragraph, split on whitespace. A one-off `script`
  event first carries the token count and each paragraph's span, and with
  Moonshine the chapter text is also used as biasing context. `--script FILE`
  remains for plain text. Still open: how the frontend maps `read` indices
  onto paragraphs and words (it must tokenize each paragraph exactly as
  `chapter_script.py` does, and can verify itself against the `script`
  event), and how the chapter is chosen in the UI (Transcript Compare picks
  it from the REAPER track name).
- Tracker limits to revisit with real use: word matching is normalization plus
  a close-spelling check, without Transcript Compare's homophone, number-word
  and hyphenation handling; invented names and spoken numbers are the likely
  misses. No flags are emitted yet (skipped or misread words feed the findings
  contract in a later step).
- Phase 2 trailing confirmation pass (see "Confirming suspected misreads").
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
