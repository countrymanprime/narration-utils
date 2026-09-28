package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/encodeport"
	"github.com/countrymanprime/narration-utils/shell/internal/mastering"
	"github.com/countrymanprime/narration-utils/shell/internal/packager"
)

// renderExportHost is a host whose export picker answers paths, with a project folder, recording every job end.
func renderExportHost(t *testing.T, paths ...string) (*Host, func() []jobEnded) {
	t.Helper()
	host := NewHost()
	host.config.projectFolder = t.TempDir()
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

func writeFixtureFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

// fakeMaster answers a mastering.Result and, like the real chain, writes req.Destination - never req.Source.
func fakeMaster(t *testing.T) masterFileFunc {
	return func(_ context.Context, req mastering.Request, opts mastering.Options) (mastering.Result, error) {
		if req.Source == req.Destination {
			t.Fatalf("mastering asked to write over its own source %q", req.Source)
		}
		writeFixtureFile(t, req.Destination, "mastered "+req.Source)
		if opts.Progress != nil {
			opts.Progress(1, 1)
		}
		return mastering.Result{Source: req.Source, Destination: req.Destination}, nil
	}
}

// fakeEncode answers success and, like the real encoders, writes dst - never wav.
func fakeEncode(t *testing.T) encodeFileFunc {
	return func(_ context.Context, wav, dst string, spec encodeport.Spec) error {
		if wav == dst {
			t.Fatalf("encode asked to write over its own source %q", wav)
		}
		writeFixtureFile(t, dst, "encoded "+spec.Format+" "+wav)
		if spec.Progress != nil {
			spec.Progress(time.Second, time.Second)
		}
		return nil
	}
}

func pickAllExport(t *testing.T, host *Host) []string {
	t.Helper()
	picked, err := host.pickExportFiles()
	if err != nil {
		t.Fatal(err)
	}
	return picked.Paths
}

func TestExportRefusesAPathThatWasNotPicked(t *testing.T) {
	host, _ := renderExportHost(t)
	_, err := host.startExport(ExportRequest{Items: []ExportItem{{Kind: string(packager.KindChapter), Title: "01", Path: "C:/not-picked.wav"}}})
	if err == nil || !strings.Contains(err.Error(), "not chosen") {
		t.Fatalf("expected a not-chosen refusal, got %v", err)
	}
}

func TestExportRefusesWithNoItems(t *testing.T) {
	host, _ := renderExportHost(t)
	_, err := host.startExport(ExportRequest{})
	if err == nil || !strings.Contains(err.Error(), "at least one file") {
		t.Fatalf("expected an empty-request refusal, got %v", err)
	}
}

func TestExportRefusesAChapterWithNoTitle(t *testing.T) {
	source := filepath.Join(t.TempDir(), "ch1.wav")
	writeFixtureFile(t, source, "wav")
	host, _ := renderExportHost(t, source)
	pickAllExport(t, host)
	_, err := host.startExport(ExportRequest{Items: []ExportItem{{Kind: string(packager.KindChapter), Path: source}}})
	if err == nil || !strings.Contains(err.Error(), "no chapter title") {
		t.Fatalf("expected a no-title refusal, got %v", err)
	}
}

func TestExportEncodesWithoutMasteringWhenMasterIsOff(t *testing.T) {
	source := filepath.Join(t.TempDir(), "ch1.wav")
	writeFixtureFile(t, source, "wav")
	host, ended := renderExportHost(t, source)
	pickAllExport(t, host)
	host.encodeFile = fakeEncode(t)
	host.masterFile = func(context.Context, mastering.Request, mastering.Options) (mastering.Result, error) {
		t.Fatal("mastering should not run when Master is false")
		return mastering.Result{}, nil
	}

	job, err := host.startExport(ExportRequest{Items: []ExportItem{{Kind: string(packager.KindChapter), Title: "01", Path: source}}})
	if err != nil {
		t.Fatal(err)
	}
	if job.Phase != "running" {
		t.Fatalf("expected running, got %q", job.Phase)
	}
	job = waitExport(t, host)
	if job.Phase != "success" {
		t.Fatalf("expected success, got %q (%s)", job.Phase, job.Message)
	}
	if job.Files[0].MasteredPath != "" {
		t.Fatalf("expected no mastered path, got %q", job.Files[0].MasteredPath)
	}
	if job.Files[0].EncodedPath == "" || job.Files[0].Status != exportFileDone {
		t.Fatalf("expected an encoded, done file, got %+v", job.Files[0])
	}
	if got := readFile(t, job.Files[0].EncodedPath); got != "encoded mp3 "+source {
		t.Fatalf("unexpected encoded content: %q", got)
	}
	assertOneSuccess(t, ended)
}

func TestExportMastersThenEncodesWhenMasterIsOn(t *testing.T) {
	source := filepath.Join(t.TempDir(), "ch1.wav")
	writeFixtureFile(t, source, "wav")
	host, _ := renderExportHost(t, source)
	pickAllExport(t, host)
	host.masterFile = fakeMaster(t)
	host.encodeFile = fakeEncode(t)

	if _, err := host.startExport(ExportRequest{Master: true, Items: []ExportItem{{Kind: string(packager.KindChapter), Title: "01", Path: source}}}); err != nil {
		t.Fatal(err)
	}
	job := waitExport(t, host)
	if job.Phase != "success" {
		t.Fatalf("expected success, got %q (%s)", job.Phase, job.Message)
	}
	file := job.Files[0]
	if file.MasteredPath == "" || file.EncodedPath == "" {
		t.Fatalf("expected both a mastered and an encoded path, got %+v", file)
	}
	// The encode reads the MASTERED file, never the original source.
	if got := readFile(t, file.EncodedPath); got != "encoded mp3 "+file.MasteredPath {
		t.Fatalf("encode did not read the mastered file: %q", got)
	}
}

func TestExportOneFailureDoesNotStopTheRest(t *testing.T) {
	dir := t.TempDir()
	bad, good := filepath.Join(dir, "bad.wav"), filepath.Join(dir, "good.wav")
	writeFixtureFile(t, bad, "wav")
	writeFixtureFile(t, good, "wav")
	host, ended := renderExportHost(t, bad, good)
	pickAllExport(t, host)
	host.encodeFile = func(_ context.Context, wav, dst string, spec encodeport.Spec) error {
		if wav == bad {
			return errors.New("the encoder rejected this file")
		}
		return fakeEncode(t)(context.Background(), wav, dst, spec)
	}

	items := []ExportItem{{Kind: string(packager.KindChapter), Title: "01", Path: bad}, {Kind: string(packager.KindChapter), Title: "02", Path: good}}
	if _, err := host.startExport(ExportRequest{Items: items}); err != nil {
		t.Fatal(err)
	}
	job := waitExportEnded(t, host)
	if job.Phase != "error" {
		t.Fatalf("expected error (one file failed), got %q", job.Phase)
	}
	if job.Files[0].Status != exportFileFailed || job.Files[0].Error == "" {
		t.Fatalf("expected the bad file to be failed with a reason, got %+v", job.Files[0])
	}
	if job.Files[1].Status != exportFileDone {
		t.Fatalf("expected the good file to still finish, got %+v", job.Files[1])
	}
	assertEndedOutcome(t, ended, "error")
}

func TestExportCancelMidRunLeavesLaterFilesCancelled(t *testing.T) {
	dir := t.TempDir()
	first, second := filepath.Join(dir, "1.wav"), filepath.Join(dir, "2.wav")
	writeFixtureFile(t, first, "wav")
	writeFixtureFile(t, second, "wav")
	host, ended := renderExportHost(t, first, second)
	pickAllExport(t, host)
	started := make(chan struct{})
	release := make(chan struct{})
	host.encodeFile = func(ctx context.Context, wav, dst string, spec encodeport.Spec) error {
		close(started)
		select {
		case <-release:
		case <-ctx.Done():
			return ctx.Err()
		}
		return fakeEncode(t)(ctx, wav, dst, spec)
	}

	items := []ExportItem{{Kind: string(packager.KindChapter), Title: "01", Path: first}, {Kind: string(packager.KindChapter), Title: "02", Path: second}}
	if _, err := host.startExport(ExportRequest{Items: items}); err != nil {
		t.Fatal(err)
	}
	<-started
	job := host.cancelExport()
	if job.Phase != "running" {
		t.Fatalf("cancel should not itself change the phase synchronously, got %q", job.Phase)
	}
	close(release)
	job = waitExportEnded(t, host)
	if job.Phase != "cancelled" {
		t.Fatalf("expected cancelled, got %q (%s)", job.Phase, job.Message)
	}
	if job.Files[1].Status != exportFileCancelled {
		t.Fatalf("expected the second file cancelled, got %+v", job.Files[1])
	}
	assertEndedOutcome(t, ended, "cancelled")
}

func TestExportRefusesASecondExportWhileOneRuns(t *testing.T) {
	source := filepath.Join(t.TempDir(), "ch1.wav")
	writeFixtureFile(t, source, "wav")
	host, _ := renderExportHost(t, source)
	pickAllExport(t, host)
	release := make(chan struct{})
	host.encodeFile = func(ctx context.Context, wav, dst string, spec encodeport.Spec) error {
		<-release
		return fakeEncode(t)(ctx, wav, dst, spec)
	}
	items := []ExportItem{{Kind: string(packager.KindChapter), Title: "01", Path: source}}
	if _, err := host.startExport(ExportRequest{Items: items}); err != nil {
		t.Fatal(err)
	}
	if _, err := host.startExport(ExportRequest{Items: items}); err == nil || !strings.Contains(err.Error(), "already running") {
		t.Fatalf("expected an already-running refusal, got %v", err)
	}
	close(release)
	waitExportEnded(t, host)
}

func waitExport(t *testing.T, host *Host) ExportJob {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		job := host.exportState()
		if job.Phase != "running" {
			return job
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("export did not finish in time")
	return ExportJob{}
}

// waitExportEnded is waitExport, named for the tests where "finish" can be cancelled or errored, not just success.
func waitExportEnded(t *testing.T, host *Host) ExportJob { return waitExport(t, host) }

func readFile(t *testing.T, path string) string {
	t.Helper()
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(body)
}

func assertOneSuccess(t *testing.T, ended func() []jobEnded) {
	t.Helper()
	assertEndedOutcome(t, ended, "success")
}

// assertEndedOutcome polls ended (its publish can lag a fraction behind the job's phase turning terminal, since the
// two happen one after the other in the job's own goroutine, not atomically) until the render_export event appears.
func assertEndedOutcome(t *testing.T, ended func() []jobEnded, outcome string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		for _, event := range ended() {
			if event.Kind != jobKindRenderExport {
				continue
			}
			if event.Outcome != outcome {
				t.Fatalf("expected job:ended outcome %q, got %q", outcome, event.Outcome)
			}
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("no %s job:ended event was published (got %+v)", jobKindRenderExport, ended())
}
