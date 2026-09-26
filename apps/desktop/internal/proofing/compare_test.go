package proofing

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

var (
	runStarted   = time.Date(2026, 9, 26, 9, 0, 0, 0, time.UTC)
	runCompleted = runStarted.Add(5 * time.Minute)
	savedAfter   = runCompleted.Add(time.Minute)
)

// titleLookup resolves chapter titles like manuscript.Service.ChapterIDByTitle.
type titleLookup map[string][]string

func (l titleLookup) ChapterIDByTitle(title string) (string, bool, bool) {
	ids := l[title]
	switch len(ids) {
	case 0:
		return "", false, false
	case 1:
		return ids[0], false, true
	}
	return ids[0], true, true
}

// compareFixture is a project folder with two audio files, a chapter track of
// items over them, and a recorder writing into the fixture's ledger.
type compareFixture struct {
	*testProject
	audioA, audioB string
	recorder       *ComparisonRecorder
	runs           int
}

func newCompareFixture(t *testing.T) *compareFixture {
	t.Helper()
	p := newTestProject(t)
	f := &compareFixture{testProject: p, audioA: writeAudio(t, p.dir, "take-a.wav", "AAAA"), audioB: writeAudio(t, p.dir, "take-b.wav", "BBBBBB")}
	f.project.Tracks[0].Items = []tracks.Item{
		audioItem("{ITEM-1}", f.audioA, 0, 10, 0),
		audioItem("{ITEM-2}", f.audioB, 10, 5, 2.5),
	}
	f.recorder = &ComparisonRecorder{
		Ledger: p.ledger, Lookup: titleLookup{"Chapter One": {testChapter}, "Chapter Two": {"c-0002"}},
		DocumentID: func() string { return testDocument }, ProjectFolder: p.dir,
		ProjectFile: func() (evidence.LedgerProjectFile, error) {
			return evidence.LedgerProjectFile{Path: filepath.Join(p.dir, "book.rpp"), ModTime: runCompleted.Add(-time.Hour)}, nil
		},
	}
	return f
}

func writeAudio(t *testing.T, dir, name, content string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func audioItem(guid, source string, position, length, soffs float64) tracks.Item {
	return tracks.Item{
		GUID: guid, Position: position, Length: length, SourceFile: source, Supported: true,
		Takes: []tracks.Take{{SourceFile: source, Supported: true, SOFFS: soffs, PlayRate: 1}},
	}
}

// manifestFor writes a manifest_<run>.txt the way narration_compare.lua does:
// index|source_file|startoffs|length*rate, %.6f.
func manifestFor(t *testing.T, dir string, items ...tracks.Item) string {
	t.Helper()
	var lines []string
	for index, it := range items {
		take := it.Active()
		lines = append(lines, fmt.Sprintf("%d|%s|%.6f|%.6f", index, take.SourceFile, take.SOFFS, it.Length*take.Rate()))
	}
	path := filepath.Join(dir, fmt.Sprintf("manifest_%d.txt", time.Now().UnixNano()))
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func (f *compareFixture) record(t *testing.T, outcome, title string, items ...tracks.Item) {
	t.Helper()
	f.runs++ // each run starts a second after the last, so "latest" is never a tie
	offset := time.Duration(f.runs) * time.Second
	run := ComparisonRun{
		RunID: "run", Outcome: outcome, ManifestPath: manifestFor(t, f.dir, items...), ChapterTitle: title,
		Model: "small", StartedAt: runStarted.Add(offset), CompletedAt: runCompleted.Add(offset),
	}
	if err := f.recorder.Record(run); err != nil {
		t.Fatalf("Record() = %v", err)
	}
}

func (f *compareFixture) savedView() stages.EvidenceView {
	view := f.view()
	view.ProjectFile = evidence.LedgerProjectFile{Path: filepath.Join(f.dir, "book.rpp"), ModTime: savedAfter}
	return view
}

func judge(t *testing.T, view stages.EvidenceView) RunJudgement {
	t.Helper()
	judgement, err := ComparisonJudge(context.Background(), proofingChapter(), view)
	if err != nil {
		t.Fatalf("ComparisonJudge() = %v", err)
	}
	if judgement.Status.State == RunUnknown && (judgement.Status.Cause == "" || judgement.Status.Reason == "") {
		t.Fatalf("an unknown run must name its cause and action: %+v", judgement.Status)
	}
	return judgement
}

func TestParseManifest(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "manifest.txt")
	content := "0|C:\\audio\\a.wav|1.500000|10.000000\nnot a line\n1|/odd|name.wav|0.000000|2.250000\n2|/x.wav|nan|1\n"
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	items, err := ParseManifest(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 || items[0].Path != `C:\audio\a.wav` || items[0].Start != 1.5 || items[0].Length != 10 || items[1].Path != "/odd|name.wav" || items[1].Length != 2.25 {
		t.Fatalf("items = %+v", items)
	}
	if _, err := ParseManifest(filepath.Join(dir, "missing.txt")); err == nil {
		t.Fatal("a missing manifest is an error")
	}
}

// TestRecorderWritesOneRecordPerFinishedRun is Phase 2's first success signal:
// every finished run has a chapter, a compared set and an outcome, including a
// clean one, and comparing chapter 2 after chapter 1 keeps chapter 1's record.
func TestRecorderWritesOneRecordPerFinishedRun(t *testing.T) {
	f := newCompareFixture(t)
	items := f.project.Tracks[0].Items
	f.record(t, OutcomeComplete, "Chapter One", items...)
	f.record(t, OutcomeComplete, "Chapter Two", items[0])
	f.record(t, "cancelled", "Chapter One", items...)

	one, err := f.ledger.List(AnalyzerTranscriptCompare, testChapter)
	if err != nil || len(one) != 1 {
		t.Fatalf("chapter one records = %d, %v (a cancelled run writes none)", len(one), err)
	}
	record := one[0]
	if record.Outcome != evidence.LedgerComplete || record.Scope.DocumentID != testDocument || !record.CompletedAt.Equal(runCompleted.Add(time.Second)) || record.ProjectFile.ModTime.IsZero() {
		t.Fatalf("record = %+v", record)
	}
	var payload ComparisonPayload
	if err := json.Unmarshal(record.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.ChapterTitle != "Chapter One" || payload.Model != "small" || len(payload.Compared) != 2 || payload.Compared[1].Start != 2.5 || payload.Compared[0].Identity == "" {
		t.Fatalf("payload = %+v", payload)
	}
	if two, _ := f.ledger.List(AnalyzerTranscriptCompare, "c-0002"); len(two) != 1 {
		t.Fatalf("chapter two records = %d", len(two))
	}
}

func TestRecorderAttributesOnlyWhatItCan(t *testing.T) {
	f := newCompareFixture(t)
	f.recorder.Lookup = titleLookup{"Chapter One": {testChapter, "c-0009"}}
	f.record(t, OutcomeComplete, "Chapter One", f.project.Tracks[0].Items...)
	f.record(t, OutcomeComplete, "Not In The Book", f.project.Tracks[0].Items...)
	f.record(t, OutcomeComplete, "", f.project.Tracks[0].Items...)
	all, _ := f.ledger.List(AnalyzerTranscriptCompare, "")
	if len(all) != 1 || all[0].Scope.ChapterID != "" {
		t.Fatalf("only the ambiguous title is recorded, unattributed: %+v", all)
	}
	var payload ComparisonPayload
	_ = json.Unmarshal(all[0].Payload, &payload)
	if payload.Resolution != ResolutionAmbiguous || payload.ChapterTitle != "Chapter One" {
		t.Fatalf("payload = %+v", payload)
	}

	f.recorder.DocumentID = func() string { return "" }
	if err := f.recorder.Record(ComparisonRun{Outcome: OutcomeComplete, ChapterTitle: "Chapter One"}); err != nil {
		t.Fatalf("no manuscript is not an error, just nothing to record: %v", err)
	}
}

// TestComparisonJudge is Q4 over the scenarios Phase 2's success signal names.
func TestComparisonJudge(t *testing.T) {
	cases := []struct {
		name      string
		setup     func(t *testing.T, f *compareFixture) stages.EvidenceView
		want      RunState
		wantCause stages.UnknownCause
	}{
		{"never compared", func(t *testing.T, f *compareFixture) stages.EvidenceView { return f.savedView() }, RunNever, ""},
		{"complete, every item, saved after: current", func(t *testing.T, f *compareFixture) stages.EvidenceView {
			f.record(t, OutcomeComplete, "Chapter One", f.project.Tracks[0].Items...)
			return f.savedView()
		}, RunCurrent, ""},
		{"project not saved after the run", func(t *testing.T, f *compareFixture) stages.EvidenceView {
			f.record(t, OutcomeComplete, "Chapter One", f.project.Tracks[0].Items...)
			view := f.savedView()
			view.ProjectFile.ModTime = runCompleted.Add(-time.Second)
			return view
		}, RunUnknown, stages.CauseStale},
		{"an item trimmed after the run", func(t *testing.T, f *compareFixture) stages.EvidenceView {
			f.record(t, OutcomeComplete, "Chapter One", f.project.Tracks[0].Items...)
			f.project.Tracks[0].Items[1].Length = 4
			return f.savedView()
		}, RunUnknown, stages.CauseStale},
		{"an item deleted after the run still covers what plays", func(t *testing.T, f *compareFixture) stages.EvidenceView {
			f.record(t, OutcomeComplete, "Chapter One", f.project.Tracks[0].Items...)
			f.project.Tracks[0].Items = f.project.Tracks[0].Items[:1]
			return f.savedView()
		}, RunCurrent, ""},
		{"a source file replaced after the run", func(t *testing.T, f *compareFixture) stages.EvidenceView {
			f.record(t, OutcomeComplete, "Chapter One", f.project.Tracks[0].Items...)
			writeAudio(t, f.dir, "take-b.wav", "a new recording")
			return f.savedView()
		}, RunUnknown, stages.CauseStale},
		{"partial selection", func(t *testing.T, f *compareFixture) stages.EvidenceView {
			f.record(t, OutcomeComplete, "Chapter One", f.project.Tracks[0].Items[0])
			return f.savedView()
		}, RunUnknown, stages.CauseIncompleteRun},
		{"a muted item that was compared does not invalidate", func(t *testing.T, f *compareFixture) stages.EvidenceView {
			f.record(t, OutcomeComplete, "Chapter One", f.project.Tracks[0].Items...)
			f.project.Tracks[0].Items[1].Muted = true
			return f.savedView()
		}, RunCurrent, ""},
		{"identical duplicate items need both compared", func(t *testing.T, f *compareFixture) stages.EvidenceView {
			copyOf := f.project.Tracks[0].Items[0]
			copyOf.GUID, copyOf.Position = "{ITEM-3}", 20
			f.project.Tracks[0].Items = append(f.project.Tracks[0].Items, copyOf)
			f.record(t, OutcomeComplete, "Chapter One", f.project.Tracks[0].Items[:2]...)
			return f.savedView()
		}, RunUnknown, stages.CauseIncompleteRun},
		{"identical duplicate items both compared", func(t *testing.T, f *compareFixture) stages.EvidenceView {
			copyOf := f.project.Tracks[0].Items[0]
			copyOf.GUID, copyOf.Position = "{ITEM-3}", 20
			f.project.Tracks[0].Items = append(f.project.Tracks[0].Items, copyOf)
			f.record(t, OutcomeComplete, "Chapter One", f.project.Tracks[0].Items...)
			return f.savedView()
		}, RunCurrent, ""},
		{"the latest run failed", func(t *testing.T, f *compareFixture) stages.EvidenceView {
			f.record(t, OutcomeComplete, "Chapter One", f.project.Tracks[0].Items...)
			run := ComparisonRun{Outcome: OutcomeFailed, ChapterTitle: "Chapter One", StartedAt: runCompleted.Add(time.Second), CompletedAt: runCompleted.Add(time.Minute)}
			if err := f.recorder.Record(run); err != nil {
				t.Fatal(err)
			}
			view := f.savedView()
			view.ProjectFile.ModTime = runCompleted.Add(time.Hour)
			return view
		}, RunUnknown, stages.CauseIncompleteRun},
		{"the chapter title is shared by two chapters", func(t *testing.T, f *compareFixture) stages.EvidenceView {
			f.recorder.Lookup = titleLookup{"Chapter One": {testChapter, "c-0009"}}
			f.record(t, OutcomeComplete, "Chapter One", f.project.Tracks[0].Items...)
			return f.savedView()
		}, RunUnknown, stages.CauseIncompleteRun},
		{"unmapped chapter", func(t *testing.T, f *compareFixture) stages.EvidenceView {
			f.record(t, OutcomeComplete, "Chapter One", f.project.Tracks[0].Items...)
			if err := f.mapping.Clear(testDocument, testTrack); err != nil {
				t.Fatal(err)
			}
			return f.savedView()
		}, RunUnknown, stages.CauseUnmappedTrack},
		{"unreadable project", func(t *testing.T, f *compareFixture) stages.EvidenceView {
			f.record(t, OutcomeComplete, "Chapter One", f.project.Tracks[0].Items...)
			view := f.savedView()
			view.ProjectErr = os.ErrNotExist
			return view
		}, RunUnknown, stages.CauseProjectUnreadable},
		{"no played audio on the track", func(t *testing.T, f *compareFixture) stages.EvidenceView {
			f.record(t, OutcomeComplete, "Chapter One", f.project.Tracks[0].Items...)
			f.project.Tracks[0].Items = nil
			return f.savedView()
		}, RunUnknown, stages.CauseMeasurementUnavailable},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newCompareFixture(t)
			judgement := judge(t, tc.setup(t, f))
			if judgement.Status.State != tc.want || judgement.Status.Cause != tc.wantCause {
				t.Fatalf("status = %+v, want %s/%q", judgement.Status, tc.want, tc.wantCause)
			}
			if tc.want == RunCurrent && (len(judgement.Status.RecordIDs) != 1 || judgement.Status.Fingerprint == "") {
				t.Fatalf("a current run names its record and fingerprint: %+v", judgement.Status)
			}
		})
	}
}

// TestComparisonCoversOnlyWhatItCompared: a finding a later run did not
// reproduce is resolved only when that run compared the finding's audio.
func TestComparisonCoversOnlyWhatItCompared(t *testing.T) {
	f := newCompareFixture(t)
	f.record(t, OutcomeComplete, "Chapter One", f.project.Tracks[0].Items[1]) // only take-b, from 2.5 s for 5 s
	judgement := judge(t, f.savedView())
	if judgement.Covers == nil {
		t.Fatal("a recorded complete run must say what it covered")
	}
	at := func(file string, start float64) findings.Finding {
		return findings.Finding{Source: findings.Source{File: file}, TimeRange: &findings.TimeRange{SourceStart: &start, SourceEnd: &start}}
	}
	if !judgement.Covers(at(f.audioB, 3)) {
		t.Fatal("a finding inside the compared range of the compared file is covered")
	}
	if judgement.Covers(at(f.audioB, 9)) || judgement.Covers(at(f.audioA, 3)) || judgement.Covers(findings.Finding{Source: findings.Source{File: f.audioB}}) {
		t.Fatal("outside the compared range, another file, or no source time is not covered")
	}
}

// TestComparisonJudgeThroughTheProvider is the end-to-end Phase 1 + 2 path: a
// finding a partial re-run did not reproduce stays open; after a complete,
// saved re-run of every item it is resolved and the chapter's pickups are met.
func TestComparisonJudgeThroughTheProvider(t *testing.T) {
	f := newCompareFixture(t)
	start := 3.0
	finding := testFinding("cmp", AnalyzerTranscriptCompare, testChapter, findings.CategoryTranscriptDiscrepancy)
	finding.Source.File, finding.TimeRange.SourceStart, finding.TimeRange.SourceEnd = f.audioB, &start, &start
	f.save(t, AnalyzerTranscriptCompare, testChapter, finding)
	provider := NewSignalProvider(Config{Findings: f.findings, Runs: map[string]RunJudge{AnalyzerTranscriptCompare: ComparisonJudge}})

	f.save(t, AnalyzerTranscriptCompare, testChapter)
	f.record(t, OutcomeComplete, "Chapter One", f.project.Tracks[0].Items[0])
	if signal := pickupsOf(t, provider, f.savedView()); signal.State != stages.SignalNotMet {
		t.Fatalf("after a partial clean run: %q (%s), want not_met", signal.State, signal.Reason)
	}
	f.record(t, OutcomeComplete, "Chapter One", f.project.Tracks[0].Items...)
	signal := pickupsOf(t, provider, f.savedView())
	if signal.State != stages.SignalMet || len(signal.Basis.LedgerRecordIDs) != 1 {
		t.Fatalf("after a complete clean run: %q (%s) basis %+v, want met on one record", signal.State, signal.Reason, signal.Basis)
	}
}
