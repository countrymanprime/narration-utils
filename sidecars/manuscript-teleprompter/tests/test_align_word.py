"""Punch and roll's offline word-time alignment (align_word.py, teleprompter-manuscript-integration PRD Phase 12,
ADR 0560): timing one script word from a stretch of recording, the `--align-word` CLI the host drives, and its
accuracy on real narration (the LibriVox Alice readings, ADR 0416)."""

import importlib.util
import json
import os
import sys
import wave
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

CORE = Path(__file__).resolve().parents[1] / "core"
REPO = Path(__file__).resolve().parents[3]


def _load(name):
    spec = importlib.util.spec_from_file_location(name, CORE / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


align_word = _load("align_word")
locate = _load("locate")
live_asr = _load("live_asr")

TEXT = (
    "Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do. "
    "Once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, "
    "and what is the use of a book, thought Alice, without pictures or conversations?"
)
TOKENS = TEXT.split()
WORD_SECONDS = 0.4


def _timed(start, end, tokens=TOKENS, origin=0.0):
    """What Whisper gives for a narrator reading tokens[start:end] at an even pace from `origin` seconds: each word
    lasts 0.3 s, then 0.1 s to the next."""
    return [(tokens[i], origin + (i - start) * WORD_SECONDS, origin + (i - start) * WORD_SECONDS + 0.3) for i in range(start, end)]


# --- timing a word ---


def test_a_heard_word_is_timed_at_its_own_start():
    result = align_word.word_time(_timed(10, 40, origin=5.0), TOKENS, 25)

    assert result.time == pytest.approx(5.0 + 15 * WORD_SECONDS)
    assert result.exact
    assert result.matched == 30


def test_a_misread_word_is_placed_between_the_words_heard_around_it():
    timed = _timed(10, 40)
    timed[15] = ("pitchers", *timed[15][1:])  # TOKENS[25] misheard as a word that is nowhere near

    result = align_word.word_time(timed, TOKENS, 25)

    assert not result.exact
    # Halfway from word 24's start (5.6 s) to word 26's (6.4 s).
    assert result.time == pytest.approx(6.0)


def test_a_run_of_dropped_words_is_spread_across_the_gap():
    timed = [entry for index, entry in enumerate(_timed(10, 40)) if not 12 <= index <= 14]  # words 22-24 not heard

    times = [align_word.word_time(timed, TOKENS, word).time for word in (22, 23, 24)]

    # The narrator's pace: words 22-24 start where they were really spoken, 0.4 s apart.
    assert times == pytest.approx([12 * WORD_SECONDS, 13 * WORD_SECONDS, 14 * WORD_SECONDS])
    assert times == sorted(times)


def test_fillers_and_a_garbled_first_word_do_not_move_the_time():
    timed = [("ning", 0.0, 0.2), *_timed(10, 20, origin=0.5), ("um", 4.5, 4.7), *_timed(20, 40, origin=5.0)]

    result = align_word.word_time(timed, TOKENS, 30)

    assert result.exact
    assert result.time == pytest.approx(5.0 + 10 * WORD_SECONDS)


def test_a_word_outside_what_was_heard_has_no_time():
    timed = _timed(10, 40)

    assert align_word.word_time(timed, TOKENS, 5).time is None
    assert align_word.word_time(timed, TOKENS, 45).time is None
    assert align_word.word_time(timed, TOKENS, len(TOKENS) + 3).time is None


def test_silence_and_speech_not_in_the_chapter_time_nothing():
    assert align_word.word_time([], TOKENS, 12).time is None
    foreign = [(word, i * 0.4, i * 0.4 + 0.3) for i, word in enumerate(["the", "quick", "brown", "fox", "jumps", "over", "the", "lazy", "dog", "today"])]
    assert align_word.word_time(foreign, TOKENS, 12).time is None


def test_too_few_fitting_words_are_not_trusted():
    result = align_word.word_time(_timed(20, 22), TOKENS, 21)

    assert result.time is None
    assert result.matched == 2


def test_indices_count_punctuation_only_tokens_and_one_is_timed_as_the_next_word():
    tokens = ["Alice", "—", *TOKENS[1:]]
    timed = [(tokens[0], 0.0, 0.3), *[(word, 0.4 * i, 0.4 * i + 0.3) for i, word in enumerate(tokens[2:30], start=1)]]

    assert align_word.word_time(timed, tokens, 2).time == pytest.approx(0.4)
    assert align_word.word_time(timed, tokens, 1).time == pytest.approx(0.4)


def test_the_event_is_in_seconds_of_the_file():
    event = align_word.word_time_event(_timed(10, 40), TOKENS, 25, offset=700.0)

    assert event == {"type": "word_time", "word": 25, "time": pytest.approx(706.0), "exact": True, "matched": 30, "heard": 30, "tokens": len(TOKENS)}


def test_the_event_for_a_word_not_heard_has_a_null_time():
    event = align_word.word_time_event([], TOKENS, 25, offset=700.0)

    assert (event["time"], event["exact"], event["matched"]) == (None, False, 0)


def test_the_result_is_logged_at_debug_level_with_no_heard_text(monkeypatch):
    calls = []
    monkeypatch.setattr(align_word, "log", lambda message, **fields: calls.append((message, fields)))

    align_word.word_time_event(_timed(10, 40), TOKENS, 25)

    ((_, fields),) = calls
    assert fields["level"] == "debug"
    assert "heard" in fields and not any(isinstance(value, str) and "Alice" in value for value in fields.values())


def _write_steps_wav(path, seconds, rate=16000):
    """A WAV whose level steps up by 0.1 every second, so a cut can be checked by its level."""
    levels = np.concatenate([np.full(rate, 0.1 * (second % 9), dtype=np.float32) for second in range(seconds)])
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes((levels * 32767).astype("<i2").tobytes())


def test_run_decodes_only_the_range_and_times_the_word_in_seconds_of_the_file(tmp_path):
    path = tmp_path / "take.wav"
    _write_steps_wav(path, 6)
    seen = []

    def decode(audio):
        seen.append(len(audio))
        return _timed(10, 40, origin=0.25)

    event = align_word.run(str(path), 2.0, 5.0, TOKENS, 25, decode)

    assert seen == [pytest.approx(3 * locate.SAMPLE_RATE, abs=locate.SAMPLE_RATE // 50)]
    assert event["time"] == pytest.approx(2.0 + 0.25 + 15 * WORD_SECONDS)


def test_run_on_an_empty_range_times_nothing_without_decoding(tmp_path):
    path = tmp_path / "take.wav"
    _write_steps_wav(path, 2)

    event = align_word.run(str(path), 5.0, 6.0, TOKENS, 3, lambda audio: pytest.fail("decoded an empty range"))

    assert event["time"] is None


# --- the CLI the host drives (apps/desktop/internal/teleprompter/alignword.go builds these arguments) ---

HOST_ARGS = [
    "--align-word",
    "812",
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
    "700.5",
    "--tail-end",
    "820.5",
    "--language",
    "en",
]


def test_the_cli_accepts_exactly_the_flags_the_host_passes_for_an_alignment():
    ap = live_asr.build_parser()
    args = ap.parse_args(HOST_ARGS)

    align_word.check_args(ap, args)

    assert (args.align_word, args.locate, args.wav, args.tail_start, args.tail_end, args.model_dir) == (812, False, "take.wav", 700.5, 820.5, "d")


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"align_word": -1}, "0 or more"),
        ({"locate": True}, "separate runs"),
        ({"model_dir": None}, "--align-word needs --model-dir"),
        ({"wav": None}, "--align-word needs --wav"),
        ({"mic": "Mic"}, "microphone"),
        ({"engine": "moonshine"}, "whisper engine only"),
        ({"manuscript": None, "chapter": None}, "--manuscript"),
        ({"tail_end": None}, "--tail-start and --tail-end"),
        ({"tail_start": float("nan")}, "0 <= start < end"),
        ({"tail_start": 0.0, "tail_end": 121.0}, "at most 120 seconds"),
    ],
)
def test_the_cli_refuses_an_alignment_the_host_could_not_have_asked_for(change, message, capsys):
    ap = live_asr.build_parser()
    args = ap.parse_args(HOST_ARGS)
    for key, value in change.items():
        setattr(args, key, value)

    with pytest.raises(SystemExit) as refused:
        align_word.check_args(ap, args)

    assert refused.value.code == 2
    assert message in capsys.readouterr().err


@pytest.mark.parametrize("hostile", ["--stop-file", "--wav", "-x", "12.5", "twelve"])
def test_a_word_value_that_is_not_a_whole_number_is_refused(hostile, capsys):
    with pytest.raises(SystemExit) as refused:
        live_asr.build_parser().parse_args(["--align-word", hostile])

    assert refused.value.code == 2


def _manuscript(tmp_path):
    data = {
        "schemaVersion": 1,
        "documentId": "alice",
        "chapters": [{"id": "c1", "title": "Chapter One", "contentKind": "narration"}],
        "paragraphs": [{"id": "p1", "chapterId": "c1", "index": 0, "text": TEXT}],
    }
    path = tmp_path / "manuscript.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def _main(monkeypatch, argv, decoder):
    monkeypatch.setattr(sys, "argv", ["live_asr.py", *argv])
    monkeypatch.setattr(live_asr, "_load_whisper_decoder", decoder)
    live_asr.main()


def test_align_word_mode_prints_one_word_time_line_for_a_manuscript_chapter(tmp_path, monkeypatch, capsys):
    wav = tmp_path / "take.wav"
    _write_steps_wav(wav, 4)
    chapter_tokens = ["Chapter", "One", *TOKENS]
    loaded = []

    def decoder(args, vad_filter=False):
        loaded.append(vad_filter)
        return lambda audio: _timed(12, 42, tokens=chapter_tokens)

    argv = ["--align-word", "27", "--model-dir", "d", "--manuscript", str(_manuscript(tmp_path)), "--chapter", "c1", "--wav", str(wav)]
    _main(monkeypatch, [*argv, "--tail-start", "1", "--tail-end", "3"], decoder)

    lines = capsys.readouterr().out.strip().splitlines()
    assert len(lines) == 1
    event = json.loads(lines[0])
    assert (event["type"], event["word"], event["exact"], event["tokens"]) == ("word_time", 27, True, len(chapter_tokens))
    assert event["time"] == pytest.approx(1.0 + 15 * WORD_SECONDS)
    assert loaded == [True]


def test_align_word_mode_refuses_an_unknown_chapter_before_loading_the_model(tmp_path, monkeypatch, capsys):
    argv = ["--align-word", "3", "--model-dir", "d", "--manuscript", str(_manuscript(tmp_path)), "--chapter", "nope", "--wav", "take.wav"]

    with pytest.raises(SystemExit) as refused:
        _main(monkeypatch, [*argv, "--tail-start", "1", "--tail-end", "3"], lambda args, vad_filter=False: pytest.fail("loaded the model"))

    assert refused.value.code == 2
    assert "Chapter One" in capsys.readouterr().err


def test_the_word_time_line_matches_the_committed_contract_file(tmp_path):
    from narration_common import contract_files

    tokens, _breaks = locate.load_script(SimpleNamespace(manuscript=str(_manuscript(tmp_path)), chapter="c1", script=None))
    timed = [("ning", 0.0, 0.2), *_timed(12, 42, tokens=tokens, origin=0.5)]

    contract_files.check(
        "teleprompter-word-time", [align_word.word_time_event(timed, tokens, 27, offset=700.0), align_word.word_time_event([], tokens, 27, offset=700.0)]
    )


# --- real narration: the LibriVox Alice readings (tests/fixtures/audio/librivox-alice, ADR 0416) ---

LIBRIVOX = REPO / "tests" / "fixtures" / "audio" / "librivox-alice"
# A window as long as the host ever asks for (teleprompter.MaxTailSeconds), well inside Chapter I's reading.
WINDOW = (200.0, 320.0)
# How far a word placed between two heard neighbours may land from where it was really spoken, measured on four
# windows of Chapter I (2026-09-28: 95th percentile 0.13-0.22 s, worst 0.52-1.01 s, at a dropped word after a pause).
PLACED_P95_SECONDS = 0.3
PLACED_MAX_SECONDS = 1.2
WINDOWS = [(60.0, 180.0), WINDOW, (400.0, 520.0), (600.0, 720.0)]
# How far the tiny model's word start may be from large-v3-turbo's for the same word in the gated decode.
DECODED_TOLERANCE_SECONDS = 0.5


def _librivox():
    sys.path.insert(0, str(LIBRIVOX))
    import alice_text
    import sources

    return alice_text, sources


def _chapter_one(tmp_path):
    alice_text, _ = _librivox()
    chapters = list(alice_text.load_chapters().values())
    path = tmp_path / "manuscript.json"
    path.write_text(json.dumps(alice_text.manuscript_json(chapters, "alice")), encoding="utf-8")
    return locate.load_script(SimpleNamespace(manuscript=str(path), chapter="c-0001", script=None))[0]


def _reference_words(source_id, window=WINDOW):
    """large-v3-turbo's committed word timings (alignment/<id>.words.json) inside `window`, relative to its start."""
    words = json.loads((LIBRIVOX / "alignment" / f"{source_id}.words.json").read_text(encoding="utf-8"))["words"]
    return [(text, start - window[0], end - window[0]) for text, start, end in words if window[0] <= start and end <= window[1]]


def _heard_positions(timed, tokens):
    """Each script word the reference heard in the window, with its start: the word's time where it was heard."""
    aligned = align_word.align_stretch(timed, tokens)
    return {word: result.time for word in range(len(tokens)) if (result := align_word.time_of(aligned, word)).exact}


def test_on_a_real_reading_every_heard_word_in_the_window_is_timed_where_it_was_spoken(tmp_path):
    tokens = _chapter_one(tmp_path)
    timed = _reference_words("kara_01")

    heard = _heard_positions(timed, tokens)

    span = range(min(heard), max(heard) + 1)
    assert len(heard) / len(span) >= 0.95, "the window's script words were found in the real reading"
    assert all(a < b for a, b in zip([heard[w] for w in sorted(heard)], [heard[w] for w in sorted(heard)][1:], strict=False))


@pytest.mark.parametrize("window", WINDOWS, ids=lambda window: f"{window[0]:g}-{window[1]:g}s")
def test_on_a_real_reading_words_whisper_dropped_or_misheard_land_close_to_where_they_were_spoken(tmp_path, window):
    tokens = _chapter_one(tmp_path)
    timed = _reference_words("kara_01", window)
    truth = _heard_positions(timed, tokens)
    # Knock out every fifth heard word and garble every seventh: the decoder the app runs (tiny) drops and mishears
    # words the reference heard, and those are the words the punch must still place.
    damaged = [("zzkq", start, end) if index % 7 == 3 else (text, start, end) for index, (text, start, end) in enumerate(timed) if index % 5 != 2]

    aligned = align_word.align_stretch(damaged, tokens)
    errors = sorted(abs(result.time - spoken) for word, spoken in truth.items() if (result := align_word.time_of(aligned, word)).time is not None)

    assert len(errors) >= 0.95 * len(truth)
    assert float(np.median(errors)) <= 0.05, "most words are still heard exactly"
    assert errors[int(0.95 * len(errors)) - 1] <= PLACED_P95_SECONDS
    assert errors[-1] <= PLACED_MAX_SECONDS


def test_on_a_real_reading_a_paragraphs_first_word_is_timed_at_the_markers_paragraph_start(tmp_path):
    alice_text, _ = _librivox()
    manuscript = tmp_path / "manuscript.json"
    manuscript.write_text(json.dumps(alice_text.manuscript_json(list(alice_text.load_chapters().values()), "alice")), encoding="utf-8")
    from chapter_script import load_chapter_script

    chapter = load_chapter_script(str(manuscript), "c-0001")
    markers = json.loads((LIBRIVOX / "alignment" / "kara_01.markers.json").read_text(encoding="utf-8"))
    starts = {row["id"]: row["start_s"] for row in markers["paragraphs"]}
    timed = _reference_words("kara_01")

    aligned = align_word.align_stretch(timed, chapter.tokens)
    checked = 0
    for span in chapter.spans:
        if span.kind != "paragraph" or not WINDOW[0] + 5 < starts[span.id] < WINDOW[1] - 5:
            continue
        result = align_word.time_of(aligned, span.start)
        assert result.time is not None
        assert result.time + WINDOW[0] == pytest.approx(starts[span.id], abs=0.3), span.id
        checked += 1
    assert checked >= 2


def _whisper_model_dir():
    return os.environ.get("NARRATION_WHISPER_MODEL_DIR", "")


def _recording_fetched():
    _, sources = _librivox()
    source = sources.load_sources()["kara_01"]
    return sources.present(source, sources.sources_dir())


@pytest.mark.skipif(
    not (_whisper_model_dir() and _recording_fetched()),
    reason="needs the LibriVox recordings (build.py fetch) and NARRATION_WHISPER_MODEL_DIR (a faster-whisper model directory)",
)
def test_the_real_decode_times_words_where_the_reference_heard_them(tmp_path):
    """The whole mode on real audio: the shipped decoder (the model in NARRATION_WHISPER_MODEL_DIR) over a window of
    Kara Shallenberg's Chapter I, each timed word checked against large-v3-turbo's committed timing for it."""
    _, sources = _librivox()
    recording = sources.sources_dir() / sources.load_sources()["kara_01"]["file"]
    tokens = _chapter_one(tmp_path)
    truth = _heard_positions(_reference_words("kara_01"), tokens)
    args = SimpleNamespace(model_dir=_whisper_model_dir(), model="tiny", device="cpu", language="en", hotwords=None, timing=False)
    decode = live_asr._load_whisper_decoder(args, vad_filter=True)
    audio = locate.read_audio_range(str(recording), *WINDOW)
    timed = list(decode(audio))

    aligned = align_word.align_stretch(timed, tokens)
    sample = sorted(truth)[:: max(1, len(truth) // 40)]
    errors = [abs(result.time - truth[word]) for word in sample if (result := align_word.time_of(aligned, word)).time is not None]

    assert len(errors) >= 0.9 * len(sample)
    assert float(np.median(errors)) <= DECODED_TOLERANCE_SECONDS / 2
    assert sorted(errors)[int(0.9 * len(errors)) - 1] <= DECODED_TOLERANCE_SECONDS
