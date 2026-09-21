package assets

import (
	"fmt"
	"os"
	"path/filepath"
)

// downloadHeadroom is what is kept free beyond the download itself: the disk is not filled to the last byte.
const downloadHeadroom = 64 << 20

// freeBytes is a seam for tests.
var freeBytes = FreeBytes

// InsufficientSpaceError is a download the disk cannot hold. Need includes the headroom; both are bytes.
type InsufficientSpaceError struct {
	Need, Free uint64
}

func (e *InsufficientSpaceError) Error() string {
	return fmt.Sprintf("There is not enough free space for this download: it needs about %s and the disk has %s free. Free some space and try again.", humanBytes(e.Need), humanBytes(e.Free))
}

// RequireFreeSpace is an Options.Preflight: it refuses a download the disk that holds root cannot hold. A disk that cannot be measured is
// not a reason to refuse.
func RequireFreeSpace(root string, need int64) error {
	free, err := freeBytes(root)
	if err != nil {
		return nil
	}
	required := uint64(max(need, 0)) + downloadHeadroom
	if free < required {
		return &InsufficientSpaceError{Need: required, Free: free}
	}
	return nil
}

// humanBytes is a size a narrator can read: whole megabytes below a gigabyte, one decimal of a gigabyte above.
func humanBytes(n uint64) string {
	const megabyte, gigabyte = 1 << 20, 1 << 30
	if n >= gigabyte {
		return fmt.Sprintf("%.1f GB", float64(n)/gigabyte)
	}
	return fmt.Sprintf("%d MB", (n+megabyte/2)/megabyte)
}

// nearestExisting is path if it exists, otherwise the closest parent that does: the disk a folder about to be created will be on.
func nearestExisting(path string) string {
	for current := filepath.Clean(path); ; current = filepath.Dir(current) {
		if _, err := os.Stat(current); err == nil {
			return current
		}
		if parent := filepath.Dir(current); parent == current {
			return current
		}
	}
}
