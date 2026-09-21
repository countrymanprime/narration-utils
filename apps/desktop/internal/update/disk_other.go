//go:build !windows

package update

import (
	"golang.org/x/sys/unix"
)

// FreeBytes is how many bytes the current user can still write on the disk that holds path. The path need not exist yet: the
// nearest folder that does is asked.
func FreeBytes(path string) (uint64, error) {
	var stat unix.Statfs_t
	if err := unix.Statfs(nearestExisting(path), &stat); err != nil {
		return 0, err
	}
	return uint64(stat.Bavail) * uint64(stat.Bsize), nil //nolint:gosec // G115: block counts and sizes are never negative
}
