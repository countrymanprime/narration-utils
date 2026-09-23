package importer

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// epubFixture writes a minimal, well-formed EPUB whose contents are exactly
// the given name->content map (already including mimetype,
// META-INF/container.xml and the OPF unless the test overrides them),
// mirroring docxFixture's in-memory-archive pattern so hostile and quirk
// shapes stay reviewable next to their assertion.
func epubFixture(t *testing.T, files map[string]string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "book.epub")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(file)
	for name, content := range files {
		writer, err := archive.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := writer.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

const epubContainerXML = `<?xml version="1.0" encoding="UTF-8"?>` +
	`<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">` +
	`<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`

// baseEPUBFiles returns the container.xml and OPF (manifest and spine) every
// fixture in this file shares, keyed by archive path; callers add their own
// content documents, nav/ncx and any encryption.xml on top.
func baseEPUBFiles(manifest, spine string) map[string]string {
	return map[string]string{
		"mimetype":               "application/epub+zip",
		"META-INF/container.xml": epubContainerXML,
		"OEBPS/content.opf": `<?xml version="1.0" encoding="UTF-8"?>` +
			`<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">` +
			`<dc:title>Book</dc:title></metadata><manifest>` + manifest + `</manifest><spine>` + spine + `</spine></package>`,
	}
}

func TestEPUBNavTOCDrivesChapters(t *testing.T) {
	files := baseEPUBFiles(
		`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`+
			`<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>`+
			`<item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>`,
		`<itemref idref="ch1"/><itemref idref="ch2"/>`,
	)
	files["OEBPS/nav.xhtml"] = `<?xml version="1.0" encoding="UTF-8"?>` +
		`<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">` +
		`<body><nav epub:type="toc"><ol><li><a href="ch1.xhtml#c1">One</a></li><li><a href="ch2.xhtml#c2">Two</a></li></ol></nav></body></html>`
	files["OEBPS/ch1.xhtml"] = `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1 id="c1">Chapter One</h1><p>First body text.</p></body></html>`
	files["OEBPS/ch2.xhtml"] = `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1 id="c2">Chapter Two</h1><p>Second body text.</p></body></html>`

	draft, err := epubWithProgress(epubFixture(t, files), nil)
	if err != nil {
		t.Fatal(err)
	}
	if draft.Format != "epub" {
		t.Fatalf("format = %q", draft.Format)
	}
	if got := draft.ChapterTitles; len(got) != 2 || got[0] != "Chapter One" || got[1] != "Chapter Two" {
		t.Fatalf("chapter titles = %#v", got)
	}
	if chapterText(t, draft, "Chapter One") != "First body text." {
		t.Fatalf("chapter one text = %q", chapterText(t, draft, "Chapter One"))
	}
	if chapterText(t, draft, "Chapter Two") != "Second body text." {
		t.Fatalf("chapter two text = %q", chapterText(t, draft, "Chapter Two"))
	}
}

func TestEPUBNCXFallbackWhenNoNav(t *testing.T) {
	files := baseEPUBFiles(
		`<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`+
			`<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>`,
		`<itemref idref="ch1"/>`,
	)
	files["OEBPS/toc.ncx"] = `<?xml version="1.0" encoding="UTF-8"?>` +
		`<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>` +
		`<navPoint id="np1"><navLabel><text>Chapter One</text></navLabel><content src="ch1.xhtml#c1"/></navPoint>` +
		`</navMap></ncx>`
	files["OEBPS/ch1.xhtml"] = `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1 id="c1">Chapter One</h1><p>Body text.</p></body></html>`

	draft, err := epubWithProgress(epubFixture(t, files), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(draft.ChapterTitles) != 1 || draft.ChapterTitles[0] != "Chapter One" {
		t.Fatalf("chapter titles = %#v", draft.ChapterTitles)
	}
}

func TestEPUBSpineFallbackWhenTOCIsMissing(t *testing.T) {
	files := baseEPUBFiles(
		`<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>`+
			`<item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>`,
		`<itemref idref="ch1"/><itemref idref="ch2"/>`,
	)
	files["OEBPS/ch1.xhtml"] = `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Chapter One</h1><p>First.</p></body></html>`
	files["OEBPS/ch2.xhtml"] = `<html xmlns="http://www.w3.org/1999/xhtml"><body><h2>Chapter Two</h2><p>Second.</p></body></html>`

	draft, err := epubWithProgress(epubFixture(t, files), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(draft.ChapterTitles) != 2 {
		t.Fatalf("chapter titles = %#v", draft.ChapterTitles)
	}
	found := false
	for _, notice := range draft.Notices {
		if strings.Contains(notice, "No usable table of contents") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected a spine-fallback notice, got %#v", draft.Notices)
	}
}

// T4 parity (Success Metrics, "No un-narratable import"): an EPUB with no
// TOC and no headings at all must still import as one narration chapter
// with a notice, never silently as all-"opening".
func TestEPUBNoTOCAndNoHeadingsBecomesOneChapter(t *testing.T) {
	files := baseEPUBFiles(
		`<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>`,
		`<itemref idref="ch1"/>`,
	)
	files["OEBPS/ch1.xhtml"] = `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Just some prose, no headings at all.</p></body></html>`

	draft, err := epubWithProgress(epubFixture(t, files), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(draft.ChapterTitles) != 1 {
		t.Fatalf("expected one synthetic chapter, got %#v", draft.ChapterTitles)
	}
	narrationWords := 0
	for _, section := range draft.Sections {
		if section.ContentKind == "narration" {
			narrationWords++
		}
	}
	if narrationWords == 0 {
		t.Fatal("expected at least one narration section")
	}
	found := false
	for _, notice := range draft.Notices {
		if strings.Contains(notice, "No chapters were found") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected a chapterless-fallback notice, got %#v", draft.Notices)
	}
}

func TestEPUBSemanticSpansAndLineBreaks(t *testing.T) {
	files := baseEPUBFiles(
		`<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>`,
		`<itemref idref="ch1"/>`,
	)
	files["OEBPS/ch1.xhtml"] = `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Chapter One</h1>` +
		`<p>Plain <em>italic</em> and <strong>bold</strong> and<br/>a line break.</p></body></html>`

	draft, err := epubWithProgress(epubFixture(t, files), nil)
	if err != nil {
		t.Fatal(err)
	}
	var body Paragraph
	for _, p := range draft.Paragraphs {
		if p.Chapter == "Chapter One" {
			body = p
			break
		}
	}
	if !strings.Contains(body.Text, "\n") {
		t.Fatalf("expected a line break in %q", body.Text)
	}
	var italic, bold bool
	for _, span := range body.Spans {
		italic = italic || span.Style == "italic"
		bold = bold || span.Style == "bold"
	}
	if !italic || !bold {
		t.Fatalf("expected italic and bold spans, got %#v", body.Spans)
	}
}

func TestEPUBFontObfuscationIsAccepted(t *testing.T) {
	files := baseEPUBFiles(
		`<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>`,
		`<itemref idref="ch1"/>`,
	)
	files["OEBPS/ch1.xhtml"] = `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Chapter One</h1><p>Body.</p></body></html>`
	files["META-INF/encryption.xml"] = `<?xml version="1.0" encoding="UTF-8"?>` +
		`<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">` +
		`<enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/></enc:EncryptedData></encryption>`

	if _, err := epubWithProgress(epubFixture(t, files), nil); err != nil {
		t.Fatalf("font obfuscation alone must not refuse the import: %v", err)
	}
}

func TestEPUBDRMIsRefused(t *testing.T) {
	files := baseEPUBFiles(
		`<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>`,
		`<itemref idref="ch1"/>`,
	)
	files["OEBPS/ch1.xhtml"] = `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Chapter One</h1><p>Body.</p></body></html>`
	files["META-INF/encryption.xml"] = `<?xml version="1.0" encoding="UTF-8"?>` +
		`<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">` +
		`<enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes256-cbc"/></enc:EncryptedData></encryption>`

	_, err := epubWithProgress(epubFixture(t, files), nil)
	if err == nil {
		t.Fatal("a DRM'd EPUB must be refused")
	}
	if err.Error() != epubDRMMessage {
		t.Fatalf("message = %q", err.Error())
	}
}

func TestEPUBAdobeRightsXMLIsRefused(t *testing.T) {
	files := baseEPUBFiles(
		`<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>`,
		`<itemref idref="ch1"/>`,
	)
	files["OEBPS/ch1.xhtml"] = `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Chapter One</h1><p>Body.</p></body></html>`
	files["META-INF/rights.xml"] = `<rights/>`

	if _, err := epubWithProgress(epubFixture(t, files), nil); err == nil {
		t.Fatal("an Adobe rights.xml must be refused")
	}
}

func TestEPUBPathTraversalHrefIsRejected(t *testing.T) {
	if got := resolveEPUBHref("OEBPS", "../../secret.xhtml"); got != "" {
		t.Fatalf("expected a traversal href to resolve to \"\", got %q", got)
	}
	if got := resolveEPUBHref("OEBPS", "chapter1.xhtml"); got != "OEBPS/chapter1.xhtml" {
		t.Fatalf("normal href resolved to %q", got)
	}
}

func TestEPUBMissingContainerIsRejected(t *testing.T) {
	path := epubFixture(t, map[string]string{"mimetype": "application/epub+zip"})
	if _, err := epubWithProgress(path, nil); err == nil {
		t.Fatal("expected an error for a missing container.xml")
	}
}

func TestEPUBOversizedEntryIsRejected(t *testing.T) {
	files := baseEPUBFiles(
		`<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>`,
		`<itemref idref="ch1"/>`,
	)
	huge := "<html xmlns=\"http://www.w3.org/1999/xhtml\"><body><h1>Chapter One</h1><p>" + strings.Repeat("word ", int(epubMaxEntrySize/4)) + "</p></body></html>"
	files["OEBPS/ch1.xhtml"] = huge

	// The oversized spine document is skipped with a notice rather than
	// crashing or reading unbounded memory; with no other content the book
	// has no readable text at all.
	_, err := epubWithProgress(epubFixture(t, files), nil)
	if err == nil {
		t.Fatal("expected an error: the only spine document exceeded the per-entry cap")
	}
}

// TestEPUBBodyEpubTypeClassifiesDedicationAsOpening pins the Architecture
// notes' "Classification" table (Phase 3, ADR 0102): epub:type takes
// precedence over the title-text classifier, so a dedication page titled
// something that does not itself read as front matter still lands "opening".
func TestEPUBBodyEpubTypeClassifiesDedicationAsOpening(t *testing.T) {
	files := baseEPUBFiles(
		`<item id="ded" href="ded.xhtml" media-type="application/xhtml+xml"/>`+
			`<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>`,
		`<itemref idref="ded"/><itemref idref="ch1"/>`,
	)
	files["OEBPS/ded.xhtml"] = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">` +
		`<body epub:type="dedication"><h1>For My Mother</h1><p>Who always believed.</p></body></html>`
	files["OEBPS/ch1.xhtml"] = `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Chapter One</h1><p>Body.</p></body></html>`

	draft, err := epubWithProgress(epubFixture(t, files), nil)
	if err != nil {
		t.Fatal(err)
	}
	dedication := sectionNamed(t, draft, "For My Mother")
	if dedication.ContentKind != "opening" {
		t.Fatalf("dedication content kind = %q, want opening", dedication.ContentKind)
	}
}

// TestEPUBBodyEpubTypeClassifiesEndnotesAsReference mirrors the reference
// half of the same table: a whole endnotes document reached only through the
// TOC (no heading text of its own that the title classifier would recognize)
// still lands "reference".
func TestEPUBBodyEpubTypeClassifiesEndnotesAsReference(t *testing.T) {
	files := baseEPUBFiles(
		`<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>`+
			`<item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/>`,
		`<itemref idref="ch1"/><itemref idref="notes"/>`,
	)
	files["OEBPS/ch1.xhtml"] = `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Chapter One</h1><p>Body.</p></body></html>`
	files["OEBPS/notes.xhtml"] = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">` +
		`<body epub:type="endnotes"><h1>Notes</h1><p>1. A citation.</p></body></html>`

	draft, err := epubWithProgress(epubFixture(t, files), nil)
	if err != nil {
		t.Fatal(err)
	}
	notes := sectionNamed(t, draft, "Notes")
	if notes.ContentKind != "reference" {
		t.Fatalf("notes content kind = %q, want reference", notes.ContentKind)
	}
}

// TestEPUBGluedHeadingIsSplitAndReported pins the "glued heading repair"
// Phase 3 scope: parity with DOCX and Markdown, which both report the split
// in Notices (ADR 0013).
func TestEPUBGluedHeadingIsSplitAndReported(t *testing.T) {
	files := baseEPUBFiles(
		`<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>`,
		`<itemref idref="ch1"/>`,
	)
	files["OEBPS/ch1.xhtml"] = `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Chapter OneBad Ideas</h1><p>Body.</p></body></html>`

	draft, err := epubWithProgress(epubFixture(t, files), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(draft.ChapterTitles) != 1 || draft.ChapterTitles[0] != "Chapter One" {
		t.Fatalf("chapter titles = %#v", draft.ChapterTitles)
	}
	found := false
	for _, notice := range draft.Notices {
		if strings.Contains(notice, "no gap between its number and title") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected a glued-heading notice, got %#v", draft.Notices)
	}
}

// TestEPUBNonLinearItemIsSkippedAndReported pins E4: a spine itemref marked
// linear="no" is not read into the reading order, and the skip is reported.
func TestEPUBNonLinearItemIsSkippedAndReported(t *testing.T) {
	files := baseEPUBFiles(
		`<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>`+
			`<item id="bonus" href="bonus.xhtml" media-type="application/xhtml+xml"/>`,
		`<itemref idref="ch1"/><itemref idref="bonus" linear="no"/>`,
	)
	files["OEBPS/ch1.xhtml"] = `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Chapter One</h1><p>Body.</p></body></html>`
	files["OEBPS/bonus.xhtml"] = `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Bonus Scene</h1><p>Ancillary.</p></body></html>`

	draft, err := epubWithProgress(epubFixture(t, files), nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, title := range draft.ChapterTitles {
		if title == "Bonus Scene" {
			t.Fatal("a linear=\"no\" spine item must not enter the reading order")
		}
	}
	found := false
	for _, notice := range draft.Notices {
		if strings.Contains(notice, "non-linear") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected a non-linear-item notice, got %#v", draft.Notices)
	}
}

// TestEPUBNoteReferenceMarkerIsDropped pins E4's other half: an inline
// epub:type="noteref" marker's own text (the footnote number) never reaches
// the narrator, so "the end.1" reads as "the end."
func TestEPUBNoteReferenceMarkerIsDropped(t *testing.T) {
	files := baseEPUBFiles(
		`<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>`,
		`<itemref idref="ch1"/>`,
	)
	files["OEBPS/ch1.xhtml"] = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">` +
		`<body><h1>Chapter One</h1><p>The end.<a epub:type="noteref" href="notes.xhtml#n1">1</a></p></body></html>`

	draft, err := epubWithProgress(epubFixture(t, files), nil)
	if err != nil {
		t.Fatal(err)
	}
	text := chapterText(t, draft, "Chapter One")
	if strings.Contains(text, "1") {
		t.Fatalf("expected the noteref marker to be dropped, got %q", text)
	}
	if !strings.Contains(text, "The end.") {
		t.Fatalf("expected the surrounding text to survive, got %q", text)
	}
}

// TestEPUBCSSClassEmphasisFromInlineStyle pins E3's Phase 3 scope: a
// single-class, single-declaration font-style/font-weight rule from the
// document's own <style> maps a <span class="..."> to a span, the same as a
// semantic <em>/<strong> would.
func TestEPUBCSSClassEmphasisFromInlineStyle(t *testing.T) {
	files := baseEPUBFiles(
		`<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>`,
		`<itemref idref="ch1"/>`,
	)
	files["OEBPS/ch1.xhtml"] = `<html xmlns="http://www.w3.org/1999/xhtml"><head>` +
		`<style>.calibre1{font-style:italic}</style></head>` +
		`<body><h1>Chapter One</h1><p>Plain <span class="calibre1">stylesheet italic</span> text.</p></body></html>`

	draft, err := epubWithProgress(epubFixture(t, files), nil)
	if err != nil {
		t.Fatal(err)
	}
	var body Paragraph
	for _, p := range draft.Paragraphs {
		if p.Chapter == "Chapter One" {
			body = p
			break
		}
	}
	italic := false
	for _, span := range body.Spans {
		if span.Style == "italic" {
			italic = true
		}
	}
	if !italic {
		t.Fatalf("expected an italic span from the stylesheet class, got %#v", body.Spans)
	}
}

// TestEPUBCSSClassEmphasisFromLinkedStylesheet covers the more common real
// shape: the formatting class comes from a linked stylesheet.css, not an
// inline <style>, resolved relative to the content document's own directory.
func TestEPUBCSSClassEmphasisFromLinkedStylesheet(t *testing.T) {
	files := baseEPUBFiles(
		`<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>`+
			`<item id="css" href="stylesheet.css" media-type="text/css"/>`,
		`<itemref idref="ch1"/>`,
	)
	files["OEBPS/stylesheet.css"] = `.calibre1{font-weight:bold}`
	files["OEBPS/ch1.xhtml"] = `<html xmlns="http://www.w3.org/1999/xhtml"><head>` +
		`<link rel="stylesheet" type="text/css" href="stylesheet.css"/></head>` +
		`<body><h1>Chapter One</h1><p>Plain <span class="calibre1">bold</span> text.</p></body></html>`

	draft, err := epubWithProgress(epubFixture(t, files), nil)
	if err != nil {
		t.Fatal(err)
	}
	var body Paragraph
	for _, p := range draft.Paragraphs {
		if p.Chapter == "Chapter One" {
			body = p
			break
		}
	}
	bold := false
	for _, span := range body.Spans {
		if span.Style == "bold" {
			bold = true
		}
	}
	if !bold {
		t.Fatalf("expected a bold span from the linked stylesheet class, got %#v", body.Spans)
	}
}

// TestEPUBUnresolvedCSSClassIsCountedInNotices pins the "anything else is
// text without a span and a count in Notices" half of E3.
func TestEPUBUnresolvedCSSClassIsCountedInNotices(t *testing.T) {
	files := baseEPUBFiles(
		`<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>`,
		`<itemref idref="ch1"/>`,
	)
	files["OEBPS/ch1.xhtml"] = `<html xmlns="http://www.w3.org/1999/xhtml"><head>` +
		`<style>.fancy{font-size:200%}</style></head>` +
		`<body><h1>Chapter One</h1><p>Plain <span class="fancy">fancy</span> text.</p></body></html>`

	draft, err := epubWithProgress(epubFixture(t, files), nil)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, notice := range draft.Notices {
		if strings.Contains(notice, "formatting class") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected an unresolved-formatting-class notice, got %#v", draft.Notices)
	}
}

func TestEPUBFixtureParityWithAliceMarkdown(t *testing.T) {
	mdDraft, err := BuildDraft(fixture("alice.md"), 1)
	if err != nil {
		t.Fatal(err)
	}
	epubDraft, err := BuildDraft(fixture("alice.epub"), 1)
	if err != nil {
		t.Fatal(err)
	}
	if epubDraft.Format != "epub" {
		t.Fatalf("format = %q", epubDraft.Format)
	}
	if len(epubDraft.ChapterTitles) != 3 {
		t.Fatalf("expected 3 chapters (the EPUB fixture has no title heading, unlike alice.md/.docx), got %#v", epubDraft.ChapterTitles)
	}
	for _, marker := range []string{"Rabbit-Hole", "Pool of Tears", "Caucus-Race"} {
		md := chapterText(t, mdDraft, marker)
		epubText := chapterText(t, epubDraft, marker)
		// alice.md's own generator has a pre-existing bug (see
		// TestTxtFixtureNarrationMatchesMarkdownFixture's own comment in
		// importer_test.go): its last kept chapter ("Caucus-Race") bleeds in
		// the rest of the book as unmarked text. alice.epub's own generator,
		// built from the same parse_chapters() output as alice.txt, does not
		// have this bug, so its chapter is correctly bounded and shorter -
		// compare a prefix rather than requiring the inflated md chapter to
		// match exactly.
		if len(epubText) < len(md) {
			md = md[:len(epubText)]
		}
		if md != epubText {
			t.Fatalf("chapter %q text differs:\nmd:   %q\nepub: %q", marker, md, epubText)
		}
	}
}
