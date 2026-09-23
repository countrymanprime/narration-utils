package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/process"
	"github.com/countrymanprime/narration-utils/shell/internal/teleprompter"
)

// fakeLocateArgsEnv names a file the fake sidecar writes its `--locate` arguments to, one per line.
const fakeLocateArgsEnv = "SHELL_FAKE_TELEPROMPTER_LOCATE_ARGS"

// runFakeTeleprompterLocate stands in for the sidecar's `--locate` mode (locate.py): it records its arguments and
// prints one `locate` line, the shape the Python contract test pins (teleprompter-locate.json).
func runFakeTeleprompterLocate() bool {
	if len(os.Args) < 2 || os.Args[1] != "--locate" {
		return false
	}
	if path := os.Getenv(fakeLocateArgsEnv); path != "" {
		_ = os.WriteFile(path, []byte(strings.Join(os.Args[1:], "\n")), 0o600)
	}
	fmt.Println(`{"type":"locate","word":52,"last":51,"sentence":{"start":23,"end":59,"text":"Once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, and what is the use of a book, thought Alice, without pictures or conversations?"},"confidence":0.812,"confident":true,"matched":30,"heard":32,"runnerUp":4,"tokens":2196,"heardText":"do once or twice she had peeped into the book her sister was reading but it had no pictures or conversations in it and what is the use of a"}`)
	return true
}

type locateHost struct {
	host     *Host
	chapters []string
	argsFile string
}

// newTestHostForLocate is the chapter-match host (Alice's three chapters, a .rpp with a Chapter I track whose last
// item plays source seconds 2 to 9.5, two tracks named Chapter II, none for Chapter III) with a teleprompter service
// whose sidecar is this test binary, and a Whisper catalog whose model is installed only when install is set.
func newTestHostForLocate(t *testing.T, install bool) locateHost {
	t.Helper()
	host, ids := newTestHostForChapterMatch(t)
	body := []byte("model-bytes")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(body) }))
	t.Cleanup(server.Close)
	host.assets = newTestHostForTranscriptStart(t, body, server).assets
	if install {
		if err := host.registry().whisper.Install(context.Background(), "tiny"); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv(fakeTeleprompterEnv, "1")
	argsFile := filepath.Join(t.TempDir(), "locate-args.txt")
	t.Setenv(fakeLocateArgsEnv, argsFile)
	supervisor := process.NewSupervisor()
	t.Cleanup(func() { _ = supervisor.Close() })
	host.teleprompter = teleprompter.New(teleprompter.Config{Project: host.config.projectFolder, SessionDir: t.TempDir(), Python: os.Args[0]}, supervisor, nil, nil)
	return locateHost{host: host, chapters: ids, argsFile: argsFile}
}

func (f locateHost) locate(t *testing.T, chapterID, trackGUID string) map[string]any {
	t.Helper()
	raw, err := f.host.TeleprompterLocate(chapterID, trackGUID, "")
	if err != nil {
		t.Fatal(err)
	}
	return decodeBinding(t, raw)
}

func (f locateHost) sidecarArgs(t *testing.T) []string {
	t.Helper()
	bytes, err := os.ReadFile(f.argsFile)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		t.Fatal(err)
	}
	return strings.Split(string(bytes), "\n")
}

func TestTeleprompterLocateReadsTheLast30SecondsOfTheMatchedTracksLastItem(t *testing.T) {
	f := newTestHostForLocate(t, true)

	result := f.locate(t, f.chapters[0], "")

	if result["status"] != "found" {
		t.Fatalf("result = %v", result)
	}
	located, _ := result["located"].(map[string]any)
	if located["word"] != float64(52) {
		t.Fatalf("located = %v", located)
	}
	// The last item plays source seconds 2 (SOFFS) to 9.5 (2 + 5 x 1.5): shorter than 30 s, so the tail starts at the
	// item's own start, never in audio trimmed off it.
	tail, _ := result["tail"].(map[string]any)
	if tail["from"] != float64(2) || tail["to"] != 9.5 {
		t.Fatalf("tail = %v, want 2 to 9.5", tail)
	}
	args := strings.Join(f.sidecarArgs(t), " ")
	modelDir, err := f.host.registry().whisper.Dir("tiny")
	if err != nil {
		t.Fatal(err)
	}
	audio := filepath.Join(f.host.config.projectFolder, "media", "ch1.wav")
	for _, want := range []string{
		"--locate --engine whisper --model tiny --model-dir " + modelDir,
		"--chapter " + f.chapters[0],
		"--wav " + audio + " --tail-start 2.000 --tail-end 9.500",
	} {
		if !strings.Contains(args, want) {
			t.Fatalf("sidecar args %q lack %q", args, want)
		}
	}
	track, _ := result["track"].(map[string]any)
	if track["name"] != "Chapter I" {
		t.Fatalf("track = %v", track)
	}
}

func TestTeleprompterLocateAsksForTheModelOnlyOnceThereIsAudioToRead(t *testing.T) {
	f := newTestHostForLocate(t, false)

	result := f.locate(t, f.chapters[0], "")

	model, _ := result["model"].(map[string]any)
	if result["status"] != "asset_required" || model["id"] != "tiny" {
		t.Fatalf("result = %v", result)
	}
	if args := f.sidecarArgs(t); args != nil {
		t.Fatalf("the sidecar ran without a model: %v", args)
	}

	// Chapter III has no track: that is said first, without asking for a model.
	if none := f.locate(t, f.chapters[2], ""); none["status"] != "no_track" {
		t.Fatalf("result = %v", none)
	}
}

func TestTeleprompterLocateNeverGuessesBetweenTracks(t *testing.T) {
	f := newTestHostForLocate(t, true)

	result := f.locate(t, f.chapters[1], "")

	match, _ := result["match"].(map[string]any)
	if result["status"] != "no_track" || match["status"] != "ambiguous" || result["track"] != nil || result["located"] != nil {
		t.Fatalf("result = %v", result)
	}
	if args := f.sidecarArgs(t); args != nil {
		t.Fatalf("the sidecar ran for an ambiguous chapter: %v", args)
	}
}

func TestTeleprompterLocateReadsTheTrackTheNarratorPicked(t *testing.T) {
	f := newTestHostForLocate(t, true)

	// One of the two Chapter II tracks: it holds nothing yet.
	empty := f.locate(t, f.chapters[1], "{33333333-3333-4333-8333-333333333333}")
	if empty["status"] != "no_recording" || empty["recordedEnd"] != nil {
		t.Fatalf("result = %v", empty)
	}
	track, _ := empty["track"].(map[string]any)
	if track["guid"] != "{33333333-3333-4333-8333-333333333333}" {
		t.Fatalf("track = %v", track)
	}

	// Chapter III has no candidate; the narrator points it at the Chapter I track, which is read.
	picked := f.locate(t, f.chapters[2], "{11111111-1111-4111-8111-111111111111}")
	if picked["status"] != "found" {
		t.Fatalf("result = %v", picked)
	}
	if !strings.Contains(strings.Join(f.sidecarArgs(t), " "), "--chapter "+f.chapters[2]) {
		t.Fatalf("args = %v", f.sidecarArgs(t))
	}
}

func TestTeleprompterLocateRefusesATrackOutsideTheProject(t *testing.T) {
	f := newTestHostForLocate(t, true)

	if _, err := f.host.TeleprompterLocate(f.chapters[0], "{99999999-9999-4999-8999-999999999999}", ""); err == nil || !strings.Contains(err.Error(), "not in the selected REAPER project") {
		t.Fatalf("err = %v", err)
	}
}

func TestTeleprompterLocateReportsAMissingSourceFileWithoutRunningTheSidecar(t *testing.T) {
	f := newTestHostForLocate(t, true)
	if err := os.Remove(filepath.Join(f.host.config.projectFolder, "media", "ch1.wav")); err != nil {
		t.Fatal(err)
	}

	result := f.locate(t, f.chapters[0], "")

	if result["status"] != "source_missing" || result["recordedEnd"] == nil || result["located"] != nil {
		t.Fatalf("result = %v", result)
	}
	if args := f.sidecarArgs(t); args != nil {
		t.Fatalf("the sidecar ran on a missing file: %v", args)
	}
}

func TestTeleprompterLocateReportsASourceItCannotRead(t *testing.T) {
	f := newTestHostForLocate(t, true)
	rpp := filepath.Join(f.host.config.projectFolder, "Alice.rpp")
	bytes, err := os.ReadFile(rpp)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(rpp, []byte(strings.ReplaceAll(string(bytes), "<SOURCE WAVE", "<SOURCE MIDI")), 0o600); err != nil {
		t.Fatal(err)
	}

	if result := f.locate(t, f.chapters[0], ""); result["status"] != "source_unsupported" {
		t.Fatalf("result = %v", result)
	}
}

func TestTeleprompterLocateRefusesAChapterOutsideTheManuscript(t *testing.T) {
	f := newTestHostForLocate(t, true)

	if _, err := f.host.TeleprompterLocate("not-a-chapter", "", ""); err == nil {
		t.Fatal("expected an error")
	}
}

func TestTeleprompterLocateReportsAnUnavailableService(t *testing.T) {
	if _, err := (&Host{}).TeleprompterLocate("c1", "", ""); err == nil || !strings.Contains(err.Error(), "unavailable") {
		t.Fatalf("err = %v", err)
	}
}

func TestLocatedStatusFollowsTheSidecarsConfidence(t *testing.T) {
	word := 3
	for want, located := range map[string]teleprompter.Located{
		"found":          {Word: &word, Last: &word, Confident: true},
		"low_confidence": {Word: &word, Last: &word},
		"not_found":      {},
	} {
		if got := locatedStatus(located); got != want {
			t.Fatalf("locatedStatus(%+v) = %q, want %q", located, got, want)
		}
	}
}

// TeleprompterLocate's payloads (teleprompter-manuscript-integration PRD Phase 9, ADR 0111): a found resume word, a
// chapter with no confident track, a picked track with nothing recorded, and a missing source. The project folder
// and the model's install path are made portable; the .rpp's save time is stabilized by contractfile.
func TestContractTeleprompterLocate(t *testing.T) {
	f := newTestHostForLocate(t, true)
	folder := f.host.config.projectFolder
	cases := []struct{ name, chapter, track string }{
		{"teleprompter-locate-found", f.chapters[0], ""},
		{"teleprompter-locate-no-track", f.chapters[1], ""},
		{"teleprompter-locate-no-recording", f.chapters[1], "{33333333-3333-4333-8333-333333333333}"},
	}
	for _, c := range cases {
		raw, err := f.host.TeleprompterLocate(c.chapter, c.track, "")
		if err != nil {
			t.Fatal(err)
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(raw), &payload); err != nil {
			t.Fatal(err)
		}
		stable, err := contractfile.PortablePaths(payload, folder, "C:/Projects/Alice")
		if err != nil {
			t.Fatal(err)
		}
		contractfile.Check(t, c.name, stable)
	}
	if err := os.Remove(filepath.Join(folder, "media", "ch1.wav")); err != nil {
		t.Fatal(err)
	}
	raw, err := f.host.TeleprompterLocate(f.chapters[0], "", "")
	if err != nil {
		t.Fatal(err)
	}
	var missing map[string]any
	if err := json.Unmarshal([]byte(raw), &missing); err != nil {
		t.Fatal(err)
	}
	stable, err := contractfile.PortablePaths(missing, folder, "C:/Projects/Alice")
	if err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "teleprompter-locate-source-missing", stable)
}
