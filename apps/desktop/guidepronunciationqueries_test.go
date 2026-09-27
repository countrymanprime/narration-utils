package main

import (
	"encoding/json"
	"strings"
	"testing"
)

// Prep-depth phase 3: the query list and its CSV are read-only bindings over the Story Bible file; neither starts the sidecar.

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
