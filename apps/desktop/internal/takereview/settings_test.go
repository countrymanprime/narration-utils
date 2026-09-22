package takereview

import (
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/repeats"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

func TestResolveThresholdsFallsBackToConservativeBuiltinDefaults(t *testing.T) {
	store := settings.New(t.TempDir(), "")

	got := ResolveThresholds(store)

	want := repeats.DefaultThresholds()
	if got != want {
		t.Fatalf("want the built-in defaults %+v with no repo or project override, got %+v", want, got)
	}
}

func TestResolveThresholdsPrefersAProjectOverrideOverTheBuiltinDefault(t *testing.T) {
	repo := t.TempDir()
	project := t.TempDir()
	store := settings.New(repo, project)
	if err := store.Save("TakeReview", "project", map[string]*string{"full_coverage_threshold": ptr("0.75")}); err != nil {
		t.Fatalf("Save: %v", err)
	}

	got := ResolveThresholds(store)

	if got.FullCoverage != 0.75 {
		t.Fatalf("want the project override 0.75, got %v", got.FullCoverage)
	}
	if got.NearDuplicateQuality != repeats.DefaultNearDuplicateQualityThreshold {
		t.Fatalf("want the untouched threshold to stay at its built-in default, got %v", got.NearDuplicateQuality)
	}
}

func TestResolveThresholdsIgnoresAnUnparseableStoredValue(t *testing.T) {
	repo := t.TempDir()
	project := t.TempDir()
	store := settings.New(repo, project)
	if err := store.Save("TakeReview", "project", map[string]*string{"full_coverage_threshold": ptr("not-a-number")}); err != nil {
		t.Fatalf("Save: %v", err)
	}

	got := ResolveThresholds(store)

	if got.FullCoverage != repeats.DefaultFullCoverageThreshold {
		t.Fatalf("want the built-in default when the stored value doesn't parse, got %v", got.FullCoverage)
	}
}

func TestResolveThresholdsIgnoresAnOutOfRangeStoredValue(t *testing.T) {
	repo := t.TempDir()
	project := t.TempDir()
	store := settings.New(repo, project)
	if err := store.Save("TakeReview", "project", map[string]*string{"near_duplicate_quality_threshold": ptr("1.5")}); err != nil {
		t.Fatalf("Save: %v", err)
	}

	got := ResolveThresholds(store)

	if got.NearDuplicateQuality != repeats.DefaultNearDuplicateQualityThreshold {
		t.Fatalf("want the built-in default when the stored value is out of [0,1], got %v", got.NearDuplicateQuality)
	}
}

func TestResolvePickupScopeDefaultsToNoPickupAddition(t *testing.T) {
	store := settings.New(t.TempDir(), "")

	scope := ResolvePickupScope(store, "Chapter 1")

	if scope.ChapterTrackName != "Chapter 1" {
		t.Fatalf("want the chapter track name carried through, got %q", scope.ChapterTrackName)
	}
	if scope.PickupTrackName != "" || scope.PickupRangeStart != nil || scope.PickupRangeEnd != nil {
		t.Fatalf("want no pickup addition by default, got %+v", scope)
	}
}

func TestResolvePickupScopeReadsAConfiguredPickupTrack(t *testing.T) {
	repo := t.TempDir()
	project := t.TempDir()
	store := settings.New(repo, project)
	if err := store.Save("TakeReview", "project", map[string]*string{"pickup_track_name": ptr("Pickups")}); err != nil {
		t.Fatalf("Save: %v", err)
	}

	scope := ResolvePickupScope(store, "Chapter 1")

	if scope.PickupTrackName != "Pickups" {
		t.Fatalf("want pickup track %q, got %q", "Pickups", scope.PickupTrackName)
	}
	if scope.PickupRangeStart != nil {
		t.Fatal("want no pickup range when a pickup track is configured")
	}
}

func TestResolvePickupScopeReadsAConfiguredPickupRange(t *testing.T) {
	repo := t.TempDir()
	project := t.TempDir()
	store := settings.New(repo, project)
	changes := map[string]*string{
		"pickup_range_start_seconds": ptr("100"),
		"pickup_range_end_seconds":   ptr("150"),
	}
	if err := store.Save("TakeReview", "project", changes); err != nil {
		t.Fatalf("Save: %v", err)
	}

	scope := ResolvePickupScope(store, "Chapter 1")

	if scope.PickupRangeStart == nil || *scope.PickupRangeStart != 100 {
		t.Fatalf("want pickup range start 100, got %v", scope.PickupRangeStart)
	}
	if scope.PickupRangeEnd == nil || *scope.PickupRangeEnd != 150 {
		t.Fatalf("want pickup range end 150, got %v", scope.PickupRangeEnd)
	}
}

func TestResolvePickupScopeIgnoresABackwardsRange(t *testing.T) {
	repo := t.TempDir()
	project := t.TempDir()
	store := settings.New(repo, project)
	changes := map[string]*string{
		"pickup_range_start_seconds": ptr("150"),
		"pickup_range_end_seconds":   ptr("100"),
	}
	if err := store.Save("TakeReview", "project", changes); err != nil {
		t.Fatalf("Save: %v", err)
	}

	scope := ResolvePickupScope(store, "Chapter 1")

	if scope.PickupRangeStart != nil || scope.PickupRangeEnd != nil {
		t.Fatalf("want a backwards range treated as unset, got %+v", scope)
	}
}

func ptr(s string) *string { return &s }
