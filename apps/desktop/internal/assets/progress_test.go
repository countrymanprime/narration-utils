package assets

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func fileFor(url string, body []byte) File {
	sum := sha256.Sum256(body)
	return File{Name: "payload.bin", URL: url, SHA256: hex.EncodeToString(sum[:]), Size: int64(len(body))}
}

func TestInstallWithReportsRealBytesAsTheyArrive(t *testing.T) {
	body := []byte(strings.Repeat("0123456789", 30000)) // 300 KB, several reads
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(body) }))
	defer server.Close()
	var reported []int64
	options := Options{OnProgress: func(_ File, done int64) { reported = append(reported, done) }}
	if err := InstallWith(context.Background(), t.TempDir(), "p", "id", "1", []File{fileFor(server.URL, body)}, options); err != nil {
		t.Fatal(err)
	}
	if len(reported) < 2 {
		t.Fatalf("progress was reported %d times: a 300 KB download should report along the way", len(reported))
	}
	for index := 1; index < len(reported); index++ {
		if reported[index] < reported[index-1] {
			t.Fatalf("progress went backwards: %v", reported)
		}
	}
	if reported[len(reported)-1] != int64(len(body)) {
		t.Fatalf("the last report is %d, want the whole %d bytes", reported[len(reported)-1], len(body))
	}
}

// A server that sends more than the catalog says is cut off at the declared size: it cannot fill the disk.
func TestInstallWithStopsReadingAtTheDeclaredSize(t *testing.T) {
	declared := []byte("small")
	var sent atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		chunk := []byte(strings.Repeat("x", 64<<10))
		for range 2000 { // 128 MB offered
			n, err := w.Write(chunk)
			sent.Add(int64(n))
			if err != nil {
				return
			}
		}
	}))
	defer server.Close()
	root := t.TempDir()
	if err := InstallWith(context.Background(), root, "p", "id", "1", []File{fileFor(server.URL, declared)}, Options{}); err == nil {
		t.Fatal("a body larger than declared must fail")
	}
	if sent.Load() > 32<<20 {
		t.Fatalf("the client kept reading: the server managed to send %d bytes", sent.Load())
	}
	if _, err := os.Stat(Dir(root, "p", "id", "1")); !os.IsNotExist(err) {
		t.Fatal("nothing may be left installed")
	}
	if _, err := os.Stat(Dir(root, "p", "id", "1") + ".installing"); !os.IsNotExist(err) {
		t.Fatal("nothing may be left staged")
	}
}

func TestInstallWithACancelledContextLeavesNothingAndReturnsTheContextError(t *testing.T) {
	body := []byte(strings.Repeat("y", 1<<20))
	started := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(body[:1024])
		w.(http.Flusher).Flush()
		close(started)
		<-r.Context().Done()
	}))
	defer server.Close()
	root := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- InstallWith(ctx, root, "p", "id", "1", []File{fileFor(server.URL, body)}, Options{})
	}()
	<-started
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("err = %v, want the context error", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("cancelling did not stop the download")
	}
	if _, err := os.Stat(Dir(root, "p", "id", "1") + ".installing"); !os.IsNotExist(err) {
		t.Fatal("a cancelled download must remove its staging directory")
	}
}

func TestInstallWithUsesTheClientItIsGiven(t *testing.T) {
	body := []byte("payload")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(body) }))
	defer server.Close()
	var used atomic.Bool
	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		used.Store(true)
		return http.DefaultTransport.RoundTrip(r)
	})}
	if err := InstallWith(context.Background(), t.TempDir(), "p", "id", "1", []File{fileFor(server.URL, body)}, Options{Client: client}); err != nil {
		t.Fatal(err)
	}
	if !used.Load() {
		t.Fatal("the download ignored the client it was given, so it would have ignored its redirect policy")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestInstallWithAsksThePreflightBeforeTouchingTheDiskAndSkipsItWhenInstalled(t *testing.T) {
	body := []byte("payload")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(body) }))
	defer server.Close()
	root := t.TempDir()
	file := fileFor(server.URL, body)
	refuse := errors.New("no room")
	err := InstallWith(context.Background(), root, "p", "id", "1", []File{file}, Options{Preflight: func(string, int64) error { return refuse }})
	if !errors.Is(err, refuse) {
		t.Fatalf("err = %v, want the preflight's", err)
	}
	if _, statErr := os.Stat(Dir(root, "p", "id", "1") + ".installing"); !os.IsNotExist(statErr) {
		t.Fatal("a refused preflight must not create the staging directory")
	}
	var total int64
	if err := InstallWith(context.Background(), root, "p", "id", "1", []File{file}, Options{Preflight: func(_ string, need int64) error { total = need; return nil }}); err != nil {
		t.Fatal(err)
	}
	if total != int64(len(body)) {
		t.Fatalf("the preflight was told %d bytes are coming, want %d", total, len(body))
	}
	calls := 0
	if err := InstallWith(context.Background(), root, "p", "id", "1", []File{file}, Options{Preflight: func(string, int64) error { calls++; return refuse }}); err != nil || calls != 0 {
		t.Fatalf("an installed asset needs no room: err %v, %d preflight calls", err, calls)
	}
}
