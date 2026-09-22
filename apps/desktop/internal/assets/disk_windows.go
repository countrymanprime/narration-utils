//go:build windows

package assets

import (
	"errors"
	"syscall"

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

// IsDiskFull reports whether err is the disk having no room left (ERROR_DISK_FULL or ERROR_HANDLE_DISK_FULL).
func IsDiskFull(err error) bool {
	var errno syscall.Errno
	return errors.As(err, &errno) && (errno == winsys.ERROR_DISK_FULL || errno == winsys.ERROR_HANDLE_DISK_FULL)
}
