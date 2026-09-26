package proofing

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// Config is what the proofing provider reads. Findings is the project's
// findings store; Runs judges each tracked pickup source's latest run by
// analyzer (Transcript Compare's is ComparisonJudge, Phase 2), and a source
// with no judge is untracked. Renders is the chapter-to-render store (Phase
// 4); Profile is the delivery profile the project is judged against now and
// LengthTolerance the narrator's optional render length tolerance in seconds
// (Phase 5); nil means none. Now stamps signals (nil is time.Now).
type Config struct {
	Findings        FindingsReader
	Runs            map[string]RunJudge
	Renders         *RenderStore
	Profile         func() deliveryprofile.Profile
	LengthTolerance func() *float64
	Now             func() time.Time
}

// SignalProvider is the proofing stage's stages.Provider. It reads stored
// evidence only (Q12 of the stage recommendations PRD): the findings store,
// the ledger, the confirmed mapping, the render store, the render file's
// identity and the saved project already parsed into the shared view. It never
// starts a comparison, scan or measurement.
type SignalProvider struct {
	config Config
}

// NewSignalProvider builds the provider over one project's stores.
func NewSignalProvider(config Config) *SignalProvider { return &SignalProvider{config: config} }

// Stage is the stage the proofing signals judge finished.
func (p *SignalProvider) Stage() stages.Stage { return stages.StageProofing }

// SignalIDs declares every signal this provider can report: pickups, one per
// delivery check in the catalogue, and the render length check.
func (p *SignalProvider) SignalIDs() []string {
	ids := []string{PickupsSignalID}
	for _, check := range DeliveryChecks() {
		ids = append(ids, check.ID)
	}
	return append(ids, RenderLengthSignalID)
}

// FilterRequired drops from required the delivery checks that are not required
// right now (Q7 B and the required-check validation: a check needs a limit): a
// metric check while the profile has no required measured rule for it turned
// on, and the length check while no tolerance is set. Every other id is kept.
func (p *SignalProvider) FilterRequired(required []string) []string {
	profile, tolerance := p.profile(), p.tolerance()
	kept := make([]string, 0, len(required))
	for _, id := range required {
		if id == RenderLengthSignalID && tolerance == nil {
			continue
		}
		if index := slices.IndexFunc(DeliveryChecks(), func(c DeliveryCheck) bool { return c.ID == id }); index >= 0 && !DeliveryChecks()[index].Required(profile) {
			continue
		}
		kept = append(kept, id)
	}
	return kept
}

// Signals answers every proofing signal for one chapter.
func (p *SignalProvider) Signals(ctx context.Context, chapter stages.ChapterContext, view stages.EvidenceView) ([]stages.Signal, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if p.config.Findings == nil {
		return nil, errors.New("no project is open")
	}
	now := p.now()
	sources, err := gatherSources(ctx, p.config.Findings, p.config.Runs, chapter, view)
	if err != nil {
		return nil, err
	}
	profile, tolerance := p.profile(), p.tolerance()
	pickups := PickupsSignal(PickupsInput{
		Sources: sources, Mapping: mappingProblem(chapter, view),
		ProjectFileModTime: view.ProjectFile.ModTime, ComputedAt: now,
	})
	pickups.Evidence = append(pickups.Evidence, deliveryScope(profile, tolerance))
	signals := []stages.Signal{pickups}

	render, renderErr := p.render(chapter, view)
	span := chapterSpan(chapter, view)
	for _, check := range DeliveryChecks() {
		if renderErr != nil {
			signals = append(signals, stages.UnknownSignal(check.ID, stages.StageProofing, stages.CauseProviderError, "could not check: "+renderErr.Error()))
			continue
		}
		signals = append(signals, DeliverySignal(DeliveryInput{Check: check, Profile: profile, Render: render, ChapterSpan: span, ProjectFileModTime: view.ProjectFile.ModTime, ComputedAt: now}))
	}
	if renderErr != nil {
		signals = append(signals, stages.UnknownSignal(RenderLengthSignalID, stages.StageProofing, stages.CauseProviderError, "could not check: "+renderErr.Error()))
	} else {
		signals = append(signals, RenderLengthSignal(LengthInput{Tolerance: tolerance, ChapterSpan: span, Render: render, ProjectFileModTime: view.ProjectFile.ModTime, ComputedAt: now}))
	}
	return signals, nil
}

// render evaluates the chapter's chosen render; with no render store, there is
// none. A renders file that cannot be read is an error for the delivery
// signals only (the pickups roll-up does not depend on it).
func (p *SignalProvider) render(chapter stages.ChapterContext, view stages.EvidenceView) (RenderStatus, error) {
	if p.config.Renders == nil {
		return RenderStatus{State: RenderNone, Cause: stages.CauseNeverAnalyzed, Reason: "Choose the rendered file for this chapter."}, nil
	}
	return EvaluateRender(p.config.Renders, chapter, view)
}

func (p *SignalProvider) profile() deliveryprofile.Profile {
	if p.config.Profile == nil {
		return deliveryprofile.Profile{}
	}
	return p.config.Profile()
}

func (p *SignalProvider) tolerance() *float64 {
	if p.config.LengthTolerance == nil {
		return nil
	}
	return p.config.LengthTolerance()
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

// chapterSpan is the timeline span of the chapter's played items in the saved
// project, first start to last end: what a render of the chapter covers, gaps
// included (unlike tracks.Track.RecordedSeconds, which leaves gaps out). Nil
// when the chapter has no confirmed track or nothing plays.
func chapterSpan(chapter stages.ChapterContext, view stages.EvidenceView) *float64 {
	track, problem := chapterTrack(chapter, view)
	if problem != nil {
		return nil
	}
	played := playedItems(track)
	if len(played) == 0 {
		return nil
	}
	start, end := played[0].Position, played[0].Position+played[0].Length
	for _, item := range played[1:] {
		start, end = min(start, item.Position), max(end, item.Position+item.Length)
	}
	span := end - start
	return &span
}
