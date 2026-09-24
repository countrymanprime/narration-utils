package coverage

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// providerFor builds a provider over service whose settings and availability
// the test controls.
func providerFor(service *Service, settings *Settings, unavailable *string) *SignalProvider {
	return NewSignalProvider(service, SignalSources{
		Settings:    func() Settings { return *settings },
		Unavailable: func() string { return *unavailable },
		Now:         func() time.Time { return signalNow },
	})
}

// viewOf parses the fixture's saved project the way the stage recommendations
// service builds its shared EvidenceView.
func viewOf(t *testing.T, p *testProject) stages.EvidenceView {
	t.Helper()
	project, err := tracks.Parse(p.rpp)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(p.rpp)
	if err != nil {
		t.Fatal(err)
	}
	return stages.EvidenceView{DocumentID: testDocument, ProjectFolder: p.dir, Project: project, ProjectFile: projectFileFact(p.rpp, info.ModTime())}
}

func chapterOne() stages.ChapterContext {
	return stages.ChapterContext{DocumentID: testDocument, ChapterID: testChapter, Title: "Chapter One", Status: stages.StageRecording}
}

func oneSignal(t *testing.T, provider *SignalProvider, chapter stages.ChapterContext, view stages.EvidenceView) stages.Signal {
	t.Helper()
	signals, err := provider.Signals(context.Background(), chapter, view)
	if err != nil {
		t.Fatalf("Signals: %v", err)
	}
	if len(signals) != 1 || signals[0].ID != RecordingSignalID {
		t.Fatalf("signals = %+v, want the one recording signal", signals)
	}
	if err := signals[0].Validate(); err != nil {
		t.Fatal(err)
	}
	return signals[0]
}

func TestProviderDeclaresTheRecordingSignal(t *testing.T) {
	provider := NewSignalProvider(nil, SignalSources{})
	if provider.Stage() != stages.StageRecording || len(provider.SignalIDs()) != 1 || provider.SignalIDs()[0] != RecordingSignalID {
		t.Fatalf("stage %s ids %v", provider.Stage(), provider.SignalIDs())
	}
}

func TestProviderIsMetForACurrentCompleteCheckAndTheEngineRecommends(t *testing.T) {
	p := newTestProject(t)
	service := p.service(&fakeSidecar{})
	run(t, service, testRequest())
	settings, unavailable := DefaultSettings, ""
	provider := providerFor(service, &settings, &unavailable)

	signal := oneSignal(t, provider, chapterOne(), viewOf(t, p))
	if signal.State != stages.SignalMet || !signal.ComputedAt.Equal(signalNow) || len(signal.Basis.LedgerRecordIDs) != 1 || signal.Basis.Fingerprint == "" {
		t.Fatalf("signal = %+v", signal)
	}

	providers := []stages.Provider{provider}
	collected := stages.Collect(context.Background(), providers, chapterOne(), viewOf(t, p))
	assessment := stages.Evaluate(stages.Input{Chapter: chapterOne(), Required: stages.DeclaredSignalIDs(providers, stages.StageRecording), Signals: collected})
	if assessment.Verdict != stages.VerdictRecommended || assessment.Target != stages.StageEditing {
		t.Fatalf("assessment = %+v", assessment)
	}
}

func TestProviderAppliesAThresholdChangeOnReadWithoutRunningAnything(t *testing.T) {
	p := newTestProject(t)
	sidecar := &fakeSidecar{present: 8}
	service := p.service(sidecar)
	run(t, service, testRequest())
	settings, unavailable := DefaultSettings, ""
	settings.Thresholds.MinParagraphPresent = 0.95
	provider := providerFor(service, &settings, &unavailable)

	notMet := oneSignal(t, provider, chapterOne(), viewOf(t, p))
	if notMet.State != stages.SignalNotMet || !strings.Contains(notMet.Reason, "paragraph 1: 8 of 10 words read") {
		t.Fatalf("signal = %+v", notMet)
	}

	settings.Thresholds.MinParagraphPresent = 0.8
	met := oneSignal(t, provider, chapterOne(), viewOf(t, p))
	if met.State != stages.SignalMet {
		t.Fatalf("a lower threshold must pass the same result: %+v", met)
	}
	if launches := len(sidecar.launches); launches != 1 || len(sidecar.transcriptions()) != 2 {
		t.Fatalf("a threshold change ran the sidecar (%d launches)", launches)
	}
	if notMet.Basis.Fingerprint != met.Basis.Fingerprint || notMet.Basis.LedgerRecordIDs[0] != met.Basis.LedgerRecordIDs[0] {
		t.Fatalf("a threshold change must keep the basis: %+v, %+v", notMet.Basis, met.Basis)
	}
}

func TestProviderReadsAnAlignmentChangeAsStale(t *testing.T) {
	p := newTestProject(t)
	service := p.service(&fakeSidecar{})
	run(t, service, testRequest())
	settings, unavailable := DefaultSettings, ""
	settings.Alignment.MinAnchorRun = 5
	provider := providerFor(service, &settings, &unavailable)

	signal := oneSignal(t, provider, chapterOne(), viewOf(t, p))
	if signal.State != stages.SignalUnknown || signal.Cause != stages.CauseStale || !strings.Contains(signal.Reason, "settings changed") {
		t.Fatalf("signal = %+v", signal)
	}
}

func TestProviderUnknownCauses(t *testing.T) {
	t.Run("never analyzed", func(t *testing.T) {
		p := newTestProject(t)
		settings, unavailable := DefaultSettings, ""
		signal := oneSignal(t, providerFor(p.service(&fakeSidecar{}), &settings, &unavailable), chapterOne(), viewOf(t, p))
		if signal.Cause != stages.CauseNeverAnalyzed {
			t.Fatalf("signal = %+v", signal)
		}
	})
	t.Run("model missing", func(t *testing.T) {
		p := newTestProject(t)
		settings, unavailable := DefaultSettings, "the Whisper model small is not installed"
		signal := oneSignal(t, providerFor(p.service(&fakeSidecar{}), &settings, &unavailable), chapterOne(), viewOf(t, p))
		if signal.Cause != stages.CauseMeasurementUnavailable || !strings.Contains(signal.Reason, "not installed") {
			t.Fatalf("signal = %+v", signal)
		}
	})
	t.Run("an item edited since the check", func(t *testing.T) {
		p := newTestProject(t)
		service := p.service(&fakeSidecar{})
		run(t, service, testRequest())
		p.items[0].length = 7
		p.writeRPP()
		settings, unavailable := DefaultSettings, ""
		signal := oneSignal(t, providerFor(service, &settings, &unavailable), chapterOne(), viewOf(t, p))
		if signal.Cause != stages.CauseStale || !strings.Contains(signal.Reason, "trimmed") {
			t.Fatalf("signal = %+v", signal)
		}
	})
	t.Run("the manuscript changed", func(t *testing.T) {
		p := newTestProject(t)
		service := p.service(&fakeSidecar{})
		run(t, service, testRequest())
		p.writeManuscript(testDocument, "Chapter One", "Alice was beginning to get very tired indeed.")
		settings, unavailable := DefaultSettings, ""
		signal := oneSignal(t, providerFor(service, &settings, &unavailable), chapterOne(), viewOf(t, p))
		if signal.Cause != stages.CauseStale || !strings.Contains(signal.Reason, "text changed") {
			t.Fatalf("signal = %+v", signal)
		}
	})
	t.Run("a failed check after a complete one", func(t *testing.T) {
		p := newTestProject(t)
		service := p.service(&fakeSidecar{})
		run(t, service, testRequest())
		failing := p.service(&fakeSidecar{exitCode: 1, errorMessage: "decode failed"})
		run(t, failing, testRequest())
		settings, unavailable := DefaultSettings, ""
		signal := oneSignal(t, providerFor(failing, &settings, &unavailable), chapterOne(), viewOf(t, p))
		if signal.Cause != stages.CauseIncompleteRun || len(signal.Basis.LedgerRecordIDs) != 2 {
			t.Fatalf("signal = %+v", signal)
		}
	})
	t.Run("a check running now", func(t *testing.T) {
		p := newTestProject(t)
		sidecar := &fakeSidecar{pauseAfter: 1, paused: make(chan struct{}), resume: make(chan struct{})}
		service := p.service(sidecar)
		if _, err := service.Start(testRequest()); err != nil {
			t.Fatal(err)
		}
		<-sidecar.paused
		settings, unavailable := DefaultSettings, ""
		signal := oneSignal(t, providerFor(service, &settings, &unavailable), chapterOne(), viewOf(t, p))
		close(sidecar.resume)
		service.Wait()
		if signal.Cause != stages.CauseAnalysisRunning {
			t.Fatalf("signal = %+v", signal)
		}
	})
	t.Run("a track matches by name but is not confirmed", func(t *testing.T) {
		p := newTestProject(t)
		if err := evidence.NewMappingStore(p.dir).Clear(testDocument, testTrack); err != nil {
			t.Fatal(err)
		}
		settings, unavailable := DefaultSettings, ""
		signal := oneSignal(t, providerFor(p.service(&fakeSidecar{}), &settings, &unavailable), chapterOne(), viewOf(t, p))
		if signal.Cause != stages.CauseUnconfirmedMapping {
			t.Fatalf("signal = %+v", signal)
		}
	})
	t.Run("no track at all", func(t *testing.T) {
		p := newTestProject(t)
		if err := evidence.NewMappingStore(p.dir).Clear(testDocument, testTrack); err != nil {
			t.Fatal(err)
		}
		chapter := chapterOne()
		chapter.Title = "A Mad Tea-Party"
		settings, unavailable := DefaultSettings, ""
		signal := oneSignal(t, providerFor(p.service(&fakeSidecar{}), &settings, &unavailable), chapter, viewOf(t, p))
		if signal.Cause != stages.CauseUnmappedTrack {
			t.Fatalf("signal = %+v", signal)
		}
	})
	t.Run("a name match already linked to another chapter is no suggestion", func(t *testing.T) {
		p := newTestProject(t)
		store := evidence.NewMappingStore(p.dir)
		if err := store.Clear(testDocument, testTrack); err != nil {
			t.Fatal(err)
		}
		if _, err := store.Confirm(testDocument, testTrack, "c-0003", "Chapter One"); err != nil {
			t.Fatal(err)
		}
		settings, unavailable := DefaultSettings, ""
		signal := oneSignal(t, providerFor(p.service(&fakeSidecar{}), &settings, &unavailable), chapterOne(), viewOf(t, p))
		if signal.Cause != stages.CauseUnmappedTrack {
			t.Fatalf("signal = %+v", signal)
		}
	})
	t.Run("a check cancelled after a complete one", func(t *testing.T) {
		p := newTestProject(t)
		service := p.service(&fakeSidecar{})
		run(t, service, testRequest())
		p.items[0].length = 12 // a longer item range the cached words do not cover, so the second check transcribes and can be paused
		p.writeRPP()
		sidecar := &fakeSidecar{pauseAfter: 1, paused: make(chan struct{}), resume: make(chan struct{})}
		cancelled := p.service(sidecar)
		if _, err := cancelled.Start(testRequest()); err != nil {
			t.Fatal(err)
		}
		<-sidecar.paused
		cancelled.Cancel()
		close(sidecar.resume)
		cancelled.Wait()
		settings, unavailable := DefaultSettings, ""
		signal := oneSignal(t, providerFor(cancelled, &settings, &unavailable), chapterOne(), viewOf(t, p))
		if signal.Cause != stages.CauseIncompleteRun || !strings.Contains(signal.Reason, "cancelled") {
			t.Fatalf("signal = %+v", signal)
		}
	})
	t.Run("no saved project file is chosen", func(t *testing.T) {
		p := newTestProject(t)
		service := p.service(&fakeSidecar{})
		service.config.ProjectFile = func() (string, error) { return "", errors.New("not chosen") }
		settings, unavailable := DefaultSettings, ""
		signal := oneSignal(t, providerFor(service, &settings, &unavailable), chapterOne(), service.EvidenceView(context.Background(), testDocument))
		if signal.Cause != stages.CauseProjectUnreadable || !strings.Contains(signal.Reason, "Tracks page") {
			t.Fatalf("signal = %+v", signal)
		}
	})
	t.Run("the saved project could not be read", func(t *testing.T) {
		p := newTestProject(t)
		view := viewOf(t, p)
		view.ProjectErr = errors.New("truncated")
		settings, unavailable := DefaultSettings, ""
		signal := oneSignal(t, providerFor(p.service(&fakeSidecar{}), &settings, &unavailable), chapterOne(), view)
		if signal.Cause != stages.CauseProjectUnreadable || !strings.Contains(signal.Reason, "truncated") {
			t.Fatalf("signal = %+v", signal)
		}
	})
}

func TestEvidenceViewParsesTheSavedProjectOnce(t *testing.T) {
	p := newTestProject(t)
	service := p.service(&fakeSidecar{})

	view := service.EvidenceView(context.Background(), testDocument)
	want := viewOf(t, p)
	if view.ProjectErr != nil || view.DocumentID != testDocument || view.ProjectFolder != p.dir || view.ProjectFile != want.ProjectFile {
		t.Fatalf("view = %+v", view)
	}
	if len(view.Project.Tracks) != 1 || view.Project.Tracks[0].GUID != testTrack || len(view.Project.Tracks[0].Items) != 2 {
		t.Fatalf("project = %+v", view.Project)
	}
	if view.Ledger == nil || view.Mapping == nil {
		t.Fatal("the view must carry the project's ledger and mapping stores")
	}
	links, err := view.Mapping.List(testDocument)
	if err != nil || len(links) != 1 || links[0].TrackGUID != testTrack {
		t.Fatalf("mapping = %+v, %v", links, err)
	}
}

func TestEvidenceViewReportsAnUnreadableProject(t *testing.T) {
	p := newTestProject(t)
	if err := os.Remove(p.rpp); err != nil {
		t.Fatal(err)
	}
	service := p.service(&fakeSidecar{})

	view := service.EvidenceView(context.Background(), testDocument)
	if reason, ok := ReasonOf(view.ProjectErr); !ok || reason != ReasonProjectUnreadable {
		t.Fatalf("project error = %v", view.ProjectErr)
	}
	settings, unavailable := DefaultSettings, ""
	signal := oneSignal(t, providerFor(service, &settings, &unavailable), chapterOne(), view)
	if signal.Cause != stages.CauseProjectUnreadable || !strings.Contains(signal.Reason, "Save it again") {
		t.Fatalf("signal = %+v", signal)
	}
}

func TestProviderFailsWhenItCannotAnswer(t *testing.T) {
	p := newTestProject(t)
	settings, unavailable := DefaultSettings, ""
	provider := providerFor(p.service(&fakeSidecar{}), &settings, &unavailable)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if _, err := provider.Signals(ctx, chapterOne(), viewOf(t, p)); err == nil {
		t.Fatal("a cancelled evaluation must fail, not answer")
	}
	collected := stages.Collect(ctx, []stages.Provider{provider}, chapterOne(), viewOf(t, p))
	if len(collected) != 1 || collected[0].Cause != stages.CauseProviderError {
		t.Fatalf("collected = %+v", collected)
	}
	if _, err := NewSignalProvider(nil, SignalSources{}).Signals(context.Background(), chapterOne(), viewOf(t, p)); err == nil {
		t.Fatal("a provider with no project's coverage service must fail")
	}
}
