package assets

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// ErrBadArchive is a downloaded archive that cannot be unpacked safely: not an archive at all, a path that leaves the install, a link, a
// name Windows would treat as a device, a duplicate, or more data than the catalog says it holds. The install fails and nothing is kept.
var ErrBadArchive = errors.New("the downloaded archive could not be unpacked safely")

const (
	// maxArchiveFiles bounds how many files an archive may hold: a model wheel holds a few dozen.
	maxArchiveFiles = 10000
	// expandSlack is what an archive may hold beyond the size the catalog gives for it, for the small files a size estimate rounds off.
	expandSlack = 1 << 20
)

// ExtractedFile is one file that came out of an archive: where it is under the install folder (with forward slashes), and what it held
// when it was unpacked, so a later check can tell that it changed.
type ExtractedFile struct {
	Path    string `json:"path"`
	SHA256  string `json:"sha256"`
	Size    int64  `json:"size"`
	ModTime int64  `json:"modTimeUnixNano"`
}

// windowsDevices are names Windows treats as devices whatever their extension (and whatever spaces or dots follow the stem).
var windowsDevices = map[string]bool{"CON": true, "PRN": true, "AUX": true, "NUL": true, "CONIN$": true, "CONOUT$": true}

// isNumberedDevice reports COM1..COM9 and LPT1..LPT9, including the superscript digits Windows also reserves.
func isNumberedDevice(stem string) bool {
	runes := []rune(stem)
	if len(runes) != 4 || (string(runes[:3]) != "COM" && string(runes[:3]) != "LPT") {
		return false
	}
	return strings.ContainsRune("123456789\u00b9\u00b2\u00b3", runes[3])
}

// safeSegment says whether one part of an archive path can be created as a file or folder name on every platform.
func safeSegment(segment string) bool {
	if segment == "" || segment == "." || segment == ".." || strings.HasSuffix(segment, ".") || strings.HasSuffix(segment, " ") {
		return false
	}
	// `$` is allowed in a name, but `:` (a drive, a stream) and the rest never are.
	if strings.ContainsAny(segment, "\\:*?\"<>|") {
		return false
	}
	for _, r := range segment {
		if r < 0x20 {
			return false
		}
	}
	stem := strings.ToUpper(segment)
	if dot := strings.IndexByte(stem, '.'); dot >= 0 {
		stem = stem[:dot]
	}
	stem = strings.TrimRight(stem, " ")
	return !windowsDevices[stem] && !isNumberedDevice(stem)
}

// extractArchive unpacks the archive at staging/file.Name into staging/file.Extract and removes the archive. Every entry is checked before
// anything is written, the bytes actually written are counted against the catalog, and each unpacked file's hash, size and time are
// returned for the manifest. On any error the caller removes the staging folder.
func extractArchive(staging string, file File) ([]ExtractedFile, error) {
	archivePath := filepath.Join(staging, file.Name)
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrBadArchive, err)
	}
	defer func() { _ = reader.Close() }() // read-only
	if len(reader.File) == 0 || len(reader.File) > maxArchiveFiles {
		return nil, fmt.Errorf("%w: it holds %d entries", ErrBadArchive, len(reader.File))
	}
	limit := file.Expand + expandSlack
	var declared uint64
	seen := map[string]bool{}
	for _, entry := range reader.File {
		if err := checkEntry(entry, seen); err != nil {
			return nil, err
		}
		// Each entry is checked alone first, so a huge declared size cannot wrap the running total back under the limit.
		if entry.UncompressedSize64 > uint64(limit) || declared+entry.UncompressedSize64 > uint64(limit) { //nolint:gosec // G115: limit is a catalog size, never negative
			return nil, fmt.Errorf("%w: it holds more than the %d bytes the catalog says", ErrBadArchive, file.Expand)
		}
		declared += entry.UncompressedSize64
	}
	root := filepath.Join(staging, file.Extract)
	// A clean slate every attempt: a folder a failed unpack left behind (disk full, an antivirus lock) would make the next attempt refuse
	// its first file as already there, and the install could never be retried.
	if err := os.RemoveAll(root); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	var extracted []ExtractedFile
	written := int64(0)
	for _, entry := range reader.File {
		relative := strings.TrimSuffix(entry.Name, "/")
		destination := filepath.Join(root, filepath.FromSlash(relative))
		if !strings.HasPrefix(destination, root+string(os.PathSeparator)) {
			return nil, fmt.Errorf("%w: %q leaves the install folder", ErrBadArchive, entry.Name)
		}
		if entry.FileInfo().IsDir() {
			if err := os.MkdirAll(destination, 0o755); err != nil {
				return nil, err
			}
			continue
		}
		done, item, err := writeEntry(entry, destination, limit-written)
		if err != nil {
			return nil, err
		}
		written += done
		item.Path = file.Extract + "/" + relative
		extracted = append(extracted, item)
	}
	if err := reader.Close(); err != nil {
		return nil, err
	}
	if err := os.Remove(archivePath); err != nil {
		return nil, err
	}
	return extracted, nil
}

// checkEntry refuses an entry that could be unpacked outside the install, over another entry or as something that is not a plain file.
func checkEntry(entry *zip.File, seen map[string]bool) error {
	name := entry.Name
	if name == "" || strings.HasPrefix(name, "/") {
		return fmt.Errorf("%w: %q is not a relative path", ErrBadArchive, name)
	}
	for _, segment := range strings.Split(strings.TrimSuffix(name, "/"), "/") {
		if !safeSegment(segment) {
			return fmt.Errorf("%w: %q is not a safe path", ErrBadArchive, name)
		}
	}
	if mode := entry.Mode(); !mode.IsRegular() && !mode.IsDir() {
		return fmt.Errorf("%w: %q is a link or a special file", ErrBadArchive, name)
	}
	key := strings.ToLower(strings.TrimSuffix(name, "/"))
	if seen[key] {
		return fmt.Errorf("%w: %q appears twice", ErrBadArchive, name)
	}
	seen[key] = true
	return nil
}

// writeEntry unpacks one file, hashing what it writes and refusing to write more than budget bytes.
func writeEntry(entry *zip.File, destination string, budget int64) (int64, ExtractedFile, error) {
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return 0, ExtractedFile{}, err
	}
	source, err := entry.Open()
	if err != nil {
		return 0, ExtractedFile{}, fmt.Errorf("%w: %v", ErrBadArchive, err)
	}
	defer func() { _ = source.Close() }() // read-only
	out, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return 0, ExtractedFile{}, err
	}
	hash := sha256.New()
	copied, copyErr := io.Copy(io.MultiWriter(out, hash), io.LimitReader(source, budget+1))
	closeErr := out.Close()
	if copyErr != nil {
		return 0, ExtractedFile{}, fmt.Errorf("%w: %v", ErrBadArchive, copyErr)
	}
	if closeErr != nil {
		return 0, ExtractedFile{}, closeErr
	}
	if copied > budget {
		return 0, ExtractedFile{}, fmt.Errorf("%w: it holds more than the catalog says", ErrBadArchive)
	}
	info, err := os.Stat(destination)
	if err != nil {
		return 0, ExtractedFile{}, err
	}
	return copied, ExtractedFile{SHA256: hex.EncodeToString(hash.Sum(nil)), Size: copied, ModTime: info.ModTime().UnixNano()}, nil
}
