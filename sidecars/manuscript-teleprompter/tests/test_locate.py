"""The tail-audio locate (locate.py, teleprompter-manuscript-integration PRD Phase 9, ADR 0111): placing a recording's
last words in the chapter, the sentence shown for confirmation, the audio cut, and the `--locate` CLI the host drives."""

import importlib.util
import io
import json
import sys
import time
import wave
from contextlib import redirect_stderr
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

CORE = Path(__file__).resolve().parents[1] / "core"


def _load(name):
    spec = importlib.util.spec_from_file_location(name, CORE / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


locate = _load("locate")
live_asr = _load("live_asr")

OPENING = "Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do."
MIDDLE = (
    "Once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, "
    "and what is the use of a book, thought Alice, without pictures or conversations?"
)
CLOSING = (
    "So she was considering in her own mind, as well as she could, for the hot day made her feel very sleepy and stupid, "
    "whether the pleasure of making a daisy-chain would be worth the trouble of getting up and picking the daisies."
)
TOKENS = f"{OPENING} {MIDDLE} {CLOSING}".split()


def _spoken(start, end, tokens=TOKENS):
    """What a narrator says reading tokens[start:end], as Whisper would print it (punctuation kept on the words)."""
    return tokens[start:end]


def test_the_resume_word_is_the_one_after_the_last_word_heard():
    heard = _spoken(20, 50)

    location = locate.locate_tail(heard, TOKENS)

    assert location.word == 50
    assert location.last == 49
    assert location.confident
    assert location.matched == 30


def test_a_garbled_first_word_a_filler_and_a_misheard_word_still_place_the_tail():
    heard = ["ning", *_spoken(20, 30), "um", *_spoken(30, 36), "pitchers", *_spoken(37, 50)]

    location = locate.locate_tail(heard, TOKENS)

    assert location.word == 50
    assert location.confident


def test_a_retake_of_the_last_sentence_resumes_after_it_not_at_a_stray_word_ahead():
    sentence_start = TOKENS.index("Once")
    sentence_end = TOKENS.index("So")
    heard = [*_spoken(sentence_start - 12, sentence_end), *_spoken(sentence_start, sentence_end)]

    location = locate.locate_tail(heard, TOKENS)

    assert location.word == sentence_end
    assert location.confident


def test_a_retake_that_stops_partway_resumes_where_the_recording_stops():
    sentence_start = TOKENS.index("So")
    heard = [*_spoken(sentence_start - 12, len(TOKENS)), *_spoken(sentence_start, sentence_start + 8)]

    location = locate.locate_tail(heard, TOKENS)

    assert location.word == sentence_start + 8


def test_a_narrator_who_stopped_mid_sentence_resumes_at_the_next_word():
    heard = _spoken(10, 33)

    location = locate.locate_tail(heard, TOKENS)

    assert location.word == 33


def test_a_passage_the_chapter_repeats_is_never_confident():
    refrain = "The Queen of Hearts, she made some tarts, all on a summer day: the Knave of Hearts, he stole those tarts, and took them quite away!"
    tokens = f"{OPENING} {refrain} {MIDDLE} {refrain} {CLOSING}".split()
    first = len(OPENING.split())
    heard = tokens[first : first + len(refrain.split())]

    location = locate.locate_tail(heard, tokens)

    assert location.word is not None
    assert not location.confident
    assert location.confidence < 0.1
    assert location.runner_up == location.matched


def test_a_long_tail_that_reaches_past_the_repeated_passage_is_confident_again():
    refrain = "The Queen of Hearts, she made some tarts, all on a summer day."
    tokens = f"{OPENING} {refrain} {MIDDLE} {refrain} {CLOSING}".split()
    second = len(f"{OPENING} {refrain} {MIDDLE}".split())
    heard = tokens[second - 20 : second + len(refrain.split())]

    location = locate.locate_tail(heard, tokens)

    assert location.word == second + len(refrain.split())
    assert location.confident


def test_silence_places_nothing():
    location = locate.locate_tail([], TOKENS)

    assert (location.word, location.last, location.confidence, location.confident, location.heard) == (None, None, 0.0, False, 0)


def test_speech_that_is_not_in_the_chapter_places_nothing():
    location = locate.locate_tail(["sphinx", "quartz", "jumbo", "vexing", "waltz", "nymph", "glyph"], TOKENS)

    assert location.word is None
    assert not location.confident


def test_a_few_fitting_words_are_placed_but_not_confident():
    location = locate.locate_tail(["daisy-chain", "would", "be", "worth"], TOKENS)

    assert location.word == TOKENS.index("worth") + 1
    assert not location.confident


def test_indices_count_punctuation_only_tokens_like_the_live_tracker_does():
    tokens = ["It", "was", "dark", "—", "very", "dark", "—", "and", "the", "rain", "would", "not", "stop", "falling", "on", "the", "roof"]

    location = locate.locate_tail(["very", "dark", "and", "the", "rain", "would", "not", "stop"], tokens)

    assert tokens[location.last] == "stop"
    assert location.word == tokens.index("stop") + 1


def test_the_sentence_runs_between_sentence_ends():
    last = TOKENS.index("thought")

    start, end = locate.sentence_bounds(TOKENS, last, set())

    assert TOKENS[start] == "Once"
    assert TOKENS[end - 1] == "conversations?"


def test_the_sentence_stops_at_a_paragraph_break():
    tokens = ["Chapter", "One", "The", "rain", "came", "down.", "It", "did", "not", "stop"]

    assert locate.sentence_bounds(tokens, 3, {0, 2}) == (2, 6)
    assert locate.sentence_bounds(tokens, 1, {0, 2}) == (0, 2)


def test_the_sentence_ends_at_closing_quotes_after_the_stop():
    tokens = ["“Well!”", "thought", "Alice", "to", "herself."]

    assert locate.sentence_bounds(tokens, 2, set()) == (1, 5)


def test_the_locate_event_carries_the_word_the_sentence_and_the_scores():
    event = locate.locate_event(_spoken(20, 50), TOKENS)

    assert event["type"] == "locate"
    assert (event["word"], event["last"], event["confident"], event["tokens"]) == (50, 49, True, len(TOKENS))
    sentence = event["sentence"]
    assert sentence["start"] <= 49 < sentence["end"]
    assert sentence["text"] == " ".join(TOKENS[sentence["start"] : sentence["end"]])
    assert event["heardText"] == " ".join(_spoken(20, 50))
    assert set(event) == {"type", "word", "last", "sentence", "confidence", "confident", "matched", "heard", "runnerUp", "tokens", "heardText"}


def test_the_locate_event_for_silence_has_no_word_and_no_sentence():
    event = locate.locate_event([], TOKENS)

    assert (event["word"], event["last"], event["sentence"], event["heardText"]) == (None, None, None, "")


def test_the_chosen_span_is_recorded_at_debug_level_with_no_heard_text(monkeypatch):
    monkeypatch.setenv("NARRATION_LOG_LEVEL", "debug")

    buffer = io.StringIO()
    with redirect_stderr(buffer):
        event = locate.locate_event(_spoken(20, 50), TOKENS)

    records = [json.loads(line) for line in buffer.getvalue().splitlines() if line]
    (record,) = [r for r in records if r.get("event") == "locate.span"]
    assert (record["word"], record["matched"], record["heard"]) == (event["word"], event["matched"], event["heard"])
    assert "heardText" not in record
    assert "heard_text" not in record


def test_a_long_chapter_is_searched_quickly():
    rng = np.random.default_rng(7)
    vocabulary = [f"word{index}" for index in range(1500)] + ["the", "and", "of", "a", "to"] * 200
    tokens = [vocabulary[i] for i in rng.integers(0, len(vocabulary), 12000)]
    heard = tokens[9000:9080]

    started = time.perf_counter()
    location = locate.locate_tail(heard, tokens)
    elapsed = time.perf_counter() - started

    assert location.word == 9080
    assert elapsed < 5.0


def _write_steps_wav(path: Path, seconds: int, rate: int = 8000) -> None:
    """A mono 16-bit WAV whose second n holds a constant level of n/10, so a cut can be checked by its level."""
    levels = np.concatenate([np.full(rate, n / 10.0) for n in range(seconds)])
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes((levels * 32767).astype("<i2").tobytes())


def test_read_audio_range_cuts_exactly_the_requested_seconds(tmp_path):
    path = tmp_path / "take.wav"
    _write_steps_wav(path, 8)

    audio = locate.read_audio_range(str(path), 3.0, 6.0)

    assert len(audio) == pytest.approx(3 * locate.SAMPLE_RATE, abs=locate.SAMPLE_RATE // 50)
    assert np.median(audio[: locate.SAMPLE_RATE // 2]) == pytest.approx(0.3, abs=0.01)
    assert np.median(audio[-locate.SAMPLE_RATE // 2 :]) == pytest.approx(0.5, abs=0.01)


def test_read_audio_range_past_the_end_of_the_file_returns_what_there_is(tmp_path):
    path = tmp_path / "take.wav"
    _write_steps_wav(path, 4)

    audio = locate.read_audio_range(str(path), 3.0, 10.0)

    assert len(audio) == pytest.approx(locate.SAMPLE_RATE, abs=locate.SAMPLE_RATE // 50)


def test_run_decodes_only_the_tail_and_places_what_it_heard(tmp_path):
    path = tmp_path / "take.wav"
    _write_steps_wav(path, 6)
    seen = []

    def decode(audio):
        seen.append(len(audio))
        return [(word, 0.0, 0.1) for word in _spoken(20, 50)]

    event = locate.run(str(path), 2.0, 5.0, TOKENS, set(), decode)

    assert seen == [pytest.approx(3 * locate.SAMPLE_RATE, abs=locate.SAMPLE_RATE // 50)]
    assert event["word"] == 50


def test_run_on_an_empty_range_hears_nothing_without_decoding(tmp_path):
    path = tmp_path / "take.wav"
    _write_steps_wav(path, 2)

    event = locate.run(str(path), 5.0, 6.0, TOKENS, set(), lambda audio: pytest.fail("decoded an empty range"))

    assert event["word"] is None


# --- accuracy on recorded tails (spikes/record_locate_tails.py: Piper speech, transcribed by the tiny Whisper model) ---

FIXTURES = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "teleprompter-locate"
TAILS = json.loads((FIXTURES / "tails.json").read_text(encoding="utf-8"))["cases"]

# The accuracy target (ADR 0111): a tail that can be placed resumes within this many words of where the reading
# really stopped, and is confident; a tail that lies wholly in a repeated passage is never confident.
RESUME_TOLERANCE_WORDS = 2


def _fixture_tokens(name):
    return (FIXTURES / name).read_text(encoding="utf-8").split()


def _fixture_breaks(name):
    breaks, start = set(), 0
    for line in (FIXTURES / name).read_text(encoding="utf-8").splitlines():
        breaks.add(start)
        start += len(line.split())
    return breaks


@pytest.mark.parametrize("case", [case for case in TAILS if case["expectConfident"]], ids=lambda case: case["name"])
def test_a_recorded_tail_resumes_within_the_target_and_is_confident(case):
    location = locate.locate_tail(case["heard"], _fixture_tokens(case["script"]))

    assert location.confident, location
    assert abs(location.word - case["expectedWord"]) <= RESUME_TOLERANCE_WORDS, location


@pytest.mark.parametrize("case", [case for case in TAILS if not case["expectConfident"]], ids=lambda case: case["name"])
def test_a_recorded_tail_in_a_repeated_passage_is_low_confidence(case):
    location = locate.locate_tail(case["heard"], _fixture_tokens(case["script"]))

    assert not location.confident, location
    assert location.confidence < 0.1


def test_the_recorded_tails_cover_the_cases_the_prd_names():
    names = {case["name"] for case in TAILS}

    assert {"retake", "repeated-passage", "chapter-end", "mid-sentence", "short-tail"} <= names
    assert any(not case["expectConfident"] for case in TAILS)


def test_the_sentence_of_a_recorded_tail_is_the_one_the_reading_stopped_in():
    case = next(case for case in TAILS if case["name"] == "mid-sentence")
    tokens = _fixture_tokens(case["script"])

    event = locate.locate_event(case["heard"], tokens, _fixture_breaks(case["script"]))

    sentence = event["sentence"]
    assert sentence["start"] <= case["expectedWord"] - 1 < sentence["end"]
    assert sentence["end"] > case["expectedWord"]


# --- the CLI the host drives (apps/desktop/internal/teleprompter/locate.go builds these arguments) ---

HOST_ARGS = [
    "--locate",
    "--engine",
    "whisper",
    "--model",
    "tiny",
    "--model-dir",
    "d",
    "--manuscript",
    "m.json",
    "--chapter",
    "c1",
    "--wav",
    "take.wav",
    "--tail-start",
    "812.5",
    "--tail-end",
    "842.5",
    "--language",
    "en",
]


def test_the_cli_accepts_exactly_the_flags_the_host_passes_for_a_locate():
    ap = live_asr.build_parser()
    args = ap.parse_args(HOST_ARGS)

    locate.check_args(ap, args)

    assert (args.locate, args.wav, args.tail_start, args.tail_end, args.model_dir, args.chapter) == (True, "take.wav", 812.5, 842.5, "d", "c1")


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"model_dir": None}, "--model-dir"),
        ({"wav": None}, "--wav"),
        ({"mic": "Mic"}, "microphone"),
        ({"engine": "moonshine"}, "whisper engine only"),
        ({"manuscript": None, "chapter": None}, "--manuscript"),
        ({"tail_start": None}, "--tail-start and --tail-end"),
        ({"tail_start": -1.0}, "0 <= start < end"),
        ({"tail_end": 812.5}, "0 <= start < end"),
        ({"tail_end": float("inf")}, "0 <= start < end"),
        ({"tail_start": float("nan")}, "0 <= start < end"),
        ({"tail_start": 0.0, "tail_end": 121.0}, "at most 120 seconds"),
    ],
)
def test_the_cli_refuses_a_locate_the_host_could_not_have_asked_for(change, message, capsys):
    ap = live_asr.build_parser()
    args = ap.parse_args(HOST_ARGS)
    for key, value in change.items():
        setattr(args, key, value)

    with pytest.raises(SystemExit) as refused:
        locate.check_args(ap, args)

    assert refused.value.code == 2
    assert message in capsys.readouterr().err


@pytest.mark.parametrize("option", ["--tail-start", "--tail-end"])
@pytest.mark.parametrize("hostile", ["--stop-file", "--wav", "--nonsense", "-x"])
def test_a_tail_value_that_looks_like_an_option_is_refused(option, hostile, capsys):
    with pytest.raises(SystemExit) as refused:
        live_asr.build_parser().parse_args([option, hostile, "value"])

    assert refused.value.code == 2


def _manuscript(tmp_path):
    data = {
        "schemaVersion": 1,
        "documentId": "alice",
        "chapters": [{"id": "c1", "title": "Chapter One", "contentKind": "narration"}],
        "paragraphs": [
            {"id": "p1", "chapterId": "c1", "index": 0, "text": f"{OPENING} {MIDDLE}"},
            {"id": "p2", "chapterId": "c1", "index": 1, "text": CLOSING},
        ],
    }
    path = tmp_path / "manuscript.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def _main(monkeypatch, argv, decoder):
    monkeypatch.setattr(sys, "argv", ["live_asr.py", *argv])
    monkeypatch.setattr(live_asr, "_load_whisper_decoder", decoder)
    live_asr.main()


def test_locate_mode_prints_one_locate_line_for_a_manuscript_chapter(tmp_path, monkeypatch, capsys):
    wav = tmp_path / "take.wav"
    _write_steps_wav(wav, 4)
    chapter_tokens = ["Chapter", "One", *TOKENS]
    loaded = []

    def decoder(args, vad_filter=False):
        loaded.append(vad_filter)
        return lambda audio: [(word, 0.0, 0.1) for word in chapter_tokens[22:52]]

    argv = ["--locate", "--model-dir", "d", "--manuscript", str(_manuscript(tmp_path)), "--chapter", "c1", "--wav", str(wav)]
    _main(monkeypatch, [*argv, "--tail-start", "1", "--tail-end", "3"], decoder)

    lines = capsys.readouterr().out.strip().splitlines()
    assert len(lines) == 1
    event = json.loads(lines[0])
    assert (event["type"], event["word"], event["tokens"]) == ("locate", 52, len(chapter_tokens))
    assert loaded == [True]


def test_locate_mode_refuses_an_unknown_chapter_before_loading_the_model(tmp_path, monkeypatch, capsys):
    argv = ["--locate", "--model-dir", "d", "--manuscript", str(_manuscript(tmp_path)), "--chapter", "nope", "--wav", "take.wav"]

    with pytest.raises(SystemExit) as refused:
        _main(monkeypatch, [*argv, "--tail-start", "1", "--tail-end", "3"], lambda args, vad_filter=False: pytest.fail("loaded the model"))

    assert refused.value.code == 2
    assert "Chapter One" in capsys.readouterr().err


def test_locate_mode_reads_a_plain_script_too(tmp_path, monkeypatch, capsys):
    wav = tmp_path / "take.wav"
    _write_steps_wav(wav, 4)
    script = tmp_path / "script.txt"
    script.write_text(" ".join(TOKENS), encoding="utf-8")

    decoder = lambda args, vad_filter=False: lambda audio: [(word, 0.0, 0.1) for word in TOKENS[20:50]]
    _main(monkeypatch, ["--locate", "--model-dir", "d", "--script", str(script), "--wav", str(wav), "--tail-start", "0", "--tail-end", "2"], decoder)

    assert json.loads(capsys.readouterr().out)["word"] == 50


def test_the_locate_line_matches_the_committed_contract_file(tmp_path):
    from narration_common import contract_files

    tokens, breaks = locate.load_script(SimpleNamespace(manuscript=str(_manuscript(tmp_path)), chapter="c1", script=None))
    heard = ["ning", *tokens[22:40], "um", *tokens[40:52]]

    contract_files.check("teleprompter-locate", locate.locate_event(heard, tokens, breaks))
