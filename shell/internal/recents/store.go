// Package recents tracks the most recently opened project folders so a
// standalone launch can offer an "open recent" list. It has no OS/Wails
// dependency: the caller resolves and supplies the backing file path, which
// keeps this package trivially testable with t.TempDir().
package recents

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// maxEntries caps the recent-projects list per the product decision to show
// at most the ten most recently opened projects.
const maxEntries = 10

type Entry struct {
	Path       string    `json:"path"`
	Name       string    `json:"name"`
	LastOpened time.Time `json:"lastOpened"`
}

type Store struct {
	mu   sync.Mutex
	path string
}

func New(path string) *Store { return &Store{path: path} }

// Touch records path/name as the most recently opened project, deduping any
// existing entry for the same path (case-insensitively, since Windows
// filesystems are case-insensitive), dropping entries whose folder no longer
// exists so a stale entry can't occupy a slot a live project could use, and
// truncating to maxEntries.
func (s *Store) Touch(path, name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cleaned := filepath.Clean(path)
	entries, err := s.readLocked()
	if err != nil {
		return err
	}
	next := make([]Entry, 0, len(entries)+1)
	next = append(next, Entry{Path: cleaned, Name: name, LastOpened: time.Now()})
	for _, entry := range entries {
		if strings.EqualFold(entry.Path, cleaned) {
			continue
		}
		if _, err := os.Stat(entry.Path); err != nil {
			continue
		}
		next = append(next, entry)
	}
	if len(next) > maxEntries {
		next = next[:maxEntries]
	}
	return s.writeLocked(next)
}

// Remove drops the entry for path, if any. Removing a path that is not
// present (already gone, or never existed) is not an error.
func (s *Store) Remove(path string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cleaned := filepath.Clean(path)
	entries, err := s.readLocked()
	if err != nil {
		return err
	}
	next := make([]Entry, 0, len(entries))
	for _, entry := range entries {
		if strings.EqualFold(entry.Path, cleaned) {
			continue
		}
		next = append(next, entry)
	}
	return s.writeLocked(next)
}

// List returns the recent-projects list, silently dropping any entry whose
// folder no longer exists on disk.
func (s *Store) List() ([]Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := s.readLocked()
	if err != nil {
		return nil, err
	}
	result := make([]Entry, 0, len(entries))
	for _, entry := range entries {
		if _, err := os.Stat(entry.Path); err != nil {
			continue
		}
		result = append(result, entry)
	}
	return result, nil
}

// readLocked treats both a missing file and a corrupted one as "no history
// yet" rather than a hard error - this is disposable, non-critical UI state,
// so self-healing from corruption beats permanently disabling the feature
// until someone manually deletes the file.
func (s *Store) readLocked() ([]Entry, error) {
	bytes, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return []Entry{}, nil
		}
		return nil, err
	}
	var entries []Entry
	if err := json.Unmarshal(bytes, &entries); err != nil {
		return []Entry{}, nil
	}
	return entries, nil
}

func (s *Store) writeLocked(entries []Entry) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	bytes, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return err
	}
	temporary := s.path + ".tmp"
	if err := os.WriteFile(temporary, bytes, 0o600); err != nil {
		return err
	}
	if err := os.Rename(temporary, s.path); err != nil {
		os.Remove(temporary)
		return err
	}
	return nil
}
