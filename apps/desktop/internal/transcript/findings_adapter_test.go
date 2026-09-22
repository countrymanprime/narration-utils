package transcript

import (
	"strconv"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

// fixtureRow builds a row exactly as Service.Handle builds one from a
// COMPARE_MARKER event, so tests exercise the same shape BuildFindings sees
// in production rather than a hand-simplified one.
func fixtureRow(chapter string, paragraph, itemIndex int, srcpos, projectTime float64, kind, doc, audio, script, audioCtx, state, existing string) map[string]any {
	return map[string]any{
		"id": rowID(itemIndex, srcpos), "kind": kind, "name": kind + ": " + doc,
		"docText": doc, "audioText": audio, "projectTime": projectTime, "itemIndex": itemIndex,
		"srcpos": srcpos, "chapter": chapter, "paragraph": paragraph,
		"scriptContext": script, "audioContext": audioCtx, "markerState": state, "existingMarkerName": existing,
	}
}

// fixtureRows mirrors testdata/results_run-fixture.txt exactly: same
// chapter/paragraph/kind/text/item/srcpos on every row, so the join in
// BuildFindings lines up with the results file's confidence and
// timing_gap_seconds.
func fixtureRows() []map[string]any {
	return []map[string]any{
		fixtureRow("Chapter One", 3, 0, 12.340, 100.340, "MISREAD", "the quick brown fox", "the quick brown socks",
			"The quick brown fox jumped over the lazy dog.", "The quick brown socks jumped over the lazy dog.", "pending", ""),
		fixtureRow("Chapter One", 3, 0, 45.100, 133.100, "SKIPPED", "jumped over", "",
			"The quick brown fox jumped over the lazy dog.", "The quick brown fox the lazy dog.", "pending", ""),
		fixtureRow("Chapter One", 4, 0, 67.890, 155.890, "EXTRA", "", "and then",
			"It was a dark and stormy night.", "It was and then a dark and stormy night.", "existing", "TAKE 2"),
		// A repeat of row 1's chapter/paragraph/kind/expected text, from a
		// different item and a different recorded word - exercises the
		// ordinal disambiguation and a materially different EvidenceVersion
		// on an otherwise colliding id.
		fixtureRow("Chapter One", 3, 1, 90.000, 400.000, "MISREAD", "the quick brown fox", "the quick brown mittens",
			"The quick brown fox jumped over the lazy dog.", "The quick brown mittens jumped over the lazy dog.", "pending", ""),
	}
}

type fakeLookup struct {
	chapterID          string
	chapterAmbiguous   bool
	chapterOK          bool
	paragraphID        string
	paragraphOK        bool
	calledWithChapter  string
	calledWithGlobalIx int
}

func (f *fakeLookup) ChapterIDByTitle(title string) (string, bool, bool) {
	f.calledWithChapter = title
	return f.chapterID, f.chapterAmbiguous, f.chapterOK
}
func (f *fakeLookup) ParagraphID(chapterID string, globalIndex int) (string, bool) {
	f.calledWithGlobalIx = globalIndex
	return f.paragraphID, f.paragraphOK
}

func resultsFixture() string  { return "testdata/results_run-fixture.txt" }
func manifestFixture() string { return "testdata/manifest_run-fixture.txt" }

func TestBuildFindingsMapsEveryRowFromTheFixture(t *testing.T) {
	lookup := &fakeLookup{chapterID: "chapter-1", chapterOK: true, paragraphID: "para-3", paragraphOK: true}
	grouped, err := BuildFindings(fixtureRows(), resultsFixture(), manifestFixture(), findings.Project{Path: "C:\\project"}, lookup)
	if err != nil {
		t.Fatalf("BuildFindings() error = %v", err)
	}
	all := grouped["chapter-1"]
	if len(all) != 4 {
		t.Fatalf("got %d findings across scopes %#v, want 4 in one scope", len(all), grouped)
	}
	ids := map[string]bool{}
	for _, f := range all {
		if err := f.Validate(); err != nil {
			t.Errorf("finding %+v failed Validate(): %v", f, err)
		}
		if ids[f.ID] {
			t.Errorf("duplicate finding id %s", f.ID)
		}
		ids[f.ID] = true
		if f.Manuscript.ChapterID != "chapter-1" {
			t.Errorf("ChapterID = %q, want the resolved chapter-1", f.Manuscript.ChapterID)
		}
		if f.Source.File == "" {
			t.Errorf("finding %s: Source.File was not resolved from the manifest", f.ID)
		}
		if f.Analyzer != analyzerName || f.Category != findings.CategoryTranscriptDiscrepancy {
			t.Errorf("finding %s: analyzer/category = %s/%s", f.ID, f.Analyzer, f.Category)
		}
		if f.Review.Status != findings.StatusUnreviewed {
			t.Errorf("finding %s: fresh finding must start unreviewed, got %s", f.ID, f.Review.Status)
		}
	}
}

func TestBuildFindingsMapsConfidenceLabelsAndTimingGap(t *testing.T) {
	lookup := &fakeLookup{chapterID: "chapter-1", chapterOK: true}
	grouped, err := BuildFindings(fixtureRows(), resultsFixture(), manifestFixture(), findings.Project{}, lookup)
	if err != nil {
		t.Fatal(err)
	}
	misread := findByAudio(t, grouped["chapter-1"], "the quick brown socks")
	if misread.Confidence == nil || *misread.Confidence != 0.9 {
		t.Errorf("high-confidence MISREAD: Confidence = %v, want 0.9", misread.Confidence)
	}
	if misread.Evidence["timing_gap_seconds"] != 0.42 {
		t.Errorf("timing_gap_seconds = %v, want 0.42", misread.Evidence["timing_gap_seconds"])
	}

	skipped := findByAudio(t, grouped["chapter-1"], "")
	if skipped.Confidence == nil || *skipped.Confidence != 0.3 {
		t.Errorf("low-confidence SKIPPED: Confidence = %v, want 0.3", skipped.Confidence)
	}
	if skipped.Severity != findings.SeverityWarning {
		t.Errorf("SKIPPED severity = %s, want warning", skipped.Severity)
	}

	extra := findByAudio(t, grouped["chapter-1"], "and then")
	if extra.Confidence != nil {
		t.Errorf("unknown-confidence EXTRA: Confidence = %v, want nil (no fabricated score)", *extra.Confidence)
	}
	if extra.ConfidenceReason == "" {
		t.Error("a nil Confidence must still carry a ConfidenceReason")
	}
	if extra.Severity != findings.SeverityInfo {
		t.Errorf("EXTRA severity = %s, want info (provisional mapping)", extra.Severity)
	}
	if extra.Evidence["existing_marker_name"] != "TAKE 2" || extra.Evidence["marker_state"] != "existing" {
		t.Errorf("EXTRA evidence did not carry markerState/existingMarkerName: %#v", extra.Evidence)
	}
}

func findByAudio(t *testing.T, all []findings.Finding, audio string) findings.Finding {
	t.Helper()
	for _, f := range all {
		if f.Manuscript.Recorded == audio {
			return f
		}
	}
	t.Fatalf("no finding with recorded audio %q among %d findings", audio, len(all))
	return findings.Finding{}
}

func TestBuildFindingsGivesRepeatedExpectedTextDistinctOrdinalsAndIDs(t *testing.T) {
	lookup := &fakeLookup{chapterID: "chapter-1", chapterOK: true}
	grouped, err := BuildFindings(fixtureRows(), resultsFixture(), manifestFixture(), findings.Project{}, lookup)
	if err != nil {
		t.Fatal(err)
	}
	var repeats []findings.Finding
	for _, f := range grouped["chapter-1"] {
		if f.Manuscript.Expected == "the quick brown fox" {
			repeats = append(repeats, f)
		}
	}
	if len(repeats) != 2 {
		t.Fatalf("got %d MISREAD findings for the repeated expected text, want 2", len(repeats))
	}
	if repeats[0].ID == repeats[1].ID {
		t.Fatal("repeated expected text in the same chapter/paragraph must still get distinct ids (ordinal)")
	}
	ordinals := map[int]bool{repeats[0].Manuscript.Span.Ordinal: true, repeats[1].Manuscript.Span.Ordinal: true}
	if !ordinals[0] || !ordinals[1] {
		t.Errorf("ordinals = %v, want {0, 1}", ordinals)
	}
	if repeats[0].EvidenceVersion == repeats[1].EvidenceVersion {
		t.Error("the two repeats recorded different audio text and must get different EvidenceVersion")
	}
}

func TestBuildFindingsIsDeterministicOnRepeatedRuns(t *testing.T) {
	lookup := &fakeLookup{chapterID: "chapter-1", chapterOK: true, paragraphID: "para-3", paragraphOK: true}
	first, err := BuildFindings(fixtureRows(), resultsFixture(), manifestFixture(), findings.Project{}, lookup)
	if err != nil {
		t.Fatal(err)
	}
	second, err := BuildFindings(fixtureRows(), resultsFixture(), manifestFixture(), findings.Project{}, lookup)
	if err != nil {
		t.Fatal(err)
	}
	if len(first["chapter-1"]) != len(second["chapter-1"]) {
		t.Fatal("two builds over identical input produced different finding counts")
	}
	for i := range first["chapter-1"] {
		a, b := first["chapter-1"][i], second["chapter-1"][i]
		if a.ID != b.ID || a.EvidenceVersion != b.EvidenceVersion {
			t.Errorf("finding %d not reproducible: (%s,%s) vs (%s,%s)", i, a.ID, a.EvidenceVersion, b.ID, b.EvidenceVersion)
		}
	}
}

func TestBuildFindingsEvidenceVersionIgnoresJitterBelowToleranceButNotBeyondIt(t *testing.T) {
	lookup := &fakeLookup{chapterID: "chapter-1", chapterOK: true}
	base := fixtureRows()
	jittered := fixtureRows()
	jittered[0]["projectTime"] = base[0]["projectTime"].(float64) + timingToleranceSeconds*0.1
	shifted := fixtureRows()
	shifted[0]["projectTime"] = base[0]["projectTime"].(float64) + timingToleranceSeconds*3

	baseFindings, err := BuildFindings(base, resultsFixture(), manifestFixture(), findings.Project{}, lookup)
	if err != nil {
		t.Fatal(err)
	}
	jitteredFindings, err := BuildFindings(jittered, resultsFixture(), manifestFixture(), findings.Project{}, lookup)
	if err != nil {
		t.Fatal(err)
	}
	shiftedFindings, err := BuildFindings(shifted, resultsFixture(), manifestFixture(), findings.Project{}, lookup)
	if err != nil {
		t.Fatal(err)
	}

	baseFirst := findByAudio(t, baseFindings["chapter-1"], "the quick brown socks")
	jitteredFirst := findByAudio(t, jitteredFindings["chapter-1"], "the quick brown socks")
	shiftedFirst := findByAudio(t, shiftedFindings["chapter-1"], "the quick brown socks")

	if baseFirst.ID != jitteredFirst.ID || baseFirst.ID != shiftedFirst.ID {
		t.Fatal("id must never depend on timing")
	}
	if baseFirst.EvidenceVersion != jitteredFirst.EvidenceVersion {
		t.Error("timing jitter under the tolerance changed EvidenceVersion")
	}
	if baseFirst.EvidenceVersion == shiftedFirst.EvidenceVersion {
		t.Error("timing shifted well beyond the tolerance did not change EvidenceVersion")
	}
}

func TestBuildFindingsFallsBackToTitleWhenChapterUnresolved(t *testing.T) {
	grouped, err := BuildFindings(fixtureRows(), resultsFixture(), manifestFixture(), findings.Project{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	var all []findings.Finding
	for _, group := range grouped {
		all = append(all, group...)
	}
	if len(all) != 4 {
		t.Fatalf("got %d findings, want 4 even with no manuscript lookup", len(all))
	}
	for _, f := range all {
		if f.Manuscript.ChapterID != "Chapter One" {
			t.Errorf("unresolved chapter id = %q, want the raw title", f.Manuscript.ChapterID)
		}
		if f.Evidence["chapter_id_unresolved"] != true {
			t.Errorf("finding %s: expected chapter_id_unresolved evidence flag", f.ID)
		}
		if err := f.Validate(); err != nil {
			t.Errorf("finding %s failed Validate(): %v", f.ID, err)
		}
	}
	// The scope key must still be a safe store path component even though
	// the chapter id itself is a raw, space-and-punctuation title.
	for scope := range grouped {
		if !scopeNamePattern.MatchString(scope) {
			t.Errorf("scope %q is not a safe store scope name", scope)
		}
	}
}

func TestBuildFindingsTreatsAnAmbiguousChapterTitleAsUnresolved(t *testing.T) {
	lookup := &fakeLookup{chapterID: "chapter-1", chapterAmbiguous: true, chapterOK: true}
	grouped, err := BuildFindings(fixtureRows(), resultsFixture(), manifestFixture(), findings.Project{}, lookup)
	if err != nil {
		t.Fatal(err)
	}
	for _, group := range grouped {
		for _, f := range group {
			if f.Manuscript.ChapterID != "Chapter One" {
				t.Errorf("ambiguous match: ChapterID = %q, want the raw title fallback", f.Manuscript.ChapterID)
			}
			if f.Evidence["chapter_id_unresolved"] != true {
				t.Error("ambiguous match must flag chapter_id_unresolved")
			}
		}
	}
}

func TestBuildFindingsReturnsAnErrorWhenTheResultsFileIsMissing(t *testing.T) {
	if _, err := BuildFindings(fixtureRows(), "testdata/does-not-exist.txt", manifestFixture(), findings.Project{}, nil); err == nil {
		t.Fatal("BuildFindings() with a missing results file = nil error, want one")
	}
}

func TestBuildFindingsToleratesAMissingManifest(t *testing.T) {
	grouped, err := BuildFindings(fixtureRows(), resultsFixture(), "testdata/does-not-exist.txt", findings.Project{}, &fakeLookup{chapterID: "chapter-1", chapterOK: true})
	if err != nil {
		t.Fatalf("a missing manifest must not fail the whole run: %v", err)
	}
	for _, f := range grouped["chapter-1"] {
		if f.Source.File != "" {
			t.Errorf("finding %s: Source.File = %q, want empty with no manifest", f.ID, f.Source.File)
		}
		if err := f.Validate(); err != nil {
			t.Errorf("finding %s failed Validate() with no manifest: %v", f.ID, err)
		}
	}
}

func TestRowIDMatchesTheLuaBridgeFormat(t *testing.T) {
	// narration_compare.lua: tostring(item_index) .. '@' .. string.format('%.6f', srcpos)
	if got, want := rowID(3, 12.34), "3@12.340000"; got != want {
		t.Errorf("rowID(3, 12.34) = %q, want %q", got, want)
	}
	if got, want := rowID(0, 0.5), strconv.Itoa(0)+"@0.500000"; got != want {
		t.Errorf("rowID(0, 0.5) = %q, want %q", got, want)
	}
}
