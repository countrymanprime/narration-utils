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
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/process"
	"github.com/countrymanprime/narration-utils/shell/internal/teleprompter"
)

// fakeLocateArgsEnv names a file the fake sidecar writes its `--locate` arguments to, one per line.
const fakeLocateArgsEnv = "SHELL_FAKE_TELEPROMPTER_LOCATE_ARGS"

// fakeLocateWordEnv, when set, is the word the fake sidecar places the tail at ("end" for the chapter's token count),
// and fakeLocateUnsureEnv makes it a low-confidence placement.
const (
	fakeLocateWordEnv   = "SHELL_FAKE_TELEPROMPTER_LOCATE_WORD"
	fakeLocateUnsureEnv = "SHELL_FAKE_TELEPROMPTER_LOCATE_UNSURE"
)

// runFakeTeleprompterLocate stands in for the sidecar's `--locate` mode (locate.py): it records its arguments and
// prints one `locate` line, the shape the Python contract test pins (teleprompter-locate.json). Its token count is the
// chapter's as the host tokenises it, so the resume verdict compares like with like.
func runFakeTeleprompterLocate() bool {
	if len(os.Args) < 2 || os.Args[1] != "--locate" {
		return false
	}
	if path := os.Getenv(fakeLocateArgsEnv); path != "" {
		_ = os.WriteFile(path, []byte(strings.Join(os.Args[1:], "\n")), 0o600)
	}
	tokens := 2196
	if manuscript, chapter := fakeArg("--manuscript"), fakeArg("--chapter"); manuscript != "" {
		project := filepath.Dir(filepath.Dir(filepath.Dir(manuscript)))
		if script, ok := teleprompter.LoadChapterScript(project, chapter); ok {
			tokens = len(script.Tokens)
		}
	}
	word := 52
	switch value := os.Getenv(fakeLocateWordEnv); value {
	case "":
	case "end":
		word = tokens
	default:
		_, _ = fmt.Sscan(value, &word)
	}
	confident, confidence := true, 0.812
	if os.Getenv(fakeLocateUnsureEnv) != "" {
		confident, confidence = false, 0.31
	}
	fmt.Printf(`{"type":"locate","word":%d,"last":%d,"sentence":{"start":23,"end":59,"text":"Once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, and what is the use of a book, thought Alice, without pictures or conversations?"},"confidence":%g,"confident":%t,"matched":30,"heard":32,"runnerUp":4,"tokens":%d,"heardText":"do once or twice she had peeped into the book her sister was reading but it had no pictures or conversations in it and what is the use of a"}`+"\n", word, word-1, confidence, confident, tokens)
	return true
}

// fakeArg is the value after flag in the fake sidecar's arguments.
func fakeArg(flag string) string {
	for i := 1; i+1 < len(os.Args); i++ {
		if os.Args[i] == flag {
			return os.Args[i+1]
		}
	}
	return ""
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

// writeLastReading stores that the prompter stopped at word read of chapterID (ADR 0205), as a session end does.
func (f locateHost) writeLastReading(t *testing.T, chapterID string, read int) {
	t.Helper()
	folder := f.host.config.projectFolder
	script, ok := teleprompter.LoadChapterScript(folder, chapterID)
	if !ok {
		t.Fatalf("chapter %s has no script", chapterID)
	}
	if err := teleprompter.WriteReading(folder, chapterID, read, len(script.Tokens), "listening", time.Date(2026, 9, 24, 21, 4, 0, 0, time.UTC)); err != nil {
		t.Fatal(err)
	}
}

func verdictOf(t *testing.T, result map[string]any) map[string]any {
	t.Helper()
	verdict, ok := result["verdict"].(map[string]any)
	if !ok {
		t.Fatalf("result has no verdict: %v", result)
	}
	return verdict
}

// Resume reconciles the recorded tail with the prompter's last reading (read-aloud-resume-from-daw PRD Phase 3).
func TestTeleprompterLocateReconcilesTheTailWithTheLastReading(t *testing.T) {
	for _, c := range []struct {
		name   string
		read   int
		word   string
		unsure bool
		kind   string
		start  any
	}{
		{"no reading: the recording is only offered", 0, "", false, "daw_only", nil},
		{"agree: Start reading is preset to the DAW word", 58, "", false, "agree", float64(52)},
		{"disagree: both places are offered", 400, "", false, "disagree", nil},
		{"a low-confidence tail the reading confirms", 50, "", true, "agree", float64(52)},
		{"recorded to the end: nothing to resume", 0, "end", false, "complete", nil},
	} {
		t.Run(c.name, func(t *testing.T) {
			f := newTestHostForLocate(t, true)
			if c.read > 0 {
				f.writeLastReading(t, f.chapters[0], c.read)
			}
			t.Setenv(fakeLocateWordEnv, c.word)
			if c.unsure {
				t.Setenv(fakeLocateUnsureEnv, "1")
			}

			result := f.locate(t, f.chapters[0], "")

			verdict := verdictOf(t, result)
			if verdict["kind"] != c.kind || verdict["start"] != c.start {
				t.Fatalf("verdict = %v", verdict)
			}
			daw, _ := verdict["daw"].(map[string]any)
			if daw == nil || daw["source"] != "saved" || daw["sentence"] == nil {
				t.Fatalf("daw = %v", daw)
			}
			if (c.read > 0) != (result["lastReading"] != nil) {
				t.Fatalf("lastReading = %v", result["lastReading"])
			}
		})
	}
}

func TestTeleprompterLocateOffersTheLastReadingOfAChapterWithNoTrack(t *testing.T) {
	f := newTestHostForLocate(t, false)
	f.writeLastReading(t, f.chapters[2], 30)

	result := f.locate(t, f.chapters[2], "")

	verdict := verdictOf(t, result)
	prompter, _ := verdict["prompter"].(map[string]any)
	if result["status"] != "no_track" || verdict["kind"] != "prompter_only" || verdict["daw"] != nil || prompter["word"] != float64(30) || prompter["number"] != float64(31) {
		t.Fatalf("result = %v", result)
	}
}

func TestTeleprompterLocateDropsALastReadingOfAnEditedChapter(t *testing.T) {
	f := newTestHostForLocate(t, true)
	f.writeLastReading(t, f.chapters[0], 58)
	path := filepath.Join(f.host.config.projectFolder, "narration-utils", "manuscript", "manuscript.json")
	bytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(strings.Replace(string(bytes), "Alice", "Alicia", 1)), 0o600); err != nil {
		t.Fatal(err)
	}

	result := f.locate(t, f.chapters[0], "")

	if result["lastReading"] != nil || verdictOf(t, result)["kind"] != "daw_only" {
		t.Fatalf("result = %v", result)
	}
}

// The resume verdicts lane C renders (PRD Phase 3): agree, disagree, complete and prompter-only, beside
// teleprompter-locate-found (the recording alone).
func TestContractTeleprompterLocateVerdicts(t *testing.T) {
	cases := []struct {
		name, word string
		chapter    int
		read       int
	}{
		{"teleprompter-locate-agree", "", 0, 58},
		{"teleprompter-locate-disagree", "", 0, 400},
		{"teleprompter-locate-complete", "end", 0, 0},
		{"teleprompter-locate-prompter-only", "", 2, 30},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := newTestHostForLocate(t, true)
			if c.read > 0 {
				f.writeLastReading(t, f.chapters[c.chapter], c.read)
			}
			t.Setenv(fakeLocateWordEnv, c.word)
			raw, err := f.host.TeleprompterLocate(f.chapters[c.chapter], "", "")
			if err != nil {
				t.Fatal(err)
			}
			var payload map[string]any
			if err := json.Unmarshal([]byte(raw), &payload); err != nil {
				t.Fatal(err)
			}
			// The script hash covers the import's own document id, which differs per test run.
			if reading, ok := payload["lastReading"].(map[string]any); ok {
				reading["scriptHash"] = strings.Repeat("0", 64)
			}
			stable, err := contractfile.PortablePaths(payload, f.host.config.projectFolder, "C:/Projects/Alice")
			if err != nil {
				t.Fatal(err)
			}
			contractfile.Check(t, c.name, stable)
		})
	}
}
