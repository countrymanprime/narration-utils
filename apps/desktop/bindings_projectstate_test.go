package main

import (
	"encoding/json"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
)

// ProjectStateChangedSince's answer (reaper-automation-follow-through PRD Phase 13): the "changed since comparison"
// label compares REAPER's count now against the one the comparison started from (TranscriptState.projectChangeCount).
func TestProjectStateChangedSinceComparesTheCountAgainstTheBaseline(t *testing.T) {
	host := &Host{}
	for _, c := range []struct {
		current, baseline int
		want              bool
	}{{41, 41, false}, {42, 41, true}, {3, 41, true}} {
		raw, err := host.ProjectStateChangedSince(c.current, c.baseline)
		if err != nil {
			t.Fatal(err)
		}
		var answer map[string]any
		if err := json.Unmarshal([]byte(raw), &answer); err != nil {
			t.Fatal(err)
		}
		if answer["changed"] != c.want {
			t.Fatalf("ProjectStateChangedSince(%d, %d) = %#v, want changed %v", c.current, c.baseline, answer, c.want)
		}
		if c.current == 42 {
			contractfile.Check(t, "project-state-changed-since", answer)
		}
	}
}
