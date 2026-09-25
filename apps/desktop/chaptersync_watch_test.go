package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/daw"
)

// Watching the saved .rpp (daw-chapter-track-auto-sync PRD Phase 4, S6 A and B, S12). The tests drive
// chapterSyncWatchTick with their own clock, so the debounce is exact and nothing sleeps.

// chapterThreeTrack is a track saved in REAPER for the next chapter: "Ch. 3" names Chapter III confidently both ways.
const chapterThreeTrack = `  <TRACK {44444444-4444-4444-8444-444444444444}
    NAME "Ch. 3"
    TRACKID {44444444-4444-4444-8444-444444444444}
  >
`

// saveRpp rewrites the fixture's .rpp as REAPER's save would, with extra tracks before the closing line, and stamps its
// modification time.
func saveRpp(t *testing.T, f syncHost, modified time.Time, extraTracks string) {
	t.Helper()
	path := filepath.Join(f.host.config.projectFolder, "Alice.rpp")
	body := strings.TrimSuffix(chapterTracksRpp, ">\n") + extraTracks + ">\n"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, modified, modified); err != nil {
		t.Fatal(err)
	}
}

func (f syncHost) eventCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(*f.events)
}

func newWatchedSyncHost(t *testing.T) (syncHost, time.Time) {
	t.Helper()
	f := newSyncHost(t, true)
	start := time.Date(2026, 9, 25, 12, 0, 0, 0, time.UTC)
	saveRpp(t, f, start.Add(-time.Minute), "")
	if _, err := f.host.chapterSyncSetEnabled(true); err != nil {
		t.Fatal(err)
	}
	return f, start
}

func TestTheWatcherLinksANewTrackOnceTheSavedProjectSettles(t *testing.T) {
	f, start := newWatchedSyncHost(t)
	f.host.chapterSyncWatchTick(start) // the first look is the baseline: it syncs nothing
	before := f.eventCount()

	saveRpp(t, f, start.Add(time.Second), chapterThreeTrack)
	f.host.chapterSyncWatchTick(start.Add(2 * time.Second))
	f.host.chapterSyncWatchTick(start.Add(3 * time.Second))
	if f.eventCount() != before {
		t.Fatal("synced before the debounce ran out")
	}

	f.host.chapterSyncWatchTick(start.Add(4 * time.Second))

	if f.eventCount() != before+1 {
		t.Fatalf("events = %d, want one sync after the debounce", f.eventCount()-before)
	}
	event := f.lastEvent(t)
	if event.Batch == nil || event.Batch.Trigger != syncTriggerWatch || len(event.Batch.Linked) != 1 || event.Batch.Linked[0].ChapterID != f.ids[2] {
		t.Fatalf("batch = %+v", event.Batch)
	}
	if got := f.links(t)["{44444444-4444-4444-8444-444444444444}"]; got != f.ids[2]+"/auto" {
		t.Fatalf("Ch. 3 link = %q", got)
	}
	if len(event.Activity) == 0 || event.Activity[0].Trigger != syncTriggerWatch {
		t.Fatalf("activity = %+v", event.Activity)
	}

	// Nothing changed since: no further sync, however long it waits.
	f.host.chapterSyncWatchTick(start.Add(10 * time.Second))
	if f.eventCount() != before+1 {
		t.Fatal("synced again with nothing changed")
	}
}

func TestAnotherSaveDuringTheDebounceWaitsForTheLastOne(t *testing.T) {
	f, start := newWatchedSyncHost(t)
	f.host.chapterSyncWatchTick(start)
	before := f.eventCount()

	saveRpp(t, f, start.Add(time.Second), "")
	f.host.chapterSyncWatchTick(start.Add(2 * time.Second))
	saveRpp(t, f, start.Add(3*time.Second), chapterThreeTrack)
	f.host.chapterSyncWatchTick(start.Add(3500 * time.Millisecond))
	if f.eventCount() != before {
		t.Fatal("synced while the project was still being saved")
	}
	f.host.chapterSyncWatchTick(start.Add(5 * time.Second))

	if f.eventCount() != before+1 || f.lastEvent(t).Batch == nil {
		t.Fatalf("want one sync with a batch, got %d events", f.eventCount()-before)
	}
}

func TestTheWatcherDoesNothingWithoutConsent(t *testing.T) {
	f := newSyncHost(t, true)
	start := time.Date(2026, 9, 25, 12, 0, 0, 0, time.UTC)
	saveRpp(t, f, start.Add(-time.Minute), "")
	if _, err := f.host.chapterSyncSetEnabled(false); err != nil {
		t.Fatal(err)
	}
	f.host.chapterSyncWatchTick(start)
	before := f.eventCount()

	saveRpp(t, f, start.Add(time.Second), chapterThreeTrack)
	f.host.chapterSyncWatchTick(start.Add(2 * time.Second))
	f.host.chapterSyncWatchTick(start.Add(5 * time.Second))

	if f.eventCount() != before {
		t.Fatal("a project that said Not now was synced")
	}
	if links := f.links(t); len(links) != 0 {
		t.Fatalf("links = %v", links)
	}
}

func TestREAPERsEditCounterSaysThereAreUnsavedChanges(t *testing.T) {
	f, start := newWatchedSyncHost(t)
	reach := daw.NewReachability(nil)
	f.host.mu.Lock()
	f.host.reachability = reach
	f.host.mu.Unlock()
	rpp := filepath.Join(f.host.config.projectFolder, "Alice.rpp")
	heartbeat := func(count string) {
		reach.Record(bridge.Event{Fields: []string{"PROJECT_STATUS", "", rpp, "0", count}})
	}

	heartbeat("5")
	f.host.chapterSyncWatchTick(start)
	if f.state(t).UnsavedEdits {
		t.Fatal("the first count is the baseline, not an edit")
	}
	before := f.eventCount()

	heartbeat("7")
	f.host.chapterSyncWatchTick(start.Add(2 * time.Second))

	if f.eventCount() != before+1 || !f.lastEvent(t).UnsavedEdits {
		t.Fatalf("the counter moved and no event said so (events %d)", f.eventCount()-before)
	}
	if f.lastEvent(t).Batch != nil {
		t.Fatal("an unsaved edit synced; only a save re-reads the project")
	}
	f.host.chapterSyncWatchTick(start.Add(4 * time.Second))
	if f.eventCount() != before+1 {
		t.Fatal("told the UI twice about the same unsaved edit")
	}

	// The narrator saves: the sync that follows clears it.
	saveRpp(t, f, start.Add(5*time.Second), chapterThreeTrack)
	heartbeat("8")
	f.host.chapterSyncWatchTick(start.Add(6 * time.Second))
	f.host.chapterSyncWatchTick(start.Add(8 * time.Second))

	if last := f.lastEvent(t); last.UnsavedEdits || last.Batch == nil {
		t.Fatalf("after the save: %+v", last)
	}
}

func TestACounterFromAnotherProjectSaysNothing(t *testing.T) {
	f, start := newWatchedSyncHost(t)
	reach := daw.NewReachability(nil)
	f.host.mu.Lock()
	f.host.reachability = reach
	f.host.mu.Unlock()
	other := filepath.Join(t.TempDir(), "Other.rpp")

	reach.Record(bridge.Event{Fields: []string{"PROJECT_STATUS", "", other, "0", "5"}})
	f.host.chapterSyncWatchTick(start)
	reach.Record(bridge.Event{Fields: []string{"PROJECT_STATUS", "", other, "0", "9"}})
	f.host.chapterSyncWatchTick(start.Add(2 * time.Second))

	if f.state(t).UnsavedEdits {
		t.Fatal("REAPER's edits to another project were reported as this one's")
	}
}
