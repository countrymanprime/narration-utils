//go:build pdf_candidate

package importer

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// pdfBytes builds a small text PDF with correct cross-reference offsets, one line of text per argument.
func pdfBytes(lines ...string) []byte {
	var stream strings.Builder
	stream.WriteString("BT /F1 12 Tf 14 TL 20 760 Td\n")
	for _, line := range lines {
		fmt.Fprintf(&stream, "(%s) Tj T*\n", line)
	}
	stream.WriteString("ET")
	objects := []string{
		"<</Type/Catalog/Pages 2 0 R>>",
		"<</Type/Pages/Kids[3 0 R]/Count 1>>",
		"<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
		fmt.Sprintf("<</Length %d>>\nstream\n%s\nendstream", stream.Len(), stream.String()),
		"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
	}
	var out strings.Builder
	out.WriteString("%PDF-1.4\n")
	offsets := make([]int, len(objects))
	for index, body := range objects {
		offsets[index] = out.Len()
		fmt.Fprintf(&out, "%d 0 obj\n%s\nendobj\n", index+1, body)
	}
	xref := out.Len()
	fmt.Fprintf(&out, "xref\n0 %d\n0000000000 65535 f \n", len(objects)+1)
	for _, offset := range offsets {
		fmt.Fprintf(&out, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&out, "trailer\n<</Root 1 0 R/Size %d>>\nstartxref\n%d\n%%%%EOF\n", len(objects)+1, xref)
	return []byte(out.String())
}

// FuzzPdfDraft guards the third-party PDF parser: a truncated or hostile file must come back as an
// error, never a panic. PDF import is a quarantined candidate (see pdf.go), so this target is compiled
// only with the same tag:
//
//	go -C apps/desktop test -tags pdf_candidate ./internal/importer -run='^$' -fuzz=FuzzPdfDraft -fuzztime=60s
func FuzzPdfDraft(f *testing.F) {
	// Enough text to pass the "has a text layer" check (80 visible characters). The extractor returns one line
	// per text line and no blank lines, so a whole page is one block: prose reaches the paragraph logic, and a
	// chapter heading in the middle of it reaches the "boundaries could not be preserved" rejection.
	manuscript := pdfBytes(
		"The old keeper climbed the spiral stairs each evening, lit the great lamp, and watched",
		"the ships pass. Nobody ever thanked him for it, and he never asked to be thanked.",
	)
	withHeading := pdfBytes(
		"The old keeper climbed the spiral stairs each evening, lit the great lamp, and watched",
		"the ships pass. Nobody ever thanked him for it, and he never asked to be thanked.",
		"CHAPTER TWO: The Storm",
		"By midnight the sea had risen against the rocks and the lamp burned alone.",
	)
	f.Add(manuscript)
	f.Add(withHeading)
	f.Add(manuscript[:len(manuscript)/2])
	f.Add(manuscript[:len(manuscript)-40])
	f.Add(pdfBytes("Hello"))
	f.Add([]byte("%PDF-1.4\n"))
	f.Add([]byte{})
	f.Fuzz(func(t *testing.T, data []byte) {
		path := filepath.Join(t.TempDir(), "fuzz.pdf")
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatal(err)
		}
		draft, err := pdfDraft(path)
		if err == nil {
			checkDraft(t, draft)
		}
	})
}

// TestPdfSeedIsReadable makes sure the first fuzz seed really reaches the paragraph logic, not just the
// early "no text" exit, so the seed corpus keeps exercising it.
func TestPdfSeedIsReadable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "seed.pdf")
	data := pdfBytes(
		"The old keeper climbed the spiral stairs each evening, lit the great lamp, and watched",
		"the ships pass. Nobody ever thanked him for it, and he never asked to be thanked.",
	)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	draft, err := pdfDraft(path)
	if err != nil {
		t.Fatalf("the seed PDF was rejected: %v", err)
	}
	if len(draft.Paragraphs) == 0 {
		t.Fatal("the seed PDF produced no paragraphs")
	}
}
