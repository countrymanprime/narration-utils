package recording_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/recording"
	"github.com/countrymanprime/narration-utils/shell/internal/recording/recordingtest"
)

func writeTake(t *testing.T, folder, name string) {
	t.Helper()
	if err := os.MkdirAll(folder, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := recordingtest.WriteWav(filepath.Join(folder, name+".wav"), 24000); err != nil {
		t.Fatal(err)
	}
}

func TestSetTakeKeeperMarksAndPersists(t *testing.T) {
	fake := &recordingtest.Fake{}
	r := newRecorder(t, fake)
	writeTake(t, r.folder(), "Take 001")

	if err := r.service.SetTakeKeeper("Take 001", true); err != nil {
		t.Fatalf("SetTakeKeeper: %v", err)
	}

	state := r.service.Snapshot()
	if len(state.Takes) != 1 || !state.Takes[0].Keeper {
		t.Fatalf("Takes = %+v, want Take 001 marked keeper", state.Takes)
	}

	// A fresh service over the same folder reads the same mark back: project-owned state, not process-owned.
	other := recording.New(recording.Config{Project: r.project}, fake, nil, nil)
	if !other.Snapshot().Takes[0].Keeper {
		t.Fatal("a fresh service over the same folder did not read the keeper mark back")
	}
}

func TestSetTakeKeeperUndoesByMarkingFalse(t *testing.T) {
	r := newRecorder(t, &recordingtest.Fake{})
	writeTake(t, r.folder(), "Take 001")
	if err := r.service.SetTakeKeeper("Take 001", true); err != nil {
		t.Fatal(err)
	}

	if err := r.service.SetTakeKeeper("Take 001", false); err != nil {
		t.Fatalf("undoing: %v", err)
	}
	if r.service.Snapshot().Takes[0].Keeper {
		t.Fatal("Keeper = true, want false after undoing")
	}
}

func TestSetTakeKeeperIsExclusiveWithinALine(t *testing.T) {
	r := newRecorder(t, &recordingtest.Fake{})
	writeTake(t, r.folder(), "Take 001")
	writeTake(t, r.folder(), "Take 002")
	writeTake(t, r.folder(), "Take 003")
	// Take 001 and 002 share a line; Take 003 is on a different one.
	if err := r.service.SetTakeLine("Take 001", "p-000001", "sha-1"); err != nil {
		t.Fatal(err)
	}
	if err := r.service.SetTakeLine("Take 002", "p-000001", "sha-1"); err != nil {
		t.Fatal(err)
	}
	if err := r.service.SetTakeLine("Take 003", "p-000002", "sha-1"); err != nil {
		t.Fatal(err)
	}

	if err := r.service.SetTakeKeeper("Take 001", true); err != nil {
		t.Fatal(err)
	}
	if err := r.service.SetTakeKeeper("Take 003", true); err != nil {
		t.Fatal(err)
	}
	byName := map[string]bool{}
	for _, take := range r.service.Snapshot().Takes {
		byName[take.Name] = take.Keeper
	}
	if byName["Take 001"] != true || byName["Take 002"] != false || byName["Take 003"] != true {
		t.Fatalf("keeper marks = %+v, want only Take 001 and Take 003 (each the keeper of its own line)", byName)
	}

	// Marking Take 002 the keeper takes over from Take 001, since they share a line; Take 003 (a different line)
	// is untouched.
	if err := r.service.SetTakeKeeper("Take 002", true); err != nil {
		t.Fatal(err)
	}
	byName = map[string]bool{}
	for _, take := range r.service.Snapshot().Takes {
		byName[take.Name] = take.Keeper
	}
	if byName["Take 001"] != false || byName["Take 002"] != true || byName["Take 003"] != true {
		t.Fatalf("keeper marks after handoff = %+v, want Take 002 and Take 003 the keepers", byName)
	}
}

func TestSetTakeKeeperWithNoLineHasNoGroupToClear(t *testing.T) {
	r := newRecorder(t, &recordingtest.Fake{})
	writeTake(t, r.folder(), "Take 001")
	writeTake(t, r.folder(), "Take 002")

	if err := r.service.SetTakeKeeper("Take 001", true); err != nil {
		t.Fatal(err)
	}
	if err := r.service.SetTakeKeeper("Take 002", true); err != nil {
		t.Fatal(err)
	}
	byName := map[string]bool{}
	for _, take := range r.service.Snapshot().Takes {
		byName[take.Name] = take.Keeper
	}
	if !byName["Take 001"] || !byName["Take 002"] {
		t.Fatalf("keeper marks = %+v, want both takes marked (neither has a line to share)", byName)
	}
}

func TestSetTakeKeeperRefusesAnEmptyTakeName(t *testing.T) {
	r := newRecorder(t, &recordingtest.Fake{})
	if err := os.MkdirAll(r.folder(), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := r.service.SetTakeKeeper("", true); err == nil {
		t.Fatal("want an error for an empty take name")
	}
}

func TestSetTakeKeeperWithoutAProjectIsRefused(t *testing.T) {
	svc := recording.New(recording.Config{}, &recordingtest.Fake{}, nil, nil)
	if err := svc.SetTakeKeeper("Take 001", true); err == nil {
		t.Fatal("want an error without a project")
	}
}

// TestTakeListingSurvivesACorruptKeeperFile mirrors TestTakeListingSurvivesACorruptIdentityFile: a malformed keeper
// sidecar never blocks the take listing itself.
func TestTakeListingSurvivesACorruptKeeperFile(t *testing.T) {
	r := newRecorder(t, &recordingtest.Fake{})
	writeTake(t, r.folder(), "Take 001")
	if err := os.WriteFile(filepath.Join(r.folder(), "keeper.json"), []byte("not json"), 0o600); err != nil {
		t.Fatal(err)
	}

	state := r.service.Snapshot()
	if len(state.Takes) != 1 {
		t.Fatalf("takes = %d, want 1 despite the corrupt sidecar", len(state.Takes))
	}
	if state.Takes[0].Keeper {
		t.Fatal("Keeper = true, want false (a corrupt sidecar yields no marks)")
	}
}
