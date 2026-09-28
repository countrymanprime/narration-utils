package main

import (
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
)

// What WorkspaceGoTo and WorkspaceLoop send (edit-and-proof-workspace PRD Phase 3), over workspaceNavigationHost's
// stored alignment (one item, one heard token and one never-heard token): every outcome the schema and the mock
// promise. REAPER's own refusals (stale, recording, no answer) go through the same refusal() the Review page's
// contract test (bindings_navigation_contract_test.go) already pins byte for byte, so they are not repeated here.
func TestContractWorkspaceNavigationBindings(t *testing.T) {
	fake := &fakeNavigator{
		navigate: bridge.Navigated{ItemGUID: "{ITEM-1}", ProjectTime: 5.5},
		loop:     bridge.LoopStarted{ItemGUID: "{ITEM-1}", Start: 0, End: 1.5},
	}
	host := workspaceNavigationHost(t, fake)

	check := func(name string, payload string, err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		checkBindingContract(t, name, payload)
	}

	payload, err := host.WorkspaceGoTo("c-0001", 0)
	check("workspace-go-to", payload, err)
	payload, err = host.WorkspaceLoop("c-0001", 0, 0)
	check("workspace-loop", payload, err)
	payload, err = host.WorkspaceGoTo("c-0001", 1)
	check("workspace-navigation-no-item", payload, err)
}

// What WorkspacePeaks sends (edit-and-proof-workspace PRD Phase 5, ADR 0520): one item's peaks over a real WAV
// source (workspacePeaksProject, bindings_workspace_peaks_test.go), and one item with no usable source, answering
// a Reason instead of an error.
func TestContractWorkspacePeaksBinding(t *testing.T) {
	host := coverageHost(t, workspacePeaksProject(t), true, fakeAlignedCoverageSidecar())
	if _, err := host.CoverageStart("c-0001", nil); err != nil {
		t.Fatal(err)
	}
	host.services().coverage.Wait()

	payload, err := host.WorkspacePeaks("c-0001")
	if err != nil {
		t.Fatal(err)
	}
	checkBindingContract(t, "workspace-peaks", payload)

	// coverageProject's own fixture (unmodified media/take.wav): a real file the tracks parser sees, but not one
	// measure.PeaksFile can decode - the item's answer is a Reason, not Peaks.
	unusable := coverageHost(t, coverageProject(t), true, fakeAlignedCoverageSidecar())
	if _, err := unusable.CoverageStart("c-0001", nil); err != nil {
		t.Fatal(err)
	}
	unusable.services().coverage.Wait()
	payload, err = unusable.WorkspacePeaks("c-0001")
	if err != nil {
		t.Fatal(err)
	}
	checkBindingContract(t, "workspace-peaks-no-source", payload)
}
