package main

import "testing"

func creditsRecordedLengths(t *testing.T, host *Host) map[string]map[string]any {
	t.Helper()
	raw, err := host.CreditsRecordedLengths()
	if err != nil {
		t.Fatal(err)
	}
	decoded := decodeBinding(t, raw)
	rows := make(map[string]map[string]any, len(decoded))
	for kind, row := range decoded {
		rows[kind] = row.(map[string]any)
	}
	return rows
}

func TestCreditsRecordedLengthsIsUnlinkedWithNoLink(t *testing.T) {
	host, _ := newTestHostForChapterMatch(t)
	got := creditsRecordedLengths(t, host)
	if got["opening"]["recordedUnavailable"] != "unlinked" || got["closing"]["recordedUnavailable"] != "unlinked" {
		t.Fatalf("credits recorded lengths with no link = %#v, want both unlinked", got)
	}
}

func TestCreditsRecordedLengthsIsTheConfirmedTrackSAudioInTheSavedProject(t *testing.T) {
	host, _ := newTestHostForChapterMatch(t)
	if _, err := host.ChapterTrackMapConfirm(chapterLinksTrack, "credits-opening"); err != nil {
		t.Fatal(err)
	}
	got := creditsRecordedLengths(t, host)
	// Chapter I's track (the one confirmed above) runs 0-10 and 12-17 s, whatever its playrate.
	if got["opening"]["recordedSeconds"] != 15.0 {
		t.Fatalf("credits-opening = %#v, want 15 s", got["opening"])
	}
	if got["closing"]["recordedUnavailable"] != "unlinked" {
		t.Fatalf("credits-closing = %#v, want unlinked (never linked)", got["closing"])
	}
}

// A credits id must never leak into a manuscript chapter's own recorded length, and vice versa (credits-in-
// chapter-table.prd.md's "No chapter leakage" success metric, extended to this provider).
func TestCreditsRecordedLengthsNeverLeaksIntoAManuscriptChaptersOwn(t *testing.T) {
	host, ids := newTestHostForChapterMatch(t)
	if _, err := host.ChapterTrackMapConfirm(chapterLinksTrack, "credits-opening"); err != nil {
		t.Fatal(err)
	}
	host.manuscript.SetRecordedLengths(recordedLengths(host.config.projectFolder, host.settings, host.manuscript))
	chapters, err := host.manuscript.Chapters()
	if err != nil {
		t.Fatal(err)
	}
	for _, chapter := range chapters {
		if chapter["id"].(string) == ids[0] && chapter["recordedUnavailable"] != "unlinked" {
			t.Fatalf("chapter %v = %#v, want still unlinked (its track went to credits-opening, not it)", ids[0], chapter)
		}
	}
}
