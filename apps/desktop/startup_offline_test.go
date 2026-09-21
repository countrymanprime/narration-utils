package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/assets"
)

// The app must never download because it opened, and choosing a model in Settings must never download it (first-use brief, "Intended
// experience"). These tests hold the Go host to it: http.DefaultTransport is replaced with one that records the request and fails it, and
// so is the update stager's own client, so the asset installer, the update check and the update download are all caught. (The Python
// sidecars are separate processes that are not started here, and no transport of this process can see them; the host starts a sidecar only
// for a feature the narrator uses.) Tests that swap http.DefaultTransport and the per-user environment cannot run in parallel.
//
// The one intended exception is the in-app update check (ADR 0072): a GET of GitHub's releases metadata, at most once a day, that the
// narrator can switch off in Settings. It downloads no asset. The tests below keep it off where they assert silence, and pin it as the
// only request, and only to that address, where it is on.

// networkGuard is a RoundTripper that refuses every request and remembers what was asked for.
type networkGuard struct {
	mu       sync.Mutex
	requests []string
}

func (g *networkGuard) RoundTrip(request *http.Request) (*http.Response, error) {
	g.mu.Lock()
	g.requests = append(g.requests, request.Method+" "+request.URL.String())
	g.mu.Unlock()
	return nil, errors.New("test: the network is closed")
}

func (g *networkGuard) seen() []string {
	g.mu.Lock()
	defer g.mu.Unlock()
	return append([]string(nil), g.requests...)
}

// closeTheNetwork installs a guard as the default transport for the rest of the test.
func closeTheNetwork(t *testing.T) *networkGuard {
	t.Helper()
	guard := &networkGuard{}
	previous := http.DefaultTransport
	http.DefaultTransport = guard
	t.Cleanup(func() { http.DefaultTransport = previous })
	return guard
}

// emptyUserProfile points every per-user folder (settings, cache, recents) at an empty temporary one, so the test starts as a first launch
// on a clean machine and never reads or writes the developer's own data. It returns the asset cache folder the app would use.
func emptyUserProfile(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	for _, name := range []string{"APPDATA", "LOCALAPPDATA", "USERPROFILE", "HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME"} {
		t.Setenv(name, home)
	}
	base, err := assetCacheBase()
	if err != nil {
		t.Fatal(err)
	}
	return base
}

// autoCheckDelay is how long the launched hosts of these tests wait before the automatic update check, instead of twelve seconds, so
// the real Startup wiring (the goroutine and its delay) is what the tests watch.
const autoCheckDelay = 30 * time.Millisecond

// launchHost is a host as the window starts it: NewHost, then Startup. The update check is on unless updatesOff, and runs after
// autoCheckDelay unless keepDefaultDelay. Every client the host builds for itself goes through guard, and its background work is stopped
// when the test ends.
type launch struct{ updatesOff, keepDefaultDelay bool }

func launchHost(t *testing.T, guard *networkGuard, how launch) *Host {
	t.Helper()
	host := NewHost()
	host.stager.Client = &http.Client{Transport: guard}
	if !how.keepDefaultDelay {
		host.updateDelay = autoCheckDelay
	}
	if how.updatesOff {
		if err := host.saveSettings("Updates", "global", map[string]*string{"check_on_startup": ptr("false")}); err != nil {
			t.Fatal(err)
		}
	}
	host.Startup(context.Background())
	t.Cleanup(func() { host.Shutdown(context.Background()) })
	return host
}

// filesUnder lists every regular file below dir; a folder that does not exist has none.
func filesUnder(t *testing.T, dir string) []string {
	t.Helper()
	var found []string
	err := filepath.WalkDir(dir, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			if os.IsNotExist(walkErr) {
				return nil
			}
			return walkErr
		}
		if !entry.IsDir() {
			found = append(found, path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return found
}

// whatTheFirstScreenReads is what the UI asks the host for when it opens and when the narrator visits Settings: the bootstrap, the
// settings, every catalog and the list of local assets.
func whatTheFirstScreenReads(t *testing.T, host *Host) {
	t.Helper()
	host.Bootstrap()
	for _, read := range []struct {
		name string
		call func() (string, error)
	}{
		{"SystemSettingsForScope global", func() (string, error) { return host.SystemSettingsForScope("global") }},
		{"SystemSettingsForScope project", func() (string, error) { return host.SystemSettingsForScope("project") }},
		{"TtsCatalog", host.TtsCatalog},
		{"WhisperCatalog", host.WhisperCatalog},
		{"AssetsList", host.AssetsList},
		{"UpdateStatus", host.UpdateStatus},
	} {
		if _, err := read.call(); err != nil {
			t.Fatalf("%s: %v", read.name, err)
		}
	}
}

// settleBackgroundWork gives the goroutines Startup starts (the transcript poll, the stale-download sweep and the automatic update check,
// which runs at autoCheckDelay) time to run, so a request they would make is on the guard before the test looks. It can only produce a
// false pass, never a false failure, so it is generous.
func settleBackgroundWork() { time.Sleep(400 * time.Millisecond) }

// waitForRequests waits until the guard has seen at least n requests, and fails the test when it does not.
func waitForRequests(t *testing.T, guard *networkGuard, n int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for len(guard.seen()) < n {
		if time.Now().After(deadline) {
			t.Fatalf("expected %d request(s), saw %v", n, guard.seen())
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestOpeningTheAppOnAnEmptyCacheMakesNoRequestAndStartsNoDownload(t *testing.T) {
	cache := emptyUserProfile(t)
	guard := closeTheNetwork(t)
	host := launchHost(t, guard, launch{updatesOff: true})

	whatTheFirstScreenReads(t, host)
	settleBackgroundWork() // the automatic check has come due by now, and the setting is off

	if seen := guard.seen(); len(seen) != 0 {
		t.Fatalf("opening the app made requests: %v", seen)
	}
	host.mu.RLock()
	jobs, staged := len(host.installJobs), host.updateJob
	host.mu.RUnlock()
	if jobs != 0 || staged != nil {
		t.Fatalf("opening the app started %d install job(s) and update job %v", jobs, staged)
	}
	if files := filesUnder(t, cache); len(files) != 0 {
		t.Fatalf("opening the app put files in the asset cache: %v", files)
	}
	list := answer(t)(host.AssetsList())
	for _, entry := range list["assets"].([]any) {
		if asset := entry.(map[string]any); asset["installState"] != "not_installed" {
			t.Fatalf("%v %v is %v on an empty cache", asset["kind"], asset["id"], asset["installState"])
		}
	}
}

// The update check is the one request the app makes on its own, so it is pinned: one GET, to the releases metadata of this repository on
// GitHub's API, and no asset and no other request with it.
func TestTheUpdateCheckIsTheOnlyRequestAtStartupAndOnlyToTheGitHubReleasesAPI(t *testing.T) {
	cache := emptyUserProfile(t)
	guard := closeTheNetwork(t)
	host := launchHost(t, guard, launch{}) // check_on_startup is on by default

	whatTheFirstScreenReads(t, host)
	waitForRequests(t, guard, 1)
	settleBackgroundWork()

	seen := guard.seen()
	if len(seen) != 1 {
		t.Fatalf("the update check should be the only request, got %v", seen)
	}
	if want := "GET https://api.github.com/repos/countrymanprime/narration-utils/releases"; !strings.HasPrefix(seen[0], want) {
		t.Fatalf("the request was %q, want a GET of %s", seen[0], want)
	}
	if files := filesUnder(t, cache); len(files) != 0 {
		t.Fatalf("the update check put files in the asset cache: %v", files)
	}
	host.mu.RLock()
	jobs, staged := len(host.installJobs), host.updateJob
	host.mu.RUnlock()
	if jobs != 0 || staged != nil {
		t.Fatalf("the update check started a download: %d install job(s), update job %v", jobs, staged)
	}
}

// An update check the narrator switched off is not made, even when it was on when the app started.
func TestSwitchingTheUpdateCheckOffStopsTheOnlyStartupRequest(t *testing.T) {
	emptyUserProfile(t)
	guard := closeTheNetwork(t)
	host := launchHost(t, guard, launch{keepDefaultDelay: true})
	if err := host.saveSettings("Updates", "global", map[string]*string{"check_on_startup": ptr("false")}); err != nil {
		t.Fatal(err)
	}
	host.autoCheckForUpdate(host.updateContext()) // what the startup goroutine runs when its delay is over
	if seen := guard.seen(); len(seen) != 0 {
		t.Fatalf("a switched-off update check still made requests: %v", seen)
	}
}

func TestChoosingAModelInSettingsMakesNoRequestAndDownloadsNothing(t *testing.T) {
	cache := emptyUserProfile(t)
	guard := closeTheNetwork(t)
	host := launchHost(t, guard, launch{updatesOff: true})
	// A project is open, so the project scope can be chosen too.
	host.mu.Lock()
	host.configureLocked(config{repoRoot: host.config.repoRoot, projectFolder: t.TempDir()})
	host.mu.Unlock()

	// Every approved language model, and the largest Whisper model and the voice, selected while none of them is installed.
	choices := []struct {
		tool, key, value string
	}{
		{"TranscriptCompare", "model_size", "large-v3"},
		{"Piper", "tts_voice_id", "en_US-ljspeech-high"},
	}
	for _, id := range host.registry().spacy.IDs() {
		choices = append(choices, struct{ tool, key, value string }{"ManuscriptGuide", "spacy_model", id})
	}
	for _, scope := range []string{"global", "project"} {
		for _, choice := range choices {
			if _, err := host.SystemSaveSettings(choice.tool, scope, map[string]*string{choice.key: ptr(choice.value)}); err != nil {
				t.Fatalf("selecting %s %s in the %s scope: %v", choice.key, choice.value, scope, err)
			}
			if got, _ := host.services().settings.Effective(choice.tool, choice.key, ""); got != choice.value {
				t.Fatalf("%s is %q after selecting %q", choice.key, got, choice.value)
			}
		}
	}
	whatTheFirstScreenReads(t, host)
	settleBackgroundWork()

	if seen := guard.seen(); len(seen) != 0 {
		t.Fatalf("choosing a model made requests: %v", seen)
	}
	host.mu.RLock()
	jobs := len(host.installJobs)
	host.mu.RUnlock()
	if jobs != 0 {
		t.Fatalf("choosing a model started %d install job(s)", jobs)
	}
	if files := filesUnder(t, cache); len(files) != 0 {
		t.Fatalf("choosing a model put files in the asset cache: %v", files)
	}
	for _, entry := range answer(t)(host.AssetsList())["assets"].([]any) {
		if asset := entry.(map[string]any); asset["installState"] != "not_installed" {
			t.Fatalf("%v %v is %v after only being selected", asset["kind"], asset["id"], asset["installState"])
		}
	}
}

// The retired bootstrap kept voices and models in `.piper`, `.runtime` and `.bootstrap` folders (owner decision Q7: they are ignored and
// documented, never adopted, because a file whose version and hash nobody checked is exactly what the catalog exists to refuse). A file
// there is not an installed asset, even when it is byte for byte the catalog's own file in the layout the cache uses.
func TestAFileInARetiredBootstrapFolderIsNeverAnInstalledAsset(t *testing.T) {
	f := newInstallFixture(t, false)
	cacheRoot := f.host.registry().base
	legacyHomes := []string{
		filepath.Join(filepath.Dir(cacheRoot), ".piper"),     // next to the assets folder
		filepath.Join(cacheRoot, ".runtime"),                 // inside it
		filepath.Join(filepath.Dir(cacheRoot), ".bootstrap"), // next to it
	}
	voice, _ := f.host.registry().tts.Voice("v1")
	model, _ := f.host.registry().whisper.Model("m1")
	for _, home := range legacyHomes {
		for _, asset := range []struct{ kind, id, version string }{{"piper", "v1", voice.Version}, {"faster-whisper", "m1", model.Version}} {
			// The exact, correct bytes, in the layout an install would have produced, so only the folder is wrong.
			dir := assets.Dir(home, asset.kind, asset.id, asset.version)
			if err := os.MkdirAll(dir, 0o755); err != nil {
				t.Fatal(err)
			}
			for name, body := range map[string][]byte{"a.onnx": f.bodies["/a.onnx"], "a.onnx.json": f.bodies["/a.onnx.json"]} {
				if err := os.WriteFile(filepath.Join(dir, name), body, 0o600); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
	// The same files flat in the legacy folder, as the retired bootstrap kept them.
	for _, home := range legacyHomes {
		if err := os.WriteFile(filepath.Join(home, "a.onnx"), f.bodies["/a.onnx"], 0o600); err != nil {
			t.Fatal(err)
		}
	}

	guard := closeTheNetwork(t)
	list := answer(t)(f.host.AssetsList())
	if voiceRow, modelRow := listedAsset(t, list, "tts", "v1"), listedAsset(t, list, "whisper", "m1"); voiceRow["installState"] != "not_installed" || modelRow["installState"] != "not_installed" {
		t.Fatalf("legacy files were adopted: voice %v, model %v", voiceRow["installState"], modelRow["installState"])
	}
	if _, _, err := f.host.registry().tts.Paths("v1"); err == nil {
		t.Fatal("the preview voice resolved to files in a retired folder")
	}
	if _, err := f.host.registry().whisper.Dir("m1"); err == nil {
		t.Fatal("the Whisper model resolved to files in a retired folder")
	}
	if list["totalInstalledBytes"] != float64(0) {
		t.Fatalf("totalInstalledBytes = %v, want 0: nothing is installed", list["totalInstalledBytes"])
	}
	if seen := guard.seen(); len(seen) != 0 {
		t.Fatalf("looking for legacy files made requests: %v", seen)
	}
}

// The same on a real first launch: files that look like the shipped voice, in the retired folders of the real checkout layout, leave every
// approved asset uninstalled.
func TestARetiredBootstrapFolderNextToTheRealCacheIsIgnoredAtLaunch(t *testing.T) {
	cache := emptyUserProfile(t)
	guard := closeTheNetwork(t)
	appData := filepath.Dir(filepath.Dir(cache)) // the per-user cache folder that holds narration-utils/
	for _, home := range []string{filepath.Join(appData, ".piper"), filepath.Join(appData, ".runtime"), filepath.Join(appData, ".bootstrap"), filepath.Join(cache, ".piper")} {
		if err := os.MkdirAll(home, 0o755); err != nil {
			t.Fatal(err)
		}
		for _, name := range []string{"en_US-ljspeech-high.onnx", "en_US-ljspeech-high.onnx.json", "model.bin"} {
			if err := os.WriteFile(filepath.Join(home, name), []byte("not verified by anyone"), 0o600); err != nil {
				t.Fatal(err)
			}
		}
	}
	host := launchHost(t, guard, launch{updatesOff: true})
	for _, entry := range answer(t)(host.AssetsList())["assets"].([]any) {
		if asset := entry.(map[string]any); asset["installState"] != "not_installed" {
			t.Fatalf("%v %v is %v: a retired folder was adopted", asset["kind"], asset["id"], asset["installState"])
		}
	}
}
