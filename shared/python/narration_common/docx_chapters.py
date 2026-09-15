"""Shared docx-opening + paragraph/heading-walk primitive.

manuscript.py's importer is the only caller: it's the sole code that reads a
source manuscript directly, and everything else (manuscript_guide.py,
compare.py) consumes the canonical manuscript.json it produces instead of
re-parsing the source. See manuscript.py's module docstring.
"""


# Structural headings that describe the document rather than a narratable
# chapter - callers should skip these instead of starting a chapter for them.
NON_CHAPTER_HEADINGS = {"table of contents", "contents"}


def load_docx_paragraph_records(path, progress=None):
    """Every non-empty paragraph in document order, stripped only (no
    internal-whitespace collapsing - the caller does that itself), tagged
    with is_heading_outline: true for a "Heading N"/"Title" named style, or
    for a paragraph carrying an explicit outline level (Format > Paragraph >
    Outline Level) below 9 ("Body Text") even without a heading style - e.g.
    a manually-formatted heading.
    """
    from docx import Document  # lazy import, matches manuscript.py's fallback-only usage

    if progress:
        progress("Opening Word document…")
    document = Document(path)
    records = []
    total = len(document.paragraphs)
    if progress:
        progress(f"Reading {total:,} Word paragraphs…")
    for index, paragraph in enumerate(document.paragraphs, start=1):
        text = paragraph.text.strip()
        if not text:
            continue
        style = (paragraph.style.name or "").lower() if paragraph.style else ""
        is_heading_outline = style.startswith("heading") or style == "title"
        if not is_heading_outline:
            # ParagraphFormat.outline_level was removed in python-docx 1.2.0;
            # read the same w:outlineLvl value at the oxml level so this
            # works across the versions still in use.
            pPr = paragraph.paragraph_format._element.pPr
            outline_lvl = pPr.outlineLvl if pPr is not None else None
            outline_level = outline_lvl.val if outline_lvl is not None else None
            is_heading_outline = outline_level is not None and outline_level < 9
        records.append({"text": text, "is_heading_outline": is_heading_outline})
        if progress and index % 250 == 0:
            progress(f"Read {index:,} of {total:,} Word paragraphs…")
    return records
