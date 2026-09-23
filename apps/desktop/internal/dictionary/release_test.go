package dictionary

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/layout"
)

// p95Budget is the Phase 7 success signal: a lookup answers in under 250 ms at the 95th percentile.
const p95Budget = 250 * time.Millisecond

// TestThePinnedArchiveInstallsToTheCatalogsMeasuredSize installs the real, pinned archive through the approved catalog entry (served from
// the local file NARRATION_OEWN_ZIP names instead of GitHub, so its size and SHA-256 are the pinned ones) and checks that the index it
// keeps is exactly the catalog's installedSize, the size the first-use dialog states.
func TestThePinnedArchiveInstallsToTheCatalogsMeasuredSize(t *testing.T) {
	archive := os.Getenv("NARRATION_OEWN_ZIP")
	if archive == "" {
		t.Skip("set NARRATION_OEWN_ZIP to the downloaded english-wordnet-2025-json.zip to run this")
	}
	body, err := os.ReadFile(archive)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(body) }))
	defer server.Close()
	approved, err := New(layout.RepoFile(layout.DictionaryCatalogFile), "")
	if err != nil {
		t.Fatal(err)
	}
	entry, _ := approved.Default()
	entry.Files[0].URL = server.URL
	catalog, _ := json.Marshal(Catalog{Version: 1, Dictionaries: []Dictionary{entry}})
	path := filepath.Join(t.TempDir(), "dictionary-assets.json")
	if err := os.WriteFile(path, catalog, 0o600); err != nil {
		t.Fatal(err)
	}
	manager, err := New(path, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Install(context.Background(), entry.ID); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(manager.indexPath(entry))
	if err != nil {
		t.Fatal(err)
	}
	if info.Size() != entry.InstalledSize {
		t.Fatalf("the index is %d bytes and the catalog says %d: update installedSize", info.Size(), entry.InstalledSize)
	}
	if result, err := manager.Lookup(entry.ID, "whispered"); err != nil || len(result.Entries) == 0 {
		t.Fatalf("lookup after the real install = %+v, %v", result, err)
	}
}

// TestTheRealReleaseBuildsAndAnswersWithinBudget builds the index from the real, unpacked Open English WordNet JSON release and times
// lookups against it. It needs the release, so it runs only when NARRATION_OEWN_DIR names the folder it was unpacked to (the pinned
// english-wordnet-2025-json.zip of config/dictionary-assets.json); the gate runs the fixture tests instead.
func TestTheRealReleaseBuildsAndAnswersWithinBudget(t *testing.T) {
	dir := os.Getenv("NARRATION_OEWN_DIR")
	if dir == "" {
		t.Skip("set NARRATION_OEWN_DIR to the unpacked english-wordnet-2025-json.zip to run this")
	}
	out := filepath.Join(t.TempDir(), IndexName)
	started := time.Now()
	if err := BuildIndex(dir, out); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(out)
	if err != nil {
		t.Fatal(err)
	}
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	t.Logf("built in %s, %d bytes; the process took %d MiB from the system", time.Since(started).Round(time.Millisecond), info.Size(), memory.Sys>>20)
	words := []string{"happy", "ran", "cats", "running", "happiest", "geese", "Alice", "rabbit", "curiouser", "whispered", "melancholy",
		"serendipity", "don't", "well-being", "zorblax", "the", "a", "set", "run", "light", "bank", "fair", "quickly", "went", "mice", "children"}
	var timings []time.Duration
	for round := 0; round < 5; round++ {
		for _, word := range words {
			began := time.Now()
			result, err := LookupFile(out, word)
			timings = append(timings, time.Since(began))
			if err != nil {
				t.Fatalf("%s: %v", word, err)
			}
			if round == 0 {
				t.Logf("%-12s -> %d entries", word, len(result.Entries))
			}
		}
	}
	sort.Slice(timings, func(i, j int) bool { return timings[i] < timings[j] })
	p95 := timings[len(timings)*95/100]
	t.Logf("p50 %s, p95 %s, max %s over %d lookups", timings[len(timings)/2], p95, timings[len(timings)-1], len(timings))
	if p95 > p95Budget {
		t.Fatalf("p95 %s is over the %s budget", p95, p95Budget)
	}
	for _, word := range []string{"happy", "ran", "mice", "running"} {
		if result, _ := LookupFile(out, word); len(result.Entries) == 0 {
			t.Fatalf("%q found nothing in the real release", word)
		}
	}
}
