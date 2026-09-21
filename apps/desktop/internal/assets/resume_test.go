package assets

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
)

// rangeServer serves body and honours Range. The first `dropAfter` bytes of the first request are sent and the connection is then cut,
// as a network that went away would; every later request is answered in full (or as a range).
type rangeServer struct {
	*httptest.Server
	mu       sync.Mutex
	ranges   []string
	sent     int64
	requests int
}

func newRangeServer(t *testing.T, body []byte, dropAfter int, honourRange bool) *rangeServer {
	t.Helper()
	s := &rangeServer{}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		s.requests++
		first := s.requests == 1
		s.ranges = append(s.ranges, r.Header.Get("Range"))
		s.mu.Unlock()
		start := 0
		if header := r.Header.Get("Range"); header != "" && honourRange {
			if _, err := fmt.Sscanf(header, "bytes=%d-", &start); err != nil || start >= len(body) {
				w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", len(body)))
				w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
				return
			}
			w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, len(body)-1, len(body)))
			w.Header().Set("Content-Length", strconv.Itoa(len(body)-start))
			w.WriteHeader(http.StatusPartialContent)
		} else {
			w.Header().Set("Content-Length", strconv.Itoa(len(body)))
		}
		out := body[start:]
		if first && dropAfter > 0 && dropAfter < len(out) {
			n, _ := w.Write(out[:dropAfter])
			s.mu.Lock()
			s.sent += int64(n)
			s.mu.Unlock()
			w.(http.Flusher).Flush()
			conn, _, err := w.(http.Hijacker).Hijack()
			if err == nil {
				_ = conn.Close()
			}
			return
		}
		n, _ := w.Write(out)
		s.mu.Lock()
		s.sent += int64(n)
		s.mu.Unlock()
	}))
	t.Cleanup(s.Close)
	return s
}

func stagingDir(root string) string { return Dir(root, "p", "id", "1") + ".installing" }

func TestAnInterruptedDownloadResumesFromWhatArrivedAndIsNotFetchedAgain(t *testing.T) {
	body := []byte(strings.Repeat("0123456789", 20000)) // 200 KB
	server := newRangeServer(t, body, 60000, true)
	root := t.TempDir()
	files := []File{fileFor(server.URL, body)}

	err := Install(context.Background(), root, "p", "id", "1", files)
	if err == nil {
		t.Fatal("the first attempt was cut off and must fail")
	}
	if State(root, "p", "id", "1", files) != "not_installed" {
		t.Fatal("a cut-off download must not look installed")
	}
	part, statErr := os.Stat(filepath.Join(stagingDir(root), "payload.bin.part"))
	if statErr != nil || part.Size() <= 0 || part.Size() >= int64(len(body)) {
		t.Fatalf("the part file = %v (%v): what arrived is kept for the next attempt", part, statErr)
	}

	var reported []int64
	if err := InstallWith(context.Background(), root, "p", "id", "1", files, Options{OnProgress: func(_ File, done int64) { reported = append(reported, done) }}); err != nil {
		t.Fatalf("the second attempt: %v", err)
	}
	if State(root, "p", "id", "1", files) != "installed" {
		t.Fatal("the resumed download must install")
	}
	if want := "bytes=" + strconv.FormatInt(part.Size(), 10) + "-"; server.ranges[1] != want {
		t.Fatalf("second request Range = %q, want %q", server.ranges[1], want)
	}
	if server.sent >= 2*int64(len(body)) || server.sent > int64(len(body))+part.Size() {
		t.Fatalf("the server sent %d bytes in all: the body is %d and %d had arrived, so nothing may be fetched twice", server.sent, len(body), part.Size())
	}
	if len(reported) == 0 || reported[0] < part.Size() || reported[len(reported)-1] != int64(len(body)) {
		t.Fatalf("progress %v: it starts from what was already there and ends at the whole file", reported)
	}
	for i := 1; i < len(reported); i++ {
		if reported[i] < reported[i-1] {
			t.Fatalf("progress went backwards: %v", reported)
		}
	}
	if _, err := os.Stat(stagingDir(root)); !os.IsNotExist(err) {
		t.Fatal("the staging folder is renamed into place, so it is gone")
	}
}

func TestAServerThatIgnoresRangeIsStartedAgainFromTheTop(t *testing.T) {
	body := []byte(strings.Repeat("abcdefghij", 20000))
	server := newRangeServer(t, body, 50000, false)
	root := t.TempDir()
	files := []File{fileFor(server.URL, body)}
	if err := Install(context.Background(), root, "p", "id", "1", files); err == nil {
		t.Fatal("expected the cut-off to fail")
	}
	if err := Install(context.Background(), root, "p", "id", "1", files); err != nil {
		t.Fatalf("a full 200 answer to a Range request must be accepted and start over: %v", err)
	}
	if State(root, "p", "id", "1", files) != "installed" {
		t.Fatal("not installed")
	}
}

func TestARangeTheServerRefusesStartsOverInsteadOfFailing(t *testing.T) {
	body := []byte(strings.Repeat("abcdefghij", 5000))
	server := newRangeServer(t, body, 0, true)
	root := t.TempDir()
	files := []File{fileFor(server.URL, body)}
	// A part file as long as the whole body: no byte is left to ask for, and the server answers 416 to bytes=len-.
	if err := os.MkdirAll(stagingDir(root), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stagingDir(root), "payload.bin.part"), append([]byte("x"), body[1:]...), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Install(context.Background(), root, "p", "id", "1", files); err != nil {
		t.Fatalf("a part file that is not a prefix of the file must be replaced, not trusted: %v", err)
	}
	if State(root, "p", "id", "1", files) != "installed" {
		t.Fatal("not installed")
	}
}

// A part file that was a stale prefix (the file changed upstream, or a crash left a bad tail) does not fail the install for good: the bytes
// that were resumed fail their hash, so the file is fetched again from the top once, and that copy is what is checked.
func TestAResumedFileThatFailsItsHashIsFetchedAgainFromTheTop(t *testing.T) {
	body := []byte(strings.Repeat("abcdefghij", 5000))
	server := newRangeServer(t, body, 0, true)
	root := t.TempDir()
	files := []File{fileFor(server.URL, body)}
	if err := os.MkdirAll(stagingDir(root), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stagingDir(root), "payload.bin.part"), []byte(strings.Repeat("Z", 1000)), 0o600); err != nil { // not a prefix
		t.Fatal(err)
	}
	if err := Install(context.Background(), root, "p", "id", "1", files); err != nil {
		t.Fatalf("a bad resume must be retried from the top: %v", err)
	}
	if State(root, "p", "id", "1", files) != "installed" {
		t.Fatal("not installed")
	}
	if server.ranges[0] != "bytes=1000-" || server.ranges[1] != "" {
		t.Fatalf("requests asked for %q: the resume first, then the whole file", server.ranges)
	}
}

// A file that is wrong from the top is wrong: nothing is kept to resume from, and the narrator is told it did not match.
func TestAFileThatIsWrongFromTheTopLeavesNothingToResume(t *testing.T) {
	body := []byte(strings.Repeat("abcdefghij", 5000))
	wrong := []byte(strings.Repeat("ZZZZZZZZZZ", 5000))
	server := newRangeServer(t, wrong, 0, true)
	root := t.TempDir()
	files := []File{fileFor(server.URL, body)}
	err := Install(context.Background(), root, "p", "id", "1", files)
	if !errors.Is(err, ErrChecksumMismatch) {
		t.Fatalf("err = %v, want a checksum mismatch", err)
	}
	if _, statErr := os.Stat(stagingDir(root)); !os.IsNotExist(statErr) {
		t.Fatal("a file that failed its hash must not be kept to resume from")
	}
}

// A part that already holds every byte (the earlier attempt died before it could rename it) is checked and used, not fetched again.
func TestACompletePartFileIsCheckedAndUsedWithoutAnotherDownload(t *testing.T) {
	body := []byte(strings.Repeat("abcdefghij", 5000))
	server := newRangeServer(t, body, 0, true)
	root := t.TempDir()
	files := []File{fileFor(server.URL, body)}
	if err := os.MkdirAll(stagingDir(root), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stagingDir(root), "payload.bin.part"), body, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Install(context.Background(), root, "p", "id", "1", files); err != nil {
		t.Fatal(err)
	}
	if server.requests != 0 {
		t.Fatalf("%d requests: a complete part file needs none", server.requests)
	}
}

func TestACancelledDownloadRemovesWhatItFetched(t *testing.T) {
	body := []byte(strings.Repeat("abcdefghij", 20000))
	server := newRangeServer(t, body, 0, true)
	root := t.TempDir()
	files := []File{fileFor(server.URL, body)}
	ctx, cancel := context.WithCancel(context.Background())
	options := Options{OnProgress: func(File, int64) { cancel() }}
	if err := InstallWith(ctx, root, "p", "id", "1", files, options); err == nil {
		t.Fatal("a cancelled install must fail")
	}
	if _, err := os.Stat(stagingDir(root)); !os.IsNotExist(err) {
		t.Fatal("the narrator cancelled: nothing is kept")
	}
}

func TestOfflineFailsWithoutLeavingAnythingInstalled(t *testing.T) {
	body := []byte("payload")
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	files := []File{fileFor(server.URL, body)}
	server.Close() // nobody is listening any more
	root := t.TempDir()
	err := Install(context.Background(), root, "p", "id", "1", files)
	var netError net.Error
	if err == nil || !errors.As(err, &netError) {
		t.Fatalf("err = %v, want a network error a caller can recognise", err)
	}
	if State(root, "p", "id", "1", files) != "not_installed" {
		t.Fatal("offline must not leave an installed-looking asset")
	}
}

func TestAnHTTPErrorNamesItsStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { http.Error(w, "gone", http.StatusNotFound) }))
	defer server.Close()
	err := Install(context.Background(), t.TempDir(), "p", "id", "1", []File{fileFor(server.URL, []byte("payload"))})
	var status *StatusError
	if !errors.As(err, &status) || status.Code != http.StatusNotFound {
		t.Fatalf("err = %v, want a StatusError with 404", err)
	}
}

// A file the catalog does not name never gets into an install, even when a resumed staging folder held one.
func TestAStrayFileInAResumedStagingFolderIsNotInstalled(t *testing.T) {
	body := []byte("payload")
	server := newRangeServer(t, body, 0, true)
	root := t.TempDir()
	files := []File{fileFor(server.URL, body)}
	if err := os.MkdirAll(stagingDir(root), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stagingDir(root), "stray.exe"), []byte("MZ"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Install(context.Background(), root, "p", "id", "1", files); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(Dir(root, "p", "id", "1"), "stray.exe")); !os.IsNotExist(err) {
		t.Fatal("a file that is not in the catalog must not be installed")
	}
}
