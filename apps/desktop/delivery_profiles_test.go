package main

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
	projectmanifest "github.com/countrymanprime/narration-utils/shell/internal/project"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

// The delivery-profile bindings (delivery-platform-profiles.prd.md Phases 2 and 4, ADR 0179): the profiles and the
// choices, a choice per scope, and a custom profile's duplicate, edit and delete.

func profileHost(t *testing.T) (*Host, string) {
	t.Helper()
	t.Setenv("APPDATA", t.TempDir())
	project := t.TempDir()
	return withProfileStore(t, &Host{config: config{projectFolder: project, projectName: "Alice"}, settings: settings.New(t.TempDir(), project)}), project
}

// answered checks a binding answered without an error and decodes its answer.
func answered[T any](t *testing.T) func(text string, err error) T {
	t.Helper()
	return func(text string, err error) T {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		var value T
		if err := json.Unmarshal([]byte(text), &value); err != nil {
			t.Fatal(err)
		}
		return value
	}
}

func TestANewProjectIsJudgedAgainstACXWithNoChoiceSaved(t *testing.T) {
	host, project := profileHost(t)
	state := answered[DeliveryProfilesState](t)(host.DeliveryProfiles())
	if state.ProjectProfile != "acx@2026-09" || state.ProjectChoice != nil || !state.HasProject || state.GlobalDefault.ID != "acx" || len(state.Profiles) != 1 {
		t.Fatalf("state = %+v", state)
	}
	if _, ok, _ := projectmanifest.Load(nil, project); ok {
		t.Fatal("reading the profiles wrote a manifest")
	}
}

func TestChoosingAProfilePerScope(t *testing.T) {
	host, project := profileHost(t)
	copied := answered[deliveryprofile.Profile](t)(host.DeliveryDuplicateProfile("acx", "2026-09"))
	state := answered[DeliveryProfilesState](t)(host.DeliverySelectProfile("global", copied.ID, ""))
	if state.GlobalDefault.ID != copied.ID || state.ProjectProfile != copied.Key() || state.ProjectChoice != nil {
		t.Fatalf("after choosing the Global default: %+v", state)
	}
	state = answered[DeliveryProfilesState](t)(host.DeliverySelectProfile("project", "acx", "2026-09"))
	if state.ProjectChoice == nil || *state.ProjectChoice != (deliveryprofile.Ref{ID: "acx", Version: "2026-09"}) || state.ProjectProfile != "acx@2026-09" {
		t.Fatalf("after choosing ACX for the project: %+v", state)
	}
	manifest, ok, _ := projectmanifest.Load(nil, project)
	if !ok || manifest.DeliveryProfile == nil || manifest.DeliveryProfile.ID != "acx" || manifest.DeliveryProfile.Version != "2026-09" {
		t.Fatalf("manifest = %+v", manifest)
	}
	state = answered[DeliveryProfilesState](t)(host.DeliverySelectProfile("project", "", ""))
	if state.ProjectChoice != nil || state.ProjectProfile != copied.Key() {
		t.Fatalf("after clearing the project's choice: %+v, want the Global default", state)
	}
	for _, refused := range []struct{ scope, id string }{{"project", "missing"}, {"global", "missing"}, {"book", "acx"}} {
		if _, err := host.DeliverySelectProfile(refused.scope, refused.id, ""); err == nil {
			t.Errorf("DeliverySelectProfile(%s, %s) was accepted", refused.scope, refused.id)
		}
	}
	if _, err := (&Host{}).DeliverySelectProfile("project", "acx", ""); err == nil || !strings.Contains(err.Error(), "open a project") {
		t.Fatalf("without a project: %v", err)
	}
}

func TestSavingACustomProfileFromTheEditorAndDeletingIt(t *testing.T) {
	host, _ := profileHost(t)
	copied := answered[deliveryprofile.Profile](t)(host.DeliveryDuplicateProfile("acx", ""))
	rules := []map[string]any{}
	for _, rule := range copied.Rules {
		edit := map[string]any{"id": rule.ID, "off": rule.ID == "acx.room_tone_head", "min": rule.Min, "max": rule.Max}
		if rule.ID == "acx.peak" {
			edit["max"] = -3.5
		}
		rules = append(rules, edit)
	}
	body, _ := json.Marshal(map[string]any{"id": copied.ID, "name": "My ACX, tighter peak", "rules": rules})
	saved := answered[deliveryprofile.Profile](t)(host.DeliverySaveProfile(string(body)))
	peak, _ := saved.Rule("acx.peak")
	head, _ := saved.Rule("acx.room_tone_head")
	if saved.Name != "My ACX, tighter peak" || saved.Revision != 2 || *peak.Max != -3.5 || !head.Off {
		t.Fatalf("saved = %+v", saved)
	}
	for _, refused := range []string{`{"id":"acx","name":"ACX","rules":[]}`, `not json`, `{"id":"` + copied.ID + `","name":"x","rules":[]}`, strings.Repeat(" ", maxProfileEditBytes+1)} {
		if _, err := host.DeliverySaveProfile(refused); err == nil {
			t.Errorf("DeliverySaveProfile(%.40q) was accepted", refused)
		}
	}
	state := answered[DeliveryProfilesState](t)(host.DeliveryDeleteProfile(saved.ID))
	if len(state.Profiles) != 1 {
		t.Fatalf("after deleting: %d profiles", len(state.Profiles))
	}
	if _, err := host.DeliveryDeleteProfile("acx"); err == nil {
		t.Fatal("ACX was deleted")
	}
}

// What DeliveryProfiles, DeliveryDuplicateProfile and DeliverySaveProfile send: every profile with the project's choice,
// and a custom profile. The custom profile's id is random, so the pinned one is fixed here.
func TestContractDeliveryProfiles(t *testing.T) {
	host, _ := profileHost(t)
	copied := answered[deliveryprofile.Profile](t)(host.DeliveryDuplicateProfile("acx", "2026-09"))
	if _, err := host.DeliverySelectProfile("project", "acx", "2026-09"); err != nil {
		t.Fatal(err)
	}
	state, err := host.deliveryProfilesState()
	if err != nil {
		t.Fatal(err)
	}
	const pinnedID = "custom-0123456789abcdef"
	for i := range state.Profiles {
		if state.Profiles[i].ID == copied.ID {
			state.Profiles[i].ID = pinnedID
		}
	}
	contractfile.Check(t, "delivery-profiles", state)
	custom := copied.Clone()
	custom.ID, custom.Name, custom.Revision = pinnedID, "My ACX, tighter peak", 2
	*custom.Rules[1].Max = -3.5
	custom.Rules[5].Off = true
	contractfile.Check(t, "delivery-profile-saved", custom)
	contractfile.Check(t, "delivery-profiles-no-project", DeliveryProfilesState{
		Profiles: deliveryprofile.BuiltIns(), GlobalDefault: deliveryprofile.Ref{ID: "acx", Version: "2026-09"}, ProjectProfile: "acx@2026-09",
		Notice: "Your custom delivery profiles could not be read (your delivery profiles file could not be read); the built-in profiles still work.",
	})
}
