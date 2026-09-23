package evidence

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func baseLedgerRecord(analyzerID, chapterID string, startedAt time.Time, outcome LedgerOutcome) LedgerRecord {
	return LedgerRecord{
		AnalyzerID:      analyzerID,
		AnalyzerVersion: "1",
		Scope:           LedgerScope{DocumentID: "doc-1", ChapterID: chapterID},
		Fingerprint:     LedgerFingerprint{TrackFingerprint: "tf-1"},
		ProjectFile:     LedgerProjectFile{Path: "project.rpp", ModTime: startedAt},
		StartedAt:       startedAt,
		CompletedAt:     startedAt.Add(time.Second),
		Outcome:         outcome,
	}
}

// --- Write/Get round trip ---

func TestWriteAssignsAnIDAndGetReadsItBack(t *testing.T) {
	store := NewLedgerStore(t.TempDir())
	written, err := store.Write(baseLedgerRecord("rc", "c-0001", time.Now(), LedgerComplete))
	if err != nil {
		t.Fatal(err)
	}
	if written.ID == "" {
		t.Fatalf("Write did not assign an ID: %#v", written)
	}
	if written.SchemaVersion != ledgerSchemaVersion {
		t.Fatalf("SchemaVersion = %d, want %d", written.SchemaVersion, ledgerSchemaVersion)
	}

	got, ok := store.Get(written.ID)
	if !ok {
		t.Fatalf("Get(%s) not found", written.ID)
	}
	if got.AnalyzerID != "rc" || got.Scope.ChapterID != "c-0001" || got.Outcome != LedgerComplete {
		t.Fatalf("Get returned %#v", got)
	}
}

func TestWriteKeepsAnExplicitID(t *testing.T) {
	store := NewLedgerStore(t.TempDir())
	record := baseLedgerRecord("rc", "c-0001", time.Now(), LedgerComplete)
	record.ID = "explicit-id"
	written, err := store.Write(record)
	if err != nil {
		t.Fatal(err)
	}
	if written.ID != "explicit-id" {
		t.Fatalf("ID = %q, want explicit-id", written.ID)
	}
	if _, ok := store.Get("explicit-id"); !ok {
		t.Fatal("Get(explicit-id) not found")
	}
}

func TestGetOnMissingIDReportsNotFound(t *testing.T) {
	store := NewLedgerStore(t.TempDir())
	if _, ok := store.Get("does-not-exist"); ok {
		t.Fatal("Get on a missing record reported found")
	}
}

func TestWriteStoresOneFilePerRecordUnderTheLedgerDirectory(t *testing.T) {
	project := t.TempDir()
	store := NewLedgerStore(project)
	written, err := store.Write(baseLedgerRecord("rc", "c-0001", time.Now(), LedgerComplete))
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(LedgerDir(project), written.ID+".json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected a file at %s: %v", path, err)
	}
}

// --- Latest / List ---

func TestLatestReturnsTheMostRecentlyStartedRecordForAnalyzerAndChapter(t *testing.T) {
	store := NewLedgerStore(t.TempDir())
	now := time.Now()
	older, err := store.Write(baseLedgerRecord("rc", "c-0001", now.Add(-time.Hour), LedgerComplete))
	if err != nil {
		t.Fatal(err)
	}
	newer, err := store.Write(baseLedgerRecord("rc", "c-0001", now, LedgerComplete))
	if err != nil {
		t.Fatal(err)
	}
	// A record for a different chapter must not be picked.
	if _, err := store.Write(baseLedgerRecord("rc", "c-0002", now.Add(time.Hour), LedgerComplete)); err != nil {
		t.Fatal(err)
	}
	// A record for a different analyzer over the same chapter must not be picked.
	if _, err := store.Write(baseLedgerRecord("er", "c-0001", now.Add(time.Hour), LedgerComplete)); err != nil {
		t.Fatal(err)
	}

	got, ok := store.Latest("rc", "c-0001")
	if !ok {
		t.Fatal("Latest did not find a record")
	}
	if got.ID != newer.ID {
		t.Fatalf("Latest = %s, want %s (older = %s)", got.ID, newer.ID, older.ID)
	}
}

func TestLatestReportsNotFoundWhenNothingMatches(t *testing.T) {
	store := NewLedgerStore(t.TempDir())
	if _, err := store.Write(baseLedgerRecord("rc", "c-0001", time.Now(), LedgerComplete)); err != nil {
		t.Fatal(err)
	}
	if _, ok := store.Latest("er", "c-0001"); ok {
		t.Fatal("Latest matched an analyzer with no records")
	}
}

func TestListReturnsMatchesNewestFirst(t *testing.T) {
	store := NewLedgerStore(t.TempDir())
	now := time.Now()
	first, _ := store.Write(baseLedgerRecord("rc", "c-0001", now.Add(-2*time.Hour), LedgerComplete))
	second, _ := store.Write(baseLedgerRecord("rc", "c-0001", now.Add(-time.Hour), LedgerFailed))
	third, _ := store.Write(baseLedgerRecord("rc", "c-0001", now, LedgerComplete))

	got, err := store.List("rc", "c-0001")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("List returned %d records, want 3", len(got))
	}
	if got[0].ID != third.ID || got[1].ID != second.ID || got[2].ID != first.ID {
		t.Fatalf("List order = [%s, %s, %s], want newest-first [%s, %s, %s]", got[0].ID, got[1].ID, got[2].ID, third.ID, second.ID, first.ID)
	}
}

func TestAllOnAnEmptyStoreIsEmptyNotAnError(t *testing.T) {
	store := NewLedgerStore(t.TempDir())
	records, err := store.All()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 0 {
		t.Fatalf("All() = %#v, want empty", records)
	}
}

// --- Crash / partial-write durability (Success Metrics: ledger durability) ---

func TestAStrayTmpFileFromAnInterruptedWriteDoesNotHidePreviousRecords(t *testing.T) {
	project := t.TempDir()
	store := NewLedgerStore(project)
	written, err := store.Write(baseLedgerRecord("rc", "c-0001", time.Now(), LedgerComplete))
	if err != nil {
		t.Fatal(err)
	}

	// Simulate a kill between the temp write and the rename: a stray .tmp
	// file for a second, never-completed record sits beside the first.
	strayPath := filepath.Join(LedgerDir(project), "in-flight.json.tmp")
	if err := os.WriteFile(strayPath, []byte(`{"id":"in-flight"`), 0o600); err != nil {
		t.Fatal(err)
	}

	got, ok := store.Get(written.ID)
	if !ok || got.ID != written.ID {
		t.Fatalf("Get after a stray .tmp = %#v, %v; want the previous record readable", got, ok)
	}
	all, err := store.All()
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 {
		t.Fatalf("All() = %#v, want exactly the one completed record", all)
	}
}

func TestAPartialOrFailedRecordIsStillReadableAsItself(t *testing.T) {
	store := NewLedgerStore(t.TempDir())
	written, err := store.Write(baseLedgerRecord("rc", "c-0001", time.Now(), LedgerPartial))
	if err != nil {
		t.Fatal(err)
	}
	got, ok := store.Get(written.ID)
	if !ok {
		t.Fatal("Get did not find the partial record")
	}
	if got.Outcome != LedgerPartial {
		t.Fatalf("Outcome = %s, want partial; a partial run must never silently read as complete", got.Outcome)
	}
}

func TestARecordWrittenByANewerSchemaReadsAsAbsent(t *testing.T) {
	project := t.TempDir()
	store := NewLedgerStore(project)
	if err := os.MkdirAll(LedgerDir(project), 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(LedgerDir(project), "future.json")
	future := `{"id":"future","schemaVersion":999,"analyzerId":"rc","scope":{"chapterId":"c-0001"},"outcome":"complete"}`
	if err := os.WriteFile(path, []byte(future), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, ok := store.Get("future"); ok {
		t.Fatal("Get returned a record from a newer, unsupported schema version")
	}
	all, err := store.All()
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 0 {
		t.Fatalf("All() = %#v, want the future-schema record excluded, not errored", all)
	}
}

// --- Retain / pruning (Q3: latest per analyzer+chapter, plus anything referenced) ---

func TestRetainKeepsOnlyTheLatestPerAnalyzerAndChapterByDefault(t *testing.T) {
	store := NewLedgerStore(t.TempDir())
	now := time.Now()
	older, _ := store.Write(baseLedgerRecord("rc", "c-0001", now.Add(-time.Hour), LedgerComplete))
	newer, _ := store.Write(baseLedgerRecord("rc", "c-0001", now, LedgerComplete))

	deleted, err := store.Retain(nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(deleted) != 1 || deleted[0] != older.ID {
		t.Fatalf("Retain deleted %#v, want [%s]", deleted, older.ID)
	}
	if _, ok := store.Get(newer.ID); !ok {
		t.Fatal("Retain deleted the latest record")
	}
	if _, ok := store.Get(older.ID); ok {
		t.Fatal("Retain kept the superseded record")
	}
}

func TestRetainNeverPrunesAReferencedRecordEvenWhenSuperseded(t *testing.T) {
	store := NewLedgerStore(t.TempDir())
	now := time.Now()
	referenced, _ := store.Write(baseLedgerRecord("rc", "c-0001", now.Add(-time.Hour), LedgerComplete))
	newer, _ := store.Write(baseLedgerRecord("rc", "c-0001", now, LedgerComplete))

	deleted, err := store.Retain([]string{referenced.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(deleted) != 0 {
		t.Fatalf("Retain deleted %#v, want nothing (referenced record must survive)", deleted)
	}
	if _, ok := store.Get(referenced.ID); !ok {
		t.Fatal("Retain pruned a record its caller referenced")
	}
	if _, ok := store.Get(newer.ID); !ok {
		t.Fatal("Retain pruned the latest record")
	}
}

func TestRetainKeepsTheLatestPerChapterIndependently(t *testing.T) {
	store := NewLedgerStore(t.TempDir())
	now := time.Now()
	chapterOneOld, _ := store.Write(baseLedgerRecord("rc", "c-0001", now.Add(-time.Hour), LedgerComplete))
	chapterOneNew, _ := store.Write(baseLedgerRecord("rc", "c-0001", now, LedgerComplete))
	chapterTwo, _ := store.Write(baseLedgerRecord("rc", "c-0002", now, LedgerComplete))

	deleted, err := store.Retain(nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(deleted) != 1 || deleted[0] != chapterOneOld.ID {
		t.Fatalf("Retain deleted %#v, want [%s]", deleted, chapterOneOld.ID)
	}
	for _, id := range []string{chapterOneNew.ID, chapterTwo.ID} {
		if _, ok := store.Get(id); !ok {
			t.Fatalf("Retain deleted a record it should have kept: %s", id)
		}
	}
}

func TestRetainOnAnEmptyStoreDeletesNothing(t *testing.T) {
	store := NewLedgerStore(t.TempDir())
	deleted, err := store.Retain([]string{"nothing-here"})
	if err != nil {
		t.Fatal(err)
	}
	if len(deleted) != 0 {
		t.Fatalf("Retain on an empty store deleted %#v", deleted)
	}
}

func TestRetainIgnoresStrayTmpFiles(t *testing.T) {
	project := t.TempDir()
	store := NewLedgerStore(project)
	kept, err := store.Write(baseLedgerRecord("rc", "c-0001", time.Now(), LedgerComplete))
	if err != nil {
		t.Fatal(err)
	}
	strayPath := filepath.Join(LedgerDir(project), "in-flight.json.tmp")
	if err := os.WriteFile(strayPath, []byte(`{"id":"in-flight"`), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := store.Retain(nil); err != nil {
		t.Fatal(err)
	}
	if _, ok := store.Get(kept.ID); !ok {
		t.Fatal("Retain removed the one real record")
	}
	if _, err := os.Stat(strayPath); err != nil {
		t.Fatalf("Retain should not touch a stray .tmp file, but it is gone: %v", err)
	}
}
