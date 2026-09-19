package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

func newTestHostForMedia(t *testing.T, folder string) *Host {
	t.Helper()
	host := &Host{settings: settings.New(t.TempDir(), folder)}
	host.config.projectFolder = folder
	return host
}

func passthrough(t *testing.T) http.Handler {
	t.Helper()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusTeapot) })
}

func TestMediaMiddlewareServesAnAuthorizedSourceFile(t *testing.T) {
	folder := t.TempDir()
	writeFile(t, filepath.Join(folder, "Book.rpp"), rppFixture("media/take1.wav"))
	if err := os.MkdirAll(filepath.Join(folder, "media"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(folder, "media", "take1.wav"), "RIFF-fake-audio-bytes")
	host := newTestHostForMedia(t, folder)
	handler := host.mediaMiddleware(passthrough(t))

	request := httptest.NewRequest(http.MethodGet, mediaRoute+"?path="+filepath.Join(folder, "media", "take1.wav"), nil)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", recorder.Code, recorder.Body.String())
	}
	if recorder.Body.String() != "RIFF-fake-audio-bytes" {
		t.Fatalf("body = %q", recorder.Body.String())
	}
}

func TestMediaMiddlewareSupportsRangeRequestsForSeeking(t *testing.T) {
	folder := t.TempDir()
	writeFile(t, filepath.Join(folder, "Book.rpp"), rppFixture("media/take1.wav"))
	if err := os.MkdirAll(filepath.Join(folder, "media"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(folder, "media", "take1.wav"), "0123456789")
	host := newTestHostForMedia(t, folder)
	handler := host.mediaMiddleware(passthrough(t))

	request := httptest.NewRequest(http.MethodGet, mediaRoute+"?path="+filepath.Join(folder, "media", "take1.wav"), nil)
	request.Header.Set("Range", "bytes=2-4")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusPartialContent {
		t.Fatalf("status = %d, want 206 (Partial Content)", recorder.Code)
	}
	if recorder.Body.String() != "234" {
		t.Fatalf("body = %q, want the requested byte range", recorder.Body.String())
	}
}

func TestMediaMiddlewareRefusesAFileNotReferencedByAnyTrack(t *testing.T) {
	folder := t.TempDir()
	writeFile(t, filepath.Join(folder, "Book.rpp"), rppFixture("media/take1.wav"))
	outside := filepath.Join(t.TempDir(), "secret.txt")
	writeFile(t, outside, "not a track source")
	host := newTestHostForMedia(t, folder)
	handler := host.mediaMiddleware(passthrough(t))

	request := httptest.NewRequest(http.MethodGet, mediaRoute+"?path="+outside, nil)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 for a path outside the project's known track sources", recorder.Code)
	}
}

func TestMediaMiddlewarePassesThroughEverythingElse(t *testing.T) {
	host := newTestHostForMedia(t, t.TempDir())
	handler := host.mediaMiddleware(passthrough(t))

	request := httptest.NewRequest(http.MethodGet, "/", nil)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusTeapot {
		t.Fatalf("status = %d, want the passthrough handler's response for a non-media request", recorder.Code)
	}
}

// rppFixture returns a minimal REAPER project with one track whose item
// sources relativeFile, matching the grammar shell/internal/tracks parses.
func rppFixture(relativeFile string) string {
	return "<REAPER_PROJECT 0.1 \"6.13/win64\" 1\n" +
		"  <TRACK {0E4D1D7F-D039-674D-87E6-719376DE95EC}\n" +
		"    NAME \"Chapter 1\"\n" +
		"    TRACKID {0E4D1D7F-D039-674D-87E6-719376DE95EC}\n" +
		"    <ITEM\n" +
		"      POSITION 0\n" +
		"      LENGTH 1\n" +
		"      <SOURCE WAVE\n" +
		"        FILE \"" + relativeFile + "\"\n" +
		"      >\n" +
		"    >\n" +
		"  >\n" +
		">\n"
}
