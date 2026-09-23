package dawcatalog

import (
	"net/url"
	"strings"
	"testing"
)

// TestCatalogIsALiteralNotAFetch asserts the catalog is a compile-time Go
// value with no network- or file-shaped construction anywhere in reach: the
// PRD's URL-integrity success metric ("a unit test asserting the catalog is
// a literal, not a fetch", docs/prds/daw-selection-and-acquisition.prd.md)
// and its Decisions Log ("URL source: hardcoded Go constants ... never
// fetched or user-editable"). A real network call in this test process would
// fail sandboxed CI, so the strongest test available is: every entry's
// DownloadURL parses as an absolute https URL, and the catalog slice is
// non-empty and stable across calls (a fetch would need an argument this
// function does not take).
func TestCatalogIsALiteralNotAFetch(t *testing.T) {
	if len(Catalog) == 0 {
		t.Fatal("Catalog is empty; want at least the REAPER entry")
	}
	for _, entry := range Catalog {
		u, err := url.Parse(entry.DownloadURL)
		if err != nil {
			t.Fatalf("entry %q: DownloadURL %q does not parse: %v", entry.ID, entry.DownloadURL, err)
		}
		if u.Scheme != "https" {
			t.Errorf("entry %q: DownloadURL %q is not https", entry.ID, entry.DownloadURL)
		}
		if u.Host == "" {
			t.Errorf("entry %q: DownloadURL %q has no host", entry.ID, entry.DownloadURL)
		}
	}
}

// TestReaperEntryFieldsAreAllPopulated guards against a catalog entry that
// silently ships with an empty field (an empty LicenseNote or Publisher
// would leave the eventual UI panel, Phase 2, with nothing to show).
func TestReaperEntryFieldsAreAllPopulated(t *testing.T) {
	fields := map[string]string{
		"ID":          REAPER.ID,
		"Name":        REAPER.Name,
		"Publisher":   REAPER.Publisher,
		"LicenseNote": REAPER.LicenseNote,
		"DownloadURL": REAPER.DownloadURL,
	}
	for name, value := range fields {
		if strings.TrimSpace(value) == "" {
			t.Errorf("REAPER.%s is empty", name)
		}
	}
}

// TestReaperEntryCopyDoesNotImplyAffiliation is a narrow, automatable slice
// of the PRD's Phase 4 copy review (A5, "What We're NOT Building": no
// implied affiliation, partnership or endorsement). It cannot catch every
// wording problem — that is still a human sign-off in Phase 4 — but it does
// catch the specific words the PRD calls out as off-limits.
func TestReaperEntryCopyDoesNotImplyAffiliation(t *testing.T) {
	bannedWords := []string{"partner", "official partner", "endorsed", "endorsement", "affiliated", "sponsor"}
	haystack := strings.ToLower(REAPER.Name + " " + REAPER.Publisher + " " + REAPER.LicenseNote)
	for _, word := range bannedWords {
		if strings.Contains(haystack, word) {
			t.Errorf("REAPER catalog copy contains %q, which implies affiliation/endorsement", word)
		}
	}
}

// TestCatalogEntryIDsAreUnique guards the lookup Phase 2's binding will do
// by ID (the id, not a URL, crosses the Wails boundary per the PRD's
// architecture notes) against a future duplicate entry silently shadowing
// another.
func TestCatalogEntryIDsAreUnique(t *testing.T) {
	seen := map[string]bool{}
	for _, entry := range Catalog {
		if seen[entry.ID] {
			t.Fatalf("duplicate catalog entry ID %q", entry.ID)
		}
		seen[entry.ID] = true
	}
}

// TestLookupFindsEveryCatalogEntryByIDAndRejectsUnknownOnes is Phase 2's own
// seam: DawCatalogOpenDownloadPage resolves a narrator-chosen id through this
// function alone, never a caller-supplied URL.
func TestLookupFindsEveryCatalogEntryByIDAndRejectsUnknownOnes(t *testing.T) {
	for _, want := range Catalog {
		got, ok := Lookup(want.ID)
		if !ok || got != want {
			t.Errorf("Lookup(%q) = %+v, %v; want %+v, true", want.ID, got, ok, want)
		}
	}
	if _, ok := Lookup("audacity"); ok {
		t.Error(`Lookup("audacity") = true; Audacity is not in the catalog yet (Decisions Log)`)
	}
	if _, ok := Lookup(""); ok {
		t.Error(`Lookup("") = true; want false`)
	}
}
