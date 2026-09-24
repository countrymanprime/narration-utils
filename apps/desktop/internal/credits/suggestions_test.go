package credits

import (
	"archive/zip"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func writeMinimalDocxWithCoreProps(t *testing.T, path, coreXML string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(file)
	writer, err := archive.Create("docProps/core.xml")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := writer.Write([]byte(coreXML)); err != nil {
		t.Fatal(err)
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
}

func writeManuscript(t *testing.T, project string, doc map[string]any) {
	t.Helper()
	dir := filepath.Join(project, "narration-utils", "manuscript")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	bytes, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "manuscript.json"), bytes, 0o644); err != nil {
		t.Fatal(err)
	}
}

func manuscriptWithCover(storedPath string) map[string]any {
	return map[string]any{
		"schemaVersion": 1,
		"importer":      map[string]any{"format": "docx"},
		"source":        map[string]any{"fileName": "book.docx", "storedPath": storedPath},
		"chapters": []map[string]any{
			{"id": "c-0001", "title": "Front Matter", "contentKind": "opening", "sections": []map[string]any{{"id": "c-0001-s-001", "title": "Cover"}}},
			{"id": "c-0002", "title": "Chapter One", "contentKind": "narration", "sections": []any{}},
		},
		"paragraphs": []map[string]any{
			{"id": "p-000001", "chapterId": "c-0001", "sectionId": "c-0001-s-001", "text": "Bad Ideas Look Great in Neon", "index": 0},
			{"id": "p-000002", "chapterId": "c-0001", "sectionId": "c-0001-s-001", "text": "by A. Writer", "index": 1},
			{"id": "p-000003", "chapterId": "c-0002", "sectionId": nil, "text": "It was a dark night.", "index": 2},
		},
	}
}

func TestSuggestFromManuscriptReadsTitleAndAuthorFromTheOpeningChaptersFrontMatter(t *testing.T) {
	project := t.TempDir()
	writeManuscript(t, project, manuscriptWithCover(""))
	suggestions := SuggestFromManuscript(project)
	if suggestions["Title"] != "Bad Ideas Look Great in Neon" {
		t.Fatalf("Title suggestion = %q", suggestions["Title"])
	}
	if suggestions["Author"] != "A. Writer" {
		t.Fatalf("Author suggestion = %q, want the \"by \" prefix stripped", suggestions["Author"])
	}
}

func TestSuggestFromManuscriptIsEmptyWithNoManuscript(t *testing.T) {
	suggestions := SuggestFromManuscript(t.TempDir())
	if len(suggestions) != 0 {
		t.Fatalf("suggestions = %v, want none", suggestions)
	}
}

func TestSuggestFromManuscriptIsEmptyWithNoOpeningChapter(t *testing.T) {
	project := t.TempDir()
	doc := manuscriptWithCover("")
	doc["chapters"] = []map[string]any{{"id": "c-0002", "title": "Chapter One", "contentKind": "narration", "sections": []any{}}}
	doc["paragraphs"] = []map[string]any{{"id": "p-000003", "chapterId": "c-0002", "sectionId": nil, "text": "It was a dark night.", "index": 0}}
	writeManuscript(t, project, doc)
	suggestions := SuggestFromManuscript(project)
	if len(suggestions) != 0 {
		t.Fatalf("suggestions = %v, want none: no opening chapter to read front matter from", suggestions)
	}
}

func TestStoredSourcePathRefusesAPathThatEscapesTheSourcesFolder(t *testing.T) {
	project := t.TempDir()
	for _, storedPath := range []string{
		filepath.Join("..", "..", "etc", "passwd"),
		filepath.Join("narration-utils", "manuscript", "manuscript.json"),
		filepath.Join("narration-utils", "settings.json"),
		"",
	} {
		if _, ok := storedSourcePath(project, storedPath); ok {
			t.Fatalf("storedSourcePath(%q) = ok, want refused (outside sources/)", storedPath)
		}
	}
	inside := filepath.Join("narration-utils", "manuscript", "sources", "src-1", "book.docx")
	resolved, ok := storedSourcePath(project, inside)
	if !ok || resolved != filepath.Join(project, inside) {
		t.Fatalf("storedSourcePath(%q) = %q, %v, want it accepted", inside, resolved, ok)
	}
}

// realStoredPath is the shape commit() (apps/desktop/internal/manuscript/service.go) actually writes:
// "narration-utils/manuscript/sources/<id>/<name>", relative to the project folder, not a bare file name under
// "narration-utils/manuscript". A made-up bare name would hide the double-join defect (credits-token-setup-and-front-
// matter-detection.prd.md Evidence).
func realStoredPath(name string) string {
	return filepath.Join("narration-utils", "manuscript", "sources", "src-0001", name)
}

// TestSuggestFromManuscriptPrefersFrontMatterOverDocPropsWhenBothArePresent pins CS6's precedence: the front matter
// beats DOCX properties (this PRD amends the credits PRD's original "docProps wins" design).
func TestSuggestFromManuscriptPrefersFrontMatterOverDocPropsWhenBothArePresent(t *testing.T) {
	project := t.TempDir()
	stored := realStoredPath("book.docx")
	writeManuscript(t, project, manuscriptWithCover(stored))
	docxPath := filepath.Join(project, stored)
	writeMinimalDocxWithCoreProps(t, docxPath, `<?xml version="1.0" encoding="UTF-8"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>Neon (docProps)</dc:title>
  <dc:creator>A. Writer (docProps)</dc:creator>
</cp:coreProperties>`)

	suggestions := SuggestFromManuscript(project)

	if suggestions["Title"] != "Bad Ideas Look Great in Neon" {
		t.Fatalf("Title suggestion = %q, want the front matter's value to win over docProps", suggestions["Title"])
	}
	if suggestions["Author"] != "A. Writer" {
		t.Fatalf("Author suggestion = %q, want the front matter's value to win over docProps", suggestions["Author"])
	}
}

// TestSuggestFromManuscriptFallsBackToDocPropsWhenFrontMatterFindsNothing covers the other half of CS6: DOCX
// properties are used when the front matter has nothing for that token.
func TestSuggestFromManuscriptFallsBackToDocPropsWhenFrontMatterFindsNothing(t *testing.T) {
	project := t.TempDir()
	stored := realStoredPath("book.docx")
	doc := manuscriptWithCover(stored)
	doc["paragraphs"] = []map[string]any{{"id": "p-000003", "chapterId": "c-0002", "sectionId": nil, "text": "It was a dark night.", "index": 0}}
	writeManuscript(t, project, doc)
	docxPath := filepath.Join(project, stored)
	writeMinimalDocxWithCoreProps(t, docxPath, `<?xml version="1.0" encoding="UTF-8"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>Neon (docProps)</dc:title>
  <dc:creator>A. Writer (docProps)</dc:creator>
</cp:coreProperties>`)

	suggestions := SuggestFromManuscript(project)

	if suggestions["Title"] != "Neon (docProps)" || suggestions["Author"] != "A. Writer (docProps)" {
		t.Fatalf("suggestions = %+v, want the docProps values used since the front matter had nothing", suggestions)
	}
}

// TestSuggestFromManuscriptIgnoresAMachineDefaultDocProperty covers CS6's other rule: a DOCX creator/title that looks
// like a machine default (Word's own placeholder, or the file's own name) is never offered, even as a fallback.
func TestSuggestFromManuscriptIgnoresAMachineDefaultDocProperty(t *testing.T) {
	project := t.TempDir()
	stored := realStoredPath("book.docx")
	doc := manuscriptWithCover(stored)
	doc["paragraphs"] = []map[string]any{{"id": "p-000003", "chapterId": "c-0002", "sectionId": nil, "text": "It was a dark night.", "index": 0}}
	writeManuscript(t, project, doc)
	docxPath := filepath.Join(project, stored)
	writeMinimalDocxWithCoreProps(t, docxPath, `<?xml version="1.0" encoding="UTF-8"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>book</dc:title>
  <dc:creator>Microsoft Office User</dc:creator>
</cp:coreProperties>`)

	suggestions := SuggestFromManuscript(project)

	if _, ok := suggestions["Title"]; ok {
		t.Fatalf("suggestions = %+v, want no Title: \"book\" is the file's own name", suggestions)
	}
	if _, ok := suggestions["Author"]; ok {
		t.Fatalf("suggestions = %+v, want no Author: a machine default must never be offered", suggestions)
	}
}
