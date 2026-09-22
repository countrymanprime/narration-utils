package assets

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRepairReplacesACorruptAssetWithAFreshDownload(t *testing.T) {
	root, files, path := installOne(t, "the payload")
	if err := os.WriteFile(path, []byte("garbage!!!!"), 0o600); err != nil {
		t.Fatal(err)
	}
	Forget(root, "p", "id", "1.2")
	if got := Verify(root, "p", "id", "1.2", files); got != "verification_failed" {
		t.Fatalf("Verify = %s", got)
	}
	if err := Repair(context.Background(), root, "p", "id", "1.2", files, Options{}); err != nil {
		t.Fatal(err)
	}
	if got := Verify(root, "p", "id", "1.2", files); got != "installed" {
		t.Fatalf("after Repair, Verify = %s", got)
	}
	leftovers, _ := filepath.Glob(Dir(root, "p", "id", "1.2") + ".*")
	if len(leftovers) != 0 {
		t.Fatalf("Repair left %v beside the asset", leftovers)
	}
}

// Repair of something that is fine does nothing and downloads nothing.
func TestRepairOfAGoodAssetDownloadsNothing(t *testing.T) {
	requests := 0
	body := []byte("the payload")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { requests++; _, _ = w.Write(body) }))
	defer server.Close()
	root := t.TempDir()
	files := []File{fileFor(server.URL, body)}
	if err := Install(context.Background(), root, "p", "id", "1", files); err != nil {
		t.Fatal(err)
	}
	if err := Repair(context.Background(), root, "p", "id", "1", files, Options{}); err != nil {
		t.Fatal(err)
	}
	if requests != 1 {
		t.Fatalf("%d requests, want the one from the install", requests)
	}
}

// The old copy is renamed aside, not removed, so a repair whose download fails leaves the narrator what they had (a damaged file is
// still more than nothing to look at) and never leaves neither.
func TestAFailedRepairPutsTheOldCopyBack(t *testing.T) {
	root, files, path := installOne(t, "the payload")
	if err := os.WriteFile(path, []byte("garbage!!!!"), 0o600); err != nil {
		t.Fatal(err)
	}
	Forget(root, "p", "id", "1.2")
	dead := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	dead.Close()
	broken := []File{{Name: files[0].Name, URL: dead.URL, SHA256: files[0].SHA256, Size: files[0].Size}}
	if err := Repair(context.Background(), root, "p", "id", "1.2", broken, Options{}); err == nil {
		t.Fatal("a repair with no network must fail")
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("the old copy is gone: %v", err)
	}
	if got := Verify(root, "p", "id", "1.2", files); got != "verification_failed" {
		t.Fatalf("Verify = %s: what is left is the damaged copy, reported as damaged", got)
	}
}

// Replacing a corrupt target is a rename aside and a rename into place: the target is never absent between the two steps for a reader that
// arrives at that moment. The test cannot stop time between them, so it checks the observable half: the staging swap keeps the old one
// until the new one is in place.
func TestInstallingOverACorruptTargetSwapsItInPlace(t *testing.T) {
	body := []byte("the payload")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(body) }))
	defer server.Close()
	root := t.TempDir()
	files := []File{fileFor(server.URL, body)}
	target := Dir(root, "p", "id", "1")
	if err := os.MkdirAll(target, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, "payload.bin"), []byte("garbage!!!"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Install(context.Background(), root, "p", "id", "1", files); err != nil {
		t.Fatal(err)
	}
	if got := State(root, "p", "id", "1", files); got != "installed" {
		t.Fatalf("State = %s", got)
	}
	leftovers, _ := filepath.Glob(target + ".*")
	if len(leftovers) != 0 {
		t.Fatalf("left %v", leftovers)
	}
}

func TestPreflightIsAskedWhatIsStillToDownloadAndCanRefuse(t *testing.T) {
	body := []byte(strings.Repeat("x", 4096))
	server := newRangeServer(t, body, 0, true)
	root := t.TempDir()
	files := []File{fileFor(server.URL, body)}
	var asked int64 = -1
	refuse := errors.New("no room")
	err := InstallWith(context.Background(), root, "p", "id", "1", files, Options{Preflight: func(_ string, total int64) error { asked = total; return refuse }})
	if !errors.Is(err, refuse) || asked != 4096 {
		t.Fatalf("err = %v, asked %d: the whole file is still to come and the refusal stops the install", err, asked)
	}
	if server.requests != 0 {
		t.Fatal("a refused preflight must not touch the network")
	}
	// With half of it already in the staging folder, only the other half needs room.
	if err := os.MkdirAll(stagingDir(root), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stagingDir(root), "payload.bin.part"), body[:1024], 0o600); err != nil {
		t.Fatal(err)
	}
	_ = InstallWith(context.Background(), root, "p", "id", "1", files, Options{Preflight: func(_ string, total int64) error { asked = total; return refuse }})
	if asked != 3072 {
		t.Fatalf("asked %d with 1024 bytes already there, want 3072", asked)
	}
}

func TestRequireFreeSpaceRefusesWhenTheDiskCannotHoldTheDownloadAndSaysHowMuch(t *testing.T) {
	previous := freeBytes
	defer func() { freeBytes = previous }()
	freeBytes = func(string) (uint64, error) { return 200 << 20, nil }
	if err := RequireFreeSpace(t.TempDir(), 100<<20); err != nil {
		t.Fatalf("100 MB fits in 200 MB free: %v", err)
	}
	err := RequireFreeSpace(t.TempDir(), 3<<30)
	var short *InsufficientSpaceError
	if !errors.As(err, &short) || short.Need <= 3<<30 || short.Free != 200<<20 {
		t.Fatalf("err = %v, want an InsufficientSpaceError that names what is needed (with headroom) and what is free", err)
	}
	if text := err.Error(); !strings.Contains(text, "GB") || !strings.Contains(text, "MB") {
		t.Fatalf("message %q should name sizes a narrator can read", text)
	}
	freeBytes = func(string) (uint64, error) { return 0, errors.New("the volume is not there") }
	if err := RequireFreeSpace(t.TempDir(), 1); err != nil {
		t.Fatalf("a disk that cannot be measured must not block the install: %v", err)
	}
}

func TestCleanStaleRemovesOldLeftoversAndKeepsWhatCouldStillBeResumed(t *testing.T) {
	root := t.TempDir()
	old := time.Now().Add(-10 * 24 * time.Hour)
	fresh := time.Now().Add(-time.Hour)
	must := func(path string, when time.Time) {
		if err := os.MkdirAll(path, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path, when, when); err != nil {
			t.Fatal(err)
		}
	}
	// The old copy carries the old install's modification time (a rename does not change it): its age is in its name.
	staleAside := fmt.Sprintf("1.old-%d", time.Now().Add(-3*time.Hour).UnixNano())
	freshAside := fmt.Sprintf("1.old-%d", time.Now().Add(-time.Minute).UnixNano())
	must(filepath.Join(root, "p", "a", "1.installing"), old)
	must(filepath.Join(root, "p", "b", "1.installing"), fresh)
	must(filepath.Join(root, "p", "c", "1"), old)
	must(filepath.Join(root, "p", "c", staleAside), old)
	must(filepath.Join(root, "p", "d", "1"), old)
	must(filepath.Join(root, "p", "d", freshAside), old) // a minute old by its name, months old by its time: it must be kept
	must(filepath.Join(root, "p", "e", "1"), old)        // an installed asset is never touched, however old
	removed := CleanStale(root)
	if len(removed) != 2 {
		t.Fatalf("removed %v, want the week-old staging folder and the three-hour-old aside copy", removed)
	}
	for path, want := range map[string]bool{
		filepath.Join(root, "p", "a", "1.installing"): false,
		filepath.Join(root, "p", "b", "1.installing"): true,
		filepath.Join(root, "p", "c", staleAside):     false,
		filepath.Join(root, "p", "c", "1"):            true,
		filepath.Join(root, "p", "d", freshAside):     true,
		filepath.Join(root, "p", "e", "1"):            true,
	} {
		if _, err := os.Stat(path); (err == nil) != want {
			t.Errorf("%s exists = %v, want %v", path, err == nil, want)
		}
	}
	if len(CleanStale(filepath.Join(root, "nothing-here"))) != 0 {
		t.Fatal("a root that does not exist has nothing to clean")
	}
}

// A crash between the two renames of a swap leaves the old copy aside and nothing in place: it is the only copy there is, so it is put back.
func TestCleanStalePutsBackTheOnlyCopyWhenTheInstallIsMissing(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "p", "a")
	name := fmt.Sprintf("1.old-%d", time.Now().Add(-5*time.Hour).UnixNano())
	if err := os.MkdirAll(filepath.Join(dir, name), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, name, "model.bin"), []byte("only copy"), 0o600); err != nil {
		t.Fatal(err)
	}
	if removed := CleanStale(root); len(removed) != 0 {
		t.Fatalf("removed %v: nothing may be deleted when it is the only copy", removed)
	}
	if bytes, err := os.ReadFile(filepath.Join(dir, "1", "model.bin")); err != nil || string(bytes) != "only copy" {
		t.Fatalf("the old copy was not put back: %v", err)
	}
}
