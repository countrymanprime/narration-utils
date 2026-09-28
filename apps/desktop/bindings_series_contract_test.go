package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/character"
	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/series"
)

// What SeriesVoiceBible sends the UI (character-continuity-review.prd.md Phase 11, D87 benches every
// acoustic-drift binding, so this is reference data only).

func TestContractSeriesVoiceBible(t *testing.T) {
	root := t.TempDir()
	bookOne := filepath.Join(root, "Alice-in-Wonderland")
	bookTwo := filepath.Join(root, "Through-the-Looking-Glass")

	rppPath := filepath.Join(bookOne, "project.rpp")
	if err := os.MkdirAll(bookOne, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(rppPath, []byte(contractTwoRegions), 0o600); err != nil {
		t.Fatal(err)
	}
	characterSvc := character.New(character.Config{Project: bookOne, ProjectFile: func() (string, error) { return rppPath, nil }})
	if _, err := characterSvc.Approve("alice", "{AAAAAAAA-0000-0000-0000-000000000001}", "Anchor take, chapter 1."); err != nil {
		t.Fatal(err)
	}

	// Book two's own reference for the same character (entity ids are a hash of the normalized name, so "alice" in
	// both books is already the same id) - written directly, mirroring internal/series's own test fixtures, since
	// seeding it through a second character.Service just to get one reference on disk would need its own saved
	// REAPER project too.
	siblingDir := character.Dir(bookTwo)
	if err := os.MkdirAll(siblingDir, 0o755); err != nil {
		t.Fatal(err)
	}
	siblingJSON := `{"schemaVersion":1,"references":[{"id":"r2","characterId":"alice","regionGuid":"g2","snapshot":{"name":"Alice ref, Book 2 Ch. 5","start":4,"end":6.5},"approvedAt":"2026-09-24T09:00:00Z"}]}`
	if err := os.WriteFile(filepath.Join(siblingDir, "references.json"), []byte(siblingJSON), 0o600); err != nil {
		t.Fatal(err)
	}

	seriesStore := series.New(filepath.Join(root, "series.json"))
	if _, err := seriesStore.Save(series.Series{Name: "Wonderland", MemberProjectPaths: []string{bookOne, bookTwo}}); err != nil {
		t.Fatal(err)
	}

	host := &Host{character: characterSvc, series: seriesStore, config: config{projectFolder: bookOne}}
	raw, err := host.SeriesVoiceBible()
	if err != nil {
		t.Fatal(err)
	}
	var payload any
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		t.Fatal(err)
	}
	// Two member project folders appear in the payload (each clip's projectPath); each is made portable in turn,
	// mirroring TestContractChapterSuggestion's own chained PortablePaths calls for more than one folder.
	stable, err := contractfile.PortablePaths(payload, bookOne, "C:/Projects/Alice-in-Wonderland")
	if err != nil {
		t.Fatal(err)
	}
	stable, err = contractfile.PortablePaths(stable, bookTwo, "C:/Projects/Through-the-Looking-Glass")
	if err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "series-voice-bible", stable)
}
