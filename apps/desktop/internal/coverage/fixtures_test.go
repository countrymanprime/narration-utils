package coverage

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
)

// --- a project on disk ---

const (
	testDocument = "doc-1"
	testChapter  = "c-0001"
	testTrack    = "{TRACK-1}"
)

// testItem is one item of the fixture .rpp's chapter track.
type testItem struct {
	guid     string
	source   string // relative to the project folder
	position float64
	length   float64
	soffs    float64
	playrate float64
	muted    bool
	kind     string // SOURCE kind, WAVE when empty
}

type testProject struct {
	t      *testing.T
	dir    string
	rpp    string
	items  []testItem
	tracks int // extra tracks with no items
}

func newTestProject(t *testing.T) *testProject {
	t.Helper()
	dir := t.TempDir()
	p := &testProject{t: t, dir: dir, rpp: filepath.Join(dir, "book.rpp")}
	for _, name := range []string{"media/a.wav", "media/b.wav"} {
		p.writeFile(name, "RIFF"+strings.Repeat(name, 64))
	}
	p.items = []testItem{
		{guid: "{ITEM-A}", source: "media/a.wav", position: 0, length: 10, soffs: 5, playrate: 1},
		{guid: "{ITEM-B}", source: "media/b.wav", position: 10, length: 6, soffs: 0, playrate: 1},
	}
	p.writeManuscript(testDocument, "Chapter One", "Alice was beginning to get very tired.")
	p.writeRPP()
	p.confirm(testDocument, testTrack, testChapter)
	return p
}

func (p *testProject) writeFile(relative, content string) {
	p.t.Helper()
	path := filepath.Join(p.dir, filepath.FromSlash(relative))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		p.t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		p.t.Fatal(err)
	}
}

func (p *testProject) writeManuscript(documentID, title, text string) {
	p.t.Helper()
	data := map[string]any{
		"schemaVersion": 1, "documentId": documentID,
		"chapters": []any{
			map[string]any{"id": "c-0001", "title": title, "contentKind": "narration"},
			map[string]any{"id": "c-0002", "title": "Front Matter", "contentKind": "opening"},
		},
		"paragraphs": []any{
			map[string]any{"id": "p-000001", "chapterId": "c-0001", "index": 0, "text": text},
			map[string]any{"id": "p-000002", "chapterId": "c-0002", "index": 1, "text": "Copyright."},
		},
	}
	encoded, _ := json.Marshal(data)
	p.writeFile("narration-utils/manuscript/manuscript.json", string(encoded))
}

func (p *testProject) loadManuscript() (map[string]any, error) {
	raw, err := os.ReadFile(filepath.Join(p.dir, "narration-utils", "manuscript", "manuscript.json"))
	if err != nil {
		return nil, err
	}
	var data map[string]any
	return data, json.Unmarshal(raw, &data)
}

func (p *testProject) confirm(documentID, trackGUID, chapterID string) {
	p.t.Helper()
	if _, err := evidence.NewMappingStore(p.dir).Confirm(documentID, trackGUID, chapterID, "Chapter One"); err != nil {
		p.t.Fatal(err)
	}
}

func (p *testProject) writeRPP() {
	p.t.Helper()
	var b strings.Builder
	b.WriteString("<REAPER_PROJECT 0.1 \"7.80/win64\" 1789970042 0\n")
	fmt.Fprintf(&b, "  <TRACK %s\n    NAME \"Chapter One\"\n    TRACKID %s\n", testTrack, testTrack)
	for _, item := range p.items {
		kind := item.kind
		if kind == "" {
			kind = "WAVE"
		}
		mute := 0
		if item.muted {
			mute = 1
		}
		fmt.Fprintf(&b, "    <ITEM\n      POSITION %g\n      LENGTH %g\n      MUTE %d 0\n      IGUID %s\n      NAME take\n      SOFFS %g\n      PLAYRATE %g 1 0 -1 0 0.0025\n      GUID %s-take\n",
			item.position, item.length, mute, item.guid, item.soffs, item.playrate, strings.TrimSuffix(item.guid, "}"))
		if kind == "WAVE" {
			fmt.Fprintf(&b, "      <SOURCE WAVE\n        FILE %q\n      >\n    >\n", item.source)
		} else {
			fmt.Fprintf(&b, "      <SOURCE %s\n        HASDATA 1 960 QN\n      >\n    >\n", kind)
		}
	}
	b.WriteString("  >\n")
	for extra := 0; extra < p.tracks; extra++ {
		fmt.Fprintf(&b, "  <TRACK {EXTRA-%d}\n    NAME \"Extra\"\n    TRACKID {EXTRA-%d}\n  >\n", extra, extra)
	}
	b.WriteString(">\n")
	if err := os.WriteFile(p.rpp, []byte(b.String()), 0o600); err != nil {
		p.t.Fatal(err)
	}
	// A saved project is newer than anything else in the fixture.
	later := time.Now().Add(time.Hour)
	_ = os.Chtimes(p.rpp, later, later)
}

func (p *testProject) service(sidecar *fakeSidecar) *Service {
	service := New(Config{
		Project:        p.dir,
		Python:         "python-sidecar",
		Backend:        "compare.py",
		ProjectFile:    func() (string, error) { return p.rpp, nil },
		LoadManuscript: p.loadManuscript,
	}, sidecar.launcher(), nil)
	service.pollInterval = time.Millisecond
	return service
}

func testRequest() Request {
	return Request{ChapterID: testChapter, Transcription: Transcription{Model: "small"}, Alignment: DefaultAlignmentParams}
}

// run starts a check and waits for it to finish.
func run(t *testing.T, service *Service, request Request) State {
	t.Helper()
	if _, err := service.Start(request); err != nil {
		t.Fatalf("Start: %v", err)
	}
	service.Wait()
	return service.State()
}

// --- a fake sidecar ---

// fakeSidecar stands in for `compare.py --coverage`: it reads the manifest,
// reuses a words file that covers an item's range and "transcribes" (writes
// one) otherwise, honours the .cancel file between items, and writes a results
// file. It counts what it transcribed, which is what the cache tests assert.
type fakeSidecar struct {
	mu          sync.Mutex
	launches    [][]string
	transcribed []string // item GUIDs

	exitCode     int    // non-zero: fail with this code after writing an ERROR line
	errorMessage string // the ERROR line's message
	badResults   bool   // exit 0 with a results file that does not parse
	launchErr    error
	present      int      // present tokens of 10 (default 10)
	results      []string // when set, the results file's lines as the real sidecar wrote them (corpus_test.go)
	during       func()   // called after the items, before the results are written

	// pauseAfter > 0 pauses after that many transcriptions until resume is closed.
	pauseAfter int
	paused     chan struct{}
	resume     chan struct{}
}

type fakeChild struct {
	mu   sync.Mutex
	code *int
}

func (c *fakeChild) HasExited() bool { c.mu.Lock(); defer c.mu.Unlock(); return c.code != nil }
func (c *fakeChild) ExitCode() (int, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.code == nil {
		return 0, false
	}
	return *c.code, true
}

func (f *fakeSidecar) launcher() Launcher {
	return func(_ context.Context, program string, args ...string) (Child, error) {
		f.mu.Lock()
		f.launches = append(f.launches, append([]string{program}, args...))
		launchErr := f.launchErr
		f.mu.Unlock()
		if launchErr != nil {
			return nil, launchErr
		}
		child := &fakeChild{}
		go func() {
			code := f.run(args)
			child.mu.Lock()
			child.code = &code
			child.mu.Unlock()
		}()
		return child, nil
	}
}

func (f *fakeSidecar) transcriptions() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.transcribed...)
}

func (f *fakeSidecar) lastArgs() map[string]string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return flags(f.launches[len(f.launches)-1])
}

func flags(args []string) map[string]string {
	values := map[string]string{}
	for i := 0; i < len(args); i++ {
		if !strings.HasPrefix(args[i], "--") {
			continue
		}
		if i+1 < len(args) && !strings.HasPrefix(args[i+1], "--") {
			values[args[i]] = args[i+1]
			i++
		} else {
			values[args[i]] = "true"
		}
	}
	return values
}

func progressLine(path, stage string, pct int, message string) {
	_ = os.WriteFile(path, []byte(fmt.Sprintf("%s|%d|%s\n", stage, pct, message)), 0o600)
}

func (f *fakeSidecar) run(args []string) int {
	values := flags(args)
	progress := values["--progress"]
	progressLine(progress, "START", 0, "Starting...")
	raw, err := os.ReadFile(values["--manifest"])
	if err != nil {
		return 1
	}
	var manifest Manifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return 1
	}
	var items []string
	var last *ManifestItem // the last analyzed item
	done := 0
	for _, item := range manifest.Items {
		if item.Muted {
			items = append(items, fmt.Sprintf(`COVERAGE_ITEM|{"index":%d,"itemGuid":%q,"status":"muted","words":null,"playedSeconds":%g,"wordCount":0,"model":null,"language":null}`, item.Index, item.ItemGUID, item.Length))
			continue
		}
		if _, err := os.Stat(progress + ".cancel"); err == nil {
			progressLine(progress, "CANCELLED", 0, "Cancelled by user")
			return exitCancelled
		}
		path := filepath.Join(values["--words-dir"], item.WordsFile)
		source := "reused"
		if header, ok := readHeader(path); !ok || !header.covers(item.StartOffset, item.StartOffset+item.Length) {
			source = "transcribed"
			words := fmt.Sprintf(`{"schemaVersion":1,"sourceStart":%g,"sourceEnd":%g,"words":[["alice",%g,%g]],"transcription":{"model":%q,"language":"en","hotwordsHash":null,"vadFilter":true}}`,
				item.StartOffset, item.StartOffset+item.Length, item.StartOffset, item.StartOffset+0.3, values["--model"])
			if err := writeAtomically(path, []byte(words)); err != nil {
				return 1
			}
			f.mu.Lock()
			f.transcribed = append(f.transcribed, item.ItemGUID)
			done = len(f.transcribed)
			pause := f.pauseAfter > 0 && done == f.pauseAfter
			f.mu.Unlock()
			progressLine(progress, "TRANSCRIBE", 50, "Transcribed an item")
			if pause {
				close(f.paused)
				<-f.resume
			}
		}
		last = &item
		items = append(items, fmt.Sprintf(`COVERAGE_ITEM|{"index":%d,"itemGuid":%q,"status":"analyzed","words":%q,"playedSeconds":%g,"wordCount":1,"model":%q,"language":"en"}`, item.Index, item.ItemGUID, source, item.Length, values["--model"]))
	}
	if f.during != nil {
		f.during()
	}
	if f.exitCode != 0 {
		progressLine(progress, "ERROR", 0, f.errorMessage)
		return f.exitCode
	}
	results := "COVERAGE|not json\n"
	if len(f.results) > 0 {
		results = strings.Join(f.results, "\n") + "\n"
	} else if !f.badResults {
		present := f.present
		if present == 0 {
			present = 10
		}
		results = fmt.Sprintf(`COVERAGE|{"schemaVersion":1,"chapterId":%q,"bodyTokens":10,"presentTokens":%d,"missingTokens":%d,"extraTokens":0,"longestMissingRun":%d,"alignment":{"maxMisreadRun":%s,"minAnchorRun":%s},"items":{"analyzed":0,"muted":0,"playedSeconds":0,"transcribed":0,"reused":0},"analysis":{"model":%q,"language":null,"equivalencesHash":null}}`+"\n",
			values["--chapter-id"], present, 10-present, 10-present, values["--max-misread-run"], values["--min-anchor-run"], values["--model"])
		results += strings.Join(items, "\n") + "\n"
		results += fmt.Sprintf(`COVERAGE_PARAGRAPH|{"id":"p-000001","tokens":10,"present":%d,"longestMissingRun":%d}`+"\n", present, 10-present)
		if present < 10 {
			// A tail sits after, and is bounded by, the end of the last item's one word, "alice".
			end := "null"
			if last != nil {
				end = fmt.Sprintf(`{"itemIndex":%d,"itemGuid":%q,"sourceTime":%g}`, last.Index, last.ItemGUID, last.StartOffset+0.3)
			}
			results += fmt.Sprintf(`COVERAGE_REGION|{"kind":"tail","paragraphIds":["p-000001"],"tokenCount":%d,"firstWord":"very","lastWord":"tired.","position":%s,"before":%s,"after":null}`+"\n",
				10-present, end, end)
		}
	}
	if err := writeAtomically(values["--out"], []byte(results)); err != nil {
		return 1
	}
	progressLine(progress, "DONE", 100, "Finished")
	return 0
}

func readHeader(path string) (wordsRange, bool) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return wordsRange{}, false
	}
	return readWordsRange(raw)
}
