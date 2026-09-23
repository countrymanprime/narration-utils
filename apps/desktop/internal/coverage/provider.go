package coverage

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// SignalSources are what the recording signal needs from the host besides
// stored evidence: the narrator's current settings, why a check could not be
// run here now ("" when it could), and the clock stamped on the signal.
type SignalSources struct {
	Settings    func() Settings
	Unavailable func() string
	Now         func() time.Time
}

// SignalProvider is the recording stage's stages.Provider (docs/utilities/recording-coverage.md
// Phase 7). It reads stored coverage results, the ledger and the confirmed
// mapping of the service's project, and never starts a check (Q14): the
// narrator does that from Home.
type SignalProvider struct {
	service *Service
	sources SignalSources
}

// NewSignalProvider builds the provider over one project's coverage service.
func NewSignalProvider(service *Service, sources SignalSources) *SignalProvider {
	return &SignalProvider{service: service, sources: sources}
}

// Stage is the stage the recording signal judges finished.
func (p *SignalProvider) Stage() stages.Stage { return stages.StageRecording }

// SignalIDs declares the one signal this provider reports.
func (p *SignalProvider) SignalIDs() []string { return []string{RecordingSignalID} }

// Signals answers the recording signal for one chapter against the shared,
// already-parsed saved project. It fails only when it cannot answer at all
// (the evaluation was cancelled, no project's service, an unreadable ledger).
func (p *SignalProvider) Signals(ctx context.Context, chapter stages.ChapterContext, view stages.EvidenceView) ([]stages.Signal, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if p.service == nil {
		return nil, errors.New("no project is open")
	}
	if view.ProjectErr != nil {
		reason := "The saved REAPER project file could not be read: " + view.ProjectErr.Error()
		return []stages.Signal{stampedUnknown(stages.CauseProjectUnreadable, reason, p.now())}, nil
	}
	settings := p.settings()
	result, err := p.service.ResultIn(view.Project, view.ProjectFile, chapter.ChapterID, settings.Alignment)
	if err != nil {
		return nil, err
	}
	latest, err := p.service.latestRecord(chapter.ChapterID)
	if err != nil {
		return nil, err
	}
	unavailable := ""
	if p.sources.Unavailable != nil {
		unavailable = p.sources.Unavailable()
	}
	return []stages.Signal{RecordingSignal(SignalInput{
		Result: result, Latest: latest, Running: p.service.Checking(chapter.ChapterID), Unavailable: unavailable,
		Unconfirmed: slices.Contains(result.Reasons, string(ReasonUnmapped)) && p.suggested(chapter, view), Settings: settings, ComputedAt: p.now(),
	})}, nil
}

func (p *SignalProvider) settings() Settings {
	if p.sources.Settings == nil {
		return DefaultSettings
	}
	return p.sources.Settings()
}

func (p *SignalProvider) now() time.Time {
	if p.sources.Now == nil {
		return time.Now().UTC()
	}
	return p.sources.Now()
}

// suggested reports whether a track of the saved project that is not linked
// to any chapter has the chapter's title as its name: a match the narrator
// has not confirmed, which is still unknown (D5), but with a different action.
func (p *SignalProvider) suggested(chapter stages.ChapterContext, view stages.EvidenceView) bool {
	links, err := p.service.mapping.List(chapter.DocumentID)
	if err != nil {
		return false
	}
	linked := map[string]bool{}
	for _, link := range links {
		linked[link.TrackGUID] = true
	}
	candidates := []evidence.TrackCandidate{}
	for _, track := range view.Project.Tracks {
		if !linked[track.GUID] {
			candidates = append(candidates, evidence.TrackCandidate{TrackGUID: track.GUID, Name: track.Name})
		}
	}
	suggestions := evidence.TitleSuggester.Suggest(candidates, []evidence.ChapterCandidate{{ID: chapter.ChapterID, Title: chapter.Title}})
	return len(suggestions) > 0
}

func stampedUnknown(cause stages.UnknownCause, reason string, at time.Time) stages.Signal {
	signal := stages.UnknownSignal(RecordingSignalID, stages.StageRecording, cause, reason)
	signal.ComputedAt = at
	return signal
}
