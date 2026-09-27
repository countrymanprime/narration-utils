package main

import (
	"context"
	"errors"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport/dawporttest"
)

const trackSelectGUID = "{00000009-0000-4000-8000-000000000009}"

// fakeSelector stands in for bridge.Actions' TrackSelector role (its own tests drive a fake REAPER through the file
// protocol, and the Lua harness the command).
type fakeSelector struct {
	guid string
	err  error
}

var _ dawport.TrackSelector = (*fakeSelector)(nil)

func (f *fakeSelector) SelectTrack(_ context.Context, guid string) (bridge.SelectedTrack, error) {
	f.guid = guid
	if f.err != nil {
		return bridge.SelectedTrack{}, f.err
	}
	return bridge.SelectedTrack{TrackGUID: guid}, nil
}

func connectedServices() hostServices {
	var host Host
	host.reachability = liveReachability()
	host.navigation = &findingNavigation{navigator: &fakeNavigator{}}
	return host.services()
}

func TestTrackSelectInReaperSelectsTheTrack(t *testing.T) {
	fake := &fakeSelector{}
	result, err := trackSelectInReaperIn(context.Background(), connectedServices(), fake, trackSelectGUID)
	if err != nil {
		t.Fatal(err)
	}
	if fake.guid != trackSelectGUID {
		t.Fatalf("selected %q, want %q", fake.guid, trackSelectGUID)
	}
	if result.Outcome != "selected" || result.TrackGUID != trackSelectGUID {
		t.Fatalf("result = %+v", result)
	}
}

func TestTrackSelectInReaperWithNoTrackIsAnError(t *testing.T) {
	if _, err := trackSelectInReaperIn(context.Background(), connectedServices(), &fakeSelector{}, ""); err == nil {
		t.Fatal("want an error with no track GUID")
	}
}

func TestTrackSelectInReaperIsStandaloneWithoutAReaperSession(t *testing.T) {
	result, err := trackSelectInReaperIn(context.Background(), hostServices{}, &fakeSelector{}, trackSelectGUID)
	if err != nil {
		t.Fatal(err)
	}
	if result.Outcome != "refused" || result.Reason != reaperStandalone {
		t.Fatalf("result = %+v", result)
	}
}

func TestTrackSelectInReaperWithNoSelectorIsExperimentalOff(t *testing.T) {
	// A nil *fakeSelector must reach trackSelectInReaperIn as a true nil dawport.TrackSelector, not a typed nil in a
	// non-nil interface (which would pass its `selector == nil` check and then panic on the fake's nil receiver).
	var selector dawport.TrackSelector
	result, err := trackSelectInReaperIn(context.Background(), connectedServices(), selector, trackSelectGUID)
	if err != nil {
		t.Fatal(err)
	}
	if result.Outcome != "refused" || result.Reason != readAloudExperimentalOff {
		t.Fatalf("result = %+v", result)
	}
}

func TestTrackSelectInReaperReportsAStaleTrack(t *testing.T) {
	fake := &fakeSelector{err: &bridge.TrackStaleError{GUID: trackSelectGUID}}
	result, err := trackSelectInReaperIn(context.Background(), connectedServices(), fake, trackSelectGUID)
	if err != nil {
		t.Fatal(err)
	}
	if result.Outcome != "refused" || result.Reason != readAloudTrackMissing {
		t.Fatalf("result = %+v", result)
	}
}

func TestTrackSelectorFromComesFromTheResolver(t *testing.T) {
	fake := dawporttest.NewFake(dawport.KindREAPER, dawporttest.Levels(dawport.Supported))
	resolver := dawport.NewResolver(dawport.ResolverConfig{
		Adapter: fake,
		Runtime: func() dawport.Runtime { return dawport.Runtime{Bridge: true, Reachable: true} },
	})

	selector := trackSelectorFrom(hostServices{dawPortResolver: resolver})
	if selector == nil {
		t.Fatal("selector = nil, want the fake's role")
	}
	if _, err := selector.SelectTrack(context.Background(), trackSelectGUID); err != nil {
		t.Fatal(err)
	}
	if calls := fake.Calls(); len(calls) != 1 || calls[0] != "track_select.SelectTrack" {
		t.Fatalf("the selector did not come from the resolver: calls = %v", calls)
	}
}

func TestTrackSelectorFromIsNilWithoutAResolver(t *testing.T) {
	if selector := trackSelectorFrom(hostServices{}); selector != nil {
		t.Fatalf("selector = %v, want nil with no resolver", selector)
	}
}

func TestTrackSelectInReaperAnswerIsJSON(t *testing.T) {
	appData := t.TempDir()
	t.Setenv("APPDATA", appData)
	t.Setenv("USERPROFILE", appData)
	host := NewHost()
	raw, err := host.TrackSelectInReaper(trackSelectGUID)
	if err != nil {
		t.Fatal(err)
	}
	if raw == "" {
		t.Fatal("TrackSelectInReaper answered an empty payload")
	}
}

// The binding's answers, pinned for the UI's schema: one selected case and every refusal reason
// (apps/ui/src/api/schemas/chapterTrackMap.ts's trackSelectResultSchema).
func TestContractTrackSelectResults(t *testing.T) {
	answers := map[string]TrackSelectResult{}
	record := func(name string, svc hostServices, selector dawport.TrackSelector) {
		t.Helper()
		result, err := trackSelectInReaperIn(context.Background(), svc, selector, trackSelectGUID)
		if err != nil {
			t.Fatal(err)
		}
		answers[name] = result
	}
	record("selected", connectedServices(), &fakeSelector{})
	record("track_missing", connectedServices(), &fakeSelector{err: &bridge.TrackStaleError{GUID: trackSelectGUID}})
	record("experimental_off", connectedServices(), nil)
	record("standalone", hostServices{}, &fakeSelector{})
	record("failed", connectedServices(), &fakeSelector{err: errors.New("boom")})
	contractfile.Check(t, "track-select-results", answers)
}
