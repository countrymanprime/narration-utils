// This file is Phase 5 of the analysis evidence ledger PRD
// (docs/prds/analysis-evidence-ledger.prd.md#phase-5---confirmed-chapter-track-mapping,
// Q6, Q7, Q9, D5): the narrator-confirmed trackGuid -> chapterId mapping
// store, plus the pure suggestion helper over TM Phase 8's chapter-to-track
// matcher (internal/chaptermatch). Q6 (option A): one
// JSON file per project, narration-utils/chapter-track-map.json, keyed by
// the manuscript's documentId, holding each mapping's chapter title and
// confirmedAt beside the id - the stored title is what lets a re-import
// re-suggest a link instead of asking again (Q9, see SuggestFromPrevious).
// Q7 (mapping confirm UI) and the "currentness read for the UI's basis
// label" (staleness) are Phase 6/7, not built here. Importers/callers: no
// production code imports this yet; apps/desktop/{mapping.go,bindings.go}
// will bind List/Confirm/Clear once this lands, and
// apps/desktop/internal/manuscript/service.go's resetDerived adds
// MappingFile to the paths a manuscript reset clears (Q9 option A: cleared,
// then re-suggested). Public API added here: TrackMapping, MappingFile,
// MappingStore, NewMappingStore, MappingStore's Confirm/Clear/List/Get
// methods, ChapterCandidate, TrackCandidate, MappingSuggestion, Suggester,
// SuggesterFunc, MatchSuggester and SuggestFromPrevious. Data schema: the
// mappingFileShape JSON below, versioned by its own SchemaVersion field
// (mappingSchemaVersion). User's instruction (verbatim): "you should have
// everythign you need to make decisions. anything that you think you need
// my decision on, create an open ADR for and keep going. callout any new
// adrs on the pr that you created them so i can review."
package evidence

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/chaptermatch"
	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

// mappingSchemaVersion is the schema version every file written by this
// package carries. A file read back with a higher version was written by a
// newer app and is treated as absent, never as an error the narrator has to
// fix (the same unknown-version rule LedgerStore and CacheStore follow).
const mappingSchemaVersion = 1

// TrackMapping is one narrator-confirmed trackGuid -> chapterId link (Q6).
// ChapterTitle is stored beside the id, not just the id, because chapter ids
// reset on every manuscript re-import (Evidence: ids are "c-%04d" and
// regenerate with a new documentId) - the remembered title is what
// SuggestFromPrevious matches against the new chapter list so re-linking
// costs one confirmation instead of asking the narrator to redo the search
// (Q9).
type TrackMapping struct {
	TrackGUID    string    `json:"trackGuid"`
	ChapterID    string    `json:"chapterId"`
	ChapterTitle string    `json:"chapterTitle"`
	ConfirmedAt  time.Time `json:"confirmedAt"`
}

// mappingFileShape is chapter-track-map.json's on-disk shape: every
// confirmed link for one manuscript document. DocumentID is the guard Q6's
// "keyed by documentId" describes - a file whose DocumentID does not match
// the caller's current documentId is read as empty, never as another
// document's links, so a mapping never survives a re-import that
// resetDerived did not get a chance to clear first (a killed process
// between re-import and reset, for example).
type mappingFileShape struct {
	SchemaVersion int            `json:"schemaVersion"`
	DocumentID    string         `json:"documentId"`
	Mappings      []TrackMapping `json:"mappings"`
}

// MappingFile is the confirmed mapping's storage path under a project (Q6
// recommendation A: narration-utils/chapter-track-map.json, a single file,
// not a directory of records like LedgerDir/CacheDir - there is one active
// mapping set per project at a time). It is exported so
// manuscript.resetDerived can clear it without this package depending on
// the manuscript package.
func MappingFile(project string) string {
	return filepath.Join(project, "narration-utils", "chapter-track-map.json")
}

// MappingStore is the confirmed chapter-track mapping described by Q6:
// narrator-confirmed links only - a suggestion (see Suggester below) is
// never written here until the narrator confirms it, so "an unconfirmed
// suggestion is never treated as a link" (Phase 5 success signal) holds by
// construction. Writes are temp-file-then-rename (the same pattern as
// LedgerStore.Write and CacheStore.Write) under a mutex. Zero value is not
// usable; construct with NewMappingStore.
type MappingStore struct {
	path     string
	mu       sync.Mutex
	Reporter *persist.Reporter
	now      func() time.Time
}

// NewMappingStore returns a MappingStore rooted at project's mapping file.
func NewMappingStore(project string) *MappingStore {
	return &MappingStore{path: MappingFile(project)}
}

// Confirm records that trackGUID is linked to chapterID (named chapterTitle
// at confirmation time) for documentID, stamping ConfirmedAt now. Confirming
// again for a trackGUID that already has a link replaces it (one confirmed
// chapter per track; two tracks may still point at the same chapter - D5's
// "may hold several links, consumers treat that as unknown" is a consumer
// rule, not a constraint this store enforces). It returns the mapping as
// written.
func (s *MappingStore) Confirm(documentID, trackGUID, chapterID, chapterTitle string) (TrackMapping, error) {
	if documentID == "" || trackGUID == "" || chapterID == "" {
		return TrackMapping{}, fmt.Errorf("a confirmed mapping needs a document, a track and a chapter")
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	file := s.readLocked(documentID)
	mapping := TrackMapping{TrackGUID: trackGUID, ChapterID: chapterID, ChapterTitle: chapterTitle, ConfirmedAt: s.clock()}
	file.DocumentID = documentID
	file.Mappings = upsertMapping(file.Mappings, mapping)
	if err := s.writeLocked(file); err != nil {
		return TrackMapping{}, err
	}
	return mapping, nil
}

// Clear removes trackGUID's link for documentID, if any. Clearing a track
// with no link is not an error, matching CacheStore.Delete's own rule for a
// caller clearing what may already be a miss.
func (s *MappingStore) Clear(documentID, trackGUID string) error {
	if documentID == "" || trackGUID == "" {
		return fmt.Errorf("clearing a mapping needs a document and a track")
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	file := s.readLocked(documentID)
	file.DocumentID = documentID
	file.Mappings = removeMapping(file.Mappings, trackGUID)
	return s.writeLocked(file)
}

// ChapterLinkSet is SetChapter's answer: the link as written, and the link
// the track held for another chapter before, if any (the chapter that lost
// its track, so the UI can name it).
type ChapterLinkSet struct {
	Link      TrackMapping  `json:"link"`
	Displaced *TrackMapping `json:"displaced"`
}

// SetChapter makes trackGUID chapterID's one confirmed link
// (chapter-track-link-control PRD Phase 1, TL3 A: one track per chapter). In
// one locked write it removes every link chapterID holds and every link on
// trackGUID, then appends the new one, so a relink replaces rather than adds
// (Confirm's upsert by track left the old track linked too). A link the
// track held for a different chapter is returned as Displaced.
func (s *MappingStore) SetChapter(documentID, chapterID, chapterTitle, trackGUID string) (ChapterLinkSet, error) {
	if documentID == "" || trackGUID == "" || chapterID == "" {
		return ChapterLinkSet{}, fmt.Errorf("a confirmed mapping needs a document, a track and a chapter")
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	file := s.readLocked(documentID)
	var displaced *TrackMapping
	kept := make([]TrackMapping, 0, len(file.Mappings)+1)
	for _, existing := range file.Mappings {
		switch {
		case existing.TrackGUID == trackGUID && existing.ChapterID != chapterID:
			previous := existing
			displaced = &previous
		case existing.TrackGUID == trackGUID, existing.ChapterID == chapterID:
		default:
			kept = append(kept, existing)
		}
	}
	link := TrackMapping{TrackGUID: trackGUID, ChapterID: chapterID, ChapterTitle: chapterTitle, ConfirmedAt: s.clock()}
	file.DocumentID = documentID
	file.Mappings = append(kept, link)
	if err := s.writeLocked(file); err != nil {
		return ChapterLinkSet{}, err
	}
	return ChapterLinkSet{Link: link, Displaced: displaced}, nil
}

// ClearChapter removes every link chapterID holds for documentID and returns
// the removed links. A chapter with no link is not an error (Clear's rule).
func (s *MappingStore) ClearChapter(documentID, chapterID string) ([]TrackMapping, error) {
	if documentID == "" || chapterID == "" {
		return nil, fmt.Errorf("clearing a chapter's links needs a document and a chapter")
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	file := s.readLocked(documentID)
	var removed []TrackMapping
	kept := make([]TrackMapping, 0, len(file.Mappings))
	for _, existing := range file.Mappings {
		if existing.ChapterID == chapterID {
			removed = append(removed, existing)
		} else {
			kept = append(kept, existing)
		}
	}
	if len(removed) == 0 {
		return nil, nil
	}
	file.DocumentID = documentID
	file.Mappings = kept
	if err := s.writeLocked(file); err != nil {
		return nil, err
	}
	return removed, nil
}

// List returns every confirmed link for documentID, sorted by TrackGUID for
// a stable order. A document with no file yet, or whose stored file belongs
// to a different (stale) documentID, reads as an empty list - never an
// error the caller has to special-case.
func (s *MappingStore) List(documentID string) ([]TrackMapping, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	file := s.readLocked(documentID)
	return append([]TrackMapping(nil), file.Mappings...), nil
}

// Get returns trackGUID's confirmed link for documentID, if any.
func (s *MappingStore) Get(documentID, trackGUID string) (TrackMapping, bool) {
	mappings, _ := s.List(documentID)
	for _, mapping := range mappings {
		if mapping.TrackGUID == trackGUID {
			return mapping, true
		}
	}
	return TrackMapping{}, false
}

func (s *MappingStore) clock() time.Time {
	now := time.Now
	if s.now != nil {
		now = s.now
	}
	return now().UTC()
}

// readLocked reads the mapping file, scoped to documentID. It must be called
// with s.mu held. A missing file, an unreadable or corrupt one, a newer
// schema version, or a stored DocumentID that does not match documentID all
// read as an empty shape for documentID - the same "unknown reads as
// absent" rule LedgerStore.readRecord and CacheStore.readEnvelope follow.
func (s *MappingStore) readLocked(documentID string) mappingFileShape {
	var decoded mappingFileShape
	outcome := s.Reporter.ReadJSON(s.path, "chapter-track mapping", persist.Disposable, func(raw []byte) error {
		var candidate mappingFileShape
		if err := json.Unmarshal(raw, &candidate); err != nil {
			return err
		}
		if candidate.SchemaVersion > mappingSchemaVersion {
			return fmt.Errorf("schema version %d newer than supported %d", candidate.SchemaVersion, mappingSchemaVersion)
		}
		decoded = candidate
		return nil
	})
	if outcome != persist.Loaded || decoded.DocumentID != documentID {
		return mappingFileShape{SchemaVersion: mappingSchemaVersion, DocumentID: documentID}
	}
	return decoded
}

// writeLocked writes file to disk via a temp file plus rename. It must be
// called with s.mu held.
func (s *MappingStore) writeLocked(file mappingFileShape) error {
	file.SchemaVersion = mappingSchemaVersion
	sort.Slice(file.Mappings, func(i, j int) bool { return file.Mappings[i].TrackGUID < file.Mappings[j].TrackGUID })

	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return fmt.Errorf("could not create the project's narration-utils folder: %w", err)
	}
	bytes, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	temp := s.path + ".tmp"
	if err := os.WriteFile(temp, bytes, 0o600); err != nil {
		return fmt.Errorf("could not write the chapter-track mapping: %w", err)
	}
	if err := os.Rename(temp, s.path); err != nil {
		return fmt.Errorf("could not activate the chapter-track mapping: %w", err)
	}
	return nil
}

func upsertMapping(mappings []TrackMapping, mapping TrackMapping) []TrackMapping {
	for i, existing := range mappings {
		if existing.TrackGUID == mapping.TrackGUID {
			updated := append([]TrackMapping(nil), mappings...)
			updated[i] = mapping
			return updated
		}
	}
	return append(append([]TrackMapping(nil), mappings...), mapping)
}

func removeMapping(mappings []TrackMapping, trackGUID string) []TrackMapping {
	filtered := make([]TrackMapping, 0, len(mappings))
	for _, existing := range mappings {
		if existing.TrackGUID != trackGUID {
			filtered = append(filtered, existing)
		}
	}
	return filtered
}

// ChapterCandidate is one chapter a suggestion can point at: just enough of
// the manuscript's chapter list (id and title) for Suggest to match against,
// so this package stays free of a dependency on the manuscript package
// (mirroring how LedgerScope carries a bare ChapterID string rather than a
// manuscript.Chapter).
type ChapterCandidate struct {
	ID    string
	Title string
}

// TrackCandidate is one REAPER track a suggestion can link from: just its
// guid and name, the same minimal shape as ChapterCandidate.
type TrackCandidate struct {
	TrackGUID string
	Name      string
}

// MappingSuggestion is a proposed trackGuid -> chapterId link the narrator
// has not yet confirmed. Suggesting one never writes to a MappingStore -
// only MappingStore.Confirm does that - so "an unconfirmed suggestion is
// never treated as a link" (D2: unconfirmed reads as unknown, never met).
// Score is the chapter-to-track matcher's score (chaptermatch.ScoreExact or
// chaptermatch.ScoreContained).
type MappingSuggestion struct {
	TrackGUID    string
	ChapterID    string
	ChapterTitle string
	Score        float64
}

// Suggester proposes candidate links for a set of tracks against a set of
// chapters, without persisting anything (Phase 5's scope: "a suggestion
// adapter that calls TM Phase 8's matcher and returns candidates without
// persisting them"). MatchSuggester below is the implementation this package
// ships with.
type Suggester interface {
	Suggest(tracks []TrackCandidate, chapters []ChapterCandidate) []MappingSuggestion
}

// SuggesterFunc adapts a plain function to Suggester.
type SuggesterFunc func(tracks []TrackCandidate, chapters []ChapterCandidate) []MappingSuggestion

// Suggest calls f.
func (f SuggesterFunc) Suggest(tracks []TrackCandidate, chapters []ChapterCandidate) []MappingSuggestion {
	return f(tracks, chapters)
}

// MatchSuggester is the Suggester backed by the shared chapter-to-track
// matcher (internal/chaptermatch, the port of Transcript Compare's
// find_chapter_by_track_name that teleprompter-manuscript-integration PRD
// Phase 8 built, replacing Phase 5's exact-title placeholder). It proposes a
// link only for a confident match - an exact token match ("CHAPTER ONE" and
// "Chapter 1") or the one title a name is a whole-token prefix of ("Chapter
// 1" and "Chapter 1: The Beginning") - never for the matcher's ambiguous-prefix
// pick or its fuzzy fallback, so a suggestion is never a guess dressed as a
// match (ADR 0110). The narrator still confirms each one.
var MatchSuggester Suggester = SuggesterFunc(suggestByMatch)

func suggestByMatch(tracks []TrackCandidate, chapters []ChapterCandidate) []MappingSuggestion {
	titles := make([]string, len(chapters))
	for i, chapter := range chapters {
		titles[i] = chapter.Title
	}
	var suggestions []MappingSuggestion
	for _, track := range tracks {
		if strings.TrimSpace(track.Name) == "" {
			continue
		}
		// Confident, not a score threshold: a fuzzy ratio can reach ScoreContained.
		match := chaptermatch.MatchTitle(titles, track.Name)
		if match.Index < 0 || !match.Confident {
			continue
		}
		suggestions = append(suggestions, MappingSuggestion{
			TrackGUID:    track.TrackGUID,
			ChapterID:    chapters[match.Index].ID,
			ChapterTitle: chapters[match.Index].Title,
			Score:        match.Score,
		})
	}
	return suggestions
}

// SuggestFromPrevious re-suggests links after a manuscript re-import (Q9):
// it takes a snapshot of TrackMapping records read before resetDerived
// cleared the store (a caller reads MappingStore.List, keeps the result,
// then lets the re-import proceed and resetDerived clear the file) and
// matches each one's remembered ChapterTitle against the new chapter list,
// so a chapter whose title survives the re-import unchanged is suggested
// again without asking the narrator to redo work resetDerived did not need
// to force (Q9 option A's "re-suggested from stored titles"). It never
// writes anything; the narrator still confirms each suggestion through
// MappingStore.Confirm.
func SuggestFromPrevious(previous []TrackMapping, chapters []ChapterCandidate) []MappingSuggestion {
	tracks := make([]TrackCandidate, 0, len(previous))
	for _, mapping := range previous {
		tracks = append(tracks, TrackCandidate{TrackGUID: mapping.TrackGUID, Name: mapping.ChapterTitle})
	}
	return MatchSuggester.Suggest(tracks, chapters)
}
