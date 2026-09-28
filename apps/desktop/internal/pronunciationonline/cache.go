package pronunciationonline

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// MaxCacheEntries bounds the cache file; past it, the oldest answers are dropped first.
const MaxCacheEntries = 5000

const cacheVersion = 1

// CacheEntry is one cached answer and when it was fetched.
type CacheEntry struct {
	Answer    Answer    `json:"answer"`
	FetchedAt time.Time `json:"fetchedAt"`
}

type cacheFile struct {
	Version int                   `json:"version"`
	Source  string                `json:"source"`
	Entries map[string]CacheEntry `json:"entries"`
}

// Cache is the local copy of every online answer (D72: results are cached locally), one per-user file keyed by the
// lower-cased word. It holds answers only, never the key. Its methods are safe for concurrent use.
type Cache struct {
	// +checklocks:mu
	path string
	// +checklocks:mu
	source string
	mu     sync.Mutex
}

// NewCache is the cache for source kept at path (created on the first Put).
func NewCache(path, source string) *Cache { return &Cache{path: path, source: source} }

// Get is the cached answer for word (a CheckWord result). A cache that cannot be read counts as empty: the lookup then
// asks the dictionary again, which is the narrator's own press, and Put rewrites the file whole.
func (c *Cache) Get(word string) (CacheEntry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	current, _ := c.read()
	entry, ok := current.Entries[cacheKey(word)]
	return entry, ok
}

// Put caches answer for word, fetched at at.
func (c *Cache) Put(word string, answer Answer, at time.Time) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	current, _ := c.read()
	current.Entries[cacheKey(word)] = CacheEntry{Answer: answer, FetchedAt: at.UTC()}
	if over := len(current.Entries) - MaxCacheEntries; over > 0 {
		keys := make([]string, 0, len(current.Entries))
		for key := range current.Entries {
			keys = append(keys, key)
		}
		sort.Slice(keys, func(i, j int) bool {
			a, b := current.Entries[keys[i]].FetchedAt, current.Entries[keys[j]].FetchedAt
			if a.Equal(b) {
				return keys[i] < keys[j]
			}
			return a.Before(b)
		})
		for _, key := range keys[:over] {
			delete(current.Entries, key)
		}
	}
	return c.write(current)
}

// +checklocks:c.mu
func (c *Cache) read() (cacheFile, error) {
	empty := cacheFile{Version: cacheVersion, Source: c.source, Entries: map[string]CacheEntry{}}
	bytes, err := os.ReadFile(c.path)
	if err != nil {
		return empty, err
	}
	var parsed cacheFile
	if err := json.Unmarshal(bytes, &parsed); err != nil || parsed.Version != cacheVersion || parsed.Source != c.source {
		return empty, errors.New("pronunciationonline: the cache file is damaged")
	}
	if parsed.Entries == nil {
		parsed.Entries = map[string]CacheEntry{}
	}
	return parsed, nil
}

// +checklocks:c.mu
func (c *Cache) write(current cacheFile) error {
	bytes, err := json.Marshal(current)
	if err != nil {
		return err
	}
	return writeWhole(c.path, bytes)
}

// writeWhole replaces the file at path with bytes: a temporary file beside it, renamed over it, so a crash never leaves
// half a file.
func writeWhole(path string, bytes []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("pronunciationonline: the cache folder could not be created: %w", err)
	}
	temp, err := os.CreateTemp(filepath.Dir(path), ".cache-*.tmp")
	if err != nil {
		return fmt.Errorf("pronunciationonline: the cache could not be written: %w", err)
	}
	tempPath := temp.Name()
	defer func() { _ = os.Remove(tempPath) }()
	if _, err := temp.Write(bytes); err != nil {
		_ = temp.Close()
		return fmt.Errorf("pronunciationonline: the cache could not be written: %w", err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("pronunciationonline: the cache could not be written: %w", err)
	}
	if err := os.Rename(tempPath, path); err != nil {
		return fmt.Errorf("pronunciationonline: the cache could not be written: %w", err)
	}
	return nil
}
