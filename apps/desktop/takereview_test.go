package main

import (
	"context"
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
	raw       string
	err       error
	calls     int
	manifests []string
	requests  []takereview.SidecarRequest
	// progress, when set, is written to the request's progress file before answering, as the sidecar does.
	progress string
	// release, when set, holds the answer until it is closed or the scan is cancelled (then the answer is ctx.Err()).
	release chan struct{}
	started chan struct{}
	// cancelFileSeen is whether the sidecar's cancel file was there when the scan was cancelled.
	cancelFileSeen bool
}

func (f *fakeTakeReviewRunner) FindRepeats(ctx context.Context, req takereview.SidecarRequest) (string, error) {
	f.calls++
	f.requests = append(f.requests, req)
	if manifest, err := os.ReadFile(req.ManifestPath); err == nil {
		f.manifests = append(f.manifests, string(manifest))
	}
	if f.progress != "" && req.ProgressPath != "" {
		_ = os.WriteFile(req.ProgressPath, []byte(f.progress+"\n"), 0o644)
	}
	if f.started != nil {
		close(f.started)
	}
	if f.release != nil {
		select {
		case <-f.release:
		case <-ctx.Done():
			_, err := os.Stat(req.ProgressPath + ".cancel")
			f.cancelFileSeen = err == nil
			return "", ctx.Err()
		}
	}
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
