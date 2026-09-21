package update

import (
	"os"
	"path/filepath"
)

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
