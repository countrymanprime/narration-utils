// Package layout is the one place Go code names repo-relative locations. The
// desktop host reads catalogs, the REAPER launcher and the Python sidecars from
// a source checkout, and its tests read fixtures from one; a directory move
// edits the constants below and nothing else.
package layout

import (
	"os"
	"path/filepath"
)

// Repo-relative locations, slash separated. Join them onto a checkout root with
// Path or RepoFile.
const (
	DesktopDir               = "shell"
	ConfigDir                = "shared/config"
	DefaultsFile             = ConfigDir + "/defaults.json"
	TTSCatalogFile           = ConfigDir + "/tts-assets.json"
	WhisperCatalogFile       = ConfigDir + "/whisper-assets.json"
	ReaperDir                = "shared/reaper"
	LauncherFile             = ReaperDir + "/NarrationUtils_Launcher.lua"
	FixturesDir              = "shared/test-fixtures"
	ManuscriptGuideBackend   = "tools/manuscript-guide/core/manuscript_guide.py"
	TranscriptCompareBackend = "tools/transcript-compare/core/compare.py"
	TeleprompterBackend      = "tools/manuscript-teleprompter/core/live_asr.py"
)

// Path joins a slash-separated repo-relative path onto root using the
// platform's separator.
func Path(root, rel string) string {
	return filepath.Join(root, filepath.FromSlash(rel))
}

// FindRoot walks up from start to the directory that holds DefaultsFile, the
// marker of a source checkout. It keeps `wails dev` usable from the desktop
// directory while release builds stay entirely resource-relative: when no
// checkout is found it returns the filesystem root, where none of the
// checkout-relative paths exist.
func FindRoot(start string) string {
	current, err := filepath.Abs(start)
	if err != nil {
		return start
	}
	for {
		if _, err := os.Stat(Path(current, DefaultsFile)); err == nil {
			return current
		}
		parent := filepath.Dir(current)
		if parent == current {
			return current
		}
		current = parent
	}
}

// RepoFile resolves a repo-relative path against the checkout that contains
// the current working directory. Tests use it instead of counting "..".
func RepoFile(rel string) string {
	return Path(FindRoot("."), rel)
}
