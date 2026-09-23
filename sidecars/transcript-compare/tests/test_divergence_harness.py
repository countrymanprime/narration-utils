"""The per-take divergence evaluation (take-review PRD phase 9, Q10) as a gate: every constructed
flub, restart, skip and substitution in fixtures/divergence/cases.json is localized to its span
words and its time, and nothing else is reported, with exact word times and with ASR-like jitter.
The harness's own planning, timing and scoring are tested here too."""

import itertools
import json
import math
import struct
import sys
import wave
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import divergence_harness as harness

compare = harness.load_compare()
td = harness.td


def write_cases(tmp_path, cases, paragraphs=("Alpha bravo charlie delta. Echo foxtrot golf.",)):
    path = tmp_path / "cases.json"
    path.write_text(json.dumps({"schemaVersion": 1, "paragraphs": list(paragraphs), "cases": cases}), encoding="utf-8")
    return path


def case(script, span=(0, 1), case_id="c"):
    return {"id": case_id, "description": "d", "span": list(span), "script": script}


def plan_of(script, span=(0, 1)):
    return harness.plan_case(compare, ("Alpha bravo charlie delta. Echo foxtrot golf.",), harness.Case("c", "d", span[0], span[1], tuple(script)))


# ---------------------------------------------------------------------------
# the gate


@pytest.mark.parametrize("timing", ["exact", "jitter"])
def test_every_constructed_divergence_is_localized_and_nothing_else_is_reported(timing):
    results = harness.run_synthetic(compare, timing)

    summary = harness.summarize(results)
    assert summary["cases"] == len(results) >= 14
    assert summary["localized"] == summary["expected"], harness.report(results)
    assert summary["falsePositives"] == 0, harness.report(results)


def test_the_fixture_covers_every_kind_of_divergence_and_clean_cases():
    _paragraphs, cases = harness.load_cases()
    labels = {segment_kind for c in cases for segment in c.script for segment_kind in segment if segment_kind != "as"}

    assert labels == {"read", "misread", "skip", "unread", "extra", "restart"}
    assert sum(1 for c in cases if not harness.plan_case(compare, _paragraphs, c).truths) >= 2


# ---------------------------------------------------------------------------
# planning


def test_a_plan_places_each_divergence_on_the_span_words_it_touches():
    plan = plan_of([{"read": "Alpha bravo"}, {"misread": "charlie", "as": "charles"}, {"skip": "delta."}, {"restart": "Echo"}, {"read": "Echo foxtrot"}])

    assert [(t.kind, t.label, t.first_word, t.last_word) for t in plan.truths] == [
        (td.MISREAD, "misread", 2, 2),
        (td.SKIPPED, "skip", 3, 3),
        (td.EXTRA, "restart", 4, 4),
        (td.UNREAD, "unread", 6, 6),
    ]
    assert [s.text for s in plan.said] == ["Alpha", "bravo", "charles", "Echo", "Echo", "foxtrot"]


def test_an_extra_after_the_last_word_has_no_anchor():
    plan = plan_of([{"read": "Alpha bravo charlie delta. Echo foxtrot golf."}, {"extra": "cut"}])

    assert [(t.kind, t.first_word) for t in plan.truths] == [(td.EXTRA, None)]


@pytest.mark.parametrize(
    ("script", "message"),
    [
        ([{"read": "Alpha charlie"}], "is not the span's next"),
        ([{"read": "Alpha", "skip": "bravo"}], "a segment is one of"),
        ([{"say": "Alpha"}], "a segment is one of"),
        ([{"extra": "um", "as": "uh"}], "only read and misread take 'as'"),
        ([{"misread": "Alpha"}], "says what was said instead"),
    ],
)
def test_a_script_that_does_not_fit_its_span_is_refused(script, message):
    with pytest.raises(harness.FixtureError, match=message):
        plan_of(script)


def test_a_fixture_file_must_be_this_schema_with_unique_ids(tmp_path):
    with pytest.raises(harness.FixtureError, match="unique"):
        harness.load_cases(write_cases(tmp_path, [case([]), case([])]))
    path = tmp_path / "old.json"
    path.write_text('{"schemaVersion": 0}', encoding="utf-8")
    with pytest.raises(harness.FixtureError, match="schema version"):
        harness.load_cases(path)


# ---------------------------------------------------------------------------
# timing and truth


def test_exact_times_pause_after_a_sentence_and_after_a_false_start():
    plan = plan_of([{"restart": "Alpha"}, {"read": "Alpha bravo charlie delta."}, {"read": "Echo"}])

    times = harness.exact_times(plan)

    step = harness.WORD_SECONDS
    assert times[1][0] == pytest.approx(step + harness.RESTART_PAUSE_SECONDS)
    assert times[5][0] - times[4][0] == pytest.approx(step + harness.SENTENCE_PAUSE_SECONDS)


def test_jittered_times_stay_in_order_and_are_the_same_every_run():
    plan = plan_of([{"read": "Alpha bravo charlie delta. Echo foxtrot golf."}])

    times = harness.jittered_times(plan)

    assert times == harness.jittered_times(plan)
    assert all(later[0] >= earlier[0] for earlier, later in itertools.pairwise(times))
    assert all(end - start >= harness.MIN_WORD_SECONDS - 1e-9 for start, end in times)


def test_a_skip_is_true_at_the_pause_and_unread_text_has_no_true_time():
    plan = plan_of([{"read": "Alpha"}, {"skip": "bravo"}, {"read": "charlie delta."}])
    times = ((0.0, 0.3), (0.5, 0.9), (1.0, 1.2))

    skip, unread = plan.truths
    assert harness.truth_range(plan, times, skip) == (0.3, 0.5)
    assert harness.truth_range(plan, times, unread) is None
    overlapping = ((0.0, 0.6), (0.5, 0.9), (1.0, 1.2))
    assert harness.truth_range(plan, overlapping, skip) == (0.5, 0.6)


def test_a_skip_with_nothing_said_around_it_is_at_zero():
    plan = plan_of([{"skip": "Alpha bravo charlie delta. Echo foxtrot golf."}])

    assert harness.truth_range(plan, (), plan.truths[0]) == (0.0, 0.0)


# ---------------------------------------------------------------------------
# scoring


def divergence(kind, first, last, start, end, text="x"):
    return td.Divergence(kind, td.WITHIN, first, last, "", text, start, end)


def test_a_divergence_far_from_the_true_time_is_found_but_not_localized():
    plan = plan_of([{"read": "Alpha"}, {"misread": "bravo", "as": "brave"}, {"read": "charlie delta. Echo foxtrot golf."}])
    times = harness.exact_times(plan)
    late = divergence(td.MISREAD, 1, 1, times[1][0] + 1.0, times[1][1] + 1.0)

    result = harness.score(plan, times, td.TakeAlignment((), (late,), 0))

    [outcome] = result.outcomes
    assert outcome.words_ok and not outcome.time_ok and not outcome.localized
    assert outcome.boundary_error == pytest.approx(1.0)
    assert "NO" in harness.report([result])


def test_a_missed_divergence_and_a_spurious_one_are_both_reported():
    plan = plan_of([{"read": "Alpha"}, {"skip": "bravo"}, {"read": "charlie delta. Echo foxtrot golf."}])
    times = harness.exact_times(plan)
    spurious = divergence(td.MISREAD, 5, 5, 3.0, 3.3, "fox")

    result = harness.score(plan, times, td.TakeAlignment((), (spurious,), 0))

    assert result.outcomes[0].found is None
    assert result.false_positives == (spurious,)
    text = harness.report([result])
    assert "MISSED" in text and "FALSE +" in text and "'fox'" in text
    assert harness.summarize([result])["falsePositives"] == 1


def test_an_extra_may_be_anchored_one_word_either_side_and_unread_needs_no_time():
    plan = plan_of([{"read": "Alpha"}, {"extra": "uh huh"}, {"read": "bravo charlie"}])
    times = harness.exact_times(plan)
    extra = divergence(td.EXTRA, 2, 2, times[1][0], times[2][1])
    unread = td.Divergence(td.UNREAD, td.AFTER, 3, 6, "", "", None, None)

    result = harness.score(plan, times, td.TakeAlignment((), (extra, unread), 0))

    assert [o.localized for o in result.outcomes] == [True, True]


def test_a_found_divergence_without_time_is_not_localized_against_a_timed_truth():
    assert harness._time((1.0, 2.0), divergence(td.SKIPPED, 0, 0, None, None)) == (False, None)
    assert harness._time(None, divergence(td.MISREAD, 0, 0, 1.0, 2.0)) == (False, None)


def test_a_clean_case_reports_that_nothing_was_expected_or_found():
    plan = plan_of([{"read": "Alpha bravo charlie delta. Echo foxtrot golf."}])

    text = harness.report([harness.score(plan, (), td.TakeAlignment((), (), 0))])

    assert "(clean: nothing expected, nothing found)" in text


# ---------------------------------------------------------------------------
# rendered speech


def test_the_spoken_text_pauses_after_a_false_start_and_knows_each_word_offset():
    plan = plan_of([{"restart": "Alpha bravo"}, {"read": "Alpha bravo charlie"}])

    text, offsets = harness.tts_text(plan)

    assert text == "Alpha bravo, Alpha bravo charlie"
    assert [text[o : o + 5] for o in offsets] == ["Alpha", "bravo", "Alpha", "bravo", "charl"]


def tone_wav(path, pattern, rate=16000):
    """A WAV of 0.1 s blocks: 1 is a loud tone, 0 is silence."""
    frames = []
    for block in pattern:
        for n in range(rate // 10):
            frames.append(int(block * 12000 * math.sin(2 * math.pi * 220 * n / rate)))
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(struct.pack(f"<{len(frames)}h", *frames))


def test_true_word_ends_stop_where_the_speech_stops_not_at_the_next_onset(tmp_path):
    wav = tmp_path / "c.wav"
    tone_wav(wav, [1, 1, 0, 0, 1, 1, 1, 0])
    plan = plan_of([{"read": "Alpha bravo"}], span=(0, 0))
    events = [{"text": "Alpha", "char": 0, "start": 0.0}, {"text": "bravo", "char": 6, "start": 0.4}]

    voiced, frame_seconds = harness.voiced_frames(wav)
    times = harness.onset_times(plan, events, voiced, frame_seconds)

    assert times == ((0.0, 0.2), (0.4, 0.7))


def test_a_word_the_voice_never_reported_is_a_fixture_error():
    plan = plan_of([{"read": "Alpha bravo"}], span=(0, 0))

    with pytest.raises(harness.FixtureError, match="no word at 'bravo'"):
        harness.onset_times(plan, [{"text": "Alpha", "char": 0, "start": 0.0}], (True,) * 10, 0.01)


def test_an_asr_run_transcribes_each_rendered_case_and_scores_it(tmp_path, monkeypatch):
    fixture = write_cases(tmp_path, [case([{"read": "Alpha"}, {"misread": "bravo", "as": "brave"}], span=(0, 0))])
    audio = tmp_path / "audio"
    audio.mkdir()
    tone_wav(audio / "c.wav", [1, 1, 1, 0, 1, 1, 1, 0])
    (audio / "c.json").write_text(json.dumps([{"text": "Alpha", "char": 0, "start": 0.0}, {"text": "brave", "char": 6, "start": 0.4}]), encoding="utf-8")
    calls = []
    monkeypatch.setattr(compare, "decode_segment", lambda path, start, length: calls.append((Path(path).name, start, round(length, 2))) or "audio")
    monkeypatch.setattr(
        compare, "transcribe", lambda audio_, model, language, device, hotwords=None, model_dir=None: [("Alpha", 0.0, 0.3), ("brave", 0.4, 0.7)]
    )

    [(result, transcript)] = harness.run_asr(compare, audio, "small", None, "Arelian", fixture)

    assert calls == [("c.wav", 0.0, 0.8)]
    assert transcript == [("Alpha", 0.0, 0.3), ("brave", 0.4, 0.7)]
    assert [o.localized for o in result.outcomes] == [True, False], "the misread is localized; the diff folds the unread words after it into that misread"


# ---------------------------------------------------------------------------
# the command line


def test_the_command_line_prints_a_report_and_writes_the_speech_plan(tmp_path, capsys):
    assert harness.main(["--timing", "exact"]) == 0
    assert '"localized": ' in capsys.readouterr().out

    plan = tmp_path / "plan.json"
    assert harness.main(["--tts-plan", str(plan)]) == 0
    items = json.loads(plan.read_text(encoding="utf-8"))
    assert {"id", "text"} == set(items[0]) and len(items) >= 14


def test_the_command_line_runs_the_asr_evaluation(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr(
        harness,
        "run_asr",
        lambda engine, audio_dir, model, model_dir, hotwords: [
            (harness.score(plan_of([{"read": "Alpha"}], (0, 0)), (), td.TakeAlignment((), (), 0)), [("Alpha", 0.0, 0.3)])
        ],
    )

    assert harness.main(["--asr", str(tmp_path), "--model", "tiny"]) == 0

    out = capsys.readouterr().out
    assert "# c: Alpha" in out
