package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"math"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// The Diagnostics view's job (diagnostics PRD Phase 6): the windowed analyzers of ADR 0158 over files the narrator picked
// for measuring, read-only, with real progress and a cancel, answering each file's summary and findings with the
// thresholds that raised them.

func waitForDiagnostics(t *testing.T, host *Host) DiagnosticsJob {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if job := host.diagnosticsState(); job.Phase != "running" {
			return job
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("the diagnostics did not end")
	return DiagnosticsJob{}
}

// writeClippedWAV is 4 s of 16-bit mono speech-level tone with a second of full-scale square wave in the middle.
func writeClippedWAV(t *testing.T, path string) {
	t.Helper()
	const rate, seconds = 16000, 4
	data := make([]byte, 44+rate*seconds*2)
	copy(data, "RIFF")
	binary.LittleEndian.PutUint32(data[4:], uint32(len(data)-8))
	copy(data[8:], "WAVEfmt ")
	for offset, value := range map[int]uint32{16: 16, 24: rate, 28: rate * 2} {
		binary.LittleEndian.PutUint32(data[offset:], value)
	}
	for offset, value := range map[int]uint16{20: 1, 22: 1, 32: 2, 34: 16} {
		binary.LittleEndian.PutUint16(data[offset:], value)
	}
	copy(data[36:], "data")
	binary.LittleEndian.PutUint32(data[40:], uint32(rate*seconds*2))
	for i := 0; i < rate*seconds; i++ {
		value := 0.25 * math.Sin(2*math.Pi*220*float64(i)/rate)
		if i >= rate*2 && i < rate*3 {
			value = 1
			if (i/40)%2 == 1 {
				value = -1
			}
		}
		binary.LittleEndian.PutUint16(data[44+i*2:], uint16(int16(math.Max(-32768, math.Round(value*32767)))))
	}
	writeFile(t, path, string(data))
}

func TestDiagnosticsStateIsIdleWithTheThresholdsItWouldUse(t *testing.T) {
	host, _ := measureHost(t)
	job := host.diagnosticsState()
	if job.Phase != "idle" || job.Kind != jobKindDiagnostics || job.ID != nil || job.SourceKind != nil || job.Files == nil || job.Logs == nil {
		t.Fatalf("idle job = %+v", job)
	}
	if job.Thresholds != measure.DefaultDiagnosticOptions() {
		t.Fatalf("thresholds = %+v, want the starting thresholds of ADR 0158", job.Thresholds)
	}
}

func TestDiagnosticsAnalyzeChecksEveryPickedFileAndAnswersItsFindings(t *testing.T) {
	dir := t.TempDir()
	clipped, clean, notWAV := filepath.Join(dir, "Chapter 01.wav"), filepath.Join(dir, "Chapter 02.wav"), filepath.Join(dir, "Chapter 03.mp3")
	writeClippedWAV(t, clipped)
	writeToneWAV(t, clean)
	writeFile(t, notWAV, "ID3\x04\x00 not audio this app reads")
	before := map[string]measure.Fingerprint{}
	for _, path := range []string{clipped, clean, notWAV} {
		fingerprint, err := measure.FingerprintFile(path)
		if err != nil {
			t.Fatal(err)
		}
		before[path] = fingerprint
	}
	host, ended := measureHost(t, clipped, clean, notWAV)

	started, err := host.startDiagnostics(pickAll(t, host), string(measure.SourceProcessedRender))
	if err != nil {
		t.Fatal(err)
	}
	if started.Phase != "running" || started.ID == nil || len(started.Files) != 3 || started.SourceKind == nil || *started.SourceKind != measure.SourceProcessedRender {
		t.Fatalf("started job = %+v", started)
	}
	job := waitForDiagnostics(t, host)

	if job.Phase != "success" || job.Percent != 100 || job.Message != "Checked 2 of 3 files; 1 could not be checked." {
		t.Fatalf("finished job = %s at %d%%: %q", job.Phase, job.Percent, job.Message)
	}
	found, quiet, failed := job.Files[0], job.Files[1], job.Files[2]
	if found.Status != "checked" || found.Summary == nil || found.Summary.ClipRegions == 0 || len(found.Findings) == 0 {
		t.Fatalf("clipped file = %+v", found)
	}
	clip := found.Findings[0]
	if clip.Evidence["kind"] != "clipping" || clip.Evidence["source_kind"] != measure.SourceProcessedRender || clip.TimeRange == nil {
		t.Fatalf("clip finding = %+v, want clipping in a render with its time range", clip)
	}
	if clip.TimeRange.Start < 1.9 || clip.TimeRange.End > 3.1 || clip.Review.Status != findings.StatusUnreviewed {
		t.Fatalf("clip finding = %+v, want the second of square wave, unreviewed", clip)
	}
	if found.Summary.Pacing.Status != measure.StatusUnavailable || found.Summary.WordsPerMinute != nil {
		t.Fatalf("pacing = %+v, want unavailable without a transcript", found.Summary.Pacing)
	}
	if quiet.Status != "checked" || quiet.Summary == nil || quiet.Findings == nil {
		t.Fatalf("the clean file = %+v, want checked with an empty list of findings", quiet)
	}
	if failed.Status != "failed" || failed.Summary != nil || !strings.Contains(failed.Error, "WAVE") || strings.Contains(failed.Error, dir) {
		t.Fatalf("an MP3 must fail with a named reason and no path: %+v", failed)
	}
	for path, fingerprint := range before {
		after, err := measure.FingerprintFile(path)
		if err != nil || after != fingerprint {
			t.Fatalf("%s changed while it was checked: %+v, then %+v (%v)", path, fingerprint, after, err)
		}
	}
	events := waitForEnded(t, ended)
	if events[0].Kind != jobKindDiagnostics || events[0].Outcome != jobOutcomeSuccess || events[0].Message != job.Message {
		t.Fatalf("job ended = %+v", events[0])
	}
}

func TestDiagnosticsAnalyzeRefusesWhatWasNotPickedAndAnUnknownSourceKind(t *testing.T) {
	dir := t.TempDir()
	picked := filepath.Join(dir, "a.wav")
	host, _ := measureHost(t, picked)
	pickAll(t, host)

	for name, call := range map[string]func() error{
		"no files": func() error { _, err := host.startDiagnostics(nil, "raw_recording"); return err },
		"a path never picked": func() error {
			_, err := host.startDiagnostics([]string{filepath.Join(dir, "b.wav")}, "raw_recording")
			return err
		},
		"a relative path": func() error { _, err := host.startDiagnostics([]string{"a.wav"}, "raw_recording"); return err },
		"no source kind":  func() error { _, err := host.startDiagnostics([]string{picked}, ""); return err },
		"an unknown kind": func() error { _, err := host.startDiagnostics([]string{picked}, "master"); return err },
	} {
		t.Run(name, func(t *testing.T) {
			if err := call(); err == nil {
				t.Fatal("was accepted")
			}
			if job := host.diagnosticsState(); job.Phase != "idle" {
				t.Fatalf("a refused start left a job: %+v", job)
			}
		})
	}
}

// blockingDiagnose stands in for measure.DiagnoseFile: it reports half the file read, then waits to be released or
// cancelled.
type blockingDiagnose struct {
	started chan string
	release chan struct{}
}

func newBlockingDiagnose() *blockingDiagnose {
	return &blockingDiagnose{started: make(chan string, 8), release: make(chan struct{})}
}

func (b *blockingDiagnose) diagnose(ctx context.Context, path string, in measure.DiagnosticInput) (measure.Diagnostics, error) {
	in.Progress(50, 100)
	b.started <- path
	select {
	case <-b.release:
		in.Progress(100, 100)
		return measure.Diagnostics{File: path, SourceKind: in.SourceKind, Options: in.Options, SampleRate: 48000, Channels: 2}, nil
	case <-ctx.Done():
		return measure.Diagnostics{}, ctx.Err()
	}
}

func TestDiagnosticsProgressIsTheBytesReadAcrossAllFiles(t *testing.T) {
	paths := equalSizedFiles(t, "a.wav", "b.wav")
	host, _ := measureHost(t, paths...)
	fake := newBlockingDiagnose()
	host.diagnoseFile = fake.diagnose
	if _, err := host.startDiagnostics(pickAll(t, host), "raw_recording"); err != nil {
		t.Fatal(err)
	}

	<-fake.started
	first := host.diagnosticsState()
	if first.Percent != 25 || first.Files[0].Status != "checking" || first.Files[1].Status != "pending" || first.Message != "Checking a.wav (1 of 2)." {
		t.Fatalf("half of the first of two equal files: %d%%, %q, %+v", first.Percent, first.Message, first.Files)
	}
	fake.release <- struct{}{}
	<-fake.started
	if second := host.diagnosticsState(); second.Percent != 75 || second.Files[0].Status != "checked" {
		t.Fatalf("half of the second file: %d%%, %+v", second.Percent, second.Files)
	}
	if _, err := host.startDiagnostics(paths, "raw_recording"); err == nil || !strings.Contains(err.Error(), "already running") {
		t.Fatalf("err = %v, want a second check refused", err)
	}
	if host.idle() {
		t.Fatal("the host reports idle while diagnostics run")
	}
	fake.release <- struct{}{}
	if job := waitForDiagnostics(t, host); job.Phase != "success" || job.Percent != 100 || job.Message != "Checked 2 files." {
		t.Fatalf("finished job = %+v", job)
	}
}

func TestDiagnosticsCancelStopsMidFileAndKeepsWhatWasChecked(t *testing.T) {
	paths := equalSizedFiles(t, "a.wav", "b.wav", "c.wav")
	host, ended := measureHost(t, paths...)
	fake := newBlockingDiagnose()
	host.diagnoseFile = fake.diagnose
	if _, err := host.startDiagnostics(pickAll(t, host), "raw_recording"); err != nil {
		t.Fatal(err)
	}
	<-fake.started
	fake.release <- struct{}{}
	<-fake.started

	if cancelling := host.cancelDiagnostics(); cancelling.Message != "Cancelling the diagnostics." {
		t.Fatalf("cancel answered %+v", cancelling)
	}
	job := waitForDiagnostics(t, host)
	if job.Phase != "cancelled" || job.Message != "Diagnostics cancelled. 1 of 3 files was checked." {
		t.Fatalf("cancelled job = %s: %q", job.Phase, job.Message)
	}
	statuses := []string{job.Files[0].Status, job.Files[1].Status, job.Files[2].Status}
	if strings.Join(statuses, ",") != "checked,cancelled,cancelled" || job.Files[0].Summary == nil {
		t.Fatalf("files = %+v", job.Files)
	}
	if events := waitForEnded(t, ended); events[0].Outcome != jobOutcomeCancelled {
		t.Fatalf("job ended = %+v", events[0])
	}
	if idle := host.cancelDiagnostics(); idle.Phase != "cancelled" {
		t.Fatalf("a second cancel changed the ended job: %+v", idle)
	}
}

func TestDiagnosticsReportsAPanicAsAnError(t *testing.T) {
	paths := equalSizedFiles(t, "a.wav", "b.wav")
	host, ended := measureHost(t, paths...)
	host.diagnoseFile = func(context.Context, string, measure.DiagnosticInput) (measure.Diagnostics, error) {
		panic("index out of range")
	}
	if _, err := host.startDiagnostics(pickAll(t, host), "processed_render"); err != nil {
		t.Fatal(err)
	}
	job := waitForDiagnostics(t, host)
	if job.Phase != "error" || !strings.Contains(job.Error, "index out of range") || job.Message != "The diagnostics stopped unexpectedly." {
		t.Fatalf("job = %+v", job)
	}
	if job.Files[0].Status != "failed" || job.Files[1].Status != "cancelled" {
		t.Fatalf("files = %+v", job.Files)
	}
	if events := waitForEnded(t, ended); events[0].Outcome != jobOutcomeError {
		t.Fatalf("job ended = %+v", events[0])
	}
}

func TestDiagnosticsBindingsAnswerJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), "a.wav")
	writeToneWAV(t, path)
	host, _ := measureHost(t, path)
	paths := pickAll(t, host)
	for name, call := range map[string]func() (string, error){
		"DiagnosticsAnalyze": func() (string, error) { return host.DiagnosticsAnalyze(paths, "raw_recording") },
		"DiagnosticsState":   host.DiagnosticsState,
		"DiagnosticsCancel":  host.DiagnosticsCancel,
	} {
		raw, err := call()
		var job DiagnosticsJob
		if err != nil || json.Unmarshal([]byte(raw), &job) != nil || job.Kind != jobKindDiagnostics {
			t.Fatalf("%s = %s (%v)", name, raw, err)
		}
	}
	waitForDiagnostics(t, host)
	if _, err := host.DiagnosticsAnalyze(nil, "raw_recording"); err == nil {
		t.Fatal("DiagnosticsAnalyze with no files was accepted")
	}
}
