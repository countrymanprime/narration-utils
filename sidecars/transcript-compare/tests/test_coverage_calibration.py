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


# ---------------------------------------------------------------------------
# the model cascade (docs/prds/recording-check-model-cascade.prd.md, Phase 1)


def _played(*ranges):
    return tuple(cal.Played(index, start, end) for index, (start, end) in enumerate(ranges))


def _gap(before=None, after=None):
    return cal.Gap(cal.Bound(*before) if before else None, cal.Bound(*after) if after else None)


def test_a_short_gap_becomes_one_window_padded_to_the_minimum_around_its_bounds():
    plan = cal.plan_windows([_gap((0, 100.0), (0, 104.0))], _played((0.0, 600.0)))

    (span,) = plan.spans
    assert span.seconds == pytest.approx(cal.WINDOW_MIN_SECONDS)
    assert span.start < 100.0 - cal.WINDOW_PAST_BOUND_SECONDS and span.end > 104.0 + cal.WINDOW_PAST_BOUND_SECONDS
    assert (span.start + span.end) / 2 == pytest.approx(102.0)
    assert not plan.whole_chapter


def test_a_long_gap_keeps_its_bounds_plus_the_margin_past_each():
    (span,) = cal.plan_windows([_gap((0, 100.0), (0, 160.0))], _played((0.0, 600.0))).spans

    assert (span.start, span.end) == pytest.approx((100.0 - cal.WINDOW_PAST_BOUND_SECONDS, 160.0 + cal.WINDOW_PAST_BOUND_SECONDS))


def test_padding_shifts_inside_the_item_and_a_short_item_is_read_whole():
    (near_start,) = cal.plan_windows([_gap((0, 5.0), (0, 8.0))], _played((2.0, 600.0))).spans
    assert (near_start.start, near_start.end) == pytest.approx((2.0, 2.0 + cal.WINDOW_MIN_SECONDS))

    (near_end,) = cal.plan_windows([_gap((0, 595.0), (0, 597.0))], _played((0.0, 600.0))).spans
    assert (near_end.start, near_end.end) == pytest.approx((600.0 - cal.WINDOW_MIN_SECONDS, 600.0))

    (short,) = cal.plan_windows([_gap((0, 5.0), (0, 8.0))], _played((1.0, 16.0), (0.0, 600.0))).spans
    assert (short.item, short.start, short.end) == (0, 1.0, 16.0)


def test_a_head_runs_from_the_first_item_start_and_a_tail_to_the_last_item_end():
    played = _played((0.0, 300.0), (10.0, 400.0))

    (head,) = cal.plan_windows([_gap(None, (0, 50.0))], played).spans
    assert (head.item, head.start, head.end) == pytest.approx((0, 0.0, 50.0 + cal.WINDOW_PAST_BOUND_SECONDS))

    (tail,) = cal.plan_windows([_gap((1, 350.0), None)], played).spans
    assert (tail.item, tail.start, tail.end) == pytest.approx((1, 350.0 - cal.WINDOW_PAST_BOUND_SECONDS, 400.0))


def test_a_gap_across_items_becomes_one_slice_per_item_and_the_items_between_are_whole():
    played = _played((0.0, 300.0), (5.0, 200.0), (0.0, 500.0))

    spans = cal.plan_windows([_gap((0, 290.0), (2, 10.0))], played).spans

    assert [span.item for span in spans] == [0, 1, 2]
    assert (spans[0].start, spans[0].end) == pytest.approx((300.0 - cal.WINDOW_MIN_SECONDS, 300.0))
    assert (spans[1].start, spans[1].end) == (5.0, 200.0)
    assert (spans[2].start, spans[2].end) == pytest.approx((0.0, cal.WINDOW_MIN_SECONDS))


def test_windows_closer_than_the_merge_gap_merge_and_others_stay_apart():
    played = _played((0.0, 900.0))
    near = cal.plan_windows([_gap((0, 100.0), (0, 101.0)), _gap((0, 130.0), (0, 131.0))], played).spans
    far = cal.plan_windows([_gap((0, 100.0), (0, 101.0)), _gap((0, 160.0), (0, 161.0))], played).spans

    assert len(near) == 1 and near[0].start < 100.0 and near[0].end > 131.0
    assert len(far) == 2 and far[1].start - far[0].end >= cal.WINDOW_MERGE_GAP_SECONDS


def test_windows_over_the_share_of_the_chapter_become_a_whole_chapter_pass():
    played = _played((0.0, 60.0), (2.0, 42.0))

    plan = cal.plan_windows([_gap((0, 10.0), (0, 40.0)), _gap((1, 10.0), (1, 20.0))], played)

    assert plan.whole_chapter
    assert [(span.item, span.start, span.end) for span in plan.spans] == [(0, 0.0, 60.0), (1, 2.0, 42.0)]
    assert plan.seconds == pytest.approx(100.0)


def test_no_gap_plans_no_window():
    plan = cal.plan_windows([], _played((0.0, 60.0)))

    assert plan.spans == () and plan.seconds == 0 and not plan.whole_chapter


def test_the_splice_replaces_first_pass_words_inside_a_window_and_keeps_the_rest():
    first = [("a", 1.0, 1.4), ("b", 10.0, 10.4), ("c", 20.0, 20.4), ("d", 40.0, 40.4)]
    recheck = [("B", 10.1, 10.5), ("x", 15.0, 15.4), ("C", 20.0, 20.3)]

    words = cal.splice(first, [cal.Span(0, 5.0, 30.0)], [recheck], cal.Played(0, 0.0, 60.0))

    assert [word[0] for word in words] == ["a", "B", "x", "C", "d"]


def test_the_splice_trusts_neither_pass_twice_at_a_cut_edge():
    # A word cut by the window's start: the re-check heard part of it at the edge, the first pass all of it.
    first = [("cut", 4.8, 5.3), ("in", 12.0, 12.4), ("end", 29.7, 30.3)]
    recheck = [("ut", 5.0, 5.3), ("in", 12.0, 12.4), ("en", 29.7, 30.0)]

    words = cal.splice(first, [cal.Span(0, 5.0, 30.0)], [recheck], cal.Played(0, 0.0, 60.0))

    assert words == (("cut", 4.8, 5.3), ("in", 12.0, 12.4), ("end", 29.7, 30.3))


def test_the_splice_has_no_edge_where_the_window_meets_the_item_edge():
    recheck = [("first", 0.0, 0.3), ("last", 59.8, 60.0)]

    words = cal.splice([("old", 0.0, 0.4)], [cal.Span(0, 0.0, 60.0)], [recheck], cal.Played(0, 0.0, 60.0))

    assert [word[0] for word in words] == ["first", "last"]


def _case(case_id):
    return next(case for case in harness.load_corpus(harness.FIXTURE_DIR).cases if case.id == case_id)


def _scripted_words(case, target, drop=()):
    words = {}
    for item, spec in zip(target.items, case.items, strict=True):
        kept = tuple((w.text, w.start, w.end) for n, w in enumerate(spec.words) if n not in drop)
        words[item.index] = cal.coverage_mode.ItemWords(kept, item.start_offset, item.end, "tiny", "en", None)
    return words


def test_the_in_process_alignment_is_the_sidecars(tmp_path):
    case = _case("c2-skipped-sentence")
    target = cal.case_target(case, MANUSCRIPT, tmp_path / "t")

    aligned = cal.align_words(target, _scripted_words(case, target), cal.SHIPPED)
    sidecar = cal.run_in_process(case, MANUSCRIPT, tmp_path / "s", cal.SHIPPED)

    assert aligned.coverage.present_tokens == sidecar.summary["presentTokens"]
    assert len(aligned.coverage.regions) == len(sidecar.regions)
    assert cal.is_complete(aligned.coverage, cal.SHIPPED) == cal.text_complete(sidecar, cal.SHIPPED) is False
    assert [region.item for region in cal.found_regions(aligned)] == [r["position"]["itemIndex"] for r in sidecar.regions]
    assert [region.time for region in cal.found_regions(aligned)] == [r["position"]["sourceTime"] for r in sidecar.regions]


def test_a_skip_is_bounded_by_the_matched_words_on_either_side(tmp_path):
    case = _case("c2-skipped-sentence")
    target = cal.case_target(case, MANUSCRIPT, tmp_path)
    chapter = case.chapter
    said = len(chapter.paragraphs[0].text.split()) + len(harness.split_sentences(chapter.paragraphs[1].text)[0].split())
    words = case.items[0].words

    aligned = cal.align_words(target, _scripted_words(case, target), cal.SHIPPED)
    (region,) = cal.failing_regions(aligned.coverage, cal.SHIPPED)
    gap = cal.region_gap(region, aligned)

    assert gap.before == cal.Bound(0, words[said - 1].end)
    assert gap.after == cal.Bound(0, words[said].start)


def test_a_head_is_bounded_by_the_title_when_it_was_read(tmp_path):
    case = _case("c2-late-start")  # "Chapter two." read, then the first paragraph skipped
    target = cal.case_target(case, MANUSCRIPT, tmp_path)
    words = case.items[0].words

    read = cal.align_words(target, _scripted_words(case, target), cal.SHIPPED)
    untitled = cal.align_words(target, _scripted_words(case, target, drop=range(2)), cal.SHIPPED)

    assert cal.region_gap(read.coverage.regions[0], read).before.time <= words[1].end
    assert cal.region_gap(untitled.coverage.regions[0], untitled).before is None


def test_a_tail_has_no_word_after(tmp_path):
    case = _case("c1-truncated-tail")
    target = cal.case_target(case, MANUSCRIPT, tmp_path)
    aligned = cal.align_words(target, _scripted_words(case, target), cal.SHIPPED)
    gaps = [cal.region_gap(region, aligned) for region in aligned.coverage.regions if region.kind == "tail"]

    assert gaps and all(gap.after is None and gap.before is not None for gap in gaps)


def test_an_alignment_with_no_words_has_no_bounds(tmp_path):
    case = _case("c2-late-start")
    target = cal.case_target(case, MANUSCRIPT, tmp_path)
    silent = {index: dataclasses.replace(words, words=()) for index, words in _scripted_words(case, target).items()}

    aligned = cal.align_words(target, silent, cal.SHIPPED)

    assert {cal.region_gap(region, aligned) for region in aligned.coverage.regions} == {cal.Gap(None, None)}
    assert {(region.item, region.time) for region in cal.found_regions(aligned)} == {(None, None)}


def _coverage(paragraphs, regions, longest):
    return cal.coverage_model.ChapterCoverage(
        cal.coverage_model.AlignmentParams(),
        sum(p.tokens for p in paragraphs),
        sum(p.present for p in paragraphs),
        0,
        longest,
        tuple(paragraphs),
        tuple(regions),
    )


def test_only_regions_that_fail_the_chapter_are_rechecked():
    passing = cal.coverage_model.ParagraphCoverage("p-1", 100, 98, 2)
    failing = cal.coverage_model.ParagraphCoverage("p-2", 20, 17, 3)
    short = cal.coverage_model.Region("skip", ("p-1",), 2, "a", "b", 0, 2, 0)
    in_failing = cal.coverage_model.Region("skip", ("p-2",), 3, "a", "b", 110, 113, 50)
    long_run = cal.coverage_model.Region("skip", ("p-1",), 4, "a", "b", 10, 14, 5)

    assert cal.failing_regions(_coverage([passing, failing], [short, in_failing], 3), cal.PROPOSED) == (in_failing,)
    assert cal.failing_regions(_coverage([passing], [short, long_run], 4), cal.SHIPPED) == (long_run,)
    assert cal.failing_regions(_coverage([passing], [short], 2), cal.SHIPPED) == ()


def _truth_transcriber(case, calls):
    def transcribe(item, span):
        calls.append(span)
        words = tuple((w.text, w.start, w.end) for w in case.items[span.item].words if span.start <= w.start and w.end <= span.end)
        return cal.coverage_mode.ItemWords(words, span.start, span.end, "large-v3-turbo", "en", None), 2.5

    return transcribe


def test_the_cascade_rechecks_words_the_first_pass_lost_and_calls_the_chapter_complete(tmp_path):
    case = _case("c2-subtitle-read")
    target = cal.case_target(case, MANUSCRIPT, tmp_path)
    calls = []

    outcome = cal.cascade(target, _scripted_words(case, target, drop=range(60, 67)), _truth_transcriber(case, calls), cal.PROPOSED)

    assert not outcome.first_complete and outcome.complete
    assert len(calls) == 1 and outcome.plan.spans == tuple(calls) and not outcome.plan.whole_chapter
    assert outcome.recheck_seconds == 2.5
    assert outcome.final.coverage.present_tokens == outcome.final.coverage.body_tokens
    assert outcome.words[0].model == "tiny+large-v3-turbo"


def test_the_cascade_keeps_a_real_gap_missing(tmp_path):
    case = _case("c2-skipped-sentence")
    target = cal.case_target(case, MANUSCRIPT, tmp_path)

    outcome = cal.cascade(target, _scripted_words(case, target), _truth_transcriber(case, []), cal.PROPOSED)

    assert not outcome.first_complete and not outcome.complete and outcome.plan.spans


def test_a_complete_first_pass_never_loads_the_second_model(tmp_path):
    case = _case("c2-subtitle-read")
    target = cal.case_target(case, MANUSCRIPT, tmp_path)
    calls = []

    outcome = cal.cascade(target, _scripted_words(case, target), _truth_transcriber(case, calls), cal.PROPOSED)

    assert outcome.first_complete and outcome.complete and outcome.plan.spans == () and calls == []
    assert outcome.recheck_seconds == 0 and outcome.final is outcome.first


def test_the_first_pass_words_are_read_from_each_items_words_file(tmp_path):
    case = _case("c1-multiple-items-trimmed")
    target = cal.case_target(case, MANUSCRIPT, tmp_path)

    words = cal.read_item_words(target, tmp_path)

    assert sorted(words) == [0, 1, 2]
    with pytest.raises(FileNotFoundError, match="no words file"):
        cal.read_item_words(target, tmp_path / "elsewhere")


def test_a_muted_item_is_left_out_of_the_alignment_and_the_windows(tmp_path):
    case = _case("c1-multiple-items-trimmed")
    target = cal.case_target(case, MANUSCRIPT, tmp_path)
    muted = dataclasses.replace(target, items=(dataclasses.replace(target.items[0], muted=True), *target.items[1:]))
    words = {index: w for index, w in _scripted_words(case, target).items() if index}

    aligned = cal.align_words(muted, words, cal.SHIPPED)

    assert sorted(cal.read_item_words(muted, tmp_path)) == [1, 2]
    assert [p.index for p in cal.played_ranges(muted)] == [1, 2]
    assert aligned.coverage.present_tokens < aligned.coverage.body_tokens


def test_rechecked_windows_are_kept_with_their_time_and_never_transcribed_twice(tmp_path):
    calls = []

    def inner(item, span):
        calls.append(span)
        return cal.coverage_mode.ItemWords((("word", span.start + 1, span.start + 1.4),), span.start, span.end, "large-v3-turbo", "en", None), 7.0

    item = cal.coverage_mode.ManifestItem(0, "g", "a.wav", 0.0, 60.0, "w.json", False)
    cached = cal.cached_span_transcriber(tmp_path, inner)

    first = cached(item, cal.Span(0, 5.0, 30.0))
    again = cached(item, cal.Span(0, 5.0, 30.0))

    assert calls == [cal.Span(0, 5.0, 30.0)]
    assert first == again and again[1] == 7.0


def test_a_run_that_reused_every_words_file_reports_the_time_of_the_run_that_transcribed(tmp_path):
    transcribed = cal.SidecarResult({"items": {"transcribed": 2}}, (), (), (), 40.0)
    reused = cal.SidecarResult({"items": {"transcribed": 0}}, (), (), (), 0.4)

    assert cal.with_stored_seconds(reused, tmp_path).seconds == 0.4  # nothing stored yet
    assert cal.with_stored_seconds(transcribed, tmp_path).seconds == 40.0
    assert cal.with_stored_seconds(reused, tmp_path).seconds == 40.0


def test_a_manifest_target_reads_the_hosts_manifest(tmp_path):
    manifest = tmp_path / "manifest.json"
    item = {"index": 0, "itemGuid": "g", "sourceFile": "a.wav", "startOffset": 2.0, "length": 60.0, "wordsFile": "w-1.json", "muted": False}
    manifest.write_text(json.dumps({"schemaVersion": 1, "items": [item]}), encoding="utf-8")

    target = cal.manifest_target("real", manifest, MANUSCRIPT, "c-0001")
    written = cal.write_manifest(target, tmp_path / "words")

    assert target.expected is None and target.items[0].start_offset == 2.0
    assert json.loads(written.read_text(encoding="utf-8"))["items"] == [item]


def _row(case_id, expected, tiny, cascade, small, large, windows=0, recheck=0.0):
    singles = {"small": cal.Single(small, 30.0), "large-v3-turbo": cal.Single(large, 60.0)}
    return cal.CascadeRow(case_id, expected, tiny, cascade, windows, windows * 25.0, False, 10.0, recheck, 0.1, singles)


def test_the_cascade_report_tallies_verdicts_and_times_and_judges_the_hypothesis():
    rows = [
        _row("a", True, True, True, True, True),
        _row("b", False, False, False, False, False, 1, 8.0),
        _row("c", True, False, True, False, True, 2, 9.0),
    ]

    text = cal.cascade_table(rows, cal.PROPOSED)
    verdict = cal.hypothesis(rows)

    assert "| c | True | False | True | 2 | 50 | 10.0 | 9.0 | 19.1 | False | 30.0 | True | 60.0 |" in text
    assert "| cascade (tiny + large-v3-turbo) | 3 | 0 | 0 | 47.3 |" in text
    assert "| small | 3 | 0 | 1 | 90.0 |" in text
    assert verdict.go and verdict.cascade_seconds == pytest.approx(47.3) and verdict.small_seconds == 90.0
    assert "Go:" in text


def test_the_hypothesis_fails_on_a_false_met_more_false_not_met_or_too_much_time():
    false_met = [_row("a", False, True, True, False, False)]
    worse = [_row("a", True, False, False, True, True)]
    slow = [_row("a", True, False, True, True, True, 3, 200.0)]

    assert not cal.hypothesis(false_met).go
    assert not cal.hypothesis(worse).go
    assert not cal.hypothesis(slow).go
    assert "No-go:" in cal.cascade_table(slow, cal.PROPOSED)


def _found(start, end, item=0, time=1.0):
    return cal.FoundRegion("skip", end - start, start, end, item, time)


def test_regions_agree_when_their_manuscript_words_overlap():
    ours = [_found(0, 5), _found(20, 30), _found(50, 52)]
    theirs = [_found(3, 8), _found(40, 45)]

    both, only_ours, only_theirs = cal.region_agreement(ours, theirs)

    assert both == 1 and only_ours == [ours[1], ours[2]] and only_theirs == [theirs[1]]


def test_a_position_reads_as_item_and_minutes():
    assert cal.position_text(cal.FoundRegion("skip", 4, 0, 4, 2, 125.4)) == "item 3 at 2:05"
    assert cal.position_text(cal.FoundRegion("tail", 4, 0, 4, None, None)) == "no audio"


def test_the_chapter_report_compares_each_run_with_the_reference():
    ref = cal.ChapterRun("large-v3-turbo", {"proposed": False, "shipped": True}, (_found(10, 16, 0, 61.0),), 300.0)
    both = cal.ChapterRun("cascade", {"proposed": False, "shipped": False}, (_found(11, 16, 0, 61.5), _found(90, 99, 1, 5.0)), 90.0, 2, 50.0)

    text = cal.chapter_report([ref, both], "large-v3-turbo")

    assert "| cascade | False | False | 2 | 2 | 50 | 90.0 | 1 | 1 | 0 |" in text
    assert "- item 2 at 0:05: skip, 9 words, found by cascade only" in text
    assert "| large-v3-turbo | False | True | 1 |  |  | 300.0 | 1 | 0 | 0 |" in text


def test_benchmark_offsets_differ_and_stay_inside_the_audio():
    offsets = cal.bench_offsets(600.0, 60.0, 3)

    assert len(set(offsets)) == 3 and all(0 <= o <= 540.0 for o in offsets)
    assert cal.bench_offsets(30.0, 60.0, 2) == [0.0, 0.0]


def test_the_benchmark_table_lists_each_window_and_the_merge_comparison():
    text = cal.windows_table("large-v3-turbo", 3.2, [(5, 4.6), (60, 16.8)], 12.2, 14.4)

    assert "large-v3-turbo: model load 3.2 s" in text
    assert "| 60 | 16.8 | 16.8 |" in text
    assert "three 10 s windows 12.2 s; one 60 s window over them 14.4 s" in text
