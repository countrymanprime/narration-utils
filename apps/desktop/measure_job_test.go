package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// measureHost is a host whose file picker answers paths, recording every job end.
func measureHost(t *testing.T, paths ...string) (*Host, func() []jobEnded) {
	t.Helper()
	host := NewHost()
	host.pickAudioFiles = func() ([]string, error) { return paths, nil }
	var mu sync.Mutex
	ended := []jobEnded{}
	host.jobEvents = func(event jobEnded) {
		mu.Lock()
		defer mu.Unlock()
		ended = append(ended, event)
	}
	return host, func() []jobEnded {
		mu.Lock()
		defer mu.Unlock()
		return append([]jobEnded(nil), ended...)
	}
}

func pickAll(t *testing.T, host *Host) []string {
	t.Helper()
	picked, err := host.pickMeasureFiles()
	if err != nil {
		t.Fatal(err)
	}
	return picked.Paths
}

func waitForMeasurement(t *testing.T, host *Host) MeasureJob {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if job := host.measureState(); job.Phase != "running" {
			return job
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("the measurement did not end")
	return MeasureJob{}
}

func TestMeasureStateIsIdleBeforeAnyMeasurement(t *testing.T) {
	host, _ := measureHost(t)
	job := host.measureState()
	if job.Phase != "idle" || job.Kind != jobKindMeasurement || job.ID != nil || len(job.Files) != 0 || job.Logs == nil || job.Files == nil {
		t.Fatalf("idle job = %+v", job)
	}
}

func TestMeasurePickFilesAnswersThePickedPathsAndNothingWhenCancelled(t *testing.T) {
	dir := t.TempDir()
	a, b := filepath.Join(dir, "a.wav"), filepath.Join(dir, "b.wav")
	host, _ := measureHost(t, a, "", b)
	if got := pickAll(t, host); len(got) != 2 || got[0] != a || got[1] != b {
		t.Fatalf("picked = %v, want [%s %s]", got, a, b)
	}
	host.pickAudioFiles = func() ([]string, error) { return nil, nil }
	if got := pickAll(t, host); got == nil || len(got) != 0 {
		t.Fatalf("a cancelled picker answered %#v, want an empty list", got)
	}
	host.pickAudioFiles = func() ([]string, error) { return nil, errors.New("dialog failed") }
	if _, err := host.pickMeasureFiles(); err == nil {
		t.Fatal("a failed dialog was not reported")
	}
}

func TestMeasurePickFilesNeedsAWindowWithoutTheSeam(t *testing.T) {
	host := NewHost()
	if _, err := host.MeasurePickFiles(); err == nil || !strings.Contains(err.Error(), "not ready") {
		t.Fatalf("err = %v, want the host not ready", err)
	}
}

func TestMeasureAnalyzeMeasuresEveryPickedFileWithItsFingerprint(t *testing.T) {
	dir := t.TempDir()
	tone, silent, notWAV := filepath.Join(dir, "Chapter 01.wav"), filepath.Join(dir, "Chapter 02.wav"), filepath.Join(dir, "Chapter 03.mp3")
	writeToneWAV(t, tone)
	writeFile(t, silent, string(silentWAV(8000)))
	writeFile(t, notWAV, "ID3\x04\x00 not audio this app reads")
	before := map[string]measure.Fingerprint{}
	for _, path := range []string{tone, silent, notWAV} {
		fingerprint, err := measure.FingerprintFile(path)
		if err != nil {
			t.Fatal(err)
		}
		before[path] = fingerprint
	}
	host, ended := measureHost(t, tone, silent, notWAV)

	started, err := host.startMeasure(pickAll(t, host))
	if err != nil {
		t.Fatal(err)
	}
	if started.Phase != "running" || started.ID == nil || len(started.Files) != 3 {
		t.Fatalf("started job = %+v", started)
	}
	job := waitForMeasurement(t, host)

	if job.Phase != "success" || job.Percent != 100 {
		t.Fatalf("finished job = %s at %d%%: %s", job.Phase, job.Percent, job.Message)
	}
	if job.Message != "Measured 2 of 3 files; 1 could not be measured." {
		t.Fatalf("message = %q", job.Message)
	}
	measured, unavailable, failed := job.Files[0], job.Files[1], job.Files[2]
	if measured.Status != "measured" || measured.Name != "Chapter 01.wav" || measured.Report == nil || measured.Report.IntegratedLUFS == nil {
		t.Fatalf("tone result = %+v", measured)
	}
	if *measured.Fingerprint != before[tone] {
		t.Fatalf("fingerprint = %+v, want %+v", *measured.Fingerprint, before[tone])
	}
	if unavailable.Status != "measured" || unavailable.Report.IntegratedLUFS != nil || unavailable.Report.RMSdBFS != nil {
		t.Fatalf("silence must be measured as unavailable, not a number: %+v", unavailable.Report)
	}
	// An MP3 is read for its container (delivery profiles PRD Phase 6); this one is a tag with nothing after it.
	if failed.Status != "failed" || failed.Report != nil || failed.Fingerprint != nil || !strings.Contains(failed.Error, "ID3v2 tag") {
		t.Fatalf("a broken MP3 must fail with a named reason: %+v", failed)
	}
	for path, fingerprint := range before {
		after, err := measure.FingerprintFile(path)
		if err != nil || after != fingerprint {
			t.Fatalf("%s changed while it was measured: %+v, then %+v (%v)", path, fingerprint, after, err)
		}
	}
	events := waitForEnded(t, ended)
	if events[0].Kind != jobKindMeasurement || events[0].Outcome != jobOutcomeSuccess || events[0].ID != *job.ID || events[0].Message != job.Message {
		t.Fatalf("job ended = %+v", events[0])
	}
}

func waitForEnded(t *testing.T, ended func() []jobEnded) []jobEnded {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if got := ended(); len(got) > 0 {
			return got
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("no job:ended event")
	return nil
}

// silentWAV is two seconds of 16-bit mono digital silence.
func silentWAV(rate int) []byte {
	raw := make([]byte, 44+rate*2*2)
	copy(raw, "RIFF")
	putLE32(raw[4:], uint32(len(raw)-8))
	copy(raw[8:], "WAVEfmt ")
	putLE32(raw[16:], 16)
	putLE16(raw[20:], 1)
	putLE16(raw[22:], 1)
	putLE32(raw[24:], uint32(rate))
	putLE32(raw[28:], uint32(rate*2))
	putLE16(raw[32:], 2)
	putLE16(raw[34:], 16)
	copy(raw[36:], "data")
	putLE32(raw[40:], uint32(rate*2*2))
	return raw
}

func putLE32(b []byte, v uint32) {
	b[0], b[1], b[2], b[3] = byte(v), byte(v>>8), byte(v>>16), byte(v>>24)
}
func putLE16(b []byte, v uint16) { b[0], b[1] = byte(v), byte(v>>8) }

func TestMeasureAnalyzeRefusesWhatWasNotPicked(t *testing.T) {
	dir := t.TempDir()
	picked := filepath.Join(dir, "a.wav")
	host, _ := measureHost(t, picked)
	pickAll(t, host)

	for name, paths := range map[string][]string{
		"no files":            nil,
		"a path never picked": {picked, filepath.Join(dir, "secret.wav")},
		"a relative path":     {"a.wav"},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := host.startMeasure(paths); err == nil {
				t.Fatalf("startMeasure(%v) was accepted", paths)
			}
			if job := host.measureState(); job.Phase != "idle" {
				t.Fatalf("a refused start left a job: %+v", job)
			}
		})
	}
}

func TestMeasureAnalyzeRefusesTooManyFiles(t *testing.T) {
	dir := t.TempDir()
	paths := make([]string, maxMeasureFiles+1)
	for i := range paths {
		paths[i] = filepath.Join(dir, fmt.Sprintf("chapter-%03d.wav", i))
	}
	host, _ := measureHost(t, paths...)
	if _, err := host.startMeasure(pickAll(t, host)); err == nil || !strings.Contains(err.Error(), "at most") {
		t.Fatalf("err = %v, want too many files refused", err)
	}
}

func TestMeasureAnalyzeMeasuresARepeatedPathOnce(t *testing.T) {
	path := filepath.Join(t.TempDir(), "a.wav")
	writeToneWAV(t, path)
	host, _ := measureHost(t, path)
	pickAll(t, host)
	started, err := host.startMeasure([]string{path, path, filepath.Join(filepath.Dir(path), ".", "a.wav")})
	if err != nil {
		t.Fatal(err)
	}
	if len(started.Files) != 1 {
		t.Fatalf("files = %+v, want the one path once", started.Files)
	}
	waitForMeasurement(t, host)
}

// blockingMeasure stands in for measure.MeasureFile: it reports half the file read, then waits to be released or
// cancelled.
type blockingMeasure struct {
	started chan string
	release chan struct{}
}

func newBlockingMeasure() *blockingMeasure {
	return &blockingMeasure{started: make(chan string, 8), release: make(chan struct{})}
}

func (b *blockingMeasure) measure(ctx context.Context, path string, opts measure.Options) (measure.FileMeasurement, error) {
	opts.Progress(50, 100)
	b.started <- path
	select {
	case <-b.release:
		opts.Progress(100, 100)
		return measure.FileMeasurement{Report: measure.Report{File: path, SampleRate: 48000, Channels: 2}}, nil
	case <-ctx.Done():
		return measure.FileMeasurement{}, ctx.Err()
	}
}

func equalSizedFiles(t *testing.T, names ...string) []string {
	t.Helper()
	dir := t.TempDir()
	paths := make([]string, len(names))
	for i, name := range names {
		paths[i] = filepath.Join(dir, name)
		writeFile(t, paths[i], strings.Repeat("x", 1000))
	}
	return paths
}

func TestMeasureProgressIsTheBytesReadAcrossAllFiles(t *testing.T) {
	paths := equalSizedFiles(t, "a.wav", "b.wav")
	host, _ := measureHost(t, paths...)
	fake := newBlockingMeasure()
	host.measureFile = fake.measure
	if _, err := host.startMeasure(pickAll(t, host)); err != nil {
		t.Fatal(err)
	}

	<-fake.started
	first := host.measureState()
	if first.Percent != 25 || first.Files[0].Status != "measuring" || first.Files[1].Status != "pending" {
		t.Fatalf("half of the first of two equal files: %d%%, %+v", first.Percent, first.Files)
	}
	if first.Message != "Measuring a.wav (1 of 2)." {
		t.Fatalf("message = %q", first.Message)
	}
	fake.release <- struct{}{}
	<-fake.started
	if second := host.measureState(); second.Percent != 75 || second.Files[0].Status != "measured" {
		t.Fatalf("half of the second file: %d%%, %+v", second.Percent, second.Files)
	}
	fake.release <- struct{}{}
	if job := waitForMeasurement(t, host); job.Phase != "success" || job.Percent != 100 || job.Message != "Measured 2 files." {
		t.Fatalf("finished job = %+v", job)
	}
}

func TestMeasureAnalyzeRefusesASecondStartWhileOneRuns(t *testing.T) {
	paths := equalSizedFiles(t, "a.wav")
	host, _ := measureHost(t, paths...)
	fake := newBlockingMeasure()
	host.measureFile = fake.measure
	if _, err := host.startMeasure(pickAll(t, host)); err != nil {
		t.Fatal(err)
	}
	<-fake.started
	if _, err := host.startMeasure(paths); err == nil || !strings.Contains(err.Error(), "already running") {
		t.Fatalf("err = %v, want a second measurement refused", err)
	}
	if host.idle() {
		t.Fatal("the host reports idle while a measurement runs, so a project switch or an update install could displace it")
	}
	fake.release <- struct{}{}
	waitForMeasurement(t, host)
	if !host.idle() {
		t.Fatal("the host is not idle after the measurement ended")
	}
}

func TestMeasureCancelStopsMidFileAndKeepsWhatWasMeasured(t *testing.T) {
	paths := equalSizedFiles(t, "a.wav", "b.wav", "c.wav")
	host, ended := measureHost(t, paths...)
	fake := newBlockingMeasure()
	host.measureFile = fake.measure
	if _, err := host.startMeasure(pickAll(t, host)); err != nil {
		t.Fatal(err)
	}
	<-fake.started
	fake.release <- struct{}{}
	<-fake.started

	if cancelling := host.cancelMeasure(); cancelling.Message != "Cancelling the measurement." {
		t.Fatalf("cancel answered %+v", cancelling)
	}
	job := waitForMeasurement(t, host)

	if job.Phase != "cancelled" || job.Message != "Measurement cancelled. 1 of 3 files was measured." || job.Percent != 50 {
		t.Fatalf("cancelled job = %s at %d%%: %q", job.Phase, job.Percent, job.Message)
	}
	statuses := []string{job.Files[0].Status, job.Files[1].Status, job.Files[2].Status}
	if strings.Join(statuses, ",") != "measured,cancelled,cancelled" {
		t.Fatalf("statuses = %v", statuses)
	}
	if job.Files[0].Report == nil {
		t.Fatal("the file measured before the cancel lost its report")
	}
	if events := waitForEnded(t, ended); events[0].Outcome != jobOutcomeCancelled {
		t.Fatalf("job ended = %+v", events[0])
	}
}

func TestMeasureCancelWithNothingRunningChangesNothing(t *testing.T) {
	host, _ := measureHost(t)
	if job := host.cancelMeasure(); job.Phase != "idle" {
		t.Fatalf("cancel with nothing running = %+v", job)
	}
}

func TestMeasureReportsAPanicAsAnError(t *testing.T) {
	paths := equalSizedFiles(t, "a.wav", "b.wav")
	host, ended := measureHost(t, paths...)
	host.measureFile = func(context.Context, string, measure.Options) (measure.FileMeasurement, error) {
		panic("index out of range")
	}
	if _, err := host.startMeasure(pickAll(t, host)); err != nil {
		t.Fatal(err)
	}
	job := waitForMeasurement(t, host)
	if job.Phase != "error" || !strings.Contains(job.Error, "index out of range") || job.Message != "The measurement stopped unexpectedly." {
		t.Fatalf("job = %+v", job)
	}
	broke, untouched := job.Files[0], job.Files[1]
	if broke.Status != "failed" || !strings.Contains(broke.Error, "index out of range") {
		t.Fatalf("the file that broke the measurement = %+v, want failed with the reason", broke)
	}
	if untouched.Status != "cancelled" || untouched.Error != "" {
		t.Fatalf("the file never reached = %+v, want cancelled", untouched)
	}
	if events := waitForEnded(t, ended); events[0].Outcome != jobOutcomeError {
		t.Fatalf("job ended = %+v", events[0])
	}
}

func TestMeasureBindingsAnswerJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), "a.wav")
	writeToneWAV(t, path)
	host, _ := measureHost(t, path)
	raw, err := host.MeasurePickFiles()
	if err != nil {
		t.Fatal(err)
	}
	var picked MeasurePickResult
	if err := json.Unmarshal([]byte(raw), &picked); err != nil || len(picked.Paths) != 1 {
		t.Fatalf("MeasurePickFiles = %s (%v)", raw, err)
	}
	for name, call := range map[string]func() (string, error){
		"MeasureAnalyze": func() (string, error) { return host.MeasureAnalyze(picked.Paths) },
		"MeasureState":   host.MeasureState,
		"MeasureCancel":  host.MeasureCancel,
	} {
		raw, err := call()
		var job MeasureJob
		if err != nil || json.Unmarshal([]byte(raw), &job) != nil || job.Kind != jobKindMeasurement {
			t.Fatalf("%s = %s (%v)", name, raw, err)
		}
	}
	waitForMeasurement(t, host)
	if _, err := host.MeasureAnalyze(nil); err == nil {
		t.Fatal("MeasureAnalyze with no files was accepted")
	}
}

func TestMeasureStartsFromAFileThatVanishedAfterItWasPicked(t *testing.T) {
	path := filepath.Join(t.TempDir(), "gone.wav")
	host, _ := measureHost(t, path)
	if _, err := host.startMeasure(pickAll(t, host)); err != nil {
		t.Fatal(err)
	}
	job := waitForMeasurement(t, host)
	if job.Phase != "success" || job.Percent != 100 || job.Files[0].Status != "failed" || job.Message != "The file could not be measured." {
		t.Fatalf("job = %+v", job)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("measuring created the file")
	}
}
