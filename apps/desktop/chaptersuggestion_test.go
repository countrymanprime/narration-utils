package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const armLine = "    REC 1 0 1 0 0 0 0 0\n"

// newTestHostForSuggestion is newTestHostForChapterMatch with the .rpp's tracks
// flagged: each edit adds a line after the named track's TRACKID line.
func newTestHostForSuggestion(t *testing.T, flags map[string]string) (*Host, []string) {
	t.Helper()
	host, ids := newTestHostForChapterMatch(t)
	text := chapterTracksRpp
	for guid, line := range flags {
		anchor := "    TRACKID " + guid + "\n"
		if !strings.Contains(text, anchor) {
			t.Fatalf("no track %s in the fixture", guid)
		}
		text = strings.Replace(text, anchor, anchor+line, 1)
	}
	if err := os.WriteFile(filepath.Join(host.config.projectFolder, "Alice.rpp"), []byte(text), 0o600); err != nil {
		t.Fatal(err)
	}
	return host, ids
}

const (
	suggestTrackI    = "{11111111-1111-4111-8111-111111111111}"
	suggestTrackII   = "{22222222-2222-4222-8222-222222222222}"
	suggestTrackIIb  = "{33333333-3333-4333-8333-333333333333}"
	suggestSelectOne = "    SEL 1\n"
)

func suggestionFrom(t *testing.T, host *Host) map[string]any {
	t.Helper()
	raw, err := host.ChapterSuggestion()
	if err != nil {
		t.Fatal(err)
	}
	return decodeBinding(t, raw)
}

func TestChapterSuggestionReadsTheArmedTrack(t *testing.T) {
	host, ids := newTestHostForSuggestion(t, map[string]string{suggestTrackI: armLine, suggestTrackII: suggestSelectOne})
	result := suggestionFrom(t, host)
	chapter, _ := result["chapter"].(map[string]any)
	track, _ := result["track"].(map[string]any)
	if result["status"] != "matched" || result["basis"] != "armed" || chapter["chapterId"] != ids[0] || track["guid"] != suggestTrackI {
		t.Fatalf("result = %#v, want Chapter I from the armed track", result)
	}
	if !strings.HasSuffix(result["projectFile"].(string), "Alice.rpp") || result["savedAt"] == "" {
		t.Fatalf("result = %#v, want the .rpp and its save time", result)
	}
}

func TestChapterSuggestionWithNothingArmedOrSelectedSuggestsNothing(t *testing.T) {
	host, _ := newTestHostForSuggestion(t, nil)
	result := suggestionFrom(t, host)
	if result["status"] != "none" || result["basis"] != "none" || result["chapter"] != nil || result["track"] != nil {
		t.Fatalf("result = %#v, want no suggestion", result)
	}
}

func TestChapterSuggestionFromTwoSelectedTracksNamedForOneChapter(t *testing.T) {
	host, ids := newTestHostForSuggestion(t, map[string]string{suggestTrackII: suggestSelectOne, suggestTrackIIb: suggestSelectOne})
	result := suggestionFrom(t, host)
	chapter, _ := result["chapter"].(map[string]any)
	if result["status"] != "matched" || result["basis"] != "selected" || result["track"] != nil || chapter["chapterId"] != ids[1] {
		t.Fatalf("result = %#v, want Chapter II, which both selected tracks name", result)
	}
}

func TestChapterSuggestionHonoursAConfirmedLink(t *testing.T) {
	host, ids := newTestHostForSuggestion(t, map[string]string{suggestTrackIIb: armLine})
	if _, err := host.ChapterTrackMapConfirm(suggestTrackIIb, ids[2]); err != nil {
		t.Fatal(err)
	}
	result := suggestionFrom(t, host)
	chapter, _ := result["chapter"].(map[string]any)
	if result["status"] != "confirmed" || chapter["chapterId"] != ids[2] {
		t.Fatalf("result = %#v, want the confirmed chapter over the track's name", result)
	}
}

func TestChapterSuggestionNeedsAProjectFile(t *testing.T) {
	bare, _ := newTestHostForMapping(t)
	if _, err := bare.ChapterSuggestion(); err == nil || !strings.Contains(err.Error(), "no REAPER project") {
		t.Fatalf("err = %v, want the no-project-file error", err)
	}
	if _, err := (&Host{}).ChapterSuggestion(); err == nil {
		t.Fatal("want an error without a project")
	}
}
