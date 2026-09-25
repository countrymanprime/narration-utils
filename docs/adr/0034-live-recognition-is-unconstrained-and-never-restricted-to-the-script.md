# 0034. Live recognition is unconstrained and is never restricted to the script's words

- **Status:** Accepted
- **Date:** 2026-09-19

## Context and problem

The teleprompter knows exactly what the narrator should say, which makes a closed-vocabulary recognizer tempting. Vosk (Kaldi-based, MIT, offline, small models, streaming) can restrict decoding to a fixed grammar. But a closed grammar force-fits whatever was said into the nearest allowed word, so a genuine misread comes out looking like the script. Catching misreads is the point of the review tools in this suite, so masking them defeats the purpose. Transcript Compare already biases `faster-whisper` with a vocabulary hint (`hotwords`, `tools/transcript-compare/core/compare.py:506-514`), which nudges probabilities and never restricts the vocabulary. See [manuscript-teleprompter.md](../architecture/manuscript-teleprompter.md); [ADR 0021](0021-live-speech-engines-behind-one-event-contract.md) covers which engines exist and how they report.

## Decision drivers

- A closed grammar force-fits whatever was said into the nearest allowed word, so a genuine misread comes out looking like the script.
- Catching misreads is the point of the suite's review tools, so masking them defeats the purpose.

## Considered options

1. Unconstrained decoding, matched against the script afterwards in the tracker, with biasing only as a nudge
2. A closed-vocabulary, grammar-constrained recognizer such as Vosk

## Decision outcome

**Chosen option: unconstrained decoding, matched against the script afterwards in the tracker, with biasing only as a nudge**, because a closed grammar would force-fit a genuine misread into the script's words, and catching misreads is the point of the review tools.

Live recognition decodes the narrator's speech without a restricting grammar, and matching against the script happens afterwards, in the tracker ([ADR 0033](0033-the-teleprompter-follows-speech-with-continuous-alignment-and-pause-resume.md)). Biasing is allowed only as a nudge: the `--hotwords` option passes `faster-whisper` `hotwords` (`tools/manuscript-teleprompter/core/live_asr.py:355-368`), and the Moonshine engine can take the chapter text as context (`live_asr.py:679`). No engine is given a closed vocabulary, and Vosk or any other grammar-constrained decoder is not used for the live signal. The project does not depend on Vosk (`pyproject.toml`, `uv.lock` and the sidecar sources contain no reference to it).

### Consequences

- **Good:** Misreads and skipped words survive recognition as different words, so they can later become reviewable findings.
- **Bad:** The tracker has to tolerate recognition noise: it ignores heard words that fit nothing nearby and matches with a close-spelling check, which costs some accuracy on invented names and spoken numbers ([ADR 0033](0033-the-teleprompter-follows-speech-with-continuous-alignment-and-pause-resume.md)).
- **Bad:** Whisper is re-decoded over the growing segment every 0.5 s (`DECODE_INTERVAL_SECONDS`), which costs more CPU and adds lag than a streaming Kaldi decoder would. Vosk's low latency and small models are given up; those properties come from the design record and were not measured here.
- **Neutral:** The desktop host passes no hotwords and launches only the Whisper engine, so biasing is a CLI capability today and has no UI. Moonshine's script-text context works only when the sidecar is run by hand.
- **Neutral:** Whether biasing raises or lowers misread detection on real readings has not been measured.
- **Neutral:** Using a grammar-constrained decoder for live matching would need a new ADR that supersedes this one.

### Confirmation

Not recorded when this decision was made.

## Pros and cons of the options

### A closed-vocabulary recognizer such as Vosk

- Good, because Vosk is Kaldi-based, MIT, offline and streaming, with small models and low latency (properties from the design record, not measured here).
- Bad, because a closed grammar force-fits whatever was said into the nearest allowed word, so a genuine misread comes out looking like the script.
