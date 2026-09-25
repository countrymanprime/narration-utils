package manuscript

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// KindChange is SetChapterKind's answer: the chapter as the chapter list now sends it, and the kind it had before.
type KindChange struct {
	Chapter      map[string]any
	PreviousKind string
}

// SetChapterKind reclassifies one chapter after import (chapter-track-link-control PRD Phase 3, TL2): "Remove from
// recording" makes a narration chapter reference material (or Front Matter) and Restore makes it narration again.
// Only that chapter's contentKind changes: the document id, every id, the paragraphs and importedAt stay, so the
// statuses, notes, bookmarks, findings and check results of every chapter stay valid, this one's included. The first
// change records the kind the chapter was imported as (importedKind); each change records kindChangedAt. It is
// refused while an import job is open, for a chapter that is not in the manuscript, and for the last narration
// chapter. Asking for the kind a chapter already has writes nothing.
func (s *Service) SetChapterKind(chapterID, kind string, now time.Time) (KindChange, error) {
	if kind != "narration" && kind != "opening" && kind != "reference" {
		return KindChange{}, fmt.Errorf("unknown chapter kind: %s", kind)
	}
	found, previous, err := s.rewriteChapterKind(chapterID, kind, now)
	if err != nil {
		return KindChange{}, err
	}
	s.notesMu.Lock()
	notes := s.loadNotes()
	s.notesMu.Unlock()
	return KindChange{Chapter: chapterPayload(found, notes, s.recordedFractions(), nil, false), PreviousKind: previous}, nil
}

// rewriteChapterKind does SetChapterKind's check and write under s.mu, held through the rename so an import cannot
// begin committing in between. It returns the stored chapter as it now is and the kind it had.
func (s *Service) rewriteChapterKind(chapterID, kind string, now time.Time) (map[string]any, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, job := range s.jobs {
		if job.Phase != "success" && job.Phase != "error" && job.Phase != "cancelled" {
			return nil, "", errors.New("wait for the manuscript import to finish")
		}
	}
	if s.project == "" {
		return nil, "", errors.New("save the REAPER project and import a manuscript first")
	}
	path := filepath.Join(s.project, "narration-utils", "manuscript", "manuscript.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, "", errors.New("import a manuscript first")
	}
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil || data["schemaVersion"] != float64(1) {
		return nil, "", errors.New("the canonical manuscript data could not be read")
	}
	var found map[string]any
	narration := 0
	for _, chapter := range objects(data["chapters"]) {
		if isNarration(chapter) {
			narration++
		}
		if text(chapter, "id") == chapterID {
			found = chapter
		}
	}
	if found == nil {
		return nil, "", errors.New("unknown manuscript chapter")
	}
	previous := text(found, "contentKind")
	if previous == "" {
		previous = "narration"
	}
	if previous == kind {
		return found, previous, nil
	}
	if previous == "narration" && narration <= 1 {
		return nil, "", errors.New("the last narration chapter cannot be removed from recording")
	}
	if _, recorded := found["importedKind"]; !recorded {
		found["importedKind"] = previous
	}
	found["contentKind"] = kind
	found["kindChangedAt"] = now.UTC().Format(time.RFC3339)
	if err := replaceManuscript(path, data); err != nil {
		return nil, "", err
	}
	s.manCache.Store(nil)
	return found, previous, nil
}

// isNarration reports whether a stored chapter is narration, where a chapter with no content kind (imported before
// structural classification) is narration.
func isNarration(chapter map[string]any) bool {
	kind := text(chapter, "contentKind")
	return kind == "" || kind == "narration"
}

// replaceManuscript replaces manuscript.json through a temporary file and a rename, as commit does.
func replaceManuscript(path string, data map[string]any) error {
	encoded, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, encoded, 0o600); err != nil {
		return fmt.Errorf("could not write the manuscript: %w", err)
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("could not replace the manuscript: %w", err)
	}
	return nil
}
