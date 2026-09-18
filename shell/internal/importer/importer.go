package importer

import (
	"path/filepath"
	"strings"
)

// BuildDraft is the one format-selection boundary shared by Wails and the
// standalone compatibility CLI.
func BuildDraft(path string, markdownHeadingLevel int) (Draft, error) {
	switch strings.ToLower(strings.TrimPrefix(filepath.Ext(path), ".")) {
	case "docx":
		return docx(path)
	case "md", "markdown":
		return markdown(path, markdownHeadingLevel)
	case "pdf":
		// PDF extraction remains a quarantined candidate behind the
		// pdf_candidate test tag. Shipped builds never accept a format whose
		// chapter-boundary gate has not passed.
		return Draft{}, &Error{"PDF import is temporarily unavailable pending the approved corpus parity gate. Use DOCX or Markdown."}
	default:
		return Draft{}, &Error{"Choose a Word (.docx) or Markdown (.md) manuscript."}
	}
}
