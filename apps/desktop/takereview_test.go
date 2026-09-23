package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
	"github.com/countrymanprime/narration-utils/shell/internal/takereview"
)

// fakeTakeReviewRunner is a takereview.SidecarRunner test double: it never
// shells out to the Transcript Compare sidecar, so these tests stay fast
// and hermetic (the scanner's own fake-runner coverage lives in
// internal/takereview/scan_test.go; this file only exercises the Host
// binding's wiring: config, the findings store, and the JSON the frontend
// receives).
type fakeTakeReviewRunner struct {
	raw   string
	err   error
	calls int
}

func (f *fakeTakeReviewRunner) FindRepeats(context.Context, takereview.SidecarRequest) (string, error) {
	f.calls++
	return f.raw, f.err
}

// twoItemRppFixture returns a project with one track and two items, each
// with its own IGUID (REAPER 7's item identity, apps/desktop/internal/tracks/parse.go),
// so takereview.buildManifest has the minimum two segments a scan needs.
func twoItemRppFixture(trackName, fileA, fileB string) string {
	return "<REAPER_PROJECT 0.1 \"7.80/win64\" 1\n" +
		"  <TRACK {AAAAAAAA-0000-0000-0000-000000000001}\n" +
		"    NAME \"" + trackName + "\"\n" +
		"    TRACKID {AAAAAAAA-0000-0000-0000-000000000001}\n" +
		"    <ITEM\n" +
		"      POSITION 0\n" +
		"      LENGTH 1\n" +
		"      IGUID {AAAAAAAA-0000-0000-0000-000000000010}\n" +
		"      <SOURCE WAVE\n" +
		"        FILE \"" + fileA + "\"\n" +
		"      >\n" +
		"    >\n" +
		"    <ITEM\n" +
		"      POSITION 2\n" +
		"      LENGTH 1\n" +
		"      IGUID {AAAAAAAA-0000-0000-0000-000000000011}\n" +
		"      <SOURCE WAVE\n" +
		"        FILE \"" + fileB + "\"\n" +
		"      >\n" +
		"    >\n" +
		"  >\n" +
		">\n"
}

func newTestHostForTakeReview(t *testing.T, folder string) *Host {
	t.Helper()
	host := &Host{settings: settings.New(t.TempDir(), folder), findings: findings.NewStore(folder)}
	host.config.projectFolder = folder
	return host
}

func TestTakeReviewScanRequiresAChapterTrackName(t *testing.T) {
	host := newTestHostForTakeReview(t, t.TempDir())
	if _, err := host.takeReviewScan(""); err == nil || !strings.Contains(err.Error(), "choose a track") {
		t.Fatalf("err = %v, want a message about choosing a track", err)
	}
}

func TestTakeReviewScanRequiresAnOpenProject(t *testing.T) {
	host := &Host{} // no settings, no findings store: no project attached
	if _, err := host.takeReviewScan("Chapter 1"); err == nil || !strings.Contains(err.Error(), "no project is open") {
		t.Fatalf("err = %v, want a message about no project being open", err)
	}
}

func TestTakeReviewScanWithTooFewSegmentsSavesEmptyFindingsWithoutRunningTheSidecar(t *testing.T) {
	folder := t.TempDir()
	writeFile(t, filepath.Join(folder, "Book.rpp"), rppFixture("media/take1.wav")) // one item only
	host := newTestHostForTakeReview(t, folder)
	runner := &fakeTakeReviewRunner{}
	host.takeReviewRunner = runner

	result, err := host.takeReviewScan("Chapter 1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result) != 0 {
		t.Fatalf("result = %v, want no findings from a single-item scope", result)
	}
	if runner.calls != 0 {
		t.Fatalf("the sidecar ran %d times, want 0 (fewer than two segments in scope)", runner.calls)
	}
}

func TestTakeReviewScanSavesFindingsAndTakeReviewFindingsReadsThemBack(t *testing.T) {
	folder := t.TempDir()
	writeFile(t, filepath.Join(folder, "Book.rpp"), twoItemRppFixture("Chapter 1", "media/a.wav", "media/b.wav"))
	if err := os.MkdirAll(filepath.Join(folder, "media"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(folder, "media", "a.wav"), "RIFF-a")
	writeFile(t, filepath.Join(folder, "media", "b.wav"), "RIFF-b")
	host := newTestHostForTakeReview(t, folder)
	runner := &fakeTakeReviewRunner{raw: "" +
		"SPAN_GROUP|0|0|5|2\n" +
		"SPAN_MEMBER|0|0|{AAAAAAAA-0000-0000-0000-000000000010}|{}|" + filepath.Join(folder, "media", "a.wav") + "|0.000|1.000|0|5|1.000|0.500|\n" +
		"SPAN_MEMBER|0|1|{AAAAAAAA-0000-0000-0000-000000000011}|{}|" + filepath.Join(folder, "media", "b.wav") + "|0.000|1.000|0|5|1.000|0.520|\n",
	}
	host.takeReviewRunner = runner

	result, err := host.takeReviewScan("Chapter 1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result) != 1 {
		t.Fatalf("result = %v, want exactly one grouped finding", result)
	}
	if runner.calls != 1 {
		t.Fatalf("the sidecar ran %d times, want 1", runner.calls)
	}
	if result[0].Category != findings.CategoryPickup {
		t.Fatalf("category = %q, want %q (partial-quality restart, per Q11)", result[0].Category, findings.CategoryPickup)
	}

	readBack, err := host.takeReviewFindings("Chapter 1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(readBack) != 1 || readBack[0].ID != result[0].ID {
		t.Fatalf("readBack = %v, want the same finding the scan just saved", readBack)
	}

	// A different chapter's scope sees nothing.
	other, err := host.takeReviewFindings("Some Other Track")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(other) != 0 {
		t.Fatalf("other = %v, want no findings for an unrelated chapter", other)
	}
}

func TestHostTakeReviewBindingsEncodeAJSONArray(t *testing.T) {
	folder := t.TempDir()
	writeFile(t, filepath.Join(folder, "Book.rpp"), twoItemRppFixture("Chapter 1", "media/a.wav", "media/b.wav"))
	if err := os.MkdirAll(filepath.Join(folder, "media"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(folder, "media", "a.wav"), "RIFF-a")
	writeFile(t, filepath.Join(folder, "media", "b.wav"), "RIFF-b")
	host := newTestHostForTakeReview(t, folder)
	host.takeReviewRunner = &fakeTakeReviewRunner{raw: "" +
		"SPAN_GROUP|0|0|5|2\n" +
		"SPAN_MEMBER|0|0|{AAAAAAAA-0000-0000-0000-000000000010}|{}|" + filepath.Join(folder, "media", "a.wav") + "|0.000|1.000|0|5|1.000|0.980|\n" +
		"SPAN_MEMBER|0|1|{AAAAAAAA-0000-0000-0000-000000000011}|{}|" + filepath.Join(folder, "media", "b.wav") + "|0.000|1.000|0|5|1.000|0.990|\n",
	}

	raw, err := host.TakeReviewScan("Chapter 1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	var scanned []findings.Finding
	if err := json.Unmarshal([]byte(raw), &scanned); err != nil {
		t.Fatalf("TakeReviewScan did not encode a JSON array of findings: %v (%s)", err, raw)
	}
	if len(scanned) != 1 || scanned[0].Category != findings.CategoryDuplicateRead {
		t.Fatalf("scanned = %v, want one duplicate_read finding (full coverage, high quality)", scanned)
	}

	raw, err = host.TakeReviewFindings("Chapter 1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	var readBack []findings.Finding
	if err := json.Unmarshal([]byte(raw), &readBack); err != nil {
		t.Fatalf("TakeReviewFindings did not encode a JSON array of findings: %v (%s)", err, raw)
	}
	if len(readBack) != 1 || readBack[0].ID != scanned[0].ID {
		t.Fatalf("readBack = %v, want the same finding TakeReviewScan just saved", readBack)
	}
}

func TestTakeReviewCreateTakeRequiresAReaperBridgeConnection(t *testing.T) {
	host := newTestHostForTakeReview(t, t.TempDir()) // no h.bridge: launched without a REAPER session
	_, err := host.takeReviewCreateTake(takereview.CreateTakeRequest{TargetItemGUID: "{A}", SourceFile: "a.wav"})
	if err == nil || !strings.Contains(err.Error(), "open the project from REAPER") {
		t.Fatalf("err = %v, want a REAPER-connection message", err)
	}
}

// TestTakeReviewCreateTakeBindingRoundTripsThroughARealBridgeClient exercises the Host binding end to end against a
// real bridge.Client and its file-based command/events.log protocol (not the internal/takereview.CreateTake fake in
// createtake_test.go): it sends the command file, waits for a command to appear (standing in for REAPER's defer
// loop picking it up), and answers as narration_take_review.lua's create_take would.
func TestTakeReviewCreateTakeBindingRoundTripsThroughARealBridgeClient(t *testing.T) {
	sessionDir := t.TempDir()
	client, err := bridge.New(sessionDir)
	if err != nil {
		t.Fatal(err)
	}
	host := &Host{bridge: client}
	host.config.sessionDir = sessionDir

	req := takereview.CreateTakeRequest{
		FindingID:        "finding-1",
		TargetItemGUID:   "{AAAAAAAA-0000-4000-8000-000000000001}",
		SourceFile:       "candidate.wav",
		SourceRangeStart: 1.5,
		SourceRangeEnd:   4.5,
	}
	type outcome struct {
		result takereview.CreateTakeResult
		err    error
	}
	done := make(chan outcome, 1)
	go func() {
		result, err := host.takeReviewCreateTake(req)
		done <- outcome{result, err}
	}()

	commandsDir := filepath.Join(sessionDir, "commands")
	runID := waitForBridgeCommand(t, commandsDir)
	writeFile(t, filepath.Join(sessionDir, "events.log"),
		"TAKE_CREATED|"+runID+"|"+req.TargetItemGUID+"|{BBBBBBBB-0000-4000-8000-000000000002}\n")

	select {
	case got := <-done:
		if got.err != nil {
			t.Fatalf("unexpected error: %v", got.err)
		}
		if got.result.TargetItemGUID != req.TargetItemGUID || got.result.NewTakeGUID != "{BBBBBBBB-0000-4000-8000-000000000002}" {
			t.Fatalf("result = %+v", got.result)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("takeReviewCreateTake did not return after the REAPER response was simulated")
	}
}

// waitForBridgeCommand polls commandsDir for the one create_take command file bridge.Client.Send wrote, and
// returns its run id (the third pipe-separated field: protocol version, action, run id).
func waitForBridgeCommand(t *testing.T, commandsDir string) string {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		entries, err := os.ReadDir(commandsDir)
		if err == nil {
			for _, entry := range entries {
				if !strings.HasSuffix(entry.Name(), ".cmd") {
					continue
				}
				raw, err := os.ReadFile(filepath.Join(commandsDir, entry.Name()))
				if err != nil {
					continue
				}
				fields, err := bridge.DecodeFields(strings.TrimRight(string(raw), "\n"))
				if err == nil && len(fields) >= 3 && fields[1] == "create_take" {
					return fields[2]
				}
			}
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("no create_take command file appeared in time")
	return ""
}
