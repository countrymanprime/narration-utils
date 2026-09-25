package manuscript

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/chaptersync"
	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/layout"
)

func importAlice(t *testing.T, service *Service, reset bool) string {
	t.Helper()
	job := service.Begin(layout.RepoFile(layout.FixturesDir + "/alice.md"))
	if _, err := service.Preview(job.ID, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Commit(job.ID, reset, Choices{}); err != nil {
		t.Fatal(err)
	}
	waitForJob(t, service, job.ID, "success")
	data, err := service.Load()
	if err != nil {
		t.Fatal(err)
	}
	id, _ := data["documentId"].(string)
	return id
}

// A confirmed replace clears the links (their chapter ids are gone) but carries
// them, and the auto-links the narrator undid, into the new document's mapping
// file, so chapter sync can re-link by title (daw-chapter-track-auto-sync PRD
// Phase 2).
func TestAReplacedManuscriptCarriesItsLinksForward(t *testing.T) {
	project := t.TempDir()
	service := New(project)
	first := importAlice(t, service, false)
	chapters, err := service.Chapters()
	if err != nil {
		t.Fatal(err)
	}
	title, _ := chapters[0]["title"].(string)
	id, _ := chapters[0]["id"].(string)
	store := evidence.NewMappingStore(project)
	if _, err := store.Confirm(first, "{T}", id, title); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AutoLink(first, []evidence.AutoLinkRequest{{TrackGUID: "{U}", ChapterID: "c-other", ChapterTitle: "Other"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Undo(first, "{U}"); err != nil {
		t.Fatal(err)
	}
	if err := chaptersync.NewStore(project).Write(chaptersync.Snapshot{Tracks: []chaptersync.TrackState{{GUID: "{T}"}}}); err != nil {
		t.Fatal(err)
	}

	second := importAlice(t, service, true)
	if second == first {
		t.Fatal("the re-import kept its document id")
	}
	if links, _ := store.List(second); len(links) != 0 {
		t.Fatalf("links survived the re-import: %#v", links)
	}
	previous, _ := store.Previous(second)
	if len(previous) != 1 || previous[0].TrackGUID != "{T}" || previous[0].ChapterTitle != title {
		t.Fatalf("Previous = %#v", previous)
	}
	if rejected, _ := store.Rejected(second); len(rejected) != 1 || rejected[0].TrackGUID != "{U}" {
		t.Fatalf("Rejected = %#v", rejected)
	}
	if snapshot := chaptersync.NewStore(project).Read(); len(snapshot.Tracks) != 0 {
		t.Fatalf("the sync snapshot survived the re-import: %#v", snapshot)
	}
}

func TestClearCarriesNothingForward(t *testing.T) {
	project := t.TempDir()
	service := New(project)
	first := importAlice(t, service, false)
	if _, err := evidence.NewMappingStore(project).Confirm(first, "{T}", "c-0001", "Chapter"); err != nil {
		t.Fatal(err)
	}
	if err := service.Clear(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(evidence.MappingFile(project)); !os.IsNotExist(err) {
		t.Fatalf("Clear left the mapping file: %v", err)
	}
}

func TestResetDerivedClearsTheChapterSyncSnapshot(t *testing.T) {
	project := t.TempDir()
	path := chaptersync.File(project)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`{"schemaVersion":1}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := resetDerived(project); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("resetDerived left the chapter sync snapshot behind: %v", err)
	}
}
