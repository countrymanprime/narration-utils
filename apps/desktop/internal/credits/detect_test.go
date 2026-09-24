package credits

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
)

func writeMinimalEPUBWithMetadata(t *testing.T, path, metadataXML string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(file)
	entries := map[string]string{
		"META-INF/container.xml": `<?xml version="1.0" encoding="UTF-8"?>` +
			`<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">` +
			`<rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
		"content.opf": `<?xml version="1.0" encoding="UTF-8"?>` +
			`<package xmlns="http://www.idpf.org/2007/opf" xmlns:opf="http://www.idpf.org/2007/opf" version="3.0">` +
			`<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">` + metadataXML + `</metadata>` +
			`<manifest><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest>` +
			`<spine><itemref idref="ch1"/></spine></package>`,
		"ch1.xhtml": `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>One</h1><p>Text.</p></body></html>`,
	}
	for name, content := range entries {
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
}

func manuscriptWithEPUBCover(storedPath string) map[string]any {
	return map[string]any{
		"schemaVersion": 1,
		"importer":      map[string]any{"format": "epub"},
		"source":        map[string]any{"fileName": "book.epub", "storedPath": storedPath},
		"chapters": []map[string]any{
			{"id": "c-0001", "title": "Front Matter", "contentKind": "opening"},
			{"id": "c-0002", "title": "Chapter One", "contentKind": "narration"},
		},
		"paragraphs": []map[string]any{
			{"id": "p-000001", "chapterId": "c-0001", "text": "Neon Nights", "index": 0},
			{"id": "p-000002", "chapterId": "c-0001", "text": "by A. Writer", "index": 1},
			{"id": "p-000003", "chapterId": "c-0002", "text": "It was a dark night.", "index": 2},
		},
	}
}

func TestDetectPrefersEPUBMetadataOverFrontMatterWhenBothArePresent(t *testing.T) {
	project := t.TempDir()
	stored := realStoredPath("book.epub")
	writeManuscript(t, project, manuscriptWithEPUBCover(stored))
	writeMinimalEPUBWithMetadata(t, filepath.Join(project, stored), `<dc:title>Neon Nights (EPUB)</dc:title>`+
		`<dc:creator opf:role="aut">A. Writer (EPUB)</dc:creator>`)

	candidates := Detect(project)

	byToken := map[string]Candidate{}
	for _, candidate := range candidates {
		byToken[candidate.Token] = candidate
	}
	if got := byToken[TokenTitle]; got.Value != "Neon Nights (EPUB)" || got.Confidence != ConfidenceHigh {
		t.Fatalf("Title = %+v, want the EPUB metadata to win at high confidence", got)
	}
	if got := byToken[TokenAuthor]; got.Value != "A. Writer (EPUB)" || got.Confidence != ConfidenceHigh {
		t.Fatalf("Author = %+v, want the EPUB metadata to win at high confidence", got)
	}
}

func TestDetectFallsBackToFrontMatterWhenTheEPUBHasNoMetadata(t *testing.T) {
	project := t.TempDir()
	stored := realStoredPath("book.epub")
	writeManuscript(t, project, manuscriptWithEPUBCover(stored))
	writeMinimalEPUBWithMetadata(t, filepath.Join(project, stored), ``)

	candidates := Detect(project)

	byToken := map[string]Candidate{}
	for _, candidate := range candidates {
		byToken[candidate.Token] = candidate
	}
	if got := byToken[TokenTitle]; got.Value != "Neon Nights" {
		t.Fatalf("Title = %+v, want the front matter's value", got)
	}
	if got := byToken[TokenAuthor]; got.Value != "A. Writer" {
		t.Fatalf("Author = %+v, want the front matter's value", got)
	}
}

func TestDetectIsEmptyNotNilWithNoManuscript(t *testing.T) {
	got := Detect(t.TempDir())
	if got == nil || len(got) != 0 {
		t.Fatalf("Detect = %+v, want an empty, non-nil slice (so the wire sends [] rather than null)", got)
	}
}

func TestDetectNeverPanicsOnHostileManuscriptJSON(t *testing.T) {
	project := t.TempDir()
	dir := filepath.Join(project, "narration-utils", "manuscript")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, blob := range []string{`{`, `null`, `[]`, `{"chapters": "not an array"}`, `{"source": {"storedPath": "../../etc/passwd"}}`} {
		if err := os.WriteFile(filepath.Join(dir, "manuscript.json"), []byte(blob), 0o644); err != nil {
			t.Fatal(err)
		}
		Detect(project)
	}
}
