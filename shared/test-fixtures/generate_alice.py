"""Regenerates the Alice in Wonderland import fixtures (alice.docx/.md/.pdf)
from the public-domain Project Gutenberg plain-text edition (EBook #11,
Lewis Carroll, "Alice's Adventures in Wonderland" - first published 1865,
long in the public domain worldwide).

Usage (from a venv with python-docx and fpdf2 installed - fpdf2 is a
fixture-generation-only tool, not a project runtime dependency):

    curl -sL -o alice_raw.txt https://www.gutenberg.org/files/11/11-0.txt
    python generate_alice.py alice_raw.txt

Only the first three chapters are kept - enough real prose, chapter breaks,
and typographic punctuation (curly quotes, em dashes) to exercise import
behavior without carrying a whole novel in the repo. Chapter II's body
starts with a "Contents"-style aside deliberately turned into its own
Heading-1 "Contents" paragraph in the .docx, to exercise the
NON_CHAPTER_HEADINGS skip path (see docx_chapters.py) with a real heading
rather than only a synthetic unit-test one.
"""

import re
import sys
from pathlib import Path

from docx import Document
from fpdf import FPDF

CHAPTER_LIMIT = 3


def parse_chapters(raw_path: Path) -> list[tuple[str, list[str]]]:
    text = raw_path.read_text(encoding="utf-8")
    start = text.index("*** START OF THE PROJECT GUTENBERG EBOOK")
    body = text[text.index("\n", start) + 1 :]

    chapter_re = re.compile(r"^CHAPTER ([IVXLC]+)\.\s*$", re.MULTILINE)
    matches = list(chapter_re.finditer(body))[:CHAPTER_LIMIT]

    chapters = []
    for i, match in enumerate(matches):
        title_line_end = body.index("\n", match.end() + 1)
        chapter_title = body[match.end() : title_line_end].strip()
        content_start = title_line_end + 1
        content_end = matches[i + 1].start() if i + 1 < len(matches) else body.index("THE END")
        raw_paragraphs = body[content_start:content_end].strip("\n").split("\n\n")
        paragraphs = []
        for para in raw_paragraphs:
            collapsed = " ".join(para.split())
            if collapsed and collapsed != "[Illustration]":
                paragraphs.append(collapsed)
        chapters.append((f"Chapter {match.group(1)}: {chapter_title}", paragraphs))
    return chapters


def write_docx(chapters: list[tuple[str, list[str]]], out_path: Path) -> None:
    doc = Document()
    doc.add_paragraph("Alice's Adventures in Wonderland", style="Title")
    for i, (title, paragraphs) in enumerate(chapters):
        if i == 1:
            # Deliberately exercises the NON_CHAPTER_HEADINGS skip path with
            # a real heading, not just a synthetic unit-test one.
            doc.add_paragraph("Contents", style="Heading 1")
            doc.add_paragraph("A brief aside before the chapter continues.")
        doc.add_paragraph(title, style="Heading 1")
        for para in paragraphs:
            doc.add_paragraph(para)
    doc.save(out_path)


def write_markdown(chapters: list[tuple[str, list[str]]], out_path: Path) -> None:
    lines = ["# Alice's Adventures in Wonderland", ""]
    for title, paragraphs in chapters:
        lines.append(f"# {title}")
        lines.append("")
        for para in paragraphs:
            lines.append(para)
            lines.append("")
    out_path.write_text("\n".join(lines), encoding="utf-8")


def write_pdf(chapters: list[tuple[str, list[str]]], out_path: Path) -> None:
    # Alice's actual curly quotes/em dashes need a Unicode font - the core
    # "Helvetica" font is latin-1-only. Windows-only path (this generator is
    # a dev-time fixture regenerator, not a runtime dependency); point at a
    # different TTF (e.g. a bundled DejaVuSans) to regenerate elsewhere.
    # NOTE on a real limitation this fixture deliberately surfaces rather
    # than hides: pypdf's extract_text() never inserts a blank line for a
    # PDF built this way (confirmed - neither a large pdf.ln() gap nor an
    # explicit empty text-draw call between paragraphs produces one), so
    # _pdf_draft's `re.split(r"\n\s*\n+", text)` sees the ENTIRE document as
    # one block regardless of chapter count. If that one block's first line
    # matched the chapter-prefix regex, the whole book would be swallowed as
    # "just a title" with zero paragraphs - a hard import failure. Leading
    # with the book title (not a "Chapter ..." line) avoids that specific
    # crash, but the real behavior - the whole book importing as a single
    # "Front matter" paragraph, no chapter breaks - is left visible on
    # purpose. Any manuscript PDF from a similarly simple generator (not
    # Word/LibreOffice's export, which does preserve blank lines) hits this
    # same ceiling; it's a real, pre-existing gap in PDF import generally.
    pdf = FPDF()
    pdf.add_font("Body", "", "C:/Windows/Fonts/arial.ttf")
    pdf.add_font("Body", "B", "C:/Windows/Fonts/arialbd.ttf")
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    pdf.set_font("Body", "B", 16)
    pdf.multi_cell(0, 10, "Alice's Adventures in Wonderland")
    pdf.ln(10)
    for title, paragraphs in chapters:
        pdf.set_font("Body", "B", 14)
        pdf.multi_cell(0, 10, title)
        # A gap comparable to a normal line height (7) reads as "still the
        # same paragraph" to pypdf's extraction - it infers a blank line
        # from a vertical jump clearly larger than one line, so make it one.
        pdf.ln(16)
        pdf.set_font("Body", size=12)
        for para in paragraphs:
            pdf.multi_cell(0, 7, para)
            pdf.ln(16)
    pdf.output(str(out_path))


def main() -> None:
    raw_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "alice_raw.txt"
    chapters = parse_chapters(raw_path)
    out_dir = Path(__file__).parent
    write_docx(chapters, out_dir / "alice.docx")
    write_markdown(chapters, out_dir / "alice.md")
    write_pdf(chapters, out_dir / "alice.pdf")
    print(f"Wrote alice.docx/.md/.pdf from {len(chapters)} chapters.")


if __name__ == "__main__":
    main()
