// This file is Phase 8 of docs/prds/editing-readiness-analysis.prd.md: Q6's
// per-chapter choice of which analysis source counts, items (the default) or
// a chapter's rendered file. ChoiceStore mirrors
// apps/desktop/internal/proofing/renders.go's own RenderStore exactly (same
// sidecar shape, same atomic temp-file-then-rename write, same "a file a
// newer version wrote is refused, not silently ignored" read rule) - a small,
// deliberate duplication rather than a shared helper, since the two stores
// keep different value types (a RenderAssociation struct versus a bare
// SourceChoice string) and this package must never import proofing's own
// store type just to reuse its write path.
package editing

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// SourceChoice is Q6's per-chapter pick of which source counts for the
// editing signals: SourceItems (the default - "editing happens on items") or
// SourceRender (an explicit second source, never a silent replacement).
type SourceChoice string

const (
	SourceItems  SourceChoice = "items"
	SourceRender SourceChoice = "render"
)

// ErrChoicesUnreadable is a source-choice.json that exists but cannot be
// read. It is surfaced, and the file is left alone, rather than read as
// "every chapter defaults to items" (the same "surfaced, not silently
// overwritten" rule renders.go's ErrRendersUnreadable follows).
var ErrChoicesUnreadable = errors.New("the editing source-choice file could not be read")

// ChoiceDir is this package's sidecar folder under a project;
// manuscript.resetDerived clears it, since a choice is keyed by documentId
// and chapter id, which a re-import renumbers - the same reasoning
// proofing.Dir's own doc comment gives.
func ChoiceDir(project string) string { return filepath.Join(project, "narration-utils", "editing") }

// ChoiceFile is the per-chapter source-choice sidecar.
func ChoiceFile(project string) string {
	return filepath.Join(ChoiceDir(project), "source-choice.json")
}

// choiceFileShape is source-choice.json: a bare choice string ("items" or
// "render") by documentId, then chapter id.
type choiceFileShape struct {
	Version   int                          `json:"version"`
	Documents map[string]map[string]string `json:"documents"`
}

const choiceFileVersion = 1

// ChoiceStore reads and writes source-choice.json. Writes are
// temp-file-then-rename. Zero value is not usable; construct with
// NewChoiceStore.
type ChoiceStore struct {
	project string
	mu      sync.Mutex
}

// NewChoiceStore returns the store of project's per-chapter source choices.
func NewChoiceStore(project string) *ChoiceStore { return &ChoiceStore{project: project} }

// Get returns the chapter's chosen source. A missing file, a chapter never
// set, or an empty value all answer SourceItems - the default - and never an
// error: "no choice made yet" is not a failure. A file that cannot be read
// or decoded, or one written by a newer version, is ErrChoicesUnreadable.
func (s *ChoiceStore) Get(documentID, chapterID string) (SourceChoice, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, err := s.read()
	if err != nil {
		return "", err
	}
	raw, ok := file.Documents[documentID][chapterID]
	if !ok || raw == "" {
		return SourceItems, nil
	}
	choice := SourceChoice(raw)
	if choice != SourceItems && choice != SourceRender {
		// A value neither Set below nor any past version of it would ever have
		// written; read as the default rather than surfacing a decode error for
		// one chapter's stray value in an otherwise-fine file.
		return SourceItems, nil
	}
	return choice, nil
}

// Set stores the chapter's choice, replacing its previous one. It validates
// choice is SourceItems or SourceRender, and refuses, changing nothing, when
// the file on disk cannot be read.
func (s *ChoiceStore) Set(documentID, chapterID string, choice SourceChoice) error {
	if choice != SourceItems && choice != SourceRender {
		return fmt.Errorf("%q is not a valid editing source choice", choice)
	}
	return s.update(func(file *choiceFileShape) {
		chapters := file.Documents[documentID]
		if chapters == nil {
			chapters = map[string]string{}
			file.Documents[documentID] = chapters
		}
		chapters[chapterID] = string(choice)
	})
}

func (s *ChoiceStore) update(change func(*choiceFileShape)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, err := s.read()
	if err != nil {
		return err
	}
	change(&file)
	encoded, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(ChoiceDir(s.project), 0o755); err != nil {
		return fmt.Errorf("could not create the editing folder: %w", err)
	}
	path := ChoiceFile(s.project)
	temp := path + ".tmp"
	if err := os.WriteFile(temp, encoded, 0o600); err != nil {
		return fmt.Errorf("could not save the editing source choice: %w", err)
	}
	if err := os.Rename(temp, path); err != nil {
		return fmt.Errorf("could not save the editing source choice: %w", err)
	}
	return nil
}

func (s *ChoiceStore) read() (choiceFileShape, error) {
	empty := choiceFileShape{Version: choiceFileVersion, Documents: map[string]map[string]string{}}
	raw, err := os.ReadFile(ChoiceFile(s.project))
	if os.IsNotExist(err) {
		return empty, nil
	}
	if err != nil {
		return empty, fmt.Errorf("%w: %v", ErrChoicesUnreadable, err)
	}
	var file choiceFileShape
	if err := json.Unmarshal(raw, &file); err != nil {
		return empty, fmt.Errorf("%w: %v", ErrChoicesUnreadable, err)
	}
	if file.Version > choiceFileVersion {
		return empty, fmt.Errorf("%w: written by a newer version of the app (version %d)", ErrChoicesUnreadable, file.Version)
	}
	if file.Documents == nil {
		file.Documents = map[string]map[string]string{}
	}
	file.Version = choiceFileVersion
	return file, nil
}
