package dawcatalog

import (
	"errors"
	"testing"
)

var errFakeNotFound = errors.New("fake: not found")

func TestDetectReportsInstalledWhenTheDetectorFindsAPath(t *testing.T) {
	entry := Entry{ID: "reaper"}
	detector := func() (string, string, error) {
		return `C:\Program Files\REAPER (x64)\reaper.exe`, "uninstall_registry", nil
	}

	got := Detect(entry, detector)

	want := DetectionResult{
		EntryID:   "reaper",
		Installed: true,
		Path:      `C:\Program Files\REAPER (x64)\reaper.exe`,
		Source:    "uninstall_registry",
	}
	if got != want {
		t.Errorf("Detect() = %+v, want %+v", got, want)
	}
}

// TestDetectReportsNotInstalledOnError covers the PRD's documented soft
// false negative (Technical Risks: "Portable/non-installer REAPER installs
// are invisible to registry detection ... accept 'not detected' as a soft
// false negative"): any detector error, not just a specific sentinel, must
// resolve to Installed: false rather than the caller propagating an error a
// narrator would see as a crash.
func TestDetectReportsNotInstalledOnError(t *testing.T) {
	entry := Entry{ID: "reaper"}
	detector := func() (string, string, error) {
		return "", "", errFakeNotFound
	}

	got := Detect(entry, detector)

	if got.Installed {
		t.Errorf("Detect() = %+v, want Installed = false", got)
	}
	if got.Path != "" || got.Source != "" {
		t.Errorf("Detect() = %+v, want empty Path and Source on error", got)
	}
	if got.EntryID != "reaper" {
		t.Errorf("Detect() EntryID = %q, want %q", got.EntryID, "reaper")
	}
}

func TestDetectReportsNotInstalledWhenPathIsEmptyButErrIsNil(t *testing.T) {
	// A misbehaving detector that returns ok=nil with an empty path must
	// not be reported as installed; Detect treats that the same as an
	// error rather than trusting a zero-value path.
	entry := Entry{ID: "reaper"}
	detector := func() (string, string, error) { return "", "", nil }

	got := Detect(entry, detector)

	if got.Installed {
		t.Errorf("Detect() = %+v, want Installed = false for an empty path", got)
	}
}

func TestDetectReportsNotInstalledWhenDetectorIsNil(t *testing.T) {
	// A future catalog entry with no working probe yet must not panic or
	// falsely claim certainty (PRD: "a fact ... not a launchable path").
	entry := Entry{ID: "audacity"}

	got := Detect(entry, nil)

	if got.Installed {
		t.Errorf("Detect() = %+v, want Installed = false when detector is nil", got)
	}
	if got.EntryID != "audacity" {
		t.Errorf("Detect() EntryID = %q, want %q", got.EntryID, "audacity")
	}
}

func TestDetectAllRunsTheMatchingDetectorPerEntryByID(t *testing.T) {
	entries := []Entry{{ID: "reaper"}, {ID: "audacity"}}
	detectors := map[string]Detector{
		"reaper": func() (string, string, error) {
			return `C:\Program Files\REAPER\reaper.exe`, "uninstall_registry", nil
		},
		// audacity has no detector yet: DetectAll must not panic and
		// must report it as not installed rather than skipping it.
	}

	got := DetectAll(entries, detectors)

	if len(got) != 2 {
		t.Fatalf("DetectAll() returned %d results, want 2", len(got))
	}
	if !got[0].Installed || got[0].EntryID != "reaper" {
		t.Errorf("got[0] = %+v, want reaper installed", got[0])
	}
	if got[1].Installed || got[1].EntryID != "audacity" {
		t.Errorf("got[1] = %+v, want audacity not installed", got[1])
	}
}

func TestDetectAllPreservesEntryOrder(t *testing.T) {
	entries := []Entry{{ID: "a"}, {ID: "b"}, {ID: "c"}}

	got := DetectAll(entries, nil)

	for i, entry := range entries {
		if got[i].EntryID != entry.ID {
			t.Errorf("got[%d].EntryID = %q, want %q", i, got[i].EntryID, entry.ID)
		}
	}
}
