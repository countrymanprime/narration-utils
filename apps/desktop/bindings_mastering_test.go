package main

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/masteringport"
	"github.com/countrymanprime/narration-utils/shell/internal/masteringport/masteringporttest"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

// TestMasteringProvidersGoldenIsCurrent pins MasteringProviders' four answers on Windows: no project, a project that chose the
// built-in chain, a project that chose the DAW row (Experimental since render-encode-master Phase 9, so it masters with it), and a
// project whose stored choice this version does not have (so it masters with the built-in chain, and says so).
// UPDATE_CONTRACTS=1 rewrites tests/fixtures/contracts/mastering-providers-*.json.
func TestMasteringProvidersGoldenIsCurrent(t *testing.T) {
	for _, c := range []struct {
		name       string
		hasProject bool
		choice     string
	}{
		{"mastering-providers-no-project", false, ""},
		{"mastering-providers-builtin-chosen", true, masteringport.Builtin},
		{"mastering-providers-daw-chosen", true, masteringport.DAW},
		{"mastering-providers-unknown-choice", true, "audacity"},
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

	// The DAW row is Experimental: it can be chosen, and masters with the DAW's FX once the narrator approves each render.
	state = decodeMasteringProviders(t)(host.MasteringChooseProvider(masteringport.DAW))
	if state.Choice == nil || *state.Choice != masteringport.DAW || state.Effective != masteringport.DAW || state.Notice != "" {
		t.Fatalf("after choosing daw: %+v", state)
	}
	state = decodeMasteringProviders(t)(host.MasteringChooseProvider(masteringport.Builtin))
	if state.Effective != masteringport.Builtin {
		t.Fatalf("after choosing builtin again: %+v", state)
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
	gone := "audacity"
	if err := host.settings.Save(masteringSettingsTool, "project", map[string]*string{masteringProviderKey: &gone}); err != nil {
		t.Fatal(err)
	}
	state := decodeMasteringProviders(t)(host.MasteringProviders())
	if state.Choice == nil || *state.Choice != gone || state.Effective != masteringport.Builtin || state.Notice == "" {
		t.Fatalf("state = %+v, want the stored choice kept, builtin effective, and a notice", state)
	}

	// A row that is registered but not available yet falls back the same way, with its own sentence.
	notYet := port.Entry[masteringport.Mastering]{Name: "later", Descriptor: port.Descriptor{Label: "Later chain", Modes: []string{masteringport.ModeWAV}},
		New: func() masteringport.Mastering { return notYetRow{} }}
	rows := masteringport.NewRegistry()
	rows.Register(masteringporttest.NewFake("fake", false).Entry())
	rows.Register(notYet)
	state = masteringProvidersPayload(rows, "windows", true, "later")
	if state.Effective != "fake" || state.Notice != "Later chain is not available yet. This project masters with the default, Fake chain (a copy), until then." {
		t.Fatalf("state = %+v, want the default and the not-yet sentence", state)
	}
}

// notYetRow is a declared, unbuilt row.
type notYetRow struct{}

func (notYetRow) Name() string { return "later" }
func (notYetRow) Capabilities() masteringport.Capabilities {
	return masteringport.Capabilities{Level: port.NotYetAvailable}
}
func (notYetRow) Master(context.Context, masteringport.Request) (masteringport.Result, error) {
	return masteringport.Result{}, masteringport.NotYetAvailable("later", "Later chain")
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
