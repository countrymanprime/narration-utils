package persist

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type recorder struct {
	mu      sync.Mutex
	logs    []string
	notices []string
}

func (r *recorder) log(kind, message string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.logs = append(r.logs, kind+" "+message)
}

func (r *recorder) notify(text string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.notices = append(r.notices, text)
}

func newReporter() (*Reporter, *recorder) {
	recorded := &recorder{}
	reporter := &Reporter{Log: recorded.log, Notify: recorded.notify}
	reporter.now = func() time.Time { return time.Date(2026, 9, 21, 10, 15, 30, 0, time.UTC) }
	return reporter, recorded
}

func decodeObject(bytes []byte) error {
	var value map[string]any
	return json.Unmarshal(bytes, &value)
}

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestAFileThatIsNotThereIsMissingAndSaysNothing(t *testing.T) {
	reporter, recorded := newReporter()
	outcome := reporter.ReadJSON(filepath.Join(t.TempDir(), "none.json"), "notes", NarratorData, decodeObject)
	if outcome != Missing || len(recorded.logs) != 0 || len(recorded.notices) != 0 {
		t.Fatalf("outcome %v, logs %v, notices %v", outcome, recorded.logs, recorded.notices)
	}
}

func TestAFileThatDecodesIsLoadedAndSaysNothing(t *testing.T) {
	reporter, recorded := newReporter()
	path := filepath.Join(t.TempDir(), "ok.json")
	write(t, path, `{"a":1}`)
	if outcome := reporter.ReadJSON(path, "notes", NarratorData, decodeObject); outcome != Loaded {
		t.Fatalf("outcome = %v", outcome)
	}
	if len(recorded.logs)+len(recorded.notices) != 0 {
		t.Fatal("a good file must be silent")
	}
}

func TestCorruptNarratorDataIsKeptBesideTheOriginalLoggedAndToldToTheNarrator(t *testing.T) {
	reporter, recorded := newReporter()
	dir := t.TempDir()
	path := filepath.Join(dir, "manuscript-notes.json")
	write(t, path, `{"notes": [ SECRET NOTE TEXT`)

	outcome := reporter.ReadJSON(path, "notes", NarratorData, decodeObject)

	if outcome != Quarantined {
		t.Fatalf("outcome = %v, want Quarantined", outcome)
	}
	kept := path + ".corrupt-20260921-101530"
	if bytes, err := os.ReadFile(kept); err != nil || !strings.Contains(string(bytes), "SECRET NOTE TEXT") {
		t.Fatalf("the corrupt file was not kept as %s: %v", kept, err)
	}
	if _, err := os.Stat(path); err == nil {
		t.Fatal("the original path must be free for a fresh file")
	}
	if len(recorded.logs) != 1 || !strings.HasPrefix(recorded.logs[0], "persisted_corrupt ") {
		t.Fatalf("logs = %v", recorded.logs)
	}
	if strings.Contains(recorded.logs[0], "SECRET") || strings.Contains(strings.Join(recorded.notices, " "), "SECRET") {
		t.Fatal("neither the log nor the notice may carry the file's content")
	}
	if len(recorded.notices) != 1 || !strings.Contains(recorded.notices[0], "notes") || !strings.Contains(recorded.notices[0], "manuscript-notes.json.corrupt-20260921-101530") {
		t.Fatalf("notices = %v, want one that names the notes and where the old file is", recorded.notices)
	}
}

func TestCorruptDisposableStateHealsAndLogsWithoutKeepingOrTellingAnyone(t *testing.T) {
	reporter, recorded := newReporter()
	path := filepath.Join(t.TempDir(), "recent-projects.json")
	write(t, path, `not json`)

	outcome := reporter.ReadJSON(path, "recent projects", Disposable, decodeObject)

	if outcome != Healed {
		t.Fatalf("outcome = %v, want Healed", outcome)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal("a disposable file stays where it is: the next save replaces it")
	}
	if len(recorded.logs) != 1 || len(recorded.notices) != 0 {
		t.Fatalf("logs %v, notices %v", recorded.logs, recorded.notices)
	}
}

func TestAFileThatCannotBeMovedAsideIsLoggedAndTheNarratorIsToldItIsStillThere(t *testing.T) {
	reporter, recorded := newReporter()
	reporter.rename = func(string, string) error { return os.ErrPermission }
	path := filepath.Join(t.TempDir(), "notes.json")
	write(t, path, `[`)

	outcome := reporter.ReadJSON(path, "notes", NarratorData, decodeObject)

	if outcome != Quarantined {
		t.Fatalf("outcome = %v", outcome)
	}
	if len(recorded.logs) != 2 {
		t.Fatalf("logs = %v, want the corruption and the failed move", recorded.logs)
	}
	if len(recorded.notices) != 1 || !strings.Contains(recorded.notices[0], "could not be moved") {
		t.Fatalf("notices = %v", recorded.notices)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal("a file that could not be moved stays where it is")
	}
}

func TestTwoCorruptFilesInTheSameSecondKeepBothCopies(t *testing.T) {
	reporter, _ := newReporter()
	path := filepath.Join(t.TempDir(), "notes.json")
	for i := 0; i < 2; i++ {
		write(t, path, `{`)
		reporter.ReadJSON(path, "notes", NarratorData, decodeObject)
	}
	matches, _ := filepath.Glob(path + ".corrupt-*")
	if len(matches) != 2 {
		t.Fatalf("kept copies = %v, want two", matches)
	}
}

func TestAFileThatCannotBeReadIsLoggedNotQuarantined(t *testing.T) {
	reporter, recorded := newReporter()
	// A directory where the file should be: reading it fails with something other than "not found".
	path := filepath.Join(t.TempDir(), "notes.json")
	if err := os.Mkdir(path, 0o755); err != nil {
		t.Fatal(err)
	}
	if outcome := reporter.ReadJSON(path, "notes", NarratorData, decodeObject); outcome != Unreadable {
		t.Fatalf("outcome = %v, want Unreadable", outcome)
	}
	if len(recorded.logs) != 1 || !strings.HasPrefix(recorded.logs[0], "persisted_unreadable ") {
		t.Fatalf("logs = %v", recorded.logs)
	}
}

func TestANilReporterStillReadsAndHeals(t *testing.T) {
	var reporter *Reporter
	path := filepath.Join(t.TempDir(), "x.json")
	write(t, path, `{`)
	if outcome := reporter.ReadJSON(path, "notes", NarratorData, decodeObject); outcome != Quarantined {
		t.Fatalf("outcome = %v: the file must still be kept without a reporter", outcome)
	}
	if outcome := reporter.ReadJSON(filepath.Join(t.TempDir(), "none.json"), "notes", NarratorData, decodeObject); outcome != Missing {
		t.Fatalf("outcome = %v", outcome)
	}
}

func TestCheckVersionAcceptsOlderAndCurrentAndRefusesNewer(t *testing.T) {
	if err := CheckVersion(1, 2, "Story Bible"); err != nil {
		t.Fatal(err)
	}
	if err := CheckVersion(2, 2, "Story Bible"); err != nil {
		t.Fatal(err)
	}
	err := CheckVersion(3, 2, "Story Bible")
	if err == nil || !strings.Contains(err.Error(), "newer version") || !strings.Contains(err.Error(), "Story Bible") {
		t.Fatalf("err = %v", err)
	}
	if err := CheckVersion(0, 2, "Story Bible"); err != nil {
		t.Fatalf("a file with no version is an old one: %v", err)
	}
}

func TestCanOverwriteAllowsAMissingOrReadableFileAndRefusesOneThatCannotBeRead(t *testing.T) {
	dir := t.TempDir()
	if err := CanOverwrite(filepath.Join(dir, "none.json"), "notes"); err != nil {
		t.Fatalf("a file that is not there may be created: %v", err)
	}
	readable := filepath.Join(dir, "ok.json")
	write(t, readable, `{}`)
	if err := CanOverwrite(readable, "notes"); err != nil {
		t.Fatalf("a readable file may be replaced: %v", err)
	}
	unreadable := filepath.Join(dir, "locked.json")
	if err := os.Mkdir(unreadable, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := CanOverwrite(unreadable, "notes"); err == nil || !strings.Contains(err.Error(), "nothing was saved") {
		t.Fatalf("err = %v, want a refusal that says nothing was saved", err)
	}
}

func TestConcurrentReadersOfACorruptFileKeepItOnceAndTellTheNarratorOnce(t *testing.T) {
	reporter, recorded := newReporter()
	reporter.now = time.Now
	path := filepath.Join(t.TempDir(), "notes.json")
	write(t, path, `{`)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			reporter.ReadJSON(path, "notes", NarratorData, decodeObject)
		}()
	}
	wg.Wait()
	if matches, _ := filepath.Glob(path + ".corrupt-*"); len(matches) != 1 {
		t.Fatalf("kept copies = %v, want exactly one", matches)
	}
	if len(recorded.notices) != 1 {
		t.Fatalf("notices = %v, want exactly one", recorded.notices)
	}
}
