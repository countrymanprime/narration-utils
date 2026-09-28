package series

import (
	"path/filepath"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/character"
)

// SiblingReference is one series-member project's approved character references, or why they could not be read.
// A missing references.json (a book with no approved references yet) is not an error and reads as zero
// References with no Unreadable reason; Unreadable is reserved for a sibling whose data exists but could not be
// decoded.
type SiblingReference struct {
	ProjectPath string                `json:"projectPath"`
	References  []character.Reference `json:"references"`
	Unreadable  string                `json:"unreadable,omitempty"`
}

// Siblings reads every other member project's approved references for entry, given the caller's own current
// project path (excluded from the result - a project never reads its own references through this path; the
// caller already has its own character.Service for that).
//
// Each sibling is read through character.ReadOnly, which only ever reads: a series member this narrator has open
// right now is never written to on another project's behalf (Q10/Q11's "no write path from one project's session
// into another project's own data"). A sibling that cannot be read is reported per-project in Unreadable rather
// than failing the whole call (Phase 9's own success signal: "a series member project's baseline read tolerates
// a missing or unreadable sibling project").
func Siblings(entry Series, currentProject string) []SiblingReference {
	clean := filepath.Clean(currentProject)
	out := make([]SiblingReference, 0, len(entry.MemberProjectPaths))
	for _, path := range entry.MemberProjectPaths {
		if strings.EqualFold(filepath.Clean(path), clean) {
			continue
		}
		one := SiblingReference{ProjectPath: path}
		references, err := character.ReadOnly(path)
		if err != nil {
			one.Unreadable = err.Error()
		} else {
			one.References = references
		}
		out = append(out, one)
	}
	return out
}
