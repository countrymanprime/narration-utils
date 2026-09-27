package proofing

import (
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/stages"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

func markerItem(guid string, position float64, name string) tracks.Marker {
	return tracks.Marker{Index: 1, Name: name, Position: position, GUID: guid}
}

// TestMarkerSourceNeverRanWithoutAttributedMarkers is the guard against a
// false "done": a chapter the proofer never marked up with PICKUP: (or
// PICKUP_DONE:) markers must not vouch, even though a static read always
// "succeeds" once the project and mapping are readable.
func TestMarkerSourceNeverRanWithoutAttributedMarkers(t *testing.T) {
	p := newTestProject(t)
	p.project.Tracks[0].Items = []tracks.Item{audioItem("{ITEM-1}", "take.wav", 0, 10, 0)}

	source := markerSource(proofingChapter(), p.view())
	if source.Run.State != RunNever || len(source.Items) != 0 {
		t.Fatalf("source = %+v, want never run with no items", source)
	}
}

// TestMarkerSourceNeverRanWithNoPlayedItems: a chapter with no played audio at
// all has no span to attribute a marker to, so the source cannot vouch.
func TestMarkerSourceNeverRanWithNoPlayedItems(t *testing.T) {
	p := newTestProject(t)
	p.project.Markers = []tracks.Marker{markerItem("{M-1}", 1, "PICKUP: stray")}

	source := markerSource(proofingChapter(), p.view())
	if source.Run.State != RunNever {
		t.Fatalf("state = %q, want never (nothing plays, so nothing can be attributed)", source.Run.State)
	}
}

// TestMarkerSourceCurrentWithOpenMarker: an open PICKUP: marker inside the
// chapter's played span is current and counts as an open item.
func TestMarkerSourceCurrentWithOpenMarker(t *testing.T) {
	p := newTestProject(t)
	p.project.Tracks[0].Items = []tracks.Item{audioItem("{ITEM-1}", "take.wav", 0, 10, 0)}
	p.project.Markers = []tracks.Marker{markerItem("{M-1}", 5, "PICKUP: re-record the intro")}
	view := p.view()
	view.ProjectFile.ModTime = rollupNow

	source := markerSource(proofingChapter(), view)
	if source.Run.State != RunCurrent || !source.Run.At.Equal(rollupNow) {
		t.Fatalf("source.Run = %+v, want current at %v", source.Run, rollupNow)
	}
	if len(source.Items) != 1 || !source.Items[0].Open() || source.Items[0].Text != "re-record the intro" {
		t.Fatalf("items = %+v", source.Items)
	}
	if source.Items[0].FindingID != "reaper-marker:{M-1}" {
		t.Fatalf("FindingID = %q", source.Items[0].FindingID)
	}
}

// TestMarkerSourceCurrentWithOnlyDoneMarkers: every marker resolved (the done
// convention) still means the source ran for this chapter - it just has
// nothing open, so it can vouch (Q3 option A: markers alone may vouch).
func TestMarkerSourceCurrentWithOnlyDoneMarkers(t *testing.T) {
	p := newTestProject(t)
	p.project.Tracks[0].Items = []tracks.Item{audioItem("{ITEM-1}", "take.wav", 0, 10, 0)}
	p.project.Markers = []tracks.Marker{markerItem("{M-1}", 5, "PICKUP_DONE: fixed already")}

	source := markerSource(proofingChapter(), p.view())
	if source.Run.State != RunCurrent {
		t.Fatalf("state = %q, want current", source.Run.State)
	}
	if len(source.Items) != 0 {
		t.Fatalf("items = %+v, want none (the marker is done)", source.Items)
	}
}

// TestMarkerSourceIgnoresMarkersOutsideTheChapterSpanAndOtherNames: a marker
// before/after the chapter's played span, and a marker that is not the
// PICKUP: convention at all, count for nothing.
func TestMarkerSourceIgnoresMarkersOutsideTheChapterSpanAndOtherNames(t *testing.T) {
	p := newTestProject(t)
	p.project.Tracks[0].Items = []tracks.Item{audioItem("{ITEM-1}", "take.wav", 10, 10, 0)}
	p.project.Markers = []tracks.Marker{
		markerItem("{M-1}", 5, "PICKUP: too early"),
		markerItem("{M-2}", 25, "PICKUP: too late"),
		markerItem("{M-3}", 15, "Chapter marker, not a pickup"),
	}

	source := markerSource(proofingChapter(), p.view())
	if source.Run.State != RunNever || len(source.Items) != 0 {
		t.Fatalf("source = %+v, want never run (nothing attributed)", source)
	}
}

// TestMarkerSourcePropagatesTheChapterTrackProblem: an unmapped or unreadable
// project reports the same problem every other source reports, not "never".
func TestMarkerSourcePropagatesTheChapterTrackProblem(t *testing.T) {
	p := newTestProject(t)
	if err := p.mapping.Clear(testDocument, testTrack); err != nil {
		t.Fatal(err)
	}
	source := markerSource(proofingChapter(), p.view())
	if source.Run.State != RunUnknown || source.Run.Cause != stages.CauseUnmappedTrack {
		t.Fatalf("source.Run = %+v, want unknown/unmapped_track", source.Run)
	}
}

// TestMarkerSourceThroughTheProvider: registered as a Phase 1 source, an open
// marker makes the overall pickups signal not_met, naming the marker's text.
func TestMarkerSourceThroughTheProvider(t *testing.T) {
	p := newTestProject(t)
	p.project.Tracks[0].Items = []tracks.Item{audioItem("{ITEM-1}", "take.wav", 0, 10, 0)}
	p.project.Markers = []tracks.Marker{markerItem("{M-1}", 5, "PICKUP: re-record the intro")}

	provider := NewSignalProvider(Config{Findings: p.findings})
	signal := pickupsOf(t, provider, p.view())
	if signal.State != stages.SignalNotMet {
		t.Fatalf("state = %q (%s), want not_met", signal.State, signal.Reason)
	}
	found := false
	for _, entry := range signal.Evidence {
		if entry.Kind == EvidencePickup && entry.FindingID == "reaper-marker:{M-1}" {
			found = true
		}
	}
	if !found {
		t.Fatalf("evidence %+v missing the marker item", signal.Evidence)
	}
}

// TestMarkerSourceAloneCanVouch: with no Compare or take-review run at all, a
// current marker source with nothing open is enough to make the chapter met
// (Q3 option A: a narrator who proofs only by markers is not blocked on tools
// they never use).
func TestMarkerSourceAloneCanVouch(t *testing.T) {
	p := newTestProject(t)
	p.project.Tracks[0].Items = []tracks.Item{audioItem("{ITEM-1}", "take.wav", 0, 10, 0)}
	p.project.Markers = []tracks.Marker{markerItem("{M-1}", 5, "PICKUP_DONE: already fixed")}

	provider := NewSignalProvider(Config{Findings: p.findings})
	signal := pickupsOf(t, provider, p.view())
	if signal.State != stages.SignalMet {
		t.Fatalf("state = %q (%s), want met", signal.State, signal.Reason)
	}
}

func TestUnattributedPickupMarkersReportsMarkersOutsideEveryChapter(t *testing.T) {
	p := newTestProject(t)
	p.project.Tracks[0].Items = []tracks.Item{audioItem("{ITEM-1}", "take.wav", 0, 10, 0)}
	p.project.Markers = []tracks.Marker{
		markerItem("{M-1}", 5, "PICKUP: inside the chapter"),
		markerItem("{M-2}", 50, "PICKUP: outside every chapter"),
		markerItem("{M-3}", 60, "not a pickup marker"),
	}

	unattributed, err := UnattributedPickupMarkers(testDocument, p.view())
	if err != nil {
		t.Fatal(err)
	}
	if len(unattributed) != 1 || unattributed[0].GUID != "{M-2}" {
		t.Fatalf("unattributed = %+v, want only {M-2}", unattributed)
	}
}

func TestUnattributedPickupMarkersWithNoMappingStore(t *testing.T) {
	view := stages.EvidenceView{Project: tracks.Project{Markers: []tracks.Marker{markerItem("{M-1}", 5, "PICKUP: x")}}}
	unattributed, err := UnattributedPickupMarkers(testDocument, view)
	if err != nil || unattributed != nil {
		t.Fatalf("unattributed = %v, err = %v, want nil, nil", unattributed, err)
	}
}
