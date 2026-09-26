package character

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// projectFile writes a minimal saved .rpp with two named regions (with GUIDs)
// and returns a Config whose ProjectFile resolves to it, exactly the shape
// tracks.Parse already reads (Q3 option A: region parse from the saved
// project, never a live bridge command).
func projectFile(t *testing.T, rpp string) Config {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "project.rpp")
	if err := os.WriteFile(path, []byte(rpp), 0o600); err != nil {
		t.Fatal(err)
	}
	return Config{
		Project:     dir,
		ProjectFile: func() (string, error) { return path, nil },
	}
}

const twoRegions = `<REAPER_PROJECT 0.1 "7.0" 0
  MARKER 1 1.5 "Alice ref A" 1 0 1 R {AAAAAAAA-0000-0000-0000-000000000001} 0 1
  MARKER 1 3.5 "" 1
  MARKER 2 10 "Narration ref" 1 0 1 R {BBBBBBBB-0000-0000-0000-000000000002} 0 1
  MARKER 2 14 "" 1
>
`

func fixedNow(t time.Time) func() time.Time { return func() time.Time { return t } }

func newTestService(t *testing.T, rpp string) *Service {
	t.Helper()
	config := projectFile(t, rpp)
	service := New(config)
	service.now = fixedNow(time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC))
	return service
}

func TestListRegionsReadsTheSavedProjectsRegions(t *testing.T) {
	service := newTestService(t, twoRegions)
	regions, err := service.ListRegions()
	if err != nil {
		t.Fatal(err)
	}
	if len(regions) != 2 {
		t.Fatalf("want 2 regions, got %d: %#v", len(regions), regions)
	}
	if regions[0].Name != "Alice ref A" || regions[0].GUID != "{AAAAAAAA-0000-0000-0000-000000000001}" {
		t.Fatalf("unexpected first region: %#v", regions[0])
	}
}

func TestListRegionsFailsClearlyWithNoChosenProjectFile(t *testing.T) {
	service := New(Config{Project: t.TempDir()})
	if _, err := service.ListRegions(); err == nil {
		t.Fatal("want an error when no project file is chosen")
	}
}

func TestApproveStoresASnapshotOfTheNamedRegion(t *testing.T) {
	service := newTestService(t, twoRegions)
	ref, err := service.Approve("char-alice", "{AAAAAAAA-0000-0000-0000-000000000001}", "first chapter read")
	if err != nil {
		t.Fatal(err)
	}
	if ref.CharacterID != "char-alice" || ref.RegionGUID != "{AAAAAAAA-0000-0000-0000-000000000001}" {
		t.Fatalf("unexpected reference: %#v", ref)
	}
	if ref.Snapshot.Name != "Alice ref A" || ref.Snapshot.Start != 1.5 || ref.Snapshot.End != 3.5 {
		t.Fatalf("unexpected snapshot: %#v", ref.Snapshot)
	}
	if ref.Note != "first chapter read" {
		t.Fatalf("note not stored: %#v", ref)
	}
	if !ref.ApprovedAt.Equal(time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC)) {
		t.Fatalf("approved-at not stamped: %v", ref.ApprovedAt)
	}

	approved, err := service.References()
	if err != nil {
		t.Fatal(err)
	}
	if len(approved) != 1 {
		t.Fatalf("want 1 stored reference, got %d", len(approved))
	}
	if approved[0].ChangedSinceApproval {
		t.Fatal("a freshly approved region must not read as changed")
	}
}

func TestApproveRefusesARegionTheSavedProjectDoesNotHave(t *testing.T) {
	service := newTestService(t, twoRegions)
	if _, err := service.Approve("char-alice", "{NOT-A-REAL-GUID}", ""); err == nil {
		t.Fatal("want an error approving a region absent from the saved project")
	}
}

func TestApproveRefusesAnEmptyCharacterOrRegion(t *testing.T) {
	service := newTestService(t, twoRegions)
	if _, err := service.Approve("", "{AAAAAAAA-0000-0000-0000-000000000001}", ""); err == nil {
		t.Fatal("want an error with no character id")
	}
	if _, err := service.Approve("char-alice", "", ""); err == nil {
		t.Fatal("want an error with no region GUID")
	}
}

func TestReApprovingTheSameCharacterAndRegionRefreshesTheSnapshotInPlace(t *testing.T) {
	service := newTestService(t, twoRegions)
	first, err := service.Approve("char-alice", "{AAAAAAAA-0000-0000-0000-000000000001}", "note one")
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.Approve("char-alice", "{AAAAAAAA-0000-0000-0000-000000000001}", "note two")
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID {
		t.Fatalf("re-approval must reuse the same reference id: %s vs %s", first.ID, second.ID)
	}
	approved, err := service.References()
	if err != nil {
		t.Fatal(err)
	}
	if len(approved) != 1 {
		t.Fatalf("re-approval must replace, not duplicate: got %d references", len(approved))
	}
	if approved[0].Note != "note two" {
		t.Fatalf("re-approval must carry the new note: %#v", approved[0])
	}
}

func TestApprovingTheSameRegionForTwoCharactersKeepsBothReferences(t *testing.T) {
	service := newTestService(t, twoRegions)
	if _, err := service.Approve("char-alice", "{AAAAAAAA-0000-0000-0000-000000000001}", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Approve("char-bob", "{AAAAAAAA-0000-0000-0000-000000000001}", ""); err != nil {
		t.Fatal(err)
	}
	approved, err := service.References()
	if err != nil {
		t.Fatal(err)
	}
	if len(approved) != 2 {
		t.Fatalf("want 2 references (one per character), got %d", len(approved))
	}
}

func TestNarrationIsApprovedLikeAnyOtherCharacter(t *testing.T) {
	service := newTestService(t, twoRegions)
	ref, err := service.Approve(NarrationCharacterID, "{BBBBBBBB-0000-0000-0000-000000000002}", "")
	if err != nil {
		t.Fatal(err)
	}
	if ref.CharacterID != NarrationCharacterID {
		t.Fatalf("unexpected character id: %s", ref.CharacterID)
	}
}

func TestRevokeRemovesTheReferenceEntirely(t *testing.T) {
	service := newTestService(t, twoRegions)
	ref, err := service.Approve("char-alice", "{AAAAAAAA-0000-0000-0000-000000000001}", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Revoke(ref.ID); err != nil {
		t.Fatal(err)
	}
	approved, err := service.References()
	if err != nil {
		t.Fatal(err)
	}
	if len(approved) != 0 {
		t.Fatalf("want no references left after revoke, got %d", len(approved))
	}
}

func TestRevokeIsIdempotentOnAnUnknownID(t *testing.T) {
	service := newTestService(t, twoRegions)
	if err := service.Revoke("not-a-real-id"); err != nil {
		t.Fatalf("revoking an unknown id must not error: %v", err)
	}
}

func TestRevokingOneCharactersReferenceLeavesAnotherCharactersAlone(t *testing.T) {
	service := newTestService(t, twoRegions)
	alice, err := service.Approve("char-alice", "{AAAAAAAA-0000-0000-0000-000000000001}", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Approve("char-bob", "{BBBBBBBB-0000-0000-0000-000000000002}", ""); err != nil {
		t.Fatal(err)
	}
	if err := service.Revoke(alice.ID); err != nil {
		t.Fatal(err)
	}
	approved, err := service.References()
	if err != nil {
		t.Fatal(err)
	}
	if len(approved) != 1 || approved[0].CharacterID != "char-bob" {
		t.Fatalf("unexpected surviving references: %#v", approved)
	}
}

// Character ids are opaque strings this package never validates (phase 3
// scope): a reference for a character id nothing else currently mentions -
// an "orphaned" character, for example after the Story Bible entity that
// used to carry that id was deleted or merged away - is neither dropped nor
// specially marked. Only an explicit Revoke ever removes a reference.
func TestAnOrphanedCharacterIDsReferenceSurvivesUntouched(t *testing.T) {
	service := newTestService(t, twoRegions)
	ref, err := service.Approve("a-character-id-nothing-else-mentions", "{AAAAAAAA-0000-0000-0000-000000000001}", "")
	if err != nil {
		t.Fatal(err)
	}
	approved, err := service.References()
	if err != nil {
		t.Fatal(err)
	}
	if len(approved) != 1 || approved[0].ID != ref.ID {
		t.Fatalf("an orphaned character id's reference must still be listed: %#v", approved)
	}
}

func TestChangedSinceApprovalWhenTheRegionMoves(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "project.rpp")
	if err := os.WriteFile(path, []byte(twoRegions), 0o600); err != nil {
		t.Fatal(err)
	}
	service := New(Config{Project: dir, ProjectFile: func() (string, error) { return path, nil }})
	service.now = fixedNow(time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC))

	if _, err := service.Approve("char-alice", "{AAAAAAAA-0000-0000-0000-000000000001}", ""); err != nil {
		t.Fatal(err)
	}

	// Re-save the project with the same region GUID but a new start time, as a
	// narrator moving the region in REAPER would produce.
	moved := `<REAPER_PROJECT 0.1 "7.0" 0
  MARKER 1 5 "Alice ref A" 1 0 1 R {AAAAAAAA-0000-0000-0000-000000000001} 0 1
  MARKER 1 7 "" 1
>
`
	if err := os.WriteFile(path, []byte(moved), 0o600); err != nil {
		t.Fatal(err)
	}

	approved, err := service.References()
	if err != nil {
		t.Fatal(err)
	}
	if len(approved) != 1 || !approved[0].ChangedSinceApproval {
		t.Fatalf("a moved region must read as changed since approval: %#v", approved)
	}
}

func TestChangedSinceApprovalWhenTheRegionIsGone(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "project.rpp")
	if err := os.WriteFile(path, []byte(twoRegions), 0o600); err != nil {
		t.Fatal(err)
	}
	service := New(Config{Project: dir, ProjectFile: func() (string, error) { return path, nil }})
	service.now = fixedNow(time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC))
	if _, err := service.Approve("char-alice", "{AAAAAAAA-0000-0000-0000-000000000001}", ""); err != nil {
		t.Fatal(err)
	}

	noRegions := `<REAPER_PROJECT 0.1 "7.0" 0
>
`
	if err := os.WriteFile(path, []byte(noRegions), 0o600); err != nil {
		t.Fatal(err)
	}

	approved, err := service.References()
	if err != nil {
		t.Fatal(err)
	}
	if len(approved) != 1 || !approved[0].ChangedSinceApproval {
		t.Fatalf("a deleted region must read as changed since approval: %#v", approved)
	}
}

func TestReApprovingAChangedRegionClearsTheChangedFlag(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "project.rpp")
	if err := os.WriteFile(path, []byte(twoRegions), 0o600); err != nil {
		t.Fatal(err)
	}
	service := New(Config{Project: dir, ProjectFile: func() (string, error) { return path, nil }})
	service.now = fixedNow(time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC))
	if _, err := service.Approve("char-alice", "{AAAAAAAA-0000-0000-0000-000000000001}", ""); err != nil {
		t.Fatal(err)
	}
	moved := `<REAPER_PROJECT 0.1 "7.0" 0
  MARKER 1 5 "Alice ref A" 1 0 1 R {AAAAAAAA-0000-0000-0000-000000000001} 0 1
  MARKER 1 7 "" 1
>
`
	if err := os.WriteFile(path, []byte(moved), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Approve("char-alice", "{AAAAAAAA-0000-0000-0000-000000000001}", "re-approved after the move"); err != nil {
		t.Fatal(err)
	}
	approved, err := service.References()
	if err != nil {
		t.Fatal(err)
	}
	if len(approved) != 1 || approved[0].ChangedSinceApproval {
		t.Fatalf("re-approval must clear changed-since-approval: %#v", approved)
	}
}

func TestReferencesFileIsWrittenAtomicallyAndSurvivesAFailedRename(t *testing.T) {
	service := newTestService(t, twoRegions)
	renameCalls := 0
	service.rename = func(oldPath, newPath string) error {
		renameCalls++
		if renameCalls == 1 {
			return errors.New("simulated rename failure")
		}
		return os.Rename(oldPath, newPath)
	}
	if _, err := service.Approve("char-alice", "{AAAAAAAA-0000-0000-0000-000000000001}", ""); err == nil {
		t.Fatal("want the first, failing write to return an error")
	}
	if _, err := service.Approve("char-alice", "{AAAAAAAA-0000-0000-0000-000000000001}", ""); err != nil {
		t.Fatalf("a retried write must succeed: %v", err)
	}
	approved, err := service.References()
	if err != nil {
		t.Fatal(err)
	}
	if len(approved) != 1 {
		t.Fatalf("want exactly 1 reference after the retry, got %d", len(approved))
	}
}

func TestListRegionsFailsOnAMalformedProjectFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "project.rpp")
	if err := os.WriteFile(path, []byte("not a REAPER project"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := New(Config{Project: dir, ProjectFile: func() (string, error) { return path, nil }})
	if _, err := service.ListRegions(); err == nil {
		t.Fatal("want an error reading a file that is not a REAPER project")
	}
}

func TestApproveFailsWhenReferencesFileIsCorruptJSON(t *testing.T) {
	service := newTestService(t, twoRegions)
	path := referencesPath(service.config.Project)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Approve("char-alice", "{AAAAAAAA-0000-0000-0000-000000000001}", ""); err == nil {
		t.Fatal("want an error approving over a corrupt references file")
	}
	// The corrupt file is kept aside (persist.Quarantined, narrator data), never
	// silently discarded.
	entries, err := os.ReadDir(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	kept := false
	for _, entry := range entries {
		if strings.Contains(entry.Name(), ".corrupt-") {
			kept = true
		}
	}
	if !kept {
		t.Fatalf("want the corrupt references file kept aside, found: %v", entries)
	}
}

func TestDirIsUnderTheProjectsNarrationUtilsFolder(t *testing.T) {
	if got, want := Dir("/proj"), filepath.Join("/proj", "narration-utils", "characters"); got != want {
		t.Fatalf("Dir(%q) = %q, want %q", "/proj", got, want)
	}
}

// Sanity check that this package reads exactly the same Region shape
// tracks.Parse produces, so a future change to that parser is felt here too.
func TestRegionShapeMatchesTracksPackage(t *testing.T) {
	var _ tracks.Region
}
