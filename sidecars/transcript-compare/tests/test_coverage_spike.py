"""The Phase 2 alignment spike, pinned: coverage over `SequenceMatcher` scores every committed
recording-coverage case correctly and never calls an incomplete chapter complete, and the DP
prototype it was measured against is a valid alignment
(docs/utilities/recording-coverage.md, ADR 0126, Q2; `docs/research/recording-coverage-alignment-spike.md`)."""

import difflib

import coverage_harness as harness
import coverage_spike as spike
import pytest


@pytest.fixture(scope="module")
def committed():
    return harness.load_corpus(harness.FIXTURE_DIR).cases


@pytest.fixture(scope="module")
def stress():
    return spike.stress_cases()


def test_coverage_scores_every_committed_case_and_label(committed):
    evaluation = harness.evaluate(committed, spike.coverage_analyzer())
    summary = evaluation.summary()

    assert (summary.false_met, summary.false_not_met) == (0, 0)
    assert summary.paragraphs_agreed == summary.paragraphs_total
    assert summary.regions_kind_matched == summary.regions_total


def test_coverage_never_calls_a_generated_incomplete_chapter_complete(stress):
    summary = harness.evaluate(stress, spike.coverage_analyzer()).summary()

    assert (summary.false_met, summary.false_not_met) == (0, 0)


def test_the_only_generated_label_misses_are_pickups_longer_than_what_follows(stress):
    # An in-order alignment credits the longer of two readings; when the pickup at the end is
    # longer than the text after its place, the text after is blamed instead. The verdict stays
    # "not complete". The spike records this for both aligners.
    evaluation = harness.evaluate(stress, spike.coverage_analyzer())
    wrong = {result.case.id for result in evaluation.results if result.paragraphs_agreed < len(result.case.expected.paragraphs)}

    assert wrong and all("-pickup-" in case_id for case_id in wrong)


def test_unrelated_speech_of_a_paragraphs_length_credits_none_of_it(stress):
    for case in (case for case in stress if "-unrelated-" in case.id):
        result = spike.cov.compute_coverage(spike.align_case(case.chapter, case.items), spike.SPIKE_PARAMS)
        (missing,) = [pid for pid, value in case.expected.paragraphs.items() if value == "missing"]
        assert result.by_id[missing].present == 0, case.id


def test_coverage_reports_the_region_kinds_the_harness_labels():
    assert spike.cov.REGION_KINDS == harness.REGION_KINDS


def test_stress_cases_obey_the_harness_labeling_rules(stress):
    assert len(stress) > 50
    assert len({case.id for case in stress}) == len(stress)
    assert {"skipped_paragraph", "pickup_at_end", "unrelated_speech", "misread", "retakes_and_false_starts", "skipped_sentence"} <= {
        condition for case in stress for condition in case.conditions
    }


def test_the_coverage_analyzer_skips_audio_cases(committed):
    case = committed[0]
    audio_item = harness.Item("item-1", None, harness.FIXTURE_DIR / "take.wav")

    with pytest.raises(harness.NeedsAudio):
        spike.coverage_analyzer()(case.chapter, (audio_item,))


@pytest.mark.parametrize(
    ("doc", "audio"),
    [
        ("a b c d e", "a b c d e"),
        ("a b c d e", "a b x d e"),
        ("a b c d e", "a e"),
        ("a b c", "x a b c y"),
        ("", "a b"),
        ("a b", ""),
        ("a b c d", "e f g"),
    ],
)
def test_the_dp_prototype_tiles_both_sequences_and_matches_as_many_words_as_lcs(doc, audio):
    doc, audio = doc.split(), audio.split()

    opcodes = spike.lcs_opcodes(doc, audio)

    spike.cov.AlignedChapter(tuple(doc), tuple(doc), (0,) * len(doc), ("p-000001",), tuple(audio), tuple(opcodes))  # validates the tiling
    matched = sum(i2 - i1 for tag, i1, i2, _j1, _j2 in opcodes if tag == "equal")
    matcher = difflib.SequenceMatcher(None, doc, audio, autojunk=False)
    assert matched >= sum(block.size for block in matcher.get_matching_blocks())


def test_the_dp_prototype_credits_a_retake_over_the_attempt_before_it():
    opcodes = spike.lcs_opcodes(["a", "b", "c"], ["a", "b", "a", "b", "c"])

    assert ("equal", 0, 3, 2, 5) in opcodes


def test_the_dp_prototype_refuses_inputs_its_matrix_cannot_count(monkeypatch):
    monkeypatch.setattr(spike, "DP_MAX_TOKENS", 2)

    with pytest.raises(ValueError, match="at most 2 tokens"):
        spike.lcs_opcodes(["a", "b", "c"], ["a"])


def test_the_benchmark_times_both_aligners_on_a_chapter_sized_input():
    timings = spike.benchmark(target_tokens=300, repeats=1)

    assert timings["doc_tokens"] >= 300
    assert set(spike.ALIGNERS) <= set(timings)
    assert timings["dp_matrix_mib"] > 0


def test_the_report_lists_both_aligners_on_every_set(monkeypatch):
    monkeypatch.setattr(spike, "benchmark", lambda: {"doc_tokens": 1, "audio_tokens": 1, "SequenceMatcher": 0.001, "DP (LCS)": 0.002, "dp_matrix_mib": 0.0})

    text = spike.report()

    for name in spike.ALIGNERS:
        for split in (*harness.SPLITS, "stress"):
            assert f"| {name} | {split} |" in text
    assert "Benchmark:" in text
