package assets

import (
	"fmt"
	"os"
	"path/filepath"
)

// The per-asset-kind folders under the asset cache. Each provider keeps its own catalog and its own folder, so removing one kind never
// touches another. The desktop host and the developer seeding command (cmd/seed-assets) both name the cache through these, so the two
// can never disagree about where an asset lives.
const (
	TTSDir     = "tts"
	WhisperDir = "whisper"
	SpacyDir   = "spacy"
)

// CacheBase is where downloaded assets live: the per-user cache folder, outside the release, the project and the checkout. When the
// operating system cannot say where that is the answer is an error and not the temporary folder, which a cleanup tool empties: a
// multi-gigabyte download must not land there.
func CacheBase() (string, error) {
	base, err := os.UserCacheDir()
	if err != nil {
		return "", fmt.Errorf("the per-user cache folder for downloaded models could not be found: %w", err)
	}
	return CacheBaseIn(base), nil
}

// CacheBaseIn is the asset cache inside a given per-user cache folder (what os.UserCacheDir returns).
func CacheBaseIn(userCache string) string {
	return filepath.Join(userCache, "narration-utils", "assets")
}
