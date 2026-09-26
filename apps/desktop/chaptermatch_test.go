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

// TestChaptersForTracksResolvesTrackItemAndTakeGUIDs is the Review page's
// other direction (diagnostics-delivery-and-cleanup-tools PRD Phase 8
// remainder): a finding usually carries only a track, item or take GUID
// (apps/desktop/internal/findings.Source), never a chapter id, so grouping by
// chapter needs the shared matcher run per GUID in bulk.
func TestChaptersForTracksResolvesTrackItemAndTakeGUIDs(t *testing.T) {
	host, ids := newTestHostForChapterMatch(t)
	const (
		chapterITrack = "{11111111-1111-4111-8111-111111111111}"
		item1GUID     = "{21111111-1111-4111-8111-111111111111}"
		take1GUID     = "{31111111-1111-4111-8111-111111111111}"
		item2GUID     = "{22222222-1111-4111-8111-111111111111}"
	)
	raw, err := host.ChaptersForTracks([]string{chapterITrack, item1GUID, take1GUID, item2GUID})
	if err != nil {
		t.Fatal(err)
	}
	result := decodeBinding(t, raw)
	tracksField, _ := result["tracks"].(map[string]any)
	if len(tracksField) != 4 {
		t.Fatalf("tracks = %#v, want an entry per requested GUID", tracksField)
	}
	for _, guid := range []string{chapterITrack, item1GUID, take1GUID, item2GUID} {
		entry, ok := tracksField[guid].(map[string]any)
		if !ok {
			t.Fatalf("tracks[%q] missing from %#v", guid, tracksField)
		}
		chapter, _ := entry["chapter"].(map[string]any)
		title, _ := chapter["chapterTitle"].(string)
		if entry["status"] != "matched" || !strings.HasPrefix(title, "Chapter I") {
			t.Fatalf("tracks[%q] = %#v, want matched to Chapter I (track, item and take GUIDs all resolve through the same track)", guid, entry)
		}
	}
	if result["projectFile"] == "" || result["savedAt"] == "" {
		t.Fatalf("result = %#v, want the project file and its save time", result)
	}
	_ = ids
}

// chaptersForTracksNoneRpp is its own project, separate from
// chapterTracksRpp (which several other tests' golden fixtures and states
// depend on exactly as it is): the same two Chapter II tracks, plus an
// unrelated "SFX" track that matches no chapter.
const chaptersForTracksNoneRpp = `<REAPER_PROJECT 0.1 "7.80/x64" 1789000000
  <TRACK {22222222-2222-4222-8222-222222222222}
    NAME "Chapter II"
    TRACKID {22222222-2222-4222-8222-222222222222}
  >
  <TRACK {33333333-3333-4333-8333-333333333333}
    NAME "Chapter II"
    TRACKID {33333333-3333-4333-8333-333333333333}
  >
  <TRACK {44444444-4444-4444-8444-444444444444}
    NAME "SFX"
    TRACKID {44444444-4444-4444-8444-444444444444}
  >
>
`

func newTestHostForChaptersForTracksNone(t *testing.T) *Host {
	t.Helper()
	host, _ := newTestHostForMapping(t)
	folder := host.config.projectFolder
	if err := os.WriteFile(filepath.Join(folder, "Alice.rpp"), []byte(chaptersForTracksNoneRpp), 0o600); err != nil {
		t.Fatal(err)
	}
	return host
}

// TestChaptersForTracksReportsMatchedNoneAndUnknownGUIDs checks ForTrack's
// other statuses through the batch binding: two tracks sharing one chapter's
// name each match it cleanly from their own side (ambiguity in ForChapter is
// about which track holds the chapter, not what a track's own name means), an
// unrelated track matches nothing, and one GUID the project no longer has
// never fails the whole call (a stale finding after a project switch or an
// item deleted since the scan).
func TestChaptersForTracksReportsMatchedNoneAndUnknownGUIDs(t *testing.T) {
	host := newTestHostForChaptersForTracksNone(t)
	const (
		chapterIITrackA = "{22222222-2222-4222-8222-222222222222}"
		chapterIITrackB = "{33333333-3333-4333-8333-333333333333}"
		sfxTrack        = "{44444444-4444-4444-8444-444444444444}"
		unknownGUID     = "{99999999-9999-4999-8999-999999999999}"
	)
	raw, err := host.ChaptersForTracks([]string{chapterIITrackA, chapterIITrackB, sfxTrack, unknownGUID})
	if err != nil {
		t.Fatal(err)
	}
	result := decodeBinding(t, raw)
	tracksField, _ := result["tracks"].(map[string]any)

	for _, guid := range []string{chapterIITrackA, chapterIITrackB} {
		entry, _ := tracksField[guid].(map[string]any)
		chapter, _ := entry["chapter"].(map[string]any)
		title, _ := chapter["chapterTitle"].(string)
		if entry["status"] != "matched" || !strings.HasPrefix(title, "Chapter II") {
			t.Fatalf("tracks[%q] = %#v, want matched to Chapter II", guid, entry)
		}
	}
	none, _ := tracksField[sfxTrack].(map[string]any)
	if none["status"] != "none" || none["chapter"] != nil {
		t.Fatalf("tracks[%q] = %#v, want none with no chapter", sfxTrack, none)
	}
	unknown, _ := tracksField[unknownGUID].(map[string]any)
	if unknown["error"] == "" || unknown["error"] == nil {
		t.Fatalf("tracks[%q] = %#v, want an error naming the GUID as not in the project", unknownGUID, unknown)
	}
}

// TestChaptersForTracksHonoursAConfirmedLink checks the confirmed-link
// direction goes through ChaptersForTracks exactly as it does through
// ChapterTrackMatch's ForChapter direction.
func TestChaptersForTracksHonoursAConfirmedLink(t *testing.T) {
	host, ids := newTestHostForChapterMatch(t)
	const chapterIITrackB = "{33333333-3333-4333-8333-333333333333}"
	if _, err := host.ChapterTrackMapConfirm(chapterIITrackB, ids[2]); err != nil {
		t.Fatal(err)
	}
	raw, err := host.ChaptersForTracks([]string{chapterIITrackB})
	if err != nil {
		t.Fatal(err)
	}
	result := decodeBinding(t, raw)
	tracksField, _ := result["tracks"].(map[string]any)
	entry, _ := tracksField[chapterIITrackB].(map[string]any)
	chapter, _ := entry["chapter"].(map[string]any)
	if entry["status"] != "confirmed" || chapter["chapterId"] != ids[2] {
		t.Fatalf("result = %#v, want the confirmed chapter", entry)
	}
}

func TestChaptersForTracksWithNoGUIDsAnswersAnEmptyMap(t *testing.T) {
	host, _ := newTestHostForChapterMatch(t)
	raw, err := host.ChaptersForTracks(nil)
	if err != nil {
		t.Fatal(err)
	}
	result := decodeBinding(t, raw)
	tracksField, _ := result["tracks"].(map[string]any)
	if len(tracksField) != 0 {
		t.Fatalf("tracks = %#v, want empty", tracksField)
	}
}

func TestChaptersForTracksNeedsAProject(t *testing.T) {
	if _, err := (&Host{}).ChaptersForTracks([]string{"{guid}"}); err == nil {
		t.Fatal("want an error without a project")
	}
}
