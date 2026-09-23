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
non-chapter-heading skip path (isNonChapterHeading in
apps/desktop/internal/importer) with a real heading
rather than only a synthetic unit-test one.
"""

import re
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

from docx import Document
from fpdf import FPDF

CHAPTER_LIMIT = 3


def parse_chapters(raw_path: Path) -> list[tuple[str, list[str]]]:
    text = raw_path.read_text(encoding="utf-8")
    start = text.index("*** START OF THE PROJECT GUTENBERG EBOOK")
    body = text[text.index("\n", start) + 1 :]

    chapter_re = re.compile(r"^CHAPTER ([IVXLC]+)\.\s*$", re.MULTILINE)
    all_matches = list(chapter_re.finditer(body))
    matches = all_matches[:CHAPTER_LIMIT]

    chapters = []
    for i, match in enumerate(matches):
        title_line_end = body.index("\n", match.end() + 1)
        chapter_title = body[match.end() : title_line_end].strip()
        content_start = title_line_end + 1
        # Bound the LAST kept chapter's content at the next real chapter heading in the full
        # match list (not the truncated one) - using body.index("THE END") here would bleed
        # every chapter beyond CHAPTER_LIMIT into this one as plain, unmarked paragraph text
        # (txt-and-epub-import PRD, Phase 1: the TXT importer's own heading heuristic exposed
        # this by correctly reading those bled-in "CHAPTER IV."-shaped lines as real headings).
        content_end = all_matches[i + 1].start() if i + 1 < len(all_matches) else body.index("THE END")
        raw_paragraphs = body[content_start:content_end].strip("\n").split("\n\n")
        paragraphs = []
        for para in raw_paragraphs:
            collapsed = " ".join(para.split())
            if collapsed and collapsed != "[Illustration]":
                paragraphs.append(collapsed)
        chapters.append((f"Chapter {match.group(1)}: {chapter_title}", paragraphs))
    return chapters


def wrap_txt_line(text: str, width: int = 70) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current: list[str] = []
    length = 0
    for word in words:
        extra = len(word) + (1 if current else 0)
        if length + extra > width and current:
            lines.append(" ".join(current))
            current, length = [word], len(word)
        else:
            current.append(word)
            length += extra
    if current:
        lines.append(" ".join(current))
    return lines


def write_txt(chapters: list[tuple[str, list[str]]], out_path: Path) -> None:
    """Writes a Gutenberg-shaped, hard-wrapped alice.txt: a START/END marker pair around the
    text (T5), a Contents block naming the chapters (never itself read as a chapter list, T3),
    and each chapter as a two-line "CHAPTER N." / subtitle heading block, wrapped at ~70
    columns like the real alice_raw.txt this is derived from - so the importer's hard-wrap
    detection (T2) and underscore-italic handling (T5) both have real work to do."""
    lines = [
        "*** START OF THE PROJECT GUTENBERG EBOOK 11 ***",
        "",
        "Alice's Adventures in Wonderland",
        "",
        "by Lewis Carroll",
        "",
        "Contents",
        "",
    ]
    for title, _ in chapters:
        lines.append(f" {title}")
    lines.append("")
    lines.append("")
    for title, paragraphs in chapters:
        marker, subtitle = title.split(": ", 1)
        lines.append(marker.upper() + ".")
        lines.append(subtitle)
        lines.append("")
        for para in paragraphs:
            lines.extend(wrap_txt_line(para))
            lines.append("")
    lines.append("*** END OF THE PROJECT GUTENBERG EBOOK 11 ***")
    # newline="\n" pins LF regardless of platform - Path.write_text's universal-newline
    # translation would otherwise write CRLF here on Windows, unlike alice_raw.txt and this
    # script's other outputs.
    out_path.write_text("\n".join(lines), encoding="utf-8", newline="\n")


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


epub_italic_re = re.compile(r"_(.+?)_")


def epub_em(text: str) -> str:
    """Turns the raw fixture text's word-bounded `_italic_` runs (the same
    Gutenberg convention alice.txt's T5 reads) into a semantic <em>, so the
    EPUB fixture's chapter text matches alice.md's after the Markdown
    importer strips its own underscore-emphasis markers - otherwise the
    literal underscores would stay in the EPUB's plain text and break the
    Go parity test (txt-and-epub-import PRD, Phase 2)."""
    return epub_italic_re.sub(r"<em>\1</em>", text)


def write_epub(chapters: list[tuple[str, list[str]]], out_path: Path) -> None:
    """Writes alice.epub (txt-and-epub-import PRD, Phase 2): an EPUB 3 book with
    both a nav.xhtml table of contents (EPUB 3) and a toc.ncx (EPUB 2), as many
    real EPUB 3 exporters ship both for backwards compatibility, so one fixture
    exercises the nav-preferred path while a from-scratch NCX-only variant
    (built directly in Go, epub_test.go) exercises the EPUB 2 fallback. A
    front-matter document with no heading (classified Front Matter/Cover, like
    alice.txt) precedes the same three chapters as alice.md/alice.txt, so the
    Go parity test can compare their narration text directly."""
    if out_path.exists():
        out_path.unlink()
    with zipfile.ZipFile(out_path, "w") as zf:
        # mimetype must be the first entry, stored (uncompressed), per the EPUB spec.
        zf.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip", zipfile.ZIP_STORED)
        zf.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
            '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>'
            "</container>",
        )
        manifest_items = [
            '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
            '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
            '<item id="front" href="frontmatter.xhtml" media-type="application/xhtml+xml"/>',
        ]
        spine_items = ['<itemref idref="front"/>']
        nav_entries = []
        ncx_points = []
        for i, (title, paragraphs) in enumerate(chapters, start=1):
            item_id = f"ch{i}"
            manifest_items.append(f'<item id="{item_id}" href="{item_id}.xhtml" media-type="application/xhtml+xml"/>')
            spine_items.append(f'<itemref idref="{item_id}"/>')
            body = "".join(f"<p>{epub_em(escape(p))}</p>" for p in paragraphs)
            zf.writestr(
                f"OEBPS/{item_id}.xhtml",
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>' + escape(title) + "</title></head>"
                f'<body><h1 id="{item_id}">{escape(title)}</h1>{body}</body></html>',
            )
            nav_entries.append(f'<li><a href="{item_id}.xhtml#{item_id}">{escape(title)}</a></li>')
            ncx_points.append(
                f'<navPoint id="np{i}" playOrder="{i}"><navLabel><text>{escape(title)}</text></navLabel><content src="{item_id}.xhtml#{item_id}"/></navPoint>'
            )
        zf.writestr(
            "OEBPS/frontmatter.xhtml",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Front Matter</title></head>'
            "<body><p>Alice's Adventures in Wonderland</p><p>by Lewis Carroll</p></body></html>",
        )
        zf.writestr(
            "OEBPS/nav.xhtml",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">'
            "<head><title>Table of Contents</title></head>"
            '<body><nav epub:type="toc"><ol>' + "".join(nav_entries) + "</ol></nav></body></html>",
        )
        zf.writestr(
            "OEBPS/toc.ncx",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">'
            "<head/><docTitle><text>Alice's Adventures in Wonderland</text></docTitle>"
            "<navMap>" + "".join(ncx_points) + "</navMap></ncx>",
        )
        zf.writestr(
            "OEBPS/content.opf",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">'
            '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
            "<dc:title>Alice's Adventures in Wonderland</dc:title>"
            '<dc:identifier id="bookid">alice-fixture</dc:identifier>'
            "<dc:language>en</dc:language></metadata>"
            f"<manifest>{''.join(manifest_items)}</manifest>"
            f'<spine toc="ncx">{"".join(spine_items)}</spine>'
            "</package>",
        )


def main() -> None:
    raw_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "alice_raw.txt"
    chapters = parse_chapters(raw_path)
    out_dir = Path(__file__).parent
    write_docx(chapters, out_dir / "alice.docx")
    write_markdown(chapters, out_dir / "alice.md")
    write_pdf(chapters, out_dir / "alice.pdf")
    write_txt(chapters, out_dir / "alice.txt")
    write_epub(chapters, out_dir / "alice.epub")
    print(f"Wrote alice.docx/.md/.pdf/.txt/.epub from {len(chapters)} chapters.")


if __name__ == "__main__":
    main()
