package coverage

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// sampleResults is a results file in the shape the sidecar writes (the
// payloads of sidecars/transcript-compare/tests/test_coverage_mode.py's
// cached run, plus a paragraph with a skipped block and a line with a tag a
// newer sidecar might add).
const sampleResults = `COVERAGE|{"alignment":{"maxMisreadRun":8,"minAnchorRun":3},"analysis":{"equivalencesHash":null,"language":null,"model":"small"},"bodyTokens":40,"chapterId":"c-0001","extraTokens":2,"items":{"analyzed":2,"muted":1,"playedSeconds":16.0,"reused":2,"transcribed":0},"longestMissingRun":12,"missingTokens":14,"presentTokens":26,"schemaVersion":1}
COVERAGE_ITEM|{"index":0,"itemGuid":"{A}","language":"en","model":"small","playedSeconds":10.0,"status":"analyzed","wordCount":19,"words":"reused"}
COVERAGE_ITEM|{"index":1,"itemGuid":"{M}","language":null,"model":null,"playedSeconds":4.0,"status":"muted","wordCount":0,"words":null}
COVERAGE_PARAGRAPH|{"id":"p-000001","longestMissingRun":0,"present":15,"tokens":15}
COVERAGE_PARAGRAPH|{"id":"p-000002","longestMissingRun":2,"present":11,"tokens":13}
COVERAGE_PARAGRAPH|{"id":"p-000003","longestMissingRun":12,"present":0,"tokens":12}
COVERAGE_REGION|{"firstWord":"tired","kind":"skip","lastWord":"bank.","paragraphIds":["p-000002"],"position":{"itemGuid":"{A}","itemIndex":0,"sourceTime":14.2},"tokenCount":2}
COVERAGE_REGION|{"firstWord":"So","kind":"tail","lastWord":"do.","paragraphIds":["p-000003"],"position":null,"tokenCount":12}
COVERAGE_SOMETHING_NEW|{"ignored":true}
`

func TestAResultsFileIsReadIntoAReport(t *testing.T) {
	report, err := parseReport([]byte(sampleResults), "c-0001")
	if err != nil {
		t.Fatal(err)
	}
	if report.Summary.BodyTokens != 40 || report.Summary.Items.Muted != 1 || report.Summary.Analysis.Model != "small" || report.Summary.Analysis.Language != nil {
		t.Fatalf("summary = %+v", report.Summary)
	}
	if len(report.Items) != 2 || report.Items[1].Status != "muted" || report.Items[1].Words != nil {
		t.Fatalf("items = %+v", report.Items)
	}
	if len(report.Paragraphs) != 3 || len(report.Regions) != 2 || report.Regions[0].Position.SourceTime != 14.2 || report.Regions[1].Position != nil {
		t.Fatalf("report = %+v", report)
	}
	if got := report.PresentFraction(); got != 26.0/40.0 {
		t.Fatalf("present fraction = %v", got)
	}
}

func TestThresholdsAreAppliedOnRead(t *testing.T) {
	report, err := parseReport([]byte(sampleResults), "c-0001")
	if err != nil {
		t.Fatal(err)
	}
	if report.TextComplete(DefaultThresholds) {
		t.Fatal("a 12-word tail must not pass the defaults")
	}
	if !report.TextComplete(Thresholds{MinParagraphPresent: 0, MaxMissingRun: 12}) {
		t.Fatal("the same report passes thresholds loose enough to allow it")
	}
	if report.TextComplete(Thresholds{MinParagraphPresent: 0.5, MaxMissingRun: 12}) {
		t.Fatal("an unread paragraph fails a present fraction of 0.5")
	}
	if report.TextComplete(Thresholds{MinParagraphPresent: 0, MaxMissingRun: 11}) {
		t.Fatal("a run of 12 fails a maximum of 11")
	}
	complete := Report{Summary: Summary{BodyTokens: 0}, Paragraphs: []ParagraphLine{{ID: "p-1"}}}
	if !complete.TextComplete(DefaultThresholds) || complete.PresentFraction() != 1 {
		t.Fatal("an empty chapter or paragraph counts as present")
	}
}

func TestAResultsFileThatDoesNotAddUpIsRefused(t *testing.T) {
	replace := func(old, new string) string { return strings.Replace(sampleResults, old, new, 1) }
	cases := map[string]struct {
		text    string
		chapter string
		want    string
	}{
		"another chapter":        {sampleResults, "c-0002", "not \"c-0002\""},
		"no summary":             {replace(`COVERAGE|{"alignment"`, `COVERAGE_OLD|{"alignment"`), "c-0001", "0 COVERAGE lines"},
		"two summaries":          {sampleResults + strings.SplitN(sampleResults, "\n", 2)[0] + "\n", "c-0001", "2 COVERAGE lines"},
		"a line with no tag":     {sampleResults + "garbage\n", "c-0001", "has no tag"},
		"a payload that is bad":  {replace(`COVERAGE_PARAGRAPH|{"id":"p-000001"`, `COVERAGE_PARAGRAPH|{"id":1`), "c-0001", "could not be read"},
		"another schema":         {replace(`"schemaVersion":1`, `"schemaVersion":2`), "c-0001", "schema version 2"},
		"counts that do not add": {replace(`"presentTokens":26`, `"presentTokens":25`), "c-0001", "do not add up"},
		"a negative count":       {replace(`"extraTokens":2`, `"extraTokens":-1`), "c-0001", "negative"},
		"a run past the missing": {replace(`"longestMissingRun":12,"missingTokens"`, `"longestMissingRun":15,"missingTokens"`), "c-0001", "longest missing run"},
		"paragraphs that differ": {replace(`"present":15,"tokens":15`, `"present":15,"tokens":16`), "c-0001", "paragraphs hold 41"},
		"a bad paragraph":        {replace(`"present":11,"tokens":13`, `"present":14,"tokens":13`), "c-0001", "invalid paragraph"},
		"an unknown region":      {replace(`"kind":"skip"`, `"kind":"hole"`), "c-0001", "invalid \"hole\" region"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := parseReport([]byte(tc.text), tc.chapter)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err = %v, want it to mention %q", err, tc.want)
			}
		})
	}
}

func TestAResultsFileIsReadFromDiskWithABound(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "coverage.txt")
	if _, err := readReport(path, "c-0001"); err == nil {
		t.Fatal("a missing results file must be an error")
	}
	if err := os.WriteFile(path, []byte(strings.ReplaceAll(sampleResults, "\n", "\r\n")), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := readReport(path, "c-0001"); err != nil {
		t.Fatalf("CRLF line ends must read: %v", err)
	}
	big, err := os.Create(filepath.Join(dir, "big.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if err := big.Truncate(maxResultsBytes + 1); err != nil {
		t.Fatal(err)
	}
	_ = big.Close()
	if _, err := readReport(big.Name(), "c-0001"); err == nil || !strings.Contains(err.Error(), "larger than") {
		t.Fatalf("err = %v", err)
	}
}
