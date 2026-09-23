package main

import (
	"encoding/json"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

// What FindingsAddMarker sends (review dashboard Phase 8), over a finding the real Transcript Compare adapter writes
// (contractReviewHost) once the narrator accepted it: added, already there, and the refusal the page words for itself
// (not accepted) and a REAPER one (stale). REAPER's side is a fake navigator; bridge.Navigator's own tests pin the file
// protocol.
func TestContractFindingsAddMarkerBinding(t *testing.T) {
	host := contractReviewHost(t)
	var page findings.Page
	if listed, err := host.FindingsList(FindingsQuery{Analyzer: "transcript-compare", Sort: "time", Limit: 2}); err != nil {
		t.Fatal(err)
	} else if err := json.Unmarshal([]byte(listed), &page); err != nil || len(page.Findings) != 2 {
		t.Fatalf("first transcript findings: %v %s", err, listed)
	}
	accepted, unreviewed := page.Findings[0], page.Findings[1]
	if _, err := host.FindingsReview(accepted.ID, accepted.EvidenceVersion, "accepted", ""); err != nil {
		t.Fatal(err)
	}
	name := approvedMarker(accepted, nil).Name
	fake := &fakeNavigator{marker: bridge.MarkerResult{Added: true, TakeGUID: accepted.Source.TakeGUID, SourceTime: *accepted.TimeRange.SourceStart, Name: name}}
	host.navigation = &findingNavigation{navigator: fake}
	host.reachability = liveReachability()

	check := func(golden string, payload string, err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		checkBindingContract(t, golden, payload)
	}
	payload, err := host.FindingsAddMarker(accepted.ID)
	check("findings-add-marker", payload, err)
	fake.marker.Added = false
	payload, err = host.FindingsAddMarker(accepted.ID)
	check("findings-add-marker-existing", payload, err)
	payload, err = host.FindingsAddMarker(unreviewed.ID)
	check("findings-add-marker-not-accepted", payload, err)
	fake.err = &bridge.StaleError{GUID: accepted.Source.ItemGUID, Reason: "item"}
	payload, err = host.FindingsAddMarker(accepted.ID)
	check("findings-add-marker-stale", payload, err)
}
