"""The results file the sidecar's coverage mode writes for every committed recording-coverage case,
pinned byte for byte at the shipped settings (ADR 0132).

The stage recommendations PRD's Phase 3 success signal is a service test over the RC corpus: the Go
host reads these exact lines as a check's results (`apps/desktop/internal/coverage/corpus_test.go`)
and the recording signal and the stages engine must suggest `editing` for exactly the cases whose
label is `textComplete`. Pinning the lines here keeps that Go test on what the shipped analyzer
really produces, not on hand-written reports. Regenerate the file with `UPDATE_CONTRACTS=1` only
when a change to the coverage output is intended, and say why in the PR.

Only the measurement lines are pinned: the word alignment the same run writes for the edit and
proof workspace (`COVERAGE_TOKEN`, `COVERAGE_EXTRA`, ADR 0242) is about 50 bytes a word, which would
outgrow the committed fixtures' size budget, and `test_coverage_alignment.py` covers it."""

import json
import os

import coverage_calibration as cal
import coverage_harness as harness

GOLDEN_PATH = harness.FIXTURE_DIR / "results.golden.json"
MANUSCRIPT = harness.FIXTURE_DIR / "manuscript.json"
MEASUREMENT_TAGS = frozenset({"COVERAGE", "COVERAGE_ITEM", "COVERAGE_PARAGRAPH", "COVERAGE_REGION"})


def _render_all(work):
    corpus = harness.load_corpus(harness.FIXTURE_DIR)
    cases = {}
    for case in corpus.cases:
        case_dir = work / case.id
        result = cal.run_in_process(case, MANUSCRIPT, case_dir, cal.SHIPPED)
        (results_file,) = case_dir.glob("results-*.txt")
        cases[case.id] = {
            "chapterId": case.chapter.id,
            "split": case.split,
            "textComplete": case.expected.text_complete,
            "analyzerTextComplete": cal.text_complete(result, cal.SHIPPED),
            "lines": [line for line in results_file.read_text(encoding="utf-8").splitlines() if line.split("|", 1)[0] in MEASUREMENT_TAGS],
        }
    settings = {
        "minParagraphPresent": cal.SHIPPED.min_paragraph_present,
        "maxMissingRun": cal.SHIPPED.max_missing_run,
        "maxMisreadRun": cal.SHIPPED.max_misread_run,
        "minAnchorRun": cal.SHIPPED.min_anchor_run,
    }
    return json.dumps({"schemaVersion": 1, "settings": settings, "cases": cases}, indent=1, sort_keys=True, ensure_ascii=False) + "\n"


def test_results_for_the_committed_cases_match_the_golden_file(tmp_path):
    rendered = _render_all(tmp_path)
    if os.environ.get("UPDATE_CONTRACTS"):
        GOLDEN_PATH.write_text(rendered, encoding="utf-8", newline="\n")
    assert GOLDEN_PATH.is_file(), f"no {GOLDEN_PATH.name}: run this test with UPDATE_CONTRACTS=1 and commit it"
    assert rendered == GOLDEN_PATH.read_text(encoding="utf-8")


def test_the_shipped_analyzer_agrees_with_every_label():
    # The Go test asserts the stages verdict against the label; this says why that can hold.
    golden = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    for case_id, case in golden["cases"].items():
        assert case["analyzerTextComplete"] == case["textComplete"], case_id
    assert {case["textComplete"] for case in golden["cases"].values()} == {True, False}
