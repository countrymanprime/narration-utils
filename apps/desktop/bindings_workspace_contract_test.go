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
