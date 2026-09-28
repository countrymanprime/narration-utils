package recording_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/recording"
	"github.com/countrymanprime/narration-utils/shell/internal/recording/recordingtest"
)

func TestComposeAndParseLineID(t *testing.T) {
	id := recording.ComposeLineID("p-000006", "abc123")
	entityID, sourceSHA256, ok := recording.ParseLineID(id)
	if !ok || entityID != "p-000006" || sourceSHA256 != "abc123" {
		t.Fatalf("ParseLineID(%q) = %q, %q, %v", id, entityID, sourceSHA256, ok)
	}
}

func TestParseLineIDRejectsWhatComposeCouldNotHaveProduced(t *testing.T) {
	for _, id := range []string{"", "no-separator", "@abc123", "p-000006@"} {
		if _, _, ok := recording.ParseLineID(id); ok {
			t.Errorf("ParseLineID(%q) reported ok, want false", id)
		}
	}
}

func TestComposeLineIDMirrorsLineidentityScheme(t *testing.T) {
	// The scheme is deliberately duplicated, not shared, between internal/recording and internal/lineidentity
	// (see identity.go's doc comment); this pins the two compositions to the same shape so a line id composed by
	// either package parses the same way in the other.
	entityID, sourceSHA256 := "c-0004", "deadbeef"
	if got, want := recording.ComposeLineID(entityID, sourceSHA256), entityID+"@"+sourceSHA256; got != want {
		t.Fatalf("ComposeLineID = %q, want %q", got, want)
	}
}

func TestSetTakeLineAssignsAndPersists(t *testing.T) {
	fake := &recordingtest.Fake{}
	r := newRecorder(t, fake)
	if err := os.MkdirAll(r.folder(), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := recordingtest.WriteWav(filepath.Join(r.folder(), "Take 001.wav"), 24000); err != nil {
		t.Fatal(err)
	}

	if err := r.service.SetTakeLine("Take 001", "p-000001", "sha-1"); err != nil {
		t.Fatalf("SetTakeLine: %v", err)
	}

	state := r.service.Snapshot()
	if len(state.Takes) != 1 {
		t.Fatalf("takes = %d, want 1", len(state.Takes))
	}
	take := state.Takes[0]
	if take.LineID == nil || *take.LineID != recording.ComposeLineID("p-000001", "sha-1") {
		t.Fatalf("LineID = %v, want %q", take.LineID, recording.ComposeLineID("p-000001", "sha-1"))
	}

	// A second recorder over the same folder reads the same assignment back: it is project-owned state, not
	// process-owned.
	other := recording.New(recording.Config{Project: r.project}, fake, nil, nil)
	otherTake := other.Snapshot().Takes[0]
	if otherTake.LineID == nil || *otherTake.LineID != *take.LineID {
		t.Fatalf("a fresh service over the same folder read LineID = %v, want %v", otherTake.LineID, take.LineID)
	}
}

func TestSetTakeLineClearsWithEmptyEntityID(t *testing.T) {
	fake := &recordingtest.Fake{}
	r := newRecorder(t, fake)
	if err := os.MkdirAll(r.folder(), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := recordingtest.WriteWav(filepath.Join(r.folder(), "Take 001.wav"), 24000); err != nil {
		t.Fatal(err)
	}
	if err := r.service.SetTakeLine("Take 001", "p-000001", "sha-1"); err != nil {
		t.Fatal(err)
	}

	if err := r.service.SetTakeLine("Take 001", "", ""); err != nil {
		t.Fatalf("clearing: %v", err)
	}
	take := r.service.Snapshot().Takes[0]
	if take.LineID != nil {
		t.Fatalf("LineID = %v, want nil after clearing", take.LineID)
	}
}

func TestSetTakeLineRefusesAnEmptyTakeName(t *testing.T) {
	r := newRecorder(t, &recordingtest.Fake{})
	if err := os.MkdirAll(r.folder(), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := r.service.SetTakeLine("", "p-000001", "sha-1"); err == nil {
		t.Fatal("want an error for an empty take name")
	}
}

func TestSetTakeLineRefusesAnEntityWithNoSourceHash(t *testing.T) {
	r := newRecorder(t, &recordingtest.Fake{})
	if err := os.MkdirAll(r.folder(), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := recordingtest.WriteWav(filepath.Join(r.folder(), "Take 001.wav"), 24000); err != nil {
		t.Fatal(err)
	}
	if err := r.service.SetTakeLine("Take 001", "p-000001", ""); err == nil {
		t.Fatal("want an error when the manuscript has no recorded source checksum")
	}
}

func TestSetTakeLineWithoutAProjectIsRefused(t *testing.T) {
	svc := recording.New(recording.Config{}, &recordingtest.Fake{}, nil, nil)
	if err := svc.SetTakeLine("Take 001", "p-000001", "sha-1"); err == nil {
		t.Fatal("want an error without a project")
	}
}

// TestTakeListingSurvivesACorruptIdentityFile pins that a malformed line-identity sidecar never blocks the take
// listing itself: the WAV files are the narrator's real data, and a corrupt sidecar is treated the same
// laissez-faire way an unreadable WAV header already is (takes.go's listTakes doc comment).
func TestTakeListingSurvivesACorruptIdentityFile(t *testing.T) {
	r := newRecorder(t, &recordingtest.Fake{})
	if err := os.MkdirAll(r.folder(), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := recordingtest.WriteWav(filepath.Join(r.folder(), "Take 001.wav"), 24000); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(r.folder(), "line-identity.json"), []byte("not json"), 0o600); err != nil {
		t.Fatal(err)
	}

	state := r.service.Snapshot()
	if len(state.Takes) != 1 {
		t.Fatalf("takes = %d, want 1 despite the corrupt sidecar", len(state.Takes))
	}
	if state.Takes[0].LineID != nil {
		t.Fatalf("LineID = %v, want nil (a corrupt sidecar yields no assignments)", state.Takes[0].LineID)
	}
}

// TestTakeSourceIsFileOnly pins the DAW-agnostic take contract (docs/architecture/findings-contract.md): a native
// take's findings.Source carries only File - never a synthetic stand-in for the REAPER-only TrackGUID/ItemGUID/
// TakeGUID fields, so REAPER-navigation code never mistakes it for a source it could navigate to in REAPER.
func TestTakeSourceIsFileOnly(t *testing.T) {
	take := recording.Take{Name: "Take 001", Path: filepath.Join(t.TempDir(), "Take 001.wav")}
	source := take.Source()
	if source.File != take.Path {
		t.Fatalf("Source.File = %q, want %q", source.File, take.Path)
	}
	if source.TrackGUID != "" || source.ItemGUID != "" || source.TakeGUID != "" {
		t.Fatalf("Source = %+v, want every GUID empty", source)
	}
}
