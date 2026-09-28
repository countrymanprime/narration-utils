package guide

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

// ReadOnlyNames reads project's own Story Bible and returns each non-Draft entity's canonical name by id - the
// cross-project name lookup docs/prds/character-continuity-review.prd.md Phase 11 needs so a series voice bible can
// label a character approved in a book that is not the one currently open (entity ids are a hash of the normalized
// name, apps/desktop/internal/character.ReadOnly's own sibling-reading precedent, so the same character in two
// books already shares one id; only the display name has to be looked up per book).
//
// Like character.ReadOnly, this is a plain, non-mutating read: it never quarantines or otherwise touches a file
// that fails to decode. A project's own session (its own guide.Service, if any) is what may act on its own corrupt
// data; this function only ever crosses into another project's data to look, matching Phase 9's established rule -
// "no write path from one project's session into another project's own data" - reused here for the Story Bible.
func ReadOnlyNames(project string) (map[string]string, error) {
	path := filepath.Join(project, "ManuscriptGuide", "manuscript_guide.json")
	bytes, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return map[string]string{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("could not read %s's Story Bible: %w", filepath.Base(project), err)
	}
	var document map[string]any
	if err := json.Unmarshal(bytes, &document); err != nil {
		return nil, fmt.Errorf("%s's Story Bible could not be read: %w", filepath.Base(project), err)
	}
	version, _ := document["schema_version"].(float64)
	if err := persist.CheckVersion(int(version), schemaVersion, "Story Bible"); err != nil {
		return nil, err
	}
	names := map[string]string{}
	raw, _ := document["entities"].([]any)
	for _, x := range raw {
		entity, ok := x.(map[string]any)
		if !ok {
			continue
		}
		id, _ := entity["id"].(string)
		category, _ := entity["category"].(string)
		name, _ := entity["canonical_name"].(string)
		// A Draft entry has no real identity yet (Guide.tsx's own "hidden from every tab except while open" rule);
		// it is never a fellow book's stable character.
		if id == "" || name == "" || category == "Draft" {
			continue
		}
		names[id] = name
	}
	return names, nil
}
