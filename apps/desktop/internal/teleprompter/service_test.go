package teleprompter

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/process"
)

const fakeSidecarEnv = "TELEPROMPTER_FAKE_SIDECAR"

// TestMain lets this test binary stand in for the Python sidecar. It runs
// before Go parses flags, so it can accept the host's --engine/--chapter/...
// arguments, which a normal helper-process test could not.
func TestMain(m *testing.M) {
	if mode := os.Getenv(fakeSidecarEnv); mode != "" {
		runFakeSidecar(mode)
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func flagValue(args []string, name string) string {
	for index, arg := range args {
		if arg == name && index+1 < len(args) {
			return args[index+1]
		}
	}
	return ""
}

func runFakeSidecar(mode string) {
	if runFakeDeviceLister(mode) {
		return
	}
	args, _ := json.Marshal(os.Args[1:])
	fmt.Printf("{\"type\":\"args\",\"args\":%s}\n", args)
	switch mode {
	case "crash":
		fmt.Fprintln(os.Stderr, "loading the model")
		fmt.Fprintln(os.Stderr, "Traceback: the model file is corrupt")
		os.Exit(5)
	case "ignore-stop":
		fmt.Println(`{"type":"script","chapter":{"id":"c1","title":"One"},"tokens":4,"spans":[]}`)
		time.Sleep(time.Minute)
		return
	case "done-crash":
		fmt.Println(`{"type":"script","chapter":{"id":"c1","title":"One"},"tokens":4,"spans":[]}`)
		fmt.Println(`{"type":"position","read":4,"committed":4,"status":"done","jump":null,"skipped":null}`)
		fmt.Fprintln(os.Stderr, "Traceback: the model file is corrupt")
		os.Exit(5)
	}
	fmt.Println(`{"type":"script","chapter":{"id":"c1","title":"One"},"tokens":4,"spans":[]}`)
	fmt.Println(`{"type":"partial","segment":0,"words":[{"word":"hello","start":0,"end":0.4}]}`)
	fmt.Println(`{"type":"position","read":1,"committed":0,"status":"listening","jump":null,"skipped":null}`)
	if mode == "done" {
		fmt.Println(`{"type":"position","read":4,"committed":4,"status":"done","jump":null,"skipped":null}`)
	}
	fmt.Println("not json at all")
	stopFile := flagValue(os.Args[1:], "--stop-file")
	for {
		if _, err := os.Stat(stopFile); err == nil {
			fmt.Println(`{"type":"segment_end","segment":0}`)
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
}

type recorder struct {
	mu     sync.Mutex
	events []map[string]any
	states []map[string]any
}

func (r *recorder) emit(raw json.RawMessage) {
	var event map[string]any
	if err := json.Unmarshal(raw, &event); err != nil {
		return
	}
	r.mu.Lock()
	r.events = append(r.events, event)
	r.mu.Unlock()
}

func (r *recorder) changed(state map[string]any) {
	r.mu.Lock()
	r.states = append(r.states, state)
	r.mu.Unlock()
}

func (r *recorder) eventTypes() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	types := make([]string, 0, len(r.events))
	for _, event := range r.events {
		types = append(types, fmt.Sprint(event["type"]))
	}
	return types
}

func (r *recorder) firstEvent(kind string) map[string]any {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, event := range r.events {
		if event["type"] == kind {
			return event
		}
	}
	return nil
}

type fixture struct {
	service  *Service
	recorder *recorder
	project  string
	session  string
}

func newFixture(t *testing.T, mode string) *fixture {
	t.Helper()
	t.Setenv(fakeSidecarEnv, mode)
	project := t.TempDir()
	manuscriptDir := filepath.Join(project, "narration-utils", "manuscript")
	if err := os.MkdirAll(manuscriptDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(manuscriptDir, "manuscript.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	session := t.TempDir()
	supervisor := process.NewSupervisor()
	t.Cleanup(func() { _ = supervisor.Close() })
	recorder := &recorder{}
	service := New(Config{Project: project, SessionDir: session, Python: os.Args[0]}, supervisor, recorder.emit, recorder.changed)
	service.grace = 300 * time.Millisecond
	t.Cleanup(func() { _ = service.Close(context.Background()) })
	return &fixture{service: service, recorder: recorder, project: project, session: session}
}

func validOptions() map[string]string {
	return map[string]string{"chapter": "c1", "device": "Microphone Array", "model": "tiny", "modelDir": "C:/models/tiny"}
}

func waitFor(t *testing.T, what string, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func phase(s *Service) string {
	value, _ := s.Snapshot()["phase"].(string)
	return value
}

func echoedArgs(t *testing.T, f *fixture) []string {
	t.Helper()
	waitFor(t, "the args echo", func() bool { return f.recorder.firstEvent("args") != nil })
	raw, _ := f.recorder.firstEvent("args")["args"].([]any)
	args := make([]string, 0, len(raw))
	for _, value := range raw {
		args = append(args, fmt.Sprint(value))
	}
	return args
}

func TestStartLaunchesTheSidecarWithTheHostContractFlags(t *testing.T) {
	f := newFixture(t, "stream")
	if err := f.service.Start(validOptions()); err != nil {
		t.Fatal(err)
	}

	args := echoedArgs(t, f)

	want := map[string]string{
		"--engine": "whisper", "--model": "tiny", "--model-dir": "C:/models/tiny", "--chapter": "c1", "--mic": "Microphone Array",
		"--manuscript": filepath.Join(f.project, "narration-utils", "manuscript", "manuscript.json"),
	}
	for name, value := range want {
		if got := flagValue(args, name); got != value {
			t.Errorf("%s = %q, want %q (args %v)", name, got, value, args)
		}
	}
	if !strings.HasPrefix(flagValue(args, "--stop-file"), f.session) {
		t.Errorf("--stop-file = %q, want it inside the session dir", flagValue(args, "--stop-file"))
	}
	if !strings.HasPrefix(flagValue(args, "--control-file"), f.session) {
		t.Errorf("--control-file = %q, want it inside the session dir", flagValue(args, "--control-file"))
	}
}

func TestStartPassesStartWordOnlyWhenGiven(t *testing.T) {
	f := newFixture(t, "stream")
	options := validOptions()
	options["startWord"] = "42"
	if err := f.service.Start(options); err != nil {
		t.Fatal(err)
	}

	args := echoedArgs(t, f)

	if got := flagValue(args, "--start-word"); got != "42" {
		t.Errorf("--start-word = %q, want 42 (args %v)", got, args)
	}
}

func TestStartOmitsStartWordWhenNotGiven(t *testing.T) {
	f := newFixture(t, "stream")
	if err := f.service.Start(validOptions()); err != nil {
		t.Fatal(err)
	}

	args := echoedArgs(t, f)

	for _, arg := range args {
		if arg == "--start-word" {
			t.Fatalf("--start-word should be omitted when no startWord option was given, args = %v", args)
		}
	}
}

func controlFileContent(t *testing.T, session string) string {
	t.Helper()
	matches, err := filepath.Glob(filepath.Join(session, "teleprompter_*.control"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 1 {
		t.Fatalf("expected exactly one control file, found %v", matches)
	}
	data, err := os.ReadFile(matches[0])
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestSeekAppendsASeekCommandToTheControlFile(t *testing.T) {
	f := newFixture(t, "stream")
	if err := f.service.Start(validOptions()); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the position event", func() bool { return f.recorder.firstEvent("position") != nil })

	if err := f.service.Seek(42); err != nil {
		t.Fatal(err)
	}
	if err := f.service.Seek(7); err != nil {
		t.Fatal(err)
	}

	content := controlFileContent(t, f.session)
	lines := strings.Split(strings.TrimRight(content, "\n"), "\n")
	if len(lines) != 2 {
		t.Fatalf("control file lines = %v, want 2", lines)
	}
	var first, second map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &first); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(lines[1]), &second); err != nil {
		t.Fatal(err)
	}
	if first["cmd"] != "seek" || first["word"] != float64(42) {
		t.Errorf("first command = %v", first)
	}
	if second["cmd"] != "seek" || second["word"] != float64(7) {
		t.Errorf("second command = %v", second)
	}
}

func TestSeekErrorsWhenNoSessionIsRunning(t *testing.T) {
	f := newFixture(t, "stream")

	if err := f.service.Seek(5); err == nil || !strings.Contains(err.Error(), "no teleprompter session") {
		t.Fatalf("err = %v", err)
	}
}

func TestSeekErrorsWhenTheControlFileCannotBeOpened(t *testing.T) {
	f := newFixture(t, "stream")
	if err := f.service.Start(validOptions()); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the position event", func() bool { return f.recorder.firstEvent("position") != nil })

	// Remove the session directory the control file lives in, so the next
	// OpenFile call fails: a realistic failure mode (the project or its
	// session directory disappears mid-session, e.g. an external clean-up).
	if err := os.RemoveAll(f.session); err != nil {
		t.Fatal(err)
	}

	if err := f.service.Seek(5); err == nil {
		t.Fatal("expected an error once the session directory is gone")
	}
}

func TestFailSetsTheErrorPhaseAndNotifies(t *testing.T) {
	f := newFixture(t, "stream")
	f.service.config.Python = filepath.Join(t.TempDir(), "does-not-exist.exe")

	if err := f.service.Start(validOptions()); err == nil {
		t.Fatal("expected Start to fail when the sidecar executable does not exist")
	}

	if got := phase(f.service); got != "error" {
		t.Fatalf("phase = %q, want %q", got, "error")
	}
	f.service.mu.RLock()
	message, _ := f.service.state["message"].(string)
	f.service.mu.RUnlock()
	if message == "" {
		t.Fatal("expected a non-empty failure message")
	}
	f.recorder.mu.Lock()
	states := len(f.recorder.states)
	f.recorder.mu.Unlock()
	if states == 0 {
		t.Fatal("expected at least one changed notification")
	}
}

func TestSeekErrorsAfterTheSessionHasStopped(t *testing.T) {
	f := newFixture(t, "stream")
	if err := f.service.Start(validOptions()); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the position event", func() bool { return f.recorder.firstEvent("position") != nil })
	f.service.Stop()
	waitFor(t, "the stopped phase", func() bool { return phase(f.service) == "stopped" })

	if err := f.service.Seek(5); err == nil {
		t.Fatal("expected an error once the session has stopped")
	}
}

func TestSidecarEventsAreRelayedInOrderAndStrayOutputIsIgnored(t *testing.T) {
	f := newFixture(t, "stream")
	if err := f.service.Start(validOptions()); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the position event", func() bool { return f.recorder.firstEvent("position") != nil })

	if got := strings.Join(f.recorder.eventTypes(), ","); got != "args,script,partial,position" {
		t.Fatalf("event types = %s", got)
	}
}

func TestTheSnapshotKeepsTheScriptAndLatestPositionForALateSubscriber(t *testing.T) {
	f := newFixture(t, "stream")
	if err := f.service.Start(validOptions()); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the position event", func() bool { return f.recorder.firstEvent("position") != nil })

	snapshot := f.service.Snapshot()
	script, _ := snapshot["script"].(map[string]any)
	position, _ := snapshot["position"].(map[string]any)
	if snapshot["phase"] != "running" || script["tokens"] != float64(4) || position["read"] != float64(1) {
		t.Fatalf("snapshot = %v", snapshot)
	}
}

func TestStopAsksTheSidecarToFinishAndEndsInStopped(t *testing.T) {
	f := newFixture(t, "stream")
	if err := f.service.Start(validOptions()); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the position event", func() bool { return f.recorder.firstEvent("position") != nil })

	f.service.Stop()

	waitFor(t, "the stopped phase", func() bool { return phase(f.service) == "stopped" })
	if f.recorder.firstEvent("segment_end") == nil {
		t.Fatalf("the sidecar should have flushed before exiting, events = %v", f.recorder.eventTypes())
	}
	if f.service.Busy() {
		t.Fatal("a stopped session should not be busy")
	}
	// The watcher publishes "stopped" and only then removes the stop file, so the file is gone shortly after the
	// phase changes, not at the same instant: wait for it rather than reading it once.
	waitFor(t, "the stop file to be removed", func() bool {
		leftovers, _ := filepath.Glob(filepath.Join(f.session, "teleprompter_*.stop"))
		return len(leftovers) == 0
	})
}

func TestStopKillsASidecarThatIgnoresTheStopFileAfterTheGracePeriod(t *testing.T) {
	f := newFixture(t, "ignore-stop")
	if err := f.service.Start(validOptions()); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the script event", func() bool { return f.recorder.firstEvent("script") != nil })

	f.service.Stop()

	waitFor(t, "the stopped phase", func() bool { return phase(f.service) == "stopped" })
}

func TestCloseReturnsOnlyOnceTheSessionIsMarkedStopped(t *testing.T) {
	f := newFixture(t, "stream")
	for round := 0; round < 40; round++ {
		if err := f.service.Start(validOptions()); err != nil {
			t.Fatalf("round %d: %v", round, err)
		}
		waitFor(t, "the script event", func() bool { return f.recorder.firstEvent("script") != nil })

		if err := f.service.Close(context.Background()); err != nil {
			t.Fatalf("round %d: %v", round, err)
		}

		if f.service.Busy() {
			t.Fatalf("round %d: Close returned while the session was still %q", round, phase(f.service))
		}
	}
}

func TestASidecarThatCrashesLeavesAnErrorWithItsLastStderrLine(t *testing.T) {
	f := newFixture(t, "crash")
	if err := f.service.Start(validOptions()); err != nil {
		t.Fatal(err)
	}

	waitFor(t, "the error phase", func() bool { return phase(f.service) == "error" })

	message, _ := f.service.Snapshot()["message"].(string)
	if !strings.Contains(message, "the model file is corrupt") {
		t.Fatalf("message = %q", message)
	}
	if f.service.Busy() {
		t.Fatal("a crashed session should not be busy")
	}
}

func TestOnlyOneSessionRunsAtATime(t *testing.T) {
	f := newFixture(t, "stream")
	if err := f.service.Start(validOptions()); err != nil {
		t.Fatal(err)
	}

	if err := f.service.Start(validOptions()); err == nil || !strings.Contains(err.Error(), "already running") {
		t.Fatalf("err = %v", err)
	}
	if !f.service.Busy() {
		t.Fatal("a running session is busy")
	}
}

func TestStartRejectsIncompleteOrUnsupportedRequestsWithoutLaunchingAnything(t *testing.T) {
	cases := map[string]func(map[string]string){
		"no chapter":         func(o map[string]string) { delete(o, "chapter") },
		"no input":           func(o map[string]string) { delete(o, "device") },
		"unsupported engine": func(o map[string]string) { o["engine"] = "moonshine" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			f := newFixture(t, "stream")
			options := validOptions()
			mutate(options)

			if err := f.service.Start(options); err == nil {
				t.Fatal("expected an error")
			}
			if phase(f.service) != "idle" || len(f.recorder.eventTypes()) != 0 {
				t.Fatalf("nothing should have started: phase=%s events=%v", phase(f.service), f.recorder.eventTypes())
			}
		})
	}
}

func TestStartNeedsAnImportedManuscript(t *testing.T) {
	f := newFixture(t, "stream")
	if err := os.Remove(filepath.Join(f.project, "narration-utils", "manuscript", "manuscript.json")); err != nil {
		t.Fatal(err)
	}

	if err := f.service.Start(validOptions()); err == nil || !strings.Contains(err.Error(), "manuscript") {
		t.Fatalf("err = %v", err)
	}
}

func TestADeveloperCanReplayARecordingInsteadOfUsingAMicrophone(t *testing.T) {
	f := newFixture(t, "stream")
	options := validOptions()
	delete(options, "device")
	options["wav"] = "C:/audio/reading.wav"

	if err := f.service.Start(options); err != nil {
		t.Fatal(err)
	}

	args := echoedArgs(t, f)
	if flagValue(args, "--wav") != "C:/audio/reading.wav" || flagValue(args, "--mic") != "" {
		t.Fatalf("args = %v", args)
	}
}

func TestADeveloperSidecarRunsItsBackendScriptAsTheFirstArgument(t *testing.T) {
	f := newFixture(t, "stream")
	f.service.config.Backend = "C:/repo/sidecars/manuscript-teleprompter/core/live_asr.py"

	if err := f.service.Start(validOptions()); err != nil {
		t.Fatal(err)
	}

	args := echoedArgs(t, f)
	if len(args) == 0 || args[0] != "C:/repo/sidecars/manuscript-teleprompter/core/live_asr.py" {
		t.Fatalf("args = %v", args)
	}
}
