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


def load_docx_paragraph_records(path):
    """Every non-empty paragraph in document order, stripped only (no
    internal-whitespace collapsing - callers that need that do it
    themselves, since they don't all want it), carrying BOTH heading
    classifications used across this project:

    - is_heading: a "Heading N"/"Title" named style only.
    - is_heading_outline: also true for a paragraph carrying an explicit
      outline level (Format > Paragraph > Outline Level) below 9 ("Body
      Text"), even without a heading style - e.g. a manually-formatted
      heading. compare.py's chapter-vs-track-name matching (proofing) uses
      the coarser is_heading only: multilevel/outline numbered lists
      routinely carry an outline level on ordinary list items too, and
      proofing would fracture into spurious chapters if every such
      paragraph became a new "chapter". manuscript_guide.py's chapter view
      (and anything resolving a proofing discrepancy's local paragraph
      index into that view's global one) wants the finer is_heading_outline
      split instead. One document walk keeps the two schemes trivially
      position-aligned for callers that need to reconcile them.
    """
    from docx import Document  # lazy import, matches both callers' existing pattern

    document = Document(path)
    records = []
    for paragraph in document.paragraphs:
        text = paragraph.text.strip()
        if not text:
            continue
        style = (paragraph.style.name or "").lower() if paragraph.style else ""
        is_heading = style.startswith("heading") or style == "title"
        is_heading_outline = is_heading
        if not is_heading_outline:
            # ParagraphFormat.outline_level was removed in python-docx 1.2.0;
            # read the same w:outlineLvl value at the oxml level so this
            # works across the versions still in use.
            pPr = paragraph.paragraph_format._element.pPr
            outline_lvl = pPr.outlineLvl if pPr is not None else None
            outline_level = outline_lvl.val if outline_lvl is not None else None
            is_heading_outline = outline_level is not None and outline_level < 9
        records.append({"text": text, "is_heading": is_heading, "is_heading_outline": is_heading_outline})
    return records


def load_docx_paragraphs(path, detect_outline_headings=False):
    """Every non-empty paragraph in document order, tagged with a single
    is_heading classification - see load_docx_paragraph_records for what
    detect_outline_headings selects between."""
    key = "is_heading_outline" if detect_outline_headings else "is_heading"
    return [{"text": record["text"], "is_heading": record[key]} for record in load_docx_paragraph_records(path)]


def load_manuscript_paragraphs(path):
    """Flat, whole-document paragraph list in reading order, each tagged
    with its owning chapter title - the manuscript-global view (used by the
    Manuscript reader page, entity occurrences, and anything else that needs
    a stable "paragraph N of the whole book" index). Paragraphs before the
    first heading belong to a synthetic "Front matter" chapter, and chapters
    also split at outline-leveled headings (detect_outline_headings=True) -
    finer granularity than compare.py's own heading-only chapter split, so
    callers that need to line an index up against *that* split (e.g. to
    resolve a proofing discrepancy's local paragraph index into this global
    one) should match by paragraph text/position rather than by index math.
    """
    chapter = "Front matter"
    paragraphs = []
    for item in load_docx_paragraphs(path, detect_outline_headings=True):
        text = item["text"]
        if item["is_heading"]:
            heading = " ".join(text.split())
            if heading.strip().lower() in NON_CHAPTER_HEADINGS:
                continue
            chapter = heading
            continue
        paragraphs.append({"chapter": chapter, "text": " ".join(text.split())})
    return paragraphs
