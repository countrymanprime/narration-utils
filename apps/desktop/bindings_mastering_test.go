package main

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/masteringport"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

// TestMasteringProvidersGoldenIsCurrent pins MasteringProviders' three answers on Windows: no project, a project that chose the
// built-in chain, and a project whose stored choice is the DAW row, which is not available yet (so it masters with the built-in
// chain, and says so). UPDATE_CONTRACTS=1 rewrites tests/fixtures/contracts/mastering-providers-*.json.
func TestMasteringProvidersGoldenIsCurrent(t *testing.T) {
	for _, c := range []struct {
		name       string
		hasProject bool
		choice     string
	}{
		{"mastering-providers-no-project", false, ""},
		{"mastering-providers-builtin-chosen", true, masteringport.Builtin},
		{"mastering-providers-daw-not-yet", true, masteringport.DAW},
	} {
		t.Run(c.name, func(t *testing.T) {
			raw, err := encodeBinding(masteringProvidersPayload(masteringport.Rows, "windows", c.hasProject, c.choice), nil)
			if err != nil {
				t.Fatalf("encode: %v", err)
			}
			var decoded map[string]any
			if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
				t.Fatalf("payload %q is not JSON: %v", raw, err)
			}
			contractfile.Check(t, c.name, decoded)
		})
	}
}

func decodeMasteringProviders(t *testing.T) func(raw string, err error) MasteringProvidersState {
	return func(raw string, err error) MasteringProvidersState {
		t.Helper()
		if err != nil {
			t.Fatalf("binding error = %v", err)
		}
		var state MasteringProvidersState
		if err := json.Unmarshal([]byte(raw), &state); err != nil {
			t.Fatalf("payload %q is not JSON: %v", raw, err)
		}
		return state
	}
}

func TestAProjectWithNoChoiceMastersWithTheBuiltInChain(t *testing.T) {
	host := previewSuggestHost(t, previewManuscriptOK)
	state := decodeMasteringProviders(t)(host.MasteringProviders())
	if !state.HasProject || state.Choice != nil || state.Effective != masteringport.Builtin || state.Notice != "" {
		t.Fatalf("state = %+v, want a project with no choice, mastering with builtin", state)
	}
	names := []string{}
	for _, p := range state.Providers {
		names = append(names, p.Name)
	}
	if !reflect.DeepEqual(names, []string{masteringport.Builtin, masteringport.DAW}) {
		t.Fatalf("providers = %v, want [builtin daw]", names)
	}
}

func TestChoosingAMasteringRowIsSavedOnTheProjectAndChecked(t *testing.T) {
	host := previewSuggestHost(t, previewManuscriptOK)

	state := decodeMasteringProviders(t)(host.MasteringChooseProvider(masteringport.Builtin))
	if state.Choice == nil || *state.Choice != masteringport.Builtin || state.Effective != masteringport.Builtin {
		t.Fatalf("after choosing builtin: %+v", state)
	}
	if value, source := host.settings.Effective(masteringSettingsTool, masteringProviderKey, ""); value != masteringport.Builtin || source != "project" {
		t.Fatalf("stored %q from %s, want builtin on the project", value, source)
	}

	// The DAW row is declared but not built: it cannot be chosen, and the choice already saved stays.
	_, err := host.MasteringChooseProvider(masteringport.DAW)
	var refusal *port.NotSupportedError
	if !errors.As(err, &refusal) || refusal.Support.Reason != port.ReasonNotYet || err.Error() == "" {
		t.Fatalf("choosing daw = %v, want a not_yet refusal with a sentence", err)
	}
	if _, err := host.MasteringChooseProvider("audacity"); !errors.Is(err, port.ErrNotSupported) {
		t.Fatalf("choosing an unknown row = %v, want a *port.NotSupportedError", err)
	}
	if value, _ := host.settings.Effective(masteringSettingsTool, masteringProviderKey, ""); value != masteringport.Builtin {
		t.Fatalf("a refused choice changed the stored one to %q", value)
	}

	state = decodeMasteringProviders(t)(host.MasteringChooseProvider(""))
	if state.Choice != nil || state.Effective != masteringport.Builtin {
		t.Fatalf("after clearing: %+v", state)
	}
	if _, source := host.settings.Effective(masteringSettingsTool, masteringProviderKey, ""); source != "hardcoded" {
		t.Fatalf("clearing left the row in the %s layer", source)
	}
}

func TestAStoredChoiceThatCannotRunFallsBackAndSaysSo(t *testing.T) {
	host := previewSuggestHost(t, previewManuscriptOK)
	daw := masteringport.DAW
	if err := host.settings.Save(masteringSettingsTool, "project", map[string]*string{masteringProviderKey: &daw}); err != nil {
		t.Fatal(err)
	}
	state := decodeMasteringProviders(t)(host.MasteringProviders())
	if state.Choice == nil || *state.Choice != masteringport.DAW || state.Effective != masteringport.Builtin || state.Notice == "" {
		t.Fatalf("state = %+v, want the daw choice kept, builtin effective, and a notice", state)
	}
}

func TestChoosingAMasteringRowNeedsAProject(t *testing.T) {
	host := NewHost()
	if _, err := host.MasteringChooseProvider(masteringport.Builtin); err == nil {
		t.Fatal("choosing without a project succeeded")
	}
	state := decodeMasteringProviders(t)(host.MasteringProviders())
	if state.HasProject || state.Choice != nil || state.Effective != masteringport.Builtin {
		t.Fatalf("state without a project = %+v", state)
	}
}
