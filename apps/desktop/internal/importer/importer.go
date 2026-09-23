package importer

import (
	"fmt"
	"path/filepath"
	"strings"
)

// Progress receives real stage reports while a draft is built: a percentage
// in 0-100 and a human-readable line for the import log (ADR-0015). A nil
// Progress is valid and reports nothing.
type Progress func(percent int, message string)

func (p Progress) report(percent int, format string, args ...any) {
	if p != nil {
		p(percent, fmt.Sprintf(format, args...))
	}
}

// BuildDraft is the one format-selection boundary shared by Wails and the
// standalone compatibility CLI.
func BuildDraft(path string, markdownHeadingLevel int) (Draft, error) {
	return BuildDraftProgress(path, markdownHeadingLevel, nil)
}

// BuildDraftProgress is BuildDraft with stage reporting. The format switch
// itself lives in formats.go's list (txt-and-epub-import PRD, Phase 1): a new
// format is a one-line addition there instead of a new case here.
func BuildDraftProgress(path string, markdownHeadingLevel int, progress Progress) (Draft, error) {
	extension := strings.ToLower(strings.TrimPrefix(filepath.Ext(path), "."))
	if extension == "pdf" {
		// PDF extraction remains a quarantined candidate behind the
		// pdf_candidate test tag. Shipped builds never accept a format whose
		// chapter-boundary gate has not passed.
		return Draft{}, &Error{"PDF import is temporarily unavailable pending the approved corpus parity gate. Use DOCX or Markdown."}
	}
	if f := formatFor(extension); f != nil {
		return f.build(path, markdownHeadingLevel, progress)
	}
	return Draft{}, &Error{unsupportedFormatMessage}
}
