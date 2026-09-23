"""
Regenerates tests/fixtures/teleprompter-locate/, the recorded tails the tail-audio locate is measured on
(teleprompter-manuscript-integration PRD Phase 9, ADR 0111).

Each case is a narrator's recording of Chapter I of Alice's Adventures in Wonderland (tests/fixtures/alice.md,
public domain) up to a known word: a Piper voice speaks the last couple of minutes of it, with the case's own
twist (a retake of the last sentence, a filler and a false start, a stop mid-sentence, a passage the chapter
repeats), and the tail is run through the same path the sidecar's `--locate` takes: `locate.read_audio_range`
cuts the last seconds out of the WAV and `live_asr.make_decoder(..., vad_filter=True)` transcribes them with a
real faster-whisper model. What Whisper heard is committed, not the audio, so the accuracy test runs offline with
no model:

    uv run python sidecars/manuscript-teleprompter/spikes/record_locate_tails.py \\
        --piper-model %LOCALAPPDATA%/narration-utils/assets/tts/piper/en_US-ljspeech-high/1.0.0/en_US-ljspeech-high.onnx \\
        --model-dir %LOCALAPPDATA%/narration-utils/assets/whisper/faster-whisper/tiny/<commit>

Both assets are the app's own verified installs (the Whisper model is the teleprompter's default, tiny, the least
accurate one it offers). The voice is synthetic, so this measures the locate against real recognition errors, not a
human narrator's pacing; a real reading is still a manual check (see the PRD phase).
"""

import argparse
import json
import re
import sys
import tempfile
import time
import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np

_CORE_DIR = Path(__file__).resolve().parents[1] / "core"
if str(_CORE_DIR) not in sys.path:
    sys.path.insert(0, str(_CORE_DIR))

import live_asr
import locate

ROOT = Path(__file__).resolve().parents[3]
ALICE = ROOT / "tests" / "fixtures" / "alice.md"
OUT = ROOT / "tests" / "fixtures" / "teleprompter-locate"

# How many script words before the end each synthesized reading starts: enough speech to fill any tail below.
LEAD_WORDS = 160
DEFAULT_TAIL_SECONDS = 30.0
ROOM_TONE_SECONDS = 1.5
# The paragraph of Chapter I that chapter-repeated.txt repeats at the end of the chapter, as a book quoting a
# letter or a verse twice would.
REPEATED_PARAGRAPH = 11


def chapter_one_paragraphs() -> list[str]:
    """Chapter I's paragraphs as plain text (the markdown's `_italics_` markers removed)."""
    text = ALICE.read_text(encoding="utf-8")
    body = text.split("# Chapter I:", 1)[1].split("\n# ", 1)[0]
    lines = [line.strip() for line in body.splitlines()[1:]]
    return [re.sub(r"_(.+?)_", r"\1", line) for line in lines if line]


@dataclass(frozen=True)
class Case:
    name: str
    script: str
    end: int
    tail: float = DEFAULT_TAIL_SECONDS
    extra: tuple[str, ...] = ()
    lead: tuple[str, ...] = ()
    confident: bool = True
    note: str = ""


def _sentence_start(tokens: list[str], index: int) -> int:
    start, _end = locate.sentence_bounds(tokens, index, set())
    return start


def cases(tokens: list[str], repeated: list[str], repeated_start: int) -> list[Case]:
    count = len(tokens)
    sentence_end = next(i + 1 for i in range(count // 2, count) if tokens[i].endswith("."))
    mid_sentence = next(i for i in range(int(count * 0.62), count) if not re.search(r"[.!?,;:]", tokens[i - 1]))
    retake_end = next(i + 1 for i in range(int(count * 0.3), count) if tokens[i].endswith("."))
    retake = tuple(tokens[_sentence_start(tokens, retake_end - 1) : retake_end])
    filler_end = next(i + 1 for i in range(int(count * 0.8), count) if tokens[i].endswith("."))
    repeat_length = len(repeated) - repeated_start
    return [
        Case("sentence-end", "chapter.txt", sentence_end, note="stopped at the end of a sentence halfway through"),
        Case("mid-sentence", "chapter.txt", mid_sentence, note="stopped in the middle of a sentence"),
        Case("retake", "chapter.txt", retake_end, extra=retake, note="read the last sentence twice"),
        Case("filler-and-false-start", "chapter.txt", filler_end, lead=("um,", "so", "she", "she"), note="a filler and a false start in the tail"),
        Case("chapter-start", "chapter.txt", 40, note="only forty words recorded"),
        Case("chapter-end", "chapter.txt", count, note="finished the chapter"),
        Case("short-tail", "chapter.txt", sentence_end, tail=8.0, note="an eight-second last item"),
        Case(
            "repeated-passage",
            "chapter-repeated.txt",
            repeated_start + repeat_length - 6,
            tail=15.0,
            confident=False,
            note="the whole tail lies in a paragraph the chapter holds twice",
        ),
        Case(
            "repeated-passage-long-tail",
            "chapter-repeated.txt",
            repeated_start + repeat_length - 6,
            tail=60.0,
            note="the same end, with a tail that reaches back past the repeated paragraph",
        ),
    ]


def synthesize(voice, text: str, path: Path) -> float:
    """Speak `text` into a WAV at `path`, followed by room tone (silence); returns its length in seconds."""
    with wave.open(str(path), "wb") as handle:
        voice.synthesize_wav(text, handle)
        rate = handle.getframerate()
        handle.writeframes(np.zeros(int(ROOM_TONE_SECONDS * rate), dtype="<i2").tobytes())
        frames = handle.getnframes()
    return frames / rate


def record(case: Case, tokens: list[str], voice, decode, work: Path) -> dict:
    spoken = [*tokens[max(0, case.end - LEAD_WORDS) : case.end]]
    if case.lead:
        cut = len(spoken) - 30
        spoken = [*spoken[:cut], *case.lead, *spoken[cut:]]
    spoken.extend(case.extra)
    wav = work / f"{case.name}.wav"
    length = synthesize(voice, " ".join(spoken), wav)
    started = time.perf_counter()
    audio = locate.read_audio_range(str(wav), max(0.0, length - case.tail), length)
    heard = [text for text, _start, _end in decode(audio)]
    decode_seconds = time.perf_counter() - started
    event = locate.locate_event(heard, tokens)
    print(
        f"{case.name:28s} expected {case.end:5d} got {event['word']!s:>5} confidence {event['confidence']:.3f} "
        f"confident {event['confident']!s:5s} ({len(audio) / locate.SAMPLE_RATE:.1f}s decoded in {decode_seconds:.1f}s)",
        file=sys.stderr,
    )
    return {
        "name": case.name,
        "note": case.note,
        "script": case.script,
        "tailSeconds": case.tail,
        "expectedWord": case.end,
        "expectConfident": case.confident,
        "heard": heard,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Regenerate the tail-audio locate fixtures with Piper and faster-whisper")
    ap.add_argument("--piper-model", required=True, help="A verified Piper voice (.onnx) from the app's asset cache")
    ap.add_argument("--model-dir", required=True, help="A verified faster-whisper model directory from the app's asset cache")
    ap.add_argument("--model-name", default="tiny", help="The catalog id of --model-dir, recorded in the fixture")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()

    from faster_whisper import WhisperModel
    from piper.voice import PiperVoice

    paragraphs = chapter_one_paragraphs()
    repeated_paragraphs = [*paragraphs, paragraphs[REPEATED_PARAGRAPH]]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "chapter.txt").write_text("\n".join(paragraphs) + "\n", encoding="utf-8")
    (out / "chapter-repeated.txt").write_text("\n".join(repeated_paragraphs) + "\n", encoding="utf-8")
    scripts = {"chapter.txt": " ".join(paragraphs).split(), "chapter-repeated.txt": " ".join(repeated_paragraphs).split()}
    repeated_start = len(" ".join(paragraphs).split())

    voice = PiperVoice.load(args.piper_model)
    model = WhisperModel(args.model_dir, device="cpu", compute_type="int8", local_files_only=True)
    decode = live_asr.make_decoder(model, "en", None, vad_filter=True)
    with tempfile.TemporaryDirectory() as temporary:
        recorded = [
            record(case, scripts[case.script], voice, decode, Path(temporary))
            for case in cases(scripts["chapter.txt"], scripts["chapter-repeated.txt"], repeated_start)
        ]
    fixture = {"voice": Path(args.piper_model).stem, "model": args.model_name, "cases": recorded}
    (out / "tails.json").write_text(json.dumps(fixture, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
