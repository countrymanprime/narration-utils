//go:build windows

package update

import "os/exec"

// OpenFolder shows a folder in Explorer. Explorer reports a failure status even when it opens the folder, so only a failure to start
// it is an error.
func OpenFolder(dir string) error {
	command := exec.Command("explorer.exe", dir) //nolint:gosec // G204: the folder is the update cache's, chosen by this program
	if err := command.Start(); err != nil {
		return userError("The folder could not be opened.")
	}
	return command.Process.Release()
}
