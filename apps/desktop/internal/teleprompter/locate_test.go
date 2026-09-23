package teleprompter

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/process"
)

// runFakeLocator stands in for the sidecar's `--locate` mode (locate.py): one `locate` line, then exit. In the ok mode
// the heard text carries the arguments it was given, so a test can check the command line the host built.
func runFakeLocator(mode string) bool {
	if len(os.Args) < 2 || os.Args[1] != "--locate" {
		return false
	}
	switch mode {
	case "locate-crash":
		fmt.Fprintln(os.Stderr, "Loading Whisper model 'tiny' from the locally verified asset cache...")
		fmt.Fprintln(os.Stderr, "live_asr.py: error: Chapter 'c9' was not found among the narration chapters.")
		os.Exit(2)
	case "locate-silent":
		fmt.Println("a library printed this")
	case "locate-inconsistent":
		fmt.Println(`{"type":"locate","word":90,"last":89,"sentence":null,"confidence":0.9,"confident":true,"matched":30,"heard":32,"runnerUp":2,"tokens":40,"heardText":""}`)
	case "locate-hang":
		time.Sleep(time.Minute)
	default:
		args, _ := json.Marshal(strings.Join(os.Args[1:], " "))
		fmt.Println(`{"type":"args"}`)
		fmt.Printf(`{"type":"locate","word":52,"last":51,"sentence":{"start":23,"end":59,"text":"Once or twice."},"confidence":0.812,"confident":true,"matched":30,"heard":32,"runnerUp":4,"tokens":102,"heardText":%s}`+"\n", args)
	}
	return true
}

type locateFixture struct {
	service *Service
	audio   string
	project string
}

func newLocateFixture(t *testing.T, mode string) locateFixture {
	t.Helper()
	t.Setenv(fakeSidecarEnv, mode)
	project := t.TempDir()
	manuscript := filepath.Join(project, "narration-utils", "manuscript", "manuscript.json")
	if err := os.MkdirAll(filepath.Dir(manuscript), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manuscript, []byte(`{}`), 0o600); err != nil {
		t.Fatal(err)
	}
	audio := filepath.Join(project, "media", "Chapter 1.wav")
	if err := os.MkdirAll(filepath.Dir(audio), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(audio, []byte("RIFF"), 0o600); err != nil {
		t.Fatal(err)
	}
	supervisor := process.NewSupervisor()
	t.Cleanup(func() { _ = supervisor.Close() })
	service := New(Config{Project: project, SessionDir: t.TempDir(), Python: os.Args[0]}, supervisor, nil, nil)
	return locateFixture{service: service, audio: audio, project: project}
}

func (f locateFixture) request() LocateRequest {
	return LocateRequest{Chapter: "c1", Audio: f.audio, From: 812.4, To: 842.4, Model: "tiny", ModelDir: filepath.Join(f.project, "models", "tiny"), Language: "en"}
}

func TestLocateRunsTheSidecarOnceAndReturnsItsLocateLine(t *testing.T) {
	f := newLocateFixture(t, "locate-ok")

	located, err := f.service.Locate(context.Background(), f.request())

	if err != nil {
		t.Fatal(err)
	}
	if located.Word == nil || *located.Word != 52 || *located.Last != 51 || !located.Confident || located.Sentence.Text != "Once or twice." {
		t.Fatalf("located = %+v", located)
	}
	manuscript := filepath.Join(f.project, "narration-utils", "manuscript", "manuscript.json")
	want := strings.Join([]string{
		"--locate", "--engine", "whisper", "--model", "tiny", "--model-dir", filepath.Join(f.project, "models", "tiny"),
		"--manuscript", manuscript, "--chapter", "c1", "--wav", f.audio, "--tail-start", "812.400", "--tail-end", "842.400", "--language", "en",
	}, " ")
	if located.HeardText != want {
		t.Fatalf("sidecar arguments =\n%s\nwant\n%s", located.HeardText, want)
	}
}

func TestLocatePutsTheBackendScriptFirstForADeveloperRun(t *testing.T) {
	f := newLocateFixture(t, "locate-ok")
	f.service.config.Backend = "live_asr.py"

	args := f.service.locateArgs("m.json", f.request())

	if args[0] != "live_asr.py" || args[1] != "--locate" {
		t.Fatalf("args = %v", args)
	}
}

func TestLocateDefaultsTheModelToTinyAndLeavesTheLanguageToTheSidecar(t *testing.T) {
	f := newLocateFixture(t, "locate-ok")
	request := f.request()
	request.Model, request.Language = "", " "

	args := strings.Join(f.service.locateArgs("m.json", request), " ")

	if !strings.Contains(args, "--model tiny") || strings.Contains(args, "--language") {
		t.Fatalf("args = %s", args)
	}
}

// Every value of the request becomes an argument of the sidecar (threat model row 4a): anything the sidecar would
// refuse is refused here first, and no process starts.
func TestLocateRefusesARequestTheSidecarShouldNeverSee(t *testing.T) {
	f := newLocateFixture(t, "locate-hang")
	for name, change := range map[string]func(*LocateRequest){
		"no chapter":            func(r *LocateRequest) { r.Chapter = " " },
		"a relative audio path": func(r *LocateRequest) { r.Audio = "--stop-file" },
		"a missing audio file":  func(r *LocateRequest) { r.Audio = filepath.Join(f.project, "gone.wav") },
		"a folder as audio":     func(r *LocateRequest) { r.Audio = f.project },
		"a negative start":      func(r *LocateRequest) { r.From = -1 },
		"an empty range":        func(r *LocateRequest) { r.To = r.From },
		"a reversed range":      func(r *LocateRequest) { r.From, r.To = r.To, r.From },
		"a range too long":      func(r *LocateRequest) { r.From, r.To = 0, MaxTailSeconds+1 },
		"not a number":          func(r *LocateRequest) { r.From = math.NaN() },
		"an infinite end":       func(r *LocateRequest) { r.To = math.Inf(1) },
		"no model directory":    func(r *LocateRequest) { r.ModelDir = "" },
		"a relative model dir":  func(r *LocateRequest) { r.ModelDir = "--nonsense" },
	} {
		t.Run(name, func(t *testing.T) {
			request := f.request()
			change(&request)
			started := time.Now()

			_, err := f.service.Locate(context.Background(), request)

			if err == nil {
				t.Fatal("expected the request to be refused")
			}
			if time.Since(started) > 5*time.Second {
				t.Fatal("the refused request reached the (hanging) sidecar")
			}
		})
	}
}

func TestLocateNeedsAProjectAManuscriptAndTheSidecar(t *testing.T) {
	f := newLocateFixture(t, "locate-ok")
	for name, service := range map[string]*Service{
		"no project":    New(Config{}, process.NewSupervisor(), nil, nil),
		"no manuscript": New(Config{Project: t.TempDir(), Python: os.Args[0]}, process.NewSupervisor(), nil, nil),
		"no sidecar":    New(Config{Project: f.project}, nil, nil, nil),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := service.Locate(context.Background(), f.request()); err == nil {
				t.Fatal("expected an error")
			}
		})
	}
}

func TestLocateReportsTheSidecarsOwnErrorLine(t *testing.T) {
	f := newLocateFixture(t, "locate-crash")

	_, err := f.service.Locate(context.Background(), f.request())

	if err == nil || !strings.Contains(err.Error(), "Chapter 'c9' was not found") {
		t.Fatalf("err = %v", err)
	}
}

func TestLocateFailsWhenTheSidecarPrintsNoLocateLine(t *testing.T) {
	f := newLocateFixture(t, "locate-silent")

	if _, err := f.service.Locate(context.Background(), f.request()); err == nil || !strings.Contains(err.Error(), "did not report") {
		t.Fatalf("err = %v", err)
	}
}

func TestLocateRefusesAWordOutsideTheChapter(t *testing.T) {
	f := newLocateFixture(t, "locate-inconsistent")

	if _, err := f.service.Locate(context.Background(), f.request()); err == nil || !strings.Contains(err.Error(), "outside the chapter") {
		t.Fatalf("err = %v", err)
	}
}

func TestLocateHonoursTheCallersDeadline(t *testing.T) {
	f := newLocateFixture(t, "locate-hang")
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	started := time.Now()

	_, err := f.service.Locate(ctx, f.request())

	if err == nil || !strings.Contains(err.Error(), "too long") {
		t.Fatalf("err = %v", err)
	}
	if time.Since(started) > 15*time.Second {
		t.Fatal("the deadline did not stop the sidecar")
	}
}

func TestParseLocatedRefusesInconsistentLines(t *testing.T) {
	for name, line := range map[string]string{
		"word without last":       `{"type":"locate","word":3,"last":null,"sentence":null,"confidence":0.5,"confident":false,"matched":3,"heard":3,"runnerUp":0,"tokens":10,"heardText":""}`,
		"sentence without word":   `{"type":"locate","word":null,"last":null,"sentence":{"start":0,"end":2,"text":"a b"},"confidence":0,"confident":false,"matched":0,"heard":0,"runnerUp":0,"tokens":10,"heardText":""}`,
		"confidence above one":    `{"type":"locate","word":null,"last":null,"sentence":null,"confidence":1.5,"confident":false,"matched":0,"heard":0,"runnerUp":0,"tokens":10,"heardText":""}`,
		"sentence past the end":   `{"type":"locate","word":3,"last":2,"sentence":{"start":0,"end":12,"text":"a"},"confidence":0.9,"confident":true,"matched":3,"heard":3,"runnerUp":0,"tokens":10,"heardText":""}`,
		"an empty sentence":       `{"type":"locate","word":3,"last":2,"sentence":{"start":2,"end":2,"text":""},"confidence":0.9,"confident":true,"matched":3,"heard":3,"runnerUp":0,"tokens":10,"heardText":""}`,
		"not json after the type": `{"type":"locate","word":"three"}`,
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := parseLocated(line); err == nil {
				t.Fatal("expected the line to be refused")
			}
		})
	}
}

func TestParseLocatedAcceptsATailThatCouldNotBePlaced(t *testing.T) {
	located, err := parseLocated(`{"type":"locate","word":null,"last":null,"sentence":null,"confidence":0,"confident":false,"matched":0,"heard":0,"runnerUp":0,"tokens":10,"heardText":""}`)

	if err != nil || located.Word != nil || located.Sentence != nil {
		t.Fatalf("located = %+v, err = %v", located, err)
	}
}

// The sidecar's own `locate` line, pinned by its Python contract test (teleprompter-locate.json), parses here: the two
// halves of the boundary read the same file.
func TestContractTheSidecarsLocateLineParses(t *testing.T) {
	dir, err := contractfile.Dir()
	if err != nil {
		t.Fatal(err)
	}
	bytes, err := os.ReadFile(filepath.Join(dir, "teleprompter-locate.json"))
	if err != nil {
		t.Fatalf("the sidecar's locate file is missing (run the Python contract test with UPDATE_CONTRACTS=1): %v", err)
	}
	var value any
	if err := json.Unmarshal(bytes, &value); err != nil {
		t.Fatal(err)
	}
	line, err := json.Marshal(value) // the committed file is indented; the sidecar prints one line
	if err != nil {
		t.Fatal(err)
	}

	located, err := parseLocated(string(line))

	if err != nil {
		t.Fatal(err)
	}
	if located.Word == nil || located.Sentence == nil || located.Tokens == 0 || located.HeardText == "" {
		t.Fatalf("located = %+v", located)
	}
}
