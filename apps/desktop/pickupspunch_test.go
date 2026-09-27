package main

import (
	"encoding/json"
	"path/filepath"
	"testing"

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
