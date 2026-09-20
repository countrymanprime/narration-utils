"""Property tests for the chapter script (the token list and spans the teleprompter follows).

The frontend places the tracker's `read` index by tokenizing each paragraph with `text.split()` and
checking its own tokenization against the `script` event's spans, so the spans must tile the token
list exactly, on any manuscript.
"""

import importlib.util
import json
import tempfile
from pathlib import Path

from hypothesis import given
from hypothesis import strategies as st

MODULE_PATH = Path(__file__).resolve().parents[1] / "core" / "chapter_script.py"
SPEC = importlib.util.spec_from_file_location("chapter_script_properties", MODULE_PATH)
chapter_script = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(chapter_script)

TEXT = st.text(max_size=40)
CHAPTER = st.fixed_dictionaries({"title": TEXT, "contentKind": st.sampled_from(["narration", "reference"])})
PARAGRAPH = st.tuples(st.integers(min_value=0, max_value=3), TEXT)


def _write_manuscript(folder, chapters, paragraphs):
    data = {
        "schemaVersion": 1,
        "documentId": "generated",
        "chapters": [{"id": f"c{index}", **chapter} for index, chapter in enumerate(chapters)],
        "paragraphs": [
            {"id": f"p{index}", "chapterId": f"c{chapter % len(chapters)}", "index": index, "text": text} for index, (chapter, text) in enumerate(paragraphs)
        ],
    }
    path = Path(folder) / "manuscript.json"
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return path, data


@given(st.lists(CHAPTER, min_size=1, max_size=4), st.lists(PARAGRAPH, min_size=1, max_size=8), st.integers(min_value=0, max_value=3))
def test_the_spans_tile_the_tokens_and_match_each_paragraph(chapters, paragraphs, pick):
    with tempfile.TemporaryDirectory() as folder:
        path, data = _write_manuscript(folder, chapters, paragraphs)
        narratable = chapter_script._narratable_chapters(data)
        if not narratable:
            return
        chosen = narratable[pick % len(narratable)]
        script = chapter_script.load_chapter_script(path, chosen["id"])

    assert script.chapter_id == chosen["id"]
    assert script.spans[0].kind == "title" and script.spans[0].start == 0
    assert script.spans[0].count == len(chosen["title"].split())
    end = 0
    for span in script.spans:
        assert span.start == end, "spans are contiguous and in order"
        end = span.start + span.count
    assert end == len(script.tokens), "the counts add up to the whole token list"
    assert script.text.split() == script.tokens, "the joined text tokenizes back to the same tokens"

    expected = [paragraph for paragraph in data["paragraphs"] if paragraph["chapterId"] == chosen["id"]]
    assert [span.id for span in script.spans[1:]] == [paragraph["id"] for paragraph in expected], "paragraph spans follow manuscript order"
    for span, paragraph in zip(script.spans[1:], expected):
        assert script.tokens[span.start : span.start + span.count] == paragraph["text"].split()
