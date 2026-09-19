"""
The script for one chapter of the project's canonical manuscript
(`narration-utils/manuscript/manuscript.json`, the same data Transcript Compare
reads through narration_common.manuscript), as the flat token list the script
tracker follows plus the spans that map token indices back onto the chapter's
title and paragraphs.

Tokens are the whitespace-split words of the chapter title (narrators read it
aloud, as Transcript Compare also assumes) followed by each paragraph's text in
manuscript order. The frontend must tokenize each paragraph the same way
(`text.split()`) to place the tracker's `read` index; the `script` event
carries the spans so it can check its own tokenization against ours.
"""

import sys
from dataclasses import dataclass
from pathlib import Path

_SHARED_PYTHON = Path(__file__).resolve().parents[3] / "shared" / "python"
if str(_SHARED_PYTHON) not in sys.path:
    sys.path.insert(0, str(_SHARED_PYTHON))

from narration_common import manuscript as canonical_manuscript


class ChapterError(ValueError):
    """The requested chapter's script cannot be built. `candidates` lists the
    chapters that could have been chosen, when that would help."""

    def __init__(self, message: str, candidates: list[str] | None = None) -> None:
        super().__init__(message)
        self.candidates = candidates or []


@dataclass(frozen=True)
class Span:
    kind: str  # "title" or "paragraph"
    id: str
    index: int | None  # the manuscript reader's global paragraph index (None for the title)
    start: int
    count: int


@dataclass(frozen=True)
class ChapterScript:
    chapter_id: str
    title: str
    tokens: list[str]
    spans: list[Span]
    text: str


def _collapse(text: str) -> str:
    return " ".join(text.split()).casefold()


def display_title(title: str) -> str:
    """A title with a manual line break for a subtitle, joined onto one line
    the way Transcript Compare shows it ("CHAPTER ONE: Bad Ideas...")."""
    return ": ".join(line.strip() for line in title.splitlines() if line.strip())


def _narratable_chapters(data: dict) -> list[dict]:
    with_paragraphs = {paragraph["chapterId"] for paragraph in data["paragraphs"]}
    return [c for c in data["chapters"] if c.get("contentKind", "narration") == "narration" and c["id"] in with_paragraphs]


def _select(chapters: list[dict], query: str) -> dict:
    wanted = _collapse(query)
    for chapter in chapters:
        if chapter["id"] == query or wanted in (_collapse(chapter["title"]), _collapse(display_title(chapter["title"]))):
            return chapter
    raise ChapterError(f"Chapter {query!r} was not found among the narration chapters.", [display_title(c["title"]) for c in chapters])


def load_chapter_script(manuscript_path: str | Path, chapter: str) -> ChapterScript:
    """The script for the chapter with this id or title."""
    try:
        data = canonical_manuscript.load_file(manuscript_path)
    except canonical_manuscript.ManuscriptError as error:
        raise ChapterError(str(error)) from error
    selected = _select(_narratable_chapters(data), chapter)

    title_tokens = selected["title"].split()
    tokens = list(title_tokens)
    spans = [Span("title", selected["id"], None, 0, len(title_tokens))]
    texts = [selected["title"]]
    for paragraph in data["paragraphs"]:
        if paragraph["chapterId"] != selected["id"]:
            continue
        words = paragraph["text"].split()
        spans.append(Span("paragraph", paragraph["id"], paragraph.get("index"), len(tokens), len(words)))
        tokens.extend(words)
        texts.append(paragraph["text"])
    return ChapterScript(selected["id"], selected["title"], tokens, spans, "\n".join(texts))


def script_event(script: ChapterScript) -> dict:
    """The one-off `script` event describing the tokenization, emitted before
    any position events."""
    return {
        "type": "script",
        "chapter": {"id": script.chapter_id, "title": script.title},
        "tokens": len(script.tokens),
        "spans": [{"kind": s.kind, "id": s.id, "index": s.index, "start": s.start, "count": s.count} for s in script.spans],
    }
