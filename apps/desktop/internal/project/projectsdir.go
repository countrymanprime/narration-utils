package project

import (
	"fmt"
	"os"
	"path/filepath"
)

// DefaultDirName is the folder created under the user's home directory as the
// default projects directory.
const DefaultDirName = "NarrationStudio"

// LegacyDefaultDirName is the default folder's name before the product became Narration Studio (#1816). A narrator whose
// projects are in it keeps using it; nothing moves it. Delete it, and the fallback in DefaultDir, when the name is retired.
const LegacyDefaultDirName = "NarrationUtils"

// DefaultDir resolves the Go-side computed default projects directory,
// ~/NarrationStudio, or an existing ~/NarrationUtils when ~/NarrationStudio does not exist yet. It is deliberately not a value in
// config/defaults.json: that file holds literal per-tool settings
// (store_test.go's TestBuiltinDefaultsMatchRepoDefaultsFile keeps it in sync
// with a hardcoded map), and a computed, per-machine home directory cannot be
// a literal there.
//
// It prefers %USERPROFILE% (Windows first), then $HOME, then falls
// back to os.UserHomeDir for any platform where neither is set. When none of
// those resolve a home directory - a sandboxed environment, a broken profile,
// a OneDrive-redirected home that failed to mount - it returns an error
// rather than a guess. The caller (host startup) treats that as non-fatal:
// first run must never fail to start because no default projects directory
// could be computed.
func DefaultDir() (string, error) {
	home := os.Getenv("USERPROFILE")
	if home == "" {
		home = os.Getenv("HOME")
	}
	if home == "" {
		var err error
		home, err = os.UserHomeDir()
		if err != nil {
			home = ""
		}
	}
	if home == "" {
		return "", fmt.Errorf("could not resolve the user's home directory for a default projects directory")
	}
	dir := filepath.Join(home, DefaultDirName)
	if isDir(dir) {
		return dir, nil
	}
	if legacy := filepath.Join(home, LegacyDefaultDirName); isDir(legacy) {
		return legacy, nil
	}
	return dir, nil
}

func isDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// EnsureDir creates dir, including any missing parents, if it does not exist
// yet. It is safe to call on every startup (MkdirAll is a no-op when dir
// already exists) and, like DefaultDir, is meant to be treated as non-fatal by
// its caller: a failure here (an unwritable home, a redirected folder that
// refuses new folders) is logged and the app still starts.
func EnsureDir(dir string) error {
	if dir == "" {
		return fmt.Errorf("no projects directory to create")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("could not create the projects directory %s: %w", dir, err)
	}
	return nil
}

// ResolveDir returns the projects directory to use: override when it is
// non-empty (the narrator's own global-only setting, so it has no project
// or repo-default tier), otherwise the Go-computed default.
func ResolveDir(override string) (string, error) {
	if override != "" {
		return override, nil
	}
	return DefaultDir()
}
