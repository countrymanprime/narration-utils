package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/assets"
	"github.com/countrymanprime/narration-utils/shell/internal/hostlog"
	"github.com/countrymanprime/narration-utils/shell/internal/tts"
	"github.com/countrymanprime/narration-utils/shell/internal/whisper"
)

// installFixture is a voice catalog of two files whose server answers only when the test lets it, so a test can look at a job between
// the first chunk and the last.
type installFixture struct {
	host    *Host
	server  *httptest.Server
	first   chan struct{} // closed when the server has sent half of file one
	release chan struct{} // the test closes it to let the rest flow
	logPath string
	bodies  map[string][]byte
}

func newInstallFixture(t *testing.T, corrupt bool) *installFixture {
	t.Helper()
	f := &installFixture{first: make(chan struct{}), release: make(chan struct{}), bodies: map[string][]byte{
		"/a.onnx":      []byte(strings.Repeat("a", 4000)),
		"/a.onnx.json": []byte(strings.Repeat("b", 1000)),
	}}
	var once sync.Once
	f.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := f.bodies[r.URL.Path]
		if corrupt {
			body = []byte(strings.Repeat("z", len(body)))
		}
		_, _ = w.Write(body[:len(body)/2])
		w.(http.Flusher).Flush()
		if r.URL.Path == "/a.onnx" {
			once.Do(func() { close(f.first) })
		}
		select {
		case <-f.release:
		case <-r.Context().Done():
			return
		}
		_, _ = w.Write(body[len(body)/2:])
	}))
	t.Cleanup(f.server.Close)
	files := []map[string]any{}
	for _, name := range []string{"/a.onnx", "/a.onnx.json"} {
		sum := sha256.Sum256(f.bodies[name])
		files = append(files, map[string]any{"name": name[1:], "url": f.server.URL + name, "sha256": hex.EncodeToString(sum[:]), "size": len(f.bodies[name])})
	}
	dir := t.TempDir()
	voices := map[string]any{"catalogVersion": 1, "voices": []map[string]any{{"id": "v1", "provider": "piper", "displayName": "V", "version": "1", "files": files}}}
	models := map[string]any{"catalogVersion": 1, "models": []map[string]any{{"id": "m1", "provider": "faster-whisper", "displayName": "M", "version": "1", "files": files}}}
	voiceManager, err := tts.New(writeJSON(t, filepath.Join(dir, "tts.json"), voices), filepath.Join(dir, "cache", "tts"))
	if err != nil {
		t.Fatal(err)
	}
	modelManager, err := whisper.New(writeJSON(t, filepath.Join(dir, "whisper.json"), models), filepath.Join(dir, "cache", "whisper"))
	if err != nil {
		t.Fatal(err)
	}
	f.logPath = filepath.Join(dir, "host.log")
	f.host = &Host{assets: newAssetRegistry(filepath.Join(dir, "cache"), voiceManager, modelManager, nil, nil), installJobs: map[string]*installJob{}, log: hostlog.New(f.logPath, 0)}
	return f
}

func writeJSON(t *testing.T, path string, value any) string {
	t.Helper()
	bytes, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, bytes, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func voiceState(f *installFixture, id string) func() map[string]any {
	return func() map[string]any { s, _ := f.host.ttsInstallState(id); return s }
}

func waitForPhase(t *testing.T, poll func() map[string]any, want string) map[string]any {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		if snapshot := poll(); snapshot["phase"] == want {
			return snapshot
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("the job never reached %q, last %v", want, poll())
	return nil
}

func TestAVoiceInstallReportsTheRealBytesAcrossEveryFileAndEndsAtTheTotal(t *testing.T) {
	f := newInstallFixture(t, false)
	started, err := f.host.startTtsInstall("v1")
	if err != nil {
		t.Fatal(err)
	}
	if started["phase"] != "downloading" || started["bytesTotal"] != int64(5000) || started["bytesDone"] != int64(0) || started["percent"] != 0 || started["error"] != "" {
		t.Fatalf("started = %#v, want downloading with 0 of 5000 bytes", started)
	}
	<-f.first
	poll := voiceState(f, started["id"].(string))
	mid := poll()
	for range 400 { // half of file one has arrived: the bytes are real and below the total
		if mid["bytesDone"].(int64) > 0 {
			break
		}
		time.Sleep(5 * time.Millisecond)
		mid = poll()
	}
	if done := mid["bytesDone"].(int64); done <= 0 || done >= 5000 || mid["percent"].(int) <= 0 || mid["percent"].(int) >= 100 {
		t.Fatalf("mid = %#v, want a real share of the 5000 bytes", mid)
	}
	close(f.release)
	final := waitForPhase(t, poll, "success")
	if final["bytesDone"] != int64(5000) || final["percent"] != 100 || final["error"] != "" {
		t.Fatalf("final = %#v, want all 5000 bytes and 100 percent", final)
	}
}

func TestAnInstallNeverReportsFewerBytesThanItDidBefore(t *testing.T) {
	f := newInstallFixture(t, false)
	started, _ := f.host.startTtsInstall("v1")
	poll := voiceState(f, started["id"].(string))
	close(f.release)
	var last int64
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		snapshot := poll()
		done := snapshot["bytesDone"].(int64)
		if done < last {
			t.Fatalf("bytes went from %d back to %d", last, done)
		}
		last = done
		if snapshot["phase"] == "success" {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("never finished")
}

// A second press (or a second window) for the voice that is already downloading joins that download; it starts no second one.
func TestStartingTheSameInstallTwiceJoinsTheRunningJob(t *testing.T) {
	f := newInstallFixture(t, false)
	first, err := f.host.startTtsInstall("v1")
	if err != nil {
		t.Fatal(err)
	}
	second, err := f.host.startTtsInstall("v1")
	if err != nil {
		t.Fatal(err)
	}
	if first["id"] != second["id"] {
		t.Fatalf("second start made job %v, want the running %v", second["id"], first["id"])
	}
	if len(f.host.installJobs) != 1 {
		t.Fatalf("%d jobs, want 1", len(f.host.installJobs))
	}
	close(f.release)
	waitForPhase(t, voiceState(f, first["id"].(string)), "success")
	third, err := f.host.startTtsInstall("v1")
	if err != nil {
		t.Fatal(err)
	}
	if third["id"] == first["id"] {
		t.Fatal("a finished install is not joined: a later start is a new job")
	}
	// The new job has nothing to fetch (the voice is installed) but it is still a goroutine: let it end before the temporary folder goes.
	waitForPhase(t, voiceState(f, third["id"].(string)), "success")
}

func TestAWhisperInstallUsesTheSameVocabularyAsAVoiceInstall(t *testing.T) {
	f := newInstallFixture(t, false)
	started, err := f.host.startWhisperInstall("m1")
	if err != nil {
		t.Fatal(err)
	}
	if started["phase"] != "downloading" || started["modelId"] != "m1" || started["bytesTotal"] != int64(5000) || started["error"] != "" {
		t.Fatalf("started = %#v, want the voice's shape with a modelId", started)
	}
	close(f.release)
	waitForPhase(t, func() map[string]any { s, _ := f.host.whisperInstallState(started["id"].(string)); return s }, "success")
}

func TestACancelledInstallSaysSoAndLeavesNothingInstalled(t *testing.T) {
	f := newInstallFixture(t, false)
	started, _ := f.host.startTtsInstall("v1")
	<-f.first
	if _, err := f.host.cancelTtsInstall(started["id"].(string)); err != nil {
		t.Fatal(err)
	}
	final := waitForPhase(t, voiceState(f, started["id"].(string)), "cancelled")
	if final["message"] != "Voice download cancelled." || final["error"] != "" {
		t.Fatalf("final = %#v", final)
	}
	voice, _ := f.host.registry().tts.Voice("v1")
	if state := f.host.registry().tts.State(voice); state != "not_installed" {
		t.Fatalf("state after a cancel = %s", state)
	}
}

// The narrator reads a sentence; the log keeps what actually happened (an address, a socket error).
func TestAFailedInstallGivesTheNarratorASentenceAndTheLogTheCause(t *testing.T) {
	f := newInstallFixture(t, true)
	started, _ := f.host.startTtsInstall("v1")
	close(f.release)
	final := waitForPhase(t, voiceState(f, started["id"].(string)), "error")
	text, _ := final["error"].(string)
	if !strings.Contains(text, "did not match") || strings.Contains(text, "127.0.0.1") || strings.Contains(text, "checksum mismatch") {
		t.Fatalf("error = %q, want a sentence about the checksum and no raw text", text)
	}
	if final["message"] != text {
		t.Fatalf("message %q and error %q should agree on a failure", final["message"], text)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if bytes, _ := os.ReadFile(f.logPath); strings.Contains(string(bytes), "install_failed") && strings.Contains(string(bytes), "asset checksum mismatch") {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("the host log does not hold the cause of the failure")
}

func TestARunningInstallBlocksAProjectAttachUntilItEnds(t *testing.T) {
	host := &Host{installJobs: map[string]*installJob{"tts-1": {id: "tts-1", kind: installKindTts, assetID: "v", phase: installPhaseDownloading}}}
	if host.canAttachLocked() {
		t.Fatal("a project attach must wait for a download")
	}
	host.installJobs["tts-1"].phase = installPhaseVerifying
	if host.canAttachLocked() {
		t.Fatal("a download that is checking its files is still running")
	}
	host.installJobs["tts-1"].phase = "success"
	if !host.canAttachLocked() {
		t.Fatal("a finished download must not block an attach")
	}
}

// The message follows the phase: a file that follows a checked one is being downloaded, and the job says so.
func TestAnInstallGoesBackToDownloadingWhenTheNextFileStarts(t *testing.T) {
	job := &installJob{phase: installPhaseDownloading, message: "Downloading the voice…", downloadingText: "Downloading the voice…", total: 10, received: map[string]int64{}}
	job.record(assets.File{Name: "a"}, 5)
	job.checking("voice")
	if job.phase != installPhaseVerifying || !strings.Contains(job.message, "Checking") {
		t.Fatalf("after a check: %s %q", job.phase, job.message)
	}
	job.record(assets.File{Name: "b"}, 1)
	if job.phase != installPhaseDownloading || job.message != "Downloading the voice…" {
		t.Fatalf("the next file: %s %q", job.phase, job.message)
	}
	if job.done != 6 {
		t.Fatalf("done = %d, want 6 (5 of the first file and 1 of the second)", job.done)
	}
}

// A start that arrives while a cancelled download is still winding down waits for it and then starts a new job of its own.
func TestStartingAgainAfterACancelStartsANewDownload(t *testing.T) {
	f := newInstallFixture(t, false)
	first, _ := f.host.startTtsInstall("v1")
	<-f.first
	if _, err := f.host.cancelTtsInstall(first["id"].(string)); err != nil {
		t.Fatal(err)
	}
	second, err := f.host.startTtsInstall("v1")
	if err != nil {
		t.Fatal(err)
	}
	if second["id"] == first["id"] || second["phase"] != "downloading" {
		t.Fatalf("second = %#v, want a new running job", second)
	}
	close(f.release)
	waitForPhase(t, voiceState(f, second["id"].(string)), "success")
	if final := voiceState(f, first["id"].(string))(); final["phase"] != "cancelled" {
		t.Fatalf("the first job ended %v, want cancelled", final["phase"])
	}
}

// What a narrator reads for each way an install can fail: what happened and what to do, never an address or a socket error.
func TestInstallFailureTextSaysWhatHappenedAndWhatToDo(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want string
	}{
		{"a file that is not the approved one", assets.ErrChecksumMismatch, "did not match the approved file"},
		{"a size that is not the approved one", assets.ErrSizeMismatch, "did not match the approved file"},
		{"a disk that cannot hold it", &assets.InsufficientSpaceError{Need: 3 << 30, Free: 1 << 30}, "not enough free space"},
		{"a host that no longer has the file", &assets.StatusError{Code: 404, Status: "404 Not Found"}, "no longer has"},
		{"a host that is busy", &assets.StatusError{Code: 429, Status: "429 Too Many Requests"}, "busy"},
		{"a host that is down", &assets.StatusError{Code: 503, Status: "503 Service Unavailable"}, "busy"},
		{"a connection that dropped", assets.ErrIncomplete, "internet connection"},
		{"no network at all", errors.New(`Get "https://huggingface.co/x": dial tcp: lookup huggingface.co: no such host`), "internet connection"},
	}
	for _, c := range cases {
		text := installFailureText(c.err, "voice")
		if !strings.Contains(text, c.want) {
			t.Errorf("%s: %q does not say %q", c.name, text, c.want)
		}
		if strings.Contains(text, "huggingface") || strings.Contains(text, "dial tcp") || strings.Contains(text, "404 Not Found") {
			t.Errorf("%s: %q leaks the technical text", c.name, text)
		}
	}
}
