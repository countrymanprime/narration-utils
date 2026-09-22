package credits

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/importer"
)

// SuggestFromManuscript seeds Title and Author suggestions from the current
// project's imported manuscript: the front-matter chapter's "Cover" section
// lines (importer.classifyPreHeading's heuristic, already stored in
// manuscript.json by the time this runs), and - when the source is a .docx
// still held in project-owned storage - its docProps/core.xml title/creator,
// which wins when present (PRD Open Question C3). This never writes anything
// back to manuscript.json or the source file; it only reads and returns
// editable suggestions for the narrator to accept, change or ignore. A
// project with no manuscript, or a front matter chapter with no Cover
// section, returns an empty map rather than an error - suggesting nothing is
// a normal outcome, not a failure.
func SuggestFromManuscript(projectFolder string) map[string]string {
	manuscriptPath := filepath.Join(projectFolder, "narration-utils", "manuscript", "manuscript.json")
	bytes, err := os.ReadFile(manuscriptPath)
	if err != nil {
		return map[string]string{}
	}
	var doc manuscriptDoc
	if err := json.Unmarshal(bytes, &doc); err != nil {
		return map[string]string{}
	}

	suggestions := map[string]string{}
	if title, author, ok := suggestFromCoverLines(doc); ok {
		if title != "" {
			suggestions["Title"] = title
		}
		if author != "" {
			suggestions["Author"] = author
		}
	}
	if doc.Source.StoredPath != "" {
		docxPath := filepath.Join(projectFolder, "narration-utils", "manuscript", filepath.FromSlash(doc.Source.StoredPath))
		if title, author, ok := importer.ReadCoreProps(docxPath); ok {
			if title != "" {
				suggestions["Title"] = title
			}
			if author != "" {
				suggestions["Author"] = author
			}
		}
	}
	return suggestions
}

// manuscriptDoc is the subset of manuscript.json this package reads (see
// apps/desktop/internal/manuscript/service.go's canonicalize for the full
// shape). Decoding only these fields keeps this package from depending on the
// manuscript package's own types.
type manuscriptDoc struct {
	Source struct {
		StoredPath string `json:"storedPath"`
	} `json:"source"`
	Chapters []struct {
		ID          string `json:"id"`
		ContentKind string `json:"contentKind"`
		Sections    []struct {
			ID    string `json:"id"`
			Title string `json:"title"`
		} `json:"sections"`
	} `json:"chapters"`
	Paragraphs []struct {
		ChapterID string `json:"chapterId"`
		SectionID string `json:"sectionId"`
		Text      string `json:"text"`
		Index     int    `json:"index"`
	} `json:"paragraphs"`
}

// suggestFromCoverLines finds the opening chapter's "Cover" section (set at
// import time by the same heuristic that seeds Front Matter, model.go's
// classifyPreHeading) and reads its first two lines: the first as a Title
// suggestion, the second as an Author suggestion when it starts with "by "
// (case-insensitive), mirroring the cover heuristic's own "line 2 starts with
// 'by '" rule.
func suggestFromCoverLines(doc manuscriptDoc) (title, author string, ok bool) {
	var coverChapterID, coverSectionID string
	for _, chapter := range doc.Chapters {
		if chapter.ContentKind != "opening" {
			continue
		}
		for _, section := range chapter.Sections {
			if section.Title == "Cover" {
				coverChapterID, coverSectionID = chapter.ID, section.ID
			}
		}
	}
	if coverSectionID == "" {
		return "", "", false
	}
	var lines []string
	for _, paragraph := range doc.Paragraphs {
		if paragraph.ChapterID == coverChapterID && paragraph.SectionID == coverSectionID {
			lines = append(lines, strings.TrimSpace(paragraph.Text))
		}
	}
	if len(lines) == 0 {
		return "", "", false
	}
	title = lines[0]
	if len(lines) > 1 && strings.HasPrefix(strings.ToLower(lines[1]), "by ") {
		author = strings.TrimSpace(lines[1][len("by "):])
	}
	return title, author, true
}
