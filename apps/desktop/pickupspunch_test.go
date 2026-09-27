package main

import (
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

func TestPickupsPunchMovesTheCursorToThePickupsPositionMinusPreRoll(t *testing.T) {
	t.Setenv("APPDATA", filepath.Join(t.TempDir(), "appdata"))
	puncher := &fakePuncherStub{cursor: 10 - defaultPunchPreRoll}
	host := &Host{}
	host.settings = settings.New("", "")
	host.dawPortResolver = dawport.NewResolver(dawport.ResolverConfig{Adapter: fakePuncherAdapter{puncher: puncher}})

	raw, err := host.PickupsPunch(10)
	if err != nil {
		t.Fatal(err)
	}
	var result PickupsPunchResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	if result.Outcome != "punched" || result.Cursor == nil || *result.Cursor != puncher.cursor {
		t.Fatalf("PickupsPunch = %+v", result)
	}
	if !puncher.called || puncher.gotWordTime != 10 || puncher.gotPreRoll != defaultPunchPreRoll {
		t.Fatalf("PunchTo(%v, %v), want (10, %v)", puncher.gotWordTime, puncher.gotPreRoll, defaultPunchPreRoll)
	}
}

func TestPickupsPunchIsRefusedWithNoDawConnection(t *testing.T) {
	host := &Host{}
	host.settings = settings.New("", "")
	// dawPortResolver stays nil: no bridge at all.

	raw, err := host.PickupsPunch(10)
	if err != nil {
		t.Fatal(err)
	}
	var result PickupsPunchResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	if result.Outcome != "refused" || result.Cursor != nil {
		t.Fatalf("PickupsPunch = %+v, want a refusal that moved nothing", result)
	}
}

func decodedPickupsPunch(t *testing.T, raw string, err error) PickupsPunchResult {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
	var result PickupsPunchResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

// The binding's answers, pinned for the UI's schema (ADR 0069): one of each outcome.
func TestContractPickupsPunchResults(t *testing.T) {
	t.Setenv("APPDATA", filepath.Join(t.TempDir(), "appdata"))
	answers := map[string]PickupsPunchResult{}

	punched := &Host{}
	punched.settings = settings.New("", "")
	punched.dawPortResolver = dawport.NewResolver(dawport.ResolverConfig{Adapter: fakePuncherAdapter{puncher: &fakePuncherStub{cursor: 7}}})
	punchedRaw, punchedErr := punched.PickupsPunch(10)
	answers["punched"] = decodedPickupsPunch(t, punchedRaw, punchedErr)

	refused := &Host{}
	refused.settings = settings.New("", "")
	refusedRaw, refusedErr := refused.PickupsPunch(10)
	answers["refused_no_daw"] = decodedPickupsPunch(t, refusedRaw, refusedErr)

	contractfile.Check(t, "pickups-punch-results", answers)
}
