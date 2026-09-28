package coverage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// creditsManuscriptPath is where a credits check's synthetic single-chapter manuscript is written (Phase 3): two
// directories below the project root, the same depth as the real narration-utils/manuscript/manuscript.json, so the
// sidecar's own project_data_dir (Path(manuscript_path).resolve().parents[2]) still resolves to
// <project>/TranscriptCompare and the narrator's word equivalences and vocabulary hints still apply to a credits
// check. It sits under narration-utils/analysis, this package's own write scope (see the package doc comment).
func creditsManuscriptPath(project string) string {
	return filepath.Join(Dir(project), "credits-manuscript.json")
}

// writeCreditsManuscript writes basis and text as a manuscript.json the unmodified Transcript Compare sidecar can
// already read (narration_common.manuscript.validate): one narration chapter, one paragraph holding the credits'
// whole rendered text. This is how a credits check reuses the sidecar without a sidecar change - the host never
// changes the project's own manuscript, only this transient stand-in (removed once the run ends, best-effort, in
// finish).
func writeCreditsManuscript(path string, basis ChapterBasis, text string) error {
	doc := map[string]any{
		"schemaVersion": 1,
		"documentId":    basis.DocumentID,
		"chapters": []map[string]any{{
			"id": basis.ChapterID, "title": basis.Title, "contentKind": "narration",
		}},
		"paragraphs": []map[string]any{{
			"id": creditsParagraphID(basis.ChapterID), "chapterId": basis.ChapterID, "index": 0, "text": text,
		}},
	}
	encoded, err := json.Marshal(doc)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("could not create the credits check folder: %w", err)
	}
	return os.WriteFile(path, encoded, 0o600)
}

// creditsParagraphID is the one paragraph a credits row's synthetic manuscript holds, named off its chapter id so
// the UI's recording-check report (which reads a chapter's paragraphIds to number a gap) can build a matching
// single-paragraph list for a credits subject.
func creditsParagraphID(chapterID string) string { return chapterID + "-p0" }
