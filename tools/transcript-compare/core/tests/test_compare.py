import importlib.util
import json
from pathlib import Path


COMPARE_PATH = Path(__file__).resolve().parents[1] / "compare.py"
SPEC = importlib.util.spec_from_file_location("transcript_compare", COMPARE_PATH)
compare = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(compare)


def test_reference_sections_are_not_available_for_transcript_matching(tmp_path):
    manuscript = tmp_path / "manuscript.json"
    manuscript.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "documentId": "test-document",
                "chapters": [
                    {"id": "chapter-1", "title": "Chapter 1", "contentKind": "narration"},
                    {"id": "characters", "title": "Characters", "contentKind": "reference"},
                ],
                "paragraphs": [
                    {"id": "p-1", "chapterId": "chapter-1", "index": 0, "text": "Ada enters the room."},
                    {"id": "p-2", "chapterId": "characters", "index": 1, "text": "Ada Finch is the narrator."},
                ],
            }
        ),
        encoding="utf-8",
    )

    chapters = compare.load_manuscript_chapters(manuscript)

    assert [chapter["title"] for chapter in chapters] == ["Chapter 1"]
    assert chapters[0]["paragraphs"] == ["Ada enters the room."]
