// This file is Phase 1 of docs/prds/editing-readiness-analysis.prd.md ("Editing
// corpus and evaluation harness"). Its own scope: "A labeling format (CSV:
// source file identity, start, end, class among silence_to_trim, click,
// breath, keep_pause, keep_breath, note) with negative labels for
// intentional pauses and kept breaths." Test-only (this package's harness
// consumes it, no product code): the corpus itself - a permissioned
// narrator's chapters, per D71 built from LibriVox - lives outside the repo,
// pointed to by the NARRATION_EDITING_CORPUS directory variable
// (harness_test.go), mirroring ADR 0125's NARRATION_COVERAGE_CORPUS
// precedent. This file only defines and validates the row format; it never
// reads that variable itself.
package editing

import (
	"encoding/csv"
	"fmt"
	"io"
	"strconv"
	"strings"
	"testing"
)

// LabelClass is what a labeled corpus location is. The three positive
// classes name a chore this PRD's detectors report ("silence_to_trim" is
// DX Phase 9's CleanupSilence, "click" its CleanupClick, "breath" its
// CleanupBreath); the two negative classes mark a location a narrator wants
// kept - a meant dramatic pause, a breath left in on purpose - so a detector
// firing there counts against precision, never against recall (Phase 1
// Scope: "negative labels for intentional pauses and kept breaths").
type LabelClass string

const (
	LabelSilenceToTrim LabelClass = "silence_to_trim"
	LabelClick         LabelClass = "click"
	LabelBreath        LabelClass = "breath"
	LabelKeepPause     LabelClass = "keep_pause"
	LabelKeepBreath    LabelClass = "keep_breath"
)

// validLabelClasses is every class ParseCorpusLabels accepts, in the
// canonical order they are documented (Phase 1 Scope's own list).
var validLabelClasses = []LabelClass{LabelSilenceToTrim, LabelClick, LabelBreath, LabelKeepPause, LabelKeepBreath}

func (c LabelClass) valid() bool {
	for _, v := range validLabelClasses {
		if c == v {
			return true
		}
	}
	return false
}

// positiveClasses are the classes recall and precision are reported for
// (harness_test.go): every class a detector can be right or wrong about.
// The two "keep_" classes are never scored on their own - they only ever
// suppress a positive class's precision (negativeClassFor).
func positiveClasses() []LabelClass { return []LabelClass{LabelSilenceToTrim, LabelClick, LabelBreath} }

// negativeClassFor names the "keep_" class whose overlap counts against c's
// precision, or "" when c has none (click has no negative: Phase 1 Scope
// lists negatives only for "intentional pauses and kept breaths").
func negativeClassFor(c LabelClass) LabelClass {
	switch c {
	case LabelSilenceToTrim:
		return LabelKeepPause
	case LabelBreath:
		return LabelKeepBreath
	default:
		return ""
	}
}

// LabelSplit is Phase 1's tuning/held-out split ("a Go harness computing
// per-class recall, precision and a sensitivity sweep on a tuning half and a
// held-out half"), recorded per row so one corpus directory holds both
// halves without a second directory convention, following the "tune |
// held_out" split named in ADR 0125's own labeling precedent.
type LabelSplit string

const (
	SplitTune    LabelSplit = "tune"
	SplitHeldOut LabelSplit = "held_out"
)

func (s LabelSplit) valid() bool { return s == SplitTune || s == SplitHeldOut }

// CorpusLabel is one labeled location: which source file (a name or relative
// path stable within one corpus directory - "source file identity", Phase 1
// Scope), its start and end in that source's own seconds, its class, which
// split it belongs to, and a free-text note (provenance, or why a location
// is ambiguous).
type CorpusLabel struct {
	Source string
	Start  float64
	End    float64
	Class  LabelClass
	Split  LabelSplit
	Note   string
}

// corpusLabelHeader is the CSV header ParseCorpusLabels requires and
// WriteCorpusLabels emits, in this exact order and spelling, so a labeled
// corpus directory's file is self-describing to a human labeling it by hand.
var corpusLabelHeader = []string{"source", "start_seconds", "end_seconds", "class", "split", "note"}

// ParseCorpusLabels reads Phase 1's CSV labeling format: a header row
// matching corpusLabelHeader exactly, then one row per labeled location. It
// validates as it parses - never a silent skip of a bad row - because a
// mislabeled corpus would silently understate or overstate recall and
// precision (the whole point of the harness).
func ParseCorpusLabels(r io.Reader) ([]CorpusLabel, error) {
	reader := csv.NewReader(r)
	reader.FieldsPerRecord = len(corpusLabelHeader)
	header, err := reader.Read()
	if err != nil {
		return nil, fmt.Errorf("reading label header: %w", err)
	}
	if !equalStrings(header, corpusLabelHeader) {
		return nil, fmt.Errorf("label header = %v, want %v", header, corpusLabelHeader)
	}
	var out []CorpusLabel
	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("reading label row %d: %w", len(out)+1, err)
		}
		label, err := parseCorpusLabelRow(record)
		if err != nil {
			return nil, fmt.Errorf("label row %d: %w", len(out)+1, err)
		}
		out = append(out, label)
	}
	return out, nil
}

func parseCorpusLabelRow(record []string) (CorpusLabel, error) {
	source, startRaw, endRaw, classRaw, splitRaw, note := record[0], record[1], record[2], record[3], record[4], record[5]
	if source == "" {
		return CorpusLabel{}, fmt.Errorf("source is empty")
	}
	start, err := strconv.ParseFloat(startRaw, 64)
	if err != nil {
		return CorpusLabel{}, fmt.Errorf("start_seconds %q: %w", startRaw, err)
	}
	end, err := strconv.ParseFloat(endRaw, 64)
	if err != nil {
		return CorpusLabel{}, fmt.Errorf("end_seconds %q: %w", endRaw, err)
	}
	if end <= start {
		return CorpusLabel{}, fmt.Errorf("end_seconds %v must be after start_seconds %v", end, start)
	}
	class := LabelClass(classRaw)
	if !class.valid() {
		return CorpusLabel{}, fmt.Errorf("class %q is not one of %v", classRaw, validLabelClasses)
	}
	split := LabelSplit(splitRaw)
	if !split.valid() {
		return CorpusLabel{}, fmt.Errorf("split %q is not %q or %q", splitRaw, SplitTune, SplitHeldOut)
	}
	return CorpusLabel{Source: source, Start: start, End: end, Class: class, Split: split, Note: note}, nil
}

// WriteCorpusLabels writes labels back out in Phase 1's CSV format, in the
// order given. It is the inverse of ParseCorpusLabels (round-tripped by
// TestParseCorpusLabels_RoundTrips) and is also how the synthetic corpus
// (syntheticcorpus_test.go) turns its generated labels into the same file
// shape a real, hand-labeled corpus directory would use, so the harness
// (harness_test.go) never special-cases synthetic input.
func WriteCorpusLabels(w io.Writer, labels []CorpusLabel) error {
	writer := csv.NewWriter(w)
	if err := writer.Write(corpusLabelHeader); err != nil {
		return fmt.Errorf("writing label header: %w", err)
	}
	for i, label := range labels {
		if !label.Class.valid() {
			return fmt.Errorf("label row %d: class %q is not one of %v", i+1, label.Class, validLabelClasses)
		}
		if !label.Split.valid() {
			return fmt.Errorf("label row %d: split %q is not %q or %q", i+1, label.Split, SplitTune, SplitHeldOut)
		}
		record := []string{
			label.Source,
			strconv.FormatFloat(label.Start, 'f', -1, 64),
			strconv.FormatFloat(label.End, 'f', -1, 64),
			string(label.Class),
			string(label.Split),
			label.Note,
		}
		if err := writer.Write(record); err != nil {
			return fmt.Errorf("writing label row %d: %w", i+1, err)
		}
	}
	writer.Flush()
	return writer.Error()
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// sampleCorpusLabels is a small, valid set covering every class and split,
// reused by the round-trip and rejection tests below.
func sampleCorpusLabels() []CorpusLabel {
	return []CorpusLabel{
		{Source: "case-1.wav", Start: 3.0, End: 3.4, Class: LabelSilenceToTrim, Split: SplitTune, Note: "gap between phrases"},
		{Source: "case-1.wav", Start: 5.1, End: 5.12, Class: LabelClick, Split: SplitTune, Note: ""},
		{Source: "case-1.wav", Start: 6.0, End: 6.3, Class: LabelBreath, Split: SplitTune, Note: "inhale"},
		{Source: "case-2.wav", Start: 8.0, End: 10.5, Class: LabelKeepPause, Split: SplitHeldOut, Note: "scene break, meant"},
		{Source: "case-2.wav", Start: 12.0, End: 12.2, Class: LabelKeepBreath, Split: SplitHeldOut, Note: "kept on purpose"},
	}
}

// TestParseCorpusLabels_RoundTrips is Phase 1's own success signal: "labels
// validate against the format." WriteCorpusLabels then ParseCorpusLabels
// must reproduce the same rows, in the same order, for every documented
// class and split.
func TestParseCorpusLabels_RoundTrips(t *testing.T) {
	want := sampleCorpusLabels()
	var buf strings.Builder
	if err := WriteCorpusLabels(&buf, want); err != nil {
		t.Fatalf("WriteCorpusLabels() error = %v", err)
	}
	got, err := ParseCorpusLabels(strings.NewReader(buf.String()))
	if err != nil {
		t.Fatalf("ParseCorpusLabels() error = %v", err)
	}
	if len(got) != len(want) {
		t.Fatalf("ParseCorpusLabels() returned %d rows, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("row %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}

// TestParseCorpusLabels_RequiresExactHeader guards a corpus file whose
// columns were reordered or renamed by hand: a stable, self-describing
// header is the whole point of a CSV format a narrator or a future phase
// edits directly.
func TestParseCorpusLabels_RequiresExactHeader(t *testing.T) {
	_, err := ParseCorpusLabels(strings.NewReader("source,start,end,class,split,note\na.wav,0,1,click,tune,\n"))
	if err == nil {
		t.Fatal("ParseCorpusLabels() with a renamed header: want an error, got nil")
	}
}

// TestParseCorpusLabels_RejectsUnknownClass, ...UnknownSplit and
// ...BackwardsRange each check one way a bad row must never pass silently:
// a wrong class or split name, or an end at or before its own start.
func TestParseCorpusLabels_RejectsUnknownClass(t *testing.T) {
	csvText := "source,start_seconds,end_seconds,class,split,note\na.wav,0,1,pop,tune,\n"
	if _, err := ParseCorpusLabels(strings.NewReader(csvText)); err == nil {
		t.Fatal("ParseCorpusLabels() with class \"pop\": want an error, got nil")
	}
}

func TestParseCorpusLabels_RejectsUnknownSplit(t *testing.T) {
	csvText := "source,start_seconds,end_seconds,class,split,note\na.wav,0,1,click,training,\n"
	if _, err := ParseCorpusLabels(strings.NewReader(csvText)); err == nil {
		t.Fatal("ParseCorpusLabels() with split \"training\": want an error, got nil")
	}
}

func TestParseCorpusLabels_RejectsBackwardsRange(t *testing.T) {
	csvText := "source,start_seconds,end_seconds,class,split,note\na.wav,2,1,click,tune,\n"
	if _, err := ParseCorpusLabels(strings.NewReader(csvText)); err == nil {
		t.Fatal("ParseCorpusLabels() with end before start: want an error, got nil")
	}
}

// TestParseCorpusLabels_RejectsEmptySource guards against a row silently
// scoring against every source (or none) because its identity column was
// left blank.
func TestParseCorpusLabels_RejectsEmptySource(t *testing.T) {
	csvText := "source,start_seconds,end_seconds,class,split,note\n,0,1,click,tune,\n"
	if _, err := ParseCorpusLabels(strings.NewReader(csvText)); err == nil {
		t.Fatal("ParseCorpusLabels() with an empty source: want an error, got nil")
	}
}

// TestNegativeClassFor pins the two negative-to-positive pairings the
// harness's precision accounting depends on (harness_test.go): a
// misclassification here would silently let an intentional pause or breath
// stop counting against precision.
func TestNegativeClassFor(t *testing.T) {
	cases := map[LabelClass]LabelClass{
		LabelSilenceToTrim: LabelKeepPause,
		LabelBreath:        LabelKeepBreath,
		LabelClick:         "",
	}
	for class, want := range cases {
		if got := negativeClassFor(class); got != want {
			t.Errorf("negativeClassFor(%q) = %q, want %q", class, got, want)
		}
	}
}
