package update

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestAChecksumThatCannotBeFetchedIsAFailureTheNarratorCanRead(t *testing.T) {
	fake := newReleaseServer(t, buildZip(t, map[string][]byte{stageExecutableName: goodExecutable()}))
	fake.serveChecksum = func(w http.ResponseWriter, _ *http.Request) { http.Error(w, "boom", http.StatusInternalServerError) }
	_, err := newStager(t).Stage(context.Background(), fake.release("0.2.7"), nil)
	if err == nil || !strings.Contains(err.Error(), "status 500") || strings.Contains(err.Error(), "boom") {
		t.Fatalf("err = %v", err)
	}
	release := fake.release("0.2.7")
	fake.server.Close()
	if _, err := newStager(t).Stage(context.Background(), release, nil); err == nil || !strings.Contains(err.Error(), "Could not download") {
		t.Fatalf("offline: err = %v", err)
	}
}

func TestACancelBeforeTheChecksumArrivesIsACancel(t *testing.T) {
	fake := newReleaseServer(t, buildZip(t, map[string][]byte{stageExecutableName: goodExecutable()}))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := newStager(t).Stage(ctx, fake.release("0.2.7"), nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v", err)
	}
}

func TestAZipThatIsNotAZipIsRefusedEvenWhenItsChecksumMatches(t *testing.T) {
	fake := newReleaseServer(t, []byte("this is not a zip file at all"))
	stager := newStager(t)
	if _, err := stager.Stage(context.Background(), fake.release("0.2.7"), nil); err == nil || !strings.Contains(err.Error(), "could not be opened") {
		t.Fatalf("err = %v", err)
	}
}

func TestAnUnreadableDiskIsAFailureAndNotAGuess(t *testing.T) {
	fake := newReleaseServer(t, buildZip(t, map[string][]byte{stageExecutableName: goodExecutable()}))
	stager := newStager(t)
	stager.Free = func(string) (uint64, error) { return 0, errors.New("the drive vanished") }
	if _, err := stager.Stage(context.Background(), fake.release("0.2.7"), nil); err == nil || !strings.Contains(err.Error(), "how much disk space") {
		t.Fatalf("err = %v", err)
	}
	if fake.zipRequests.Load() != 0 {
		t.Fatal("no download without knowing there is room")
	}
}

func TestAStagedRecordThatIsJunkOrForAnotherReleaseIsNotTrusted(t *testing.T) {
	fake := newReleaseServer(t, buildZip(t, map[string][]byte{stageExecutableName: goodExecutable()}))
	stager := newStager(t)
	release := fake.release("0.2.7")
	staged, err := stager.Stage(context.Background(), release, nil)
	if err != nil {
		t.Fatal(err)
	}
	record := filepath.Join(staged.Dir, stagedRecord)
	for name, content := range map[string]string{
		"not JSON":     "{ nope",
		"another tag":  `{"tag":"v9.9.9","executableSize":` + itoa(staged.ExecutableSize) + `,"executableSha256":"` + staged.ExecutableSHA256 + `"}`,
		"a bad hash":   `{"tag":"v0.2.7","executableSize":` + itoa(staged.ExecutableSize) + `,"executableSha256":"zz"}`,
		"no hash":      `{"tag":"v0.2.7","executableSize":` + itoa(staged.ExecutableSize) + `}`,
		"a zero size":  `{"tag":"v0.2.7","executableSize":0,"executableSha256":"` + staged.ExecutableSHA256 + `"}`,
		"another size": `{"tag":"v0.2.7","executableSize":1,"executableSha256":"` + staged.ExecutableSHA256 + `"}`,
	} {
		if err := os.WriteFile(record, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, ok := stager.Staged(release); ok {
			t.Errorf("%s: the record was trusted", name)
		}
	}
	if err := os.Remove(record); err != nil {
		t.Fatal(err)
	}
	if _, ok := stager.Staged(release); ok {
		t.Error("no record, not staged")
	}
	// A folder where the program should be is not a program.
	if err := os.WriteFile(record, []byte(`{"tag":"v0.2.7","executableSize":5,"executableSha256":"`+staged.ExecutableSHA256+`"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(staged.Executable); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(staged.Executable, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, ok := stager.Staged(release); ok {
		t.Error("a directory is not a staged program")
	}
}

func itoa(number int64) string {
	bytes, _ := json.Marshal(number)
	return string(bytes)
}

func TestAnUnpackThatIsCancelledLeavesNoProgramBehind(t *testing.T) {
	fake := newReleaseServer(t, buildZip(t, map[string][]byte{stageExecutableName: goodExecutable()}))
	stager := newStager(t)
	release := fake.release("0.2.7")
	ctx, cancel := context.WithCancel(context.Background())
	_, err := stager.Stage(ctx, release, func(progress Progress) {
		if progress.Phase == PhaseUnpacking {
			cancel()
		}
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v", err)
	}
	if matches, _ := filepath.Glob(filepath.Join(stager.Root, "app-update", "windows-x64", "*", "*.exe*")); len(matches) != 0 {
		t.Fatalf("left behind: %v", matches)
	}
	// The verified zip is kept, so trying again does not download it a second time.
	if _, err := stager.Stage(context.Background(), release, nil); err != nil || fake.zipRequests.Load() != 1 {
		t.Fatalf("second try: %v, %d downloads", err, fake.zipRequests.Load())
	}
}

func TestTheDownloadClientHasTheRedirectPolicyAndABoundOnWaiting(t *testing.T) {
	client := NewDownloadClient()
	if client.CheckRedirect == nil {
		t.Fatal("no redirect policy")
	}
	request, _ := http.NewRequest(http.MethodGet, "https://evil.example/x", nil)
	if client.CheckRedirect(request, nil) == nil {
		t.Fatal("the client follows a redirect to any host")
	}
	if (&Stager{}).client() == nil {
		t.Fatal("a stager with nothing configured still has a client")
	}
	if free, err := (&Stager{}).free(t.TempDir()); err != nil || free == 0 {
		t.Fatalf("and a real disk check: %d, %v", free, err)
	}
}

func TestACheckerBuiltForThisMachineUsesTheRealClockAndRepository(t *testing.T) {
	checker := NewChecker("0.2.6", filepath.Join(t.TempDir(), "check.json"), nil)
	if checker.Repository != Repository || checker.APIBase != APIBase || checker.Client == nil {
		t.Fatalf("checker = %+v", checker)
	}
	if delta := time.Since(checker.Clock()); delta < 0 || delta > time.Minute {
		t.Fatalf("Clock is off by %v", delta)
	}
	if (&Checker{}).Clock().IsZero() {
		t.Fatal("a checker with no clock uses the real one")
	}
	if platform, ok := CurrentPlatform(); ok && platform.Asset == "" {
		t.Fatal("a known platform has an asset name")
	}
}

func TestAVersionInTheCacheThatIsNotAVersionIsRefused(t *testing.T) {
	var version Version
	if err := version.UnmarshalText([]byte("v0.2.7")); err == nil {
		t.Fatal("a tag is not a version")
	}
	if err := version.UnmarshalText([]byte("0.2.7")); err != nil || version != (Version{0, 2, 7}) {
		t.Fatalf("%v %v", version, err)
	}
}

func TestACacheThatCannotBeWrittenIsReportedAndDoesNotStopTheCheck(t *testing.T) {
	fake := newFakeGitHub(t, rc("v0.2.7-rc"))
	checker := newChecker(t, fake)
	var logged []string
	checker.Persist = nilReporterCapturing(&logged)
	// The cache path is under a file, so its folder cannot be made.
	blocker := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(blocker, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	checker.CachePath = filepath.Join(blocker, "check.json")
	if _, err := checker.Check(context.Background()); err != nil {
		t.Fatalf("a cache that cannot be written must not fail the check: %v", err)
	}
	if len(logged) == 0 || !strings.Contains(logged[0], "update_check_unsaved") {
		t.Fatalf("logged %v", logged)
	}
}

func TestARateLimitResetThatIsMissingOrPastBecomesAShortWait(t *testing.T) {
	checker := &Checker{Now: func() time.Time { return clock }}
	for name, header := range map[string]string{"missing": "", "text": "soon", "zero": "0", "negative": "-4", "in the past": "1000"} {
		if got := checker.rateLimitReset(header); !got.Equal(clock.Add(failureRetry)) {
			t.Errorf("%s: reset %v, want %v", name, got, clock.Add(failureRetry))
		}
	}
}

func TestTimestampsThatDoNotLookLikeTimesAreDropped(t *testing.T) {
	for _, text := range []string{"", "short", strings.Repeat("2", 50), "2026-09-21T10:00:00Z<script>", "yesterday-ish"} {
		if got := cleanTimestamp(text); got != "" {
			t.Errorf("cleanTimestamp(%q) = %q", text, got)
		}
	}
	if cleanTimestamp("2026-09-21T10:00:00Z") == "" {
		t.Fatal("a real timestamp is kept")
	}
}

func TestVersionPartsThatOverflowOrCarrySignsAreRefused(t *testing.T) {
	for _, text := range []string{"4294967296.0.0", "0.0.9999999", "+1.0.0", "0.-0.0"} {
		if _, err := ParseVersion(text); err == nil {
			t.Errorf("ParseVersion(%q) succeeded", text)
		}
	}
}

func TestAReleaseThatWasReuploadedUnderTheSameTagIsDownloadedAgain(t *testing.T) {
	first := buildZip(t, map[string][]byte{stageExecutableName: goodExecutable()})
	fake := newReleaseServer(t, first)
	stager := newStager(t)
	release := fake.release("0.2.7")
	if _, err := stager.Stage(context.Background(), release, nil); err != nil {
		t.Fatal(err)
	}
	// The release now publishes a different zip and its checksum: the program staged from the old one is not reused.
	replacement := buildZip(t, map[string][]byte{stageExecutableName: []byte(strings.Repeat("a rebuilt program ", 50000))})
	fake.zip = replacement
	release.Asset.Size = int64(len(replacement))
	staged, err := stager.Stage(context.Background(), release, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(staged.Executable); !bytes.Equal(got, []byte(strings.Repeat("a rebuilt program ", 50000))) {
		t.Fatal("the old program was reused for a re-uploaded release")
	}
	if fake.zipRequests.Load() != 2 {
		t.Fatalf("%d downloads, want 2", fake.zipRequests.Load())
	}
}

func TestAnImplausibleAssetSizeIsRefusedBeforeAnythingIsAsked(t *testing.T) {
	fake := newReleaseServer(t, buildZip(t, map[string][]byte{stageExecutableName: goodExecutable()}))
	for _, size := range []int64{0, -1, MaxAssetBytes + 1} {
		release := fake.release("0.2.7")
		release.Asset.Size = size
		if _, err := newStager(t).Stage(context.Background(), release, nil); err == nil {
			t.Errorf("size %d was accepted", size)
		}
	}
	if fake.sumRequests.Load() != 0 || fake.zipRequests.Load() != 0 {
		t.Fatal("nothing may be requested for a size no release has")
	}
}

func TestAZipEntryThatIsALinkIsNotAProgram(t *testing.T) {
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	header := &zip.FileHeader{Name: stageExecutableName, Method: zip.Store}
	header.SetMode(os.ModeSymlink | 0o777)
	out, err := writer.CreateHeader(header)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := out.Write([]byte("elsewhere.exe")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	fake := newReleaseServer(t, buffer.Bytes())
	if _, err := newStager(t).Stage(context.Background(), fake.release("0.2.7"), nil); err == nil {
		t.Fatal("a link entry was unpacked")
	}
}
