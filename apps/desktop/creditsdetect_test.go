package main

import (
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/credits"
	"github.com/countrymanprime/narration-utils/shell/internal/layout"
	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
)

// TestCreditsDetectReadsTheOwnersBookThroughARealImport is the "Stored-source defect" Success Metric of
// credits-token-setup-and-front-matter-detection.prd.md: credits.Detect reads a real commit()-produced project (a
// storedPath commit() itself wrote, not a made-up one) and finds the same values the owner's report expects from
// tests/fixtures/after-the-applause.md.
func TestCreditsDetectReadsTheOwnersBookThroughARealImport(t *testing.T) {
	project := t.TempDir()
	service := manuscript.New(project)
	job := service.Begin(layout.RepoFile(layout.FixturesDir + "/after-the-applause.md"))
	if _, err := service.Preview(job.ID, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Commit(job.ID, false, manuscript.Choices{}); err != nil {
		t.Fatal(err)
	}

	candidates := credits.Detect(project)

	byToken := map[string]credits.Candidate{}
	for _, candidate := range candidates {
		byToken[candidate.Token] = candidate
	}
	if got := byToken[credits.TokenTitle]; got.Value != "After the Applause" || got.Confidence != credits.ConfidenceHigh {
		t.Fatalf("Title = %+v, want \"After the Applause\" at high confidence", got)
	}
	if got := byToken[credits.TokenAuthor]; got.Value != "Adrian Crow" || got.Confidence != credits.ConfidenceHigh {
		t.Fatalf("Author = %+v, want \"Adrian Crow\" at high confidence", got)
	}
	if got := byToken[credits.TokenYear]; got.Value != "2026" {
		t.Fatalf("Year = %+v, want \"2026\"", got)
	}
	if got := byToken[credits.TokenCopyrightHolder]; got.Value != "Adrian Crow" {
		t.Fatalf("CopyrightHolder = %+v, want \"Adrian Crow\"", got)
	}
	if _, ok := byToken[credits.TokenSubtitle]; ok {
		t.Fatal("\"A Novel\" must not become a Subtitle (CS5)")
	}
}
