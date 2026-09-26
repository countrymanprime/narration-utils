package takereview

import (
	"os"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/repeats"
)

// sentinelWord stands in for manuscript content: if it ever reaches the run log, a decision record picked up a field
// it should not have (docs/prds/tool-run-logging.prd.md's content rule, ADR 0251, threat-model row 7a). ChapterTitle
// is the one field on Request that carries narrator-authored text through Scan.
const sentinelWord = "SENTINEL-Xk3q9-do-not-log-this-chapter-title"

func TestScanNeverLogsChapterTitleTextAtDebugLevel(t *testing.T) {
	store := findings.NewStore(t.TempDir())
	runner := &fakeRunner{output: "SUMMARY|Found 0 repeated-span group(s) across 0 segment(s)\n"}
	scanner := &Scanner{Runner: runner, Store: store}
	ctx, path := debugRunContext(t)

	if _, err := scanner.Scan(ctx, Request{
		Project:        chapterTrackFixture(),
		ProjectPath:    "P",
		ManuscriptPath: "manuscript.json",
		ChapterID:      "c1",
		ChapterTitle:   sentinelWord,
		Scope:          Scope{ChapterTrackName: "Chapter 1"},
		Thresholds:     repeats.DefaultThresholds(),
	}); err != nil {
		t.Fatalf("Scan: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), sentinelWord) {
		t.Fatalf("the chapter title leaked into the run log:\n%s", data)
	}
}
