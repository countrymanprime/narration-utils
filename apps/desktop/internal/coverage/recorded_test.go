package coverage

import (
	"os"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
)

// recordedFractions is RecordedFractions with the default alignment.
func recordedFractions(service *Service) map[string]float64 {
	return service.RecordedFractions(DefaultAlignmentParams)
}

func TestACurrentCompleteResultGivesTheChaptersPresentWordFraction(t *testing.T) {
	p := newTestProject(t)
	service := p.service(&fakeSidecar{present: 8})
	run(t, service, testRequest())

	fractions := recordedFractions(service)

	if len(fractions) != 1 || fractions[testChapter] != 0.8 {
		t.Fatalf("fractions = %v, want %s: 0.8 (8 of 10 words present)", fractions, testChapter)
	}
}

func TestAChapterNeverCheckedHasNoFractionAndTheSavedProjectIsNotRead(t *testing.T) {
	p := newTestProject(t)
	reads := 0
	service := New(Config{
		Project: p.dir, Python: "python-sidecar",
		ProjectFile:    func() (string, error) { reads++; return p.rpp, nil },
		LoadManuscript: p.loadManuscript,
	}, (&fakeSidecar{}).launcher(), nil)

	fractions := recordedFractions(service)

	if len(fractions) != 0 {
		t.Fatalf("fractions = %v, want none", fractions)
	}
	if reads != 0 {
		t.Fatalf("with no complete record the saved project must not be read (read %d times)", reads)
	}
}

func TestAStaleResultHasNoFraction(t *testing.T) {
	cases := map[string]func(p *testProject){
		"an item edit": func(p *testProject) {
			p.items[1].length = 9
			p.writeRPP()
		},
		"a manuscript text change": func(p *testProject) {
			p.writeManuscript(testDocument, "Chapter One", "Alice was beginning to get very tired indeed.")
		},
		"a vocabulary hints change": func(p *testProject) {
			p.writeFile("TranscriptCompare/vocabulary_hints.txt", "Dinah\n")
		},
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			p := newTestProject(t)
			service := p.service(&fakeSidecar{})
			run(t, service, testRequest())

			change(p)

			if fractions := recordedFractions(service); len(fractions) != 0 {
				t.Fatalf("fractions = %v, want none for a stale result", fractions)
			}
		})
	}
}

func TestAnAlignmentParameterChangeLeavesNoFraction(t *testing.T) {
	p := newTestProject(t)
	service := p.service(&fakeSidecar{})
	run(t, service, testRequest())

	if fractions := service.RecordedFractions(AlignmentParams{MaxMisreadRun: 4, MinAnchorRun: 3}); len(fractions) != 0 {
		t.Fatalf("fractions = %v, want none", fractions)
	}
}

func TestAnUnmappedChapterHasNoFraction(t *testing.T) {
	p := newTestProject(t)
	service := p.service(&fakeSidecar{})
	run(t, service, testRequest())

	if err := os.Remove(evidence.MappingFile(p.dir)); err != nil {
		t.Fatal(err)
	}

	if fractions := recordedFractions(service); len(fractions) != 0 {
		t.Fatalf("fractions = %v, want none for an unmapped chapter", fractions)
	}
}

func TestAPartialOrFailedRunGivesNoFraction(t *testing.T) {
	t.Run("partial", func(t *testing.T) {
		p := newTestProject(t)
		sidecar := &fakeSidecar{pauseAfter: 1, paused: make(chan struct{}), resume: make(chan struct{})}
		service := p.service(sidecar)
		if _, err := service.Start(testRequest()); err != nil {
			t.Fatal(err)
		}
		<-sidecar.paused
		service.Cancel()
		close(sidecar.resume)
		service.Wait()

		if fractions := recordedFractions(service); len(fractions) != 0 {
			t.Fatalf("fractions = %v, want none after a cancelled run", fractions)
		}
	})
	t.Run("failed", func(t *testing.T) {
		p := newTestProject(t)
		service := p.service(&fakeSidecar{exitCode: 1, errorMessage: "boom"})
		run(t, service, testRequest())

		if fractions := recordedFractions(service); len(fractions) != 0 {
			t.Fatalf("fractions = %v, want none after a failed run", fractions)
		}
	})
}

func TestTheNewestCompleteRunWinsAndAnUnreadableSavedProjectGivesNoFraction(t *testing.T) {
	p := newTestProject(t)
	run(t, p.service(&fakeSidecar{present: 5}), testRequest())
	service := p.service(&fakeSidecar{present: 9})
	run(t, service, testRequest())

	if fractions := recordedFractions(service); fractions[testChapter] != 0.9 {
		t.Fatalf("fractions = %v, want the newest run's 0.9", fractions)
	}

	if err := os.Remove(p.rpp); err != nil {
		t.Fatal(err)
	}
	if fractions := recordedFractions(service); len(fractions) != 0 {
		t.Fatalf("fractions = %v, want none without a readable saved project", fractions)
	}
}
