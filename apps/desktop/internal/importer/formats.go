package importer

import "strings"

// format is one importable manuscript format: its canonical name (the wire
// Draft.Format value), the file extensions that select it, and the function
// that turns a file into a Draft. One list here feeds BuildDraftProgress's
// format switch and error message, the file-picker filter (bindings.go) and
// the standalone CLI (which already delegates to BuildDraft with no format
// restriction of its own beyond the quarantined pdf case, so it needs no
// separate edit) - replacing the PRD's Evidence finding of six hard-coded
// places ("txt-and-epub-import" PRD, Phase 1, "One accepted-formats list").
//
// pdf is deliberately absent: it stays a quarantined, build-tag-gated
// candidate (see the switch in importer.go) that the picker and CLI never
// offer until its chapter-boundary gate passes.
type format struct {
	name       string
	extensions []string
	build      func(path string, markdownHeadingLevel int, progress Progress) (Draft, error)
}

var formats = []format{
	{name: "docx", extensions: []string{"docx"}, build: func(path string, _ int, progress Progress) (Draft, error) {
		return docxWithProgress(path, progress)
	}},
	{name: "markdown", extensions: []string{"md", "markdown"}, build: func(path string, headingLevel int, progress Progress) (Draft, error) {
		return markdownWithProgress(path, headingLevel, progress)
	}},
	{name: "txt", extensions: []string{"txt"}, build: func(path string, _ int, progress Progress) (Draft, error) {
		return txtWithProgress(path, progress)
	}},
}

func formatFor(extension string) *format {
	extension = strings.ToLower(strings.TrimPrefix(extension, "."))
	for index := range formats {
		for _, candidate := range formats[index].extensions {
			if candidate == extension {
				return &formats[index]
			}
		}
	}
	return nil
}

// Extensions lists every extension the importer accepts (with its leading
// dot), in the order the formats above are declared.
func Extensions() []string {
	result := make([]string, 0, 4)
	for _, f := range formats {
		for _, extension := range f.extensions {
			result = append(result, "."+extension)
		}
	}
	return result
}

// PickerPattern is the native file-picker filter pattern (bindings.go's
// OpenDialogOptions), e.g. "*.docx;*.md;*.markdown;*.txt".
func PickerPattern() string {
	extensions := Extensions()
	parts := make([]string, 0, len(extensions))
	for _, extension := range extensions {
		parts = append(parts, "*"+extension)
	}
	return strings.Join(parts, ";")
}

// unsupportedFormatMessage is BuildDraftProgress's error for any extension
// formatFor does not recognize (and that isn't the quarantined pdf case).
const unsupportedFormatMessage = "Choose a Word (.docx), Markdown (.md) or plain text (.txt) manuscript."
