"""The Phase 8 calibration, pinned: the app ships the settings the calibration chose, those settings
hold on the held-out cases at every simulated noise level, the two resolution settings are the
loosest that catch a skipped or replaced phrase, and the tooling reads the sidecar's results the way
the host does (`docs/research/recording-coverage-calibration.md`, ADR 0132)."""

import dataclasses
import json
import wave
from pathlib import Path

import coverage_calibration as cal
import coverage_harness as harness
import coverage_spike as spike
import numpy as np
import pytest

REPOSITORY = Path(__file__).resolve().parents[3]
MANUSCRIPT = harness.FIXTURE_DIR / "manuscript.json"


@pytest.fixture(scope="module")
def cases():
    return cal.calibration_cases()


@pytest.fixture(scope="module")
def held_out(cases, tmp_path_factory):
    chosen = [case for case in cases if case.split == "held_out"]
    table = cal.collect(chosen, cal.NOISE_LEVELS, [cal.SHIPPED.alignment], tmp_path_factory.mktemp("held-out"))
    return chosen, table


def test_the_app_ships_the_calibrated_settings():
    defaults = json.loads((REPOSITORY / "config" / "defaults.json").read_text(encoding="utf-8"))["RecordingCoverage"]
    shipped = cal.Settings(
        float(defaults["min_paragraph_present"]), int(defaults["max_missing_run"]), int(defaults["max_misread_run"]), int(defaults["min_anchor_run"])
    )

    assert shipped == cal.SHIPPED
    assert (spike.cov.Thresholds().min_paragraph_present, spike.cov.Thresholds().max_missing_run) == (0.8, 3)
    assert (spike.cov.AlignmentParams().max_misread_run, spike.cov.AlignmentParams().min_anchor_run) == (8, 3)


def test_the_shipped_settings_never_call_a_held_out_incomplete_chapter_complete(held_out):
    chosen, table = held_out
    for noise in cal.NOISE_LEVELS:
        assert cal.tally(table, chosen, noise, cal.SHIPPED).false_met == 0, noise.name


def test_the_shipped_settings_pass_every_held_out_complete_chapter_under_light_noise(held_out):
    chosen, table = held_out
    for noise in cal.NOISE_LEVELS[:2]:  # none and light: about what the small model made of the Piper renders
        tally = cal.tally(table, chosen, noise, cal.SHIPPED)
        assert tally.false_not_met == 0, noise.name
        assert tally.complete > 0


def test_the_proposed_threshold_fails_complete_chapters_under_light_noise(held_out):
    # The reason the paragraph share moved from 0.95: one dropped word in a 20-word paragraph fails it.
    chosen, table = held_out
    light = cal.NOISE_LEVELS[1]
    assert cal.tally(table, chosen, light, dataclasses.replace(cal.SHIPPED, min_paragraph_present=0.95)).false_not_met > 0


def test_one_word_more_on_either_resolution_setting_passes_a_skipped_or_replaced_phrase(tmp_path):
    resolution = cal.resolution_cases()
    looser = {
        "max_missing_run": dataclasses.replace(cal.SHIPPED, max_missing_run=cal.SHIPPED.max_missing_run + 1),
        "max_misread_run": dataclasses.replace(cal.SHIPPED, max_misread_run=cal.SHIPPED.max_misread_run + 1),
    }
    table = cal.collect(resolution, cal.NOISE_LEVELS[:1], sorted({s.alignment for s in (cal.SHIPPED, *looser.values())}), tmp_path)

    assert cal.tally(table, resolution, cal.NOISE_LEVELS[0], cal.SHIPPED).false_met == 0
    for name, settings in looser.items():
        assert cal.tally(table, resolution, cal.NOISE_LEVELS[0], settings).false_met > 0, name


def test_resolution_cases_leave_out_or_replace_a_phrase_just_over_the_limits():
    resolution = cal.resolution_cases()
    skipped = [case for case in resolution if "-skipped-phrase-" in case.id]
    replaced = [case for case in resolution if "-replaced-phrase-" in case.id]

    assert skipped and replaced
    assert min(cal.SKIPPED_PHRASE_WORDS) == cal.SHIPPED.max_missing_run + 1
    assert cal.REPLACED_PHRASE_WORDS == cal.SHIPPED.max_misread_run + 1
    for case in resolution:
        assert not case.expected.text_complete
        assert list(case.expected.paragraphs.values()).count("partial") == 1
        said = sum(len(item.words) for item in case.items)
        body = sum(len(paragraph.text.split()) for paragraph in case.chapter.paragraphs)
        assert said == (body if "-replaced-" in case.id else body - int(case.id.split("-")[-2])), case.id


def test_calibration_splits_generated_cases_by_chapter(cases):
    generated = [case for case in cases if ":" in case.id]
    assert {case.split for case in generated} == set(harness.SPLITS)
    for case in generated:
        assert (case.split == "held_out") == (case.chapter.id in cal.STRESS_HELD_OUT_CHAPTERS), case.id


def test_the_command_line_sidecar_writes_what_the_in_process_run_writes(tmp_path):
    case = harness.load_corpus(harness.FIXTURE_DIR).cases[0]

    in_process = cal.run_in_process(case, MANUSCRIPT, tmp_path / "a", cal.SHIPPED)
    cli = cal.run_cli(case, MANUSCRIPT, tmp_path / "b", tmp_path / "b" / "out.txt", cal.SHIPPED)

    assert (in_process.summary, in_process.paragraphs, in_process.regions) == (cli.summary, cli.paragraphs, cli.regions)
    assert in_process.summary["alignment"] == {"maxMisreadRun": cal.SHIPPED.max_misread_run, "minAnchorRun": cal.SHIPPED.min_anchor_run}


def test_every_committed_case_scores_right_through_the_sidecar(tmp_path):
    committed = harness.load_corpus(harness.FIXTURE_DIR).cases
    for case in committed:
        result = cal.run_in_process(case, MANUSCRIPT, tmp_path / case.id, cal.SHIPPED)
        report = cal.harness_report(result, cal.SHIPPED)
        assert report.text_complete == case.expected.text_complete, case.id
        assert set(report.paragraphs) == set(case.expected.paragraphs)


def _result(paragraphs, longest=0):
    return cal.SidecarResult({"longestMissingRun": longest}, tuple(paragraphs), (), ())


def test_text_complete_is_the_hosts_rule():
    settings = cal.SHIPPED
    full = {"id": "p-1", "tokens": 10, "present": 10, "longestMissingRun": 0}
    thin = {"id": "p-2", "tokens": 10, "present": 7, "longestMissingRun": 2}
    long_run = {"id": "p-3", "tokens": 40, "present": 36, "longestMissingRun": 4}
    empty = {"id": "p-4", "tokens": 0, "present": 0, "longestMissingRun": 0}

    assert cal.text_complete(_result([full, empty]), settings)
    assert not cal.text_complete(_result([full, thin]), settings)  # 70% read
    assert not cal.text_complete(_result([full, long_run], longest=4), settings)
    assert not cal.text_complete(_result([full], longest=4), settings)  # a run across paragraphs
    report = cal.harness_report(_result([full, thin, {"id": "p-5", "tokens": 10, "present": 1, "longestMissingRun": 9}]), settings)
    assert dict(report.paragraphs) == {"p-1": "present", "p-2": "partial", "p-5": "missing"}


def test_noise_is_seeded_per_case_and_keeps_the_labels():
    case = next(case for case in harness.load_corpus(harness.FIXTURE_DIR).cases if case.id == "c1-complete-title-omitted")
    heavy = cal.NOISE_LEVELS[-1]

    first, second = cal.with_asr_noise(case, heavy), cal.with_asr_noise(case, heavy)

    assert first == second
    assert first.expected == case.expected
    words = [word.text for word in case.items[0].words]
    noisy = [word.text for word in first.items[0].words]
    assert len(noisy) < len(words)
    assert noisy != words[: len(noisy)]
    assert cal.with_asr_noise(case, cal.NOISE_LEVELS[0]) is case


def test_bursts_drop_runs_of_words():
    words = tuple(harness.Word(f"w{n}", n, n + 1) for n in range(20))
    burst = cal.Noise("burst", burst=3, burst_every=10)

    kept = [word.text for word in cal._noisy_words(words, burst, cal.random.Random(1))]

    assert kept == [f"w{n}" for n in range(20) if n not in (5, 6, 7, 15, 16, 17)]


def test_choose_takes_the_safe_candidate_that_passes_the_most_then_the_nearest_to_proposed():
    complete = harness.build_case(
        {"id": "complete", "conditions": ["complete"], "split": "tune", "recording": {"items": [{"id": "i", "segments": [{"read": "p-000001"}]}]},
         "expected": {"textComplete": True, "paragraphs": {"p-000001": "present"}, "regions": []}},
        cal.harness.Chapter("c", "", "", (harness.Paragraph("p-000001", "one two three"),)),
    )  # fmt: skip
    incomplete = dataclasses.replace(complete, id="incomplete", expected=dataclasses.replace(complete.expected, text_complete=False))
    none = cal.NOISE_LEVELS[0]
    table = {
        (none.name, "complete", (8, 3)): _result([{"id": "p-000001", "tokens": 10, "present": 9, "longestMissingRun": 1}], 1),
        (none.name, "incomplete", (8, 3)): _result([{"id": "p-000001", "tokens": 10, "present": 6, "longestMissingRun": 4}], 4),
    }
    candidates = [cal.Settings(share, run, 8, 3) for share in (0.8, 0.95) for run in (1, 3, 4)]

    chosen = cal.choose(table, [complete, incomplete], [none], candidates)

    assert chosen == cal.Settings(0.8, 3, 8, 3)  # 0.95 fails the complete case; run 4 passes the incomplete one; run 1 is further from 3
    with pytest.raises(ValueError, match="no candidate"):
        cal.choose(table, [complete, incomplete], [none], [cal.Settings(0.5, 8, 8, 3)])


def test_chance_credit_counts_words_credited_in_a_replaced_paragraph():
    case = next(case for case in cal.calibration_cases() if case.id.endswith("-unrelated-1") and case.split == "tune")
    missing = next(pid for pid, value in case.expected.paragraphs.items() if value == "missing")
    none = cal.NOISE_LEVELS[0]
    table = {(none.name, case.id, (8, 3)): _result([{"id": missing, "tokens": 30, "present": 2, "longestMissingRun": 28}])}

    assert cal.chance_credit(table, [case], none, cal.SHIPPED) == 2
    assert not cal.is_safe(table, [case], [none], cal.SHIPPED)


def test_the_synthetic_report_prints_the_tables(tmp_path):
    cases = [case for case in harness.load_corpus(harness.FIXTURE_DIR).cases]
    grid = {"min_paragraph_present": (0.8, 0.95), "max_missing_run": (3,), "max_misread_run": (8,), "min_anchor_run": (3,)}

    text, chosen = cal.synthetic_report(tmp_path, grid, cal.NOISE_LEVELS[:2], cases)

    assert chosen == cal.SHIPPED
    assert "| Chosen (0.8, 3, 8, 3) | light | held_out |" in text
    assert "| min_paragraph_present | 0.8 (chosen) |" in text
    assert "Paragraph labels agreed" in text


def test_a_played_range_renders_only_the_words_inside_it():
    chapter = harness.Chapter("c", "", "", (harness.Paragraph("p-1", "one two three four five"),))
    words = harness.WORD_SECONDS

    pause, clock = cal._segment_texts({"pause": 2.0}, chapter, 0.0, (1.0, 10.0), "test")
    assert (pause, clock) == (1.0, 2.0)
    text, clock = cal._segment_texts({"read": "p-1"}, chapter, 0.0, (words, 3 * words), "test")
    assert (text, clock) == ("two three", 5 * words)
    said, _ = cal._segment_texts({"say": "hello there"}, chapter, 0.0, (0.0, float("inf")), "test")
    assert said == "hello there"


def test_audio_is_never_rendered_inside_the_repository(tmp_path):
    with pytest.raises(ValueError, match="inside the repository"):
        cal.render_audio_corpus(tmp_path / "voice.onnx", REPOSITORY / "sidecars" / "rendered")


def test_transcript_errors_counts_dropped_swapped_and_added_words(tmp_path):
    case = next(case for case in harness.load_corpus(harness.FIXTURE_DIR).cases if case.id == "c4-misread")
    said = [word.text for item in case.items for word in item.words]
    heard = [*said[:5], "zebra", *said[7:], "again"]  # two words become one, one word added at the end
    words_dir = tmp_path / "words"
    item = case.items[0]
    words = tuple((text, float(n), float(n) + 0.4) for n, text in enumerate(heard))
    cal.coverage_mode.write_words_file(words_dir / f"000-{item.id}.json", cal.coverage_mode.ItemWords(words, 0.0, 999.0, "small", "en", None))
    result = cal.SidecarResult({}, (), (), ({"index": 0, "itemGuid": item.id},))

    counts = cal.transcript_errors(case, result, words_dir)

    assert (counts["swapped"], counts["dropped"], counts["added"]) == (1, 1, 1)


def test_an_audio_item_is_listed_with_its_length_and_no_words_file(tmp_path):
    audio = tmp_path / "item.wav"
    with wave.open(str(audio), "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(16000)
        writer.writeframes(np.zeros(8000, dtype=np.int16).tobytes())
    case = dataclasses.replace(harness.load_corpus(harness.FIXTURE_DIR).cases[0], items=(harness.Item("a", None, audio),))

    manifest = json.loads(cal.write_inputs(case, tmp_path / "words").read_text(encoding="utf-8"))

    (item,) = manifest["items"]
    assert item["length"] == pytest.approx(0.5)
    assert item["sourceFile"] == str(audio.resolve())
    assert not (tmp_path / "words" / item["wordsFile"]).exists()


def test_a_whisper_run_passes_the_model_directory_and_language(tmp_path):
    case = harness.load_corpus(harness.FIXTURE_DIR).cases[0]
    args = cal._args(case, MANUSCRIPT, tmp_path, tmp_path / "out.txt", cal.SHIPPED, cal.Whisper("small", tmp_path / "model"))

    assert args[args.index("--model") + 1] == "small"
    assert args[args.index("--model-dir") + 1] == str(tmp_path / "model")
    assert args[args.index("--language") + 1] == "en"


def test_a_failed_sidecar_run_is_an_error_and_a_scripted_case_is_never_transcribed(tmp_path):
    case = harness.load_corpus(harness.FIXTURE_DIR).cases[0]
    with pytest.raises(RuntimeError, match="exited with 1"):
        cal.run_cli(case, tmp_path / "no-manuscript.json", tmp_path / "w", tmp_path / "w" / "out.txt", cal.SHIPPED)
    with pytest.raises(AssertionError, match="never be transcribed"):
        cal._no_transcription(cal.SimpleNamespace(item_guid="i"), None)


def test_transcript_errors_counts_a_dropped_word(tmp_path):
    case = next(case for case in harness.load_corpus(harness.FIXTURE_DIR).cases if case.id == "c4-misread")
    said = [word.text for item in case.items for word in item.words]
    item = case.items[0]
    words = tuple((text, float(n), float(n) + 0.4) for n, text in enumerate(said[:3] + said[4:]))
    cal.coverage_mode.write_words_file(tmp_path / f"000-{item.id}.json", cal.coverage_mode.ItemWords(words, 0.0, 999.0, "small", "en", None))

    counts = cal.transcript_errors(case, cal.SidecarResult({}, (), (), ({"index": 0, "itemGuid": item.id},)), tmp_path)

    assert (counts["dropped"], counts["swapped"], counts["added"]) == (1, 0, 0)
