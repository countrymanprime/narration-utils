//go:build !windows

package daw

// IsRunning is false off Windows: the DAW launcher and its detection are Windows-only for now.
func IsRunning(string) bool { return false }
