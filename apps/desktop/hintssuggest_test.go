package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/guide"
	"github.com/countrymanprime/narration-utils/shell/internal/process"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
	"github.com/countrymanprime/narration-utils/shell/internal/transcript"
)

// newSuggestHost builds a Host whose Story Bible holds guideJSON and whose Transcript
// Compare project already has the given saved hints file contents ("" for none).
func newSuggestHost(t *testing.T, guideJSON, savedHints string) *Host {
	t.Helper()
	project := t.TempDir()
	store := settings.New(t.TempDir(), project)
	sidecars := process.NewSupervisor()
	t.Cleanup(func() { _ = sidecars.Close() })
	guideService := guide.New(project, "", "", store, sidecars)
	if guideJSON != "" {
		path := filepath.Join(project, "ManuscriptGuide", "manuscript_guide.json")
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(guideJSON), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if savedHints != "" {
		path := filepath.Join(project, "TranscriptCompare", "vocab_hints.json")
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(savedHints), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return &Host{settings: store, guide: guideService, transcript: transcript.New(transcript.Config{Project: project}, nil, store, sidecars, nil)}
}

type suggestion struct {
	Terms []string `json:"terms"`
	Found int      `json:"found"`
}

func suggestionsOf(t *testing.T, host *Host) suggestion {
	t.Helper()
	raw, err := host.TranscriptSuggestHints()
	if err != nil {
		t.Fatal(err)
	}
	var result suggestion
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

const seededGuide = `{"vocabulary_candidates":[],"entities":[{"canonical_name":"Alice","category":"Character","manual":true},{"canonical_name":"Zeph","category":"Character","manual":true}]}`

// The count of every name found lets the page tell "nothing found" from "all already accepted".
func TestSuggestHintsReportsWhatWasFoundAndWhatIsNew(t *testing.T) {
	host := newSuggestHost(t, seededGuide, `["alice"]`)
	result := suggestionsOf(t, host)
	if !slices.Equal(result.Terms, []string{"Zeph"}) || result.Found != 2 {
		t.Fatalf("result = %#v, want new term Zeph out of 2 found (Alice is already accepted, case-insensitively)", result)
	}
}

func TestSuggestHintsWithEverythingAcceptedFindsNamesButOffersNone(t *testing.T) {
	host := newSuggestHost(t, seededGuide, `["Alice","Zeph"]`)
	result := suggestionsOf(t, host)
	if len(result.Terms) != 0 || result.Found != 2 {
		t.Fatalf("result = %#v, want no new terms but 2 found", result)
	}
}

func TestSuggestHintsWithNoNamesFindsNothing(t *testing.T) {
	host := newSuggestHost(t, `{"vocabulary_candidates":[],"entities":[]}`, "")
	result := suggestionsOf(t, host)
	if len(result.Terms) != 0 || result.Found != 0 {
		t.Fatalf("result = %#v, want nothing found", result)
	}
}

func TestSuggestHintsAsksForABuildWhenThereIsNoStoryBibleFile(t *testing.T) {
	host := newSuggestHost(t, "", "")
	if _, err := host.TranscriptSuggestHints(); err == nil || !strings.Contains(err.Error(), "build the Story Bible") {
		t.Fatalf("error = %v", err)
	}
}

// A saved-hints file that cannot be read is reported when the hints load, and must not stop Suggest.
func TestSuggestHintsStillWorksWhenTheSavedHintsFileIsUnreadable(t *testing.T) {
	host := newSuggestHost(t, seededGuide, `{"broken"`)
	if result := suggestionsOf(t, host); len(result.Terms) != 2 {
		t.Fatalf("result = %#v, want both names offered", result)
	}
}

func TestTranscriptHintsReportsAnUnreadableSavedFileInsteadOfShowingNone(t *testing.T) {
	host := newSuggestHost(t, seededGuide, `{"broken"`)
	if _, err := host.TranscriptHints(); err == nil || !strings.Contains(err.Error(), "vocabulary hints") {
		t.Fatalf("error = %v, want a vocabulary hints load error", err)
	}
	healthy := newSuggestHost(t, seededGuide, `["Alice"]`)
	raw, err := healthy.TranscriptHints()
	if err != nil || raw != `["Alice"]` {
		t.Fatalf("hints = %q, %v", raw, err)
	}
}
