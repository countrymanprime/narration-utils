package main

import (
	"encoding/json"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/recents"
)

// The stress test flips the project while goroutines call the read bindings.
// It only proves something under `go test -race` (CI runs that on both OSes;
// the Windows developer machine has no cgo, so locally it is a plain smoke
// test and hostguard_test.go is what protects the pattern). A binding that
// reads a service pointer without h.services() is reported by the detector the
// moment it is added to stressReaders, even though the two calls never overlap
// in time: nothing orders them.
//
// Add a binding here in the same change that converts it (see
// directReadAllowlist in hostguard_test.go). Keep one row per line, sorted.
const (
	stressSwitches = 40
	stressReads    = 300
	stressTimeout  = 2 * time.Minute
)

type stressReader struct {
	name string
	call func(host *Host)
}

var stressReaders = []stressReader{
	{"GuideBuildState", func(h *Host) { _, _ = h.GuideBuildState() }},
	{"ProjectRecents", func(h *Host) { _, _ = h.ProjectRecents() }},
	{"TeleprompterState", func(h *Host) { _, _ = h.TeleprompterState() }},
	{"TeleprompterStop", func(h *Host) { _, _ = h.TeleprompterStop() }},
	{"TracksDiscover", func(h *Host) { _, _ = h.TracksDiscover() }},
	{"TracksList", func(h *Host) { _, _ = h.TracksList() }},
	{"TracksSelect", func(h *Host) { _, _ = h.TracksSelect("not-a-project-file.rpp") }},
	{"TtsInstallState", func(h *Host) { _, _ = h.TtsInstallState("missing") }},
	{"WhisperInstallState", func(h *Host) { _, _ = h.WhisperInstallState("missing") }},
	{"emit callbacks", func(h *Host) {
		h.emitTranscript(emptyTranscript())
		h.emitTeleprompterState(map[string]any{"phase": "idle"})
		h.emitTeleprompterEvent(json.RawMessage(`{}`))
	}},
}

// newStressHost builds a host that can switch projects cheaply and without
// touching the per-user cache or recents file: explicit sidecar paths mean
// configureLocked never materializes embedded resources.
func newStressHost(t *testing.T) *Host {
	t.Helper()
	host := NewHost()
	host.recents = recents.New(filepath.Join(t.TempDir(), "recent-projects.json"))
	host.config.manuscriptPython = "unused-python"
	host.config.comparePython = "unused-python"
	host.config.teleprompterPython = "unused-python"
	host.mu.Lock()
	host.configureLocked(host.config)
	host.mu.Unlock()
	return host
}

func TestBindingsSurviveProjectSwitchesUnderLoad(t *testing.T) {
	host := newStressHost(t)
	projects := []string{t.TempDir(), t.TempDir()}

	start := make(chan struct{})
	var running sync.WaitGroup
	for _, reader := range stressReaders {
		running.Add(1)
		go func(reader stressReader) {
			defer running.Done()
			<-start
			for range stressReads {
				reader.call(host)
			}
		}(reader)
	}
	running.Add(1)
	go func() {
		defer running.Done()
		<-start
		for index := range stressSwitches {
			raw, err := host.ProjectSwitch(projects[index%len(projects)], "")
			if err != nil {
				t.Errorf("ProjectSwitch %d: %v", index, err)
				return
			}
			var result map[string]any
			if err := json.Unmarshal([]byte(raw), &result); err != nil || result["switched"] != true {
				t.Errorf("ProjectSwitch %d = %s (%v), want switched", index, raw, err)
				return
			}
		}
	}()

	finished := make(chan struct{})
	go func() {
		running.Wait()
		close(finished)
	}()
	close(start)
	select {
	case <-finished:
	case <-time.After(stressTimeout):
		t.Fatal("readers and project switches did not finish; a lock is held across a callback that needs it")
	}

	final := host.services().config.projectFolder
	if final != projects[(stressSwitches-1)%len(projects)] {
		t.Fatalf("final project = %q, want the last one switched to", final)
	}
}
