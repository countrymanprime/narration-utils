package assets

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// ErrBadContent is an archive that was downloaded, checked and unpacked, but whose contents a Derive step could not turn into what the
// install keeps (the dataset is not in the shape the app reads). The install fails and nothing is kept to resume from: the same bytes
// would fail again.
var ErrBadContent = errors.New("the downloaded data could not be prepared for use")

// derive runs a Derive step on one unpacked archive and checks what it says the install keeps: at least one file, each a clean relative
// path under the archive's own folder (the only folder pruneStaging keeps for it).
func derive(staging string, file File, unpacked []ExtractedFile, step func(string, File, []ExtractedFile) ([]ExtractedFile, error)) ([]ExtractedFile, error) {
	kept, err := step(staging, file, unpacked)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrBadContent, err)
	}
	if len(kept) == 0 {
		return nil, fmt.Errorf("%w: nothing was kept", ErrBadContent)
	}
	for _, item := range kept {
		if path.Clean(item.Path) != item.Path || !strings.HasPrefix(item.Path, file.Extract+"/") {
			return nil, fmt.Errorf("%w: %q is not under %q", ErrBadContent, item.Path, file.Extract)
		}
	}
	return kept, nil
}

// RecordFile hashes one file a Derive step wrote under the staging folder (relative is its path there, with forward slashes) and returns
// the record the manifest keeps of it.
func RecordFile(staging, relative string) (ExtractedFile, error) {
	full := filepath.Join(staging, filepath.FromSlash(relative))
	file, err := os.Open(full)
	if err != nil {
		return ExtractedFile{}, err
	}
	defer func() { _ = file.Close() }() // read-only
	hash := sha256.New()
	size, err := io.Copy(hash, file)
	if err != nil {
		return ExtractedFile{}, err
	}
	info, err := file.Stat()
	if err != nil {
		return ExtractedFile{}, err
	}
	return ExtractedFile{Path: relative, SHA256: hex.EncodeToString(hash.Sum(nil)), Size: size, ModTime: info.ModTime().UnixNano()}, nil
}
