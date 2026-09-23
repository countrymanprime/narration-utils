"""Tests for the recording-coverage ground-truth harness and its committed synthetic fixtures
(docs/utilities/recording-coverage.md, ADR 0125, Q15 and D12 as amended 2026-09-23).

The harness scores any analyzer against per-paragraph labels; these tests pin the fixture
format, the label consistency rules, the scoring, the stub analyzer and the directory-variable
hook through which a permissioned corpus (audio outside the repo) can join or replace the set."""

import importlib.util
import json
import os
from pathlib import Path

import coverage_harness as harness
import pytest

COMPARE_PATH = Path(__file__).resolve().parents[1] / "core" / "compare.py"
_TMP = {}


@pytest.fixture(autouse=True)
def _tmp_factory(tmp_path_factory):
    _TMP["factory"] = tmp_path_factory


def _tmp():
    return _TMP["factory"].mktemp("corpus")


def _chapter_text(paragraphs):
    return {
        "schemaVersion": 1,
        "documentId": "doc-test",
        "chapters": [{"id": "c-0001", "title": "Chapter One", "subtitle": "A Test", "contentKind": "narration"}],
        "paragraphs": [{"id": pid, "chapterId": "c-0001", "index": index, "text": text} for index, (pid, text) in enumerate(paragraphs)],
    }


PARAGRAPHS = [
    ("p-000001", "The first paragraph has seven plain words."),
    ("p-000002", "Second paragraph opens here. It has two sentences in it."),
    ("p-000003", "Third and last paragraph ends the chapter."),
]


def _case(**overrides):
    case = {
        "schemaVersion": 1,
        "id": "complete",
        "chapter": "c-0001",
        "conditions": ["complete"],
        "split": "tune",
        "description": "Every paragraph read once, in order.",
        "recording": {"items": [{"id": "item-1", "segments": [{"read": "p-000001"}, {"read": "p-000002"}, {"read": "p-000003"}]}]},
        "expected": {
            "textComplete": True,
            "paragraphs": {"p-000001": "present", "p-000002": "present", "p-000003": "present"},
            "regions": [],
        },
    }
    case.update(overrides)
    return case


def _write_corpus(directory, cases, paragraphs=PARAGRAPHS):
    (directory / "cases").mkdir(parents=True)
    (directory / "manuscript.json").write_text(json.dumps(_chapter_text(paragraphs)), encoding="utf-8")
    for case in cases:
        (directory / "cases" / f"{case['id']}.json").write_text(json.dumps(case), encoding="utf-8")
    return directory


def _incomplete_tail_case():
    return _case(
        id="tail",
        conditions=["truncated_tail"],
        recording={"items": [{"id": "item-1", "segments": [{"read": "p-000001"}, {"read": "p-000002"}]}]},
        expected={
            "textComplete": False,
            "paragraphs": {"p-000001": "present", "p-000002": "present", "p-000003": "missing"},
            "regions": [{"kind": "tail", "paragraphs": ["p-000003"]}],
        },
    )


# ---------------------------------------------------------------------------
# rendering a scripted recording into transcript words


def test_render_reads_a_paragraph_as_timed_words():
    corpus = harness.load_corpus(_write_corpus(_tmp(), [_case()]))
    item = corpus.cases[0].items[0]

    assert [word.text for word in item.words[:3]] == ["The", "first", "paragraph"]
    assert item.words[0].start == 0.0
    assert item.words[0].end == pytest.approx(harness.WORD_SECONDS)
    assert item.words[1].start == pytest.approx(harness.WORD_SECONDS)


def test_render_selects_sentences_and_words_and_spoken_forms():
    segments = [
        {"read": "p-000002", "sentences": [1, 2]},
        {"read": "p-000001", "words": [0, 2]},
        {"read": "p-000003", "as": "Third and final paragraph ends the chapter."},
        {"say": "Sorry, again."},
    ]
    corpus = harness.load_corpus(_write_corpus(_tmp(), [_case(recording={"items": [{"id": "item-1", "segments": segments}]})]))

    spoken = " ".join(word.text for word in corpus.cases[0].items[0].words)

    assert spoken == "It has two sentences in it. The first Third and final paragraph ends the chapter. Sorry, again."


def test_render_drops_words_outside_the_played_range_and_times_them_from_its_start():
    segments = [{"pause": 2.0}, {"say": "one two"}, {"pause": 1.0}, {"say": "three"}]
    item = {"id": "item-1", "segments": segments, "playedRange": [1.5, 3.0]}
    corpus = harness.load_corpus(_write_corpus(_tmp(), [_case(recording={"items": [item]})]))

    words = corpus.cases[0].items[0].words

    assert [(word.text, word.start, word.end) for word in words] == [("one", 0.5, pytest.approx(0.9)), ("two", pytest.approx(0.9), pytest.approx(1.3))]


def test_split_sentences_keeps_closing_quotes_with_their_sentence():
    assert harness.split_sentences('"Oh dear!" she said. Then she ran.') == ['"Oh dear!"', "she said.", "Then she ran."]


# ---------------------------------------------------------------------------
# loading and validation


def test_load_corpus_reads_chapters_through_the_canonical_manuscript_loader():
    corpus = harness.load_corpus(_write_corpus(_tmp(), [_case()]))

    chapter = corpus.cases[0].chapter
    assert (chapter.id, chapter.title, chapter.subtitle) == ("c-0001", "Chapter One", "A Test")
    assert [paragraph.id for paragraph in chapter.paragraphs] == ["p-000001", "p-000002", "p-000003"]


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"schemaVersion": 2}, "schemaVersion"),
        ({"id": "other-name"}, "file name"),
        ({"chapter": "c-9999"}, "unknown chapter"),
        ({"conditions": []}, "conditions"),
        ({"conditions": ["weather"]}, "unknown condition"),
        ({"split": "train"}, "split"),
        ({"recording": {"items": []}}, "items"),
        ({"recording": {"items": [{"id": "item-1"}]}}, "exactly one of"),
        ({"recording": {"items": [{"id": "item-1", "segments": [{"read": "p-000404"}]}]}}, "unknown paragraph"),
        ({"recording": {"items": [{"id": "item-1", "segments": [{"read": "p-000001", "words": [0, 1], "sentences": [0, 1]}]}]}}, "both"),
        ({"recording": {"items": [{"id": "item-1", "segments": [{"read": "p-000001", "words": [3, 2]}]}]}}, "range"),
        ({"recording": {"items": [{"id": "item-1", "segments": [{"sing": "la"}]}]}}, "segment"),
        ({"recording": {"items": [{"id": "item-1", "segments": [{"pause": -1}]}]}}, "pause"),
        ({"recording": {"items": [{"id": "item-1", "segments": [{"say": "hi"}], "playedRange": [2, 1]}]}}, "playedRange"),
        ({"recording": {"items": [{"id": "a", "segments": [{"say": "x"}]}, {"id": "a", "segments": [{"say": "y"}]}]}}, "duplicate item"),
    ],
)
def test_load_corpus_rejects_malformed_cases(change, message):
    directory = _write_corpus(_tmp(), [_case(**change)] if "id" not in change else [])
    if "id" in change:
        (directory / "cases" / "complete.json").write_text(json.dumps(_case(**change)), encoding="utf-8")

    with pytest.raises(harness.FixtureError, match=message):
        harness.load_corpus(directory)


@pytest.mark.parametrize(
    ("expected", "message"),
    [
        ({"textComplete": True, "paragraphs": {"p-000001": "present", "p-000002": "present"}, "regions": []}, "every paragraph"),
        ({"textComplete": True, "paragraphs": {"p-000001": "present", "p-000002": "present", "p-000003": "gone"}, "regions": []}, "label"),
        ({"textComplete": True, "paragraphs": {"p-000001": "present", "p-000002": "partial", "p-000003": "present"}, "regions": []}, "textComplete"),
        (
            {"textComplete": False, "paragraphs": {"p-000001": "present", "p-000002": "present", "p-000003": "missing"}, "regions": []},
            "not covered by a region",
        ),
        (
            {
                "textComplete": False,
                "paragraphs": {"p-000001": "present", "p-000002": "present", "p-000003": "missing"},
                "regions": [{"kind": "hole", "paragraphs": ["p-000003"]}],
            },
            "region kind",
        ),
        (
            {
                "textComplete": False,
                "paragraphs": {"p-000001": "present", "p-000002": "present", "p-000003": "missing"},
                "regions": [{"kind": "tail", "paragraphs": ["p-000002", "p-000003"]}],
            },
            "present paragraph",
        ),
        (
            {
                "textComplete": False,
                "paragraphs": {"p-000001": "present", "p-000002": "present", "p-000003": "missing"},
                "regions": [{"kind": "tail", "paragraphs": []}],
            },
            "region paragraphs",
        ),
    ],
)
def test_load_corpus_rejects_inconsistent_labels(expected, message):
    directory = _write_corpus(_tmp(), [_case(expected=expected)])

    with pytest.raises(harness.FixtureError, match=message):
        harness.load_corpus(directory)


def test_load_corpus_refuses_a_case_on_a_chapter_that_is_not_narration():
    directory = _write_corpus(_tmp(), [_case()])
    manuscript = json.loads((directory / "manuscript.json").read_text(encoding="utf-8"))
    manuscript["chapters"][0]["contentKind"] = "opening"
    (directory / "manuscript.json").write_text(json.dumps(manuscript), encoding="utf-8")

    with pytest.raises(harness.FixtureError, match="unknown chapter"):
        harness.load_corpus(directory)


def test_load_corpus_rejects_a_directory_without_a_manuscript():
    directory = _tmp()
    (directory / "cases").mkdir()

    with pytest.raises(harness.FixtureError, match="manuscript"):
        harness.load_corpus(directory)


def test_load_corpus_rejects_unreadable_case_json():
    directory = _write_corpus(_tmp(), [])
    (directory / "cases" / "broken.json").write_text("{not json", encoding="utf-8")

    with pytest.raises(harness.FixtureError, match="broken.json"):
        harness.load_corpus(directory)


def test_audio_items_resolve_inside_the_corpus_directory():
    directory = _write_corpus(_tmp(), [_case(recording={"items": [{"id": "item-1", "audio": "audio/take-1.wav"}]})])

    item = harness.load_corpus(directory).cases[0].items[0]

    assert item.words is None
    assert item.audio == directory / "audio" / "take-1.wav"


def test_audio_items_may_not_escape_the_corpus_directory():
    directory = _write_corpus(_tmp(), [_case(recording={"items": [{"id": "item-1", "audio": "../elsewhere.wav"}]})])

    with pytest.raises(harness.FixtureError, match="inside the corpus"):
        harness.load_corpus(directory)


# ---------------------------------------------------------------------------
# scoring


def _lookup_analyzer(reports):
    def analyze(chapter, items):
        return reports[" ".join(word.text for item in items for word in item.words)]

    return analyze


def _perfect_analyzer(corpus):
    by_transcript = {" ".join(word.text for item in case.items for word in item.words): case.expected for case in corpus.cases}
    return _lookup_analyzer(by_transcript)


def test_evaluate_scores_a_perfect_analyzer_with_no_errors():
    corpus = harness.load_corpus(_write_corpus(_tmp(), [_case(), _incomplete_tail_case()]))

    evaluation = harness.evaluate(corpus.cases, _perfect_analyzer(corpus))

    summary = evaluation.summary()
    assert (summary.scored, summary.false_met, summary.false_not_met) == (2, 0, 0)
    assert (summary.paragraphs_agreed, summary.paragraphs_total) == (6, 6)
    assert (summary.regions_located, summary.regions_kind_matched, summary.regions_total) == (1, 1, 1)


def test_evaluate_counts_a_false_met_and_an_unlocated_region():
    corpus = harness.load_corpus(_write_corpus(_tmp(), [_incomplete_tail_case()]))
    everything_present = harness.Report(text_complete=True, paragraphs={pid: "present" for pid, _ in PARAGRAPHS}, regions=())

    result = harness.evaluate(corpus.cases, lambda chapter, items: everything_present).results[0]

    assert result.outcome == "false_met"
    assert (result.paragraphs_agreed, result.regions_located) == (2, 0)


def test_evaluate_counts_a_false_not_met_and_a_region_found_under_another_kind():
    corpus = harness.load_corpus(_write_corpus(_tmp(), [_case(), _incomplete_tail_case()]))
    says_skip = harness.Report(
        text_complete=False,
        paragraphs={"p-000001": "present", "p-000002": "present", "p-000003": "missing"},
        regions=(harness.Region("skip", ("p-000003",)),),
    )

    results = harness.evaluate(corpus.cases, lambda chapter, items: says_skip).results

    assert [result.outcome for result in results] == ["false_not_met", "ok"]
    assert (results[1].regions_located, results[1].regions_kind_matched) == (1, 0)


def test_evaluate_rejects_a_report_that_does_not_label_every_paragraph():
    corpus = harness.load_corpus(_write_corpus(_tmp(), [_case()]))
    short = harness.Report(text_complete=True, paragraphs={"p-000001": "present"}, regions=())

    with pytest.raises(harness.FixtureError, match="every paragraph"):
        harness.evaluate(corpus.cases, lambda chapter, items: short)


def test_evaluate_skips_audio_cases_the_analyzer_cannot_hear():
    directory = _write_corpus(_tmp(), [_case(recording={"items": [{"id": "item-1", "audio": "a.wav"}]})])
    corpus = harness.load_corpus(directory)

    result = harness.evaluate(corpus.cases, harness.presence_stub).results[0]

    assert (result.outcome, result.report) == ("skipped", None)
    assert "audio" in result.reason
    evaluation = harness.evaluate(corpus.cases, harness.presence_stub)
    assert evaluation.summary().skipped == 1
    assert "| complete | tune | complete | complete | - | skipped (" in harness.format_table(evaluation)


def test_summary_filters_by_split():
    held_out = _incomplete_tail_case() | {"split": "held_out"}
    corpus = harness.load_corpus(_write_corpus(_tmp(), [_case(), held_out]))

    evaluation = harness.evaluate(corpus.cases, _perfect_analyzer(corpus))

    assert evaluation.summary("held_out").cases == 1
    assert evaluation.summary("tune").cases == 1
    assert evaluation.summary().cases == 2


# ---------------------------------------------------------------------------
# the stub analyzer


def test_presence_stub_labels_paragraphs_by_the_words_heard_anywhere():
    corpus = harness.load_corpus(_write_corpus(_tmp(), [_case(), _incomplete_tail_case()]))

    complete, tail = (harness.presence_stub(case.chapter, case.items) for case in corpus.cases)

    assert complete.text_complete is True
    assert complete.regions == ()
    assert tail.text_complete is False
    assert tail.paragraphs["p-000003"] in {"missing", "partial"}
    assert tail.regions == (harness.Region("tail", ("p-000003",)),)


FOUR_PARAGRAPHS = [*PARAGRAPHS, ("p-000004", "Zebra quartz vexes jumpy wolves.")]


def _stub_report_for(reads):
    # The labels are not what this drives: the case only feeds a recording to the stub.
    labels = {"textComplete": True, "paragraphs": {pid: "present" for pid, _ in FOUR_PARAGRAPHS}, "regions": []}
    segments = [{"read": pid} for pid in reads]
    case = _case(recording={"items": [{"id": "item-1", "segments": segments}]}, expected=labels)
    loaded = harness.load_corpus(_write_corpus(_tmp(), [case], paragraphs=FOUR_PARAGRAPHS)).cases[0]
    return harness.presence_stub(loaded.chapter, loaded.items)


def test_presence_stub_names_head_tail_and_skip_regions():
    assert [region.kind for region in _stub_report_for(["p-000002"]).regions] == ["head", "tail"]
    assert _stub_report_for(["p-000001", "p-000004"]).regions == (harness.Region("skip", ("p-000002", "p-000003")),)


# ---------------------------------------------------------------------------
# the table and the CLI


def test_format_table_lists_every_case_and_the_split_summaries():
    corpus = harness.load_corpus(_write_corpus(_tmp(), [_case(), _incomplete_tail_case()]))

    table = harness.format_table(harness.evaluate(corpus.cases, _perfect_analyzer(corpus)))

    assert "| complete | tune | complete |" in table
    assert "| tail | tune | truncated_tail |" in table
    assert "False met: 0" in table
    assert "held_out" in table


def test_main_prints_the_label_table_for_the_committed_fixtures(capsys, monkeypatch):
    monkeypatch.delenv(harness.CORPUS_ENV, raising=False)

    assert harness.main([]) == 0

    out = capsys.readouterr().out
    assert "| Case |" in out
    assert "c2-pickup-at-end" in out


def test_main_corpus_only_needs_the_variable(monkeypatch):
    monkeypatch.delenv(harness.CORPUS_ENV, raising=False)

    with pytest.raises(SystemExit) as exited:
        harness.main(["--corpus-only"])

    assert exited.value.code == 2


def test_main_corpus_only_scores_just_the_named_corpus(capsys, monkeypatch):
    monkeypatch.setenv(harness.CORPUS_ENV, str(_write_corpus(_tmp(), [_case()])))

    assert harness.main(["--corpus-only"]) == 0

    out = capsys.readouterr().out
    assert "| complete | tune |" in out
    assert "c2-pickup-at-end" not in out


def test_main_fails_when_the_stub_reports_a_false_met_and_strict_is_set(capsys, monkeypatch):
    monkeypatch.delenv(harness.CORPUS_ENV, raising=False)

    # The bag-of-words stub cannot see order, so the pickup and refrain cases are false "met":
    # exactly what the harness exists to catch.
    assert harness.main(["--strict"]) == 1


# ---------------------------------------------------------------------------
# the directory-variable hook


def test_corpus_dirs_is_the_committed_set_when_the_variable_is_unset(monkeypatch):
    monkeypatch.delenv(harness.CORPUS_ENV, raising=False)

    assert harness.corpus_dirs() == (harness.FIXTURE_DIR,)


def test_corpus_dirs_adds_the_directory_named_by_the_variable(monkeypatch):
    directory = _write_corpus(_tmp(), [_case()])
    monkeypatch.setenv(harness.CORPUS_ENV, str(directory))

    assert harness.corpus_dirs() == (harness.FIXTURE_DIR, directory)
    assert harness.corpus_dirs(include_committed=False) == (directory,)


def test_corpus_dirs_refuses_a_variable_that_names_no_directory(monkeypatch):
    monkeypatch.setenv(harness.CORPUS_ENV, str(_tmp() / "missing"))

    with pytest.raises(harness.FixtureError, match=harness.CORPUS_ENV):
        harness.corpus_dirs()


@pytest.mark.skipif(not os.environ.get(harness.CORPUS_ENV), reason=f"{harness.CORPUS_ENV} is not set: no permissioned corpus on this machine")
def test_the_permissioned_corpus_loads_and_scores():
    for directory in harness.corpus_dirs(include_committed=False):
        corpus = harness.load_corpus(directory)
        assert corpus.cases, f"{directory} has no cases"
        harness.evaluate(corpus.cases, harness.presence_stub)


# ---------------------------------------------------------------------------
# the committed synthetic fixture set


@pytest.fixture(scope="module")
def committed():
    return harness.load_corpus(harness.FIXTURE_DIR)


def test_committed_fixtures_cover_every_condition_the_prd_lists(committed):
    covered = {condition for case in committed.cases for condition in case.conditions}

    assert set(harness.CONDITIONS) <= covered


def test_committed_fixtures_have_both_verdicts_in_each_split(committed):
    for split in harness.SPLITS:
        verdicts = {case.expected.text_complete for case in committed.cases if case.split == split}
        assert verdicts == {True, False}, split


def test_committed_fixtures_are_text_only_and_small(committed):
    assert all(item.audio is None for case in committed.cases for item in case.items)
    assert 3 <= len({case.chapter.id for case in committed.cases}) <= 5
    total_bytes = sum(path.stat().st_size for path in harness.FIXTURE_DIR.rglob("*") if path.is_file())
    assert total_bytes < 64 * 1024


def test_committed_fixtures_ids_are_unique(committed):
    ids = [case.id for case in committed.cases]
    assert len(ids) == len(set(ids))


def test_committed_manuscript_loads_through_transcript_compare(committed):
    spec = importlib.util.spec_from_file_location("transcript_compare_coverage_fixtures", COMPARE_PATH)
    compare = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(compare)

    chapters = compare.load_manuscript_chapters(harness.FIXTURE_DIR / "manuscript.json")

    assert {chapter["id"] for chapter in chapters} == {case.chapter.id for case in committed.cases}


def test_the_stub_runs_on_the_committed_fixtures_and_reports_every_case(committed):
    evaluation = harness.evaluate(committed.cases, harness.presence_stub)

    assert evaluation.summary().scored == len(committed.cases)
    assert evaluation.summary().false_met >= 1  # order-blind, so the pickup case fools it
