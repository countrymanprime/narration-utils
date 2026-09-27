// Package prepmarkup is the script markup layer of docs/prds/prep-depth.prd.md Phase 5: stress, pause and character-tag
// spans the narrator places on the manuscript while prepping, kept in their own project file (Q5) and checked against the
// current text on every read (Q6). A span whose words are no longer where it was placed is reported stale, never moved to
// a guess, so a mark never lands silently on the wrong words; whitespace alone never makes one stale.
//
// The file is narrator data (ADR 0069): it is never cleared by a re-import (a line whose text did not change keeps its
// marks, and one that did shows them as stale), only by the explicit Clear project data. It is a plain, versioned,
// chapter-keyed document so a later reader (the booth view) can read it without this package (ADR 0381).
package prepmarkup

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

// SchemaVersion is the only markup.json version this package reads or writes.
const SchemaVersion = 1

// what names the file for the narrator in a persist notice or an error.
const what = "script markup"

// maxAnchorRunes bounds one span: a mark is placed on a word or a phrase, and a selection is one line of the reader.
const maxAnchorRunes = 2000

// maxValueRunes bounds a character tag's name.
const maxValueRunes = 80

// Kind is what a span marks.
type Kind string

const (
	// Stress marks the words to lean on. It has no value.
	Stress Kind = "stress"
	// Pause marks a breath (value "short") or a longer pause (value "long") after the span's last word.
	Pause Kind = "pause"
	// CharacterTag says who speaks the span (value: the name), overriding any attribution the reader shows.
	CharacterTag Kind = "character_tag"
)

// The two pause lengths.
const (
	PauseShort = "short"
	PauseLong  = "long"
)

// Why a span is stale.
const (
	// StaleTextChanged means the line is still there, but the words under the span are not the ones it was placed on.
	StaleTextChanged = "text_changed"
	// StaleParagraphMissing means the line the span was placed on is no longer in the chapter.
	StaleParagraphMissing = "paragraph_missing"
)

// File is where the markup of a project is kept.
func File(project string) string {
	return filepath.Join(project, "narration-utils", "prep", "markup.json")
}

// Span is one mark as stored. Start and End are UTF-16 code units into the paragraph's text (a JS string index, the
// reader's own unit), and AnchorText is the text they covered when the mark was placed.
type Span struct {
	ID          string `json:"id"`
	ParagraphID string `json:"paragraphId"`
	Start       int    `json:"start"`
	End         int    `json:"end"`
	AnchorText  string `json:"anchorText"`
	Kind        Kind   `json:"kind"`
	Value       string `json:"value"`
	// NonSpaceStart is how many non-whitespace characters of the line came before the span when it was placed: the span's
	// position in a coordinate that whitespace edits do not move. A hand-written span without it is checked at its offsets.
	NonSpaceStart *int      `json:"nonSpaceStart,omitempty"`
	CreatedAt     time.Time `json:"createdAt"`
}

// Resolved is a span as the reader gets it: where it is in the current text, or why it is stale.
type Resolved struct {
	Span
	ChapterID string `json:"chapterId"`
	// Paragraph is the line's index in the manuscript, or nil when the line is gone.
	Paragraph *int `json:"paragraph"`
	// Stale is true when the words under the span are no longer the ones it was placed on. Start and End are then the
	// stored offsets, which may not fit the current line.
	Stale       bool   `json:"stale"`
	StaleReason string `json:"staleReason,omitempty"`
}

// ChapterMarkup is one chapter's spans, in text order.
type ChapterMarkup struct {
	ChapterID string     `json:"chapterId"`
	Spans     []Resolved `json:"spans"`
}

// Paragraph is one line of a chapter as the manuscript currently has it.
type Paragraph struct {
	ID    string
	Index int
	Text  string
}

// Config is what a Service needs.
type Config struct {
	// Project is the project folder; empty means no project is open, and nothing is saved.
	Project string
	// Paragraphs returns a chapter's current lines (the manuscript service's own read).
	Paragraphs func(chapterID string) ([]Paragraph, error)
	// Reporter tells the narrator about a file that cannot be read (ADR 0069); nil only logs nothing.
	Reporter *persist.Reporter
}

type markupFile struct {
	SchemaVersion int               `json:"schemaVersion"`
	Chapters      map[string][]Span `json:"chapters"`
}

// Service reads and writes a project's markup. It holds no state of its own, so the host builds one per call; the
// read-modify-write of one file is serialised by fileLock.
type Service struct {
	config Config
	now    func() time.Time
}

// New returns the service for config.
func New(config Config) *Service {
	return &Service{config: config, now: time.Now}
}

var fileLocks sync.Map

// lockFile serialises every change to one project's file across services built for the same project.
// +checklocksignore
func lockFile(path string) func() {
	lock, _ := fileLocks.LoadOrStore(filepath.Clean(path), &sync.Mutex{})
	mutex, _ := lock.(*sync.Mutex)
	mutex.Lock()
	return mutex.Unlock
}

// List returns a chapter's spans, each checked against the chapter's current text (Q6).
func (s *Service) List(chapterID string) (ChapterMarkup, error) {
	result := ChapterMarkup{ChapterID: chapterID, Spans: []Resolved{}}
	if s.config.Project == "" {
		return result, nil
	}
	unlock := lockFile(File(s.config.Project))
	defer unlock()
	file, err := s.read()
	if err != nil {
		return result, err
	}
	stored := file.Chapters[chapterID]
	if len(stored) == 0 {
		return result, nil
	}
	paragraphs, err := s.config.Paragraphs(chapterID)
	if err != nil {
		// The chapter is gone from the manuscript: every span in it has lost its line.
		paragraphs = nil
	}
	byID := make(map[string]Paragraph, len(paragraphs))
	for _, paragraph := range paragraphs {
		byID[paragraph.ID] = paragraph
	}
	for _, span := range stored {
		result.Spans = append(result.Spans, resolve(chapterID, span, byID))
	}
	sortResolved(result.Spans)
	return result, nil
}

// Save places a new span on a line of a chapter and returns it. start and end are UTF-16 offsets into the line's current
// text; whitespace at either edge is left out of the span. The same mark placed twice is kept once.
func (s *Service) Save(chapterID, paragraphID string, start, end int, kind, value string) (Resolved, error) {
	if s.config.Project == "" {
		return Resolved{}, errors.New("save the project first")
	}
	normalizedKind, normalizedValue, err := validateKind(kind, value)
	if err != nil {
		return Resolved{}, err
	}
	paragraphs, err := s.config.Paragraphs(chapterID)
	if err != nil {
		return Resolved{}, fmt.Errorf("that chapter is not in the manuscript: %w", err)
	}
	var line *Paragraph
	for index := range paragraphs {
		if paragraphs[index].ID == paragraphID {
			line = &paragraphs[index]
			break
		}
	}
	if line == nil {
		return Resolved{}, errors.New("that line is no longer in this chapter")
	}
	runes := []rune(line.Text)
	from, ok := runeIndex(runes, start)
	to, okEnd := runeIndex(runes, end)
	if !ok || !okEnd || from >= to {
		return Resolved{}, errors.New("invalid markup range")
	}
	for from < to && unicode.IsSpace(runes[from]) {
		from++
	}
	for to > from && unicode.IsSpace(runes[to-1]) {
		to--
	}
	if from == to {
		return Resolved{}, errors.New("select the words to mark")
	}
	if to-from > maxAnchorRunes {
		return Resolved{}, fmt.Errorf("a mark can cover at most %d characters", maxAnchorRunes)
	}
	nonSpace := countNonSpace(runes[:from])
	span := Span{
		ParagraphID:   paragraphID,
		Start:         unitIndex(runes, from),
		End:           unitIndex(runes, to),
		AnchorText:    string(runes[from:to]),
		Kind:          normalizedKind,
		Value:         normalizedValue,
		NonSpaceStart: &nonSpace,
	}
	unlock := lockFile(File(s.config.Project))
	defer unlock()
	file, err := s.read()
	if err != nil {
		return Resolved{}, err
	}
	for _, existing := range file.Chapters[chapterID] {
		if existing.ParagraphID == span.ParagraphID && existing.Start == span.Start && existing.End == span.End && existing.Kind == span.Kind && existing.Value == span.Value {
			return resolve(chapterID, existing, map[string]Paragraph{line.ID: *line}), nil
		}
	}
	span.ID = newID()
	span.CreatedAt = s.now().UTC()
	file.Chapters[chapterID] = append(file.Chapters[chapterID], span)
	if err := s.write(file); err != nil {
		return Resolved{}, err
	}
	return resolve(chapterID, span, map[string]Paragraph{line.ID: *line}), nil
}

// Delete removes a span from a chapter. It needs only the span's id, so a stale span is removed without its original text;
// an id that is not there is not an error.
func (s *Service) Delete(chapterID, id string) error {
	if s.config.Project == "" {
		return errors.New("save the project first")
	}
	unlock := lockFile(File(s.config.Project))
	defer unlock()
	file, err := s.read()
	if err != nil {
		return err
	}
	spans := file.Chapters[chapterID]
	kept := make([]Span, 0, len(spans))
	for _, span := range spans {
		if span.ID != id {
			kept = append(kept, span)
		}
	}
	if len(kept) == len(spans) {
		return nil
	}
	if len(kept) == 0 {
		delete(file.Chapters, chapterID)
	} else {
		file.Chapters[chapterID] = kept
	}
	return s.write(file)
}

func validateKind(kind, value string) (Kind, string, error) {
	value = strings.TrimSpace(value)
	switch Kind(kind) {
	case Stress:
		if value != "" {
			return "", "", errors.New("a stress mark has no value")
		}
	case Pause:
		if value != PauseShort && value != PauseLong {
			return "", "", errors.New("a pause is short or long")
		}
	case CharacterTag:
		if value == "" {
			return "", "", errors.New("a character tag needs a name")
		}
		if utf8.RuneCountInString(value) > maxValueRunes {
			return "", "", fmt.Errorf("a character tag's name can be at most %d characters", maxValueRunes)
		}
	default:
		return "", "", errors.New("unknown markup kind")
	}
	return Kind(kind), value, nil
}

// resolve checks one stored span against its line's current text.
func resolve(chapterID string, span Span, lines map[string]Paragraph) Resolved {
	result := Resolved{Span: span, ChapterID: chapterID}
	line, ok := lines[span.ParagraphID]
	if !ok {
		result.Stale, result.StaleReason = true, StaleParagraphMissing
		return result
	}
	index := line.Index
	result.Paragraph = &index
	runes := []rune(line.Text)
	want := squash(span.AnchorText)
	if span.NonSpaceStart != nil {
		if from, to, found := locateNonSpace(runes, *span.NonSpaceStart, countNonSpace([]rune(span.AnchorText))); found && squash(string(runes[from:to])) == want {
			result.Start, result.End = unitIndex(runes, from), unitIndex(runes, to)
			return result
		}
	} else if from, okStart := runeIndex(runes, span.Start); okStart {
		if to, okEnd := runeIndex(runes, span.End); okEnd && from < to && squash(string(runes[from:to])) == want {
			return result
		}
	}
	result.Stale, result.StaleReason = true, StaleTextChanged
	return result
}

// locateNonSpace finds the run of the line that starts after `before` non-whitespace characters and holds `length` more.
func locateNonSpace(runes []rune, before, length int) (int, int, bool) {
	if before < 0 || length <= 0 {
		return 0, 0, false
	}
	seen, from := 0, -1
	for index, character := range runes {
		if unicode.IsSpace(character) {
			continue
		}
		if seen == before {
			from = index
		}
		seen++
		if from >= 0 && seen == before+length {
			return from, index + 1, true
		}
	}
	return 0, 0, false
}

func countNonSpace(runes []rune) int {
	count := 0
	for _, character := range runes {
		if !unicode.IsSpace(character) {
			count++
		}
	}
	return count
}

// squash collapses every run of whitespace to one space and trims the ends: two texts that differ only in whitespace
// squash to the same string.
func squash(text string) string {
	return strings.Join(strings.Fields(text), " ")
}

// runeIndex converts a UTF-16 offset into the line to a rune index; an offset past the end, before the start or between
// the two halves of a surrogate pair is not one.
func runeIndex(runes []rune, units int) (int, bool) {
	if units < 0 {
		return 0, false
	}
	count := 0
	for index, character := range runes {
		if count == units {
			return index, true
		}
		if count > units {
			return 0, false
		}
		count += utf16.RuneLen(character)
	}
	if count == units {
		return len(runes), true
	}
	return 0, false
}

// unitIndex converts a rune index into the line to a UTF-16 offset.
func unitIndex(runes []rune, index int) int {
	count := 0
	for _, character := range runes[:index] {
		count += utf16.RuneLen(character)
	}
	return count
}

func sortResolved(spans []Resolved) {
	sort.SliceStable(spans, func(i, j int) bool {
		a, b := spans[i], spans[j]
		if (a.Paragraph == nil) != (b.Paragraph == nil) {
			return b.Paragraph == nil
		}
		if a.Paragraph != nil && *a.Paragraph != *b.Paragraph {
			return *a.Paragraph < *b.Paragraph
		}
		if a.Start != b.Start {
			return a.Start < b.Start
		}
		return a.ID < b.ID
	})
}

func newID() string {
	bytes := make([]byte, 16)
	_, _ = rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

// read reads markup.json; the caller holds the file's lock. A corrupt file is kept aside and a fresh one started (the
// narrator is told by the reporter); one written by a newer app is refused and never overwritten.
func (s *Service) read() (markupFile, error) {
	file := markupFile{SchemaVersion: SchemaVersion, Chapters: map[string][]Span{}}
	path := File(s.config.Project)
	newer := 0
	var decoded markupFile
	outcome := s.config.Reporter.ReadJSON(path, what, persist.NarratorData, func(raw []byte) error {
		var candidate markupFile
		if err := json.Unmarshal(raw, &candidate); err != nil {
			return err
		}
		if candidate.SchemaVersion > SchemaVersion {
			newer = candidate.SchemaVersion
			return nil
		}
		decoded = candidate
		return nil
	})
	switch outcome {
	case persist.Missing, persist.Quarantined, persist.Healed:
		return file, nil
	case persist.Unreadable:
		return markupFile{}, fmt.Errorf("your %s file could not be read, so nothing was changed", what)
	}
	if err := persist.CheckVersion(newer, SchemaVersion, what); err != nil {
		return markupFile{}, err
	}
	if decoded.Chapters != nil {
		file.Chapters = decoded.Chapters
	}
	return file, nil
}

// write replaces markup.json through a temporary file and a rename; the caller holds the file's lock.
func (s *Service) write(file markupFile) error {
	file.SchemaVersion = SchemaVersion
	path := File(s.config.Project)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("could not create the project's prep folder: %w", err)
	}
	bytes, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, bytes, 0o600); err != nil {
		return fmt.Errorf("could not write the %s file: %w", what, err)
	}
	if err := os.Rename(temporary, path); err != nil {
		return fmt.Errorf("could not activate the %s file: %w", what, err)
	}
	return nil
}
