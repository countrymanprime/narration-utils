package main

import (
	"errors"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/daw"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

// markerFinding is a Transcript Compare MISREAD as the adapter writes it: kind in the evidence, what the script says
// and what was recorded, its item and take and its time inside the take's audio.
func markerFinding(id, itemGUID string, sourceStart *float64) findings.Finding {
	finding := audioFinding(id, itemGUID, sourceStart, sourceStart)
	finding.Manuscript.Expected, finding.Manuscript.Recorded = "pink eyes", "pink ice"
	finding.Evidence = map[string]any{"kind": "MISREAD"}
	return finding
}

// newMarkerHost is newNavigationHost's connected host over fake, holding accepted findings with an item and a time, with
// no item, and with no time, plus one still unreviewed.
func newMarkerHost(t *testing.T, fake *fakeNavigator) *Host {
	t.Helper()
	folder := t.TempDir()
	store := findings.NewStore(folder)
	if _, err := store.SaveAnalyzerFindings("transcript-compare", "chapter-1", []findings.Finding{
		markerFinding("accepted", navItem, seconds(12.5)),
		markerFinding("no-item", "", seconds(12.5)),
		markerFinding("no-time", navItem, nil),
		markerFinding("unreviewed", navItem, seconds(12.5)),
	}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"accepted", "no-item", "no-time"} {
		accept(t, store, id)
	}
	host := &Host{findings: store, reachability: liveReachability(), navigation: &findingNavigation{navigator: fake}}
	host.config.projectFolder = folder
	return host
}

func accept(t *testing.T, store *findings.Store, id string) {
	t.Helper()
	decide(t, store, id, findings.StatusAccepted)
}

func decide(t *testing.T, store *findings.Store, id string, status findings.Status) {
	t.Helper()
	if _, _, err := store.RecordDecision(id, "v1", status, "", "2026-09-23T10:00:00Z"); err != nil {
		t.Fatal(err)
	}
}

func TestAddMarkerSendsTheAcceptedFindingsSpotNameAndColourAndSaysWhatREAPERAdded(t *testing.T) {
	fake := &fakeNavigator{marker: bridge.MarkerResult{Added: true, TakeGUID: navTake, SourceTime: 12.5, Name: "MISREAD: 'pink eyes' as 'pink ice'"}}
	host := newMarkerHost(t, fake)

	got := bindingAnswer[FindingMarker](t)(host.FindingsAddMarker("accepted"))

	if got.Outcome != "added" || got.Name != "MISREAD: 'pink eyes' as 'pink ice'" || got.SourceTime == nil || *got.SourceTime != 12.5 || got.Reason != "" {
		t.Fatalf("got %+v", got)
	}
	target := fake.targets[0]
	if target.ItemGUID != navItem || target.TakeGUID != navTake || *target.SourceStart != 12.5 {
		t.Fatalf("sent %+v", target)
	}
	if want := (bridge.Marker{Name: "MISREAD: 'pink eyes' as 'pink ice'", Color: "FF4040"}); fake.markers[0] != want {
		t.Fatalf("marker %+v, want %+v", fake.markers[0], want)
	}
}

func TestAddMarkerSaysSoWhenTheTakeAlreadyHasOne(t *testing.T) {
	fake := &fakeNavigator{marker: bridge.MarkerResult{Added: false, TakeGUID: navTake, SourceTime: 12.5, Name: "MISREAD: exported earlier"}}
	host := newMarkerHost(t, fake)

	got := bindingAnswer[FindingMarker](t)(host.FindingsAddMarker("accepted"))

	if got.Outcome != "existing" || got.Name != "MISREAD: exported earlier" {
		t.Fatalf("got %+v", got)
	}
}

// Only a finding the narrator accepted gets a marker (findings-contract.md: a finding suggests, the narrator confirms),
// and one the host cannot place is refused: nothing is sent for either.
func TestAddMarkerRefusesAFindingThatIsNotAcceptedOrCannotBePlacedAndSendsNothing(t *testing.T) {
	fake := &fakeNavigator{}
	host := newMarkerHost(t, fake)
	store := host.services().findings

	checks := []struct{ id, reason string }{
		{"unreviewed", refusedNotAccepted},
		{"no-item", refusedNoItem},
		{"no-time", refusedNoSourceTime},
	}
	for _, status := range []findings.Status{findings.StatusDismissed, findings.StatusDeferred} {
		if _, err := store.SaveAnalyzerFindings("transcript-compare", string(status), []findings.Finding{markerFinding(string(status), navItem, seconds(1))}); err != nil {
			t.Fatal(err)
		}
		decide(t, store, string(status), status)
		checks = append(checks, struct{ id, reason string }{string(status), refusedNotAccepted})
	}
	for _, check := range checks {
		got := bindingAnswer[FindingMarker](t)(host.FindingsAddMarker(check.id))
		if got.Outcome != "refused" || got.Reason != check.reason || got.Message == "" || got.Name != "" {
			t.Fatalf("%s: got %+v", check.id, got)
		}
	}
	if sent := fake.sent(); len(sent) != 0 {
		t.Fatalf("sent %v", sent)
	}
}

func TestAddMarkerWithoutAListeningREAPERSendsNothing(t *testing.T) {
	for _, check := range []struct {
		name, connection string
		host             func(*Host)
	}{
		{"standalone", reaperStandalone, func(h *Host) { h.navigation.standalone = true }},
		{"not running", reaperNotRunning, func(h *Host) { h.reachability = daw.NewReachability(nil) }},
	} {
		fake := &fakeNavigator{}
		host := newMarkerHost(t, fake)
		check.host(host)
		got := bindingAnswer[FindingMarker](t)(host.FindingsAddMarker("accepted"))
		if got.Outcome != "refused" || got.Reason != check.connection || got.Message == "" {
			t.Fatalf("%s: got %+v", check.name, got)
		}
		if sent := fake.sent(); len(sent) != 0 {
			t.Fatalf("%s: sent %v", check.name, sent)
		}
	}
}

func TestWhatREAPERRefusesForAMarkerSaysNoMarkerWasAdded(t *testing.T) {
	for _, check := range []struct {
		err     error
		reason  string
		message string
	}{
		{&bridge.StaleError{GUID: navItem, Reason: "item"}, refusedStale, "no longer in the REAPER project, so no marker was added"},
		{&bridge.StaleError{GUID: navItem, Reason: "range"}, refusedStale, "trimmed or moved within), so no marker was added"},
		{bridge.ErrRecording, refusedRecording, "REAPER is recording, so no marker was added"},
		{bridge.ErrScriptOutdated, refusedScriptOutdated, "older than this app"},
		{bridge.ErrNoAnswer, reaperNotRunning, "not answering"},
		{errors.New("the disk is full"), refusedFailed, "the disk is full"},
	} {
		host := newMarkerHost(t, &fakeNavigator{err: check.err})
		got := bindingAnswer[FindingMarker](t)(host.FindingsAddMarker("accepted"))
		if got.Outcome != "refused" || got.Reason != check.reason || !strings.Contains(got.Message, check.message) || got.SourceTime != nil {
			t.Fatalf("%v: got %+v", check.err, got)
		}
	}
}

func TestAddMarkerOnAFindingTheProjectDoesNotHaveIsAnError(t *testing.T) {
	host := newMarkerHost(t, &fakeNavigator{})
	if _, err := host.FindingsAddMarker("missing"); !errors.Is(err, errFindingGone) {
		t.Fatalf("got %v", err)
	}
	empty := &Host{navigation: &findingNavigation{navigator: &fakeNavigator{}}, reachability: liveReachability()}
	if _, err := empty.FindingsAddMarker("accepted"); !errors.Is(err, errNoProject) {
		t.Fatalf("got %v", err)
	}
}

// The marker is named the way Transcript Compare names the one its export adds (compare.py: "KIND: 'script' as 'heard'",
// eight words at most), so the export's duplicate rule and the narrator both recognise it.
func TestApprovedMarkerNameAndColourFollowTheTranscriptCompareMarkers(t *testing.T) {
	store := settings.New(t.TempDir(), "")
	withText := func(kind any, category findings.Category, expected, recorded string) findings.Finding {
		finding := markerFinding("x", navItem, seconds(1))
		finding.Category, finding.Evidence = category, map[string]any{"kind": kind}
		finding.Manuscript.Expected, finding.Manuscript.Recorded = expected, recorded
		return finding
	}
	for _, check := range []struct {
		name    string
		finding findings.Finding
		want    bridge.Marker
	}{
		{"misread", withText("MISREAD", findings.CategoryTranscriptDiscrepancy, "pink eyes", "pink ice"), bridge.Marker{Name: "MISREAD: 'pink eyes' as 'pink ice'", Color: "FF4040"}},
		{"skipped", withText("SKIPPED", findings.CategoryTranscriptDiscrepancy, "Oh dear!", ""), bridge.Marker{Name: "SKIPPED: 'Oh dear!'", Color: "FFC000"}},
		{"extra", withText("extra", findings.CategoryTranscriptDiscrepancy, "", "and then"), bridge.Marker{Name: "EXTRA: 'and then'", Color: "40A0FF"}},
		{
			"long and ragged text",
			withText("MISREAD", findings.CategoryTranscriptDiscrepancy, "one two  three\nfour five six seven eight nine", "a"),
			bridge.Marker{Name: "MISREAD: 'one two three four five six seven eight ...' as 'a'", Color: "FF4040"},
		},
		{"no kind: the category", withText(nil, findings.CategoryPronunciation, "Antipathies", ""), bridge.Marker{Name: "PRONUNCIATION: 'Antipathies'"}},
		{"a kind that is not a word", withText("MIS READ", findings.CategoryPickup, "", ""), bridge.Marker{Name: "PICKUP: approved finding"}},
	} {
		if got := approvedMarker(check.finding, store); got != check.want {
			t.Fatalf("%s: got %+v, want %+v", check.name, got, check.want)
		}
	}
	if got := approvedMarker(withText("SKIPPED", findings.CategoryTranscriptDiscrepancy, "x", ""), nil); got.Color != "FFC000" {
		t.Fatalf("without settings: %+v", got)
	}
}
