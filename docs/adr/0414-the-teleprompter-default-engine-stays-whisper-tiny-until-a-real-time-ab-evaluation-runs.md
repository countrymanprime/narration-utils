# 0414. The teleprompter default engine stays Whisper tiny until a real-time A/B evaluation runs

**Status:** Proposed
**Date:** 2026-09-27

## Context

`docs/prds/teleprompter-engines-and-input-devices.prd.md` Phase 8 asks for the default live engine (Whisper vs.
Moonshine) to be decided with evidence: a written A/B protocol, an opt-in lag-capture aid so a host-launched session
yields real numbers, a results table, and the default recorded here. The PRD's Decisions Log already fixes the gate
(median cursor lag at least 25% lower than Whisper tiny, no more false jumps or backward moves, on at least 3
readings across at least 2 microphones) and the method (numeric gate plus the owner's judgment, ADR 0021).

This ADR was written in a cloud session with no real microphone and, at the time, no reachable network path to either
a real-speech audio source or the engines' own model-weight hosts (`archive.org`/`librivox.org` for audio,
`huggingface.co` for the Whisper catalog, `download.moonshine.ai` for the Moonshine catalog all refused the outbound
connection under that environment's network policy, and no model weights were cached locally). Writing plausible
lag numbers into this ADR's Consequences without a real run would misrecord a decision that was never actually made —
exactly the failure `docs/adr/README.md`'s "concrete, not aspirational" rule exists to prevent. So this ADR records
what phase 8 actually delivered without a live run, and defers the numeric gate to whoever next runs the protocol
with real audio and real weights (see the companion protocol in
[`manuscript-teleprompter.md`](../architecture/manuscript-teleprompter.md#engine-evaluation-protocol-and-lag-capture-aid-teleprompter-engines-and-input-devices-prd-phase-8)).

A second, independent finding from writing the protocol: a `--wav` replay session (`iter_wav_chunks`, `live_asr.py`)
runs "as fast as the CPU allows," not paced to real time, so its `--timing` numbers are not lag figures at all — only
a real-time `--mic` (or loopback) pass measures the gate's actual metric. This holds regardless of network access, so
it is recorded here rather than only in the protocol doc.

## Decision

1. **The default stays `whisper`/`tiny`** (`config/defaults.json`'s `Teleprompter.engine`/`Teleprompter.model`,
   unchanged). The Decisions Log's gate has not been evaluated against a real-time reading in any environment this
   phase's work had access to, so nothing licenses changing the shipped default.
2. **The lag-capture aid is delivered and real**, independent of any run: `NARRATION_TELEPROMPTER_EVAL=1` makes
   `apps/desktop/internal/teleprompter/service.go`'s `planSession` add `--timing --log <session dir>/teleprompter_<id>.log`
   to every sidecar launch (`Config.EvalTiming`, tested in `service_test.go`). It is developer/evaluation-only, the
   same pattern as `NARRATION_DEBUG` (`internal/runlog`); nothing in Settings or the UI can turn it on.
3. **The protocol is written** (linked above): two passes (a fast `--wav`/`replay.py` accuracy-only pass, and the
   real-time `--mic`/loopback pass the gate actually needs), both engines, both models (`tiny` and `small` — Whisper
   `small` had no live-lag data before this phase), at least 3 real-time runs per combination across at least 2
   microphones, LibriVox audio as the default development source with synthetic (Piper) as the fallback (D70/D71),
   provenance recorded next to the recording and the recording itself kept out of git.
4. **ADR 0021 still holds**: both live engines stay selectable and user-visible in Settings regardless of which one
   is the shipped default. `faster-whisper` stays the offline Transcript Compare engine whichever live default this
   ADR (or the one that supersedes it) eventually names.
5. **This ADR stays Proposed, and the default stays as written above, until a real-time A/B run exists.** Once one
   does, either this ADR's Consequences gain a results table and its Status becomes Accepted (if the gate and the
   owner's judgment agree), or a new ADR supersedes it. Nothing changes `config/defaults.json` before that.

## Consequences

- No default-engine regression risk: the shipped behavior (Whisper tiny) is exactly what narrators get today, so this
  ADR changes no runtime behavior by itself.
- The Success Metrics "Default engine decision" row (an accepted ADR with the evidence) and "Cursor lag per engine"
  row stay open; `docs/prds/teleprompter-engines-and-input-devices.prd.md` Phase 8's Status stays `pending` rather
  than `complete`, and Phase 12 (which depends on Phase 8) stays blocked.
- A future run only needs the aid already built here (`NARRATION_TELEPROMPTER_EVAL=1`) and real audio input; no more
  Go or sidecar code is implied by finishing the evaluation, only running the protocol and filling in this ADR (or a
  superseding one).
- The real-microphone pass with the owner's own voice (ENG-8) was already tracked as a QA item on
  [#510](https://github.com/countrymanprime/narration-utils/issues/510) before this ADR; a LibriVox or synthetic
  provisional run does not remove that item, it only gives an earlier, lower-confidence signal (D70).
- Anyone re-running the protocol must re-check the "`--wav` has no real lag" finding above still holds before trusting
  a quick pass's numbers as evidence for the gate.
