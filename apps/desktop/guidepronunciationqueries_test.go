package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/guide"
	"github.com/countrymanprime/narration-utils/shell/internal/process"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

// Prep-depth phase 3: the query list and its CSV are read-only bindings over the Story Bible file; neither starts the sidecar.

// countingGuideWithEntities is countingGuide plus a Story Bible file already on disk, for a phase 6 import test: it
// needs both a real list to match against and the recording fake sidecar phase 1's pronunciation-status calls go through.
func countingGuideWithEntities(t *testing.T, entities any) (*guide.Service, func() [][]string) {
	t.Helper()
	log := filepath.Join(t.TempDir(), "calls.jsonl")
	t.Setenv(fakeGuideCountEnv, log)
	project := t.TempDir()
	sidecars := process.NewSupervisor()
	t.Cleanup(func() { _ = sidecars.Close() })
	service := guide.New(project, os.Args[0], "", settings.New(t.TempDir(), project), sidecars)
	guidePath := filepath.Join(project, "ManuscriptGuide", "manuscript_guide.json")
	if err := os.MkdirAll(filepath.Dir(guidePath), 0o755); err != nil {
		t.Fatal(err)
	}
	body, err := json.Marshal(map[string]any{"schema_version": 2, "entities": entities})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(guidePath, body, 0o600); err != nil {
		t.Fatal(err)
	}
	return service, func() [][]string {
		file, err := os.Open(log)
		if os.IsNotExist(err) {
			return nil
		}
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = file.Close() }()
		var calls [][]string
		decoder := json.NewDecoder(file)
		for decoder.More() {
			var args []string
			if err := decoder.Decode(&args); err != nil {
				t.Fatal(err)
			}
			calls = append(calls, args)
		}
		return calls
	}
}

func TestGuidePronunciationImportQueriesCSVAppliesMatchedRowsAndCallsTheSidecarOncePerRow(t *testing.T) {
	service, calls := countingGuideWithEntities(t, []any{
		map[string]any{
			"id": "entity-wren", "canonical_name": "Wren", "category": "Character", "occurrence_count": 0, "locked": false, "review_state": "reviewed",
			"pronunciation": map[string]any{"ipa": "wɹɛn", "source": "user", "confidence": "narrator", "status": "query_sent"},
			"occurrences":   []any{},
			"aliases":       []any{},
		},
	})
	host := &Host{guide: service}
	csv := "word,entry_id,status,note\nWren,entity-wren,author_confirmed,Rhymes with hen\nGhost,entity-gone,researched,\n"
	text, err := host.GuidePronunciationImportQueriesCSV(csv)
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		Applied int      `json:"applied"`
		Issues  []string `json:"issues"`
	}
	if err := json.Unmarshal([]byte(text), &result); err != nil {
		t.Fatal(err)
	}
	if result.Applied != 1 || len(result.Issues) != 1 || !strings.HasPrefix(result.Issues[0], "line 3:") {
		t.Fatalf("result = %+v", result)
	}
	got := calls()
	if len(got) != 1 {
		t.Fatalf("sidecar calls = %v", got)
	}
	call := got[0]
	if call[0] != "pronunciation-status" || !strings.Contains(strings.Join(call, " "), "--entity-id entity-wren") ||
		!strings.Contains(strings.Join(call, " "), "--status author_confirmed") || !strings.Contains(strings.Join(call, " "), "--note=Rhymes with hen") {
		t.Fatalf("call = %v", call)
	}
}

func TestGuidePronunciationImportQueriesCSVIsUnavailableWithoutTheStoryBible(t *testing.T) {
	host := &Host{}
	if _, err := host.GuidePronunciationImportQueriesCSV("word,entry_id\nWren,entity-wren\n"); err == nil {
		t.Fatal("GuidePronunciationImportQueriesCSV: expected an error")
	}
}

func TestGuidePronunciationQueriesAndCSVWithNoStoryBibleYet(t *testing.T) {
	service, calls := countingGuide(t)
	host := &Host{guide: service}
	text, err := host.GuidePronunciationQueries()
	if err != nil || text != "[]" {
		t.Fatalf("GuidePronunciationQueries = %q, %v", text, err)
	}
	text, err = host.GuidePronunciationQueriesCSV()
	if err != nil {
		t.Fatal(err)
	}
	var payload struct {
		CSV   string `json:"csv"`
		Count int    `json:"count"`
	}
	if err := json.Unmarshal([]byte(text), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Count != 0 || !strings.HasPrefix(payload.CSV, "word,entry,") || strings.Count(payload.CSV, "\n") != 1 {
		t.Fatalf("payload = %+v", payload)
	}
	if len(calls()) != 0 {
		t.Fatal("a read started the sidecar")
	}
}

func TestPronunciationQueryBindingsAreUnavailableWithoutTheStoryBible(t *testing.T) {
	host := &Host{}
	if _, err := host.GuidePronunciationQueries(); err == nil {
		t.Fatal("GuidePronunciationQueries: expected an error")
	}
	if _, err := host.GuidePronunciationQueriesCSV(); err == nil {
		t.Fatal("GuidePronunciationQueriesCSV: expected an error")
	}
}
