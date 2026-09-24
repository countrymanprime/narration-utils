package stages

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

// decisionsSchemaVersion is the version every decisions file this package
// writes carries. A file with a higher version was written by a newer app: it
// is refused with a message and never overwritten (persist.CheckVersion).
const decisionsSchemaVersion = 1

// decisionsWhat names the file for the narrator in a notice or an error.
const decisionsWhat = "stage decisions"

// DecisionKind is what the narrator did about a chapter's suggestion.
type DecisionKind string

const (
	// DecisionConfirmed: the narrator confirmed a recommendation, and the
	// chapter's status was set to Target.
	DecisionConfirmed DecisionKind = "confirmed"
	// DecisionDismissed: the narrator dismissed a recommendation; it stays
	// hidden while its basis key is unchanged (Q7).
	DecisionDismissed DecisionKind = "dismissed"
	// DecisionReverted: the narrator undid a live confirmation, and the
	// chapter's status was set back from From to Target.
	DecisionReverted DecisionKind = "reverted"
)

// SignalBasis is one signal as it stood when the narrator decided: what the
// basis key covers, plus the signal's reason as a short evidence summary, so
// the record says what was seen without the full evidence list.
type SignalBasis struct {
	ID              string      `json:"id"`
	State           SignalState `json:"state"`
	LedgerRecordIDs []string    `json:"ledgerRecordIds"`
	Fingerprint     string      `json:"fingerprint"`
	Summary         string      `json:"summary"`
}

// Decision is one entry of the append-only decisions list. For a confirmation
// or a dismissal From is the chapter's stage and Target the suggested one; for
// a revert From is the confirmed stage the chapter leaves and Target the stage
// it returns to. BasisKey is the assessment's key (for a revert, the key of the
// confirmation it undoes).
type Decision struct {
	ChapterID string        `json:"chapterId"`
	Kind      DecisionKind  `json:"kind"`
	From      Stage         `json:"from"`
	Target    Stage         `json:"target"`
	BasisKey  string        `json:"basisKey"`
	Basis     []SignalBasis `json:"basis"`
	At        time.Time     `json:"at"`
}

// decisionsFile is stage-decisions.json on disk: every decision for one
// manuscript document. Chapter ids are positional and reset on re-import, so a
// file whose DocumentID is not the current manuscript's is read as empty.
type decisionsFile struct {
	SchemaVersion int        `json:"schemaVersion"`
	DocumentID    string     `json:"documentId"`
	Decisions     []Decision `json:"decisions"`
}

// DecisionsFile is the decisions sidecar's path under a project. It is
// exported so manuscript.resetDerived can clear it on a re-import or Clear.
func DecisionsFile(project string) string {
	return filepath.Join(project, "narration-utils", "stage-decisions.json")
}

// DecisionStore keeps the narrator's confirmations, dismissals and reverts
// beside the chapter status, never inside it (D4, Q1). Writes are a temporary
// file then a rename, under a mutex. The file is the narrator's own work: one
// that cannot be decoded is kept aside and the narrator told (ADR 0069), and
// the read that met it returns an error rather than an empty list.
type DecisionStore struct {
	path     string
	mu       sync.Mutex
	reporter *persist.Reporter
	// rename activates a written file; nil is os.Rename (tests replace it).
	rename func(oldPath, newPath string) error
}

// NewDecisionStore returns the store for project. reporter may be nil.
func NewDecisionStore(project string, reporter *persist.Reporter) *DecisionStore {
	return &DecisionStore{path: DecisionsFile(project), reporter: reporter}
}

// List returns documentID's decisions in the order they were made. A missing
// file, or one kept for another document, is an empty list; a file that cannot
// be read, is corrupt, or was written by a newer app is an error.
func (s *DecisionStore) List(documentID string) ([]Decision, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, err := s.readLocked(documentID)
	if err != nil {
		return nil, err
	}
	return slices.Clone(file.Decisions), nil
}

// Append adds decision for documentID. A file kept for another document is
// replaced, since its chapter ids name other chapters.
func (s *DecisionStore) Append(documentID string, decision Decision) error {
	if documentID == "" || decision.ChapterID == "" {
		return errors.New("a stage decision needs a document and a chapter")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	file, err := s.readLocked(documentID)
	if err != nil {
		return err
	}
	file.Decisions = append(slices.Clone(file.Decisions), decision)
	return s.writeLocked(file)
}

// Remove takes back the most recent decision equal to decision: the
// compensating step when the status write that should follow it fails. It
// matches on every identifying field including At (not on Basis), so it relies
// on the caller serializing Append and Remove for a chapter: Service holds its
// mutex across both, so no equal decision can be appended in between.
func (s *DecisionStore) Remove(documentID string, decision Decision) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, err := s.readLocked(documentID)
	if err != nil {
		return err
	}
	index := -1
	for i, existing := range slices.Backward(file.Decisions) {
		if sameDecision(existing, decision) {
			index = i
			break
		}
	}
	if index < 0 {
		return nil
	}
	file.Decisions = slices.Delete(slices.Clone(file.Decisions), index, index+1)
	return s.writeLocked(file)
}

func sameDecision(a, b Decision) bool {
	return a.ChapterID == b.ChapterID && a.Kind == b.Kind && a.From == b.From && a.Target == b.Target &&
		a.BasisKey == b.BasisKey && a.At.Equal(b.At)
}

// readLocked reads the file scoped to documentID; s.mu must be held.
func (s *DecisionStore) readLocked(documentID string) (decisionsFile, error) {
	empty := decisionsFile{SchemaVersion: decisionsSchemaVersion, DocumentID: documentID, Decisions: []Decision{}}
	var decoded decisionsFile
	newer := 0
	outcome := s.reporter.ReadJSON(s.path, decisionsWhat, persist.NarratorData, func(raw []byte) error {
		var candidate decisionsFile
		if err := json.Unmarshal(raw, &candidate); err != nil {
			return err
		}
		if candidate.SchemaVersion > decisionsSchemaVersion {
			// Decoded but not ours to read: refused below, never quarantined.
			newer = candidate.SchemaVersion
			return nil
		}
		decoded = candidate
		return nil
	})
	switch outcome {
	case persist.Missing:
		return empty, nil
	case persist.Quarantined, persist.Healed:
		return decisionsFile{}, fmt.Errorf("your %s file could not be read; it was kept aside and a fresh one is started", decisionsWhat)
	case persist.Unreadable:
		return decisionsFile{}, fmt.Errorf("your %s file could not be read", decisionsWhat)
	}
	if err := persist.CheckVersion(newer, decisionsSchemaVersion, decisionsWhat); err != nil {
		return decisionsFile{}, err
	}
	if decoded.DocumentID != documentID {
		return empty, nil
	}
	if decoded.Decisions == nil {
		decoded.Decisions = []Decision{}
	}
	return decoded, nil
}

// writeLocked replaces the file through a temporary file and a rename; s.mu
// must be held, and the caller must have read the file with readLocked, which
// refuses one that exists but cannot be read (persist.CanOverwrite's rule).
func (s *DecisionStore) writeLocked(file decisionsFile) error {
	file.SchemaVersion = decisionsSchemaVersion
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return fmt.Errorf("could not create the project's narration-utils folder: %w", err)
	}
	bytes, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	temporary := s.path + ".tmp"
	if err := os.WriteFile(temporary, bytes, 0o600); err != nil {
		return fmt.Errorf("could not write the %s file: %w", decisionsWhat, err)
	}
	rename := os.Rename
	if s.rename != nil {
		rename = s.rename
	}
	if err := rename(temporary, s.path); err != nil {
		return fmt.Errorf("could not activate the %s file: %w", decisionsWhat, err)
	}
	return nil
}
