package chaptersync

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

// snapshotSchemaVersion is chapter-sync.json's version. A newer file reads as
// no snapshot (the next sync is then a first sync), never as an error.
const snapshotSchemaVersion = 1

// File is the sync snapshot's path under a project. manuscript.resetDerived
// clears it with the other derived data: chapter ids reset on a re-import, and
// a first sync afterwards reports no stale "new" tracks.
func File(project string) string {
	return filepath.Join(project, "narration-utils", "chapter-sync.json")
}

type fileShape struct {
	SchemaVersion int      `json:"schemaVersion"`
	Snapshot      Snapshot `json:"snapshot"`
}

// Store keeps the last sync's Snapshot. It is disposable data: a missing,
// corrupt or newer file reads as the zero Snapshot.
type Store struct {
	path     string // +checklocksignore: set once by NewStore, read-only after
	mu       sync.Mutex
	Reporter *persist.Reporter // +checklocksignore: set once before first use, read-only after
}

// NewStore returns the Store for project.
func NewStore(project string) *Store {
	return &Store{path: File(project)}
}

// Read returns the stored snapshot, or the zero Snapshot.
func (s *Store) Read() Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	var decoded fileShape
	outcome := s.Reporter.ReadJSON(s.path, "chapter sync snapshot", persist.Disposable, func(raw []byte) error {
		var candidate fileShape
		if err := json.Unmarshal(raw, &candidate); err != nil {
			return err
		}
		if candidate.SchemaVersion > snapshotSchemaVersion {
			return fmt.Errorf("schema version %d newer than supported %d", candidate.SchemaVersion, snapshotSchemaVersion)
		}
		decoded = candidate
		return nil
	})
	if outcome != persist.Loaded {
		return Snapshot{}
	}
	return decoded.Snapshot
}

// Write stores snapshot through a temp file and a rename.
func (s *Store) Write(snapshot Snapshot) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return fmt.Errorf("could not create the project's narration-utils folder: %w", err)
	}
	bytes, err := json.MarshalIndent(fileShape{SchemaVersion: snapshotSchemaVersion, Snapshot: snapshot}, "", "  ")
	if err != nil {
		return err
	}
	temp := s.path + ".tmp"
	if err := os.WriteFile(temp, bytes, 0o600); err != nil {
		return fmt.Errorf("could not write the chapter sync snapshot: %w", err)
	}
	if err := os.Rename(temp, s.path); err != nil {
		return fmt.Errorf("could not activate the chapter sync snapshot: %w", err)
	}
	return nil
}
