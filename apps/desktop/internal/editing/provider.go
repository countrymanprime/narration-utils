// This file registers this package's signals into SR's engine
// (chapter-stage-recommendations.prd.md's Provider contract,
// apps/desktop/internal/stages/provider.go), following
// apps/desktop/internal/coverage/provider.go's own shape exactly (Phase 6's
// success signal: "the engine and store are untouched - the diff proves the
// plug-in claim"). It reads stored evidence only (Q12): the confirmed
// mapping, each item's own ledger staleness, and the chapter's already-
// persisted silence_cleanup findings - never a decode, never a fresh
// composition. When every item is current, the findings a scan (Phase 5)
// persisted at that same run are already the correct current-fingerprint
// candidates, so there is nothing left for this file to recompute.
package editing

import (
	"context"
	"errors"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// SignalProvider is the editing stage's stages.Provider.
type SignalProvider struct {
	service *Service
}

// NewSignalProvider builds the provider over one project's editing service.
func NewSignalProvider(service *Service) *SignalProvider { return &SignalProvider{service: service} }

// Stage is the stage the editing signals judge finished.
func (p *SignalProvider) Stage() stages.Stage { return stages.StageEditing }

// SignalIDs declares the three signals this provider reports.
func (p *SignalProvider) SignalIDs() []string {
	return []string{EmptySpaceSignalID, ClickSignalID, BreathSignalID}
}

// Signals answers all three editing signals for one chapter against the
// shared, already-parsed saved project (view.Project, built once per
// evaluation by the service a later phase adds - stages.EvidenceView's own
// doc comment).
func (p *SignalProvider) Signals(ctx context.Context, chapter stages.ChapterContext, view stages.EvidenceView) ([]stages.Signal, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if p.service == nil {
		return nil, errors.New("no project is open")
	}
	now := time.Now().UTC()
	if view.ProjectErr != nil {
		return p.projectUnreadableSignals(view.ProjectErr, now), nil
	}

	coverage, _, basisRecordIDs, err := p.service.gatherCoverage(chapter, view)
	if err != nil {
		return nil, err
	}
	basis := stages.Basis{LedgerRecordIDs: basisRecordIDs, ProjectFileModTime: view.ProjectFile.ModTime}

	running := p.service.Busy() && p.service.State().ChapterID == chapter.ChapterID
	candidateStatuses, clickEvidence, breathEvidence, err := p.service.gatherCandidates(chapter.ChapterID)
	if err != nil {
		return nil, err
	}

	emptySpace := EmptySpaceSignal(EmptySpaceInput{
		Coverage: coverage, Policy: p.service.policy(), Candidates: candidateStatuses, Running: running,
		Basis: basis, ComputedAt: now,
	})
	click := UnvalidatedSignal(ClickSignalID, AnalyzerVersion, clickEvidence, basis, now)
	breath := UnvalidatedSignal(BreathSignalID, AnalyzerVersion, breathEvidence, basis, now)
	return []stages.Signal{emptySpace, click, breath}, nil
}

func (p *SignalProvider) projectUnreadableSignals(err error, now time.Time) []stages.Signal {
	basis := stages.Basis{LedgerRecordIDs: []string{}}
	emptySpace := unknownEditingSignal(
		stages.Signal{ID: EmptySpaceSignalID, Stage: stages.StageEditing, Evidence: []stages.Evidence{processedAudioCaveat()}, Basis: basis, ComputedAt: now},
		stages.CauseProjectUnreadable, "The saved REAPER project file could not be read: "+err.Error()+".",
	)
	return []stages.Signal{
		emptySpace,
		UnvalidatedSignal(ClickSignalID, AnalyzerVersion, nil, basis, now),
		UnvalidatedSignal(BreathSignalID, AnalyzerVersion, nil, basis, now),
	}
}

// gatherCoverage is the provider's own read of stored evidence (Q12): the
// chapter's confirmed track (D5), every item's own staleness
// (CurrentItemRecord, item-scoped per ledger.go's own header comment), and
// the typed reasons of every item Resolve refused. It never decodes audio.
func (s *Service) gatherCoverage(chapter stages.ChapterContext, view stages.EvidenceView) (ChapterCoverage, string, []string, error) {
	trackGUID, err := s.confirmedTrackGUID(chapter.DocumentID, chapter.ChapterID)
	if err != nil {
		reason, _ := ReasonOf(err)
		coverage := ChapterCoverage{}
		switch reason {
		case ReasonUnmapped:
			coverage.Mapping, coverage.Unconfirmed = MappingUnmapped, s.suggested(chapter, view)
		case ReasonMultipleTracks:
			coverage.Mapping = MappingMultiple
		default:
			return ChapterCoverage{}, "", nil, err
		}
		return coverage, "", nil, nil
	}
	track, found := findTrackByGUID(view.Project, trackGUID)
	if !found {
		return ChapterCoverage{Mapping: MappingTrackMissing}, trackGUID, nil, nil
	}

	coverage := ChapterCoverage{Mapping: MappingOK}
	paramHash := scanParamHash(s.scanOptions())
	var recordIDs []string
	for _, res := range ResolveTrack(track) {
		if !res.Analyzable() {
			if !res.Excluded {
				coverage.UnsupportedReasons = append(coverage.UnsupportedReasons, res.Reason)
			}
			continue
		}
		coverage.HasAnalyzableItems = true
		identity, err := evidence.Identify(res.Source.File, s.config.Project)
		if err != nil {
			coverage.UnsupportedReasons = append(coverage.UnsupportedReasons, ReasonMissingFile)
			continue
		}
		key := evidence.ComputeAnalysisKey(identity, evidence.PlayedRange{Start: res.Source.PlayedRange.Start, End: res.Source.PlayedRange.End}, 1)
		scopeIn := ItemScopeInput{DocumentID: chapter.DocumentID, ChapterID: chapter.ChapterID, TrackGUID: track.GUID, Item: res.Item, Key: key}
		staleness, err := CurrentItemRecord(s.ledger, AnalyzerSilence, AnalyzerVersion, paramHash, scopeIn)
		if err != nil {
			return ChapterCoverage{}, trackGUID, nil, err
		}
		coverage.Items = append(coverage.Items, ItemCoverage{GUID: res.Item.GUID, State: staleness.State, Reasons: staleness.Reasons})
		if staleness.Record != nil {
			recordIDs = append(recordIDs, staleness.Record.ID)
		}
	}
	return coverage, trackGUID, recordIDs, nil
}

// gatherCandidates reads the chapter's already-persisted silence_cleanup
// findings (Phase 5's own scan output) and turns them into the open/closed
// statuses EmptySpaceSignal needs (D9), plus the click/breath candidates as
// plain stages.Evidence entries (never resolved to met/not_met - Q5).
func (s *Service) gatherCandidates(chapterID string) (statuses []CandidateStatus, clickEvidence, breathEvidence []stages.Evidence, err error) {
	if s.findings == nil {
		return nil, nil, nil, nil
	}
	found, err := s.findings.List(findings.Query{Analyzer: analyzerName, ChapterID: chapterID})
	if err != nil {
		return nil, nil, nil, err
	}
	for _, finding := range found {
		class, _ := finding.Evidence["class"].(string)
		switch class {
		case "silence":
			statuses = append(statuses, CandidateStatus{Open: finding.Review.Status != findings.StatusDismissed, Evidence: findingEvidence(finding)})
		case "click":
			clickEvidence = append(clickEvidence, findingEvidence(finding))
		case "breath":
			breathEvidence = append(breathEvidence, findingEvidence(finding))
		}
	}
	return statuses, clickEvidence, breathEvidence, nil
}

// findingEvidence turns one click/breath finding into a stages.Evidence
// entry (the click and breath signals carry their raw candidates as
// evidence even though the signal itself can never resolve them, Q5).
func findingEvidence(finding findings.Finding) stages.Evidence {
	entry := stages.Evidence{Kind: "candidate", Label: "Candidate", File: finding.Source.File}
	if finding.TimeRange != nil {
		entry.Range = &stages.TimeRange{Start: finding.TimeRange.Start, End: finding.TimeRange.End}
		entry.Value = finding.ConfidenceReason
	}
	return entry
}

// findTrackByGUID returns project's track with the given GUID.
func findTrackByGUID(project tracks.Project, trackGUID string) (tracks.Track, bool) {
	for _, track := range project.Tracks {
		if track.GUID == trackGUID {
			return track, true
		}
	}
	return tracks.Track{}, false
}

// suggested reports whether a track of the saved project that is not linked
// to any chapter has the chapter's title as its name (D5's "an unconfirmed
// fuzzy match is never used", but still worth naming to the narrator as a
// different action than "link this chapter") - the same check
// coverage.SignalProvider.suggested makes for its own stage.
func (s *Service) suggested(chapter stages.ChapterContext, view stages.EvidenceView) bool {
	links, err := s.mapping.List(chapter.DocumentID)
	if err != nil {
		return false
	}
	linked := map[string]bool{}
	for _, link := range links {
		linked[link.TrackGUID] = true
	}
	var candidates []evidence.TrackCandidate
	for _, track := range view.Project.Tracks {
		if !linked[track.GUID] {
			candidates = append(candidates, evidence.TrackCandidate{TrackGUID: track.GUID, Name: track.Name})
		}
	}
	suggestions := evidence.MatchSuggester.Suggest(candidates, []evidence.ChapterCandidate{{ID: chapter.ChapterID, Title: chapter.Title}})
	return len(suggestions) > 0
}
