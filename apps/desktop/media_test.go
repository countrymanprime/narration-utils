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

func TestMediaMiddlewareRefusesTraversalOutOfTheProjectFolder(t *testing.T) {
	folder := t.TempDir()
	writeFile(t, filepath.Join(folder, "Book.rpp"), rppFixture("media/take1.wav"))
	writeFile(t, filepath.Join(filepath.Dir(folder), "secret.txt"), "not a track source")
	host := newTestHostForMedia(t, folder)
	handler := host.mediaMiddleware(passthrough(t))

	request := httptest.NewRequest(http.MethodGet, mediaRoute+"?path="+filepath.Join(folder, "media", "..", "..", "secret.txt"), nil)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 for a traversal path that resolves outside the project's track sources", recorder.Code)
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

// TestMediaMiddlewareAuthorizesEveryTakesSourceNotJustTheActiveOne proves
// the take-review PRD's Phase 2 extension of the analysis evidence ledger's
// Q10 (adopted there as "B: only the active take's source", with the PRD's
// own note "TR Phase 2 asks for all takes; it can extend from B" - see
// docs/prds/analysis-evidence-ledger.prd.md and
// docs/prds/take-review-pickups-duplicates-take-intelligence.prd.md Phase
// 2). Take review's audition and comparison work (later phases) need to
// play a candidate take's own source even when it is not the item's active
// take, so every take of every item the selected project references is now
// authorized, not only each item's active one.
func TestMediaMiddlewareAuthorizesEveryTakesSourceNotJustTheActiveOne(t *testing.T) {
	folder := t.TempDir()
	writeFile(t, filepath.Join(folder, "Book.rpp"), multiTakeRppFixture("media/take_a.wav", "media/take_b.wav"))
	if err := os.MkdirAll(filepath.Join(folder, "media"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(folder, "media", "take_a.wav"), "take A bytes")
	writeFile(t, filepath.Join(folder, "media", "take_b.wav"), "take B bytes")
	host := newTestHostForMedia(t, folder)
	handler := host.mediaMiddleware(passthrough(t))

	activeRequest := httptest.NewRequest(http.MethodGet, mediaRoute+"?path="+filepath.Join(folder, "media", "take_b.wav"), nil)
	activeRecorder := httptest.NewRecorder()
	handler.ServeHTTP(activeRecorder, activeRequest)
	if activeRecorder.Code != http.StatusOK {
		t.Fatalf("active take: status = %d, want 200; body = %s", activeRecorder.Code, activeRecorder.Body.String())
	}

	inactiveRequest := httptest.NewRequest(http.MethodGet, mediaRoute+"?path="+filepath.Join(folder, "media", "take_a.wav"), nil)
	inactiveRecorder := httptest.NewRecorder()
	handler.ServeHTTP(inactiveRecorder, inactiveRequest)
	if inactiveRecorder.Code != http.StatusOK {
		t.Fatalf("inactive take: status = %d, want 200 (every take's own source is authorized, not only the active take's); body = %s", inactiveRecorder.Code, inactiveRecorder.Body.String())
	}
	if inactiveRecorder.Body.String() != "take A bytes" {
		t.Fatalf("inactive take body = %q, want the inactive take's own file content", inactiveRecorder.Body.String())
	}
}

// TestMediaMiddlewareAuthorizesEveryTakeOfARealReaperSavedMultiTakeItem
// reuses the S0 spike's REAPER-saved fixture pack (three real takes on one
// item, the second active) rather than a hand-written project, per the
// take-review PRD's instruction to test the take-aware model against real
// REAPER output.
func TestMediaMiddlewareAuthorizesEveryTakeOfARealReaperSavedMultiTakeItem(t *testing.T) {
	folder := t.TempDir()
	copyReaperFixture(t, folder, "saved-cases.rpp", "Book.rpp")

	host := newTestHostForMedia(t, folder)
	handler := host.mediaMiddleware(passthrough(t))

	for _, take := range []string{"take_a.wav", "take_b.wav", "take_c.wav"} {
		request := httptest.NewRequest(http.MethodGet, mediaRoute+"?path="+filepath.Join(folder, "media", take), nil)
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusOK {
			t.Errorf("%s: status = %d, want 200 (every take of the real multi-take item is authorized)", take, recorder.Code)
		}
	}
}

// copyReaperFixture copies a REAPER-saved fixture from
// apps/desktop/internal/tracks/testdata/reaper (see that folder's README)
// and its media/ folder into folder as destName, so a media.go test can
// authorize against a project REAPER itself wrote instead of a hand-built
// one.
func copyReaperFixture(t *testing.T, folder, fixtureName, destName string) {
	t.Helper()
	source := filepath.Join("internal", "tracks", "testdata", "reaper")
	contents, err := os.ReadFile(filepath.Join(source, fixtureName))
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(folder, destName), string(contents))

	mediaSource := filepath.Join(source, "media")
	entries, err := os.ReadDir(mediaSource)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(folder, "media"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		bytes, err := os.ReadFile(filepath.Join(mediaSource, entry.Name()))
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(folder, "media", entry.Name()), bytes, 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

// rppFixture returns a minimal REAPER project with one track whose item
// sources relativeFile, matching the grammar apps/desktop/internal/tracks parses.
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

// multiTakeRppFixture returns a project with one item holding two takes,
// the second (takeB) active, matching the shape REAPER 7.x writes (see
// apps/desktop/internal/tracks/testdata/reaper/README.md): a bare TAKE SEL
// line, no wrapping chunk, between the two takes' own NAME/SOFFS/PLAYRATE/
// GUID/<SOURCE> lines.
func multiTakeRppFixture(takeA, takeB string) string {
	return "<REAPER_PROJECT 0.1 \"7.80/win64\" 1\n" +
		"  <TRACK {D584C631-7ADA-4513-BE2C-6FC19D775206}\n" +
		"    NAME \"Multi-take\"\n" +
		"    TRACKID {D584C631-7ADA-4513-BE2C-6FC19D775206}\n" +
		"    <ITEM\n" +
		"      POSITION 0\n" +
		"      LENGTH 1\n" +
		"      IGUID {83F2BBC9-F579-4D70-8EC2-63E9FCF1BE8C}\n" +
		"      NAME \"take A\"\n" +
		"      SOFFS 0\n" +
		"      PLAYRATE 1\n" +
		"      GUID {500C2AA4-471B-4A73-861C-10AB008DD3C0}\n" +
		"      <SOURCE WAVE\n" +
		"        FILE \"" + takeA + "\"\n" +
		"      >\n" +
		"      TAKE SEL\n" +
		"      NAME \"take B\"\n" +
		"      SOFFS 0\n" +
		"      PLAYRATE 1\n" +
		"      GUID {F5614A11-80D0-425B-82BB-B4D942CD241E}\n" +
		"      <SOURCE WAVE\n" +
		"        FILE \"" + takeB + "\"\n" +
		"      >\n" +
		"    >\n" +
		"  >\n" +
		">\n"
}
