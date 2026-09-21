package spacy

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/assets"
	"github.com/countrymanprime/narration-utils/shell/internal/layout"
)

// A small wheel: the model folder the way spaCy ships it, and its notices.
func fakeWheel(t *testing.T) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for name, body := range map[string]string{
		"en_core_web_test/meta.json":                         `{"license":"MIT"}`,
		"en_core_web_test/en_core_web_test-1.0.0/config.cfg": "[nlp]\nlang = en\n",
		"en_core_web_test/en_core_web_test-1.0.0/ner/model":  strings.Repeat("weights", 50),
		"en_core_web_test-1.0.0.dist-info/LICENSES_SOURCES":  "notices",
	} {
		file, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = file.Write([]byte(body))
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func testManager(t *testing.T) *Manager {
	t.Helper()
	wheel := fakeWheel(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(wheel) }))
	t.Cleanup(server.Close)
	sum := sha256.Sum256(wheel)
	catalog := map[string]any{"catalogVersion": 1, "models": []map[string]any{{
		"id": "en_core_web_test", "provider": "spacy", "displayName": "Test", "version": "1.0.0", "publisher": "Explosion", "license": "MIT",
		"spacyVersion": ">=3.8.0,<3.9.0", "modelPath": "model/en_core_web_test/en_core_web_test-1.0.0",
		"files": []map[string]any{{"name": "w.whl", "url": server.URL, "sha256": hex.EncodeToString(sum[:]), "size": len(wheel), "extract": "model", "expand": 5000}},
	}}}
	path := filepath.Join(t.TempDir(), "spacy.json")
	bytes, _ := json.Marshal(catalog)
	if err := os.WriteFile(path, bytes, 0o600); err != nil {
		t.Fatal(err)
	}
	manager, err := New(path, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return manager
}

func TestTheModelDirectoryIsWhereSpacyLoadsItFromAndOnlyOnceInstalled(t *testing.T) {
	manager := testManager(t)
	if _, err := manager.ModelDir("en_core_web_test"); err == nil {
		t.Fatal("a model that is not installed has no directory")
	}
	if err := manager.Install(context.Background(), "en_core_web_test"); err != nil {
		t.Fatal(err)
	}
	dir, err := manager.ModelDir("en_core_web_test")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "config.cfg")); err != nil {
		t.Fatalf("%s is not a spaCy model folder: %v", dir, err)
	}
	if _, err := manager.ModelDir("unknown"); err == nil {
		t.Fatal("an unknown model must not resolve a directory")
	}
}

func TestACatalogModelIsSelectableBeforeItIsInstalled(t *testing.T) {
	manager := testManager(t)
	catalog := manager.Catalog()
	models := catalog["models"].([]map[string]any)
	if len(models) != 1 || models[0]["installState"] != "not_installed" || models[0]["id"] != "en_core_web_test" {
		t.Fatalf("catalog = %v", catalog)
	}
	if models[0]["downloadSize"] == int64(0) || models[0]["diskSize"] != int64(5000) {
		t.Fatalf("sizes = %v and %v: the download is the wheel, the disk is what it unpacks to", models[0]["downloadSize"], models[0]["diskSize"])
	}
	ids := manager.IDs()
	if len(ids) != 1 || ids[0] != "en_core_web_test" {
		t.Fatalf("IDs = %v", ids)
	}
}

func TestVerifyAndRepairAModelThatWasDamaged(t *testing.T) {
	manager := testManager(t)
	if err := manager.Install(context.Background(), "en_core_web_test"); err != nil {
		t.Fatal(err)
	}
	dir, _ := manager.ModelDir("en_core_web_test")
	if err := os.WriteFile(filepath.Join(dir, "config.cfg"), []byte("broken"), 0o600); err != nil {
		t.Fatal(err)
	}
	if state, err := manager.Verify("en_core_web_test"); err != nil || state != "verification_failed" {
		t.Fatalf("Verify = %s, %v", state, err)
	}
	if err := manager.Repair(context.Background(), "en_core_web_test", assets.Options{}); err != nil {
		t.Fatal(err)
	}
	if state, _ := manager.Verify("en_core_web_test"); state != "installed" {
		t.Fatalf("after Repair Verify = %s", state)
	}
}

// The approved catalog: every entry is a pinned, hashed, unpackable wheel whose spaCy range the locked spaCy satisfies, so a spaCy upgrade
// cannot leave a model that will not load.
func TestEveryApprovedModelIsPinnedAndTheLockedSpacyLoadsIt(t *testing.T) {
	manager, err := New(layout.RepoFile(layout.SpacyCatalogFile), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	locked := lockedSpacyVersion(t)
	if len(manager.Models()) < 2 {
		t.Fatalf("the catalog holds %d models, want the small and the large", len(manager.Models()))
	}
	for _, model := range manager.Models() {
		if len(model.Files) != 1 || model.Files[0].Extract == "" || model.Files[0].Expand <= 0 || len(model.Files[0].SHA256) != 64 || model.Files[0].Size <= 0 {
			t.Errorf("%s: the wheel must be one pinned, hashed, unpackable file: %+v", model.ID, model.Files)
		}
		if !strings.HasPrefix(model.Files[0].URL, "https://github.com/explosion/spacy-models/releases/download/"+model.ID+"-"+model.Version+"/") {
			t.Errorf("%s: the URL %s is not the model's own release asset", model.ID, model.Files[0].URL)
		}
		if !strings.HasSuffix(model.ModelPath, "/"+model.ID+"-"+model.Version) || model.License == "" || model.Publisher == "" || model.ModelCardURL == "" {
			t.Errorf("%s: model path, licence, publisher and model card are required: %+v", model.ID, model)
		}
		if !satisfies(t, locked, model.SpacyVersion) {
			t.Errorf("%s needs spaCy %s and the lock has %v", model.ID, model.SpacyVersion, locked)
		}
	}
}

func lockedSpacyVersion(t *testing.T) []int {
	t.Helper()
	bytes, err := os.ReadFile(layout.RepoFile("uv.lock"))
	if err != nil {
		t.Fatal(err)
	}
	match := regexp.MustCompile(`(?m)^name = "spacy"\nversion = "(\d+)\.(\d+)\.(\d+)"`).FindSubmatch(bytes)
	if match == nil {
		t.Fatal("uv.lock has no spacy entry")
	}
	version := make([]int, 3)
	for index := range version {
		version[index], _ = strconv.Atoi(string(match[index+1]))
	}
	return version
}

// satisfies checks a ">=A.B.C,<D.E.F" range, the only form the catalog uses.
func satisfies(t *testing.T, version []int, constraint string) bool {
	t.Helper()
	match := regexp.MustCompile(`^>=(\d+)\.(\d+)\.(\d+),<(\d+)\.(\d+)\.(\d+)$`).FindStringSubmatch(constraint)
	if match == nil {
		t.Fatalf("spacyVersion %q is not >=A.B.C,<D.E.F", constraint)
	}
	number := func(index int) int { n, _ := strconv.Atoi(match[index]); return n }
	compare := func(a, b []int) int {
		for i := range a {
			if a[i] != b[i] {
				if a[i] < b[i] {
					return -1
				}
				return 1
			}
		}
		return 0
	}
	return compare(version, []int{number(1), number(2), number(3)}) >= 0 && compare(version, []int{number(4), number(5), number(6)}) < 0
}
