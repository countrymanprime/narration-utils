import json
from pathlib import Path

import pytest
from narration_common.chapter_names import chapter_display_name

FIXTURE = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "chapter-names.json"


def _cases():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", _cases(), ids=lambda case: repr(case["title"])[:40])
def test_every_form_matches_the_shared_fixture(case):
    title, subtitle = case["title"], case["subtitle"]

    assert chapter_display_name(title, subtitle) == case["full"]
    assert chapter_display_name(title, subtitle, form="short") == case["short"]
    assert chapter_display_name(title, subtitle, form="plain") == case["plain"]
    assert chapter_display_name(title, subtitle, context="Read aloud") == case["readAloud"]


def test_the_fixture_covers_the_rule():
    fulls = [case["full"] for case in _cases()]

    assert "CHAPTER ONE — Bad Ideas Look Great in Neon" in fulls
    assert "Chapter 1 — The Beginning" in fulls
    assert all(" —  — " not in full and ": —" not in full for full in fulls)


def test_an_unknown_form_is_refused():
    with pytest.raises(ValueError, match="unknown chapter name form"):
        chapter_display_name("Prologue", form="loud")
