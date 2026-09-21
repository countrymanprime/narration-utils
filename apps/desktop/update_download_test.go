package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/update"
)

// releaseFiles is a fake GitHub that serves the release list, one release's zip and its checksum, and counts what was asked for.
type releaseFiles struct {
	server      *httptest.Server
	zip         []byte
	executable  []byte
	zipRequests atomic.Int32
	serveZip    func(w http.ResponseWriter, r *http.Request)
	checksum    func(zipBody []byte) string
}

func newReleaseFiles(t *testing.T) *releaseFiles {
	t.Helper()
	fake := &releaseFiles{executable: []byte(strings.Repeat("MZ a program ", 200000))}
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	entry, err := writer.Create("narration-utils.exe")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write(fake.executable); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	fake.zip = buffer.Bytes()
	fake.checksum = func(body []byte) string {
		sum := sha256.Sum256(body)
		return hex.EncodeToString(sum[:]) + "  narration-utils-windows-x64.zip\n"
	}
	fake.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/releases"):
			type asset struct {
				Name string `json:"name"`
				Size int64  `json:"size"`
			}
			list := []map[string]any{{"tag_name": "v0.2.7-rc", "prerelease": true, "published_at": "2026-09-20T10:00:00Z", "assets": []asset{
				{Name: "narration-utils-windows-x64.zip", Size: int64(len(fake.zip))}, {Name: "narration-utils-windows-x64.zip.sha256", Size: 100},
			}}}
			body, _ := json.Marshal(list)
			_, _ = w.Write(body)
		case strings.HasSuffix(r.URL.Path, ".sha256"):
			_, _ = w.Write([]byte(fake.checksum(fake.zip)))
		case strings.HasSuffix(r.URL.Path, ".zip"):
			fake.zipRequests.Add(1)
			if fake.serveZip != nil {
				fake.serveZip(w, r)
				return
			}
			_, _ = w.Write(fake.zip)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(fake.server.Close)
	return fake
}

// downloadHost is a Host on version 0.2.6 whose checker and stager talk to fake, and whose update cache is a temporary folder.
func downloadHost(t *testing.T, fake *releaseFiles) *Host {
	t.Helper()
	appData := t.TempDir()
	t.Setenv("APPDATA", appData)
	t.Setenv("USERPROFILE", appData)
	host := NewHost()
	host.version = "0.2.6"
	platform, _ := update.PlatformFor("windows", "amd64")
	host.updates = &update.Checker{
		Client: fake.server.Client(), APIBase: fake.server.URL, DownloadBase: fake.server.URL + "/releases", Repository: updateTestRepository,
		Platform: platform, CachePath: filepath.Join(t.TempDir(), "check.json"), Current: "0.2.6", Now: func() time.Time { return time.Date(2026, 9, 21, 12, 0, 0, 0, time.UTC) },
	}
	host.stager = &update.Stager{Root: t.TempDir(), Platform: platform, Client: fake.server.Client(), Free: func(string) (uint64, error) { return 100 << 30, nil }}
	host.mu.Lock()
	host.ctx, host.cancel = context.WithCancel(context.Background())
	host.mu.Unlock()
	t.Cleanup(host.cancel)
	return host
}

type jobPayload struct {
	ID         string `json:"id"`
	Version    string `json:"version"`
	Phase      string `json:"phase"`
	Message    string `json:"message"`
	Percent    int    `json:"percent"`
	BytesDone  int64  `json:"bytesDone"`
	BytesTotal int64  `json:"bytesTotal"`
	Error      string `json:"error"`
}

func decodeJob(t *testing.T, text string, err error) jobPayload {
	t.Helper()
	if err != nil {
		t.Fatalf("binding error: %v", err)
	}
	var job jobPayload
	if err := json.Unmarshal([]byte(text), &job); err != nil {
		t.Fatalf("%v in %s", err, text)
	}
	return job
}

func waitForJob(t *testing.T, host *Host, id string, done func(jobPayload) bool) jobPayload {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for {
		text, err := host.UpdateJobState(id)
		job := decodeJob(t, text, err)
		if done(job) {
			return job
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out; last state %+v", job)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func finished(job jobPayload) bool {
	return job.Phase == "ready" || job.Phase == "error" || job.Phase == "cancelled"
}

func TestDownloadStagesTheUpdateWithRealBytesAndEndsReady(t *testing.T) {
	fake := newReleaseFiles(t)
	host := downloadHost(t, fake)
	if _, err := host.UpdateCheck(); err != nil {
		t.Fatal(err)
	}
	started := startDownload(t, host)
	if started.ID == "" || started.Version != "0.2.7" || started.BytesTotal != int64(len(fake.zip)) {
		t.Fatalf("started = %+v", started)
	}
	job := waitForJob(t, host, started.ID, finished)
	if job.Phase != "ready" || job.Percent != 100 || job.Error != "" || job.BytesDone != job.BytesTotal {
		t.Fatalf("job = %+v", job)
	}
	staged, ok := host.stagedUpdate()
	if !ok {
		t.Fatal("the host does not know the update is staged")
	}
	got, err := os.ReadFile(staged.Executable)
	if err != nil || !bytes.Equal(got, fake.executable) {
		t.Fatalf("staged program: %v", err)
	}
}

func startDownload(t *testing.T, host *Host) jobPayload {
	t.Helper()
	text, err := host.UpdateDownload()
	return decodeJob(t, text, err)
}

func cancelDownload(t *testing.T, host *Host, id string) jobPayload {
	t.Helper()
	text, err := host.UpdateJobCancel(id)
	return decodeJob(t, text, err)
}

func TestDownloadRefusesWhenThereIsNothingNewOrItCannotReplaceItself(t *testing.T) {
	fake := newReleaseFiles(t)
	host := downloadHost(t, fake)
	if _, err := host.UpdateDownload(); err == nil || !strings.Contains(err.Error(), "no newer release") {
		t.Fatalf("before any check: %v", err)
	}
	if _, err := host.UpdateCheck(); err != nil {
		t.Fatal(err)
	}
	host.updates.Current, host.version = "0.0.0-dev", "0.0.0-dev"
	if _, err := host.UpdateDownload(); err == nil {
		t.Fatal("a development build does not update")
	}
	host.updates.Current, host.version = "0.2.6", "0.2.6"
	host.updates.Platform.SelfReplace = false
	if _, err := host.UpdateDownload(); err == nil || !strings.Contains(err.Error(), "does not update itself") {
		t.Fatalf("a platform that cannot replace itself: %v", err)
	}
	if fake.zipRequests.Load() != 0 {
		t.Fatal("nothing was downloaded")
	}
}

func TestOnlyOneDownloadRunsAtATimeAndItCanBeCancelled(t *testing.T) {
	fake := newReleaseFiles(t)
	release := make(chan struct{})
	fake.serveZip = func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(fake.zip[:2048])
		w.(http.Flusher).Flush()
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}
	host := downloadHost(t, fake)
	if _, err := host.UpdateCheck(); err != nil {
		t.Fatal(err)
	}
	first := startDownload(t, host)
	waitForJob(t, host, first.ID, func(job jobPayload) bool { return job.BytesDone >= 2048 })
	if _, err := host.UpdateDownload(); err == nil || !strings.Contains(err.Error(), "already") {
		t.Fatalf("a second download while one runs: %v", err)
	}
	cancelled := cancelDownload(t, host, first.ID)
	if cancelled.ID != first.ID {
		t.Fatalf("cancel answered %+v", cancelled)
	}
	job := waitForJob(t, host, first.ID, finished)
	close(release)
	if job.Phase != "cancelled" || job.Error != "" {
		t.Fatalf("job = %+v", job)
	}
	if _, ok := host.stagedUpdate(); ok {
		t.Fatal("a cancelled download is not staged")
	}
	// A cancelled download can be started again.
	fake.serveZip = nil
	second := startDownload(t, host)
	if job := waitForJob(t, host, second.ID, finished); job.Phase != "ready" {
		t.Fatalf("second job = %+v", job)
	}
}

func TestAFailedDownloadEndsInAnErrorTheNarratorCanRead(t *testing.T) {
	fake := newReleaseFiles(t)
	fake.checksum = func([]byte) string { return strings.Repeat("0", 64) + "  narration-utils-windows-x64.zip\n" }
	host := downloadHost(t, fake)
	if _, err := host.UpdateCheck(); err != nil {
		t.Fatal(err)
	}
	started := startDownload(t, host)
	job := waitForJob(t, host, started.ID, finished)
	if job.Phase != "error" || job.Error == "" || job.Message != job.Error {
		t.Fatalf("job = %+v", job)
	}
	if strings.Contains(job.Error, "127.0.0.1") {
		t.Fatalf("the error leaks an address: %q", job.Error)
	}
	if _, ok := host.stagedUpdate(); ok {
		t.Fatal("nothing is staged after a failure")
	}
	// The failure is not a wall: a good download can follow.
	fake.checksum = func(body []byte) string {
		sum := sha256.Sum256(body)
		return hex.EncodeToString(sum[:]) + "  narration-utils-windows-x64.zip\n"
	}
	again := startDownload(t, host)
	if job := waitForJob(t, host, again.ID, finished); job.Phase != "ready" {
		t.Fatalf("retry = %+v", job)
	}
}

func TestAnUnknownJobIsAnErrorAndClosingTheAppCancelsTheDownload(t *testing.T) {
	fake := newReleaseFiles(t)
	fake.serveZip = func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(fake.zip[:1024])
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}
	host := downloadHost(t, fake)
	if _, err := host.UpdateJobState("nope"); err == nil {
		t.Fatal("unknown job state")
	}
	if _, err := host.UpdateJobCancel("nope"); err == nil {
		t.Fatal("unknown job cancel")
	}
	if _, err := host.UpdateCheck(); err != nil {
		t.Fatal(err)
	}
	started := startDownload(t, host)
	waitForJob(t, host, started.ID, func(job jobPayload) bool { return job.BytesDone >= 1024 })
	host.cancel()
	if job := waitForJob(t, host, started.ID, finished); job.Phase != "cancelled" {
		t.Fatalf("job = %+v", job)
	}
}

// The payloads the download bindings send (ADR 0069).
func TestContractUpdateJob(t *testing.T) {
	pin := func(name string, job map[string]any) { contractfile.Check(t, name, job) }
	pin("update-job-downloading", snapshotUpdateJob(&updateJob{id: "update-1", version: "0.2.7", phase: updatePhaseDownloading, message: "Downloading Narration Utils 0.2.7…", done: 104857600, total: 209715200}))
	pin("update-job-verifying", snapshotUpdateJob(&updateJob{id: "update-1", version: "0.2.7", phase: updatePhaseVerifying, message: "Checking the download against the release's checksum…", done: 209715200, total: 209715200}))
	pin("update-job-ready", snapshotUpdateJob(&updateJob{id: "update-1", version: "0.2.7", phase: updatePhaseReady, message: "Version 0.2.7 is downloaded and checked.", done: 209715200, total: 209715200}))
	pin("update-job-error", snapshotUpdateJob(&updateJob{id: "update-1", version: "0.2.7", phase: updatePhaseError, message: "The checksum in the release and GitHub's own record of the file disagree, so the update was not used.", errorText: "The checksum in the release and GitHub's own record of the file disagree, so the update was not used.", done: 52428800, total: 209715200}))
	pin("update-job-cancelled", snapshotUpdateJob(&updateJob{id: "update-1", version: "0.2.7", phase: updatePhaseCancelled, message: "The update download was cancelled.", done: 52428800, total: 209715200}))
}
