package assets

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// installOne installs one small file and returns where it went. Every test of the manifest starts from a real install.
func installOne(t *testing.T, body string) (root string, files []File, path string) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(body)) }))
	t.Cleanup(server.Close)
	root = t.TempDir()
	files = []File{fileFor(server.URL, []byte(body))}
	if err := Install(context.Background(), root, "p", "id", "1.2", files); err != nil {
		t.Fatal(err)
	}
	return root, files, filepath.Join(Dir(root, "p", "id", "1.2"), "payload.bin")
}

func TestTheManifestKeepsTheVersionProvenanceAndEveryHash(t *testing.T) {
	root, files, _ := installOne(t, "the payload")
	manifest, err := ReadManifest(Dir(root, "p", "id", "1.2"))
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Provider != "p" || manifest.ID != "id" || manifest.Version != "1.2" {
		t.Fatalf("identity = %+v", manifest)
	}
	if len(manifest.Files) != 1 || manifest.Files[0].SHA256 != files[0].SHA256 || manifest.Files[0].Size != files[0].Size || manifest.Files[0].URL != files[0].URL {
		t.Fatalf("files = %+v, want the catalog entry with its hash, size and source", manifest.Files)
	}
	if manifest.Files[0].ModTime == 0 {
		t.Fatal("the modification time is what the cheap check compares")
	}
	installed, err := time.Parse(time.RFC3339, manifest.InstalledAt)
	if err != nil || time.Since(installed) > time.Minute {
		t.Fatalf("installedAt = %q (%v)", manifest.InstalledAt, err)
	}
}

// The listing does not read the files: a file that was changed in place, to the same size and with the same time, is not noticed until the
// narrator asks for a Verify (or the asset is loaded for the first time in a session). That is the price of a listing that costs nothing.
func TestStateTrustsTheManifestAndVerifyHashesEveryFile(t *testing.T) {
	root, files, path := installOne(t, "the payload")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("THE PAYLOAD"), 0o600); err != nil { // same size, different bytes
		t.Fatal(err)
	}
	if err := os.Chtimes(path, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	if got := State(root, "p", "id", "1.2", files); got != "installed" {
		t.Fatalf("State = %s: the listing must not hash the files", got)
	}
	if got := Verify(root, "p", "id", "1.2", files); got != "verification_failed" {
		t.Fatalf("Verify = %s, want verification_failed: it always hashes", got)
	}
	if got := State(root, "p", "id", "1.2", files); got != "verification_failed" {
		t.Fatalf("State after a failed Verify = %s: it must not trust the manifest any more", got)
	}
}

func TestStateNoticesAFileWhoseSizeChanged(t *testing.T) {
	root, files, path := installOne(t, "the payload")
	if err := os.WriteFile(path, []byte("short"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := State(root, "p", "id", "1.2", files); got != "verification_failed" {
		t.Fatalf("State = %s", got)
	}
}

func TestStateNoticesAFileThatWasTouchedAfterTheInstall(t *testing.T) {
	root, files, path := installOne(t, "the payload")
	later := time.Now().Add(time.Hour)
	if err := os.Chtimes(path, later, later); err != nil {
		t.Fatal(err)
	}
	// The time no longer matches, so the cheap check does not vouch for it: the hash does, and it still matches.
	if got := State(root, "p", "id", "1.2", files); got != "installed" {
		t.Fatalf("State = %s, want the content to be hashed and found good", got)
	}
}

func TestStateReportsAMissingFileAsNotInstalled(t *testing.T) {
	root, files, path := installOne(t, "the payload")
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if got := State(root, "p", "id", "1.2", files); got != "not_installed" {
		t.Fatalf("State = %s", got)
	}
}

// An asset installed before the manifest held its files (only provider, id and version) has nothing to trust, so it is hashed, once, and
// Verify writes the full manifest so the next listing is free.
func TestAnOldManifestIsHashedAndVerifyUpgradesIt(t *testing.T) {
	root, files, path := installOne(t, "the payload")
	dir := Dir(root, "p", "id", "1.2")
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(`{"provider":"p","id":"id","version":"1.2"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := State(root, "p", "id", "1.2", files); got != "installed" {
		t.Fatalf("State = %s", got)
	}
	if got := Verify(root, "p", "id", "1.2", files); got != "installed" {
		t.Fatalf("Verify = %s", got)
	}
	manifest, err := ReadManifest(dir)
	if err != nil || len(manifest.Files) != 1 || manifest.VerifiedAt == "" {
		t.Fatalf("manifest after Verify = %+v (%v)", manifest, err)
	}
	// Now the cheap path is in force: corrupt the file in place and it is trusted until the next Verify.
	info, _ := os.Stat(path)
	_ = os.WriteFile(path, []byte("THE PAYLOAD"), 0o600)
	_ = os.Chtimes(path, info.ModTime(), info.ModTime())
	if got := State(root, "p", "id", "1.2", files); got != "installed" {
		t.Fatalf("State = %s", got)
	}
}

func TestAChangedCatalogEntryIsNotVouchedForByAnOldManifest(t *testing.T) {
	root, files, _ := installOne(t, "the payload")
	changed := []File{{Name: files[0].Name, URL: files[0].URL, SHA256: strings.Repeat("0", 64), Size: files[0].Size}}
	if got := State(root, "p", "id", "1.2", changed); got != "verification_failed" {
		t.Fatalf("State = %s: a catalog that names other bytes must not be satisfied by the installed ones", got)
	}
}

func TestReadyHashesOncePerSessionThenTrustsTheManifest(t *testing.T) {
	root, files, path := installOne(t, "the payload")
	Forget(root, "p", "id", "1.2")
	if got := Ready(root, "p", "id", "1.2", files); got != "installed" {
		t.Fatalf("first Ready = %s", got)
	}
	info, _ := os.Stat(path)
	_ = os.WriteFile(path, []byte("THE PAYLOAD"), 0o600)
	_ = os.Chtimes(path, info.ModTime(), info.ModTime())
	if got := Ready(root, "p", "id", "1.2", files); got != "installed" {
		t.Fatalf("second Ready = %s: it hashes once per session, not on every use", got)
	}
	Forget(root, "p", "id", "1.2")
	if got := Ready(root, "p", "id", "1.2", files); got != "verification_failed" {
		t.Fatalf("Ready after Forget = %s, want the hash to catch the change", got)
	}
}

func TestReadNeverSucceedsOnADamagedManifestFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadManifest(dir); err == nil {
		t.Fatal("a damaged manifest must be an error, not an empty one")
	}
	var probe map[string]any
	if json.Unmarshal([]byte("{}"), &probe) != nil {
		t.Fatal("unreachable")
	}
}
