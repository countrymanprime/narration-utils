//go:build pdf_candidate

// The PDF extractor is intentionally excluded from normal Go builds. It is a
// fail-closed evaluation candidate only; run `go test -tags pdf_candidate` on
// an approved narrator corpus before proposing that PDF import ship.
package importer

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"

	"github.com/giraffesyo/pdf"
)

var pdfChapterPrefix = regexp.MustCompile(`(?i)^(chapter|book|part)\b`)
var pdfBlocks = regexp.MustCompile(`\n\s*\n+`)
var inlineChapterHeading = regexp.MustCompile(`(?i)chapter\s+(?:[ivxlcdm]+|\d+)\s*[:.]`)

// pdf is deliberately strict about text-layer availability. The chosen
// extractor has no bundled OCR, and accepting a scanned manuscript as an
// empty draft would be worse than asking for a text-based PDF.
func pdfDraft(path string) (Draft, error) {
	file, err := os.Open(path)
	if err != nil {
		return Draft{}, &Error{"Could not read this PDF: " + err.Error()}
	}
	defer func() { _ = file.Close() }() // read-only
	info, err := file.Stat()
	if err != nil {
		return Draft{}, &Error{"Could not read this PDF: " + err.Error()}
	}
	document, err := pdf.Extract(context.Background(), file, info.Size())
	if err != nil {
		return Draft{}, &Error{"Could not read this PDF: " + err.Error()}
	}
	text := document.Text()
	if len([]rune(strings.Join(strings.Fields(text), ""))) < 80 {
		return Draft{}, &Error{"This PDF has no selectable manuscript text. OCR support is not available yet; use a text-based PDF."}
	}
	chapter := "Front Matter"
	paragraphs := []Paragraph{}
	titles := []string{}
	for _, block := range pdfBlocks.Split(text, -1) {
		lines := []string{}
		for _, line := range strings.Split(block, "\n") {
			if value := collapse(line); value != "" {
				lines = append(lines, value)
			}
		}
		if len(lines) == 0 {
			continue
		}
		candidate := lines[0]
		if pdfChapterPrefix.MatchString(candidate) || (len(lines) == 1 && len([]rune(candidate)) <= 90 && allUpper(candidate)) {
			chapter = candidate
			titles = append(titles, candidate)
			continue
		}
		paragraphs = append(paragraphs, Paragraph{Chapter: chapter, Text: collapse(strings.Join(lines, " ")), SourceIndex: len(paragraphs)})
	}
	// A PDF extractor may return recognisable headings embedded in prose while
	// failing to retain their line boundaries. That is exactly the failure seen
	// in the Alice fixture. Reject it rather than manufacturing chapters from
	// unreliable geometry.
	for _, match := range inlineChapterHeading.FindAllString(text, -1) {
		found := false
		for _, title := range titles {
			if strings.HasPrefix(strings.ToLower(collapse(title)), strings.ToLower(collapse(match))) {
				found = true
				break
			}
		}
		if !found {
			return Draft{}, &Error{"PDF text extraction could not reliably preserve chapter boundaries. Use DOCX or Markdown until this PDF is reviewed."}
		}
	}
	pre := []string{}
	indexes := []int{}
	for index, paragraph := range paragraphs {
		if paragraph.Chapter == "Front Matter" {
			pre = append(pre, paragraph.Text)
			indexes = append(indexes, index)
		}
	}
	for index, kind := range classifyPreHeading(pre) {
		paragraphs[indexes[index]].Chapter = kind
	}
	return newDraft("pdf", filepath.Base(path), paragraphs, titles)
}

func allUpper(value string) bool {
	hasCased := false
	for _, character := range value {
		if unicode.IsLower(character) {
			return false
		}
		if unicode.IsUpper(character) {
			hasCased = true
		}
	}
	return hasCased
}
