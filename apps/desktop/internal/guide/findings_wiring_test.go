package guide

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/process"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

// writeGuideFile writes a manuscript_guide.json with one entity at the given
// id/review_state/locked/pronunciation-confidence, exactly the shape a real
// Story Bible build produces.
func writeGuideFile(t *testing.T, s *Service, id, reviewState string, locked bool, confidence string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(s.guidePath()), 0o755); err != nil {
		t.Fatal(err)
	}
	document := map[string]any{
		"schema_version": schemaVersion,
		"entities":       []any{fixtureEntity(id, reviewState, locked, confidence)},
	}
	encoded, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(s.guidePath(), encoded, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestServiceNeverSavesFindingsWhenFindingsIsNotWired(t *testing.T) {
	root := t.TempDir()
	s := New(root, "", "", settings.New(root, root), process.NewSupervisor())
	writeGuideFile(t, s, "ent1", "needs review", false, "low")
	// No SetFindings call: every existing caller must see identical
	// behavior to before this feature existed.
	if err := s.SaveFindings(); err != nil {
		t.Fatalf("SaveFindings() with no store wired = %v, want nil (no-op)", err)
	}
	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(findings.Dir))); !os.IsNotExist(err) {
		t.Fatalf("findings directory exists though SetFindings was never called: %v", err)
	}
}

func TestServiceSaveFindingsResolvesUpstreamWhenEntityBecomesReviewed(t *testing.T) {
	root := t.TempDir()
	s := New(root, "", "", settings.New(root, root), process.NewSupervisor())
	store := findings.NewStore(root)
	s.SetFindings(store)

	writeGuideFile(t, s, "ent1", "needs review", false, "high")
	if err := s.SaveFindings(); err != nil {
		t.Fatalf("SaveFindings() (first run) = %v", err)
	}
	open, err := store.List(findings.Query{Analyzer: analyzerName})
	if err != nil {
		t.Fatal(err)
	}
	if len(open) != 1 {
		t.Fatalf("open findings after the entity needs review = %d, want 1: %+v", len(open), open)
	}
	if open[0].Review.Status != findings.StatusUnreviewed {
		t.Errorf("Review.Status = %q, want unreviewed", open[0].Review.Status)
	}

	// The entity becomes reviewed (its Story Bible review_state advanced,
	// e.g. by an edit or a rescan). The adapter runs again on the fresh
	// guide file; it must never mutate the guide file to reach this state
	// itself - this test only rewrites the fixture file the way the real
	// Python sidecar would.
	writeGuideFile(t, s, "ent1", "reviewed", false, "high")
	if err := s.SaveFindings(); err != nil {
		t.Fatalf("SaveFindings() (second run) = %v", err)
	}

	openAfter, err := store.List(findings.Query{Analyzer: analyzerName})
	if err != nil {
		t.Fatal(err)
	}
	if len(openAfter) != 0 {
		t.Fatalf("open findings after the entity became reviewed = %d, want 0 (resolved upstream): %+v", len(openAfter), openAfter)
	}

	// The finding is not deleted: it stays auditable, flagged as not
	// reproduced by the latest run, per findings-contract.md.
	all, err := store.List(findings.Query{Analyzer: analyzerName, IncludeNotInLatestRun: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 {
		t.Fatalf("findings including not-in-latest-run = %d, want 1 kept for audit: %+v", len(all), all)
	}
	if !all[0].NotInLatestRun {
		t.Errorf("NotInLatestRun = false, want true once the entity was reviewed")
	}
}

func TestServiceSaveFindingsResolvesUpstreamWhenEntityBecomesLocked(t *testing.T) {
	root := t.TempDir()
	s := New(root, "", "", settings.New(root, root), process.NewSupervisor())
	store := findings.NewStore(root)
	s.SetFindings(store)

	writeGuideFile(t, s, "ent1", "reviewed", false, "unknown")
	if err := s.SaveFindings(); err != nil {
		t.Fatalf("SaveFindings() (first run) = %v", err)
	}
	open, err := store.List(findings.Query{Analyzer: analyzerName})
	if err != nil {
		t.Fatal(err)
	}
	if len(open) != 1 {
		t.Fatalf("open findings for an unlocked unknown-confidence pronunciation = %d, want 1: %+v", len(open), open)
	}

	writeGuideFile(t, s, "ent1", "reviewed", true, "unknown")
	if err := s.SaveFindings(); err != nil {
		t.Fatalf("SaveFindings() (second run) = %v", err)
	}
	openAfter, err := store.List(findings.Query{Analyzer: analyzerName})
	if err != nil {
		t.Fatal(err)
	}
	if len(openAfter) != 0 {
		t.Fatalf("open findings after the entity became locked = %d, want 0 (resolved upstream): %+v", len(openAfter), openAfter)
	}
}

// TestSaveFindingsNeverInvokesTheSidecarPythonExecutable proves the adapter
// stays a pure reader (Q7's "a finding decision never mutates the Story
// Bible" applies just as much to the adapter itself): Service is configured
// with a Python path that does not exist, so any call through Run/command
// (every mutating method: Edit, EditFields, Pronounce, Rescan, Merge,
// Delete, Create, CreateFull, Relate, Unrelate) would fail with "configure
// the Manuscript Guide executable before continuing". SaveFindings succeeds
// anyway, because it only calls Entities (a direct file read) and the
// findings store.
func TestSaveFindingsNeverInvokesTheSidecarPythonExecutable(t *testing.T) {
	root := t.TempDir()
	s := New(root, filepath.Join(root, "no-such-python-executable"), "", settings.New(root, root), process.NewSupervisor())
	store := findings.NewStore(root)
	s.SetFindings(store)
	writeGuideFile(t, s, "ent1", "needs review", false, "low")

	if err := s.SaveFindings(); err != nil {
		t.Fatalf("SaveFindings() = %v, want nil - it must never shell out to the (missing) sidecar executable", err)
	}
	open, err := store.List(findings.Query{Analyzer: analyzerName})
	if err != nil {
		t.Fatal(err)
	}
	if len(open) != 2 {
		t.Fatalf("open findings = %d, want 2 (needs-review plus low-confidence pronunciation)", len(open))
	}
}
