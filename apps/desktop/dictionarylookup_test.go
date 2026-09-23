package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/dictionary"
	"github.com/countrymanprime/narration-utils/shell/internal/hostlog"
)

// lookupFixture is a host whose registry holds only a dictionary: a two-word release in the Open English WordNet JSON shape, served by a
// test server that counts its requests.
type lookupFixture struct {
	host     *Host
	requests *atomic.Int64
}

func wordnetZip(t *testing.T) []byte {
	t.Helper()
	files := map[string]any{
		"entries-h.json": map[string]any{"happy": map[string]any{"a": map[string]any{"form": []string{"happier"}, "sense": []map[string]any{
			{"id": "happy%3:00:00::", "synset": "01151786-a", "antonym": []string{"unhappy%3:00:00::"}}}}}},
		"entries-u.json": map[string]any{"unhappy": map[string]any{"a": map[string]any{"sense": []map[string]any{{"id": "unhappy%3:00:00::", "synset": "01152992-a"}}}}},
		"adj.all.json": map[string]any{
			"01151786-a": map[string]any{"definition": []string{"enjoying or showing or marked by joy or pleasure"}, "example": []string{"a happy smile"}, "members": []string{"happy", "glad"}},
			"01152992-a": map[string]any{"definition": []string{"experiencing or marked by or causing sadness"}, "members": []string{"unhappy"}},
		},
	}
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for name, body := range files {
		data, _ := json.Marshal(body)
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = entry.Write(data)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func newLookupFixture(t *testing.T) lookupFixture {
	t.Helper()
	archive := wordnetZip(t)
	var requests atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		_, _ = w.Write(archive)
	}))
	t.Cleanup(server.Close)
	sum := sha256.Sum256(archive)
	dir := t.TempDir()
	catalog := map[string]any{"catalogVersion": 1, "dictionaries": []map[string]any{{
		"id": "oewn-test", "provider": "oewn", "displayName": "Test WordNet", "version": "2025", "publisher": "OEWN", "license": "CC-BY-4.0",
		"attribution": "Test WordNet, CC BY 4.0", "installedSize": 3000,
		"files": []map[string]any{{"name": "wn.zip", "url": server.URL + "/wn.zip", "sha256": hex.EncodeToString(sum[:]), "size": len(archive), "extract": "wordnet", "expand": 10000}},
	}}}
	manager, err := dictionary.New(writeJSON(t, filepath.Join(dir, "dictionary-assets.json"), catalog), filepath.Join(dir, "cache", "dictionary"))
	if err != nil {
		t.Fatal(err)
	}
	registry := newAssetRegistry(filepath.Join(dir, "cache"), nil, nil, nil, nil)
	registry.registerDictionaries(manager)
	return lookupFixture{host: &Host{assets: registry, installJobs: map[string]*installJob{}, log: hostlog.New(filepath.Join(dir, "host.log"), 0)}, requests: &requests}
}

func TestALookupBeforeTheDictionaryIsInstalledAsksForItAndDownloadsNothing(t *testing.T) {
	f := newLookupFixture(t)
	answer, err := f.host.systemLookup("happy")
	if err != nil {
		t.Fatal(err)
	}
	info, _ := answer["dictionary"].(map[string]any)
	if answer["status"] != "asset_required" || answer["installState"] != "not_installed" || info["id"] != "oewn-test" || info["attribution"] != "Test WordNet, CC BY 4.0" {
		t.Fatalf("answer = %#v", answer)
	}
	if answer["diskSize"] != int64(3000) || answer["downloadSize"].(int64) <= 0 || !strings.HasSuffix(filepath.ToSlash(answer["installPath"].(string)), "dictionary/oewn/oewn-test/2025") {
		t.Fatalf("sizes and path = %v, %v, %v", answer["downloadSize"], answer["diskSize"], answer["installPath"])
	}
	if f.requests.Load() != 0 {
		t.Fatalf("a lookup made %d requests: selecting never downloads", f.requests.Load())
	}
}

func TestTheStandardAssetInstallMakesTheDictionaryAnswer(t *testing.T) {
	f := newLookupFixture(t)
	started, err := f.host.startAssetInstall(installKindDictionary, "oewn-test")
	if err != nil {
		t.Fatal(err)
	}
	final := waitForPhase(t, func() map[string]any {
		job, _ := f.host.installJobByID(started["id"].(string), "asset")
		return snapshotInstall(job)
	}, "success")
	if final["error"] != "" {
		t.Fatalf("final = %#v", final)
	}
	answer, err := f.host.systemLookup("“Happier,”")
	if err != nil {
		t.Fatal(err)
	}
	body, err := json.Marshal(answer)
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		Status  string             `json:"status"`
		Query   string             `json:"query"`
		Entries []dictionary.Entry `json:"entries"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Status != "ok" || decoded.Query != "happier" || len(decoded.Entries) != 1 {
		t.Fatalf("answer = %s", body)
	}
	sense := decoded.Entries[0].Senses[0]
	if decoded.Entries[0].Headword != "happy" || sense.Synonyms[0] != "glad" || sense.Antonyms[0] != "unhappy" {
		t.Fatalf("entry = %+v", decoded.Entries[0])
	}
	if missing, _ := f.host.systemLookup("zorblax"); missing["status"] != "ok" || len(missing["entries"].([]dictionary.Entry)) != 0 {
		t.Fatalf("a word the dictionary does not have = %#v", missing)
	}
}

func TestTheDictionaryIsListedWithTheOtherAssets(t *testing.T) {
	f := newLookupFixture(t)
	list, err := f.host.assetsList()
	if err != nil {
		t.Fatal(err)
	}
	rows := list["assets"].([]map[string]any)
	if len(rows) != 1 || rows[0]["kind"] != "dictionary" || rows[0]["kindLabel"] != "Dictionary" || rows[0]["diskSize"] != int64(3000) {
		t.Fatalf("assets = %#v", rows)
	}
}

func TestALookupOfWhatIsNotOneWordIsRefusedBeforeAnythingElse(t *testing.T) {
	f := newLookupFixture(t)
	for _, selection := range []string{"", "two words", "…"} {
		if _, err := f.host.systemLookup(selection); !errors.Is(err, dictionary.ErrNotAWord) {
			t.Fatalf("%q: err = %v, want ErrNotAWord", selection, err)
		}
	}
}

func TestALookupWithNoDictionaryCatalogSaysSo(t *testing.T) {
	host := &Host{assets: newAssetRegistry("", nil, nil, nil, nil)}
	if _, err := host.systemLookup("happy"); err == nil || !strings.Contains(err.Error(), "dictionary catalog is unavailable") {
		t.Fatalf("err = %v", err)
	}
}
