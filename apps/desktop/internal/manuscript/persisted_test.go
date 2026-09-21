package manuscript

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

func TestCorruptNotesAreKeptAsideToldAndNeverReplacedSilentlyByTheNextNote(t *testing.T) {
	service, chapterID, paragraphID := importReaderFixture(t)
	var notices, logs []string
	service.SetPersist(&persist.Reporter{
		Log:    func(kind, message string) { logs = append(logs, kind+" "+message) },
		Notify: func(text string) { notices = append(notices, text) },
	})
	path := filepath.Join(service.project, "narration-utils", "manuscript-notes.json")
	if err := os.WriteFile(path, []byte(`{"notes": [ {"text": "MY PRIVATE NOTE"`), 0o600); err != nil {
		t.Fatal(err)
	}

	if got := service.Notes(chapterID); len(got) != 0 {
		t.Fatalf("notes = %v, want none from a file that cannot be read", got)
	}
	if len(notices) != 1 || !strings.Contains(notices[0], "notes") {
		t.Fatalf("notices = %v", notices)
	}
	if _, err := service.CreateNote(chapterID, paragraphID, "A new note", nil, nil, ""); err != nil {
		t.Fatal(err)
	}
	matches, _ := filepath.Glob(path + ".corrupt-*")
	if len(matches) != 1 {
		t.Fatalf("kept copies = %v: the note the narrator wrote before must survive", matches)
	}
	if bytes, _ := os.ReadFile(matches[0]); !strings.Contains(string(bytes), "MY PRIVATE NOTE") {
		t.Fatal("the kept copy is not the original file")
	}
	if strings.Contains(strings.Join(logs, " "), "PRIVATE") || strings.Contains(strings.Join(notices, " "), "PRIVATE") {
		t.Fatal("the log and the notice must not carry note text")
	}
}

func TestNotesWithNoReporterAreStillKeptWhenCorrupt(t *testing.T) {
	service, chapterID, _ := importReaderFixture(t)
	path := filepath.Join(service.project, "narration-utils", "manuscript-notes.json")
	if err := os.WriteFile(path, []byte(`nope`), 0o600); err != nil {
		t.Fatal(err)
	}
	_ = service.Notes(chapterID)
	if matches, _ := filepath.Glob(path + ".corrupt-*"); len(matches) != 1 {
		t.Fatalf("kept copies = %v", matches)
	}
}

func TestANoteIsNotSavedOverANotesFileThatCannotBeRead(t *testing.T) {
	service, chapterID, paragraphID := importReaderFixture(t)
	path := filepath.Join(service.project, "narration-utils", "manuscript-notes.json")
	// A directory where the file should be: it exists, and reading it fails.
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := service.CreateNote(chapterID, paragraphID, "A new note", nil, nil, ""); err == nil || !strings.Contains(err.Error(), "nothing was saved") {
		t.Fatalf("err = %v, want a refusal that leaves the file alone", err)
	}
}
