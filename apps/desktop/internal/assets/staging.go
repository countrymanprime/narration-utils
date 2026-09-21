package assets

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	stagingSuffix = ".installing"
	partSuffix    = ".part"
	asideMarker   = ".old-"
	// stagingMaxAge is how long a staging folder is kept for a resume: a week is longer than a narrator leaves a failed download, and short
	// enough that a multi-gigabyte half download does not sit on the disk for ever.
	stagingMaxAge = 7 * 24 * time.Hour
	// asideMaxAge is how long the old copy of a repaired asset is kept if removing it failed (a crash, a file in use).
	asideMaxAge = time.Hour
)

// remainingBytes is how many bytes of files are still to be fetched, counting what a staging folder from an earlier attempt already holds.
func remainingBytes(staging string, files []File) int64 {
	var remaining int64
	for _, f := range files {
		have := int64(0)
		if info, err := os.Stat(filepath.Join(staging, f.Name)); err == nil && info.Size() == f.Size {
			have = f.Size
		} else if info, err := os.Stat(filepath.Join(staging, f.Name+partSuffix)); err == nil && info.Size() < f.Size {
			have = info.Size()
		}
		remaining += f.Size - have
	}
	return remaining
}

// pruneStaging removes whatever the catalog does not name (a stray file, a part file left by another attempt), so nothing but the
// approved files can land in an install.
func pruneStaging(staging string, files []File) error {
	entries, err := os.ReadDir(staging)
	if err != nil {
		return err
	}
	named := map[string]bool{manifestName: true}
	for _, f := range files {
		named[f.Name] = true
	}
	for _, entry := range entries {
		if !named[entry.Name()] {
			if err := os.RemoveAll(filepath.Join(staging, entry.Name())); err != nil {
				return err
			}
		}
	}
	return nil
}

// CleanStale removes what an interrupted install or repair left under root that nothing will resume or restore: a staging folder older
// than a week and the aside copy of a repair older than an hour. An installed asset is never touched, and neither is a folder young
// enough to belong to a download that is still going or could still be resumed. It returns what it removed.
func CleanStale(root string) []string {
	var removed []string
	providers, _ := os.ReadDir(root)
	for _, provider := range providers {
		ids, _ := os.ReadDir(filepath.Join(root, provider.Name()))
		for _, id := range ids {
			dir := filepath.Join(root, provider.Name(), id.Name())
			entries, _ := os.ReadDir(dir)
			for _, entry := range entries {
				if !stale(entry) {
					continue
				}
				if os.RemoveAll(filepath.Join(dir, entry.Name())) == nil {
					removed = append(removed, filepath.Join(dir, entry.Name()))
				}
			}
		}
	}
	sort.Strings(removed)
	return removed
}

func stale(entry os.DirEntry) bool {
	name := entry.Name()
	var limit time.Duration
	switch {
	case strings.HasSuffix(name, stagingSuffix):
		limit = stagingMaxAge
	case strings.Contains(name, asideMarker):
		limit = asideMaxAge
	default:
		return false
	}
	info, err := entry.Info()
	return err == nil && time.Since(info.ModTime()) > limit
}
