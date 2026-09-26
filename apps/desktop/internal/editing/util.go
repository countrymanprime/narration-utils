package editing

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
)

// hashParts hashes parts into one deterministic hex digest, each
// length-prefixed so ("ab","c") and ("a","bc") never collide - the same
// pattern apps/desktop/internal/evidence/fingerprint.go's own hashParts and
// apps/desktop/internal/findings/findings.go's StableID use. Kept as this
// package's own copy rather than exported from either: neither package
// exports it, and duplicating four lines is simpler than asking either to.
func hashParts(parts ...string) string {
	hash := sha256.New()
	for _, part := range parts {
		_, _ = fmt.Fprintf(hash, "%d:%s", len(part), part)
	}
	return hex.EncodeToString(hash.Sum(nil))
}

// formatFloat renders a seconds-like value at a fixed precision, matching
// evidence.formatSeconds's own microsecond precision so two identity hashes
// never disagree over a value that would print the same in the UI.
func formatFloat(value float64) string {
	return strconv.FormatFloat(value, 'f', 6, 64)
}
