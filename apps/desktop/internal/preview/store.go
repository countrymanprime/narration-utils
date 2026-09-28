package preview

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

// This file is Phase 8's own sidecar I/O for PinnedRange, kept separate from the pure, no-I/O engine files
// (types.go's own doc comment: "It has no I/O and no clock") the same way chaptersync splits its own Store
// (store.go) from its pure planning logic (plan.go).

// pinSchemaVersion is preview-pin.json's version.
const pinSchemaVersion = 1

// PinFile is the pin sidecar's path under a project. manuscript.resetDerived clears it with the other derived
// data: chapter and paragraph ids reset on a re-import, so a stale pin from before would resolve against ids that
// no longer mean the same thing.
func PinFile(project string) string {
	return filepath.Join(project, "narration-utils", "preview-pin.json")
}

type pinFileShape struct {
	SchemaVersion int               `json:"schemaVersion"`
	ChapterID     string            `json:"chapterId"`
	ParagraphIDs  []string          `json:"paragraphIds"`
	AnchorText    map[string]string `json:"anchorText"`
	PinnedAt      time.Time         `json:"pinnedAt"`
}

// PinStore keeps at most one PinnedRange per project ("a pin per book", Q9): setting a new one replaces whatever
// was pinned before. Like a reader bookmark, it is disposable: a file that cannot be read is logged and treated
// as no pin, never surfaced as an error the narrator has to act on - re-pinning takes one click.
type PinStore struct {
	path     string // +checklocksignore: set once by NewPinStore, read-only after
	mu       sync.Mutex
	Reporter *persist.Reporter // +checklocksignore: set once before first use, read-only after
}

// NewPinStore returns the PinStore for project.
func NewPinStore(project string) *PinStore {
	return &PinStore{path: PinFile(project)}
}

// Read returns the stored pin and true, or the zero PinnedRange and false when there is none (missing, corrupt, or
// written by a newer version of the app).
func (s *PinStore) Read() (PinnedRange, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var decoded pinFileShape
	outcome := s.Reporter.ReadJSON(s.path, "preview pin", persist.Disposable, func(raw []byte) error {
		var candidate pinFileShape
		if err := json.Unmarshal(raw, &candidate); err != nil {
			return err
		}
		if candidate.SchemaVersion > pinSchemaVersion {
			return fmt.Errorf("schema version %d newer than supported %d", candidate.SchemaVersion, pinSchemaVersion)
		}
		decoded = candidate
		return nil
	})
	if outcome != persist.Loaded || decoded.ChapterID == "" {
		return PinnedRange{}, false
	}
	return PinnedRange{
		ChapterID:    decoded.ChapterID,
		ParagraphIDs: decoded.ParagraphIDs,
		AnchorText:   decoded.AnchorText,
		PinnedAt:     decoded.PinnedAt,
	}, true
}

// Write stores pin, replacing any earlier one, through a temp file and a rename.
func (s *PinStore) Write(pin PinnedRange) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	file := pinFileShape{
		SchemaVersion: pinSchemaVersion,
		ChapterID:     pin.ChapterID,
		ParagraphIDs:  pin.ParagraphIDs,
		AnchorText:    pin.AnchorText,
		PinnedAt:      pin.PinnedAt.UTC(),
	}
	return s.writeLocked(file)
}

// Clear removes the pin file. Clearing an already-missing file is not an error.
func (s *PinStore) Clear() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.Remove(s.path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("could not clear the preview pin: %w", err)
	}
	return nil
}

// writeLocked writes file through a temp file and a rename. The caller holds mu.
func (s *PinStore) writeLocked(file pinFileShape) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return fmt.Errorf("could not create the project's narration-utils folder: %w", err)
	}
	bytes, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	temp := s.path + ".tmp"
	if err := os.WriteFile(temp, bytes, 0o600); err != nil {
		return fmt.Errorf("could not write the preview pin: %w", err)
	}
	if err := os.Rename(temp, s.path); err != nil {
		return fmt.Errorf("could not activate the preview pin: %w", err)
	}
	return nil
}
