package character

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

// ReadOnly reads project's stored references.json without a Service configured for it - the cross-project read
// docs/prds/character-continuity-review.prd.md Phase 9 (Q10, Q11) needs so a series' other books can be listed
// alongside the current one.
//
// Unlike Service.readLocked, this is a plain, non-mutating read: it never quarantines or otherwise touches a file
// that fails to decode. project's own session (the character.Service built for it, if any) is what may act on its
// own corrupt data; this function only ever crosses into another project's data to look, matching Phase 9's own
// scope - "no write path from one project's session into another project's own data".
func ReadOnly(project string) ([]Reference, error) {
	bytes, err := os.ReadFile(referencesPath(project))
	if errors.Is(err, fs.ErrNotExist) {
		return []Reference{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("could not read %s's %s: %w", filepath.Base(project), what, err)
	}
	var file referencesFile
	if err := json.Unmarshal(bytes, &file); err != nil {
		return nil, fmt.Errorf("%s's %s could not be read: %w", filepath.Base(project), what, err)
	}
	if err := persist.CheckVersion(file.SchemaVersion, referencesSchemaVersion, what); err != nil {
		return nil, err
	}
	if file.References == nil {
		return []Reference{}, nil
	}
	return file.References, nil
}
