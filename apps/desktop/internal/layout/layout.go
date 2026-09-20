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
	DesktopDir               = "apps/desktop"
	DesktopConfigFile        = DesktopDir + "/wails.json"
	ConfigDir                = "config"
	DefaultsFile             = ConfigDir + "/defaults.json"
	TTSCatalogFile           = ConfigDir + "/tts-assets.json"
	WhisperCatalogFile       = ConfigDir + "/whisper-assets.json"
	ReaperDir                = "integrations/reaper"
	LauncherFile             = ReaperDir + "/NarrationUtils_Launcher.lua"
	FixturesDir              = "tests/fixtures"
	ManuscriptGuideBackend   = "sidecars/manuscript-guide/core/manuscript_guide.py"
	TranscriptCompareBackend = "sidecars/transcript-compare/core/compare.py"
	TeleprompterBackend      = "sidecars/manuscript-teleprompter/core/live_asr.py"
)

// Path joins a slash-separated repo-relative path onto root using the
// platform's separator.
func Path(root, rel string) string {
	return filepath.Join(root, filepath.FromSlash(rel))
}

// FindRoot walks up from start to the directory that holds both DefaultsFile
// and DesktopConfigFile, the markers of a source checkout (DefaultsFile alone
// is a generic name another project could share). It keeps `wails dev` usable from the desktop
// directory while release builds stay entirely resource-relative: when no
// checkout is found it returns the filesystem root, where none of the
// checkout-relative paths exist.
func FindRoot(start string) string {
	current, err := filepath.Abs(start)
	if err != nil {
		return start
	}
	for {
		if isCheckoutRoot(current) {
			return current
		}
		parent := filepath.Dir(current)
		if parent == current {
			return current
		}
		current = parent
	}
}

func isCheckoutRoot(dir string) bool {
	for _, marker := range []string{DefaultsFile, DesktopConfigFile} {
		if _, err := os.Stat(Path(dir, marker)); err != nil {
			return false
		}
	}
	return true
}

// RepoFile resolves a repo-relative path against the checkout that contains
// the current working directory. Tests use it instead of counting "..".
func RepoFile(rel string) string {
	return Path(FindRoot("."), rel)
}
