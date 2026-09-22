package update

import "github.com/countrymanprime/narration-utils/shell/internal/assets"

// FreeBytes is how many bytes the current user can still write on the disk that holds path. The path need not exist yet: the
// nearest folder that does is asked. It is the asset manager's, which every download shares.
func FreeBytes(path string) (uint64, error) { return assets.FreeBytes(path) }
