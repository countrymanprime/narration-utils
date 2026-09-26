package proofing

import (
	"context"
	"errors"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// Config is what the proofing provider reads. Findings is the project's
// findings store; Runs judges each tracked pickup source's latest run by
// analyzer (Transcript Compare's is ComparisonJudge, Phase 2), and a source
// with no judge is untracked; Now stamps signals (nil is time.Now).
type Config struct {
	Findings FindingsReader
	Runs     map[string]RunJudge
	Now      func() time.Time
}

// SignalProvider is the proofing stage's stages.Provider. It reads stored
// evidence only (Q12 of the stage recommendations PRD): the findings store,
// the ledger, the confirmed mapping and the saved project already parsed into
// the shared view. It never starts a comparison, scan or measurement.
type SignalProvider struct {
	config Config
}

// NewSignalProvider builds the provider over one project's stores.
func NewSignalProvider(config Config) *SignalProvider { return &SignalProvider{config: config} }

// Stage is the stage the proofing signals judge finished.
func (p *SignalProvider) Stage() stages.Stage { return stages.StageProofing }

// SignalIDs declares every signal this provider reports.
func (p *SignalProvider) SignalIDs() []string { return []string{PickupsSignalID} }

// Signals answers the proofing signals for one chapter.
func (p *SignalProvider) Signals(ctx context.Context, chapter stages.ChapterContext, view stages.EvidenceView) ([]stages.Signal, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if p.config.Findings == nil {
		return nil, errors.New("no project is open")
	}
	sources, err := gatherSources(ctx, p.config.Findings, p.config.Runs, chapter, view)
	if err != nil {
		return nil, err
	}
	pickups := PickupsSignal(PickupsInput{
		Sources: sources, Mapping: mappingProblem(chapter, view),
		ProjectFileModTime: view.ProjectFile.ModTime, ComputedAt: p.now(),
	})
	return []stages.Signal{pickups}, nil
}

func (p *SignalProvider) now() time.Time {
	if p.config.Now != nil {
		return p.config.Now().UTC()
	}
	return time.Now().UTC()
}

// mappingProblem is the chapter's confirmed-track problem (D5), or nil when it
// has exactly one confirmed track present in the saved project. It is the
// action the pickups signal shows when no source is current.
func mappingProblem(chapter stages.ChapterContext, view stages.EvidenceView) *RunStatus {
	_, status := chapterTrack(chapter, view)
	return status
}
