package assets

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// buildZip is an archive holding the given files, the way a model wheel holds its model.
func buildZip(t *testing.T, entries map[string]string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for name, body := range entries {
		file, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if strings.HasSuffix(name, "/") {
			continue // a folder entry holds no bytes
		}
		if _, err := file.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

// archiveFile is the catalog entry of an archive that is unpacked into "model" and whose bytes, unpacked, are expected to be about expand.
func archiveFile(url string, archive []byte, expand int64) File {
	sum := sha256.Sum256(archive)
	return File{Name: "model.whl", URL: url, SHA256: hex.EncodeToString(sum[:]), Size: int64(len(archive)), Extract: "model", Expand: expand}
}

func serve(t *testing.T, body []byte) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(body) }))
	t.Cleanup(server.Close)
	return server
}

var modelEntries = map[string]string{
	"en_core_web_sm/meta.json":                        `{"name":"core_web_sm"}`,
	"en_core_web_sm/en_core_web_sm-3.8.0/config.cfg":  "[nlp]\nlang = en\n",
	"en_core_web_sm/en_core_web_sm-3.8.0/ner/model":   strings.Repeat("weights", 100),
	"en_core_web_sm-3.8.0.dist-info/LICENSES_SOURCES": "WordNet notice",
}

func TestAnArchiveIsUnpackedIntoTheInstallAndTheArchiveIsNotKept(t *testing.T) {
	archive := buildZip(t, modelEntries)
	files := []File{archiveFile(serve(t, archive).URL, archive, 2000)}
	root := t.TempDir()
	if err := Install(context.Background(), root, "spacy", "sm", "3.8.0", files); err != nil {
		t.Fatal(err)
	}
	dir := Dir(root, "spacy", "sm", "3.8.0")
	if body, err := os.ReadFile(filepath.Join(dir, "model", "en_core_web_sm", "en_core_web_sm-3.8.0", "config.cfg")); err != nil || !strings.Contains(string(body), "lang = en") {
		t.Fatalf("the model was not unpacked: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "model.whl")); !os.IsNotExist(err) {
		t.Fatal("the archive must not be kept: the cache would hold every model twice")
	}
	if notice, err := os.ReadFile(filepath.Join(dir, "model", "en_core_web_sm-3.8.0.dist-info", "LICENSES_SOURCES")); err != nil || string(notice) != "WordNet notice" {
		t.Fatalf("the licence notices travel with the model: %v", err)
	}
	if got := State(root, "spacy", "sm", "3.8.0", files); got != "installed" {
		t.Fatalf("State = %s", got)
	}
}

// The manifest records every file that came out of the archive, with the hash of its bytes, so the cheap check and Verify work on what is
// really on disk although the archive is gone.
func TestTheManifestRecordsEveryUnpackedFile(t *testing.T) {
	archive := buildZip(t, modelEntries)
	files := []File{archiveFile(serve(t, archive).URL, archive, 2000)}
	root := t.TempDir()
	if err := Install(context.Background(), root, "spacy", "sm", "3.8.0", files); err != nil {
		t.Fatal(err)
	}
	manifest, err := ReadManifest(Dir(root, "spacy", "sm", "3.8.0"))
	if err != nil {
		t.Fatal(err)
	}
	if len(manifest.Files) != 1 || manifest.Files[0].SHA256 != files[0].SHA256 || len(manifest.Files[0].Extracted) != len(modelEntries) {
		t.Fatalf("manifest files = %+v, want the archive with its %d unpacked files", manifest.Files, len(modelEntries))
	}
	for _, entry := range manifest.Files[0].Extracted {
		if entry.SHA256 == "" || entry.Size <= 0 || entry.ModTime == 0 || !strings.HasPrefix(entry.Path, "model/") {
			t.Fatalf("unpacked entry %+v is missing its hash, size, time or place", entry)
		}
	}
}

func TestStateAndVerifyWorkOnTheUnpackedFilesOfAnArchive(t *testing.T) {
	archive := buildZip(t, modelEntries)
	files := []File{archiveFile(serve(t, archive).URL, archive, 2000)}
	root := t.TempDir()
	if err := Install(context.Background(), root, "spacy", "sm", "3.8.0", files); err != nil {
		t.Fatal(err)
	}
	weights := filepath.Join(Dir(root, "spacy", "sm", "3.8.0"), "model", "en_core_web_sm", "en_core_web_sm-3.8.0", "ner", "model")
	info, _ := os.Stat(weights)
	if err := os.WriteFile(weights, []byte(strings.Repeat("WEIGHTS", 100)), 0o600); err != nil { // same size, other bytes
		t.Fatal(err)
	}
	_ = os.Chtimes(weights, info.ModTime(), info.ModTime())
	if got := State(root, "spacy", "sm", "3.8.0", files); got != "installed" {
		t.Fatalf("State = %s: the listing trusts the manifest", got)
	}
	if got := Verify(root, "spacy", "sm", "3.8.0", files); got != "verification_failed" {
		t.Fatalf("Verify = %s, want the changed weights found", got)
	}
	if got := State(root, "spacy", "sm", "3.8.0", files); got != "verification_failed" {
		t.Fatalf("State after Verify = %s", got)
	}
	if err := os.Remove(weights); err != nil {
		t.Fatal(err)
	}
	if got := hashState(Dir(root, "spacy", "sm", "3.8.0"), files); got != "not_installed" && got != "verification_failed" {
		t.Fatalf("a missing unpacked file must not verify: %s", got)
	}
}

func TestRepairDownloadsAgainAnArchiveThatUnpackedToADamagedModel(t *testing.T) {
	archive := buildZip(t, modelEntries)
	files := []File{archiveFile(serve(t, archive).URL, archive, 2000)}
	root := t.TempDir()
	if err := Install(context.Background(), root, "spacy", "sm", "3.8.0", files); err != nil {
		t.Fatal(err)
	}
	weights := filepath.Join(Dir(root, "spacy", "sm", "3.8.0"), "model", "en_core_web_sm", "en_core_web_sm-3.8.0", "ner", "model")
	if err := os.WriteFile(weights, []byte("broken"), 0o600); err != nil {
		t.Fatal(err)
	}
	Forget(root, "spacy", "sm", "3.8.0")
	if err := Repair(context.Background(), root, "spacy", "sm", "3.8.0", files, Options{}); err != nil {
		t.Fatal(err)
	}
	if got := Verify(root, "spacy", "sm", "3.8.0", files); got != "installed" {
		t.Fatalf("after Repair Verify = %s", got)
	}
}

// What a hostile or broken archive can do is limited to failing the install: nothing outside the install folder is written, and nothing
// half-unpacked is left as an installed asset.
func TestAnArchiveThatWouldWriteOutsideTheInstallOrIsTooBigIsRefused(t *testing.T) {
	cases := map[string]map[string]string{
		"a path that climbs out":  {"../escape.txt": "x", "model/ok": "y"},
		"an absolute path":        {"/etc/escape.txt": "x"},
		"a drive path":            {"C:/escape.txt": "x"},
		"a backslash climb":       {"..\\escape.txt": "x"},
		"more than the catalog":   {"model/big": strings.Repeat("x", 2<<20)},
		"an empty name segment":   {"a//b": "x", "": "z"},
		"a windows device name":   {"model/CON": "x"},
		"a name that is just dot": {"./": "x", "model/.": "y"},
	}
	for name, entries := range cases {
		archive := buildZip(t, entries)
		files := []File{archiveFile(serve(t, archive).URL, archive, 1000)}
		root := t.TempDir()
		err := Install(context.Background(), root, "spacy", "sm", "3.8.0", files)
		if err == nil {
			t.Errorf("%s: the archive was unpacked", name)
			continue
		}
		if got := State(root, "spacy", "sm", "3.8.0", files); got != "not_installed" {
			t.Errorf("%s: State = %s", name, got)
		}
		if _, statErr := os.Stat(filepath.Join(filepath.Dir(root), "escape.txt")); statErr == nil {
			t.Errorf("%s: a file was written outside the install", name)
		}
		if _, statErr := os.Stat(Dir(root, "spacy", "sm", "3.8.0") + ".installing"); !os.IsNotExist(statErr) {
			t.Errorf("%s: the staging folder was kept", name)
		}
	}
}

func TestAnArchiveThatIsNotAZipIsRefusedNotInstalled(t *testing.T) {
	junk := []byte("this is not a zip file at all")
	files := []File{archiveFile(serve(t, junk).URL, junk, 1000)}
	root := t.TempDir()
	err := Install(context.Background(), root, "spacy", "sm", "3.8.0", files)
	if !errors.Is(err, ErrBadArchive) {
		t.Fatalf("err = %v, want ErrBadArchive", err)
	}
}

func TestPreflightForAnArchiveCountsTheDownloadAndTheUnpackedSize(t *testing.T) {
	archive := buildZip(t, modelEntries)
	files := []File{archiveFile(serve(t, archive).URL, archive, 5000)}
	var asked int64
	refuse := errors.New("no room")
	_ = InstallWith(context.Background(), t.TempDir(), "spacy", "sm", "3.8.0", files, Options{Preflight: func(_ string, total int64) error { asked = total; return refuse }})
	if want := int64(len(archive)) + 5000; asked != want {
		t.Fatalf("asked %d, want the download %d plus 5000 unpacked = %d", asked, len(archive), want)
	}
}

// A failed unpack (disk full, an antivirus lock) may leave a half-filled folder next to the complete archive; the next attempt starts the
// unpack from nothing instead of refusing its first file as already there.
func TestAnInstallThatFailedMidUnpackCanBeRetried(t *testing.T) {
	archive := buildZip(t, modelEntries)
	files := []File{archiveFile(serve(t, archive).URL, archive, 2000)}
	root := t.TempDir()
	staging := Dir(root, "spacy", "sm", "3.8.0") + ".installing"
	if err := os.MkdirAll(filepath.Join(staging, "model", "en_core_web_sm", "en_core_web_sm-3.8.0"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(staging, "model.whl"), archive, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(staging, "model", "en_core_web_sm", "en_core_web_sm-3.8.0", "config.cfg"), []byte("half"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Install(context.Background(), root, "spacy", "sm", "3.8.0", files); err != nil {
		t.Fatalf("the retry must start the unpack again: %v", err)
	}
	if got := Verify(root, "spacy", "sm", "3.8.0", files); got != "installed" {
		t.Fatalf("Verify = %s", got)
	}
}

// The names Windows reserves, in every spelling it honours, are refused wherever they appear in a path.
func TestSafeSegmentRefusesWindowsReservedNamesInEverySpelling(t *testing.T) {
	for _, name := range []string{"CON", "con", "NUL.txt", "aux.tar.gz", "PRN", "COM1", "com9.dat", "LPT3", "COM\u00b9", "LPT\u00b2.txt", "CONIN$", "CONOUT$", "NUL .txt", "a:b", "a*b", "a|b", "dir.", "dir ", "", ".", ".."} {
		if safeSegment(name) {
			t.Errorf("%q was accepted", name)
		}
	}
	for _, name := range []string{"model", "config.cfg", "en_core_web_sm-3.8.0", "COM10", "CONSOLE", "console.log", "LPT", "a$b", "my model"} {
		if !safeSegment(name) {
			t.Errorf("%q was refused", name)
		}
	}
}

func TestAnEntryThatDeclaresMoreThanTheCatalogAllowsIsRefusedBeforeAnythingIsWritten(t *testing.T) {
	// The sum of two entries that each fit but together do not.
	archive := buildZip(t, map[string]string{"model/a": strings.Repeat("a", (1<<20)+600), "model/b": strings.Repeat("b", (1<<20)+600)})
	files := []File{archiveFile(serve(t, archive).URL, archive, 1000)}
	root := t.TempDir()
	if err := Install(context.Background(), root, "spacy", "sm", "3.8.0", files); !errors.Is(err, ErrBadArchive) {
		t.Fatalf("err = %v, want ErrBadArchive", err)
	}
	if _, err := os.Stat(Dir(root, "spacy", "sm", "3.8.0") + ".installing"); !os.IsNotExist(err) {
		t.Fatal("nothing may be kept")
	}
}
