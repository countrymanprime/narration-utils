//go:build !windows

package update

// OpenFolder is Windows-only: only Windows stages an update for the narrator to install by hand.
func OpenFolder(string) error { return userError("This platform does not download updates itself.") }
