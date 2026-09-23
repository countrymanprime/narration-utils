package importer

import (
	"archive/zip"
	"encoding/xml"
	"strings"
)

// coreProperties is the subset of docProps/core.xml this app reads: dc:title
// and dc:creator, the two fields a docx author fills in via File > Info. The
// XML uses two namespaces (cp: for the wrapper, dc: for these two elements);
// decoding into Local-name-only fields sidesteps needing either prefix's URI.
type coreProperties struct {
	Title   string `xml:"title"`
	Creator string `xml:"creator"`
}

// ReadCoreProps reads a .docx file's docProps/core.xml (Word's own "title"
// and "creator" document properties) without touching word/document.xml.
// It is a read-only, best-effort lookup used only to suggest values (PRD
// audiobook-credits-templates.prd.md, Open Question C3): ok is false whenever
// the file cannot be opened, has no docProps/core.xml, or that part has
// neither property set, and the caller must never write anything back into
// the source file or the manuscript from this.
func ReadCoreProps(path string) (title, author string, ok bool) {
	archive, err := zip.OpenReader(path)
	if err != nil {
		return "", "", false
	}
	defer func() { _ = archive.Close() }() // read-only
	content, found := docxEntry(archive, "docProps/core.xml")
	if !found {
		return "", "", false
	}
	var props coreProperties
	if err := xml.Unmarshal(content, &props); err != nil {
		return "", "", false
	}
	title = strings.TrimSpace(props.Title)
	author = strings.TrimSpace(props.Creator)
	return title, author, title != "" || author != ""
}
