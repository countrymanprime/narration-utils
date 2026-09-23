//go:build !windows

package daw

// LocateReaperExecutable is Windows-only: REAPER is the first supported DAW
// and the app is Windows-only so far (ADR 0030). A narrator on another
// platform falls back to a Settings override until a real auto-detect source
// is verified there.
func LocateReaperExecutable() (path, source string, err error) {
	return "", "", ErrNotFound
}
