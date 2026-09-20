package main

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/recents"
)

// The stress test flips the project while goroutines call the read bindings.
// It only proves something under `go test -race` (CI's go job runs that on
// Windows; a developer machine without cgo runs it as a plain smoke test, and
// hostguard_test.go is what protects the pattern there). A binding that reads a
// service pointer without h.services() is reported by the detector the moment
// it is added to stressReaders, even though the two calls never overlap in
// time: nothing orders them.
//
// Add a binding here in the same change that converts it (see
// directReadAllowlist in hostguard_test.go). Keep one row per line.
// Rows for bindings that only read job maps or the set-once recents store
// (GuideBuildState, ProjectRecents, the install-state calls) are smoke tests
// for lock ordering; the rows that read a service pointer are the probes.
//
// Readers keep calling for as long as the switcher runs (and at least
// stressMinReads times), so every switch overlaps reads; a fixed count alone
// let a fast reader finish before the first switch and the detector missed the
// race in about 60% of runs on the unconverted code.
const (
	stressSwitches = 40
	stressMinReads = 100
	stressTimeout  = 2 * time.Minute
)

type stressReader struct {
	name string
	call func(host *Host)
}

var stressReaders = []stressReader{
	{"GuideBuildState", func(h *Host) { _, _ = h.GuideBuildState() }},
	{"GuideEntities", func(h *Host) { _, _ = h.GuideEntities() }},
	{"GuidePreview", func(h *Host) { _, _ = h.GuidePreview("missing", nil) }},
	{"ManuscriptChapters", func(h *Host) { _, _ = h.ManuscriptChapters() }},
	{"ManuscriptImportState", func(h *Host) { _, _ = h.ManuscriptImportState("missing") }},
	{"ManuscriptNotes", func(h *Host) { _, _ = h.ManuscriptNotes("missing") }},
	{"ManuscriptParagraphs", func(h *Host) { _, _ = h.ManuscriptParagraphs("missing") }},
	{"ManuscriptReader", func(h *Host) { _, _ = h.ManuscriptReader() }},
	{"ManuscriptReaderState", func(h *Host) { _, _ = h.ManuscriptReaderState() }},
	{"ManuscriptSearch", func(h *Host) { _, _ = h.ManuscriptSearch("word") }},
	{"ProjectRecents", func(h *Host) { _, _ = h.ProjectRecents() }},
	{"TeleprompterState", func(h *Host) { _, _ = h.TeleprompterState() }},
	{"TeleprompterStop", func(h *Host) { _, _ = h.TeleprompterStop() }},
	{"pollTranscript (one transcriptLoop tick)", func(h *Host) { h.pollTranscript() }},
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
// touching the per-user cache, settings or recents file: explicit sidecar paths
// mean configureLocked never materializes embedded resources.
func newStressHost(t *testing.T) *Host {
	t.Helper()
	// Point every per-user location at an empty temp directory, so the readers
	// see no installed voices or models and never touch the developer's data.
	home := t.TempDir()
	for _, name := range []string{"APPDATA", "LOCALAPPDATA", "USERPROFILE", "HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME"} {
		t.Setenv(name, home)
	}
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

	// Failures are collected, not reported with t.Errorf from the goroutines: on
	// a timeout the test returns while they may still be running, and a late
	// t.Errorf would panic.
	var failures []string
	var failuresMu sync.Mutex
	fail := func(format string, args ...any) {
		failuresMu.Lock()
		defer failuresMu.Unlock()
		failures = append(failures, fmt.Sprintf(format, args...))
	}

	start := make(chan struct{})
	var switching atomic.Bool
	switching.Store(true)
	var running sync.WaitGroup
	for _, reader := range stressReaders {
		running.Add(1)
		go func(reader stressReader) {
			defer running.Done()
			<-start
			for calls := 0; calls < stressMinReads || switching.Load(); calls++ {
				reader.call(host)
			}
		}(reader)
	}
	running.Add(1)
	go func() {
		defer running.Done()
		defer switching.Store(false)
		<-start
		for index := range stressSwitches {
			raw, err := host.ProjectSwitch(projects[index%len(projects)], "")
			if err != nil {
				fail("ProjectSwitch %d: %v", index, err)
				return
			}
			var result map[string]any
			if err := json.Unmarshal([]byte(raw), &result); err != nil || result["switched"] != true {
				fail("ProjectSwitch %d = %s (%v), want switched", index, raw, err)
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

	failuresMu.Lock()
	defer failuresMu.Unlock()
	for _, message := range failures {
		t.Error(message)
	}
	final := host.services().config.projectFolder
	if final != projects[(stressSwitches-1)%len(projects)] {
		t.Fatalf("final project = %q, want the last one switched to", final)
	}
}
