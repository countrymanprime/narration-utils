package credits

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// SuggestFromManuscript seeds Title and Author suggestions from the current project's imported manuscript: a thin
// wrapper over Detect (credits-token-setup-and-front-matter-detection.prd.md Phase 1) that keeps
// CreditsProjectValues.suggestions compatible with what it always returned, now backed by the front matter parser and
// file metadata rather than only a "Cover" section and docProps (CS10: the Cover label no longer matters to credits).
// This never writes anything back to manuscript.json or the source file; it only reads and returns editable
// suggestions for the narrator to accept, change or ignore. A project with no manuscript, or one with nothing
// detectable, returns an empty map rather than an error - suggesting nothing is a normal outcome, not a failure.
func SuggestFromManuscript(projectFolder string) map[string]string {
	suggestions := map[string]string{}
	for _, candidate := range Detect(projectFolder) {
		switch candidate.Token {
		case TokenTitle:
			suggestions["Title"] = candidate.Value
		case TokenAuthor:
			suggestions["Author"] = candidate.Value
		}
	}
	return suggestions
}

// storedSourcePath resolves manuscript.json's source.storedPath to an absolute path under the project folder. commit()
// (apps/desktop/internal/manuscript/service.go) writes storedPath already relative to the project folder itself
// ("narration-utils/manuscript/sources/<id>/<name>"), not to "narration-utils/manuscript", so it is joined directly
// rather than under a second "narration-utils/manuscript" (the defect this fixes: that second join produced a path
// that never existed, so the docProps source never fired on a real import). The result is refused unless it stays
// under .../narration-utils/manuscript/sources/: manuscript.json is narrator data, but a hand-edited or hostile file
// must not steer a read to an arbitrary path via ".." or an absolute storedPath.
func storedSourcePath(projectFolder, storedPath string) (string, bool) {
	if storedPath == "" {
		return "", false
	}
	sourcesDir := filepath.Join(projectFolder, "narration-utils", "manuscript", "sources")
	resolved := filepath.Join(projectFolder, filepath.FromSlash(storedPath))
	relative, err := filepath.Rel(sourcesDir, resolved)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", false
	}
	return resolved, true
}

// manuscriptDoc is the subset of manuscript.json this package reads (see
// apps/desktop/internal/manuscript/service.go's canonicalize for the full
// shape). Decoding only these fields keeps this package from depending on the
// manuscript package's own types.
type manuscriptDoc struct {
	Importer struct {
		Format string `json:"format"`
	} `json:"importer"`
	Source struct {
		FileName   string `json:"fileName"`
		StoredPath string `json:"storedPath"`
	} `json:"source"`
	Chapters []struct {
		ID          string `json:"id"`
		ContentKind string `json:"contentKind"`
	} `json:"chapters"`
	Paragraphs []struct {
		ChapterID string `json:"chapterId"`
		Text      string `json:"text"`
		Index     int    `json:"index"`
	} `json:"paragraphs"`
}

func readManuscriptDoc(projectFolder string) (manuscriptDoc, bool) {
	manuscriptPath := filepath.Join(projectFolder, "narration-utils", "manuscript", "manuscript.json")
	bytes, err := os.ReadFile(manuscriptPath)
	if err != nil {
		return manuscriptDoc{}, false
	}
	var doc manuscriptDoc
	if err := json.Unmarshal(bytes, &doc); err != nil {
		return manuscriptDoc{}, false
	}
	return doc, true
}

// openingChapterLines returns the paragraph text of every "opening" content-kind chapter, in the manuscript's own
// paragraph order - the whole front matter, not just a "Cover" section (CS10).
func openingChapterLines(doc manuscriptDoc) []string {
	openingChapters := map[string]bool{}
	for _, chapter := range doc.Chapters {
		if chapter.ContentKind == "opening" {
			openingChapters[chapter.ID] = true
		}
	}
	type indexedLine struct {
		index int
		text  string
	}
	var indexed []indexedLine
	for _, paragraph := range doc.Paragraphs {
		if openingChapters[paragraph.ChapterID] {
			indexed = append(indexed, indexedLine{paragraph.Index, paragraph.Text})
		}
	}
	sort.Slice(indexed, func(i, j int) bool { return indexed[i].index < indexed[j].index })
	lines := make([]string, len(indexed))
	for i, entry := range indexed {
		lines[i] = entry.text
	}
	return lines
}
