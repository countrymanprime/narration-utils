//go:build pdf_candidate

package importer

import "testing"

func TestPDFCandidateRejectsKnownAmbiguousAliceFixture(t *testing.T) {
	if _, err := pdfDraft(fixture("alice.pdf")); err == nil {
		t.Fatal("the PDF candidate must reject the known ambiguous Alice fixture")
	}
}
