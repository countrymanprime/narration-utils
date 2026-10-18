package trace

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

var (
	testNote = Define("test", "note", LevelInfo,
		EnumField("kind", "a", "b"), IntField("count"), BoolField("ok"), DurField("took"),
		IDField("item"), PathField("file"), ErrField("err"), LenField("text"))
	testDebug = Define("test", "detail", LevelDebug, IntField("n"))
)

func newTestTracer(t *testing.T, opts Options) (*Tracer, string) {
	t.Helper()
	dir := t.TempDir()
	if opts.Path == "" {
		opts.Path = filepath.Join(dir, "trace.jsonl")
	}
	if opts.Now == nil {
		opts.Now = func() time.Time { return time.Date(2026, 10, 18, 9, 30, 0, 0, time.UTC) }
	}
	if opts.Home == "" {
		opts.Home = `C:\Users\CANARYUSER`
	}
	if opts.SessionID == "" {
		opts.SessionID = "sess0001"
	}
	tracer := New(opts)
	t.Cleanup(tracer.Close)
	return tracer, opts.Path
}

func readLines(t *testing.T, path string) []map[string]any {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	var out []map[string]any
	for _, line := range bytes.Split(bytes.TrimSpace(data), []byte("\n")) {
		var record map[string]any
		if err := json.Unmarshal(line, &record); err != nil {
			t.Fatalf("not JSON: %q: %v", line, err)
		}
		out = append(out, record)
	}
	return out
}

func TestOffByDefaultWritesNothingToDiskButKeepsTheRing(t *testing.T) {
	tracer, path := newTestTracer(t, Options{})
	tracer.Emit(testNote, IntValue("count", 3))
	tracer.Flush()
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("a disabled tracer created %s (err=%v)", path, err)
	}
	if got := len(tracer.Snapshot()); got != 1 {
		t.Fatalf("ring holds %d records, want 1", got)
	}
}

func TestEnabledWritesTheEnvelopeAndFields(t *testing.T) {
	tracer, path := newTestTracer(t, Options{})
	tracer.SetEnabled(true)
	tracer.Emit(testNote, EnumValue("kind", "a"), IntValue("count", 7), BoolValue("ok", true), DurValue("took", 1500*time.Millisecond), IDValue("item", "chapter-3"))
	tracer.Flush()
	records := readLines(t, path)
	if len(records) != 1 {
		t.Fatalf("got %d records, want 1", len(records))
	}
	got := records[0]
	for key, want := range map[string]any{"ts": "2026-10-18T09:30:00.000Z", "level": "info", "sess": "sess0001", "area": "test", "event": "note", "kind": "a", "count": float64(7), "ok": true, "took_ms": float64(1500), "item": "chapter-3", "seq": float64(1)} {
		if got[key] != want {
			t.Errorf("%s = %v, want %v", key, got[key], want)
		}
	}
}

func TestADebugEventNeedsDebugOn(t *testing.T) {
	tracer, path := newTestTracer(t, Options{})
	tracer.SetEnabled(true)
	tracer.Emit(testDebug, IntValue("n", 1))
	tracer.SetDebug(true)
	tracer.Emit(testDebug, IntValue("n", 2))
	tracer.Flush()
	records := readLines(t, path)
	if len(records) != 1 || records[0]["n"] != float64(2) {
		t.Fatalf("records = %v, want only n=2", records)
	}
}

func TestAFieldOutsideTheRegistryIsDroppedAndCounted(t *testing.T) {
	tracer, path := newTestTracer(t, Options{})
	tracer.SetEnabled(true)
	tracer.Emit(testNote,
		IntValue("surprise", 1),                  // not in the definition
		BoolValue("count", true),                 // wrong kind
		EnumValue("kind", "c"),                   // not an allowed value
		IDValue("item", "Has Spaces"),            // not an opaque id
		IDValue("item", strings.Repeat("a", 65)), // too long
		IntValue("count", 2),
	)
	tracer.Flush()
	got := readLines(t, path)[0]
	for _, key := range []string{"surprise", "kind", "item"} {
		if _, present := got[key]; present {
			t.Errorf("%s was written", key)
		}
	}
	if got["count"] != float64(2) {
		t.Errorf("count = %v, want 2", got["count"])
	}
	if dropped := tracer.Dropped(); dropped != 5 {
		t.Errorf("dropped = %d, want 5", dropped)
	}
}

func TestNoCanaryReachesTheTrace(t *testing.T) {
	tracer, path := newTestTracer(t, Options{ProjectRoot: `D:\Books\CANARYPROJECT`})
	tracer.SetEnabled(true)
	secret := `C:\Users\CANARYUSER\Documents\CANARY_Chapter One.docx`
	tracer.Emit(testNote,
		PathValue("file", secret),
		ErrValue("err", fmt.Errorf("open %s: %w", secret, os.ErrNotExist)),
		LenValue("text", "CANARY_TEXT the narrator typed"),
		IDValue("item", "CANARY_ID with spaces"),
		EnumValue("kind", "CANARY_ENUM"),
	)
	tracer.Flush()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, canary := range []string{"CANARY", "canary", "Chapter", "chapter one", "Users", "Documents"} {
		if bytes.Contains(data, []byte(canary)) {
			t.Errorf("the trace holds %q: %s", canary, data)
		}
	}
	for _, canary := range tracer.Snapshot() {
		if bytes.Contains(canary, []byte("CANARY")) {
			t.Errorf("the ring holds a canary: %s", canary)
		}
	}
}

func TestAPathIsReducedToClassExtensionAndAStableHash(t *testing.T) {
	cases := []struct {
		name, path, class string
	}{
		{"inside the project", `D:\Books\Proj\ch1.wav`, "project"},
		{"project, other case and slashes", `d:/books/proj/ch1.wav`, "project"},
		{"user profile", `C:\Users\CANARYUSER\Music\a.wav`, "user_profile"},
		{"network share", `\\server\share\a.wav`, "network"},
		{"elsewhere", `E:\Other\a.wav`, "other"},
		{"relative", `a.wav`, "other"},
	}
	tracer, path := newTestTracer(t, Options{ProjectRoot: `D:\Books\Proj`})
	tracer.SetEnabled(true)
	for _, tc := range cases {
		tracer.Emit(testNote, PathValue("file", tc.path))
	}
	tracer.Flush()
	records := readLines(t, path)
	hash := regexp.MustCompile(`^[0-9a-f]{8}$`)
	for i, tc := range cases {
		file, _ := records[i]["file"].(map[string]any)
		if file["class"] != tc.class {
			t.Errorf("%s: class = %v, want %s", tc.name, file["class"], tc.class)
		}
		if file["ext"] != ".wav" {
			t.Errorf("%s: ext = %v, want .wav", tc.name, file["ext"])
		}
		if h, _ := file["h"].(string); !hash.MatchString(h) {
			t.Errorf("%s: h = %v, want 8 hex", tc.name, file["h"])
		}
	}
	first, _ := records[0]["file"].(map[string]any)
	second, _ := records[1]["file"].(map[string]any)
	if first["h"] != second["h"] {
		t.Errorf("one path in two spellings hashed to %v and %v", first["h"], second["h"])
	}
}

func TestTheSaltIsPerInstallAndStable(t *testing.T) {
	dir := t.TempDir()
	hashOf := func(opts Options) string {
		tracer, path := newTestTracer(t, opts)
		tracer.SetEnabled(true)
		tracer.Emit(testNote, PathValue("file", `E:\a\b.wav`))
		tracer.Flush()
		file, _ := readLines(t, path)[0]["file"].(map[string]any)
		return file["h"].(string)
	}
	a := hashOf(Options{SaltPath: filepath.Join(dir, "one.salt")})
	b := hashOf(Options{SaltPath: filepath.Join(dir, "one.salt")})
	c := hashOf(Options{SaltPath: filepath.Join(dir, "two.salt")})
	if a != b {
		t.Errorf("the same install hashed one path to %s then %s", a, b)
	}
	if a == c {
		t.Errorf("two installs hashed one path to the same value %s", a)
	}
}

func TestErrorClasses(t *testing.T) {
	cases := []struct {
		err  error
		want string
	}{
		{nil, "none"},
		{os.ErrNotExist, "not_found"},
		{fmt.Errorf("wrapped: %w", os.ErrPermission), "permission"},
		{os.ErrExist, "exists"},
		{context.DeadlineExceeded, "timeout"},
		{context.Canceled, "canceled"},
		{errors.New("something with C:\\Users\\X in it"), "other"},
	}
	for _, tc := range cases {
		if got := ErrorClass(tc.err); got != tc.want {
			t.Errorf("ErrorClass(%v) = %q, want %q", tc.err, got, tc.want)
		}
	}
}

func TestLengthBuckets(t *testing.T) {
	for text, want := range map[string]string{"": "0", "a": "1-9", "123456789": "1-9", "1234567890": "10-99", strings.Repeat("x", 100): "100-999", strings.Repeat("x", 1000): "1000+"} {
		if got := LengthBucket(text); got != want {
			t.Errorf("LengthBucket(%d chars) = %q, want %q", len(text), got, want)
		}
	}
	if got := LengthBucket("日本語"); got != "1-9" {
		t.Errorf("LengthBucket counts bytes, not characters: %q", got)
	}
}

func TestTheFileRotatesToTwoBackups(t *testing.T) {
	tracer, path := newTestTracer(t, Options{MaxBytes: 400})
	tracer.SetEnabled(true)
	for i := 0; i < 60; i++ {
		tracer.Emit(testNote, IntValue("count", int64(i)))
		tracer.Flush()
	}
	for _, name := range []string{path, path + ".1", path + ".2"} {
		if _, err := os.Stat(name); err != nil {
			t.Errorf("missing %s: %v", name, err)
		}
	}
	if _, err := os.Stat(path + ".3"); !os.IsNotExist(err) {
		t.Errorf("a third backup exists (err=%v)", err)
	}
	if info, _ := os.Stat(path); info.Size() > 400 {
		t.Errorf("the live file is %d bytes, over the cap", info.Size())
	}
}

func TestTheRingKeepsTheNewestRecords(t *testing.T) {
	tracer, _ := newTestTracer(t, Options{RingSize: 3})
	for i := 1; i <= 5; i++ {
		tracer.Emit(testNote, IntValue("count", int64(i)))
	}
	snapshot := tracer.Snapshot()
	if len(snapshot) != 3 {
		t.Fatalf("ring holds %d, want 3", len(snapshot))
	}
	if !bytes.Contains(snapshot[0], []byte(`"count":3`)) || !bytes.Contains(snapshot[2], []byte(`"count":5`)) {
		t.Errorf("ring = %s", snapshot)
	}
}

func TestANilTracerAcceptsEverything(t *testing.T) {
	var tracer *Tracer
	tracer.SetEnabled(true)
	tracer.SetDebug(true)
	tracer.Emit(testNote, IntValue("count", 1))
	tracer.Flush()
	tracer.Close()
	if tracer.Enabled() || tracer.Dropped() != 0 || tracer.Snapshot() != nil || tracer.Path() != "" {
		t.Error("a nil tracer reported state")
	}
}

// TestThePackageCannotFormatFreeText is the lint rule of docs/prds/activity-trace.prd.md: a record is built from typed
// fields only, so the non-test files import neither fmt nor log/slog (the two ways free text gets into a line).
func TestThePackageCannotFormatFreeText(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		if strings.HasSuffix(file, "_test.go") {
			continue
		}
		parsed, err := parser.ParseFile(token.NewFileSet(), file, nil, parser.ImportsOnly)
		if err != nil {
			t.Fatal(err)
		}
		for _, spec := range parsed.Imports {
			switch spec.Path.Value {
			case `"fmt"`, `"log/slog"`, `"log"`:
				t.Errorf("%s imports %s", file, spec.Path.Value)
			}
		}
	}
}

func TestDefineRefusesADuplicateOrABadName(t *testing.T) {
	for name, define := range map[string]func(){
		"duplicate event": func() { Define("test", "note", LevelInfo) },
		"bad name":        func() { Define("test", "Bad Name", LevelInfo) },
		"duplicate field": func() { Define("test", "twice", LevelInfo, IntField("a"), IntField("a")) },
		"reserved field":  func() { Define("test", "reserved", LevelInfo, IntField("ts")) },
	} {
		func() {
			defer func() {
				if recover() == nil {
					t.Errorf("%s did not panic", name)
				}
			}()
			define()
		}()
	}
}
