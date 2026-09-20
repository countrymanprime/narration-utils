"""Property tests for reading the canonical manuscript (narration_common.manuscript).

The promise under test: bad data raises ``ManuscriptError`` and nothing else, so the sidecars can
show the friendly message instead of a traceback (chapter_script.py catches only ManuscriptError).

Random JSON almost never gets past the schema-version check, so the main property starts from a
valid manuscript and corrupts one field with an arbitrary JSON value: every example reaches the
chapter and paragraph checks, and the id lookups see lists, objects, numbers and collisions.
"""

import tempfile
from pathlib import Path

from hypothesis import example, given
from hypothesis import strategies as st
from narration_common import manuscript
from narration_common.manuscript import ManuscriptError

JSON_VALUES = st.recursive(
    st.none() | st.booleans() | st.integers() | st.floats(allow_nan=False, allow_infinity=False) | st.text(max_size=8),
    lambda children: st.lists(children, max_size=4) | st.dictionaries(st.text(max_size=8), children, max_size=4),
    max_leaves=12,
)

VALID_MANUSCRIPTS = st.builds(
    lambda chapter_ids, paragraphs: {
        "schemaVersion": 1,
        "documentId": "doc",
        "chapters": [{"id": chapter_id} for chapter_id in chapter_ids],
        "paragraphs": [{"id": paragraph_id, "chapterId": chapter_ids[chapter % len(chapter_ids)], "text": text} for paragraph_id, chapter, text in paragraphs],
    },
    st.lists(st.sampled_from("abc"), min_size=1, max_size=3, unique=True),
    st.lists(
        st.tuples(st.text(alphabet="pqrs", min_size=1, max_size=3), st.integers(min_value=0, max_value=2), st.text(max_size=20)),
        min_size=1,
        max_size=6,
        unique_by=lambda item: item[0],
    ),
)

# Where the corruption lands: a top-level field, or a field of the first chapter or paragraph.
TARGETS = [
    "schemaVersion",
    "documentId",
    "chapters",
    "paragraphs",
    "chapter",
    "chapter.id",
    "paragraph",
    "paragraph.id",
    "paragraph.chapterId",
    "paragraph.text",
]


def _corrupt(data, target, value):
    corrupted = {**data, "chapters": [dict(item) for item in data["chapters"]], "paragraphs": [dict(item) for item in data["paragraphs"]]}
    if target in ("schemaVersion", "documentId", "chapters", "paragraphs"):
        corrupted[target] = value
    else:
        group, _, field = target.partition(".")
        items = corrupted["chapters" if group == "chapter" else "paragraphs"]
        if field:
            items[0][field] = value
        else:
            items[0] = value
    return corrupted


@st.composite
def corrupted_manuscripts(draw):
    return _corrupt(draw(VALID_MANUSCRIPTS), draw(st.sampled_from(TARGETS)), draw(JSON_VALUES))


@given(JSON_VALUES)
def test_validate_only_ever_raises_manuscript_error_on_arbitrary_json(value):
    try:
        result = manuscript.validate(value)
    except ManuscriptError:
        return
    assert result is value


@example({"schemaVersion": 1, "documentId": "x", "chapters": [{"id": []}], "paragraphs": []})
@example({"schemaVersion": 1, "documentId": "x", "chapters": [{"id": "a"}], "paragraphs": [{"id": "p", "chapterId": [], "text": "t"}]})
@given(corrupted_manuscripts())
def test_validate_only_ever_raises_manuscript_error_on_a_corrupted_manuscript(value):
    try:
        result = manuscript.validate(value)
    except ManuscriptError:
        return
    assert result is value


@given(VALID_MANUSCRIPTS)
def test_a_well_formed_manuscript_is_accepted_unchanged(data):
    assert manuscript.validate(data) is data


@example(b"\xff\xfe not utf-8")
@example(b"[" * 100_000)
@given(st.binary(max_size=64))
def test_loading_a_corrupt_file_only_ever_raises_manuscript_error(content):
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "manuscript.json"
        path.write_bytes(content)
        try:
            manuscript.load_file(path)
        except ManuscriptError:
            pass
