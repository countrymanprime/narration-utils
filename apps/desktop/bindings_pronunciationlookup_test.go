package main

import (
	"context"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/pronunciationlookup"
)

func TestPronunciationLookupOpenOpensTheSourcesOwnURL(t *testing.T) {
	host := NewHost()
	host.ctx = context.Background()
	var opened []string
	host.openURL = func(_ context.Context, address string) { opened = append(opened, address) }
	if _, err := host.PronunciationLookupOpen(string(pronunciationlookup.Forvo), "Mock Turtle"); err != nil {
		t.Fatalf("PronunciationLookupOpen: %v", err)
	}
	want := "https://forvo.com/word/Mock%20Turtle/"
	if len(opened) != 1 || opened[0] != want {
		t.Fatalf("opened %v, want exactly [%q]", opened, want)
	}
}

func TestPronunciationLookupOpenRefusesAnUnknownSource(t *testing.T) {
	host := NewHost()
	host.ctx = context.Background()
	var opened []string
	host.openURL = func(_ context.Context, address string) { opened = append(opened, address) }
	if _, err := host.PronunciationLookupOpen("wiktionary", "croquet"); err == nil {
		t.Fatal("want an error for an unknown source")
	}
	if len(opened) != 0 {
		t.Fatalf("an unknown source must never open anything, opened %v", opened)
	}
}

func TestPronunciationLookupOpenRefusesAnEmptyWord(t *testing.T) {
	host := NewHost()
	host.ctx = context.Background()
	var opened []string
	host.openURL = func(_ context.Context, address string) { opened = append(opened, address) }
	if _, err := host.PronunciationLookupOpen(string(pronunciationlookup.Forvo), ""); err == nil {
		t.Fatal("want an error for an empty word")
	}
	if len(opened) != 0 {
		t.Fatalf("an empty word must never open anything, opened %v", opened)
	}
}

// TestPronunciationLookupOpenRefusesBeforeTheHostIsReady mirrors DawCatalogOpenDownloadPage's own guard: with no
// openURL seam and no ctx (Startup has not run), the binding must refuse rather than pass a nil context to the
// Wails runtime.
func TestPronunciationLookupOpenRefusesBeforeTheHostIsReady(t *testing.T) {
	host := NewHost()
	if _, err := host.PronunciationLookupOpen(string(pronunciationlookup.Forvo), "croquet"); err == nil {
		t.Fatal("want an error before Startup has set a context")
	}
}
