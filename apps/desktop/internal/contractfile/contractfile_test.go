package contractfile

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fakeT struct {
	testing.TB
	failed  string
	fatally bool
}

func (f *fakeT) Helper() {}
func (f *fakeT) Fatalf(format string, args ...any) {
	f.fatally = true
	f.failed = format
	panic(f)
}

func check(t *testing.T, dir, name string, value any) (failure string) {
	t.Helper()
	fake := &fakeT{TB: t}
	defer func() {
		if recovered := recover(); recovered != nil {
			if recovered != fake {
				panic(recovered)
			}
			failure = fake.failed
		}
	}()
	checkIn(fake, dir, name, value)
	return ""
}

func TestCheckPassesWhenTheCommittedFileMatches(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "sample.json"), []byte("{\n  \"a\": 1,\n  \"b\": [\n    \"x\"\n  ]\n}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if failure := check(t, dir, "sample", map[string]any{"b": []string{"x"}, "a": 1}); failure != "" {
		t.Fatalf("matching payload failed: %s", failure)
	}
}

func TestCheckFailsWhenThePayloadDriftsFromTheCommittedFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "sample.json"), []byte("{\n  \"a\": 1\n}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if failure := check(t, dir, "sample", map[string]any{"a": 2}); failure == "" {
		t.Fatal("a drifted payload must fail")
	}
}

func TestCheckFailsForAFileThatWasNeverCommitted(t *testing.T) {
	if failure := check(t, t.TempDir(), "missing", map[string]any{"a": 1}); !strings.Contains(failure, "no committed") {
		t.Fatalf("failure = %q, want a message about the missing committed file", failure)
	}
}

func TestUpdateModeWritesTheFileInsteadOfComparing(t *testing.T) {
	t.Setenv(UpdateEnv, "1")
	dir := t.TempDir()
	if failure := check(t, dir, "fresh", map[string]any{"z": true, "a": nil}); failure != "" {
		t.Fatalf("update failed: %s", failure)
	}
	bytes, err := os.ReadFile(filepath.Join(dir, "fresh.json"))
	if err != nil {
		t.Fatal(err)
	}
	if want := "{\n  \"a\": null,\n  \"z\": true\n}\n"; string(bytes) != want {
		t.Fatalf("written = %q, want %q", bytes, want)
	}
}

func TestDirFindsTheSharedFolderFromAPackageDirectory(t *testing.T) {
	dir, err := Dir()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(filepath.ToSlash(dir), "tests/fixtures/contracts") {
		t.Fatalf("Dir() = %q", dir)
	}
}

func TestFindRootFailsWhenNoWorkspaceFileIsAbove(t *testing.T) {
	// A temp folder can sit inside the repository (the gate points TMP there), so "outside" is simulated.
	if _, err := findRoot(t.TempDir(), func(string) bool { return false }); err == nil {
		t.Fatal("a directory with no workspace file above it must fail")
	}
}

func TestCheckLooksInTheSharedFolder(t *testing.T) {
	fake := &fakeT{TB: t}
	defer func() {
		if recovered := recover(); recovered != fake {
			t.Fatalf("expected the missing committed file to fail, got %v", recovered)
		}
	}()
	Check(fake, "no-such-contract-file", map[string]any{})
}

func TestUpdateModeReportsAFolderItCannotCreate(t *testing.T) {
	t.Setenv(UpdateEnv, "1")
	blocker := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(blocker, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if failure := check(t, filepath.Join(blocker, "sub"), "x", 1); !strings.Contains(failure, "create") {
		t.Fatalf("failure = %q", failure)
	}
}

func TestCheckReportsAPayloadThatCannotBeMarshalled(t *testing.T) {
	if failure := check(t, t.TempDir(), "x", make(chan int)); !strings.Contains(failure, "marshal") {
		t.Fatalf("failure = %q", failure)
	}
}
