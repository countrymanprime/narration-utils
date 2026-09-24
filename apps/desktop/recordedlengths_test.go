package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

// chapterRecorded reads each chapter's recorded length the way Home does: through ManuscriptChapters.
func chapterRecorded(t *testing.T, host *Host) map[string]map[string]any {
	t.Helper()
	host.manuscript.SetRecordedLengths(recordedLengths(host.config.projectFolder, host.settings, host.manuscript))
	chapters, err := host.manuscript.Chapters()
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]map[string]any{}
	for _, chapter := range chapters {
		byID[chapter["id"].(string)] = chapter
	}
	return byID
}

func TestRecordedSecondsIsTheConfirmedTrackSAudioInTheSavedProject(t *testing.T) {
	host, ids := newTestHostForChapterMatch(t)
	// A confident name match is not a link: before any confirmation every chapter is unlinked.
	before := chapterRecorded(t, host)
	if before[ids[0]]["recordedUnavailable"] != "unlinked" || before[ids[0]]["recordedSeconds"] != nil {
		t.Fatalf("Chapter I before a link = %#v, want unlinked", before[ids[0]])
	}
	if _, err := host.ChapterTrackSet(ids[0], chapterLinksTrack); err != nil {
		t.Fatal(err)
	}
	for _, link := range [][2]string{{chapterLinksTrackII, ids[1]}, {chapterLinksTrackIJ, ids[1]}, {"{DEADBEEF-0000-4000-8000-000000000000}", ids[2]}} {
		if _, err := host.ChapterTrackMapConfirm(link[0], link[1]); err != nil {
			t.Fatal(err)
		}
	}
	got := chapterRecorded(t, host)
	// Chapter I's items run 0-10 and 12-17 s in the project, whatever their playrate.
	if got[ids[0]]["recordedSeconds"] != 15.0 {
		t.Fatalf("Chapter I = %#v, want 15 s", got[ids[0]])
	}
	if got[ids[1]]["recordedUnavailable"] != "multiple_tracks" || got[ids[2]]["recordedUnavailable"] != "track_missing" {
		t.Fatalf("Chapter II = %#v, Chapter III = %#v; want multiple_tracks and track_missing", got[ids[1]], got[ids[2]])
	}
}

func TestRecordedSecondsFollowsASavedProjectAndSaysWhenThereIsNone(t *testing.T) {
	host, ids := newTestHostForChapterMatch(t)
	if _, err := host.ChapterTrackSet(ids[0], chapterLinksTrack); err != nil {
		t.Fatal(err)
	}
	host.manuscript.SetRecordedLengths(recordedLengths(host.config.projectFolder, host.settings, host.manuscript))
	read := func() map[string]any {
		chapters, err := host.manuscript.Chapters()
		if err != nil {
			t.Fatal(err)
		}
		return chapters[0]
	}
	if read()["recordedSeconds"] != 15.0 {
		t.Fatalf("first read = %#v, want 15 s", read())
	}
	// REAPER saves the project with the second item muted: the next read sees it.
	rpp := filepath.Join(host.config.projectFolder, "Alice.rpp")
	edited := strings.Replace(chapterTracksRpp, "      POSITION 12\n", "      POSITION 12\n      MUTE 1 0\n", 1)
	if err := os.WriteFile(rpp, []byte(edited), 0o600); err != nil {
		t.Fatal(err)
	}
	later := time.Now().Add(time.Minute)
	if err := os.Chtimes(rpp, later, later); err != nil {
		t.Fatal(err)
	}
	if got := read(); got["recordedSeconds"] != 10.0 {
		t.Fatalf("after a save = %#v, want 10 s", got)
	}
	if err := os.Remove(rpp); err != nil {
		t.Fatal(err)
	}
	if got := read(); got["recordedUnavailable"] != "no_project" {
		t.Fatalf("without a project = %#v, want no_project", got)
	}
}

// BenchmarkRecordedLengths reads 30 linked chapters' recorded lengths from a 30-track, 3,000-item saved project: cold
// (the .rpp is parsed) and warm (the parse is reused while the file is unchanged). The PRD's budget is 50 ms added to
// a chapter-list read.
func BenchmarkRecordedLengths(b *testing.B) {
	folder := b.TempDir()
	var rpp strings.Builder
	rpp.WriteString("<REAPER_PROJECT 0.1 \"7.80/x64\" 1789000000\n")
	for track := 0; track < 30; track++ {
		guid := fmt.Sprintf("{%08d-0000-4000-8000-000000000000}", track)
		fmt.Fprintf(&rpp, "  <TRACK %s\n    NAME \"Chapter %d\"\n    TRACKID %s\n", guid, track+1, guid)
		for item := 0; item < 100; item++ {
			fmt.Fprintf(&rpp, "    <ITEM\n      POSITION %d\n      LENGTH 12\n      IGUID {%08d-%04d-4000-8000-000000000000}\n      <SOURCE WAVE\n        FILE \"media/t%d.wav\"\n      >\n    >\n", item*10, track, item, track)
		}
		rpp.WriteString("  >\n")
	}
	rpp.WriteString(">\n")
	path := filepath.Join(folder, "Book.rpp")
	if err := os.WriteFile(path, []byte(rpp.String()), 0o600); err != nil {
		b.Fatal(err)
	}
	chapters := make([]string, 30)
	mappings := make([]evidence.TrackMapping, 30)
	for i := range chapters {
		chapters[i] = fmt.Sprintf("c-%04d", i+1)
		mappings[i] = evidence.TrackMapping{ChapterID: chapters[i], TrackGUID: fmt.Sprintf("{%08d-0000-4000-8000-000000000000}", i)}
	}
	store := settings.New(b.TempDir(), folder)
	b.Run("cold", func(b *testing.B) {
		for b.Loop() {
			cache := &projectParseCache{}
			project, ok := cache.read(folder, store)
			if !ok {
				b.Fatal("the project did not parse")
			}
			// 100 overlapping 12 s items 10 s apart: one run from 0 to 1002 s.
			if got := recordedLengthsFor(chapters, mappings, project, ok)[chapters[0]].Seconds; got != 1002 {
				b.Fatalf("recorded seconds = %v, want 1002", got)
			}
		}
	})
	b.Run("warm", func(b *testing.B) {
		cache := &projectParseCache{}
		cache.read(folder, store)
		for b.Loop() {
			project, ok := cache.read(folder, store)
			_ = recordedLengthsFor(chapters, mappings, project, ok)
		}
	})
}
