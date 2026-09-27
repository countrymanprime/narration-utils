package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// fakeProjectReaderRole proves readProject asks the dawport.ProjectReader role (DAW port PRD Phase 5d) for the project
// instead of calling tracks.Parse itself: it never opens path, so a real .rpp is never required once it is installed.
type fakeProjectReaderRole struct {
	project tracks.Project
	err     error
	got     string
}

func (f *fakeProjectReaderRole) ReadProject(path string) (tracks.Project, error) {
	f.got = path
	return f.project, f.err
}

// withProjectReaderRole substitutes projectReaderRole for the test's duration and restores it after.
func withProjectReaderRole(t *testing.T, role dawport.ProjectReader) {
	t.Helper()
	previous := projectReaderRole
	projectReaderRole = func() (dawport.ProjectReader, error) { return role, nil }
	t.Cleanup(func() { projectReaderRole = previous })
}

func TestReadProjectReadsThroughTheDawPortRole(t *testing.T) {
	fake := &fakeProjectReaderRole{project: tracks.Project{Tracks: []tracks.Track{{GUID: "track-x"}}}}
	withProjectReaderRole(t, fake)

	project, err := readProject("/not/a/real/file.rpp")
	if err != nil {
		t.Fatalf("readProject: %v", err)
	}
	if fake.got != "/not/a/real/file.rpp" {
		t.Fatalf("the role was not asked to read the given path, got %q", fake.got)
	}
	if len(project.Tracks) != 1 || project.Tracks[0].GUID != "track-x" {
		t.Fatalf("readProject must return the role's project, got %#v", project)
	}
}

func TestReadProjectSurfacesTheRolesError(t *testing.T) {
	withProjectReaderRole(t, &fakeProjectReaderRole{err: errors.New("the role refused to read")})

	if _, err := readProject("/not/a/real/file.rpp"); err == nil {
		t.Fatal("a role that fails to read must surface as an error")
	}
}

// TestOfflineProjectReaderRoleNeedsNoBridge proves project_read is available from the resolver with no bridge at all
// (project_read's Needs is NeedsNothing, dawport's capability.go): reading a saved .rpp works with REAPER closed or never
// launched, the "offline reading" this phase's name refers to.
func TestOfflineProjectReaderRoleNeedsNoBridge(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "project.rpp")
	rpp := "<REAPER_PROJECT 0.1 \"7.0\" 0\n  <TRACK track-1\n    NAME \"Chapter One\"\n    TRACKID track-1\n  >\n>\n"
	if err := os.WriteFile(path, []byte(rpp), 0o600); err != nil {
		t.Fatal(err)
	}

	reader, err := dawport.Role[dawport.ProjectReader](
		dawport.NewResolver(dawport.ResolverConfig{Adapter: offlineProjectReader{}}), dawport.CapProjectRead)
	if err != nil {
		t.Fatalf("Role: %v", err)
	}
	project, err := reader.ReadProject(path)
	if err != nil {
		t.Fatalf("ReadProject: %v", err)
	}
	if len(project.Tracks) != 1 || project.Tracks[0].GUID != "track-1" {
		t.Fatalf("project = %#v", project)
	}
}
