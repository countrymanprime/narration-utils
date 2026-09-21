package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/assets"
)

// answer reads a binding JSON answer into a map, so a test looks at what the UI receives: answer(t)(host.AssetsList()).
func answer(t *testing.T) func(string, error) map[string]any {
	return func(raw string, err error) map[string]any {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		var out map[string]any
		if err := json.Unmarshal([]byte(raw), &out); err != nil {
			t.Fatalf("%q is not a JSON object: %v", raw, err)
		}
		return out
	}
}

func listedAsset(t *testing.T, catalog map[string]any, kind, id string) map[string]any {
	t.Helper()
	for _, entry := range catalog["assets"].([]any) {
		asset := entry.(map[string]any)
		if asset["kind"] == kind && asset["id"] == id {
			return asset
		}
	}
	t.Fatalf("%s %s is not in the list %v", kind, id, catalog["assets"])
	return nil
}

func TestAssetsListNamesEveryApprovedAssetOfEveryKindWithItsState(t *testing.T) {
	f := newInstallFixture(t, false)
	close(f.release)
	first, _ := f.host.startTtsInstall("v1")
	waitForPhase(t, voiceState(f, first["id"].(string)), "success")

	catalog := answer(t)(f.host.AssetsList())
	if catalog["cacheRoot"] == "" || !strings.Contains(catalog["cacheRoot"].(string), "cache") {
		t.Fatalf("cacheRoot = %v, want the folder downloads go to", catalog["cacheRoot"])
	}
	voice := listedAsset(t, catalog, "tts", "v1")
	model := listedAsset(t, catalog, "whisper", "m1")
	if voice["installState"] != "installed" || model["installState"] != "not_installed" {
		t.Fatalf("states = %v and %v", voice["installState"], model["installState"])
	}
	if voice["downloadSize"] != float64(5000) || voice["displayName"] != "V" || voice["version"] != "1" {
		t.Fatalf("voice = %v", voice)
	}
	if path, _ := voice["path"].(string); !strings.HasSuffix(filepath.ToSlash(path), "piper/v1/1") {
		t.Fatalf("voice path = %q, want where it is installed", path)
	}
	if voice["installedAt"] == "" || voice["verifiedAt"] == "" || model["installedAt"] != "" {
		t.Fatalf("installedAt/verifiedAt: voice %v %v, model %v", voice["installedAt"], voice["verifiedAt"], model["installedAt"])
	}
	if catalog["totalInstalledBytes"] != float64(5000) {
		t.Fatalf("totalInstalledBytes = %v, want the 5000 bytes of the one installed asset", catalog["totalInstalledBytes"])
	}
	if voice["kindLabel"] == "" || voice["kindLabel"] == model["kindLabel"] {
		t.Fatalf("kind labels %v and %v should tell a voice from a model", voice["kindLabel"], model["kindLabel"])
	}
}

func TestAssetsListShowsADownloadThatIsRunningSoAPageCanFollowIt(t *testing.T) {
	f := newInstallFixture(t, false)
	started := answer(t)(f.host.AssetsInstall("whisper", "m1"))
	if started["kind"] != "whisper" || started["assetId"] != "m1" || started["phase"] != "downloading" {
		t.Fatalf("started = %v", started)
	}
	model := listedAsset(t, answer(t)(f.host.AssetsList()), "whisper", "m1")
	if model["activeJobId"] != started["id"] {
		t.Fatalf("activeJobId = %v, want %v", model["activeJobId"], started["id"])
	}
	cancelled := answer(t)(f.host.AssetsInstallCancel(started["id"].(string)))
	if cancelled["id"] != started["id"] {
		t.Fatalf("cancel = %v", cancelled)
	}
	waitForPhase(t, func() map[string]any { return answer(t)(f.host.AssetsInstallState(started["id"].(string))) }, "cancelled")
	if again := listedAsset(t, answer(t)(f.host.AssetsList()), "whisper", "m1"); again["activeJobId"] != "" {
		t.Fatalf("activeJobId = %v after the download ended", again["activeJobId"])
	}
}

func TestAssetsInstallRefusesAKindOrAnAssetThatIsNotInTheApprovedCatalog(t *testing.T) {
	f := newInstallFixture(t, false)
	if _, err := f.host.AssetsInstall("moonshine", "x"); err == nil || !strings.Contains(err.Error(), "not an approved kind") {
		t.Fatalf("unknown kind: %v", err)
	}
	if _, err := f.host.AssetsInstall("tts", "nope"); err == nil || !strings.Contains(err.Error(), "not in the approved catalog") {
		t.Fatalf("unknown id: %v", err)
	}
}

func TestAssetsVerifyReportsADamagedAssetAndInstallRepairsIt(t *testing.T) {
	f := newInstallFixture(t, false)
	close(f.release)
	first, _ := f.host.startTtsInstall("v1")
	waitForPhase(t, voiceState(f, first["id"].(string)), "success")
	voice, _ := f.host.registry().tts.Voice("v1")
	file := filepath.Join(f.host.registry().tts.InstallDir("v1"), voice.Files[0].Name)
	if err := os.WriteFile(file, []byte(strings.Repeat("x", 4000)), 0o600); err != nil { // same size, different bytes
		t.Fatal(err)
	}
	if got := answer(t)(f.host.AssetsVerify("tts", "v1")); got["installState"] != "verification_failed" || got["kind"] != "tts" || got["id"] != "v1" {
		t.Fatalf("verify = %v, want verification_failed", got)
	}
	if listed := listedAsset(t, answer(t)(f.host.AssetsList()), "tts", "v1"); listed["installState"] != "verification_failed" {
		t.Fatalf("the list says %v: a damaged asset must be listed as needing repair", listed["installState"])
	}
	repair := answer(t)(f.host.AssetsInstall("tts", "v1"))
	waitForPhase(t, func() map[string]any { return answer(t)(f.host.AssetsInstallState(repair["id"].(string))) }, "success")
	if got := answer(t)(f.host.AssetsVerify("tts", "v1")); got["installState"] != "installed" {
		t.Fatalf("after the repair verify = %v", got)
	}
}

func TestAssetsRemoveDeletesOnlyThatAssetAndRefusesWhileItDownloads(t *testing.T) {
	f := newInstallFixture(t, false)
	started := answer(t)(f.host.AssetsInstall("tts", "v1"))
	if _, err := f.host.AssetsRemove("tts", "v1"); err == nil || !strings.Contains(err.Error(), "downloading") {
		t.Fatalf("remove while downloading: %v", err)
	}
	close(f.release)
	waitForPhase(t, func() map[string]any { return answer(t)(f.host.AssetsInstallState(started["id"].(string))) }, "success")
	other, _ := f.host.startWhisperInstall("m1")
	waitForPhase(t, func() map[string]any { s, _ := f.host.whisperInstallState(other["id"].(string)); return s }, "success")

	if _, err := f.host.AssetsRemove("tts", "v1"); err != nil {
		t.Fatal(err)
	}
	catalog := answer(t)(f.host.AssetsList())
	if listedAsset(t, catalog, "tts", "v1")["installState"] != "not_installed" || listedAsset(t, catalog, "whisper", "m1")["installState"] != "installed" {
		t.Fatalf("removing the voice must not touch the model: %v", catalog["assets"])
	}
}

// The registry is built once and outlives every project: attaching another project does not rebuild the managers (they are not
// project-scoped), so nothing that holds one can see it swapped underneath it.
func TestTheAssetRegistryIsNotRebuiltWhenAProjectIsAttached(t *testing.T) {
	f := newInstallFixture(t, false)
	before := f.host.registry()
	f.host.mu.Lock()
	f.host.configureLocked(config{repoRoot: t.TempDir(), manuscriptPython: "python", comparePython: "python", teleprompterPython: "python"})
	f.host.mu.Unlock()
	if f.host.registry() != before {
		t.Fatal("configureLocked replaced the asset registry")
	}
	if f.host.registry().tts != before.tts || f.host.registry().whisper != before.whisper {
		t.Fatal("configureLocked replaced a manager")
	}
}

func TestAssetsListSaysWhyWhenThereIsNoCacheFolder(t *testing.T) {
	host := &Host{assets: &assetRegistry{unavailable: "the per-user cache folder for downloaded models could not be found"}, installJobs: map[string]*installJob{}}
	if _, err := host.AssetsList(); err == nil || !strings.Contains(err.Error(), "per-user cache folder") {
		t.Fatalf("err = %v, want the reason and not a bare 'unavailable'", err)
	}
	if _, err := host.startTtsInstall("v1"); err == nil || !strings.Contains(err.Error(), "per-user cache folder") {
		t.Fatalf("install err = %v", err)
	}
}

// Every list entry carries its installed-or-not detail without hashing: a listing of installed assets reads no file contents.
func TestAssetsListReadsNoFileContents(t *testing.T) {
	f := newInstallFixture(t, false)
	close(f.release)
	first, _ := f.host.startTtsInstall("v1")
	waitForPhase(t, voiceState(f, first["id"].(string)), "success")
	before := assets.FilesHashed()
	for range 5 {
		_, _ = f.host.AssetsList()
	}
	if read := assets.FilesHashed() - before; read != 0 {
		t.Fatalf("listing read %d files: a list must trust the manifest", read)
	}
	_ = time.Now()
}
