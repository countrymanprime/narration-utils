"""Writes the constructed heading-misread fixtures (story-bible-and-import-ux-briefs PRD, Phase 4).

Each case is one small manuscript whose single chapter heading exercises one way the importer's
title/subtitle heuristic (``headingParts``/``splitGluedHeading`` in
``apps/desktop/internal/importer/headings.go`` and ``classifyTxtHeading`` in ``txt.go``) reads a
heading. ``cases.json`` beside this script records, per case, what the author meant and what the
importer actually produces; ``TestHeadingMisreadFixtures`` in
``apps/desktop/internal/importer/heading_misreads_test.go`` holds the importer to the recorded
output, and ``docs/research/import-heading-misreads.md`` explains each failure mode.

Standard library only (DOCX and EPUB are written as minimal zip archives), so it runs without the
``python-docx``/``fpdf2`` tools ``generate_alice.py`` needs:

    cd tests/fixtures/heading-misreads
    python generate.py
"""

import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

HERE = Path(__file__).resolve().parent

BODY = [
    "The rain had not stopped for three days, and the river was already over the lower road.",
    "Nobody in the village said the word flood, but everybody moved the chairs upstairs.",
]

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

DOCX_STYLES = (
    f'<w:styles xmlns:w="{W_NS}">'
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>'
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>'
    '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/></w:style>'
    '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/></w:style>'
    "</w:styles>"
)

DOCX_CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/word/document.xml" '
    'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    '<Override PartName="/word/styles.xml" '
    'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    "</Types>"
)

DOCX_RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" '
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
    'Target="word/document.xml"/></Relationships>'
)

DOCX_DOCUMENT_RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" '
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
    'Target="styles.xml"/></Relationships>'
)

# Zip entries get a fixed timestamp so regenerating produces byte-identical archives.
FIXED_DATE = (2026, 1, 1, 0, 0, 0)

BREAK = object()  # a soft line break (Shift+Enter) inside a Word paragraph


def run(text: str, bold: bool = False) -> str:
    properties = "<w:rPr><w:b/></w:rPr>" if bold else ""
    return f'<w:r>{properties}<w:t xml:space="preserve">{escape(text)}</w:t></w:r>'


def paragraph(style: str, *runs: object) -> str:
    properties = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    parts = ["<w:r><w:br/></w:r>" if item is BREAK else str(item) for item in runs]
    return "<w:p>" + properties + "".join(parts) + "</w:p>"


def write_zip(path: Path, entries: list[tuple[str, str]], stored_first: bool = False) -> None:
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for index, (name, content) in enumerate(entries):
            info = zipfile.ZipInfo(name, FIXED_DATE)
            compression = zipfile.ZIP_STORED if stored_first and index == 0 else zipfile.ZIP_DEFLATED
            info.compress_type = compression
            archive.writestr(info, content)


def write_docx(name: str, heading_paragraphs: list[str]) -> None:
    body = "".join(heading_paragraphs) + "".join(paragraph("", run(text)) for text in BODY)
    document = f'<w:document xmlns:w="{W_NS}"><w:body>{body}</w:body></w:document>'
    write_zip(
        HERE / name,
        [
            ("[Content_Types].xml", DOCX_CONTENT_TYPES),
            ("_rels/.rels", DOCX_RELS),
            ("word/_rels/document.xml.rels", DOCX_DOCUMENT_RELS),
            ("word/styles.xml", DOCX_STYLES),
            ("word/document.xml", document),
        ],
    )


def write_epub(name: str, chapter_head: str, toc_label: str) -> None:
    """One chapter document whose top is ``chapter_head`` (raw XHTML), with a nav TOC entry pointing at it."""
    body = "".join(f"<p>{escape(text)}</p>" for text in BODY)
    chapter = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head>'
        f"<body>{chapter_head}{body}</body></html>"
    )
    nav = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">'
        "<head><title>Contents</title></head>"
        f'<body><nav epub:type="toc"><ol><li><a href="ch1.xhtml">{escape(toc_label)}</a></li></ol></nav></body></html>'
    )
    opf = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">'
        '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
        '<dc:identifier id="id">heading-misreads</dc:identifier><dc:title>Heading misreads</dc:title>'
        "<dc:language>en</dc:language></metadata><manifest>"
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
        '<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>'
        '</manifest><spine><itemref idref="ch1"/></spine></package>'
    )
    container = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
        '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>'
        "</rootfiles></container>"
    )
    write_zip(
        HERE / name,
        [
            ("mimetype", "application/epub+zip"),
            ("META-INF/container.xml", container),
            ("OEBPS/content.opf", opf),
            ("OEBPS/nav.xhtml", nav),
            ("OEBPS/ch1.xhtml", chapter),
        ],
        stored_first=True,
    )


def write_text(name: str, heading_block: str) -> None:
    """A Markdown or plain-text file: the heading block as written, then the shared body paragraphs."""
    (HERE / name).write_text(heading_block + "\n\n" + "\n\n".join(BODY) + "\n", encoding="utf-8", newline="\n")


def main() -> None:
    # DOCX
    write_docx("docx-soft-break-subtitle.docx", [paragraph("Heading1", run("Chapter One"), BREAK, run("The Storm"))])
    write_docx(
        "docx-epigraph-after-heading.docx",
        [
            paragraph("Heading1", run("Chapter One")),
            paragraph("Quote", run("“Water finds its level.”")),
        ],
    )
    write_docx(
        "docx-subtitle-style-paragraph.docx",
        [paragraph("Heading1", run("Chapter One")), paragraph("Subtitle", run("The Storm"))],
    )
    write_docx(
        "docx-subtitle-as-heading-2.docx",
        [paragraph("Heading1", run("Chapter One")), paragraph("Heading2", run("The Storm"))],
    )
    write_docx(
        "docx-two-line-title.docx",
        [paragraph("Heading1", run("The Girl Who"), BREAK, run("Fell Through the Ice"))],
    )
    write_docx(
        "docx-three-line-heading.docx",
        [paragraph("Heading1", run("Part One"), BREAK, run("Chapter One"), BREAK, run("The Storm"))],
    )
    write_docx(
        "docx-glued-all-caps.docx",
        [paragraph("Heading1", run("CHAPTER ONE", bold=True), run("THE STORM"))],
    )
    write_docx(
        "docx-glued-one-letter-word.docx",
        [paragraph("Heading1", run("Chapter Two", bold=True), run("A Night on the Levee"))],
    )
    write_docx(
        "docx-glued-two-word-number.docx",
        [paragraph("Heading1", run("Chapter Twenty One", bold=True), run("The Storm"))],
    )
    write_docx("docx-separator-one-line.docx", [paragraph("Heading1", run("Chapter One: The Storm"))])

    # Markdown
    write_text("md-br-subtitle.md", "# Chapter One<br>The Storm")
    write_text("md-subtitle-as-h2.md", "# Chapter One\n\n## The Storm")
    write_text("md-subtitle-emphasis-line.md", "# Chapter One\n\n*The Storm*")
    write_text("md-two-line-title-br.md", "# The Girl Who<br>Fell Through the Ice")

    # Plain text
    write_text("txt-two-line-subtitle.txt", "Chapter One\nThe Storm")
    write_text("txt-epigraph-under-heading.txt", "Chapter One\n“Water finds its level.”")
    write_text("txt-subtitle-own-block.txt", "Chapter One\n\nThe Storm")
    write_text("txt-title-above-number.txt", "The Storm\nChapter One")
    write_text("txt-three-line-heading.txt", "Part One\nChapter One\nThe Storm")

    # EPUB
    write_epub("epub-br-subtitle.epub", "<h1>Chapter One<br/>The Storm</h1>", "Chapter One")
    write_epub("epub-subtitle-as-h2.epub", "<h1>Chapter One</h1><h2>The Storm</h2>", "Chapter One")
    write_epub(
        "epub-subtitle-class-paragraph.epub",
        '<h1>Chapter One</h1><p class="subtitle">The Storm</p>',
        "Chapter One",
    )
    write_epub("epub-two-line-title-br.epub", "<h1>The Girl Who<br/>Fell Through the Ice</h1>", "The Girl Who")


if __name__ == "__main__":
    main()
