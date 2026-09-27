package main

import (
	"context"
	"errors"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/editing"
	"github.com/countrymanprime/narration-utils/shell/internal/levelnormalize"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// The Editing view's silence-trim and item-gain action (booth-actions-enablement PRD Phase 5): the first non-test
// callers of bridge.CleanupClient and bridge.LevelMatchClient (apps/desktop/internal/bridge/{cleanup.go,
// levelnormalize.go}), reached the same way bindings_navigation.go and chapterregions.go already reach their own
// REAPER roles - through dawport.Role[T](resolver, capability), never a cached adapter, so a capability the narrator
// promotes or a toggle they flip in Settings takes effect on the next click, with no restart. Preview never changes
// anything; Apply recomputes the same candidates rather than trusting whatever a caller last saw (chapterregions.go's
// own rule), so a stale UI can never apply a trim or a gain change the current project no longer supports.

var (
	errNoCleanupCandidates = errors.New("no silence-trim candidates were found for this chapter")
	errNoGainCandidates    = errors.New("no item on this chapter's linked track needs a gain change")
)

func silenceTrimmerFrom(svc hostServices) dawport.SilenceTrimmer {
	if svc.dawPortResolver == nil {
		return nil
	}
	role, err := dawport.Role[dawport.SilenceTrimmer](svc.dawPortResolver, dawport.CapSilenceTrim)
	if err != nil {
		return nil
	}
	return role
}

func gainAdjusterFrom(svc hostServices) dawport.GainAdjuster {
	if svc.dawPortResolver == nil {
		return nil
	}
	role, err := dawport.Role[dawport.GainAdjuster](svc.dawPortResolver, dawport.CapItemGain)
	if err != nil {
		return nil
	}
	return role
}

// cleanupCandidatesIn builds this chapter's silence-trim candidates from its already-scanned editing findings
// (bindings_editing.go's EditingCandidates service call): only class "silence" carries a usable item, take and
// source-relative cut range today (click and breath findings are not produced yet, editingCheckText.ts's own note),
// so this reads exactly what EditingCandidates already reads, never a second scan.
func cleanupCandidatesIn(svc hostServices, chapterID string) ([]bridge.CleanupCandidate, error) {
	service := svc.editing
	if service == nil {
		return nil, nil
	}
	found, err := service.Candidates(chapterID)
	if err != nil {
		return nil, err
	}
	candidates := make([]bridge.CleanupCandidate, 0, len(found))
	for _, f := range found {
		if f.ID == "" || f.Source.ItemGUID == "" || f.TimeRange == nil {
			continue
		}
		if f.TimeRange.SourceStart == nil || f.TimeRange.SourceEnd == nil || *f.TimeRange.SourceEnd <= *f.TimeRange.SourceStart {
			continue
		}
		candidates = append(candidates, bridge.CleanupCandidate{
			ItemGUID: f.Source.ItemGUID, TakeGUID: f.Source.TakeGUID, Class: "silence",
			CutStartSeconds: *f.TimeRange.SourceStart, CutEndSeconds: *f.TimeRange.SourceEnd, FindingID: f.ID,
		})
	}
	return candidates, nil
}

type staleCandidateWire struct {
	FindingID string `json:"findingId"`
	ItemGUID  string `json:"itemGuid"`
	Reason    string `json:"reason"`
}

func staleCandidatesWire(stale []bridge.StaleCandidate) []staleCandidateWire {
	out := make([]staleCandidateWire, len(stale))
	for i, s := range stale {
		out[i] = staleCandidateWire{FindingID: s.FindingID, ItemGUID: s.GUID, Reason: s.Reason}
	}
	return out
}

// cleanupPreviewAnswer is CleanupPreview's payload: how many candidates this chapter has, and preview_cleanup_
// markers' own answer (bridge.PreviewResult) - which take markers were newly added, which already existed, and
// which candidates REAPER found stale (the saved project has moved on since the last scan).
type cleanupPreviewAnswer struct {
	Candidates int                  `json:"candidates"`
	Added      int                  `json:"added"`
	Existing   int                  `json:"existing"`
	Stale      []staleCandidateWire `json:"stale"`
}

func cleanupPreviewIn(ctx context.Context, svc hostServices, chapterID string) (cleanupPreviewAnswer, error) {
	candidates, err := cleanupCandidatesIn(svc, chapterID)
	if err != nil {
		return cleanupPreviewAnswer{}, err
	}
	if len(candidates) == 0 {
		return cleanupPreviewAnswer{}, errNoCleanupCandidates
	}
	role := silenceTrimmerFrom(svc)
	if role == nil {
		return cleanupPreviewAnswer{}, bridge.ErrUnavailable
	}
	result, err := role.Preview(ctx, candidates)
	if err != nil {
		return cleanupPreviewAnswer{}, err
	}
	return cleanupPreviewAnswer{Candidates: len(candidates), Added: result.Added, Existing: result.Existing, Stale: staleCandidatesWire(result.Stale)}, nil
}

// cleanupApplyAnswer is CleanupApply's payload: apply_cleanup_trims' own answer - how many candidates were actually
// trimmed, and which were stale and so left untouched.
type cleanupApplyAnswer struct {
	Candidates int                  `json:"candidates"`
	Applied    int                  `json:"applied"`
	Stale      []staleCandidateWire `json:"stale"`
}

func cleanupApplyIn(ctx context.Context, svc hostServices, chapterID string) (cleanupApplyAnswer, error) {
	candidates, err := cleanupCandidatesIn(svc, chapterID)
	if err != nil {
		return cleanupApplyAnswer{}, err
	}
	if len(candidates) == 0 {
		return cleanupApplyAnswer{}, errNoCleanupCandidates
	}
	role := silenceTrimmerFrom(svc)
	if role == nil {
		return cleanupApplyAnswer{}, bridge.ErrUnavailable
	}
	result, err := role.Apply(ctx, candidates)
	if err != nil {
		return cleanupApplyAnswer{}, err
	}
	return cleanupApplyAnswer{Candidates: len(candidates), Applied: result.Applied, Stale: staleCandidatesWire(result.Stale)}, nil
}

// CleanupPreview asks REAPER to mark every silence-trim candidate's cut range (preview_cleanup_markers) without
// changing anything else: which take markers were newly added, and which candidates the saved project has since made
// stale.
func (h *Host) CleanupPreview(chapterID string) (string, error) {
	return encodeBinding(cleanupPreviewIn(context.Background(), h.services(), chapterID))
}

// CleanupApply asks REAPER to remove every silence-trim candidate's cut range (apply_cleanup_trims), in one undo
// block; a candidate the saved project has made stale is left untouched.
func (h *Host) CleanupApply(chapterID string) (string, error) {
	return encodeBinding(cleanupApplyIn(context.Background(), h.services(), chapterID))
}

// linkedTrackGUID reads chapterID's own row of links (chapterTrackLinksIn, chapterlinks.go), refusing exactly the way
// chapterregions.go's own per-chapter loop does: no link, or more than one, is a plain-words refusal, never an error.
func linkedTrackGUID(links chapterTrackLinks, chapterID string) (guid, refusal string) {
	for _, chapter := range links.Chapters {
		if chapter.ChapterID != chapterID {
			continue
		}
		switch len(chapter.Links) {
		case 0:
			return "", "No track is linked to this chapter."
		case 1:
			return chapter.Links[0].TrackGUID, ""
		default:
			return "", "Several tracks are linked to this chapter; link one."
		}
	}
	return "", "This chapter is not in the manuscript."
}

// metricValueOf reads the measure.Report field target.Metric names; integrated loudness unless the target asks for
// RMS specifically, matching levelnormalize.Metric's own two values.
func metricValueOf(report measure.Report, metric levelnormalize.Metric) *float64 {
	if metric == levelnormalize.MetricRMS {
		return report.RMSdBFS
	}
	return report.IntegratedLUFS
}

// levelMatchCandidatesIn measures every analyzable item on chapterID's linked track (editing.ResolveTrack: the same
// item resolution the editing check uses, over the chapter's confirmed track link) against target, and proposes a
// gain change for every item whose measured level needs one (levelnormalize.GainDeltaDB). Nothing here is cached: it
// is the first caller of ResolveTrack, AnalyzeFileRange and GainDeltaDB together, so every call re-reads the saved
// project and re-measures every item from disk, the same "recompute, never trust a stale answer" rule
// chapterRegionPlanIn already follows. An item whose source file cannot be read is skipped, never fabricated as
// "no change needed" (levelnormalize.GainDeltaDB's own contract for an unmeasurable value).
func levelMatchCandidatesIn(svc hostServices, chapterID string, target levelnormalize.Target) (candidates []bridge.GainCandidate, state linksProjectState, refusal string, err error) {
	links, err := chapterTrackLinksIn(svc)
	if err != nil {
		return nil, linksProjectError, "", err
	}
	if links.Project != linksProjectReady {
		return nil, links.Project, links.Message, nil
	}
	trackGUID, refusal := linkedTrackGUID(links, chapterID)
	if refusal != "" {
		return nil, linksProjectReady, refusal, nil
	}
	project, state, message := readLinksProject(svc)
	if state != linksProjectReady {
		return nil, state, message, nil
	}
	for _, track := range project.Tracks {
		if track.GUID != trackGUID {
			continue
		}
		for _, res := range editing.ResolveTrack(track) {
			if !res.Analyzable() {
				continue
			}
			source := res.Source
			report, err := measure.AnalyzeFileRange(source.File, measure.Range{
				StartSeconds: source.PlayedRange.Start, LengthSeconds: source.PlayedRange.End - source.PlayedRange.Start,
			})
			if err != nil {
				continue
			}
			deltaDB, needsChange, ok := levelnormalize.GainDeltaDB(metricValueOf(report, target.Metric), target)
			if !ok || !needsChange {
				continue
			}
			candidates = append(candidates, bridge.GainCandidate{ItemGUID: source.ItemGUID, DeltaDB: deltaDB, FindingID: "gain:" + source.ItemGUID})
		}
		return candidates, linksProjectReady, "", nil
	}
	return nil, linksProjectReady, "The linked track is not in the saved REAPER project.", nil
}

type gainCandidateWire struct {
	ItemGUID string  `json:"itemGuid"`
	DeltaDB  float64 `json:"deltaDb"`
}

// levelMatchPreviewAnswer is LevelMatchPreview's payload: every item this chapter's linked track holds whose measured
// level differs from target by more than its tolerance, and the gain change that would bring it onto target. Nothing
// in REAPER changes yet - LevelMatchClient has no preview command of its own (bridge/levelnormalize.go), so this
// preview is entirely a measurement the host computes before offering Apply.
type levelMatchPreviewAnswer struct {
	Candidates []gainCandidateWire `json:"candidates"`
}

func levelMatchPreviewIn(svc hostServices, chapterID, metric string, targetValueDB, toleranceDB float64) (levelMatchPreviewAnswer, error) {
	target := levelnormalize.Target{Metric: levelnormalize.Metric(metric), ValueDB: targetValueDB, ToleranceDB: toleranceDB}
	candidates, state, refusal, err := levelMatchCandidatesIn(svc, chapterID, target)
	if err != nil {
		return levelMatchPreviewAnswer{}, err
	}
	if state != linksProjectReady || refusal != "" {
		return levelMatchPreviewAnswer{}, errors.New(refusal)
	}
	if len(candidates) == 0 {
		return levelMatchPreviewAnswer{}, errNoGainCandidates
	}
	wire := make([]gainCandidateWire, len(candidates))
	for i, c := range candidates {
		wire[i] = gainCandidateWire{ItemGUID: c.ItemGUID, DeltaDB: c.DeltaDB}
	}
	return levelMatchPreviewAnswer{Candidates: wire}, nil
}

type gainChangeWire struct {
	ItemGUID     string  `json:"itemGuid"`
	BeforeVolume float64 `json:"beforeVolume"`
	AfterVolume  float64 `json:"afterVolume"`
}

type staleGainWire struct {
	FindingID string `json:"findingId"`
	ItemGUID  string `json:"itemGuid"`
	Reason    string `json:"reason"`
}

// levelMatchApplyAnswer is LevelMatchApply's payload: apply_item_gain's own answer - every item REAPER actually
// changed, with its volume before and after, and which candidates were stale and so left untouched.
type levelMatchApplyAnswer struct {
	Changed []gainChangeWire `json:"changed"`
	Stale   []staleGainWire  `json:"stale"`
}

func levelMatchApplyIn(ctx context.Context, svc hostServices, chapterID, metric string, targetValueDB, toleranceDB float64) (levelMatchApplyAnswer, error) {
	target := levelnormalize.Target{Metric: levelnormalize.Metric(metric), ValueDB: targetValueDB, ToleranceDB: toleranceDB}
	candidates, state, refusal, err := levelMatchCandidatesIn(svc, chapterID, target)
	if err != nil {
		return levelMatchApplyAnswer{}, err
	}
	if state != linksProjectReady || refusal != "" {
		return levelMatchApplyAnswer{}, errors.New(refusal)
	}
	if len(candidates) == 0 {
		return levelMatchApplyAnswer{}, errNoGainCandidates
	}
	role := gainAdjusterFrom(svc)
	if role == nil {
		return levelMatchApplyAnswer{}, bridge.ErrUnavailable
	}
	result, err := role.Apply(ctx, candidates)
	if err != nil {
		return levelMatchApplyAnswer{}, err
	}
	changed := make([]gainChangeWire, len(result.Changed))
	for i, c := range result.Changed {
		changed[i] = gainChangeWire{ItemGUID: c.ItemGUID, BeforeVolume: c.BeforeVolume, AfterVolume: c.AfterVolume}
	}
	stale := make([]staleGainWire, len(result.Stale))
	for i, s := range result.Stale {
		stale[i] = staleGainWire{FindingID: s.FindingID, ItemGUID: s.GUID, Reason: s.Reason}
	}
	return levelMatchApplyAnswer{Changed: changed, Stale: stale}, nil
}

// LevelMatchPreview measures every analyzable item on chapterID's linked track and proposes the gain change that
// would bring each one within toleranceDB of targetValueDB on metric ("integrated_lufs" or "rms_dbfs",
// levelnormalize.Metric's own values). It changes nothing: REAPER's item volumes are read only when LevelMatchApply
// is called.
func (h *Host) LevelMatchPreview(chapterID, metric string, targetValueDB, toleranceDB float64) (string, error) {
	return encodeBinding(levelMatchPreviewIn(h.services(), chapterID, metric, targetValueDB, toleranceDB))
}

// LevelMatchApply re-measures the same items LevelMatchPreview would (never the narrator's last-seen answer) and
// sends every item that still needs a change to REAPER's apply_item_gain, in one undo block.
func (h *Host) LevelMatchApply(chapterID, metric string, targetValueDB, toleranceDB float64) (string, error) {
	return encodeBinding(levelMatchApplyIn(context.Background(), h.services(), chapterID, metric, targetValueDB, toleranceDB))
}
