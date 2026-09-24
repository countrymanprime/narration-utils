package stages

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

func decisionAt(chapterID string, kind DecisionKind, minute int) Decision {
	return Decision{
		ChapterID: chapterID,
		Kind:      kind,
		From:      StageRecording,
		Target:    StageEditing,
		BasisKey:  "key-" + chapterID,
		Basis:     []SignalBasis{{ID: "recording.text", State: SignalMet, LedgerRecordIDs: []string{"rec-1"}, Fingerprint: "fp", Summary: "all read"}},
		At:        time.Date(2026, 9, 23, 10, minute, 0, 0, time.UTC),
	}
}

func writeRaw(t *testing.T, project, content string) {
	t.Helper()
	path := DecisionsFile(project)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestDecisionStoreListsNothingBeforeTheFirstDecision(t *testing.T) {
	got, err := NewDecisionStore(t.TempDir(), nil).List("doc-1")
	if err != nil || got == nil || len(got) != 0 {
		t.Fatalf("List = %v, %v; want an empty list", got, err)
	}
}

func TestDecisionStoreAppendsInOrderAndWritesTheDocumentedShape(t *testing.T) {
	project := t.TempDir()
	store := NewDecisionStore(project, nil)
	first, second := decisionAt("c-0001", DecisionConfirmed, 1), decisionAt("c-0002", DecisionDismissed, 2)
	for _, decision := range []Decision{first, second} {
		if err := store.Append("doc-1", decision); err != nil {
			t.Fatal(err)
		}
	}

	got, err := store.List("doc-1")
	if err != nil || len(got) != 2 || !sameDecision(got[0], first) || !sameDecision(got[1], second) {
		t.Fatalf("List = %+v, %v", got, err)
	}
	raw, err := os.ReadFile(DecisionsFile(project))
	if err != nil {
		t.Fatal(err)
	}
	var shape map[string]any
	if err := json.Unmarshal(raw, &shape); err != nil {
		t.Fatal(err)
	}
	if shape["schemaVersion"] != float64(1) || shape["documentId"] != "doc-1" {
		t.Fatalf("file header %v", shape)
	}
	entry := shape["decisions"].([]any)[0].(map[string]any)
	for _, key := range []string{"chapterId", "kind", "from", "target", "basisKey", "basis", "at"} {
		if _, ok := entry[key]; !ok {
			t.Errorf("decision lacks %q: %v", key, entry)
		}
	}
	if _, err := os.Stat(DecisionsFile(project) + ".tmp"); !os.IsNotExist(err) {
		t.Fatalf("temporary file left behind: %v", err)
	}
}

// Chapter ids are positional and reset on a re-import, so decisions kept for
// another manuscript document never apply to this one.
func TestDecisionStoreIgnoresAndReplacesAnotherDocumentsFile(t *testing.T) {
	project := t.TempDir()
	store := NewDecisionStore(project, nil)
	if err := store.Append("doc-old", decisionAt("c-0001", DecisionConfirmed, 1)); err != nil {
		t.Fatal(err)
	}

	got, err := store.List("doc-new")
	if err != nil || len(got) != 0 {
		t.Fatalf("another document's decisions leaked: %+v, %v", got, err)
	}
	if err := store.Append("doc-new", decisionAt("c-0002", DecisionDismissed, 2)); err != nil {
		t.Fatal(err)
	}
	if old, _ := store.List("doc-old"); len(old) != 0 {
		t.Fatalf("the old document's decisions survived a write for the new one: %+v", old)
	}
	if fresh, _ := store.List("doc-new"); len(fresh) != 1 || fresh[0].ChapterID != "c-0002" {
		t.Fatalf("new document's decisions %+v", fresh)
	}
}

func TestDecisionStoreRemoveTakesBackOnlyTheLatestMatchingDecision(t *testing.T) {
	store := NewDecisionStore(t.TempDir(), nil)
	kept, removed := decisionAt("c-0001", DecisionDismissed, 1), decisionAt("c-0001", DecisionConfirmed, 2)
	for _, decision := range []Decision{kept, removed} {
		if err := store.Append("doc-1", decision); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.Remove("doc-1", removed); err != nil {
		t.Fatal(err)
	}
	if err := store.Remove("doc-1", decisionAt("c-0009", DecisionConfirmed, 9)); err != nil {
		t.Fatalf("removing an absent decision is not an error: %v", err)
	}
	got, _ := store.List("doc-1")
	if len(got) != 1 || !sameDecision(got[0], kept) {
		t.Fatalf("after Remove: %+v", got)
	}
}

func TestDecisionStoreRefusesADecisionWithoutADocumentOrChapter(t *testing.T) {
	store := NewDecisionStore(t.TempDir(), nil)
	if err := store.Append("", decisionAt("c-0001", DecisionConfirmed, 1)); err == nil {
		t.Fatal("a decision without a document was stored")
	}
	if err := store.Append("doc-1", Decision{Kind: DecisionConfirmed}); err == nil {
		t.Fatal("a decision without a chapter was stored")
	}
}

// A corrupt file is the narrator's work: it is kept aside, the narrator is
// told, and the read that met it is an error, never a silent empty list.
func TestDecisionStoreReportsACorruptFileAndKeepsItAside(t *testing.T) {
	project := t.TempDir()
	writeRaw(t, project, "{not json")
	notices := []string{}
	store := NewDecisionStore(project, &persist.Reporter{Notify: func(text string) { notices = append(notices, text) }})

	if _, err := store.List("doc-1"); err == nil {
		t.Fatal("a corrupt decisions file read as an empty list")
	}
	if len(notices) != 1 || !strings.Contains(notices[0], "stage decisions") {
		t.Fatalf("narrator notices %v", notices)
	}
	kept, _ := filepath.Glob(DecisionsFile(project) + ".corrupt-*")
	if len(kept) != 1 {
		t.Fatalf("corrupt file not kept aside: %v", kept)
	}
	if got, err := store.List("doc-1"); err != nil || len(got) != 0 {
		t.Fatalf("after the notice a fresh file starts: %v, %v", got, err)
	}
}

func TestDecisionStoreRefusesAndKeepsAFileFromANewerApp(t *testing.T) {
	project := t.TempDir()
	newer := `{"schemaVersion": 2, "documentId": "doc-1", "decisions": []}`
	writeRaw(t, project, newer)
	store := NewDecisionStore(project, nil)

	if _, err := store.List("doc-1"); err == nil || !strings.Contains(err.Error(), "newer version") {
		t.Fatalf("List error %v, want the newer-version refusal", err)
	}
	if err := store.Append("doc-1", decisionAt("c-0001", DecisionConfirmed, 1)); err == nil {
		t.Fatal("a newer app's file was overwritten")
	}
	raw, _ := os.ReadFile(DecisionsFile(project))
	if string(raw) != newer {
		t.Fatalf("newer file changed to %s", raw)
	}
}

func TestDecisionStoreReportsAFileItCannotRead(t *testing.T) {
	project := t.TempDir()
	// A directory where the file should be cannot be read as a file.
	if err := os.MkdirAll(DecisionsFile(project), 0o755); err != nil {
		t.Fatal(err)
	}
	store := NewDecisionStore(project, nil)
	if _, err := store.List("doc-1"); err == nil {
		t.Fatal("an unreadable decisions file read as an empty list")
	}
	if err := store.Append("doc-1", decisionAt("c-0001", DecisionConfirmed, 1)); err == nil {
		t.Fatal("an unreadable decisions file was overwritten")
	}
}

func TestDecisionStoreReadsAFileWithNoDecisionsAsEmpty(t *testing.T) {
	project := t.TempDir()
	writeRaw(t, project, `{"schemaVersion": 1, "documentId": "doc-1"}`)
	got, err := NewDecisionStore(project, nil).List("doc-1")
	if err != nil || got == nil || len(got) != 0 {
		t.Fatalf("List = %v, %v", got, err)
	}
}

func TestDecisionStoreRemoveReportsACorruptFile(t *testing.T) {
	project := t.TempDir()
	writeRaw(t, project, "{broken")
	if err := NewDecisionStore(project, nil).Remove("doc-1", decisionAt("c-0001", DecisionConfirmed, 1)); err == nil {
		t.Fatal("Remove over a corrupt file reported success")
	}
}

func TestDecisionStoreReportsEachWriteFailure(t *testing.T) {
	t.Run("folder cannot be created", func(t *testing.T) {
		project := t.TempDir()
		// A file where the narration-utils folder should be.
		if err := os.WriteFile(filepath.Join(project, "narration-utils"), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := NewDecisionStore(project, nil).Append("doc-1", decisionAt("c-0001", DecisionConfirmed, 1)); err == nil {
			t.Fatal("Append succeeded without a folder")
		}
	})
	t.Run("temporary file cannot be written", func(t *testing.T) {
		project := t.TempDir()
		if err := os.MkdirAll(DecisionsFile(project)+".tmp", 0o755); err != nil {
			t.Fatal(err)
		}
		if err := NewDecisionStore(project, nil).Append("doc-1", decisionAt("c-0001", DecisionConfirmed, 1)); err == nil {
			t.Fatal("Append succeeded without writing")
		}
	})
	t.Run("decision cannot be encoded", func(t *testing.T) {
		decision := decisionAt("c-0001", DecisionConfirmed, 1)
		decision.At = time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)
		if err := NewDecisionStore(t.TempDir(), nil).Append("doc-1", decision); err == nil {
			t.Fatal("Append stored a time JSON cannot hold")
		}
	})
	t.Run("file cannot be activated", func(t *testing.T) {
		project := t.TempDir()
		store := NewDecisionStore(project, nil)
		store.rename = func(string, string) error { return errors.New("locked") }
		if err := store.Append("doc-1", decisionAt("c-0001", DecisionConfirmed, 1)); err == nil {
			t.Fatal("Append succeeded without activating the file")
		}
		if _, err := os.Stat(DecisionsFile(project)); !os.IsNotExist(err) {
			t.Fatalf("the decisions file appeared: %v", err)
		}
	})
}
