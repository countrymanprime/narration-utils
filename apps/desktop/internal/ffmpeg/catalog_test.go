package ffmpeg

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/assets"
	"github.com/countrymanprime/narration-utils/shell/internal/encodeport"
	"github.com/countrymanprime/narration-utils/shell/internal/layout"
)

// A PyPI file URL is content-addressed: /packages/<2 hex>/<2 hex>/<60 hex>/<file>. Nothing can replace the bytes behind one.
var pinnedPyPIURL = regexp.MustCompile(`^/packages/[0-9a-f]{2}/[0-9a-f]{2}/[0-9a-f]{60}/[^/]+$`)

func TestTheApprovedCatalogPinsOneWindowsBuildFromAnImmutablePyPIFile(t *testing.T) {
	windows, err := NewFor(layout.RepoFile(layout.EncoderCatalogFile), "", "windows")
	if err != nil {
		t.Fatal(err)
	}
	builds := windows.Builds()
	if len(builds) != 1 {
		t.Fatalf("the Windows catalog has %d builds, want the one ADR 0342 approves", len(builds))
	}
	build := builds[0]
	file := build.Files[0]
	u, err := url.Parse(file.URL)
	if err != nil || u.Scheme != "https" || u.Host != "files.pythonhosted.org" || !pinnedPyPIURL.MatchString(u.Path) || path.Base(u.Path) != file.Name {
		t.Errorf("the URL %q is not a content-addressed PyPI file named %q", file.URL, file.Name)
	}
	if !sha256Hex.MatchString(file.SHA256) || file.Size <= 0 || file.Expand < build.InstalledSize {
		t.Errorf("the archive's pin is malformed: %+v", file)
	}
	if build.License != "GPL-3.0-or-later" || build.Attribution == "" || build.LicenseURL == "" || build.ProvenanceURL == "" {
		t.Errorf("the licence record is incomplete: %+v", build)
	}
	for _, other := range []string{"darwin", "linux"} {
		manager, err := NewFor(layout.RepoFile(layout.EncoderCatalogFile), "", other)
		if err != nil {
			t.Fatal(err)
		}
		if got := manager.Builds(); len(got) != 0 {
			t.Errorf("%s is offered %v: the build is a Windows executable", other, got)
		}
	}
}

func TestACatalogEntryThatCannotBeInstalledSafelyIsRefused(t *testing.T) {
	good := Build{ID: "b", Provider: "ffmpeg", Version: "1", Platforms: []string{"windows"}, Binary: "bin/ffmpeg.exe",
		BinarySHA256: strings.Repeat("ab", 32), Files: []File{{Name: "a.zip", Extract: "ffmpeg"}}}
	for name, edit := range map[string]func(*Build){
		"no archive":              func(b *Build) { b.Files = nil },
		"an archive not unpacked": func(b *Build) { b.Files[0].Extract = "" },
		"no executable":           func(b *Build) { b.Binary = "" },
		"an executable outside":   func(b *Build) { b.Binary = "../ffmpeg.exe" },
		"an absolute executable":  func(b *Build) { b.Binary = "/bin/ffmpeg.exe" },
		"an unclean path":         func(b *Build) { b.Binary = "bin/./ffmpeg.exe" },
		"a short hash":            func(b *Build) { b.BinarySHA256 = "abcd" },
		"no platform":             func(b *Build) { b.Platforms = nil },
	} {
		build := good
		build.Files = slices.Clone(good.Files)
		edit(&build)
		if _, err := NewFor(writeCatalog(t, build), t.TempDir(), "windows"); err == nil {
			t.Errorf("%s: the catalog was accepted", name)
		}
	}
	if _, err := NewFor(writeCatalog(t, good), t.TempDir(), "windows"); err != nil {
		t.Errorf("a good entry was refused: %v", err)
	}
}

func TestAnInstallKeepsOnlyTheExecutableAndPathFindsIt(t *testing.T) {
	executable := []byte("MZ a pretend ffmpeg")
	manager, build := fakeBuild(t, executable, executable)
	if _, err := manager.Path(); !errors.Is(err, encodeport.ErrEncoderNotInstalled) {
		t.Fatalf("Path before the install = %v, want ErrEncoderNotInstalled", err)
	}
	if err := manager.InstallWith(context.Background(), build.ID, assets.Options{}); err != nil {
		t.Fatal(err)
	}
	if state := manager.State(build); state != "installed" {
		t.Fatalf("state = %q, want installed", state)
	}
	got, err := manager.Path()
	if err != nil {
		t.Fatal(err)
	}
	if body, _ := os.ReadFile(got); !bytes.Equal(body, executable) || filepath.Base(got) != ExecutableName {
		t.Errorf("Path = %q holding %q, want the executable", got, body)
	}
	var kept []string
	_ = filepath.WalkDir(manager.InstallDir(build.ID), func(p string, d fs.DirEntry, _ error) error {
		if !d.IsDir() {
			rel, _ := filepath.Rel(manager.InstallDir(build.ID), p)
			kept = append(kept, filepath.ToSlash(rel))
		}
		return nil
	})
	slices.Sort(kept)
	if want := []string{"ffmpeg/ffmpeg.exe", "manifest.json"}; !slices.Equal(kept, want) {
		t.Errorf("the install keeps %v, want %v", kept, want)
	}
}

func TestAnArchiveWhoseExecutableIsNotThePinnedOneInstallsNothing(t *testing.T) {
	manager, build := fakeBuild(t, []byte("MZ the approved build"), []byte("MZ something else"))
	err := manager.InstallWith(context.Background(), build.ID, assets.Options{})
	if !errors.Is(err, errWrongExecutable) && !errors.Is(err, assets.ErrBadContent) {
		t.Fatalf("install = %v, want the executable refused", err)
	}
	if state := manager.State(build); state != "not_installed" {
		t.Errorf("state = %q, want not_installed", state)
	}
	if _, err := manager.Path(); !errors.Is(err, encodeport.ErrEncoderNotInstalled) {
		t.Errorf("Path = %v, want ErrEncoderNotInstalled", err)
	}
}

func TestADamagedExecutableIsNeverRun(t *testing.T) {
	executable := []byte("MZ a pretend ffmpeg")
	manager, build := fakeBuild(t, executable, executable)
	if err := manager.InstallWith(context.Background(), build.ID, assets.Options{}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manager.executablePath(build), []byte("MZ swapped!!!!!!!!!"), 0o600); err != nil {
		t.Fatal(err)
	}
	if state, err := manager.Verify(build.ID); err != nil || state != "verification_failed" {
		t.Errorf("Verify = %q, %v, want verification_failed", state, err)
	}
	if _, err := manager.Path(); !errors.Is(err, encodeport.ErrEncoderNotInstalled) {
		t.Errorf("Path = %v, want ErrEncoderNotInstalled for a damaged executable", err)
	}
}

func TestRemoveLeavesTheEncoderNotInstalled(t *testing.T) {
	executable := []byte("MZ a pretend ffmpeg")
	manager, build := fakeBuild(t, executable, executable)
	if err := manager.InstallWith(context.Background(), build.ID, assets.Options{}); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Path(); err != nil {
		t.Fatal(err)
	}
	if err := manager.Remove(build.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Path(); !errors.Is(err, encodeport.ErrEncoderNotInstalled) {
		t.Errorf("Path after Remove = %v, want ErrEncoderNotInstalled", err)
	}
}

// TestThePinnedWheelInstallsToTheCatalogsExecutable installs the real, pinned wheel through the approved catalog entry (served from
// the local file NARRATION_FFMPEG_WHEEL names instead of PyPI, so its size and SHA-256 are the pinned ones) and checks the kept
// executable is the catalog's hash and installedSize.
func TestThePinnedWheelInstallsToTheCatalogsExecutable(t *testing.T) {
	wheel := os.Getenv("NARRATION_FFMPEG_WHEEL")
	if wheel == "" {
		t.Skip("set NARRATION_FFMPEG_WHEEL to the downloaded imageio_ffmpeg-0.6.0-py3-none-win_amd64.whl to run this")
	}
	body, err := os.ReadFile(wheel)
	if err != nil {
		t.Fatal(err)
	}
	approved, err := NewFor(layout.RepoFile(layout.EncoderCatalogFile), "", "windows")
	if err != nil {
		t.Fatal(err)
	}
	build, _ := approved.Default()
	build.Files[0].URL = serve(t, body)
	manager, err := NewFor(writeCatalog(t, build), t.TempDir(), "windows")
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.InstallWith(context.Background(), build.ID, assets.Options{}); err != nil {
		t.Fatal(err)
	}
	executable, err := manager.Path()
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(executable)
	if err != nil || info.Size() != build.InstalledSize {
		t.Fatalf("the executable is %v bytes and the catalog says %d: update installedSize", info.Size(), build.InstalledSize)
	}
}

// fakeBuild is a manager over a catalog of one Windows build whose archive (a wheel-shaped zip, served locally) holds inArchive where
// the catalog expects an executable pinned to pinned.
func fakeBuild(t *testing.T, pinned, inArchive []byte) (*Manager, Build) {
	t.Helper()
	var archive bytes.Buffer
	zipped := zip.NewWriter(&archive)
	for name, body := range map[string][]byte{
		"imageio_ffmpeg/__init__.py":                         []byte("# wrapper"),
		"imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe": inArchive,
		"imageio_ffmpeg-0.6.0.dist-info/LICENSE":             []byte("BSD-2-Clause"),
	} {
		w, err := zipped.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write(body)
	}
	if err := zipped.Close(); err != nil {
		t.Fatal(err)
	}
	archiveHash := sha256.Sum256(archive.Bytes())
	binaryHash := sha256.Sum256(pinned)
	build := Build{
		ID: "ffmpeg-test", Provider: "ffmpeg", DisplayName: "FFmpeg (test)", Version: "1", Publisher: "test", License: "GPL-3.0-or-later",
		Platforms: []string{"windows"}, Binary: "imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe",
		BinarySHA256: hex.EncodeToString(binaryHash[:]), InstalledSize: int64(len(pinned)),
		Files: []File{{Name: "ffmpeg.whl", URL: serve(t, archive.Bytes()), SHA256: hex.EncodeToString(archiveHash[:]), Size: int64(archive.Len()),
			Extract: "ffmpeg", Expand: 4096}},
	}
	manager, err := NewFor(writeCatalog(t, build), t.TempDir(), "windows")
	if err != nil {
		t.Fatal(err)
	}
	return manager, build
}

func serve(t *testing.T, body []byte) string {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(body) }))
	t.Cleanup(server.Close)
	return server.URL + "/ffmpeg.whl"
}

func writeCatalog(t *testing.T, builds ...Build) string {
	t.Helper()
	body, err := json.Marshal(Catalog{Version: 1, Encoders: builds})
	if err != nil {
		t.Fatal(err)
	}
	catalog := filepath.Join(t.TempDir(), "encoder-assets.json")
	if err := os.WriteFile(catalog, body, 0o600); err != nil {
		t.Fatal(err)
	}
	return catalog
}
