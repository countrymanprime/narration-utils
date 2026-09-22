package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/project"
)

func TestDawLinkFactsWithNoProjectFolderIsAllFalse(t *testing.T) {
	linked, reachable, matches := dawLinkFacts(nil, "")
	if linked || reachable || matches {
		t.Fatalf("facts = (%v, %v, %v), want all false with no project folder", linked, reachable, matches)
	}
}

func TestDawLinkFactsWithNoManifestIsAllFalse(t *testing.T) {
	folder := t.TempDir()
	linked, reachable, matches := dawLinkFacts(nil, folder)
	if linked || reachable || matches {
		t.Fatalf("facts = (%v, %v, %v), want all false with no manifest yet", linked, reachable, matches)
	}
}

func TestDawLinkFactsWithAResolvingManifestLinkIsLinkedButNotReachableOrMatched(t *testing.T) {
	folder := t.TempDir()
	rpp := filepath.Join(folder, "Book.rpp")
	if err := os.WriteFile(rpp, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	link, err := project.BuildDawLink(folder, rpp)
	if err != nil {
		t.Fatal(err)
	}
	manifest := project.New("Book", time.Now())
	manifest.DawProjectFile = &link
	if err := manifest.Save(folder); err != nil {
		t.Fatal(err)
	}

	linked, reachable, matches := dawLinkFacts(nil, folder)
	if !linked {
		t.Fatal("linked = false, want true: the manifest's link resolves to a file that exists")
	}
	// reachable/matches need a REAPER bridge liveness check that doesn't exist
	// yet (PRD Phase 6, W10); they must stay false until that lands.
	if reachable || matches {
		t.Fatalf("facts = (linked %v, reachable %v, matches %v), want reachable and matches false until Phase 6", linked, reachable, matches)
	}
}

func TestDawLinkFactsWithAManifestLinkThatNoLongerResolvesIsNotLinked(t *testing.T) {
	folder := t.TempDir()
	rpp := filepath.Join(folder, "Book.rpp")
	if err := os.WriteFile(rpp, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	link, err := project.BuildDawLink(folder, rpp)
	if err != nil {
		t.Fatal(err)
	}
	manifest := project.New("Book", time.Now())
	manifest.DawProjectFile = &link
	if err := manifest.Save(folder); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(rpp); err != nil {
		t.Fatal(err)
	}

	linked, _, _ := dawLinkFacts(nil, folder)
	if linked {
		t.Fatal("linked = true, want false: the linked .rpp no longer exists on disk")
	}
}

func TestBootstrapExposesTheThreeSeparateDawFacts(t *testing.T) {
	host := NewHost()
	folder := t.TempDir()
	rpp := filepath.Join(folder, "Book.rpp")
	if err := os.WriteFile(rpp, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	link, err := project.BuildDawLink(folder, rpp)
	if err != nil {
		t.Fatal(err)
	}
	manifest := project.New("Book", time.Now())
	manifest.DawProjectFile = &link
	if err := manifest.Save(folder); err != nil {
		t.Fatal(err)
	}
	host.config.projectFolder = folder

	boot := host.Bootstrap()
	if boot["dawFileLinked"] != true {
		t.Fatalf("dawFileLinked = %#v, want true", boot["dawFileLinked"])
	}
	if boot["dawReachable"] != false {
		t.Fatalf("dawReachable = %#v, want false (unknown until Phase 6)", boot["dawReachable"])
	}
	if boot["dawProjectMatches"] != false {
		t.Fatalf("dawProjectMatches = %#v, want false (unknown until Phase 6)", boot["dawProjectMatches"])
	}
}

func TestBootstrapWithNoProjectHasAllDawFactsFalse(t *testing.T) {
	host := NewHost()
	boot := host.Bootstrap()
	if boot["dawFileLinked"] != false || boot["dawReachable"] != false || boot["dawProjectMatches"] != false {
		t.Fatalf("boot daw facts = linked %#v reachable %#v matches %#v, want all false with no project", boot["dawFileLinked"], boot["dawReachable"], boot["dawProjectMatches"])
	}
}
