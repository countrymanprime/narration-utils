package update

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const stageExecutableName = "narration-utils.exe"

// buildZip is a release zip holding the given entries; a name ending in "/" is a directory entry.
func buildZip(t testing.TB, entries map[string][]byte) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for name, content := range entries {
		header := &zip.FileHeader{Name: name, Method: zip.Deflate}
		if strings.HasSuffix(name, "/") {
			header.SetMode(0o755 | os.ModeDir)
		}
		out, err := writer.CreateHeader(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := out.Write(content); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func sumHex(body []byte) string {
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:])
}

// releaseServer serves one release's zip and checksum, counts the requests for each, and lets a test change what either answers.
type releaseServer struct {
	server        *httptest.Server
	zip           []byte
	checksum      func(zipBody []byte) string
	zipRequests   atomic.Int32
	sumRequests   atomic.Int32
	serveZip      func(w http.ResponseWriter, r *http.Request)
	serveChecksum func(w http.ResponseWriter, r *http.Request)
}

func newReleaseServer(t *testing.T, zipBody []byte) *releaseServer {
	t.Helper()
	fake := &releaseServer{zip: zipBody, checksum: func(body []byte) string { return sumHex(body) + "  " + windows.Asset + "\n" }}
	fake.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, ".sha256"):
			fake.sumRequests.Add(1)
			if fake.serveChecksum != nil {
				fake.serveChecksum(w, r)
				return
			}
			_, _ = w.Write([]byte(fake.checksum(fake.zip)))
		case strings.HasSuffix(r.URL.Path, ".zip"):
			fake.zipRequests.Add(1)
			if fake.serveZip != nil {
				fake.serveZip(w, r)
				return
			}
			_, _ = w.Write(fake.zip)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(fake.server.Close)
	return fake
}

func (f *releaseServer) release(version string) Release {
	parsed, _ := ParseVersion(version)
	base := f.server.URL + "/download/v" + version + "/"
	return Release{
		Tag: "v" + version, Version: parsed,
		Asset:    Asset{Name: windows.Asset, Size: int64(len(f.zip)), URL: base + windows.Asset},
		Checksum: Asset{Name: windows.Checksum, Size: 100, URL: base + windows.Checksum},
	}
}

func newStager(t *testing.T) *Stager {
	t.Helper()
	return &Stager{Root: t.TempDir(), Platform: windows, Client: http.DefaultClient, Free: func(string) (uint64, error) { return 100 << 30, nil }}
}

func goodExecutable() []byte { return []byte(strings.Repeat("MZ pretend program ", 50000)) }

func TestStageDownloadsChecksumsAndUnpacksTheOneExecutable(t *testing.T) {
	executable := goodExecutable()
	fake := newReleaseServer(t, buildZip(t, map[string][]byte{stageExecutableName: executable}))
	stager := newStager(t)
	var phases []Phase
	var lastDone, lastTotal int64
	staged, err := stager.Stage(context.Background(), fake.release("0.2.7"), func(progress Progress) {
		if len(phases) == 0 || phases[len(phases)-1] != progress.Phase {
			phases = append(phases, progress.Phase)
		}
		if progress.Phase == PhaseDownloading {
			lastDone, lastTotal = progress.Done, progress.Total
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(staged.Executable)
	if err != nil || !bytes.Equal(got, executable) {
		t.Fatalf("the staged executable differs: %v", err)
	}
	if filepath.Base(staged.Executable) != stageExecutableName {
		t.Fatalf("staged as %s", staged.Executable)
	}
	if len(phases) != 3 || phases[0] != PhaseDownloading || phases[1] != PhaseVerifying || phases[2] != PhaseUnpacking {
		t.Fatalf("phases = %v", phases)
	}
	if lastTotal != int64(len(fake.zip)) || lastDone != lastTotal {
		t.Fatalf("the last download report is %d of %d, want the whole zip", lastDone, lastTotal)
	}
	if staged.Release.Tag != "v0.2.7" || staged.ExecutableSize != int64(len(executable)) {
		t.Fatalf("staged = %+v", staged)
	}
}

func TestStageRefusesEachWayTheDownloadCanBeWrong(t *testing.T) {
	good := buildZip(t, map[string][]byte{stageExecutableName: goodExecutable()})
	cases := map[string]func(*releaseServer){
		"a checksum that does not match": func(f *releaseServer) {
			f.checksum = func([]byte) string { return strings.Repeat("0", 64) + "  " + windows.Asset + "\n" }
		},
		"a checksum for another file": func(f *releaseServer) {
			f.checksum = func(b []byte) string { return sumHex(b) + "  narration-utils-linux-x64.tar.gz\n" }
		},
		"a checksum file that is not a checksum": func(f *releaseServer) {
			f.checksum = func([]byte) string { return "<html>not found</html>" }
		},
		"an empty checksum file": func(f *releaseServer) { f.checksum = func([]byte) string { return "" } },
		"a checksum in capitals is fine but one with a wrong length is not": func(f *releaseServer) {
			f.checksum = func(b []byte) string { return sumHex(b)[:60] + "  " + windows.Asset + "\n" }
		},
		"a file that is not the size the release lists": func(f *releaseServer) {
			f.zip = append(append([]byte{}, f.zip...), 0)
			f.serveZip = func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(f.zip[:len(f.zip)-1]) }
		},
		"a file that changed after its checksum was published": func(f *releaseServer) {
			changed := append([]byte{}, f.zip...)
			changed[len(changed)/2] ^= 0xff
			f.serveZip = func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(changed) }
		},
		"a missing file": func(f *releaseServer) {
			f.serveZip = func(w http.ResponseWriter, _ *http.Request) { http.NotFound(w, nil) }
		},
	}
	for name, mutate := range cases {
		fake := newReleaseServer(t, good)
		mutate(fake)
		stager := newStager(t)
		if _, err := stager.Stage(context.Background(), fake.release("0.2.7"), nil); err == nil {
			t.Errorf("%s: the update was staged", name)
			continue
		}
		if entries, _ := os.ReadDir(filepath.Join(stager.Root, "app-update", "windows-x64")); len(entries) != 0 {
			t.Errorf("%s: left %d entries behind", name, len(entries))
		}
	}
}

func TestStageRefusesAChecksumThatDisagreesWithGitHubsDigest(t *testing.T) {
	fake := newReleaseServer(t, buildZip(t, map[string][]byte{stageExecutableName: goodExecutable()}))
	release := fake.release("0.2.7")
	release.Asset.Digest = strings.Repeat("ab", 32)
	if _, err := newStager(t).Stage(context.Background(), release, nil); err == nil || !strings.Contains(err.Error(), "disagree") {
		t.Fatalf("err = %v", err)
	}
	release.Asset.Digest = sumHex(fake.zip)
	if _, err := newStager(t).Stage(context.Background(), release, nil); err != nil {
		t.Fatalf("a digest that agrees is fine: %v", err)
	}
}

func TestStageRefusesAZipThatIsNotExactlyTheProgram(t *testing.T) {
	executable := goodExecutable()
	cases := map[string]map[string][]byte{
		"an extra file":                {stageExecutableName: executable, "readme.txt": []byte("hi")},
		"the wrong name":               {"other.exe": executable},
		"a path traversal":             {"../narration-utils.exe": executable},
		"an absolute path":             {"/narration-utils.exe": executable},
		"the program in a folder":      {"bin/narration-utils.exe": executable},
		"a windows-style path":         {"..\\narration-utils.exe": executable},
		"only a directory":             {"narration-utils.exe/": nil},
		"an empty program":             {stageExecutableName: {}},
		"no entries at all":            {},
		"the name in another case":     {"Narration-Utils.exe": executable},
		"the name with a trailing dot": {"narration-utils.exe.": executable},
	}
	for name, entries := range cases {
		fake := newReleaseServer(t, buildZip(t, entries))
		stager := newStager(t)
		if _, err := stager.Stage(context.Background(), fake.release("0.2.7"), nil); err == nil {
			t.Errorf("%s: the update was staged", name)
			continue
		}
		matches, _ := filepath.Glob(filepath.Join(stager.Root, "app-update", "windows-x64", "*", "*.exe*"))
		if len(matches) != 0 {
			t.Errorf("%s: left an executable behind: %v", name, matches)
		}
	}
}

func TestStageRefusesAZipThatClaimsToUnpackToMoreThanAProgramCanBe(t *testing.T) {
	// A zip of zeros is tiny and unpacks huge: the limit is on what it claims, checked before anything is written.
	fake := newReleaseServer(t, buildZip(t, map[string][]byte{stageExecutableName: make([]byte, 4<<20)}))
	stager := newStager(t)
	stager.MaxExecutableBytes = 1 << 20
	if _, err := stager.Stage(context.Background(), fake.release("0.2.7"), nil); err == nil || !strings.Contains(err.Error(), "larger") {
		t.Fatalf("err = %v", err)
	}
}

func TestStageRefusesWhenThereIsNotEnoughDiskAndAsksNothingBigFirst(t *testing.T) {
	fake := newReleaseServer(t, buildZip(t, map[string][]byte{stageExecutableName: goodExecutable()}))
	stager := newStager(t)
	stager.Free = func(string) (uint64, error) { return 1 << 20, nil }
	_, err := stager.Stage(context.Background(), fake.release("0.2.7"), nil)
	if err == nil || !strings.Contains(err.Error(), "free disk space") {
		t.Fatalf("err = %v", err)
	}
	if fake.zipRequests.Load() != 0 {
		t.Fatal("the download must not start when there is no room for it")
	}
}

func TestStageChecksRoomAgainForTheUnpackedProgram(t *testing.T) {
	fake := newReleaseServer(t, buildZip(t, map[string][]byte{stageExecutableName: goodExecutable()}))
	stager := newStager(t)
	var calls atomic.Int32
	stager.Free = func(string) (uint64, error) {
		if calls.Add(1) == 1 {
			return 100 << 30, nil // room for the download
		}
		return 1 << 20, nil // and then the disk filled up
	}
	if _, err := stager.Stage(context.Background(), fake.release("0.2.7"), nil); err == nil || !strings.Contains(err.Error(), "free disk space") {
		t.Fatalf("err = %v", err)
	}
	if entries, _ := filepath.Glob(filepath.Join(stager.Root, "app-update", "windows-x64", "*", "*.exe*")); len(entries) != 0 {
		t.Fatalf("no program may be left behind: %v", entries)
	}
}

func TestStageCancelledMidDownloadLeavesNothingAndSaysCancelled(t *testing.T) {
	fake := newReleaseServer(t, buildZip(t, map[string][]byte{stageExecutableName: goodExecutable()}))
	started := make(chan struct{})
	fake.serveZip = func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(fake.zip[:1024])
		w.(http.Flusher).Flush()
		close(started)
		<-r.Context().Done()
	}
	stager := newStager(t)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := stager.Stage(ctx, fake.release("0.2.7"), nil)
		done <- err
	}()
	<-started
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("err = %v, want the context error", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("cancel did not stop the download")
	}
	if entries, _ := os.ReadDir(filepath.Join(stager.Root, "app-update", "windows-x64")); len(entries) != 0 {
		t.Fatalf("left behind: %v", entries)
	}
}

func TestStageIsIdempotentAndDoesNotDownloadAVerifiedFileAgain(t *testing.T) {
	fake := newReleaseServer(t, buildZip(t, map[string][]byte{stageExecutableName: goodExecutable()}))
	stager := newStager(t)
	first, err := stager.Stage(context.Background(), fake.release("0.2.7"), nil)
	if err != nil {
		t.Fatal(err)
	}
	second, err := stager.Stage(context.Background(), fake.release("0.2.7"), nil)
	if err != nil || second.Executable != first.Executable || fake.zipRequests.Load() != 1 {
		t.Fatalf("err %v, %d downloads", err, fake.zipRequests.Load())
	}
	if again, ok := stager.Staged(fake.release("0.2.7")); !ok || again.Executable != first.Executable {
		t.Fatalf("Staged = %+v %v", again, ok)
	}
	if _, ok := stager.Staged(fake.release("0.2.8")); ok {
		t.Fatal("another version is not staged")
	}
}

func TestStageRepairsAStagedProgramThatWasDeletedOrChanged(t *testing.T) {
	fake := newReleaseServer(t, buildZip(t, map[string][]byte{stageExecutableName: goodExecutable()}))
	stager := newStager(t)
	first, err := stager.Stage(context.Background(), fake.release("0.2.7"), nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(first.Executable, []byte("tampered"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, ok := stager.Staged(fake.release("0.2.7")); ok {
		t.Fatal("a staged program of the wrong size is not staged")
	}
	repaired, err := stager.Stage(context.Background(), fake.release("0.2.7"), nil)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(repaired.Executable); !bytes.Equal(got, goodExecutable()) {
		t.Fatal("the program was not unpacked again")
	}
	if fake.zipRequests.Load() != 1 {
		t.Fatalf("a verified zip needs no second download: %d", fake.zipRequests.Load())
	}
}

func TestStageRemovesWhatOlderUpdatesLeftBehind(t *testing.T) {
	fake := newReleaseServer(t, buildZip(t, map[string][]byte{stageExecutableName: goodExecutable()}))
	stager := newStager(t)
	platformDir := filepath.Join(stager.Root, "app-update", "windows-x64")
	for _, leftover := range []string{"0.2.5", "0.2.6.installing"} {
		if err := os.MkdirAll(filepath.Join(platformDir, leftover), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := stager.Stage(context.Background(), fake.release("0.2.7"), nil); err != nil {
		t.Fatal(err)
	}
	entries, _ := os.ReadDir(platformDir)
	if len(entries) != 1 || entries[0].Name() != "0.2.7" {
		t.Fatalf("entries = %v", entries)
	}
}

func TestAPlatformThatDoesNotReplaceItselfStagesNothing(t *testing.T) {
	fake := newReleaseServer(t, buildZip(t, map[string][]byte{stageExecutableName: goodExecutable()}))
	stager := newStager(t)
	stager.Platform = Platform{Key: "linux-x64", Asset: "narration-utils-linux-x64.tar.gz", Checksum: "narration-utils-linux-x64.tar.gz.sha256"}
	if _, err := stager.Stage(context.Background(), fake.release("0.2.7"), nil); err == nil {
		t.Fatal("linux must not stage an update")
	}
	if fake.zipRequests.Load() != 0 || fake.sumRequests.Load() != 0 {
		t.Fatal("and asks for nothing")
	}
}

func TestAHugeChecksumFileIsNotReadPastItsBound(t *testing.T) {
	fake := newReleaseServer(t, buildZip(t, map[string][]byte{stageExecutableName: goodExecutable()}))
	fake.serveChecksum = func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(strings.Repeat("a", 5<<20))) }
	if _, err := newStager(t).Stage(context.Background(), fake.release("0.2.7"), nil); err == nil {
		t.Fatal("an enormous checksum file must be refused")
	}
}

func TestAChecksumInCapitalsWithABinaryMarkerIsRead(t *testing.T) {
	body := buildZip(t, map[string][]byte{stageExecutableName: goodExecutable()})
	fake := newReleaseServer(t, body)
	fake.checksum = func(b []byte) string { return strings.ToUpper(sumHex(b)) + " *" + windows.Asset + "\r\n" }
	if _, err := newStager(t).Stage(context.Background(), fake.release("0.2.7"), nil); err != nil {
		t.Fatal(err)
	}
}

func TestTheRedirectPolicyFollowsGitHubOverHTTPSAndNothingElse(t *testing.T) {
	request := func(url string) *http.Request {
		r, _ := http.NewRequest(http.MethodGet, url, nil)
		return r
	}
	allowed := []string{
		"https://github.com/countrymanprime/narration-utils/releases/download/v1.0.0/x.zip",
		"https://objects.githubusercontent.com/github-production-release-asset/1",
		"https://release-assets.githubusercontent.com/github-production-release-asset/1",
		"https://github-releases.githubusercontent.com/1/2",
	}
	for _, url := range allowed {
		if err := DownloadRedirectPolicy(request(url), nil); err != nil {
			t.Errorf("%s refused: %v", url, err)
		}
	}
	refused := []string{
		"http://github.com/x", "https://evil.example/x", "https://github.com.evil.example/x", "https://notgithub.com/x",
		"https://githubusercontent.com.evil.example/x", "https://evilgithubusercontent.com/x", "https://raw.githubusercontent.com/someone/repo/main/x", "https://gist.githubusercontent.com/x", "https://avatars.githubusercontent.com/x", "ftp://github.com/x", "https://127.0.0.1/x", "https://github.com@evil.example/x",
	}
	for _, url := range refused {
		if err := DownloadRedirectPolicy(request(url), nil); err == nil {
			t.Errorf("%s was followed", url)
		}
	}
	via := make([]*http.Request, maxRedirects)
	if err := DownloadRedirectPolicy(request(allowed[0]), via); err == nil {
		t.Error("a chain of redirects has to end")
	}
}

func TestFreeBytesReadsTheDiskAThePathIsOnEvenBeforeThePathExists(t *testing.T) {
	existing, err := FreeBytes(t.TempDir())
	if err != nil || existing == 0 {
		t.Fatalf("free = %d, %v", existing, err)
	}
	missing, err := FreeBytes(filepath.Join(t.TempDir(), "not", "created", "yet"))
	if err != nil || missing == 0 {
		t.Fatalf("free = %d, %v", missing, err)
	}
}

func TestTheProgressPercentIsRealBytesOverTotalAndNeverPastAHundred(t *testing.T) {
	for _, test := range []struct {
		done, total int64
		want        int
	}{{0, 100, 0}, {50, 100, 50}, {100, 100, 100}, {150, 100, 100}, {10, 0, 0}, {-5, 100, 0}} {
		if got := (Progress{Done: test.done, Total: test.total}).Percent(); got != test.want {
			t.Errorf("Percent(%d of %d) = %d, want %d", test.done, test.total, got, test.want)
		}
	}
	_ = fmt.Sprint(PhaseDownloading)
}
