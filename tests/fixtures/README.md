# Test fixtures

Real manuscript content for exercising manuscript import (docx/markdown/pdf)
end-to-end, instead of synthetic one-off files. Not runtime dependencies -
used from tests and for manual/ad-hoc verification.

## alice.docx / alice.md / alice.pdf

The first three chapters of *Alice's Adventures in Wonderland* (Lewis
Carroll, 1865 - public domain worldwide), sourced from Project Gutenberg
EBook #11 (`alice_raw.txt`). Real prose, real chapter breaks, and real
typographic punctuation (curly quotes, em dashes) that a purely synthetic
fixture wouldn't exercise.

`alice.docx` also has a "Contents" Heading-1 paragraph inserted before
Chapter II specifically to exercise the `NON_CHAPTER_HEADINGS` skip path
(see `libs/python/narration_common/docx_chapters.py`) against a real
heading, not just a synthetic unit-test one.

Regenerate with:

```powershell
cd tests/fixtures
python generate_alice.py alice_raw.txt
```

Needs `python-docx` and `fpdf2` (`pip install fpdf2` - a fixture-generation
tool only, not a project dependency) and, as written, a Windows Arial TTF
path for Unicode PDF text - see the script for how to point it elsewhere.

**Known limitation, deliberately left visible rather than worked around:**
`alice.pdf` imports as a single paragraph with no chapter breaks via the
current Python PDF import path (`_pdf_draft` in `manuscript.py`). `pypdf`'s
`extract_text()` never produces a blank line for a PDF built this way (a
large `pdf.ln()` gap and an explicit empty text-draw both failed to
trigger one), so the whole document is one block for the
`re.split(r"\n\s*\n+", ...)` chapter/paragraph splitter regardless of how
many chapters it has. This is a real, pre-existing characteristic of PDF
import generally - any manuscript PDF from a similarly simple generator
(not Word/LibreOffice's PDF export, which does preserve blank lines) hits
the same ceiling. The Go importer (`apps/desktop/internal/importer`) reads the same file
through its own PDF path.
