//go:build windows

package update

import (
	winsys "golang.org/x/sys/windows"
)

// FreeBytes is how many bytes the current user can still write on the disk that holds path. The path need not exist yet: the
// nearest folder that does is asked.
func FreeBytes(path string) (uint64, error) {
	existing := nearestExisting(path)
	pointer, err := winsys.UTF16PtrFromString(existing)
	if err != nil {
		return 0, err
	}
	var available, total, free uint64
	if err := winsys.GetDiskFreeSpaceEx(pointer, &available, &total, &free); err != nil {
		return 0, err
	}
	return available, nil
}
