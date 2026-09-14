"""Shared docx-opening + paragraph/heading-walk primitive.

Each backend layers its own chapter-shaping contract on top of
``load_docx_paragraphs`` - manuscript_guide.py needs a flat paragraph list
tagged with a running chapter name, while compare.py needs paragraphs
grouped into heading-delimited chapters and raises if none exist. Those two
shapes are different enough that forcing one shared return value would just
be duplication with extra indirection, so only the genuinely-identical
opening/walking/heading-detection step lives here.
"""


# Structural headings that describe the document rather than a narratable
# chapter - callers should skip these instead of starting a chapter for them.
NON_CHAPTER_HEADINGS = {"table of contents", "contents"}


def load_docx_paragraphs(path, detect_outline_headings=False):
    """Every non-empty paragraph in document order, stripped only (no
    internal-whitespace collapsing - callers that need that do it
    themselves, since they don't all want it).

    detect_outline_headings: also treat a paragraph as a heading when it
    carries an explicit outline level (Format > Paragraph > Outline Level)
    below 9 ("Body Text"), even without a "Heading N"/"Title" named style -
    e.g. a manually-formatted heading. Off by default: multilevel/outline
    numbered lists routinely carry an outline level on ordinary list items
    too, and compare.py's chapter-vs-track-name matching (proofing) would
    fracture into spurious chapters if every such paragraph became a new
    "chapter" - only manuscript_guide.py's chapter view opts into this.
    """
    from docx import Document  # lazy import, matches both callers' existing pattern

    document = Document(path)
    paragraphs = []
    for paragraph in document.paragraphs:
        text = paragraph.text.strip()
        if not text:
            continue
        style = (paragraph.style.name or "").lower() if paragraph.style else ""
        is_heading = style.startswith("heading") or style == "title"
        if detect_outline_headings and not is_heading:
            outline_level = paragraph.paragraph_format.outline_level
            is_heading = outline_level is not None and outline_level < 9
        paragraphs.append({"text": text, "is_heading": is_heading})
    return paragraphs
