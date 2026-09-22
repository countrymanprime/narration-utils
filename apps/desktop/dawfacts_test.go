package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/daw"
	"github.com/countrymanprime/narration-utils/shell/internal/project"
)

func TestDawLinkFactsWithNoProjectFolderIsAllFalse(t *testing.T) {
	linked, reachable, matches := dawLinkFacts(nil, "", "REAPER", nil)
	if linked || reachable || matches {
		t.Fatalf("facts = (%v, %v, %v), want all false with no project folder", linked, reachable, matches)
	}
}

func TestDawLinkFactsWithNoManifestIsAllFalse(t *testing.T) {
	folder := t.TempDir()
	linked, reachable, matches := dawLinkFacts(nil, folder, "", nil)
	if linked || reachable || matches {
		t.Fatalf("facts = (%v, %v, %v), want all false with no manifest yet", linked, reachable, matches)
	}
}

// TestDawLinkFactsTreatsALiveReaperLaunchAsLinkedUntilPhase5sMatchingIsWiredThroughThePicker
// is PRD project-workspace-and-daw-link.prd.md Open Question W18: the
// launcher knows the exact rpp but Phase 4's gate would otherwise lock
// Proofing for a REAPER session that has no manifest link yet.
func TestDawLinkFactsTreatsALiveReaperLaunchAsLinkedUntilPhase5sMatchingIsWiredThroughThePicker(t *testing.T) {
	folder := t.TempDir()
	linked, reachable, matches := dawLinkFacts(nil, folder, "REAPER", nil)
	if !linked {
		t.Fatal("linked = false, want true: a live --daw REAPER launch is linked (W18) even with no manifest link yet")
	}
	if reachable || matches {
		t.Fatalf("facts = (linked %v, reachable %v, matches %v), want reachable and matches false until Phase 6", linked, reachable, matches)
	}
}

// TestDawLinkFactsWithNoDawAndNoManifestIsNotLinked is the Standalone
// counterpart of the W18 test above: no live REAPER launch and no manifest
// link means nothing is linked.
func TestDawLinkFactsWithNoDawAndNoManifestIsNotLinked(t *testing.T) {
	folder := t.TempDir()
	linked, _, _ := dawLinkFacts(nil, folder, "Standalone", nil)
	if linked {
		t.Fatal("linked = true, want false: Standalone with no manifest link has nothing linked")
	}
}

func TestDawLinkFactsWithAResolvingManifestLinkIsLinkedButNotReachableOrMatchedWithNoReachability(t *testing.T) {
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

	linked, reachable, matches := dawLinkFacts(nil, folder, "", nil)
	if !linked {
		t.Fatal("linked = false, want true: the manifest's link resolves to a file that exists")
	}
	// reachable/matches need a live daw.Reachability (nil here, as when no bridge client exists yet).
	if reachable || matches {
		t.Fatalf("facts = (linked %v, reachable %v, matches %v), want reachable and matches false with no reachability tracker", linked, reachable, matches)
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

	linked, _, _ := dawLinkFacts(nil, folder, "", nil)
	if linked {
		t.Fatal("linked = true, want false: the linked .rpp no longer exists on disk")
	}
}

// TestDawLinkFactsIsReachableAndMatchesWhenTheHeartbeatAgreesWithTheLinkedFile is Phase 7 (ADR 0092, W10): a fresh
// PROJECT_STATUS heartbeat naming the same file the manifest links makes both reachable and matches true.
func TestDawLinkFactsIsReachableAndMatchesWhenTheHeartbeatAgreesWithTheLinkedFile(t *testing.T) {
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

	reach := daw.NewReachability(nil)
	absRpp, err := filepath.Abs(rpp)
	if err != nil {
		t.Fatal(err)
	}
	reach.Record(bridge.Event{Fields: []string{"PROJECT_STATUS", "", absRpp, "0"}})

	linked, reachable, matches := dawLinkFacts(nil, folder, "", reach)
	if !linked || !reachable || !matches {
		t.Fatalf("facts = (linked %v, reachable %v, matches %v), want all true", linked, reachable, matches)
	}
}

// TestDawLinkFactsIsReachableButNotMatchedWhenTheHeartbeatNamesADifferentFile covers a real REAPER session open on
// the wrong project (the PRD's "Mismatch detection" success metric).
func TestDawLinkFactsIsReachableButNotMatchedWhenTheHeartbeatNamesADifferentFile(t *testing.T) {
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

	reach := daw.NewReachability(nil)
	reach.Record(bridge.Event{Fields: []string{"PROJECT_STATUS", "", filepath.Join(folder, "Other.rpp"), "0"}})

	linked, reachable, matches := dawLinkFacts(nil, folder, "", reach)
	if !linked || !reachable {
		t.Fatalf("facts = (linked %v, reachable %v), want both true: REAPER is live", linked, reachable)
	}
	if matches {
		t.Fatal("matches = true, want false: the open project is not the linked file")
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
