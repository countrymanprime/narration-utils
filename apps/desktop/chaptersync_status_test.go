package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
)

// Status without a click (daw-chapter-track-auto-sync PRD Phase 6, S14): chaptersync:state carries, for every narration
// chapter, its link, whether its recording check is current, stale (with the reasons) or never run, and when its track
// last changed. Reading it never starts a check (Q14).

func chapterRow(t *testing.T, state chapterSyncState, chapterID string) chapterSyncChapter {
	t.Helper()
	for _, row := range state.Chapters {
		if row.ChapterID == chapterID {
			return row
		}
	}
	t.Fatalf("no row for %s in %+v", chapterID, state.Chapters)
	return chapterSyncChapter{}
}

func TestEachChapterSaysWhetherItsCheckIsCurrentWithoutAClick(t *testing.T) {
	project := coverageProject(t)
	host := coverageHost(t, project, true, fakeCoverageSidecar(8))
	source := filepath.Join(project, "media", "take.wav")
	recorded := time.Date(2026, 9, 25, 9, 30, 0, 0, time.UTC)
	if err := os.Chtimes(source, recorded, recorded); err != nil {
		t.Fatal(err)
	}

	state, err := host.chapterSyncState()
	if err != nil {
		t.Fatal(err)
	}
	row := chapterRow(t, state, "c-0001")
	if row.TrackGUID != "{TRACK-1}" || row.TrackName != "Chapter One" || row.Origin != "manual" {
		t.Fatalf("link = %+v", row)
	}
	if row.Freshness != "never" || row.CheckedAt != nil || row.Checking {
		t.Fatalf("a chapter never checked: %+v", row)
	}
	if row.NewestSourceAt == nil || !row.NewestSourceAt.Equal(recorded) || row.LastChanged == nil || !row.LastChanged.Equal(recorded) {
		t.Fatalf("the newest recording is the last change: %+v", row)
	}
	if row.Reasons == nil {
		t.Fatal("reasons must be a list, never null")
	}

	checkRecording(t, host)
	state, err = host.chapterSyncState()
	if err != nil {
		t.Fatal(err)
	}
	if row := chapterRow(t, state, "c-0001"); row.Freshness != "current" || row.CheckedAt == nil {
		t.Fatalf("after a check: %+v", row)
	}

	// The narrator trims the take in REAPER and saves: the stored check is out of date, and says why.
	rpp := filepath.Join(project, "book.rpp")
	body, err := os.ReadFile(rpp)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(rpp, []byte(strings.Replace(string(body), "LENGTH 4", "LENGTH 3", 1)), 0o600); err != nil {
		t.Fatal(err)
	}
	state, err = host.chapterSyncState()
	if err != nil {
		t.Fatal(err)
	}
	row = chapterRow(t, state, "c-0001")
	if row.Freshness != "stale" || row.CheckedAt == nil || len(row.Reasons) == 0 || row.Reasons[0] != "item_trimmed" {
		t.Fatalf("after a trim: %+v", row)
	}

	// The payload with a stale, checked row, pinned for the UI's schema (chapterSyncStateSchema).
	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}
	stabilizeSyncTimes(payload)
	stable, err := contractfile.PortablePaths(payload, project, "C:/Projects/Book")
	if err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "chapter-sync-state-stale", stable)
}

func TestAChapterWithNoTrackIsListedAsNeverChecked(t *testing.T) {
	f := newSyncHost(t, true)
	state := f.state(t)
	if len(state.Chapters) != 3 {
		t.Fatalf("rows = %+v, want one per narration chapter", state.Chapters)
	}
	row := chapterRow(t, state, f.ids[2])
	if row.TrackGUID != "" || row.Origin != "" || row.Freshness != "never" || row.LastChanged != nil {
		t.Fatalf("Chapter III has no track: %+v", row)
	}
}

func TestAFinishedCheckSendsTheStatus(t *testing.T) {
	host := coverageHost(t, coverageProject(t), true, fakeCoverageSidecar(8))
	var mu sync.Mutex
	seen := []chapterSyncState{}
	host.mu.Lock()
	host.chapterSyncEvents = func(state chapterSyncState) {
		mu.Lock()
		defer mu.Unlock()
		seen = append(seen, state)
	}
	host.mu.Unlock()

	checkRecording(t, host)

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		for _, state := range seen {
			for _, row := range state.Chapters {
				if row.ChapterID == "c-0001" && row.Freshness == "current" {
					mu.Unlock()
					return
				}
			}
		}
		mu.Unlock()
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("no chaptersync:state said the chapter is current after its check ended")
}

func TestATrackChangedSinceTheLastSyncCarriesThatSyncsTime(t *testing.T) {
	f, start := newWatchedSyncHost(t)
	if row := chapterRow(t, f.state(t), f.ids[0]); row.TrackChangedAt != nil {
		t.Fatalf("the first sync knows no change time: %+v", row)
	}
	f.host.chapterSyncWatchTick(start)

	// Chapter I's second item is trimmed in REAPER, and the save is synced.
	trimmed := strings.Replace(chapterTracksRpp, "LENGTH 5", "LENGTH 4", 1)
	path := filepath.Join(f.host.config.projectFolder, "Alice.rpp")
	if err := os.WriteFile(path, []byte(trimmed), 0o600); err != nil {
		t.Fatal(err)
	}
	saved := start.Add(time.Second)
	if err := os.Chtimes(path, saved, saved); err != nil {
		t.Fatal(err)
	}
	f.host.chapterSyncWatchTick(start.Add(2 * time.Second))
	f.host.chapterSyncWatchTick(start.Add(4 * time.Second))

	row := chapterRow(t, f.lastEvent(t), f.ids[0])
	if row.TrackChangedAt == nil || row.LastChanged == nil || row.LastChanged.Before(*row.TrackChangedAt) {
		t.Fatalf("after a synced trim: %+v", row)
	}
	if other := chapterRow(t, f.lastEvent(t), f.ids[1]); other.TrackChangedAt != nil {
		t.Fatalf("an untouched chapter changed: %+v", other)
	}
}
