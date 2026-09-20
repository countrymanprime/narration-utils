package guide

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/process"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

const (
	fakeSidecarEnv = "GUIDE_FAKE_SIDECAR"
	fakeLogEnv     = "GUIDE_FAKE_SIDECAR_LOG"
)

// TestMain lets this test binary stand in for the Python Story Bible sidecar's
// render-audio command. It runs before Go parses flags, so it can accept the
// host's --guide/--audio-dir/... arguments.
func TestMain(m *testing.M) {
	if mode := os.Getenv(fakeSidecarEnv); mode != "" {
		os.Exit(runFakeSidecar(mode))
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

func runFakeSidecar(mode string) int {
	if logPath := os.Getenv(fakeLogEnv); logPath != "" {
		if file, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600); err == nil {
			_, _ = fmt.Fprintln(file, strings.Join(os.Args[1:], " "))
			_ = file.Close()
		}
	}
	target := filepath.Join(flagValue(os.Args[1:], "--audio-dir"), flagValue(os.Args[1:], "--output-name"))
	_ = os.MkdirAll(filepath.Dir(target), 0o755)
	switch mode {
	case "wav":
		_ = os.WriteFile(target, append([]byte("RIFF-fake-wav-"), make([]byte, 64)...), 0o600)
	case "slow-wav":
		time.Sleep(400 * time.Millisecond)
		_ = os.WriteFile(target, append([]byte("RIFF-fake-wav-"), make([]byte, 64)...), 0o600)
	case "zero-byte":
		_ = os.WriteFile(target, nil, 0o600)
	case "no-file":
	case "fail":
		fmt.Fprintln(os.Stderr, "loading the voice")
		fmt.Fprintln(os.Stderr, `ERROR: "..." could not be spoken: the voice produced no audio for it.`)
		return 1
	case "hang":
		_ = os.WriteFile(target+".123.part", []byte("partial"), 0o600)
		time.Sleep(time.Minute)
	}
	return 0
}

type previewRig struct {
	service *Service
	project string
	log     string
}

func newPreviewRig(t *testing.T, mode string) previewRig {
	t.Helper()
	// The brackets are pattern characters to filepath.Glob: cleanup must not depend on it.
	project := filepath.Join(t.TempDir(), "[Draft] book")
	logPath := filepath.Join(t.TempDir(), "sidecar.log")
	t.Setenv(fakeSidecarEnv, mode)
	t.Setenv(fakeLogEnv, logPath)
	sidecars := process.NewSupervisor()
	t.Cleanup(func() { _ = sidecars.Close() })
	service := New(project, os.Args[0], "", settings.New(project, project), sidecars)
	if err := os.MkdirAll(filepath.Dir(service.guidePath()), 0o755); err != nil {
		t.Fatal(err)
	}
	guideJSON := `{"entities":[{"id":"e1","canonical_name":"Dawnspire","aliases":[{"text":"the Spire"}]}]}`
	if err := os.WriteFile(service.guidePath(), []byte(guideJSON), 0o600); err != nil {
		t.Fatal(err)
	}
	return previewRig{service: service, project: project, log: logPath}
}

func (r previewRig) invocations(t *testing.T) int {
	t.Helper()
	raw, err := os.ReadFile(r.log)
	if os.IsNotExist(err) {
		return 0
	}
	if err != nil {
		t.Fatal(err)
	}
	return len(strings.Split(strings.TrimSpace(string(raw)), "\n"))
}

func (r previewRig) audioDir() string {
	return filepath.Join(r.project, "ManuscriptGuide", "audio", "tts")
}

var testVoice = PreviewVoice{ID: "en_US-ljspeech-high", Model: "voice.onnx", Provider: "piper", Version: "1.0.0"}

func TestPreviewRendersOnceAndReusesTheCachedFile(t *testing.T) {
	rig := newPreviewRig(t, "wav")
	first, err := rig.service.Preview("e1", nil, testVoice)
	if err != nil || len(first) == 0 {
		t.Fatalf("first preview = %d bytes, %v", len(first), err)
	}
	second, err := rig.service.Preview("e1", nil, testVoice)
	if err != nil || string(second) != string(first) {
		t.Fatalf("second preview = %d bytes, %v", len(second), err)
	}
	if got := rig.invocations(t); got != 1 {
		t.Fatalf("sidecar started %d times, want 1 (the cache must serve the second click)", got)
	}
}

// A failed render used to leave a zero-byte WAV at the hashed path, and Preview
// trusted any existing file, so every later attempt returned empty audio.
func TestPreviewIgnoresAZeroByteCachedFileAndReplacesIt(t *testing.T) {
	rig := newPreviewRig(t, "wav")
	poisoned := filepath.Join(rig.audioDir(), previewFileName(testVoice, "Dawnspire"))
	if err := os.MkdirAll(rig.audioDir(), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(poisoned, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	audio, err := rig.service.Preview("e1", nil, testVoice)
	if err != nil {
		t.Fatal(err)
	}
	if len(audio) <= wavHeaderBytes {
		t.Fatalf("preview returned %d bytes; the zero-byte cache file was trusted", len(audio))
	}
	if got := rig.invocations(t); got != 1 {
		t.Fatalf("sidecar started %d times, want 1 (a zero-byte file is a cache miss)", got)
	}
}

func TestPreviewTrustsANonEmptyCachedFileWithoutStartingTheSidecar(t *testing.T) {
	rig := newPreviewRig(t, "fail")
	cached := filepath.Join(rig.audioDir(), previewFileName(testVoice, "Dawnspire"))
	if err := os.MkdirAll(rig.audioDir(), 0o755); err != nil {
		t.Fatal(err)
	}
	want := append([]byte("RIFF"), make([]byte, 100)...)
	if err := os.WriteFile(cached, want, 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := rig.service.Preview("e1", nil, testVoice)
	if err != nil || string(got) != string(want) {
		t.Fatalf("preview = %d bytes, %v", len(got), err)
	}
	if rig.invocations(t) != 0 {
		t.Fatal("a valid cached preview must not start the sidecar")
	}
}

// The cache key ignored the voice id, so a stale WAV survived a voice change.
func TestPreviewCacheIsKeyedOnTheVoice(t *testing.T) {
	rig := newPreviewRig(t, "wav")
	other := testVoice
	other.ID = "en_GB-alba-medium"
	if previewFileName(testVoice, "Dawnspire") == previewFileName(other, "Dawnspire") {
		t.Fatal("changing the voice must change the cache file name")
	}
	if previewFileName(testVoice, "Dawnspire") == previewFileName(testVoice, "the Spire") {
		t.Fatal("changing the spoken text must change the cache file name")
	}
	for _, voice := range []PreviewVoice{testVoice, other, testVoice, other} {
		if _, err := rig.service.Preview("e1", nil, voice); err != nil {
			t.Fatal(err)
		}
	}
	if got := rig.invocations(t); got != 2 {
		t.Fatalf("sidecar started %d times, want 2 (once per voice)", got)
	}
}

// Two clicks (or an alias and a voice switch back) can ask for the same file
// while the first render runs. They must share one render, not race each other's
// rename and cleanup.
func TestPreviewSharesOneRenderBetweenOverlappingRequests(t *testing.T) {
	rig := newPreviewRig(t, "slow-wav")
	results := make(chan error, 3)
	for range 3 {
		go func() {
			audio, err := rig.service.Preview("e1", nil, testVoice)
			if err == nil && len(audio) <= wavHeaderBytes {
				err = fmt.Errorf("got %d bytes", len(audio))
			}
			results <- err
		}()
	}
	for range 3 {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	if got := rig.invocations(t); got != 1 {
		t.Fatalf("sidecar started %d times for three overlapping requests, want 1", got)
	}
}

func TestPreviewDoesNotDeleteAValidCachedFileWhenACleanupRuns(t *testing.T) {
	rig := newPreviewRig(t, "wav")
	cached := filepath.Join(rig.audioDir(), previewFileName(testVoice, "Dawnspire"))
	if err := os.MkdirAll(rig.audioDir(), 0o755); err != nil {
		t.Fatal(err)
	}
	valid := append([]byte("RIFF"), make([]byte, 100)...)
	if err := os.WriteFile(cached, valid, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(cached+".4242.part", []byte("partial"), 0o600); err != nil {
		t.Fatal(err)
	}
	discardPreview(cached)
	if _, err := os.Stat(cached); err != nil {
		t.Fatalf("a valid cached preview was deleted: %v", err)
	}
	if _, err := os.Stat(cached + ".4242.part"); !os.IsNotExist(err) {
		t.Fatalf("the partial file was not removed: %v", err)
	}
}

func TestPreviewSpeaksTheAliasWhenOneIsRequested(t *testing.T) {
	rig := newPreviewRig(t, "wav")
	alias := 0
	if _, err := rig.service.Preview("e1", &alias, testVoice); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(rig.audioDir(), previewFileName(testVoice, "the Spire"))); err != nil {
		t.Fatalf("the alias preview must be cached under the alias text: %v", err)
	}
}

func TestPreviewReportsTheSidecarsReasonWithoutItsLogPrefix(t *testing.T) {
	rig := newPreviewRig(t, "fail")
	_, err := rig.service.Preview("e1", nil, testVoice)
	if err == nil {
		t.Fatal("expected an error")
	}
	if !strings.Contains(err.Error(), "could not be spoken") {
		t.Fatalf("error = %q, want the sidecar's reason", err)
	}
	if strings.Contains(err.Error(), "ERROR:") || strings.Contains(err.Error(), "loading the voice") {
		t.Fatalf("error = %q, want only the reason, not the log prefix or earlier log lines", err)
	}
}

func TestPreviewRejectsAnEmptyResultAndDoesNotKeepIt(t *testing.T) {
	for _, mode := range []string{"zero-byte", "no-file"} {
		t.Run(mode, func(t *testing.T) {
			rig := newPreviewRig(t, mode)
			_, err := rig.service.Preview("e1", nil, testVoice)
			if err == nil || !strings.Contains(err.Error(), "no audio") {
				t.Fatalf("error = %v, want a no-audio message", err)
			}
			if _, statErr := os.Stat(filepath.Join(rig.audioDir(), previewFileName(testVoice, "Dawnspire"))); !os.IsNotExist(statErr) {
				t.Fatalf("an empty preview must be removed, stat error = %v", statErr)
			}
		})
	}
}

func TestPreviewStopsAHungSidecarAndLeavesNoPartialFile(t *testing.T) {
	rig := newPreviewRig(t, "hang")
	rig.service.previewTimeout = 300 * time.Millisecond
	started := time.Now()
	_, err := rig.service.Preview("e1", nil, testVoice)
	if err == nil || !strings.Contains(err.Error(), "took longer than") {
		t.Fatalf("error = %v, want a timeout message", err)
	}
	if elapsed := time.Since(started); elapsed > 20*time.Second {
		t.Fatalf("Preview returned after %s; the timeout did not bound the hung sidecar", elapsed)
	}
	entries, _ := os.ReadDir(rig.audioDir())
	for _, entry := range entries {
		t.Fatalf("a timed-out preview left %q behind", entry.Name())
	}
}

func TestPreviewRejectsAMissingName(t *testing.T) {
	rig := newPreviewRig(t, "wav")
	if _, err := rig.service.Preview("no-such-entity", nil, testVoice); err == nil || !strings.Contains(err.Error(), "no longer exists") {
		t.Fatalf("error = %v", err)
	}
	if rig.invocations(t) != 0 {
		t.Fatal("no sidecar should start for a name that does not exist")
	}
}

func TestPreviewNamesTheHelperWhenItCannotStart(t *testing.T) {
	rig := newPreviewRig(t, "wav")
	rig.service.python = filepath.Join(rig.project, "does-not-exist.exe")
	_, err := rig.service.Preview("e1", nil, testVoice)
	if err == nil || !strings.Contains(err.Error(), "Manuscript Guide executable") {
		t.Fatalf("error = %v, want the configure-the-executable message", err)
	}
}
