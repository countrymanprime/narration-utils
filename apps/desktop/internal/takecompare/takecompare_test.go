package takecompare

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"math"
	"math/rand"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// goldenResults is the results file the sidecar really writes for three takes of one span (a clean read, a misread and
// a skipped word), pinned by sidecars/transcript-compare/tests/test_take_divergence_mode.py.
func goldenResults(t *testing.T) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "tests", "fixtures", "contracts", "take-divergence-results.json"))
	if err != nil {
		t.Fatal(err)
	}
	var golden struct {
		Lines []string `json:"lines"`
	}
	if err := json.Unmarshal(raw, &golden); err != nil {
		t.Fatal(err)
	}
	return strings.Join(golden.Lines, "\n") + "\n"
}

const sampleRate = 16000

// writeWAV writes a mono 16-bit WAV of seconds of a 220 Hz tone at amplitude in every other second (the pauses between
// them stand for the room between phrases), plus uniform noise at noise throughout (both as a fraction of full scale),
// with a fixed seed so every run writes the same file.
func writeWAV(t *testing.T, path string, seconds, amplitude, noise float64) {
	t.Helper()
	frames := int(seconds * sampleRate)
	random := rand.New(rand.NewSource(7))
	data := make([]byte, 44+frames*2)
	copy(data, "RIFF")
	binary.LittleEndian.PutUint32(data[4:], uint32(36+frames*2))
	copy(data[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(data[16:], 16)
	binary.LittleEndian.PutUint16(data[20:], 1)
	binary.LittleEndian.PutUint16(data[22:], 1)
	binary.LittleEndian.PutUint32(data[24:], sampleRate)
	binary.LittleEndian.PutUint32(data[28:], sampleRate*2)
	binary.LittleEndian.PutUint16(data[32:], 2)
	binary.LittleEndian.PutUint16(data[34:], 16)
	copy(data[36:], "data")
	binary.LittleEndian.PutUint32(data[40:], uint32(frames*2))
	for i := 0; i < frames; i++ {
		value := noise * (2*random.Float64() - 1)
		if (i/sampleRate)%2 == 0 {
			value += amplitude * math.Sin(2*math.Pi*220*float64(i)/sampleRate)
		}
		binary.LittleEndian.PutUint16(data[44+i*2:], uint16(int16(math.Round(value*32767))))
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func item(guid, take, file string, position, soffs float64) tracks.Item {
	return tracks.Item{
		Position: position, Length: 8, SourceKind: "WAVE", SourceFile: file, SourceAvailable: true, Supported: true, GUID: guid,
		Takes: []tracks.Take{{GUID: take, SourceKind: "WAVE", SourceFile: file, SourceAvailable: true, Supported: true, Active: true, SOFFS: soffs, PlayRate: 1}},
	}
}

// fixture is a project with the three reads the golden results name, each its own item on one track: read A is noisy
// but read word for word, read B is clean but misreads a word, read C is clean and skips one, and a fourth item after
// them is a neighbour for level consistency.
type fixture struct {
	dir     string
	project tracks.Project
	group   findings.Finding
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	dir := t.TempDir()
	files := map[string]string{}
	for name, noise := range map[string]float64{"read-a.wav": 0.05, "read-b.wav": 0.0005, "read-c.wav": 0.0005, "next.wav": 0.0005} {
		files[name] = filepath.Join(dir, name)
		writeWAV(t, files[name], 10, 0.25, noise)
	}
	project := tracks.Project{Path: filepath.Join(dir, "book.rpp"), Tracks: []tracks.Track{{Name: "Chapter 1", Items: []tracks.Item{
		item("{ITEM-A}", "{TAKE-A}", files["read-a.wav"], 0, 0),
		item("{ITEM-B}", "{TAKE-B}", files["read-b.wav"], 10, 1.5),
		item("{ITEM-C}", "{TAKE-C}", files["read-c.wav"], 20, 0),
		item("{ITEM-N}", "{TAKE-N}", files["next.wav"], 30, 0),
	}}}}
	member := func(itemGUID, take, file string, start float64) map[string]any {
		return map[string]any{"item_index": 0, "item_guid": itemGUID, "take_guid": take, "source_file": file, "source_start": start, "source_length": 8.0,
			"coverage": 1.0, "quality": 0.9, "exact_copy_group": ""}
	}
	confidence := 0.9
	group := findings.Finding{
		SchemaVersion: findings.SchemaVersion, ID: "group-1", Analyzer: "take-review", Category: findings.CategoryPickup, Severity: findings.SeverityInfo,
		Confidence: &confidence, ConfidenceReason: "test", Manuscript: &findings.Manuscript{ChapterID: "Chapter-1", ChapterTitle: "Chapter 1"},
		Evidence: map[string]any{"kind": "restart", "matched_span_first": 0, "matched_span_last": 1, "members": []any{
			member("{ITEM-A}", "{TAKE-A}", files["read-a.wav"], 0),
			member("{ITEM-B}", "{TAKE-B}", files["read-b.wav"], 1.5),
			member("{ITEM-C}", "{TAKE-C}", files["read-c.wav"], 0),
		}},
		Review: findings.ReviewState{Status: findings.StatusUnreviewed},
	}
	return fixture{dir: dir, project: project, group: group}
}

type fakeRunner struct {
	output   string
	err      error
	manifest map[string]any
	request  SidecarRequest
}

func (f *fakeRunner) TakeDivergence(_ context.Context, req SidecarRequest) (string, error) {
	f.request = req
	raw, err := os.ReadFile(req.ManifestPath)
	if err != nil {
		return "", err
	}
	if err := json.Unmarshal(raw, &f.manifest); err != nil {
		return "", err
	}
	return f.output, f.err
}

func (fx fixture) request() Request {
	return Request{Group: fx.group, Project: fx.project, ProjectPath: fx.dir, ManuscriptPath: filepath.Join(fx.dir, "manuscript.json"),
		ChapterID: "ch-1", ProgressPath: filepath.Join(fx.dir, "progress.txt"), SessionDir: filepath.Join(fx.dir, "session")}
}

func compareEvidence(t *testing.T, finding findings.Finding) Evidence {
	t.Helper()
	encoded, err := json.Marshal(finding.Evidence)
	if err != nil {
		t.Fatal(err)
	}
	var evidence Evidence
	if err := json.Unmarshal(encoded, &evidence); err != nil {
		t.Fatal(err)
	}
	return evidence
}

func TestParseResultsReadsTheSidecarsOwnResults(t *testing.T) {
	results, err := ParseResults(goldenResults(t))
	if err != nil {
		t.Fatal(err)
	}
	if results.Header.ChapterID != "ch-1" || results.Header.Span.FirstUnit != 0 || results.Header.Span.LastUnit != 1 || len(results.Header.Span.Words) != 12 {
		t.Fatalf("header = %+v", results.Header)
	}
	if len(results.Takes) != 3 || results.Takes[0].Fidelity != 1 || results.Takes[1].Counts.Misread != 1 || results.Takes[2].Counts.Skipped != 1 {
		t.Fatalf("takes = %+v", results.Takes)
	}
	misread := results.Takes[1].Divergences[0]
	if misread.Kind != "misread" || misread.ManuscriptText != "tired." || misread.AudioText != "tried" || misread.Start == nil {
		t.Fatalf("misread = %+v", misread)
	}
}

func TestParseResultsRefusesAnswersThatCannotBeLinedUpWithTheSpan(t *testing.T) {
	golden := goldenResults(t)
	lines := strings.Split(strings.TrimSpace(golden), "\n")
	cases := map[string]string{
		"no span line":      lines[0] + "\n" + lines[2],
		"two span lines":    golden + lines[1] + "\n",
		"a newer schema":    strings.Replace(golden, `"schemaVersion":1`, `"schemaVersion":2`, 1),
		"broken span JSON":  lines[0] + "\nDIVERGENCE_SPAN|{\n",
		"broken take JSON":  golden + "TAKE_DIVERGENCE|{\n",
		"a word missing":    strings.Replace(golden, `{"index":11,"status":"matched","start":5.5,"end":5.9}`, ``, 1),
		"an unknown status": strings.Replace(golden, `"status":"matched"`, `"status":"guessed"`, 1),
		"words out of order": strings.Replace(golden, `{"index":0,"status":"matched","start":0.0,"end":0.4},{"index":1`,
			`{"index":1,"status":"matched","start":0.0,"end":0.4},{"index":0`, 1),
		"an empty span": strings.Replace(lines[0]+"\n"+lines[1], lines[1][strings.Index(lines[1], `"words":[`):strings.Index(lines[1], `]},"model"`)+1], `"words":[]`, 1),
	}
	for name, text := range cases {
		if _, err := ParseResults(text); err == nil {
			t.Errorf("%s: parsed without an error", name)
		}
	}
}

func TestGroupOfRefusesWhatCannotBeCompared(t *testing.T) {
	fx := newFixture(t)
	if _, err := GroupOf(fx.group); err != nil {
		t.Fatalf("the fixture group is refused: %v", err)
	}
	other := fx.group
	other.Analyzer = "transcript-compare"
	if _, err := GroupOf(other); err == nil || !strings.Contains(err.Error(), "Find pickups and duplicates") {
		t.Errorf("another analyzer's finding: %v", err)
	}
	for name, evidence := range map[string]map[string]any{
		"one read":           {"matched_span_first": 0, "matched_span_last": 1, "members": fx.group.Evidence["members"].([]any)[:1]},
		"no span":            {"members": fx.group.Evidence["members"]},
		"a backwards span":   {"matched_span_first": 2, "matched_span_last": 1, "members": fx.group.Evidence["members"]},
		"unreadable reads":   {"matched_span_first": 0, "matched_span_last": 1, "members": "reads"},
		"an unencodable map": {"matched_span_first": math.NaN()},
	} {
		broken := fx.group
		broken.Evidence = evidence
		if _, err := GroupOf(broken); err == nil {
			t.Errorf("%s: no error", name)
		}
	}
}

// The PRD's disagreement fixtures (Phase 10 success signal): a take read word for word but noisy, a clean take with a
// misread, and a clean take that skips a word are set side by side, each category on its own, and nothing orders them.
func TestCompareSetsDisagreeingTakesSideBySideWithoutRankingThem(t *testing.T) {
	fx := newFixture(t)
	runner := &fakeRunner{output: goldenResults(t)}
	store := findings.NewStore(fx.dir)
	comparer := &Comparer{Runner: runner, Store: store}

	finding, err := comparer.Compare(context.Background(), fx.request())
	if err != nil {
		t.Fatal(err)
	}
	if finding.Category != findings.CategoryTakeComparison || finding.Analyzer != AnalyzerName || finding.Confidence != nil || finding.SuggestedAction != nil {
		t.Fatalf("finding = %+v", finding)
	}
	if finding.Manuscript.ChapterID != "ch-1" || finding.Manuscript.Expected != "Alice was beginning to get very tired. She had nothing to do." {
		t.Fatalf("manuscript = %+v", finding.Manuscript)
	}
	evidence := compareEvidence(t, finding)
	if evidence.Compared != 3 || evidence.SourceFindingID != "group-1" || len(evidence.Members) != 3 {
		t.Fatalf("evidence = %+v", evidence)
	}
	a, b, c := evidence.Members[0], evidence.Members[1], evidence.Members[2]
	if *a.Fidelity != 1 || b.Counts.Misread != 1 || c.Counts.Skipped != 1 {
		t.Fatalf("fidelity a=%v b=%+v c=%+v", *a.Fidelity, b.Counts, c.Counts)
	}
	for _, member := range evidence.Members {
		if member.Metrics == nil || member.Metrics.Coverage.Measured < 4 {
			t.Fatalf("%s was not measured: %+v", member.TakeGUID, member.Metrics)
		}
	}
	// Textually right but noisy, and clean but misread: each is better in one category and worse in the other.
	if !(*a.Metrics.Noise.NoiseFloordBFS > *b.Metrics.Noise.NoiseFloordBFS+20) {
		t.Fatalf("noise floors a=%v b=%v", *a.Metrics.Noise.NoiseFloordBFS, *b.Metrics.Noise.NoiseFloordBFS)
	}
	if a.Metrics.LevelConsistency.NeighborsMeasured == 0 || c.Metrics.LevelConsistency.NeighborsMeasured != 2 {
		t.Fatalf("neighbours a=%+v c=%+v", a.Metrics.LevelConsistency, c.Metrics.LevelConsistency)
	}
	encoded, _ := json.Marshal(finding.Evidence)
	for _, word := range []string{"rank", "score", "best", "winner", "grade", "overall"} {
		if strings.Contains(strings.ToLower(string(encoded)), `"`+word) {
			t.Errorf("the evidence has a %q field", word)
		}
	}
}

// Same inputs give the same comparison, and every figure is kept with the measurement it came from.
func TestCompareIsReproducibleAndKeepsTheMeasurementsItShows(t *testing.T) {
	fx := newFixture(t)
	store := findings.NewStore(fx.dir)
	first, err := (&Comparer{Runner: &fakeRunner{output: goldenResults(t)}, Store: store}).Compare(context.Background(), fx.request())
	if err != nil {
		t.Fatal(err)
	}
	second, err := (&Comparer{Runner: &fakeRunner{output: goldenResults(t)}, Store: store}).Compare(context.Background(), fx.request())
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID || first.EvidenceVersion != second.EvidenceVersion || !reflect.DeepEqual(first.Evidence, second.Evidence) {
		t.Fatal("comparing the same takes twice gave different evidence")
	}
	for _, member := range compareEvidence(t, second).Members {
		metrics := member.Metrics
		if metrics.Audio == nil || *metrics.Clipping.FullScaleSamples != metrics.Audio.FullScaleSamples || metrics.Noise.NoiseFloordBFS != metrics.Audio.NoiseFloordBFS &&
			*metrics.Noise.NoiseFloordBFS != *metrics.Audio.NoiseFloordBFS {
			t.Fatalf("%s: a figure is not the stored measurement's", member.TakeGUID)
		}
	}
	listed, err := store.List(findings.Query{Analyzer: AnalyzerName})
	if err != nil || len(listed) != 1 {
		t.Fatalf("store holds %d comparisons (%v), want 1", len(listed), err)
	}
}

// The manifest the sidecar reads is built from the saved project, never from the finding's own text.
func TestCompareWritesTheManifestFromTheSavedProject(t *testing.T) {
	fx := newFixture(t)
	members := fx.group.Evidence["members"].([]any)
	members[0].(map[string]any)["source_file"] = strings.ToUpper(members[0].(map[string]any)["source_file"].(string))
	runner := &fakeRunner{output: goldenResults(t)}
	if _, err := (&Comparer{Runner: runner, Store: findings.NewStore(fx.dir)}).Compare(context.Background(), fx.request()); err != nil {
		t.Fatal(err)
	}
	if runner.manifest["chapterId"] != "ch-1" || !reflect.DeepEqual(runner.manifest["span"], map[string]any{"firstUnit": 0.0, "lastUnit": 1.0}) {
		t.Fatalf("manifest = %v", runner.manifest)
	}
	takes := runner.manifest["takes"].([]any)
	first := takes[0].(map[string]any)
	if first["sourceFile"] != fx.project.Tracks[0].Items[0].Takes[0].SourceFile || first["takeGuid"] != "{TAKE-A}" || takes[1].(map[string]any)["startOffset"] != 1.5 {
		t.Fatalf("takes = %v", takes)
	}
	if _, err := os.Stat(runner.request.ManifestPath); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("the manifest was left behind: %v", err)
	}
	if runner.request.ProgressPath != fx.request().ProgressPath || runner.request.ManuscriptPath != fx.request().ManuscriptPath {
		t.Errorf("request = %+v", runner.request)
	}
}

// A read the saved project no longer has as the scan found it is listed with its reason and never aligned or measured.
func TestCompareLeavesOutReadsThatChangedSinceTheScan(t *testing.T) {
	fx := newFixture(t)
	items := fx.project.Tracks[0].Items
	items[2].Takes[0].SOFFS = 0.5 // read C was trimmed
	golden := goldenResults(t)
	twoTakes := golden[:strings.LastIndex(strings.TrimSpace(golden), "\n")+1]
	runner := &fakeRunner{output: twoTakes}
	finding, err := (&Comparer{Runner: runner, Store: findings.NewStore(fx.dir)}).Compare(context.Background(), fx.request())
	if err != nil {
		t.Fatal(err)
	}
	evidence := compareEvidence(t, finding)
	if evidence.Compared != 2 || evidence.Members[2].Compared || !strings.Contains(evidence.Members[2].NotComparedReason, "trimmed") || evidence.Members[2].Metrics != nil {
		t.Fatalf("read C = %+v", evidence.Members[2])
	}
	if len(runner.manifest["takes"].([]any)) != 2 {
		t.Fatalf("manifest takes = %v", runner.manifest["takes"])
	}
}

func TestResolveReadSaysWhyAReadCannotBeCompared(t *testing.T) {
	fx := newFixture(t)
	read := Read{ItemGUID: "{ITEM-A}", TakeGUID: "{TAKE-A}", SourceFile: fx.project.Tracks[0].Items[0].SourceFile, SourceStart: 0, SourceLength: 8}
	change := func(edit func(*tracks.Project, *Read)) string {
		project := fx.project
		project.Tracks = []tracks.Track{{Name: "Chapter 1", Items: append([]tracks.Item(nil), fx.project.Tracks[0].Items...)}}
		project.Tracks[0].Items[0].Takes = append([]tracks.Take(nil), fx.project.Tracks[0].Items[0].Takes...)
		r := read
		edit(&project, &r)
		return resolveRead(project, r).Reason
	}
	cases := map[string]struct {
		edit func(*tracks.Project, *Read)
		want string
	}{
		"as scanned":             {func(*tracks.Project, *Read) {}, ""},
		"no item":                {func(_ *tracks.Project, r *Read) { r.ItemGUID = "{GONE}" }, "not in the saved REAPER project"},
		"no take":                {func(_ *tracks.Project, r *Read) { r.TakeGUID = "{GONE}" }, "take is not on its item"},
		"another file":           {func(p *tracks.Project, _ *Read) { p.Tracks[0].Items[0].Takes[0].SourceFile = "other.wav" }, "different file"},
		"a new rate":             {func(p *tracks.Project, _ *Read) { p.Tracks[0].Items[0].Takes[0].PlayRate = 1.1 }, "moved or trimmed"},
		"a missing file":         {func(p *tracks.Project, _ *Read) { p.Tracks[0].Items[0].Takes[0].SourceAvailable = false }, "missing"},
		"a default rate":         {func(p *tracks.Project, _ *Read) { p.Tracks[0].Items[0].Takes[0].PlayRate = 0 }, ""},
		"an item without a GUID": {func(_ *tracks.Project, r *Read) { r.ItemGUID = "" }, "not in the saved REAPER project"},
	}
	for name, c := range cases {
		got := change(c.edit)
		if (c.want == "") != (got == "") || !strings.Contains(got, c.want) {
			t.Errorf("%s: reason %q, want %q", name, got, c.want)
		}
	}
}

func TestCompareRefusesAnAnswerForAnotherSpanOrOtherTakes(t *testing.T) {
	golden := goldenResults(t)
	cases := map[string]string{
		"another span": strings.Replace(golden, `"firstUnit":0,"lastUnit":1`, `"firstUnit":1,"lastUnit":1`, 1),
		"a take short": golden[:strings.LastIndex(strings.TrimSpace(golden), "\n")+1],
		"another take": strings.Replace(golden, `"takeGuid":"{TAKE-B}"`, `"takeGuid":"{TAKE-X}"`, 1),
		"unreadable":   "TAKE_DIVERGENCE|{}\n",
	}
	for name, output := range cases {
		fx := newFixture(t)
		if _, err := (&Comparer{Runner: &fakeRunner{output: output}, Store: findings.NewStore(fx.dir)}).Compare(context.Background(), fx.request()); err == nil {
			t.Errorf("%s: compared without an error", name)
		}
	}
}

func TestCompareRefusesWhatItCannotStart(t *testing.T) {
	fx := newFixture(t)
	store := findings.NewStore(fx.dir)
	if _, err := (&Comparer{Store: store}).Compare(context.Background(), fx.request()); err == nil {
		t.Error("no runner: no error")
	}
	stale := fx.request()
	stale.Project = tracks.Project{}
	if _, err := (&Comparer{Runner: &fakeRunner{}, Store: store}).Compare(context.Background(), stale); err == nil || !strings.Contains(err.Error(), "fewer than two") {
		t.Errorf("no reads in the project: %v", err)
	}
	notAGroup := fx.request()
	notAGroup.Group.Analyzer = "story-bible"
	if _, err := (&Comparer{Runner: &fakeRunner{}, Store: store}).Compare(context.Background(), notAGroup); err == nil {
		t.Error("not a group: no error")
	}
	failing := &fakeRunner{err: errors.New("the take aligner exited 1")}
	if _, err := (&Comparer{Runner: failing, Store: store}).Compare(context.Background(), fx.request()); err == nil || !strings.Contains(err.Error(), "exited 1") {
		t.Errorf("a failing sidecar: %v", err)
	}
	blocked := fx.request()
	blocked.SessionDir = filepath.Join(fx.project.Tracks[0].Items[0].SourceFile, "under-a-file")
	if _, err := (&Comparer{Runner: &fakeRunner{}, Store: store}).Compare(context.Background(), blocked); err == nil {
		t.Error("an unwritable session folder: no error")
	}
}

// A take that says none of the span's words is not the same part of the script, so it is listed but not compared.
func TestATakeThatHeardNoneOfTheSpanIsNotCompared(t *testing.T) {
	fx := newFixture(t)
	golden := goldenResults(t)
	lines := strings.Split(strings.TrimSpace(golden), "\n")
	var take map[string]any
	if err := json.Unmarshal([]byte(strings.TrimPrefix(lines[4], "TAKE_DIVERGENCE|")), &take); err != nil {
		t.Fatal(err)
	}
	take["counts"] = map[string]any{"matched": 0, "misread": 0, "skipped": 0, "unread": 12, "extraWords": 9}
	for _, word := range take["words"].([]any) {
		word.(map[string]any)["status"], word.(map[string]any)["start"], word.(map[string]any)["end"] = "unread", nil, nil
	}
	encoded, _ := json.Marshal(take)
	lines[4] = "TAKE_DIVERGENCE|" + string(encoded)
	finding, err := (&Comparer{Runner: &fakeRunner{output: strings.Join(lines, "\n")}, Store: findings.NewStore(fx.dir)}).Compare(context.Background(), fx.request())
	if err != nil {
		t.Fatal(err)
	}
	evidence := compareEvidence(t, finding)
	if evidence.Compared != 2 || evidence.Members[2].Compared || evidence.Members[2].NotComparedReason != notHeardReason {
		t.Fatalf("read C = %+v", evidence.Members[2])
	}
}

func TestTakeDivergenceArgsNameOnlyTheHostsOwnPaths(t *testing.T) {
	args := takeDivergenceArgs(SidecarRequest{ManifestPath: "m.json", ManuscriptPath: "ms.json", Model: "small", Language: "en", ProgressPath: "p.txt"}, "out.txt")
	want := []string{"--manifest", "m.json", "--manuscript", "ms.json", "--take-divergence", "--out", "out.txt", "--model", "small", "--language", "en", "--progress", "p.txt"}
	if !reflect.DeepEqual(args, want) {
		t.Fatalf("args = %v", args)
	}
	if got := takeDivergenceArgs(SidecarRequest{ManifestPath: "m.json", ManuscriptPath: "ms.json"}, "out.txt"); len(got) != 7 {
		t.Fatalf("minimal args = %v", got)
	}
	if _, err := (&ProcessRunner{}).TakeDivergence(context.Background(), SidecarRequest{}); err == nil {
		t.Error("an unconfigured runner ran")
	}
}
