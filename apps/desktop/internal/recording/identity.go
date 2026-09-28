package recording

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

// Line identity for a native take (native-recording-suite PRD Phase 3, Open Question 8, answered by D86): REAPER
// has an item to stamp line identity onto (docs/adr/0026-manuscript-line-identity-in-item-extension-data.md); a
// native take has no item, so its line identity lives instead in a project-owned sidecar file next to the takes
// themselves, keyed by take name. ComposeLineID and ParseLineID mirror internal/lineidentity's composed-id scheme
// field for field (an entity ID plus the manuscript's source SHA-256, joined by "@") so a line id composed by
// either path parses identically; the two packages share no code, only the wire scheme, the same way ADR 0098
// extends ADR 0026's pattern to a new granularity without importing it.

// identityFileName is the sidecar file inside a project's Recordings folder.
const identityFileName = "line-identity.json"

const lineIDSeparator = "@"

// ComposeLineID composes a take's line identity from the manuscript entity ID it belongs to (a paragraph ID such
// as "p-000001" or a chapter ID such as "c-0001") and the manuscript's current source SHA-256, so a re-import
// that renumbers entities is detectable instead of silently drifting (the same reasoning as
// internal/lineidentity.ComposeLineID).
func ComposeLineID(entityID, sourceSHA256 string) string {
	return entityID + lineIDSeparator + sourceSHA256
}

// ParseLineID reverses ComposeLineID. ok is false for anything ComposeLineID could not have produced (an empty
// entity id, or no separator).
func ParseLineID(lineID string) (entityID, sourceSHA256 string, ok bool) {
	at := strings.LastIndex(lineID, lineIDSeparator)
	if at <= 0 || at == len(lineID)-1 {
		return "", "", false
	}
	return lineID[:at], lineID[at+1:], true
}

// Source is the take's DAW-agnostic identity in the shared findings contract (docs/architecture/findings-contract.md):
// only File is ever set. A native take has no REAPER track, item or take to give TrackGUID/ItemGUID/TakeGUID, so
// they stay empty - the same as those fields already mean for any DAW-neutral source - rather than a synthetic
// stand-in, so REAPER-navigation code (FindingsGoTo and friends, which resolve a GUID inside a running REAPER)
// never mistakes a native take for one it could navigate to.
func (t Take) Source() findings.Source {
	return findings.Source{File: t.Path}
}

func identityPath(folder string) string { return filepath.Join(folder, identityFileName) }

// readIdentities reads folder's line-identity sidecar: take name -> composed line id. A missing file has none. A
// file that cannot be parsed (a corrupt write, or a future scheme) yields none too, rather than failing the
// whole take listing over an optional annotation - the same laissez-faire treatment listTakes already gives an
// unreadable WAV header.
func readIdentities(folder string) map[string]string {
	raw, err := os.ReadFile(identityPath(folder))
	if err != nil {
		return map[string]string{}
	}
	var identities map[string]string
	if err := json.Unmarshal(raw, &identities); err != nil || identities == nil {
		return map[string]string{}
	}
	return identities
}

// writeIdentities writes folder's sidecar, temp-file-then-rename like findings.Store, so a reader never sees a
// half-written file.
func writeIdentities(folder string, identities map[string]string) error {
	raw, err := json.MarshalIndent(identities, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(folder, identityFileName+".tmp-*")
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
	if err := os.Rename(tmpPath, identityPath(folder)); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	return nil
}

// SetTakeLine assigns folder's takeName the manuscript line entityID at the manuscript's current sourceSHA256, or
// clears its assignment when entityID is "". It never touches the take's audio file (Q5): only this sidecar.
func setTakeLine(folder, takeName, entityID, sourceSHA256 string) error {
	if takeName == "" {
		return errors.New("choose a take before assigning it a manuscript line")
	}
	identities := readIdentities(folder)
	if entityID == "" {
		delete(identities, takeName)
	} else {
		if sourceSHA256 == "" {
			return errors.New("the manuscript has no recorded source checksum")
		}
		identities[takeName] = ComposeLineID(entityID, sourceSHA256)
	}
	if err := os.MkdirAll(folder, 0o755); err != nil {
		return fmt.Errorf("could not prepare the Recordings folder: %w", err)
	}
	return writeIdentities(folder, identities)
}
