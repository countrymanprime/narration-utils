package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/spacy"
)

// spacyFixture is a Story Bible host whose settings choose en_core_web_sm and whose approved catalog holds that one model, a tiny wheel on a
// local server. The sidecar is the test binary; SHELL_FAKE_GUIDE_ARGS makes it write the arguments it was started with.
type spacyFixture struct {
	previewHost
	manager *spacy.Manager
	args    string
}

func newSpacyFixture(t *testing.T) spacyFixture {
	t.Helper()
	fixture := newPreviewHost(t, "ok")
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	file, _ := writer.Create("en_core_web_sm/en_core_web_sm-3.8.0/config.cfg")
	_, _ = file.Write([]byte("[nlp]\nlang = en\n"))
	_ = writer.Close()
	wheel := buffer.Bytes()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(wheel) }))
	t.Cleanup(server.Close)
	sum := sha256.Sum256(wheel)
	catalog := map[string]any{"catalogVersion": 1, "models": []map[string]any{{
		"id": "en_core_web_sm", "provider": "spacy", "displayName": "Small", "version": "3.8.0", "publisher": "Explosion", "license": "MIT", "spacyVersion": ">=3.8.0,<3.9.0",
		"modelPath": "model/en_core_web_sm/en_core_web_sm-3.8.0",
		"files":     []map[string]any{{"name": "sm.whl", "url": server.URL, "sha256": hex.EncodeToString(sum[:]), "size": len(wheel), "extract": "model", "expand": 4096}},
	}}}
	path := filepath.Join(t.TempDir(), "spacy.json")
	bytes, _ := json.Marshal(catalog)
	if err := os.WriteFile(path, bytes, 0o600); err != nil {
		t.Fatal(err)
	}
	manager, err := spacy.New(path, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	registry := fixture.host.registry()
	fixture.host.assets = newAssetRegistry(registry.base, registry.tts, nil, manager, nil)
	fixture.host.config.sessionDir = t.TempDir()
	fixture.host.installJobs = map[string]*installJob{}
	args := filepath.Join(t.TempDir(), "args.txt")
	t.Setenv("SHELL_FAKE_GUIDE_ARGS", args)
	return spacyFixture{previewHost: fixture, manager: manager, args: args}
}

func (f spacyFixture) sidecarArgs(t *testing.T) string {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		if bytes, err := os.ReadFile(f.args); err == nil && len(bytes) > 0 {
			return string(bytes)
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("the sidecar never ran")
	return ""
}

// Nothing starts, and nothing downloads, until the narrator chooses: the answer names the model, its two sizes and where it would go.
func TestABuildWithoutTheLanguageModelAsksBeforeDownloadingIt(t *testing.T) {
	f := newSpacyFixture(t)
	answer, err := f.host.startGuideBuild(false)
	if err != nil {
		t.Fatal(err)
	}
	model, _ := answer["model"].(map[string]any)
	if answer["status"] != "asset_required" || model["id"] != "en_core_web_sm" || answer["installState"] != "not_installed" || answer["diskSize"] != int64(4096) {
		t.Fatalf("answer = %#v, want the first-use gate for en_core_web_sm with its sizes", answer)
	}
	if path, _ := answer["installPath"].(string); !strings.HasSuffix(filepath.ToSlash(path), "spacy/en_core_web_sm/3.8.0") {
		t.Fatalf("installPath = %q, want where the model would be stored", path)
	}
	if f.host.guideJob != nil {
		t.Fatal("no build may start behind the gate")
	}
	if _, err := os.Stat(f.args); err == nil {
		t.Fatal("no sidecar may run behind the gate")
	}
	if f.manager.State(mustModel(t, f.manager)) != "not_installed" {
		t.Fatal("nothing may be downloaded until the narrator chooses Download")
	}
}

func mustModel(t *testing.T, manager *spacy.Manager) spacy.Model {
	t.Helper()
	model, ok := manager.Model("en_core_web_sm")
	if !ok {
		t.Fatal("no model")
	}
	return model
}

// An installed model is given to the sidecar as the folder spaCy loads it from, and the build runs.
func TestABuildWithTheLanguageModelInstalledLoadsItByFolder(t *testing.T) {
	f := newSpacyFixture(t)
	if err := f.manager.Install(t.Context(), "en_core_web_sm"); err != nil {
		t.Fatal(err)
	}
	answer, err := f.host.startGuideBuild(false)
	if err != nil {
		t.Fatal(err)
	}
	if answer["status"] != "started" {
		t.Fatalf("answer = %#v", answer)
	}
	dir, _ := f.manager.ModelDir("en_core_web_sm")
	if args := f.sidecarArgs(t); !strings.Contains(args, "--spacy-model\n"+dir+"\n") && !strings.Contains(args, "--spacy-model "+dir) {
		t.Fatalf("sidecar args = %q, want --spacy-model %s", args, dir)
	}
}

// Declining is a choice for this run, not a setting: the build starts with the rules-only extraction, says so when it ends, and the model
// is still not installed.
func TestABuildWithTheRulesOnlyChoiceRunsWithoutTheModelAndSaysSo(t *testing.T) {
	f := newSpacyFixture(t)
	events := collectJobEnds(f.host)
	answer, err := f.host.startGuideBuild(true)
	if err != nil {
		t.Fatal(err)
	}
	if answer["status"] != "started" {
		t.Fatalf("answer = %#v", answer)
	}
	if args := f.sidecarArgs(t); !strings.Contains(args, "rules-only") {
		t.Fatalf("sidecar args = %q, want the rules-only choice", args)
	}
	event := nextJobEnd(t, events)
	if event.Outcome != jobOutcomeSuccess || !strings.Contains(event.Message, "rules-only") || !strings.Contains(event.Message, "lower quality") {
		t.Fatalf("event = %+v, want the completion to say it was rules-only and lower quality", event)
	}
	if f.manager.State(mustModel(t, f.manager)) != "not_installed" {
		t.Fatal("declining must not download the model")
	}
}

// A name the app does not manage (a developer's own pip install) is passed on as it is.
func TestABuildWithAModelNameTheAppDoesNotManagePassesItThrough(t *testing.T) {
	f := newSpacyFixture(t)
	if err := f.host.settings.Save("ManuscriptGuide", "project", map[string]*string{"spacy_model": ptr("my_own_model")}); err != nil {
		t.Fatal(err)
	}
	answer, err := f.host.startGuideBuild(false)
	if err != nil || answer["status"] != "started" {
		t.Fatalf("answer = %#v, err = %v", answer, err)
	}
	if args := f.sidecarArgs(t); !strings.Contains(args, "my_own_model") {
		t.Fatalf("sidecar args = %q", args)
	}
}

func TestABuildWithNoLanguageModelCatalogSaysSoButStillOffersRulesOnly(t *testing.T) {
	f := newSpacyFixture(t)
	f.host.assets = newAssetRegistry("", f.host.registry().tts, nil, nil, nil)
	if _, err := f.host.startGuideBuild(false); err == nil || !strings.Contains(err.Error(), "language model catalog is unavailable") {
		t.Fatalf("err = %v", err)
	}
	if answer, err := f.host.startGuideBuild(true); err != nil || answer["status"] != "started" {
		t.Fatalf("the rules-only choice needs no catalog: %#v, %v", answer, err)
	}
	_ = f.sidecarArgs(t)
}

func ptr(value string) *string { return &value }

// The model setting is a file a project can edit, so it is not trusted as a path or as an option: only an approved model or a plain package
// name is used, and rules-only is a choice the narrator makes in the dialog, never a value a settings file can smuggle in.
func TestABuildRefusesAModelSettingThatIsAPathAnOptionOrTheRulesOnlyWord(t *testing.T) {
	for _, value := range []string{`\attacker\share\model`, `C:\models\en`, "/tmp/model", "../model", "--help", "-x", "rules-only", "a b", ""} {
		f := newSpacyFixture(t)
		if value != "" {
			if err := f.host.settings.Save("ManuscriptGuide", "project", map[string]*string{"spacy_model": &value}); err != nil {
				t.Fatal(err)
			}
		}
		answer, err := f.host.startGuideBuild(false)
		if value == "" {
			// An empty value falls back to the default model, which is approved and not installed: the gate.
			if err != nil || answer["status"] != "asset_required" {
				t.Errorf("empty: %#v, %v", answer, err)
			}
			continue
		}
		if err == nil || !strings.Contains(err.Error(), "not a language model the app can use") {
			t.Errorf("%q: answer %#v, err %v, want it refused", value, answer, err)
		}
		if _, statErr := os.Stat(f.args); statErr == nil {
			t.Errorf("%q: the sidecar must not run", value)
		}
	}
}
