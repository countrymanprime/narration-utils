//go:build latency

package latency

// How to run (from apps/desktop; not part of the gate, it takes minutes):
//
//	LATENCY_PYTHON=<repo>/.venv/Scripts/python.exe LATENCY_BACKEND=<repo>/sidecars/manuscript-guide/core/manuscript_guide.py \
//	  go test -tags latency -run TestLatency -count=1 -timeout 60m -v ./internal/latency
//
// For the frozen release sidecar (build it with scripts/release/prepare-resources.py) leave LATENCY_BACKEND empty and point
// LATENCY_PYTHON at the frozen manuscript-guide executable.
//
// LATENCY_GO_ONLY=1 runs only the Go calls (no Python needed). Optional: LATENCY_RUNS (default 20), LATENCY_MANUSCRIPT (a real canonical manuscript.json for the full-length case; the harness
// otherwise generates a 90,000 word one), LATENCY_RPP (a .rpp to parse for the tracks call; it is copied first), LATENCY_OUT (a file
// the markdown table is written to) and LATENCY_LABEL (a name for this run, such as "dev venv" or "frozen").
//
// The first run of each operation is reported on its own because it is the closest an unprivileged process gets to a cold start (the
// operating system's file cache cannot be dropped without administrator rights); p50, p95 and max cover the runs after it.

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/guide"
	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
	"github.com/countrymanprime/narration-utils/shell/internal/process"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

type sample struct {
	name  string
	first time.Duration
	rest  []time.Duration
}

func (s sample) percentile(p float64) time.Duration {
	if len(s.rest) == 0 {
		return s.first
	}
	sorted := append([]time.Duration(nil), s.rest...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	index := int(float64(len(sorted)-1)*p + 0.5)
	return sorted[index]
}

func (s sample) max() time.Duration {
	longest := s.first
	for _, d := range s.rest {
		if d > longest {
			longest = d
		}
	}
	return longest
}

func ms(d time.Duration) string { return fmt.Sprintf("%.0f", float64(d.Microseconds())/1000) }

// measure runs setup (untimed) and op (timed) runs times and keeps every duration.
func measure(t *testing.T, name string, runs int, setup func(i int), op func(i int) error) sample {
	t.Helper()
	result := sample{name: name}
	for i := 0; i < runs; i++ {
		if setup != nil {
			setup(i)
		}
		start := time.Now()
		if err := op(i); err != nil {
			t.Fatalf("%s run %d: %v", name, i, err)
		}
		took := time.Since(start)
		if i == 0 {
			result.first = took
		} else {
			result.rest = append(result.rest, took)
		}
	}
	return result
}

// words and names feed a deterministic text generator; the names repeat mid-sentence so a rule based build finds entities.
var words = strings.Fields("the door was open and rain fell on stone while a quiet wind moved through hall toward river bridge morning light old road " +
	"lantern shadow market horse letter window garden after before under above small long dark bright cold warm heard saw knew said walked turned")
var names = []string{"Aldric", "Mirelle", "Dawnspire", "Corvane", "Thessaly", "Harrowgate", "Ombrel", "Vasquin", "Eldermoor", "Quillon"}

func sentence(r *rand.Rand) string {
	var b strings.Builder
	n := 7 + r.Intn(8)
	for i := 0; i < n; i++ {
		if i > 0 {
			b.WriteByte(' ')
		}
		if i > 0 && r.Intn(6) == 0 {
			b.WriteString(names[r.Intn(len(names))])
			continue
		}
		w := words[r.Intn(len(words))]
		if i == 0 {
			w = strings.ToUpper(w[:1]) + w[1:]
		}
		b.WriteString(w)
	}
	b.WriteByte('.')
	return b.String()
}

// synthManuscript writes a canonical manuscript of about chapters*perChapter*100 words and returns its word count.
func synthManuscript(path string, chapters, perChapter int) (int, error) {
	r := rand.New(rand.NewSource(7))
	var chapterList, paragraphList []map[string]any
	total, index := 0, 0
	for c := 0; c < chapters; c++ {
		id := fmt.Sprintf("ch%03d", c+1)
		title := fmt.Sprintf("Chapter %d", c+1)
		chapterList = append(chapterList, map[string]any{"id": id, "title": title, "contentKind": "narration", "index": c})
		for p := 0; p < perChapter; p++ {
			var text []string
			for s := 0; s < 7; s++ {
				text = append(text, sentence(r))
			}
			body := strings.Join(text, " ")
			total += len(strings.Fields(body))
			paragraphList = append(paragraphList, map[string]any{"id": fmt.Sprintf("p%05d", index), "chapterId": id, "chapterTitle": title, "text": body, "index": index})
			index++
		}
	}
	document := map[string]any{"schemaVersion": 1, "documentId": "latency", "importedAt": "2026-01-01T00:00:00Z", "chapters": chapterList, "paragraphs": paragraphList}
	raw, err := json.Marshal(document)
	if err != nil {
		return 0, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return 0, err
	}
	return total, os.WriteFile(path, raw, 0o644)
}

func envInt(name string, fallback int) int {
	if value, err := strconv.Atoi(os.Getenv(name)); err == nil && value > 0 {
		return value
	}
	return fallback
}

func newService(t *testing.T, project, python, backend string) *guide.Service {
	t.Helper()
	root := t.TempDir()
	return guide.New(project, python, backend, settings.New(root, project), process.NewSupervisor())
}

// storyBibleOperations measures every Story Bible operation the interface offers against one manuscript.
func storyBibleOperations(t *testing.T, label string, project string, svc *guide.Service, runs int) []sample {
	t.Helper()
	var out []sample
	progress, log := filepath.Join(project, "progress.txt"), filepath.Join(project, "log.txt")
	out = append(out, measure(t, label+" build", envInt("LATENCY_BUILD_RUNS", runs), nil, func(int) error { _, err := svc.Build(progress, log); return err }))

	create := func(name string) string {
		id, err := svc.Create(name, "Character", nil)
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		return id
	}
	// The fixture entity every edit-like operation works on; its name occurs often, so a rescan has work to do.
	subject, other := findOrCreate(t, svc, "Aldric"), findOrCreate(t, svc, "Mirelle")
	seq := 0
	unique := func(prefix string) string { seq++; return fmt.Sprintf("%s %d", prefix, seq) }

	out = append(out, measure(t, label+" create", runs, nil, func(int) error { _, err := svc.Create(unique("Zed"), "Character", nil); return err }))
	out = append(out, measure(t, label+" edit, 1 field", runs, nil, func(i int) error { return svc.Edit(subject, "description", fmt.Sprintf("Description %d", i)) }))
	out = append(out, measure(t, label+" edit, aliases (pronunciation)", runs, nil, func(i int) error { return svc.Edit(subject, "aliases", fmt.Sprintf("Ald %d;Old Ald", i)) }))
	// A Save sends four fields. The host used to start one process per field (the first row, kept to measure the difference) and now starts one.
	// The name is left as it is, so the rescan below still has the same name to look for.
	save := map[string]string{"description": "d", "personality": "p", "context": "c"}
	out = append(out, measure(t, label+" Save, 4 fields (one process per field, the old way)", runs, nil, func(i int) error {
		if err := svc.Edit(subject, "canonical_name", "Aldric"); err != nil {
			return err
		}
		for field, value := range save {
			if err := svc.Edit(subject, field, fmt.Sprintf("%s %d", value, i)); err != nil {
				return err
			}
		}
		return nil
	}))
	out = append(out, measure(t, label+" Save, 4 fields (one process)", runs, nil, func(i int) error {
		values := map[string]string{"canonical_name": "Aldric"}
		for field, value := range save {
			values[field] = fmt.Sprintf("%s %d", value, i)
		}
		return svc.EditFields(subject, values)
	}))
	out = append(out, measure(t, label+" setLocked", runs, nil, func(i int) error { return svc.Edit(subject, "locked", fmt.Sprint(i%2 == 0)) }))
	if err := svc.Edit(subject, "locked", "false"); err != nil {
		t.Fatalf("unlock: %v", err)
	}
	out = append(out, measure(t, label+" rescan", runs, nil, func(int) error { return svc.Rescan(subject) }))
	var doomed []string
	out = append(out, measure(t, label+" delete", runs, func(int) { doomed = append(doomed, create(unique("Doomed"))) }, func(i int) error { return svc.Delete(doomed[i]) }))
	var sources, targets []string
	out = append(out, measure(t, label+" merge", runs, func(int) {
		sources, targets = append(sources, create(unique("Source"))), append(targets, create(unique("Target")))
	}, func(i int) error { return svc.Merge(sources[i], targets[i]) }))
	out = append(out, measure(t, label+" relate", runs, nil, func(i int) error { return svc.Relate(subject, other, fmt.Sprintf("ally %d", i)) }))
	out = append(out, measure(t, label+" seed 10 candidates (10 spawns)", envInt("LATENCY_SEED_RUNS", 5), nil, func(int) error {
		for c := 0; c < 10; c++ {
			if _, err := svc.Create(unique("Cand"), "Character", nil); err != nil {
				return err
			}
		}
		return nil
	}))
	// A preview needs an installed Piper voice, which the harness does not download. Asking for a voice that does not exist measures
	// everything before the voice loads (start, imports, reading the guide) and stops there: a lower bound for an uncached preview.
	audio := filepath.Join(project, "audio")
	out = append(out, measure(t, label+" preview, lower bound (bad model path)", runs, nil, func(i int) error {
		_, err := svc.Run("render-audio", "--guide", filepath.Join(project, "ManuscriptGuide", "manuscript_guide.json"), "--entity-id", subject, "--audio-dir", audio,
			"--piper-model", filepath.Join(project, "no-such-voice.onnx"), "--output-name", fmt.Sprintf("x%d.wav", i))
		if err == nil {
			return fmt.Errorf("a missing voice unexpectedly rendered")
		}
		return nil
	}))
	return out
}

// findOrCreate returns the id of the entity with that name, which the build usually found, or makes it.
func findOrCreate(t *testing.T, svc *guide.Service, name string) string {
	t.Helper()
	entities, err := svc.Entities()
	if err != nil {
		t.Fatal(err)
	}
	for _, entity := range entities {
		if entity["canonical_name"] == name {
			return fmt.Sprint(entity["id"])
		}
	}
	id, err := svc.Create(name, "Character", nil)
	if err != nil {
		t.Fatalf("create %s: %v", name, err)
	}
	return id
}

func writeTable(t *testing.T, header string, rows []sample) string {
	t.Helper()
	var b strings.Builder
	fmt.Fprintf(&b, "%s\n\n| Operation | Runs | First (ms) | p50 (ms) | p95 (ms) | Max (ms) |\n| --- | --- | --- | --- | --- | --- |\n", header)
	for _, row := range rows {
		fmt.Fprintf(&b, "| %s | %d | %s | %s | %s | %s |\n", row.name, len(row.rest)+1, ms(row.first), ms(row.percentile(0.5)), ms(row.percentile(0.95)), ms(row.max()))
	}
	return b.String()
}

func TestLatency(t *testing.T) {
	python, backend := os.Getenv("LATENCY_PYTHON"), os.Getenv("LATENCY_BACKEND")
	goOnly := os.Getenv("LATENCY_GO_ONLY") != ""
	if python == "" && !goOnly {
		t.Skip("set LATENCY_PYTHON (and LATENCY_BACKEND for a source run) to run the harness, or LATENCY_GO_ONLY for the Go calls alone")
	}
	runs := envInt("LATENCY_RUNS", 20)
	label := os.Getenv("LATENCY_LABEL")
	if label == "" {
		label = "run"
	}
	var report strings.Builder

	full := t.TempDir()
	target := filepath.Join(full, "narration-utils", "manuscript", "manuscript.json")
	fullWords := 0
	if supplied := os.Getenv("LATENCY_MANUSCRIPT"); supplied != "" {
		raw, err := os.ReadFile(supplied)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, raw, 0o644); err != nil {
			t.Fatal(err)
		}
	} else {
		var err error
		if fullWords, err = synthManuscript(target, 30, 40); err != nil {
			t.Fatal(err)
		}
	}
	if !goOnly {
		small := t.TempDir()
		smallWords, err := synthManuscript(filepath.Join(small, "narration-utils", "manuscript", "manuscript.json"), 3, 10)
		if err != nil {
			t.Fatal(err)
		}
		report.WriteString(writeTable(t, fmt.Sprintf("### %s, small manuscript (%d words, 3 chapters)", label, smallWords), storyBibleOperations(t, "small", small, newService(t, small, python, backend), runs)))
		report.WriteString("\n" + writeTable(t, fmt.Sprintf("### %s, full-length manuscript (%d words, 30 chapters)", label, fullWords), storyBibleOperations(t, "full", full, newService(t, full, python, backend), runs)))
	}

	notes := manuscript.New(full)
	var goNative []sample
	goNative = append(goNative, measure(t, "manuscript Chapters (full)", runs, nil, func(int) error { _, err := notes.Chapters(); return err }))
	goNative = append(goNative, measure(t, "manuscript Search, common word (full)", runs, nil, func(int) error { _, err := notes.Search("the"); return err }))
	goNative = append(goNative, measure(t, "manuscript Reader (full)", runs, nil, func(int) error { _, err := notes.Reader(); return err }))
	if rpp := os.Getenv("LATENCY_RPP"); rpp != "" {
		raw, err := os.ReadFile(rpp)
		if err != nil {
			t.Fatal(err)
		}
		copyPath := filepath.Join(t.TempDir(), "copy.rpp")
		if err := os.WriteFile(copyPath, raw, 0o644); err != nil {
			t.Fatal(err)
		}
		goNative = append(goNative, measure(t, fmt.Sprintf("tracks.Parse (%d KB .rpp)", len(raw)/1024), runs, nil, func(int) error { _, err := tracks.Parse(copyPath); return err }))
	}
	store := settings.New(t.TempDir(), t.TempDir())
	goNative = append(goNative, measure(t, "settings Save, 1 field", runs, nil, func(i int) error {
		value := fmt.Sprint(i)
		return store.Save("TranscriptCompare", "project", map[string]*string{"model_size": &value})
	}))
	report.WriteString("\n" + writeTable(t, "### Go-native calls", goNative))

	t.Log("\n" + report.String())
	if out := os.Getenv("LATENCY_OUT"); out != "" {
		if err := os.WriteFile(out, []byte(report.String()), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}
