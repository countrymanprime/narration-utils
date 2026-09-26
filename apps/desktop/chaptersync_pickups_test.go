package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

// pinChapterSyncState checks state against its golden payload, with times and the project folder made stable.
func pinChapterSyncState(t *testing.T, name string, state chapterSyncState, folder string) {
	t.Helper()
	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}
	stabilizeSyncTimes(payload)
	stable, err := contractfile.PortablePaths(payload, folder, "C:/Projects/Alice")
	if err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, name, stable)
}

// Pickup tracks (daw-chapter-track-auto-sync PRD Phase 8, S8, S11, D32, D33): a track named as a chapter's pickup track
// is shown on that chapter's row, never linked, and the row says when it changed since the last take-review scan that
// included it.

const chapterIPickups = `  <TRACK {55555555-5555-4555-8555-555555555555}
    NAME "Chapter I (pickups)"
    TRACKID {55555555-5555-4555-8555-555555555555}
    <ITEM
      POSITION 30
      LENGTH 2
      IGUID {65555555-5555-4555-8555-555555555555}
      <SOURCE WAVE
        FILE "media/ch1.wav"
      >
    >
  >
`

func writeAliceRpp(t *testing.T, f syncHost, extra string) {
	t.Helper()
	body := strings.TrimSuffix(chapterTracksRpp, ">\n") + extra + ">\n"
	if err := os.WriteFile(filepath.Join(f.host.config.projectFolder, "Alice.rpp"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestAChaptersPickupTrackIsOnItsRowAndSaysWhenItChangedSinceTheLastScan(t *testing.T) {
	f := newSyncHost(t, true)
	writeAliceRpp(t, f, chapterIPickups)
	if _, err := f.host.chapterSyncSetEnabled(true); err != nil {
		t.Fatal(err)
	}
	if got := f.links(t)["{11111111-1111-4111-8111-111111111111}"]; got != f.ids[0]+"/auto" {
		t.Fatalf("Chapter I's own track = %q, want still auto-linked beside its pickup track", got)
	}
	if _, linked := f.links(t)["{55555555-5555-4555-8555-555555555555}"]; linked {
		t.Fatal("a pickup track became a chapter link")
	}
	row := chapterRow(t, f.state(t), f.ids[0])
	if row.PickupTrackGUID != "{55555555-5555-4555-8555-555555555555}" || row.PickupTrackName != "Chapter I (pickups)" {
		t.Fatalf("pickup track = %+v", row)
	}
	if !row.PickupsChanged || row.PickupsScannedAt != nil {
		t.Fatalf("a pickup track never scanned has pickups to scan: %+v", row)
	}
	if other := chapterRow(t, f.state(t), f.ids[1]); other.PickupTrackGUID != "" || other.PickupsChanged {
		t.Fatalf("Chapter II has no pickup track: %+v", other)
	}
	pinChapterSyncState(t, "chapter-sync-state-pickups", f.state(t), f.host.config.projectFolder)

	// The narrator scans Chapter I with its pickup track.
	f.host.findings = findings.NewStore(f.host.config.projectFolder)
	f.host.config.sessionDir = t.TempDir()
	f.host.takeReviewRunner = &fakeTakeReviewRunner{raw: "SUMMARY|nothing\n"}
	if _, err := f.host.TakeReviewScanStart(TakeReviewScanScope{ChapterTrackName: "Chapter I", PickupTrackName: "Chapter I (pickups)"}); err != nil {
		t.Fatal(err)
	}
	if done := waitForScan(t, f.host); done.Phase != "success" {
		t.Fatalf("scan = %+v", done)
	}
	row = chapterRow(t, f.state(t), f.ids[0])
	if row.PickupsChanged || row.PickupsScannedAt == nil {
		t.Fatalf("after the scan: %+v", row)
	}

	// A new pickup is recorded on the pickup track and saved.
	writeAliceRpp(t, f, strings.Replace(chapterIPickups, "LENGTH 2", "LENGTH 3", 1))
	if row := chapterRow(t, f.state(t), f.ids[0]); !row.PickupsChanged || row.PickupsScannedAt == nil {
		t.Fatalf("after a new pickup: %+v", row)
	}
}

func TestAScanWithoutThePickupTrackRecordsNothing(t *testing.T) {
	f := newSyncHost(t, true)
	writeAliceRpp(t, f, chapterIPickups)
	if _, err := f.host.chapterSyncSetEnabled(true); err != nil {
		t.Fatal(err)
	}
	f.host.findings = findings.NewStore(f.host.config.projectFolder)
	f.host.config.sessionDir = t.TempDir()
	f.host.takeReviewRunner = &fakeTakeReviewRunner{raw: "SUMMARY|nothing\n"}
	if _, err := f.host.TakeReviewScanStart(TakeReviewScanScope{ChapterTrackName: "Chapter I"}); err != nil {
		t.Fatal(err)
	}
	waitForScan(t, f.host)
	if row := chapterRow(t, f.state(t), f.ids[0]); !row.PickupsChanged || row.PickupsScannedAt != nil {
		t.Fatalf("a scan of the chapter track alone saw no pickups: %+v", row)
	}
}
