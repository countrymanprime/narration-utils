package passagetakes

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/coverage"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/takecompare"
)

// pin writes (UPDATE_CONTRACTS=1) or checks the payload the host really sends for a binding, as
// bindings_findings_contract_test.go's checkBindingContract does: the host encodes exactly these types.
func pin(t *testing.T, name string, value any) {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var decoded any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	stable, err := contractfile.Stabilize(decoded)
	if err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, name, stable)
}

// What WorkspaceTakes sends (edit-and-proof-workspace.prd.md Phase 6, ADR 0700): a passage with a take from each of
// EP6's three sources and a saved comparison covering some of them, then a passage nothing was heard on.
func TestContractWorkspaceTakes(t *testing.T) {
	saved := findings.Finding{ID: "cmp-1", Analyzer: takecompare.AnalyzerName, Evidence: map[string]any{"members": []any{
		map[string]any{"item_guid": guidB, "take_guid": take3, "compared": true, "fidelity": 0.75},
		map[string]any{"item_guid": guidD, "take_guid": take5, "compared": false, "not_compared_reason": "None of this part of the script was heard in this take, so it is not compared with the others."},
	}}}
	// The passage was heard on item B, a retake on a fixed lane with a second take of its own; a take-review group sets
	// item D's read beside it: one candidate from each of EP6's sources.
	mixed := resolve(t, func(in *Input) {
		in.View.Items[0] = coverage.AlignmentItem{Index: 0, ItemGUID: guidB, Live: true, TakeGUID: take3}
		second := take("lane-b-second.wav", "lane-b-second.wav", 1, false)
		second.GUID = "{66666666-0000-0000-0000-000000000006}"
		in.Project.Tracks[1].Items[0].Takes = append(in.Project.Tracks[1].Items[0].Takes, second)
		in.Groups = []findings.Finding{group("g-1", member(guidB, take3, "lane-b.wav", 0), member(guidD, take5, "pickup.wav", 3))}
		in.Comparison = func(string) (findings.Finding, bool) { return saved, true }
	})
	pin(t, "workspace-takes", mixed.View)

	nothing := resolve(t, func(in *Input) { in.FirstToken, in.LastToken = 5, 5 })
	pin(t, "workspace-takes-none", nothing.View)
}

// What WorkspaceUseTake sends: each outcome the schema and the mock promise.
func TestContractWorkspaceUseTake(t *testing.T) {
	fake := &fakeActors{setChanged: true}
	pin(t, "workspace-use-take-done", Use(context.Background(), fake.actors(), choiceFor(t, SourceItemTake, nil)))
	pin(t, "workspace-use-take-started", Use(context.Background(), fake.actors(), choiceFor(t, SourceLaneRetake, nil)))
	stale := &fakeActors{setErr: errStale()}
	pin(t, "workspace-use-take-refused", Use(context.Background(), stale.actors(), choiceFor(t, SourceItemTake, nil)))
}
