package main

import (
	"context"
	"errors"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport/dawporttest"
	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/levelnormalize"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// fakeResolver builds a resolver over a dawporttest.Fake declaring every capability at level, with a live, reachable
// runtime - the same shape TestRegionCreatorFromComesFromTheResolver (chapterregions_test.go) already uses for the
// Regions role.
func fakeResolver(level dawport.Level) (*dawport.Resolver, *dawporttest.Fake) {
	fake := dawporttest.NewFake(dawport.KindREAPER, dawporttest.Levels(level))
	resolver := dawport.NewResolver(dawport.ResolverConfig{
		Adapter: fake,
		Runtime: func() dawport.Runtime { return dawport.Runtime{Bridge: true, Reachable: true} },
	})
	return resolver, fake
}

func TestSilenceTrimmerFromComesFromTheResolver(t *testing.T) {
	resolver, fake := fakeResolver(dawport.Supported)
	role := silenceTrimmerFrom(hostServices{dawPortResolver: resolver})
	if role == nil {
		t.Fatal("no role from a resolver with a live adapter")
	}
	if _, err := role.Preview(context.Background(), []bridge.CleanupCandidate{{ItemGUID: "i", FindingID: "f", CutStartSeconds: 0, CutEndSeconds: 1}}); err != nil {
		t.Fatalf("Preview: %v", err)
	}
	if calls := fake.Calls(); len(calls) != 1 || calls[0] != "silence_trim.Preview" {
		t.Fatalf("the role did not come from the resolver: calls = %v", calls)
	}
}

func TestSilenceTrimmerFromIsNilWithoutAResolver(t *testing.T) {
	if role := silenceTrimmerFrom(hostServices{}); role != nil {
		t.Fatalf("role = %v, want nil with no resolver", role)
	}
}

func TestGainAdjusterFromComesFromTheResolver(t *testing.T) {
	resolver, fake := fakeResolver(dawport.Supported)
	role := gainAdjusterFrom(hostServices{dawPortResolver: resolver})
	if role == nil {
		t.Fatal("no role from a resolver with a live adapter")
	}
	if _, err := role.Apply(context.Background(), []bridge.GainCandidate{{ItemGUID: "i", FindingID: "f", DeltaDB: 1}}); err != nil {
		t.Fatalf("Apply: %v", err)
	}
	if calls := fake.Calls(); len(calls) != 1 || calls[0] != "item_gain.Apply" {
		t.Fatalf("the role did not come from the resolver: calls = %v", calls)
	}
}

func TestGainAdjusterFromIsNilWithoutAResolver(t *testing.T) {
	if role := gainAdjusterFrom(hostServices{}); role != nil {
		t.Fatalf("role = %v, want nil with no resolver", role)
	}
}

func TestLinkedTrackGUID(t *testing.T) {
	links := chapterTrackLinks{Chapters: []chapterTrackLink{
		{ChapterID: "none"},
		{ChapterID: "one", Links: []evidence.TrackMapping{{TrackGUID: "T1"}}},
		{ChapterID: "many", Links: []evidence.TrackMapping{{TrackGUID: "T1"}, {TrackGUID: "T2"}}},
	}}
	tests := []struct {
		chapterID, wantGUID, wantRefusal string
	}{
		{"none", "", "No track is linked to this chapter."},
		{"one", "T1", ""},
		{"many", "", "Several tracks are linked to this chapter; link one."},
		{"missing", "", "This chapter is not in the manuscript."},
	}
	for _, tt := range tests {
		guid, refusal := linkedTrackGUID(links, tt.chapterID)
		if guid != tt.wantGUID || refusal != tt.wantRefusal {
			t.Errorf("linkedTrackGUID(%q) = (%q, %q), want (%q, %q)", tt.chapterID, guid, refusal, tt.wantGUID, tt.wantRefusal)
		}
	}
}

func TestMetricValueOf(t *testing.T) {
	lufs, rms := -20.0, -18.0
	report := measure.Report{IntegratedLUFS: &lufs, RMSdBFS: &rms}
	if got := metricValueOf(report, levelnormalize.MetricIntegratedLUFS); got != &lufs {
		t.Fatalf("integrated_lufs metric = %v, want the report's IntegratedLUFS pointer", got)
	}
	if got := metricValueOf(report, levelnormalize.MetricRMS); got != &rms {
		t.Fatalf("rms_dbfs metric = %v, want the report's RMSdBFS pointer", got)
	}
}

// seedSilenceCleanupFinding writes one silence_cleanup finding straight into the findings store (bypassing a real
// scan, which internal/editing's own tests already cover), the same shape editing.EmptySpaceFinding builds, so
// cleanupCandidatesIn's own mapping (finding -> bridge.CleanupCandidate) is exercised on its own.
func seedSilenceCleanupFinding(t *testing.T, store *findings.Store, chapterID, itemGUID, takeGUID, findingID string, start, end float64) {
	t.Helper()
	confidence := 0.6
	if _, err := store.SaveAnalyzerFindings("editing", chapterID, []findings.Finding{{
		SchemaVersion:    findings.SchemaVersion,
		ID:               findingID,
		Analyzer:         "editing",
		Source:           findings.Source{ItemGUID: itemGUID, TakeGUID: takeGUID},
		TimeRange:        &findings.TimeRange{Start: start, End: end, SourceStart: &start, SourceEnd: &end},
		Manuscript:       &findings.Manuscript{ChapterID: chapterID},
		Category:         findings.CategorySilenceCleanup,
		Severity:         findings.SeverityInfo,
		Confidence:       &confidence,
		ConfidenceReason: "test fixture",
		Review:           findings.ReviewState{Status: findings.StatusUnreviewed},
	}}); err != nil {
		t.Fatal(err)
	}
}

func TestCleanupCandidatesInBuildsFromEditingFindings(t *testing.T) {
	host := editingHost(t, false)
	seedSilenceCleanupFinding(t, host.services().findings, "c-0001", "{ITEM-1}", "{TAKE-1}", "f-1", 0.1, 0.3)

	candidates, err := cleanupCandidatesIn(host.services(), "c-0001")
	if err != nil {
		t.Fatal(err)
	}
	if len(candidates) != 1 {
		t.Fatalf("candidates = %#v, want exactly one", candidates)
	}
	got := candidates[0]
	if got.ItemGUID != "{ITEM-1}" || got.TakeGUID != "{TAKE-1}" || got.FindingID != "f-1" || got.CutStartSeconds != 0.1 || got.CutEndSeconds != 0.3 {
		t.Fatalf("candidate = %#v, want the finding's own guids, id and source range", got)
	}
}

func TestCleanupPreviewErrorsWithNoCandidates(t *testing.T) {
	host := editingHost(t, false)
	if _, err := cleanupPreviewIn(context.Background(), host.services(), "c-0001"); !errors.Is(err, errNoCleanupCandidates) {
		t.Fatalf("error = %v, want errNoCleanupCandidates", err)
	}
	if _, err := cleanupApplyIn(context.Background(), host.services(), "c-0001"); !errors.Is(err, errNoCleanupCandidates) {
		t.Fatalf("error = %v, want errNoCleanupCandidates", err)
	}
}

func TestCleanupPreviewErrorsUnavailableWithNoResolver(t *testing.T) {
	host := editingHost(t, false)
	seedSilenceCleanupFinding(t, host.services().findings, "c-0001", "{ITEM-1}", "{TAKE-1}", "f-1", 0.1, 0.3)
	svc := host.services()
	svc.dawPortResolver = nil
	if _, err := cleanupPreviewIn(context.Background(), svc, "c-0001"); !errors.Is(err, bridge.ErrUnavailable) {
		t.Fatalf("error = %v, want bridge.ErrUnavailable", err)
	}
}

func TestCleanupPreviewAndApplyGoThroughTheResolvedRole(t *testing.T) {
	host := editingHost(t, false)
	seedSilenceCleanupFinding(t, host.services().findings, "c-0001", "{ITEM-1}", "{TAKE-1}", "f-1", 0.1, 0.3)
	resolver, fake := fakeResolver(dawport.Supported)
	svc := host.services()
	svc.dawPortResolver = resolver

	preview, err := cleanupPreviewIn(context.Background(), svc, "c-0001")
	if err != nil {
		t.Fatal(err)
	}
	if preview.Candidates != 1 {
		t.Fatalf("preview.Candidates = %d, want 1", preview.Candidates)
	}
	if _, err := cleanupApplyIn(context.Background(), svc, "c-0001"); err != nil {
		t.Fatal(err)
	}
	if calls := fake.Calls(); len(calls) != 2 || calls[0] != "silence_trim.Preview" || calls[1] != "silence_trim.Apply" {
		t.Fatalf("calls = %v, want Preview then Apply through the resolved role", calls)
	}
}

func TestLevelMatchCandidatesInMeasuresTheLinkedTrack(t *testing.T) {
	host := editingHost(t, false)
	// editingProject's fixture is half a second of a quiet tone peaking at -18 dBFS (bindings_editing_test.go);
	// its RMS sits well below -6 dBFS, so a target of -6 dBFS proposes a real gain change.
	target := levelnormalize.Target{Metric: levelnormalize.MetricRMS, ValueDB: -6, ToleranceDB: 1}
	candidates, state, refusal, err := levelMatchCandidatesIn(host.services(), "c-0001", target)
	if err != nil {
		t.Fatal(err)
	}
	if state != linksProjectReady || refusal != "" {
		t.Fatalf("state = %v, refusal = %q, want ready with no refusal", state, refusal)
	}
	if len(candidates) != 1 {
		t.Fatalf("candidates = %#v, want exactly one (the linked track's one item)", candidates)
	}
	if candidates[0].ItemGUID != "{ITEM-1}" || candidates[0].DeltaDB <= 0 {
		t.Fatalf("candidate = %#v, want {ITEM-1} needing a positive gain change", candidates[0])
	}
	if candidates[0].FindingID == "" {
		t.Fatalf("candidate = %#v, want a non-empty synthesized finding id", candidates[0])
	}
}

func TestLevelMatchCandidatesInNoChangeWithinTolerance(t *testing.T) {
	host := editingHost(t, false)
	candidates, _, _, err := levelMatchCandidatesIn(host.services(), "c-0001", levelnormalize.Target{Metric: levelnormalize.MetricRMS, ValueDB: -200, ToleranceDB: 1000})
	if err != nil {
		t.Fatal(err)
	}
	if len(candidates) != 0 {
		t.Fatalf("candidates = %#v, want none within a huge tolerance", candidates)
	}
}

func TestLevelMatchPreviewErrorsUnavailableWithNoResolver(t *testing.T) {
	host := editingHost(t, false)
	svc := host.services()
	svc.dawPortResolver = nil
	if _, err := levelMatchApplyIn(context.Background(), svc, "c-0001", string(levelnormalize.MetricRMS), -6, 1); !errors.Is(err, bridge.ErrUnavailable) {
		t.Fatalf("error = %v, want bridge.ErrUnavailable", err)
	}
}

func TestLevelMatchPreviewAndApplyGoThroughTheResolvedRole(t *testing.T) {
	host := editingHost(t, false)
	resolver, fake := fakeResolver(dawport.Supported)
	svc := host.services()
	svc.dawPortResolver = resolver

	preview, err := levelMatchPreviewIn(svc, "c-0001", string(levelnormalize.MetricRMS), -6, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(preview.Candidates) != 1 || preview.Candidates[0].ItemGUID != "{ITEM-1}" {
		t.Fatalf("preview.Candidates = %#v, want the linked track's one item", preview.Candidates)
	}
	if _, err := levelMatchApplyIn(context.Background(), svc, "c-0001", string(levelnormalize.MetricRMS), -6, 1); err != nil {
		t.Fatal(err)
	}
	if calls := fake.Calls(); len(calls) != 1 || calls[0] != "item_gain.Apply" {
		t.Fatalf("calls = %v, want Apply through the resolved role (Preview never touches REAPER)", calls)
	}
}

// The wire contracts (CLAUDE.md): one golden per answer shape, pinning the exact payload CleanupPreview, CleanupApply,
// LevelMatchPreview and LevelMatchApply send, read by apps/ui/src/api/wireContracts.test.ts against their Zod schemas.

func TestCleanupPreviewContract(t *testing.T) {
	contractfile.Check(t, "cleanup-preview", cleanupPreviewAnswer{
		Candidates: 2, Added: 1, Existing: 1,
		Stale: []staleCandidateWire{{FindingID: "f-2", ItemGUID: "{ITEM-2}", Reason: "item"}},
	})
}

func TestCleanupApplyContract(t *testing.T) {
	contractfile.Check(t, "cleanup-apply", cleanupApplyAnswer{
		Candidates: 2, Applied: 1,
		Stale: []staleCandidateWire{{FindingID: "f-2", ItemGUID: "{ITEM-2}", Reason: "item"}},
	})
}

func TestLevelMatchPreviewContract(t *testing.T) {
	contractfile.Check(t, "level-match-preview", levelMatchPreviewAnswer{
		Candidates: []gainCandidateWire{{ItemGUID: "{ITEM-1}", DeltaDB: 3.5}},
	})
}

func TestLevelMatchApplyContract(t *testing.T) {
	contractfile.Check(t, "level-match-apply", levelMatchApplyAnswer{
		Changed: []gainChangeWire{{ItemGUID: "{ITEM-1}", BeforeVolume: 1, AfterVolume: 1.5}},
		Stale:   []staleGainWire{{FindingID: "gain:{ITEM-2}", ItemGUID: "{ITEM-2}", Reason: "item"}},
	})
}
