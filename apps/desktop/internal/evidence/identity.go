// Package evidence is the analysis evidence ledger PRD's own small
// platform (docs/prds/analysis-evidence-ledger.prd.md): source identity,
// fingerprints, the analysis ledger, a per-item result cache, and the
// confirmed chapter-track mapping. Phase 1 lands only SourceIdentity and
// its hash policy (Q1): the piece diagnostics-delivery-and-cleanup-tools'
// own Phase 1 fingerprint evidence needs too (Q11a - "EL Phase 1 owns
// SourceIdentity and DX Phase 1 calls it", written here because DX Phase 1
// had not started this helper when EL Phase 1 landed). The analysis key,
// item and track fingerprints (what changed about an item on the
// timeline, not just its source file) are Phase 2 and are not built here.
package evidence

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// SourceIdentity answers "which audio file is this" stably across REAPER's
// own non-destructive edits, which never touch the source file (D6 of the
// evidence ledger PRD): split, trim and fade change item state only. Q1's
// recommendation (option C) is a cheap sample - size, modification time and
// a hash of the file's head, middle and tail blocks - rather than hashing
// every byte on every read, which would cost seconds per file on an
// hour-long recording on every Home load.
type SourceIdentity struct {
	// Path is project-relative when the file lives inside projectFolder (so
	// the identity is portable to another checkout of the same project on
	// another machine), else absolute and OS-native.
	Path        string
	Size        int64
	ModTime     time.Time
	PartialHash string
}

// partialBlockSize bounds each of PartialHash's reads, so identifying a
// large file costs at most three small reads instead of streaming the
// whole thing.
const partialBlockSize = 64 * 1024

// Identify reads path's size, modification time and PartialHash (Q1 option
// C) without reading the whole file. projectFolder, when non-empty, makes
// the returned Path project-relative when path is inside it; pass "" to
// always get an absolute Path.
func Identify(path, projectFolder string) (SourceIdentity, error) {
	file, err := os.Open(path)
	if err != nil {
		return SourceIdentity{}, err
	}
	defer func() { _ = file.Close() }()

	info, err := file.Stat()
	if err != nil {
		return SourceIdentity{}, err
	}
	if info.IsDir() {
		return SourceIdentity{}, fmt.Errorf("%s is a directory, not a source file", path)
	}

	hash, err := partialHash(file, info.Size())
	if err != nil {
		return SourceIdentity{}, err
	}

	return SourceIdentity{
		Path:        identityPath(path, projectFolder),
		Size:        info.Size(),
		ModTime:     info.ModTime().UTC(),
		PartialHash: hash,
	}, nil
}

// FullHash reads the whole file for a content hash (Q1 option B) - the
// expensive fallback a caller pays for only when PartialHash leaves a real
// question (for example two files agreeing on size, modification time and
// PartialHash). This package does not cache or persist anything itself:
// Q1's "computed lazily and cached by (path, size, mtime)" is the analysis
// ledger and cache's job (Phases 3 and 4), not this identity helper's.
func FullHash(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer func() { _ = file.Close() }()
	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

// partialHash hashes the file's first, middle (when large enough for a
// middle distinct from the head and tail blocks) and last blocks, plus the
// file size (so two files whose sampled bytes coincide by chance, but whose
// sizes differ, still get different hashes).
func partialHash(file *os.File, size int64) (string, error) {
	hasher := sha256.New()
	offsets := []int64{0}
	if size > partialBlockSize {
		offsets = append(offsets, size/2)
	}
	if size > 2*partialBlockSize {
		offsets = append(offsets, size-partialBlockSize)
	}
	buffer := make([]byte, partialBlockSize)
	for _, offset := range offsets {
		n, err := file.ReadAt(buffer, offset)
		if err != nil && err != io.EOF {
			return "", err
		}
		hasher.Write(buffer[:n])
	}
	if _, err := fmt.Fprintf(hasher, "|%d", size); err != nil {
		return "", err
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

func identityPath(path, projectFolder string) string {
	if projectFolder == "" {
		return filepath.Clean(path)
	}
	relative, err := filepath.Rel(projectFolder, path)
	if err != nil || strings.HasPrefix(relative, "..") {
		return filepath.Clean(path)
	}
	return filepath.ToSlash(relative)
}
