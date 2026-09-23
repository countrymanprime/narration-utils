package main

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/project"
)

func TestLinkDawFileWithAFileInsideTheProjectFolderLinksIt(t *testing.T) {
	folder := t.TempDir()
	rpp := filepath.Join(folder, "Book.rpp")
	writeFile(t, rpp, "x")

	result, err := linkDawFile(nil, folder, rpp)
	if err != nil {
		t.Fatal(err)
	}
	if result["selected"] != true || result["linked"] != true {
		t.Fatalf("result = %#v, want selected and linked true", result)
	}
	if result["folderMismatch"] != nil {
		t.Fatalf("result = %#v, want no folderMismatch key when it linked", result)
	}

	manifest, ok, err := project.Load(nil, folder)
	if err != nil || !ok {
		t.Fatalf("manifest not saved: ok=%v err=%v", ok, err)
	}
	if manifest.DawProjectFile == nil {
		t.Fatal("manifest.DawProjectFile is nil, want the linked file")
	}
	resolved, ok := manifest.DawProjectFile.Resolve(folder)
	if !ok || resolved != rpp {
		t.Fatalf("resolved = %q, ok=%v, want %q", resolved, ok, rpp)
	}
}

func TestLinkDawFileWithAFileOutsideTheProjectFolderRefusesWithoutLinking(t *testing.T) {
	folder := t.TempDir()
	other := t.TempDir()
	rpp := filepath.Join(other, "Elsewhere.rpp")
	writeFile(t, rpp, "x")

	result, err := linkDawFile(nil, folder, rpp)
	if err != nil {
		t.Fatal(err)
	}
	if result["selected"] != true || result["linked"] != false || result["folderMismatch"] != true {
		t.Fatalf("result = %#v, want selected true, linked false, folderMismatch true", result)
	}
	if _, ok, _ := project.Load(nil, folder); ok {
		t.Fatal("a manifest was written even though the folders did not match")
	}
}

func TestLinkDawFilePreservesTheExistingProjectNameWhenAManifestAlreadyExists(t *testing.T) {
	folder := t.TempDir()
	rpp := filepath.Join(folder, "Book.rpp")
	writeFile(t, rpp, "x")
	if err := project.New("My Project", time.Now()).Save(folder); err != nil {
		t.Fatal(err)
	}

	if _, err := linkDawFile(nil, folder, rpp); err != nil {
		t.Fatal(err)
	}

	manifest, ok, err := project.Load(nil, folder)
	if err != nil || !ok {
		t.Fatalf("manifest not found: ok=%v err=%v", ok, err)
	}
	if manifest.Name != "My Project" {
		t.Fatalf("manifest.Name = %q, want the existing name preserved", manifest.Name)
	}
}

func TestLinkDawFileCreatesAManifestWhenNoneExistsYet(t *testing.T) {
	folder := t.TempDir()
	rpp := filepath.Join(folder, "Book.rpp")
	writeFile(t, rpp, "x")

	if _, err := linkDawFile(nil, folder, rpp); err != nil {
		t.Fatal(err)
	}
	manifest, ok, err := project.Load(nil, folder)
	if err != nil || !ok {
		t.Fatalf("manifest not created: ok=%v err=%v", ok, err)
	}
	if manifest.Name != filepath.Base(folder) {
		t.Fatalf("manifest.Name = %q, want the folder's base name", manifest.Name)
	}
}

func TestLinkDawFileRelinkingReplacesThePreviousLink(t *testing.T) {
	folder := t.TempDir()
	first := filepath.Join(folder, "First.rpp")
	second := filepath.Join(folder, "Second.rpp")
	writeFile(t, first, "x")
	writeFile(t, second, "x")

	if _, err := linkDawFile(nil, folder, first); err != nil {
		t.Fatal(err)
	}
	if _, err := linkDawFile(nil, folder, second); err != nil {
		t.Fatal(err)
	}

	manifest, ok, err := project.Load(nil, folder)
	if err != nil || !ok {
		t.Fatal("manifest not found")
	}
	resolved, ok := manifest.DawProjectFile.Resolve(folder)
	if !ok || resolved != second {
		t.Fatalf("resolved = %q, want %q (the relinked file)", resolved, second)
	}
}

func TestProjectLinkDawFileRefusesWithNoHostContext(t *testing.T) {
	host := NewHost()
	host.config.projectFolder = t.TempDir()
	if _, err := host.ProjectLinkDawFile(); err == nil {
		t.Fatal("want an error when the desktop host has no window context yet")
	}
}
