package character

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// fakeProjectReader proves savedProject reads through the injected dawport.ProjectReader role (DAW port PRD Phase 5d)
// instead of calling tracks.Parse itself: it ignores the bytes at the path it is given, so a real .rpp is never parsed
// once one is set.
type fakeProjectReader struct {
	project tracks.Project
	err     error
	got     string
}

func (f *fakeProjectReader) ReadProject(path string) (tracks.Project, error) {
	f.got = path
	return f.project, f.err
}

func TestSavedProjectReadsThroughTheInjectedProjectReaderRole(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "project.rpp")
	if err := os.WriteFile(path, []byte("not a real REAPER project - the fake role never looks at it"), 0o600); err != nil {
		t.Fatal(err)
	}
	fake := &fakeProjectReader{project: tracks.Project{Regions: []tracks.Region{{GUID: "region-x"}}}}
	service := New(Config{Project: dir, ProjectFile: func() (string, error) { return path, nil }, ProjectReader: fake})

	regions, err := service.ListRegions()
	if err != nil {
		t.Fatalf("ListRegions: %v", err)
	}
	if fake.got != path {
		t.Fatalf("the role was not asked to read the resolved project file, got %q, want %q", fake.got, path)
	}
	if len(regions) != 1 || regions[0].GUID != "region-x" {
		t.Fatalf("ListRegions must return the role's project, got %#v", regions)
	}
}

func TestSavedProjectSurfacesTheProjectReaderRolesError(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "project.rpp")
	if err := os.WriteFile(path, []byte("irrelevant"), 0o600); err != nil {
		t.Fatal(err)
	}
	fake := &fakeProjectReader{err: errors.New("the role refused to read")}
	service := New(Config{Project: dir, ProjectFile: func() (string, error) { return path, nil }, ProjectReader: fake})

	if _, err := service.ListRegions(); err == nil {
		t.Fatal("a role that fails to read must surface as an error")
	}
}
