# Test fixtures

Real manuscript content for exercising manuscript import (docx/markdown/pdf/txt/epub)
end-to-end, instead of synthetic one-off files. Not runtime dependencies -
used from tests and for manual/ad-hoc verification.

## alice.epub

An EPUB 3 book (with an EPUB 2 `toc.ncx` alongside its `nav.xhtml`, as many real
exporters ship both) built by `write_epub` in `generate_alice.py` from the same
three-chapter Gutenberg text as `alice.txt`/`alice.md`/`alice.docx`, so
`TestEPUBFixtureParityWithAliceMarkdown` (`apps/desktop/internal/importer/epub_test.go`)
can compare their narration text directly. A front-matter document with no
heading precedes the chapters, classified Front Matter/Cover the same way
`alice.txt`'s own front matter is - unlike `alice.md`/`alice.docx`, which give
the book title its own `Title`-styled heading and section, `alice.epub` has
none, so it has 3 chapters where `alice.md`/`alice.docx` have 4.

Regenerate along with the others (below), or on its own without the
`python-docx`/`fpdf2` dependencies:

```powershell
cd tests/fixtures
python -c "import importlib.util; from pathlib import Path; spec = importlib.util.spec_from_file_location('gen', 'generate_alice.py'); mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); mod.write_epub(mod.parse_chapters(Path('alice_raw.txt')), Path('alice.epub'))"
```

## heading-misreads/

Small constructed manuscripts (DOCX, EPUB, Markdown and plain text, one chapter heading each) that exercise the
importer's title/subtitle heuristic: 5 read correctly and 18 do not (story-bible-and-import-ux-briefs PRD, Phase 4).
`cases.json` records each case's intended and observed title and subtitle, and `TestHeadingMisreadFixtures`
(`apps/desktop/internal/importer/heading_misreads_test.go`) holds the importer to the observed values.
[`docs/research/import-heading-misreads.md`](../../docs/research/import-heading-misreads.md) explains each failure
mode, and the subtitle override (Phase 5) uses these cases as its fixtures. Regenerate with the standard library only:

```powershell
cd tests/fixtures/heading-misreads
python generate.py
```

## teleprompter-locate/

The recorded tails the teleprompter's tail-audio locate is measured on
([ADR 0111](../../docs/adr/0111-the-resume-point-comes-from-transcribing-the-recorded-tail-and-placing-it-with-the-tracker.md),
`sidecars/manuscript-teleprompter/tests/test_locate.py`). `chapter.txt` is Chapter I of `alice.md` (one paragraph per
line, `_italics_` markers removed) and `chapter-repeated.txt` the same chapter with its twelfth paragraph repeated at the
end. `tails.json` holds, per case, what the tiny Whisper model heard in the last seconds of a Piper reading that stops at
a known word (`expectedWord`), and whether the case should be confident. Only the transcripts are committed, not the
audio. Regenerate with the app's own installed voice and model:

```powershell
uv run python sidecars/manuscript-teleprompter/spikes/record_locate_tails.py `
  --piper-model "$env:LOCALAPPDATA/narration-utils/assets/tts/piper/en_US-ljspeech-high/1.0.0/en_US-ljspeech-high.onnx" `
  --model-dir "$env:LOCALAPPDATA/narration-utils/assets/whisper/faster-whisper/tiny/<commit>"
```

## alice.txt

A Gutenberg-shaped, hard-wrapped plain-text export of the same three chapters (`write_txt` in
`generate_alice.py`): a `*** START OF ... ***`/`*** END OF ... ***` boilerplate pair, lines
wrapped at about 70 columns, and `_word_` underscore italics, matching `alice_raw.txt`'s own
shape (PRD Evidence). Used by the TXT importer's parity and hazard tests
(`apps/desktop/internal/importer/txt_test.go`).

## alice.docx / alice.md / alice.pdf

The first three chapters of *Alice's Adventures in Wonderland* (Lewis
Carroll, 1865 - public domain worldwide), sourced from Project Gutenberg
EBook #11 (`alice_raw.txt`). Real prose, real chapter breaks, and real
typographic punctuation (curly quotes, em dashes) that a purely synthetic
fixture wouldn't exercise.

`alice.docx` also has a "Contents" Heading-1 paragraph inserted before
Chapter II specifically to exercise the non-chapter-heading skip path
(`isNonChapterHeading` in `apps/desktop/internal/importer/`) against a real
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
