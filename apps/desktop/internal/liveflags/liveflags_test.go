package liveflags

import (
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

// "Alice 😀 was beginning to get very tired": the emoji is two UTF-16 code units, so an offset after it is where the
// reader (a JavaScript string) would put it, not a byte or rune count.
func testChapter() Chapter {
	return Chapter{
		ID:    "ch-1",
		Title: "Down the Rabbit-Hole",
		Paragraphs: []Paragraph{
			{ID: "p-1", Text: "Alice 😀 was beginning to get very tired of sitting by her sister on the bank."},
			{ID: "p-2", Text: "Once or twice she had peeped into the book, and once or twice she had not."},
		},
	}
}

var testProject = findings.Project{Path: "C:/Books/Alice"}

func only(t *testing.T, flags ...Flag) findings.Finding {
	t.Helper()
	result, err := ToFindings(testChapter(), testProject, flags)
	if err != nil {
		t.Fatal(err)
	}
	if len(result) != 1 {
		t.Fatalf("got %d findings, want 1", len(result))
	}
	return result[0]
}

func TestAMisreadIsASuspectedTranscriptDiscrepancyOnTheManuscriptWords(t *testing.T) {
	f := only(t, Flag{Kind: "misread", ParagraphID: "p-1", WordStart: 3, WordEnd: 4, ScriptStart: 7, ScriptEnd: 8, Heard: "begging"})

	if err := f.Validate(); err != nil {
		t.Fatalf("finding breaks the contract: %v", err)
	}
	if f.Analyzer != AnalyzerName || f.Category != findings.CategoryTranscriptDiscrepancy || f.Review.Status != findings.StatusUnreviewed {
		t.Fatalf("analyzer/category/status = %s/%s/%s", f.Analyzer, f.Category, f.Review.Status)
	}
	if f.Confidence != nil {
		t.Fatal("a live flag has no score to give; confidence must be null, not fabricated")
	}
	if !strings.Contains(f.ConfidenceReason, "uspected") || !strings.Contains(f.ConfidenceReason, "Transcript Compare") {
		t.Fatalf("confidence_reason %q must say it is suspected and that Transcript Compare is authoritative", f.ConfidenceReason)
	}
	m := f.Manuscript
	if m.ChapterID != "ch-1" || m.ChapterTitle != "Down the Rabbit-Hole" || m.Expected != "beginning" || m.Recorded != "begging" {
		t.Fatalf("manuscript = %+v", m)
	}
	// "Alice 😀 was " is 5 + 1 + 2 + 1 + 3 + 1 = 13 UTF-16 code units.
	if m.Span.ParagraphID != "p-1" || m.Span.Start != 13 || m.Span.End != 22 || m.Span.Ordinal != 0 {
		t.Fatalf("span = %+v, want p-1 [13, 22) ordinal 0", m.Span)
	}
	if f.Evidence["kind"] != "misread" || f.Evidence["heard"] != "begging" || f.Evidence["suspected"] != true {
		t.Fatalf("evidence = %v", f.Evidence)
	}
	if f.TimeRange != nil || f.Source != (findings.Source{}) {
		t.Fatal("no take is known yet, so the finding carries no time range or source (ADR 0117)")
	}
	if f.Project.OutputPath != "narration-utils/findings/teleprompter/ch-1.json" {
		t.Fatalf("output path = %q", f.Project.OutputPath)
	}
}

func TestARestartIsAPickupWithRestartEvidence(t *testing.T) {
	f := only(t, Flag{Kind: "restart", ParagraphID: "p-2", WordStart: 3, WordEnd: 8, Heard: "she had peeped into the"})
	if f.Category != findings.CategoryPickup || f.Evidence["kind"] != "restart" {
		t.Fatalf("category %s, evidence kind %v; ADR 0115 maps a restart to pickup with evidence.kind restart", f.Category, f.Evidence["kind"])
	}
	if f.Manuscript.Expected != "she had peeped into the" {
		t.Fatalf("expected = %q", f.Manuscript.Expected)
	}
}

func TestASkipExpectsTheSkippedWordsAndRecordsNothingHeard(t *testing.T) {
	f := only(t, Flag{Kind: "skipped", ParagraphID: "p-1", WordStart: 5, WordEnd: 7, Heard: ""})
	if f.Manuscript.Expected != "get very" || f.Manuscript.Recorded != "" || f.Severity != findings.SeverityWarning {
		t.Fatalf("manuscript %+v severity %s", f.Manuscript, f.Severity)
	}
}

func TestAnExtraExpectsNothingAndSitsBeforeItsWord(t *testing.T) {
	f := only(t, Flag{Kind: "extra", ParagraphID: "p-1", WordStart: 2, WordEnd: 3, Heard: "um"})
	m := f.Manuscript
	if m.Expected != "" || m.Recorded != "um" || m.Span.Start != 9 || m.Span.End != 9 {
		t.Fatalf("manuscript = %+v, span %+v; an extra is zero-width before \"was\"", m, m.Span)
	}
	if f.Evidence["before"] != "was" || f.Severity != findings.SeverityInfo {
		t.Fatalf("evidence %v, severity %s", f.Evidence, f.Severity)
	}
}

func TestTheIdIsManuscriptAnchoredAndTheEvidenceVersionIsWhatWasHeard(t *testing.T) {
	first := only(t, Flag{Kind: "misread", ParagraphID: "p-1", WordStart: 3, WordEnd: 4, ScriptStart: 7, ScriptEnd: 8, Heard: "begging"})
	again := only(t, Flag{Kind: "misread", ParagraphID: "p-1", WordStart: 3, WordEnd: 4, ScriptStart: 90, ScriptEnd: 91, Heard: "  Begging "})
	if first.ID != again.ID || first.EvidenceVersion != again.EvidenceVersion {
		t.Fatal("the same misread in another session must be the same finding with the same evidence")
	}
	other := only(t, Flag{Kind: "misread", ParagraphID: "p-1", WordStart: 3, WordEnd: 4, Heard: "beginner"})
	if other.ID != first.ID || other.EvidenceVersion == first.EvidenceVersion {
		t.Fatal("a different heard text is the same finding with new evidence, so an old dismissal reopens")
	}
	skip := only(t, Flag{Kind: "skipped", ParagraphID: "p-1", WordStart: 3, WordEnd: 4})
	if skip.ID == first.ID {
		t.Fatal("a different kind on the same words is a different finding")
	}
}

func TestARepeatedPhraseGetsItsOwnOrdinal(t *testing.T) {
	first := only(t, Flag{Kind: "skipped", ParagraphID: "p-2", WordStart: 0, WordEnd: 3})    // "Once or twice"
	second := only(t, Flag{Kind: "skipped", ParagraphID: "p-2", WordStart: 10, WordEnd: 13}) // "once or twice", again
	if first.Manuscript.Span.Ordinal != 0 || second.Manuscript.Span.Ordinal != 1 || first.ID == second.ID {
		t.Fatalf("ordinals %d/%d; a repeat of the same words must not collide", first.Manuscript.Span.Ordinal, second.Manuscript.Span.Ordinal)
	}
}

func TestInvalidFlagsAreRejected(t *testing.T) {
	cases := map[string]Flag{
		"unknown kind":       {Kind: "mumble", ParagraphID: "p-1", WordStart: 0, WordEnd: 1},
		"unknown paragraph":  {Kind: "misread", ParagraphID: "p-9", WordStart: 0, WordEnd: 1},
		"empty range":        {Kind: "misread", ParagraphID: "p-1", WordStart: 2, WordEnd: 2},
		"negative start":     {Kind: "misread", ParagraphID: "p-1", WordStart: -1, WordEnd: 1},
		"past the paragraph": {Kind: "misread", ParagraphID: "p-1", WordStart: 15, WordEnd: 99},
		"extra over two":     {Kind: "extra", ParagraphID: "p-1", WordStart: 0, WordEnd: 2},
		"heard too long":     {Kind: "misread", ParagraphID: "p-1", WordStart: 0, WordEnd: 1, Heard: strings.Repeat("x", maxHeardLength+1)},
	}
	for name, flag := range cases {
		if _, err := ToFindings(testChapter(), testProject, []Flag{flag}); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	if _, err := ToFindings(testChapter(), testProject, make([]Flag, maxFlags+1)); err == nil {
		t.Error("an unbounded number of flags was accepted")
	}
	if _, err := ToFindings(Chapter{}, testProject, nil); err == nil {
		t.Error("a chapter with no id was accepted")
	}
}

func TestAChapterIdThatIsNotAFileNameStillGetsASafeScope(t *testing.T) {
	if got := Scope("ch-1"); got != "ch-1" {
		t.Fatalf("scope = %q", got)
	}
	unsafe := Scope("../Chapter One")
	if strings.ContainsAny(unsafe, "./ \\") && !strings.HasPrefix(unsafe, "chapter-") {
		t.Fatalf("unsafe scope %q", unsafe)
	}
	if unsafe != Scope("../Chapter One") {
		t.Fatal("the fallback scope must be deterministic")
	}
}
