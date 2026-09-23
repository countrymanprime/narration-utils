package importer

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
)

func writeMinimalDocxWithCoreProps(t *testing.T, coreXML string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "book.docx")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(file)
	if coreXML != "" {
		writer, err := archive.Create("docProps/core.xml")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := writer.Write([]byte(coreXML)); err != nil {
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

func TestReadCorePropsReadsTitleAndCreator(t *testing.T) {
	path := writeMinimalDocxWithCoreProps(t, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>Bad Ideas Look Great in Neon</dc:title>
  <dc:creator>A. Writer</dc:creator>
</cp:coreProperties>`)
	title, author, ok := ReadCoreProps(path)
	if !ok {
		t.Fatal("ok = false, want true")
	}
	if title != "Bad Ideas Look Great in Neon" || author != "A. Writer" {
		t.Fatalf("title=%q author=%q, want the docProps values", title, author)
	}
}

func TestReadCorePropsIsFalseWithNoCorePropsPart(t *testing.T) {
	path := writeMinimalDocxWithCoreProps(t, "")
	if _, _, ok := ReadCoreProps(path); ok {
		t.Fatal("ok = true, want false: no docProps/core.xml part")
	}
}

func TestReadCorePropsIsFalseForAMissingFile(t *testing.T) {
	if _, _, ok := ReadCoreProps(filepath.Join(t.TempDir(), "missing.docx")); ok {
		t.Fatal("ok = true, want false for a file that does not exist")
	}
}

func TestReadCorePropsIsFalseWhenBothPropertiesAreEmpty(t *testing.T) {
	path := writeMinimalDocxWithCoreProps(t, `<?xml version="1.0" encoding="UTF-8"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title></dc:title>
</cp:coreProperties>`)
	if _, _, ok := ReadCoreProps(path); ok {
		t.Fatal("ok = true, want false when title and creator are both empty")
	}
}
