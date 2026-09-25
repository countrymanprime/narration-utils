package main

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
)

// "Remove from recording" and "Restore" (chapter-track-link-control PRD Phase 3, TL2, TL5): a chapter's kind changes
// after import, its links are cleared, and every recording surface that filters by kind drops it.

const chapterITrack = "{11111111-1111-4111-8111-111111111111}"

func setChapterKind(t *testing.T, host *Host, chapterID, kind string) map[string]any {
	t.Helper()
	raw, err := host.ManuscriptSetChapterKind(chapterID, kind)
	if err != nil {
		t.Fatal(err)
	}
	return decodeBinding(t, raw)
}

func narratableChapters(t *testing.T, host *Host) any {
	t.Helper()
	manuscript, _ := host.Bootstrap()["manuscript"].(map[string]any)
	return manuscript["narratableChapterCount"]
}

func linkedChapterIDs(t *testing.T, host *Host) []string {
	t.Helper()
	raw, err := host.ChapterTrackLinks()
	if err != nil {
		t.Fatal(err)
	}
	var links struct {
		Chapters []struct {
			ChapterID string `json:"chapterId"`
		} `json:"chapters"`
	}
	if err := json.Unmarshal([]byte(raw), &links); err != nil {
		t.Fatal(err)
	}
	ids := []string{}
	for _, chapter := range links.Chapters {
		ids = append(ids, chapter.ChapterID)
	}
	return ids
}

func TestRemovingAChapterFromRecordingClearsItsLinksAndDropsItEverywhere(t *testing.T) {
	host, ids := newTestHostForChapterMatch(t)
	if _, err := host.ChapterTrackSet(ids[0], chapterITrack); err != nil {
		t.Fatal(err)
	}
	if _, err := host.ManuscriptSetChapterStatus(ids[0], "recording"); err != nil {
		t.Fatal(err)
	}
	before := narratableChapters(t, host)

	result := setChapterKind(t, host, ids[0], "reference")

	chapter, _ := result["chapter"].(map[string]any)
	cleared, _ := result["clearedLinks"].([]any)
	if result["previousKind"] != "narration" || chapter["contentKind"] != "reference" || chapter["removedFromRecording"] != true || len(cleared) != 1 {
		t.Fatalf("result = %v", result)
	}
	mappings, err := host.mappingList()
	if err != nil {
		t.Fatal(err)
	}
	if list := mappings["mappings"]; strings.Contains(mustJSON(t, list), chapterITrack) {
		t.Fatalf("the removed chapter's link is still stored: %v", list)
	}
	if after := narratableChapters(t, host); after.(int) != before.(int)-1 {
		t.Fatalf("narratable chapters %v -> %v", before, after)
	}
	for _, id := range linkedChapterIDs(t, host) {
		if id == ids[0] {
			t.Fatal("the removed chapter is still a row of the links read")
		}
	}

	restored := setChapterKind(t, host, ids[0], "narration")

	chapter, _ = restored["chapter"].(map[string]any)
	if restored["previousKind"] != "reference" || chapter["status"] != "recording" || chapter["removedFromRecording"] != nil {
		t.Fatalf("restored = %v", restored)
	}
	if narratableChapters(t, host) != before || linkedChapterIDs(t, host)[0] != ids[0] {
		t.Fatal("the restored chapter did not come back")
	}
}

func TestSettingAChapterKindIsRefusedWithoutAManuscriptOrForAnUnknownChapter(t *testing.T) {
	host, _ := newTestHostForChapterMatch(t)
	if _, err := host.ManuscriptSetChapterKind("missing", "reference"); err == nil {
		t.Fatal("an unknown chapter was reclassified")
	}
	if _, err := host.ManuscriptSetChapterKind("c-0001", "gone"); err == nil {
		t.Fatal("an unknown kind was accepted")
	}
	if _, err := NewHost().ManuscriptSetChapterKind("c-0001", "reference"); err == nil {
		t.Fatal("a host without a project reclassified a chapter")
	}
}

// ManuscriptSetChapterKind's payload: the chapter as the chapter list now sends it, the kind it had and the links
// the removal cleared.
func TestContractManuscriptSetChapterKind(t *testing.T) {
	host, ids := newTestHostForChapterMatch(t)
	if _, err := host.ChapterTrackSet(ids[0], chapterITrack); err != nil {
		t.Fatal(err)
	}
	result := setChapterKind(t, host, ids[0], "reference")
	chapter, _ := result["chapter"].(map[string]any)
	chapter["kindChangedAt"] = "2026-09-25T12:00:00Z"
	for _, link := range result["clearedLinks"].([]any) {
		link.(map[string]any)["confirmedAt"] = "2026-09-25T11:00:00Z"
	}
	contractfile.Check(t, "manuscript-chapter-kind-removed", result)
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	bytes, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(bytes)
}
