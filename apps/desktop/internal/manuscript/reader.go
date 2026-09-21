package manuscript

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

// Chapters returns the stable reader contract derived from the immutable
// canonical manuscript plus its separately editable review sidecar.
func (s *Service) Chapters() ([]map[string]any, error) {
	data, err := s.Load()
	if err != nil {
		return nil, err
	}
	notes := s.loadNotes()
	paragraphs := objects(data["paragraphs"])
	result := make([]map[string]any, 0, len(objects(data["chapters"])))
	for _, chapter := range objects(data["chapters"]) {
		result = append(result, chapterPayload(chapter, notes, paragraphs, true))
	}
	return result, nil
}

func (s *Service) Paragraphs(chapterID string) ([]map[string]any, error) {
	data, err := s.Load()
	if err != nil {
		return nil, err
	}
	result := []map[string]any{}
	for _, paragraph := range objects(data["paragraphs"]) {
		if text(paragraph, "chapterId") == chapterID {
			result = append(result, paragraphPayload(paragraph))
		}
	}
	return result, nil
}

func (s *Service) Reader() (map[string]any, error) {
	data, err := s.Load()
	if err != nil {
		return nil, err
	}
	notes := s.loadNotes()
	chapters := []map[string]any{}
	for _, chapter := range objects(data["chapters"]) {
		chapters = append(chapters, chapterPayload(chapter, notes, nil, false))
	}
	paragraphs := []map[string]any{}
	for _, paragraph := range objects(data["paragraphs"]) {
		paragraphs = append(paragraphs, paragraphPayload(paragraph))
	}
	return map[string]any{"chapters": chapters, "paragraphs": paragraphs, "notes": notes["notes"]}, nil
}

func (s *Service) Search(query string) ([]map[string]any, error) {
	if strings.TrimSpace(query) == "" {
		return []map[string]any{}, nil
	}
	data, err := s.Load()
	if err != nil {
		return nil, err
	}
	needle := strings.ToLower(query)
	result := []map[string]any{}
	for _, paragraph := range objects(data["paragraphs"]) {
		if strings.Contains(strings.ToLower(text(paragraph, "text")), needle) {
			result = append(result, map[string]any{
				"chapter": text(paragraph, "chapterTitle"), "chapterId": text(paragraph, "chapterId"),
				"paragraph": paragraph["index"], "paragraphId": text(paragraph, "id"), "excerpt": text(paragraph, "text"),
			})
		}
	}
	return result, nil
}

func (s *Service) SetChapterStatus(chapterID, status string) (map[string]any, error) {
	if !validChapterStatus(status) {
		return nil, fmt.Errorf("unknown chapter status: %s", status)
	}
	s.notesMu.Lock()
	defer s.notesMu.Unlock()
	data, err := s.Load()
	if err != nil {
		return nil, err
	}
	var found map[string]any
	for _, chapter := range objects(data["chapters"]) {
		if text(chapter, "id") == chapterID {
			found = chapter
			break
		}
	}
	if found == nil {
		return nil, fmt.Errorf("unknown manuscript chapter")
	}
	notes := s.loadNotes()
	statusByChapter := object(notes["chapterStatus"])
	statusByChapter[chapterID] = status
	notes["chapterStatus"] = statusByChapter
	if err := s.saveNotes(notes); err != nil {
		return nil, err
	}
	return chapterPayload(found, notes, nil, false), nil
}

func (s *Service) Notes(chapterID string) []map[string]any {
	result := []map[string]any{}
	for _, note := range objects(s.loadNotes()["notes"]) {
		if chapterID == "" || text(note, "chapterId") == chapterID {
			result = append(result, note)
		}
	}
	return result
}

func (s *Service) CreateNote(chapterID, paragraphID, body string, start, end *int, anchorText string) (map[string]any, error) {
	if start != nil && *start < 0 || end != nil && (start == nil || *end < *start) {
		return nil, fmt.Errorf("invalid note anchor")
	}
	s.notesMu.Lock()
	defer s.notesMu.Unlock()
	data, err := s.Load()
	if err != nil {
		return nil, err
	}
	var source map[string]any
	for _, paragraph := range objects(data["paragraphs"]) {
		if text(paragraph, "id") == paragraphID && text(paragraph, "chapterId") == chapterID {
			source = paragraph
			break
		}
	}
	if source == nil {
		return nil, fmt.Errorf("unknown manuscript paragraph")
	}
	note := map[string]any{"id": newID(), "chapter": text(source, "chapterTitle"), "chapterId": chapterID, "paragraph": source["index"], "paragraphId": paragraphID, "text": body, "createdAt": time.Now().UTC().Format(time.RFC3339Nano)}
	if start != nil {
		note["anchorStart"] = *start
	}
	if end != nil {
		note["anchorEnd"] = *end
	}
	if anchorText != "" {
		note["anchorText"] = anchorText
	}
	notes := s.loadNotes()
	list := objects(notes["notes"])
	list = append(list, note)
	notes["notes"] = list
	if err := s.saveNotes(notes); err != nil {
		return nil, err
	}
	return note, nil
}

func (s *Service) DeleteNote(id string) error {
	s.notesMu.Lock()
	defer s.notesMu.Unlock()
	notes := s.loadNotes()
	remaining := []map[string]any{}
	for _, note := range objects(notes["notes"]) {
		if text(note, "id") != id {
			remaining = append(remaining, note)
		}
	}
	notes["notes"] = remaining
	return s.saveNotes(notes)
}

func (s *Service) ReaderState() map[string]any { return object(s.loadNotes()["readerState"]) }

func (s *Service) SaveReaderState(activeChapter string, activeSourceLine *int, expanded []string, hasExpanded bool) (map[string]any, error) {
	s.notesMu.Lock()
	defer s.notesMu.Unlock()
	notes := s.loadNotes()
	current := object(notes["readerState"])
	next := map[string]any{"activeChapter": nil, "activeSourceLine": nil, "bookmarks": current["bookmarks"], "expandedChapters": current["expandedChapters"]}
	if activeChapter != "" {
		next["activeChapter"] = activeChapter
	}
	if activeSourceLine != nil {
		next["activeSourceLine"] = *activeSourceLine
	}
	if hasExpanded {
		next["expandedChapters"] = expanded
	}
	notes["readerState"] = next
	if err := s.saveNotes(notes); err != nil {
		return nil, err
	}
	return next, nil
}

func (s *Service) CreateBookmark(bookmark map[string]any) (map[string]any, error) {
	kind := text(bookmark, "kind")
	if kind != "chapter" && kind != "line" && kind != "note" {
		return nil, fmt.Errorf("unknown bookmark kind")
	}
	s.notesMu.Lock()
	defer s.notesMu.Unlock()
	notes := s.loadNotes()
	state := object(notes["readerState"])
	bookmarks := objects(state["bookmarks"])
	for _, existing := range bookmarks {
		if text(existing, "kind") == kind && text(existing, "chapterId") == text(bookmark, "chapterId") && text(existing, "paragraphId") == text(bookmark, "paragraphId") && text(existing, "noteId") == text(bookmark, "noteId") {
			return existing, nil
		}
	}
	bookmark["id"] = newID()
	bookmark["createdAt"] = time.Now().UTC().Format(time.RFC3339Nano)
	bookmarks = append(bookmarks, bookmark)
	state["bookmarks"] = bookmarks
	notes["readerState"] = state
	if err := s.saveNotes(notes); err != nil {
		return nil, err
	}
	return bookmark, nil
}

func (s *Service) DeleteBookmark(id string) error {
	s.notesMu.Lock()
	defer s.notesMu.Unlock()
	notes := s.loadNotes()
	state := object(notes["readerState"])
	remaining := []map[string]any{}
	for _, bookmark := range objects(state["bookmarks"]) {
		if text(bookmark, "id") != id {
			remaining = append(remaining, bookmark)
		}
	}
	state["bookmarks"] = remaining
	notes["readerState"] = state
	return s.saveNotes(notes)
}

func (s *Service) loadNotes() map[string]any {
	s.mu.Lock()
	project := s.project
	s.mu.Unlock()
	if project == "" {
		return emptyNotes()
	}
	// The notes, reader state and chapter statuses are the narrator's own work: a file that cannot be read is kept aside, the
	// narrator is told, and a fresh one is started, so the next note never replaces it without a trace (ADR 0069).
	var raw map[string]any
	s.persist.Load().ReadJSON(filepath.Join(project, "narration-utils", "manuscript-notes.json"), "notes", persist.NarratorData, func(bytes []byte) error {
		var decoded map[string]any
		if err := json.Unmarshal(bytes, &decoded); err != nil {
			return err
		}
		if decoded == nil {
			return fmt.Errorf("not a JSON object")
		}
		raw = decoded
		return nil
	})
	if raw == nil {
		return emptyNotes()
	}
	return normalizeNotes(raw)
}

func (s *Service) saveNotes(notes map[string]any) error {
	s.mu.Lock()
	project := s.project
	s.mu.Unlock()
	if project == "" {
		return fmt.Errorf("save the REAPER project first")
	}
	path := filepath.Join(project, "narration-utils", "manuscript-notes.json")
	if err := persist.CanOverwrite(path, "notes"); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("could not create manuscript sidecar: %w", err)
	}
	bytes, err := json.MarshalIndent(notes, "", "  ")
	if err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, bytes, 0o600); err != nil {
		return fmt.Errorf("could not write manuscript sidecar: %w", err)
	}
	if err := os.Rename(temporary, path); err != nil {
		return fmt.Errorf("could not activate manuscript sidecar: %w", err)
	}
	return nil
}

func emptyNotes() map[string]any {
	return map[string]any{"notes": []map[string]any{}, "chapterStatus": map[string]any{}, "readerState": map[string]any{"activeChapter": nil, "activeSourceLine": nil, "bookmarks": []map[string]any{}, "expandedChapters": nil}}
}
func normalizeNotes(raw map[string]any) map[string]any {
	lower := map[string]any{}
	for key, value := range raw {
		lower[strings.ToLower(key)] = value
	}
	result := emptyNotes()
	if value, ok := lower["notes"]; ok {
		result["notes"] = value
	}
	if value, ok := lower["chapterstatus"]; ok {
		result["chapterStatus"] = value
	}
	if value, ok := lower["readerstate"]; ok {
		result["readerState"] = value
	}
	return result
}
func validChapterStatus(value string) bool {
	return value == "not_started" || value == "recording" || value == "editing" || value == "proofing" || value == "finalized"
}
func objects(value any) []map[string]any {
	list, _ := value.([]any)
	if list == nil {
		if maps, ok := value.([]map[string]any); ok {
			return maps
		}
		return []map[string]any{}
	}
	result := make([]map[string]any, 0, len(list))
	for _, item := range list {
		if object, ok := item.(map[string]any); ok {
			result = append(result, object)
		}
	}
	return result
}
func object(value any) map[string]any {
	result, _ := value.(map[string]any)
	if result == nil {
		return map[string]any{}
	}
	return result
}
func text(value map[string]any, key string) string { result, _ := value[key].(string); return result }
func paragraphPayload(paragraph map[string]any) map[string]any {
	payload := map[string]any{"id": text(paragraph, "id"), "chapterId": text(paragraph, "chapterId"), "chapter": text(paragraph, "chapterTitle"), "index": paragraph["index"], "text": text(paragraph, "text"), "entityIds": []string{}}
	if spans, ok := paragraph["spans"]; ok {
		payload["spans"] = spans
	}
	return payload
}
func chapterPayload(chapter, notes map[string]any, paragraphs []map[string]any, includeParagraphs bool) map[string]any {
	status := "not_started"
	if stored, ok := object(notes["chapterStatus"])[text(chapter, "id")].(string); ok {
		status = stored
	}
	result := map[string]any{"id": text(chapter, "id"), "title": text(chapter, "title"), "index": chapter["index"], "wordCount": chapter["wordCount"], "contentKind": text(chapter, "contentKind"), "status": status}
	if subtitle := text(chapter, "subtitle"); subtitle != "" {
		result["subtitle"] = subtitle
	}
	if includeParagraphs {
		ids := []map[string]any{}
		for _, paragraph := range paragraphs {
			if text(paragraph, "chapterId") == text(chapter, "id") {
				ids = append(ids, map[string]any{"id": text(paragraph, "id"), "index": paragraph["index"]})
			}
		}
		result["paragraphIds"] = ids
	}
	return result
}
