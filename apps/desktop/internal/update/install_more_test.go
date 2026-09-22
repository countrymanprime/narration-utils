package update

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestNewerIsTheReleaseAnUpdateWouldInstallAndNothingWhenThereIsNone(t *testing.T) {
	fake := newFakeGitHub(t, rc("v0.2.7-rc"), stable("v0.2.6"))
	checker := newChecker(t, fake)
	if _, ok := checker.Newer(ChannelCandidates); ok {
		t.Fatal("nothing has been checked yet")
	}
	if _, err := checker.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	release, ok := checker.Newer(ChannelCandidates)
	if !ok || release.Tag != "v0.2.7-rc" {
		t.Fatalf("Newer = %+v, %v", release, ok)
	}
	if _, ok := checker.Newer(ChannelStable); ok {
		t.Fatal("the stable channel has nothing newer than 0.2.6")
	}
	checker.Current = "0.2.7"
	if _, ok := checker.Newer(ChannelCandidates); ok {
		t.Fatal("the same version is not an update")
	}
	checker.Current, checker.Platform = "0.2.6", Platform{}
	if _, ok := checker.Newer(ChannelCandidates); ok {
		t.Fatal("a platform with no release has no update")
	}
}

func TestUserErrorsAreShownAsWrittenAndAnythingElseBecomesTheFallback(t *testing.T) {
	sentence := UserError("The running program could not be moved aside.")
	if UserMessage(sentence, "fallback") != "The running program could not be moved aside." {
		t.Fatal("a user error is shown as written")
	}
	wrapped := errors.Join(errors.New("context"), sentence)
	if UserMessage(wrapped, "fallback") != "The running program could not be moved aside." {
		t.Fatal("a wrapped user error is still found")
	}
	if got := UserMessage(errors.New(`open C:\Users\someone\secret: denied`), "The update could not be installed."); got != "The update could not be installed." {
		t.Fatalf("a raw error leaked: %q", got)
	}
	if UserMessage(nil, "fallback") != "fallback" {
		t.Fatal("no error, the fallback")
	}
}

func TestTheDefaultReleasesBaseIsTheCompiledInRepository(t *testing.T) {
	checker := &Checker{Repository: Repository}
	if got := checker.releasesBase(); got != "https://github.com/countrymanprime/narration-utils/releases" {
		t.Fatalf("releasesBase = %s", got)
	}
	checker.DownloadBase = "http://127.0.0.1:1/releases"
	if checker.releasesBase() != "http://127.0.0.1:1/releases" {
		t.Fatal("a test can point downloads elsewhere")
	}
}

func TestInstallNeedsAStagedProgramAndAVersion(t *testing.T) {
	for name, options := range map[string]InstallOptions{
		"no staged program": {Executable: "x", To: "2.0.0"},
		"no executable":     {Staged: Staged{Executable: "y"}, To: "2.0.0"},
		"no target version": {Staged: Staged{Executable: "y"}, Executable: "x"},
	} {
		if err := Install(context.Background(), options); err == nil || !strings.Contains(err.Error(), "no downloaded update") {
			t.Errorf("%s: err = %v", name, err)
		}
	}
}

func TestInstallStopsBeforeTouchingTheProgramWhenTheRecordCannotBeWritten(t *testing.T) {
	layout, staged := install(t, "linger")
	blocker := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(blocker, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	options := layout.options(staged, 0)
	options.PendingPath = filepath.Join(blocker, "pending.json") // under a file, so it cannot be created
	options.Spawn = func(string, []string, string) error { t.Fatal("nothing may start"); return nil }
	if err := Install(context.Background(), options); err == nil || !strings.Contains(err.Error(), "could not be recorded") {
		t.Fatalf("err = %v", err)
	}
	if got := versionOf(t, layout.exe); got != "1.0.0" || exists(layout.exe+newSuffix) || exists(layout.exe+oldSuffix) {
		t.Fatalf("the running program was touched: %s", got)
	}
}

func TestInstallRefusesWhenTheVersionProbeFailsToRun(t *testing.T) {
	layout, staged := install(t, "linger")
	options := layout.options(staged, 0)
	options.RunVersion = func(context.Context, string) (string, error) { return "", errors.New("exit status 1") }
	if err := Install(context.Background(), options); err == nil || !strings.Contains(err.Error(), "does not report the version") {
		t.Fatalf("err = %v", err)
	}
	if exists(layout.exe+newSuffix) || exists(layout.pending) || exists(layout.exe+oldSuffix) {
		t.Fatal("a probe that cannot run must leave nothing behind")
	}
}

func TestCopyVerifiedRefusesAStagedFileThatIsNotARegularFileOrCannotBeCopiedOnto(t *testing.T) {
	dir := t.TempDir()
	if err := copyVerified(context.Background(), Staged{Executable: dir, ExecutableSize: 1}, filepath.Join(dir, "out")); err == nil {
		t.Fatal("a directory is not a program")
	}
	program := filepath.Join(dir, "program.exe")
	if err := os.WriteFile(program, []byte("abc"), 0o700); err != nil {
		t.Fatal(err)
	}
	staged := Staged{Executable: program, ExecutableSize: 3, ExecutableSHA256: sumHex([]byte("abc"))}
	existing := filepath.Join(dir, "already")
	if err := os.WriteFile(existing, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := copyVerified(context.Background(), staged, existing); err == nil || !strings.Contains(err.Error(), "could not be copied") {
		t.Fatalf("a destination that already exists is not written through: %v", err)
	}
	if err := copyVerified(context.Background(), staged, filepath.Join(dir, "copy")); err != nil {
		t.Fatalf("a good copy: %v", err)
	}
}

func TestAPendingRecordThatIsJunkOrIncompleteIsNotARecord(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "pending.json")
	for name, content := range map[string]string{"not JSON": "{", "no version": `{"executable":"x"}`, "no executable": `{"to":"2.0.0"}`, "a list": `[]`} {
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, ok := readPending(path); ok {
			t.Errorf("%s was read as a record", name)
		}
	}
	if _, ok := readPending(filepath.Join(dir, "missing.json")); ok {
		t.Error("a missing file is not a record")
	}
}

func TestAPendingRecordCannotBeUsedToTouchAnotherProgramsFiles(t *testing.T) {
	dir := t.TempDir()
	mine := filepath.Join(dir, "mine", appFileName())
	other := filepath.Join(dir, "other", appFileName())
	for _, path := range []string{mine, other} {
		copyFile(t, fakeApp(t, "1.0.0"), path)
		_ = os.WriteFile(path+oldSuffix, []byte("precious"), 0o600)
	}
	record := filepath.Join(dir, "pending.json")
	// A record that names another program's path is not about this one: neither Startup nor Confirm may act on that program's files.
	if err := writePending(record, Pending{From: "1.0.0", To: "2.0.0", Executable: other, Attempts: 5}); err != nil {
		t.Fatal(err)
	}
	Confirm(StartupOptions{Executable: mine, PendingPath: record, Version: "2.0.0"})
	Startup(StartupOptions{Executable: mine, PendingPath: record, Version: "2.0.0"})
	if !exists(other+oldSuffix) || !exists(mine+oldSuffix) {
		t.Fatal("a planted record removed a file")
	}
	if bytes, _ := os.ReadFile(other); len(bytes) == 0 {
		t.Fatal("another program was changed")
	}
}

func TestPathsAreComparedTheWayTheSystemDoes(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "App", "narration-utils.exe")
	if !samePath(path, filepath.Join(dir, "App", "..", "App", "narration-utils.exe")) {
		t.Fatal("a path with a dot-dot is the same program")
	}
	upper := strings.ToUpper(path)
	if got := samePath(path, upper); got != (runtime.GOOS == "windows") {
		t.Fatalf("case: samePath = %v on %s", got, runtime.GOOS)
	}
	if samePath(path, filepath.Join(dir, "Other", "narration-utils.exe")) {
		t.Fatal("different folders are different programs")
	}
}
