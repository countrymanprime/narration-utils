package main

import (
	"encoding/json"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/daw"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

// What FindingsReaperStatus, FindingsGoTo, FindingsLoop and FindingsStopLoop send (review dashboard Phase 7), over the
// findings the real Transcript Compare adapter writes (contractReviewHost): every outcome, and every refusal the Review
// page words differently. REAPER's side is a fake navigator; bridge.Navigator's own tests pin the file protocol.
func TestContractFindingsNavigationBindings(t *testing.T) {
	host := contractReviewHost(t)
	var page findings.Page
	if listed, err := host.FindingsList(FindingsQuery{Analyzer: "transcript-compare", Sort: "time", Limit: 1}); err != nil {
		t.Fatal(err)
	} else if err := json.Unmarshal([]byte(listed), &page); err != nil || len(page.Findings) != 1 {
		t.Fatalf("first transcript finding: %v %s", err, listed)
	}
	id := page.Findings[0].ID
	fake := &fakeNavigator{
		navigate: bridge.Navigated{ItemGUID: page.Findings[0].Source.ItemGUID, ProjectTime: 100.34},
		loop:     bridge.LoopStarted{ItemGUID: page.Findings[0].Source.ItemGUID, Start: 98.34, End: 102.34},
		stop:     bridge.LoopStopped{Restored: 3, Kept: 0},
	}
	host.navigation = &findingNavigation{navigator: fake}
	host.reachability = liveReachability()

	check := func(name string, payload string, err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		checkBindingContract(t, name, payload)
	}
	goTo := func() (string, error) { return host.FindingsGoTo(id) }

	payload, err := goTo()
	check("findings-go-to", payload, err)
	payload, err = host.FindingsLoop(id)
	check("findings-loop", payload, err)
	payload, err = host.FindingsReaperStatus()
	check("findings-reaper-status-looping", payload, err)
	payload, err = host.FindingsStopLoop()
	check("findings-stop-loop", payload, err)

	fake.err = &bridge.StaleError{GUID: page.Findings[0].Source.ItemGUID, Reason: "item"}
	payload, err = goTo()
	check("findings-navigation-stale", payload, err)
	fake.err = bridge.ErrRecording
	payload, err = goTo()
	check("findings-navigation-recording", payload, err)
	fake.err = nil

	withoutItem := page.Findings[0]
	withoutItem.ID, withoutItem.Source.ItemGUID = "from-an-older-comparison", ""
	if _, err := host.services().findings.SaveAnalyzerFindings("transcript-compare", "older-run", []findings.Finding{withoutItem}); err != nil {
		t.Fatal(err)
	}
	payload, err = host.FindingsGoTo(withoutItem.ID)
	check("findings-navigation-no-item", payload, err)

	host.reachability = daw.NewReachability(nil)
	payload, err = host.FindingsReaperStatus()
	check("findings-reaper-status-not-running", payload, err)
	payload, err = goTo()
	check("findings-navigation-not-running", payload, err)

	host.navigation.standalone = true
	payload, err = host.FindingsReaperStatus()
	check("findings-reaper-status-standalone", payload, err)
}
