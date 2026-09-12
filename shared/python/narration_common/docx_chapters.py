"""Shared docx-opening + paragraph/heading-walk primitive.

Each backend layers its own chapter-shaping contract on top of
``load_docx_paragraphs`` - manuscript_guide.py needs a flat paragraph list
tagged with a running chapter name, while compare.py needs paragraphs
grouped into heading-delimited chapters and raises if none exist. Those two
shapes are different enough that forcing one shared return value would just
be duplication with extra indirection, so only the genuinely-identical
opening/walking/heading-detection step lives here.
"""


def load_docx_paragraphs(path):
    """Every non-empty paragraph in document order, stripped only (no
    internal-whitespace collapsing - callers that need that do it
    themselves, since they don't all want it)."""
    from docx import Document  # lazy import, matches both callers' existing pattern

    document = Document(path)
    paragraphs = []
    for paragraph in document.paragraphs:
        text = paragraph.text.strip()
        if not text:
            continue
        style = (paragraph.style.name or "").lower() if paragraph.style else ""
        is_heading = style.startswith("heading") or style == "title"
        paragraphs.append({"text": text, "is_heading": is_heading})
    return paragraphs
