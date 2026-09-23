package tracks

import (
	"encoding/base64"
	"strings"
)

// extensionData reads a <EXTI> (item) or <EXT> (take) chunk into a plain
// key/value map (REAPER's P_EXT). A value is either an ordinary scalar line
// (already dequoted by tokenize) or a <BIN key ...> block of wrapped base64
// for a long value or one containing a line break; extensionData decodes
// the base64 back to text. It returns nil for a chunk with nothing in it
// (including a nil chunk), so an item or take without extension data has a
// nil Ext rather than an empty, allocated map.
func extensionData(n *node) map[string]string {
	if n == nil {
		return nil
	}
	data := map[string]string{}
	for _, entry := range n.sequence {
		if entry.child != nil {
			if entry.child.tag == "BIN" && len(entry.child.params) > 0 {
				data[entry.child.params[0]] = decodeBin(entry.child)
			}
			continue
		}
		if entry.key == "" {
			continue
		}
		data[entry.key] = firstValue(entry.values)
	}
	if len(data) == 0 {
		return nil
	}
	return data
}

// decodeBin reconstructs a <BIN key ...> block's base64 (wrapped across
// several lines with no internal whitespace, so each line is exactly one
// sequence entry with no values) and decodes it. A block that fails to
// decode - not expected from REAPER's own output, but the parser never
// errors on an unverified field - falls back to the raw, still-encoded
// text rather than dropping the value.
func decodeBin(n *node) string {
	var raw strings.Builder
	for _, entry := range n.sequence {
		if entry.child != nil || entry.key == "" {
			continue
		}
		raw.WriteString(entry.key)
		for _, value := range entry.values {
			raw.WriteString(value)
		}
	}
	encoded := raw.String()
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return encoded
	}
	return string(decoded)
}
