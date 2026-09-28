"""The manuscript side of the LibriVox corpus: chapters and paragraphs from the repo's Alice text.

The text is `apps/ui/src/api/fixtures/alice-in-wonderland.txt` (Project Gutenberg eBook #11, byte for byte), the
same script the demo manuscript uses, so every corpus built here matches what the app shows.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPOSITORY = HERE.parents[3]
ALICE_TEXT = REPOSITORY / "apps" / "ui" / "src" / "api" / "fixtures" / "alice-in-wonderland.txt"

_HEADING = re.compile(r"^CHAPTER ([IVXL]+)\. (.+)$")
_ROMAN = {"I": 1, "V": 5, "X": 10, "L": 50}
_TOKEN = re.compile(r"[a-z0-9]+(?:'[a-z0-9]+)*")


@dataclass(frozen=True)
class Paragraph:
    id: str
    chapter_id: str
    index: int
    text: str


@dataclass(frozen=True)
class Chapter:
    id: str
    number: int
    title: str
    subtitle: str
    paragraphs: tuple[Paragraph, ...]


def roman(numeral: str) -> int:
    values = [_ROMAN[c] for c in numeral]
    return sum(-v if i + 1 < len(values) and v < values[i + 1] else v for i, v in enumerate(values))


def chapter_id(number: int) -> str:
    return f"c-{number:04d}"


def tokens(text: str) -> list[str]:
    """Lowercased words with curly apostrophes folded and hyphens split, the unit both sides of the alignment use."""
    folded = text.lower().replace("’", "'").replace("‘", "'").replace("-", " ")
    return _TOKEN.findall(folded)


def load_chapters(path: Path = ALICE_TEXT) -> dict[str, Chapter]:
    """Every chapter of the book, one paragraph per blank-line-separated block, its lines joined."""
    chapters: dict[str, Chapter] = {}
    heading: re.Match[str] | None = None
    blocks: list[str] = []
    block: list[str] = []

    def close() -> None:
        if heading is None:
            return
        number = roman(heading.group(1))
        cid = chapter_id(number)
        # The "* * * * *" scene breaks have no words to read, so they are not paragraphs.
        spoken = [text for text in blocks if tokens(text)]
        paragraphs = tuple(Paragraph(f"{cid}-p{i + 1:03d}", cid, i, text) for i, text in enumerate(spoken))
        chapters[cid] = Chapter(cid, number, f"Chapter {heading.group(1)}", heading.group(2).strip(), paragraphs)

    for line in path.read_text(encoding="utf-8-sig").splitlines():
        match = _HEADING.match(line.strip())
        if match or line.strip() == "THE END":
            if block:
                blocks.append(re.sub(r"\s+", " ", " ".join(block)).strip())
            close()
            if not match:
                break
            heading, blocks, block = match, [], []
            continue
        if heading is None:
            continue
        if line.strip():
            block.append(line.strip())
        elif block:
            blocks.append(re.sub(r"\s+", " ", " ".join(block)).strip())
            block = []
    return chapters


def manuscript_json(chapters: list[Chapter], document_id: str) -> dict:
    """The canonical manuscript (schema 1) the importer writes and the sidecar reads."""
    return {
        "schemaVersion": 1,
        "documentId": document_id,
        "chapters": [{"id": c.id, "title": c.title, "subtitle": c.subtitle, "contentKind": "narration"} for c in chapters],
        "paragraphs": [{"id": p.id, "chapterId": p.chapter_id, "index": p.index, "text": p.text} for c in chapters for p in c.paragraphs],
    }
