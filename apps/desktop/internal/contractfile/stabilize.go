package contractfile

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
)

var (
	randomID  = regexp.MustCompile(`^[0-9a-f]{32}$`)
	timestamp = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$`)
)

// FixedTime replaces every timestamp in a stabilized payload.
const FixedTime = "2026-09-21T10:00:00Z"

// Stabilize makes a payload reproducible: it round-trips the value through JSON (so it is what the UI would receive), replaces each
// random 32-character hex id with `id-1`, `id-2`, ... in order of first appearance (the same id always gets the same name, so
// references between records survive), and replaces every RFC 3339 timestamp with FixedTime. Everything else is left alone: a
// contract file should hold real values wherever they are stable.
func Stabilize(value any) (any, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var decoded any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		return nil, err
	}
	names := map[string]string{}
	return stabilize(decoded, names), nil
}

func stabilize(value any, names map[string]string) any {
	switch typed := value.(type) {
	case string:
		switch {
		case randomID.MatchString(typed):
			if name, ok := names[typed]; ok {
				return name
			}
			name := fmt.Sprintf("id-%d", len(names)+1)
			names[typed] = name
			return name
		case timestamp.MatchString(typed):
			return FixedTime
		}
		return typed
	case []any:
		for index, item := range typed {
			typed[index] = stabilize(item, names)
		}
		return typed
	case map[string]any:
		// Keys are visited in sorted order so the numbering does not depend on map iteration order.
		for _, key := range sortedKeys(typed) {
			typed[key] = stabilize(typed[key], names)
		}
		return typed
	}
	return value
}

// PortablePaths replaces a machine-specific folder (a temp directory) with a fixed one in every string of a payload and writes the
// paths that were under it with forward slashes, so the contract file reads the same on every machine.
func PortablePaths(value any, folder, replacement string) (any, error) {
	stable, err := Stabilize(value)
	if err != nil {
		return nil, err
	}
	return portable(stable, folder, replacement), nil
}

func portable(value any, folder, replacement string) any {
	switch typed := value.(type) {
	case string:
		if strings.Contains(typed, folder) {
			return filepath.ToSlash(strings.ReplaceAll(typed, folder, replacement))
		}
		return typed
	case []any:
		for index, item := range typed {
			typed[index] = portable(item, folder, replacement)
		}
		return typed
	case map[string]any:
		for key, item := range typed {
			typed[key] = portable(item, folder, replacement)
		}
		return typed
	}
	return value
}
