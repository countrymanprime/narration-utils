package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// chapterTracksRpp holds a track for Alice's Chapter I (two items, the later
// one trimmed and sped up), two tracks both named for Chapter II, and nothing
// for Chapter III.
const chapterTracksRpp = `<REAPER_PROJECT 0.1 "7.80/x64" 1789000000
  <TRACK {11111111-1111-4111-8111-111111111111}
    NAME "Chapter I"
    TRACKID {11111111-1111-4111-8111-111111111111}
    <ITEM
      POSITION 0
      LENGTH 10
      IGUID {21111111-1111-4111-8111-111111111111}
      SOFFS 0
      GUID {31111111-1111-4111-8111-111111111111}
      <SOURCE WAVE
        FILE "media/ch1.wav"
      >
    >
    <ITEM
      POSITION 12
      LENGTH 5
      IGUID {22222222-1111-4111-8111-111111111111}
      SOFFS 2
      PLAYRATE 1.5 1 0 -1 0 0.0025
      GUID {32222222-1111-4111-8111-111111111111}
      <SOURCE WAVE
        FILE "media/ch1.wav"
      >
    >
  >
  <TRACK {22222222-2222-4222-8222-222222222222}
    NAME "Chapter II"
    TRACKID {22222222-2222-4222-8222-222222222222}
  >
  <TRACK {33333333-3333-4333-8333-333333333333}
    NAME "Chapter II"
    TRACKID {33333333-3333-4333-8333-333333333333}
  >
>
`

func newTestHostForChapterMatch(t *testing.T) (*Host, []string) {
	t.Helper()
	host, _ := newTestHostForMapping(t)
	folder := host.config.projectFolder
	if err := os.WriteFile(filepath.Join(folder, "Alice.rpp"), []byte(chapterTracksRpp), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(folder, "media"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(folder, "media", "ch1.wav"), []byte("RIFF"), 0o600); err != nil {
		t.Fatal(err)
	}
	chapters, err := host.manuscript.Chapters()
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]string, 0, len(chapters))
	for _, chapter := range chapters {
		ids = append(ids, chapter["id"].(string))
	}
	return host, ids
}

func TestChapterTrackMatchFindsTheTrackAndWhereItsAudioEnds(t *testing.T) {
	host, ids := newTestHostForChapterMatch(t)
	raw, err := host.ChapterTrackMatch(ids[0])
	if err != nil {
		t.Fatal(err)
	}
	result := decodeBinding(t, raw)
	track, _ := result["track"].(map[string]any)
	if result["status"] != "matched" || track["trackGuid"] != "{11111111-1111-4111-8111-111111111111}" {
		t.Fatalf("result = %#v, want Chapter I matched to its track", result)
	}
	if !strings.HasPrefix(result["chapterTitle"].(string), "Chapter I") || result["savedAt"] == "" {
		t.Fatalf("result = %#v, want the chapter title and the .rpp's save time", result)
	}
	end, _ := result["recordedEnd"].(map[string]any)
	if end["projectTime"] != 17.0 || end["sourceTime"] != 9.5 || end["sourceAvailable"] != true {
		t.Fatalf("recordedEnd = %#v, want 17 s in the project and 2 + 5 * 1.5 s into the source", end)
	}
	if options, _ := result["tracks"].([]any); len(options) != 3 {
		t.Fatalf("tracks = %#v, want every track for the picker", result["tracks"])
	}
}

func TestChapterTrackMatchReportsAmbiguousAndNoneWithoutARecordedEnd(t *testing.T) {
	host, ids := newTestHostForChapterMatch(t)
	for _, c := range []struct {
		id, status string
		candidates int
	}{{ids[1], "ambiguous", 2}, {ids[2], "none", 0}} {
		raw, err := host.ChapterTrackMatch(c.id)
		if err != nil {
			t.Fatal(err)
		}
		result := decodeBinding(t, raw)
		candidates, _ := result["candidates"].([]any)
		if result["status"] != c.status || result["track"] != nil || result["recordedEnd"] != nil || len(candidates) != c.candidates {
			t.Fatalf("%s: result = %#v, want %s with %d candidates and no track", c.id, result, c.status, c.candidates)
		}
	}
}

func TestChapterTrackMatchHonoursAConfirmedLink(t *testing.T) {
	host, ids := newTestHostForChapterMatch(t)
	if _, err := host.ChapterTrackMapConfirm("{33333333-3333-4333-8333-333333333333}", ids[2]); err != nil {
		t.Fatal(err)
	}
	raw, err := host.ChapterTrackMatch(ids[2])
	if err != nil {
		t.Fatal(err)
	}
	result := decodeBinding(t, raw)
	track, _ := result["track"].(map[string]any)
	if result["status"] != "confirmed" || track["trackGuid"] != "{33333333-3333-4333-8333-333333333333}" {
		t.Fatalf("result = %#v, want the confirmed track", result)
	}
	// The confirmed track is no longer a candidate for Chapter II, which is
	// now matched to the other one.
	raw, err = host.ChapterTrackMatch(ids[1])
	if err != nil {
		t.Fatal(err)
	}
	second := decodeBinding(t, raw)
	if second["status"] != "matched" {
		t.Fatalf("Chapter II = %#v, want matched to the remaining track", second)
	}
}

func TestChapterTrackMatchRefusesAnUnknownChapterAndAMissingProjectFile(t *testing.T) {
	host, _ := newTestHostForChapterMatch(t)
	if _, err := host.ChapterTrackMatch("c-9999"); err == nil {
		t.Fatal("want an error for a chapter that is not in the manuscript")
	}
	bare, ids := newTestHostForMapping(t)
	if _, err := bare.ChapterTrackMatch(ids); err == nil || !strings.Contains(err.Error(), "no REAPER project") {
		t.Fatalf("err = %v, want the no-project-file error", err)
	}
}

func TestChapterTrackMatchNeedsAProject(t *testing.T) {
	if _, err := (&Host{}).ChapterTrackMatch("c-0001"); err == nil {
		t.Fatal("want an error without a project")
	}
}
