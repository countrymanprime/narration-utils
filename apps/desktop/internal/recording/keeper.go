package recording

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// The "keeper" mark on a native take (native-recording-suite PRD Phase 4, Solution Detail "mark the keeper take
// among several; narrator-confirmed, undoable", Q5's "keeper, accept and discard are narrator-confirmed changes to
// the take's metadata, and each can be undone"). Mirrors identity.go's sidecar pattern (a project-owned file in the
// Recordings folder, keyed by take name), but a separate file: keeper status and line identity are independent
// facts about a take, and a corrupt keeper file must never lose a narrator's line assignments (or the other way
// round) - the same reasoning that keeps line-identity.json its own file rather than a field on the take itself.

// keeperFileName is the sidecar file inside a project's Recordings folder.
const keeperFileName = "keeper.json"

func keeperPath(folder string) string { return filepath.Join(folder, keeperFileName) }

// readKeepers reads folder's keeper sidecar: take name -> true for every take marked keeper (a take absent from the
// map is not one). A missing or corrupt file yields none, the same laissez-faire treatment readIdentities gives an
// unreadable sidecar of its own.
func readKeepers(folder string) map[string]bool {
	raw, err := os.ReadFile(keeperPath(folder))
	if err != nil {
		return map[string]bool{}
	}
	var keepers map[string]bool
	if err := json.Unmarshal(raw, &keepers); err != nil || keepers == nil {
		return map[string]bool{}
	}
	return keepers
}

// writeKeepers writes folder's sidecar, temp-file-then-rename like writeIdentities, so a reader never sees a
// half-written file.
func writeKeepers(folder string, keepers map[string]bool) error {
	raw, err := json.MarshalIndent(keepers, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(folder, keeperFileName+".tmp-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	if _, err := tmp.Write(raw); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	if err := os.Rename(tmpPath, keeperPath(folder)); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	return nil
}

// setTakeKeeper marks or unmarks takeName the keeper. Marking it clears every other take that shares its line
// (identities, from readIdentities): the narrator marks one keeper per line, and handing the mark to a different
// take is exactly the same confirmed, undoable action as unmarking it. A take with no line assigned yet has no
// group to clear, so it is marked (or unmarked) alone; it never touches the take's audio file.
func setTakeKeeper(folder, takeName string, keeper bool, identities map[string]string) error {
	if takeName == "" {
		return errors.New("choose a take before marking it the keeper")
	}
	keepers := readKeepers(folder)
	if keeper {
		if lineID, hasLine := identities[takeName]; hasLine {
			for other, otherLine := range identities {
				if other != takeName && otherLine == lineID {
					delete(keepers, other)
				}
			}
		}
		keepers[takeName] = true
	} else {
		delete(keepers, takeName)
	}
	if err := os.MkdirAll(folder, 0o755); err != nil {
		return fmt.Errorf("could not prepare the Recordings folder: %w", err)
	}
	return writeKeepers(folder, keepers)
}
