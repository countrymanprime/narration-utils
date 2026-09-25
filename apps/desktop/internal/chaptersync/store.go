package chaptersync

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

// snapshotSchemaVersion is chapter-sync.json's version. A newer file reads as
// no snapshot (the next sync is then a first sync), never as an error. The
// activity list (Phase 4) is an additive field of version 1.
const snapshotSchemaVersion = 1

// ActivityLimit is how many sync batches the activity list keeps, newest first.
const ActivityLimit = 20

// File is the sync snapshot's path under a project. manuscript.resetDerived
// clears it with the other derived data: chapter ids reset on a re-import, and
// a first sync afterwards reports no stale "new" tracks.
func File(project string) string {
	return filepath.Join(project, "narration-utils", "chapter-sync.json")
}

// Activity is one sync that did something the narrator hears about (S12): the
// links it made and the tracks new since the last sync that match no chapter.
// Trigger names what ran it (the consent, a DAW link, an import, an attach, or
// the watcher seeing the saved .rpp change).
type Activity struct {
	At        time.Time               `json:"at"`
	Trigger   string                  `json:"trigger"`
	Linked    []evidence.TrackMapping `json:"linked"`
	NewTracks []TrackRef              `json:"newTracks"`
}

type fileShape struct {
	SchemaVersion int        `json:"schemaVersion"`
	Snapshot      Snapshot   `json:"snapshot"`
	Activity      []Activity `json:"activity,omitempty"`
}

// Store keeps the last sync's Snapshot and the activity list. It is disposable
// data: a missing, corrupt or newer file reads as the zero Snapshot and no
// activity.
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
	return s.readLocked().Snapshot
}

// Activity returns the activity list, newest first; empty when there is none.
func (s *Store) Activity() []Activity {
	s.mu.Lock()
	defer s.mu.Unlock()
	activity := s.readLocked().Activity
	out := make([]Activity, 0, len(activity))
	for _, entry := range activity {
		out = append(out, normalized(entry))
	}
	return out
}

func (s *Store) readLocked() fileShape {
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
		return fileShape{}
	}
	return decoded
}

// Write stores snapshot, and puts entries (if any) at the head of the activity
// list, keeping the newest ActivityLimit. It writes through a temp file and a
// rename.
func (s *Store) Write(snapshot Snapshot, entries ...Activity) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	activity := s.readLocked().Activity
	for _, entry := range entries {
		activity = append([]Activity{normalized(entry)}, activity...)
	}
	if len(activity) > ActivityLimit {
		activity = activity[:ActivityLimit]
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return fmt.Errorf("could not create the project's narration-utils folder: %w", err)
	}
	bytes, err := json.MarshalIndent(fileShape{SchemaVersion: snapshotSchemaVersion, Snapshot: snapshot, Activity: activity}, "", "  ")
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

// normalized gives an entry empty lists instead of nil ones, so the wire never carries null.
func normalized(entry Activity) Activity {
	if entry.Linked == nil {
		entry.Linked = []evidence.TrackMapping{}
	}
	if entry.NewTracks == nil {
		entry.NewTracks = []TrackRef{}
	}
	return entry
}
