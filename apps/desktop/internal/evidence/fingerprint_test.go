package evidence

import (
	"math/rand"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// reaperFixture parses one of the tracks package's REAPER-saved fixtures
// (apps/desktop/internal/tracks/testdata/reaper), the same files
// reaper_fixtures_test.go pins the parser against, so this package's tests
// verify against real REAPER output rather than only hand-built structs.
func reaperFixture(t *testing.T, name string) tracks.Project {
	t.Helper()
	project, err := tracks.Parse(filepath.Join("..", "tracks", "testdata", "reaper", name))
	if err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	return project
}

func baseItem() tracks.Item {
	return tracks.Item{
		GUID:       "{ITEM-1}",
		Position:   4,
		Length:     2,
		Muted:      false,
		Supported:  true,
		ActiveTake: 0,
		Takes: []tracks.Take{
			{GUID: "{TAKE-A}", SourceFile: "a.wav", SOFFS: 0.5, PlayRate: 1, Supported: true},
			{GUID: "{TAKE-B}", SourceFile: "b.wav", SOFFS: 0.25, PlayRate: 1.25, Supported: true},
		},
	}
}

func baseIdentity() SourceIdentity {
	return SourceIdentity{Path: "media/a.wav", Size: 1000, PartialHash: "hash-a"}
}

func fingerprintOf(t *testing.T, item tracks.Item, identity SourceIdentity) (AnalysisKey, ItemFingerprint) {
	t.Helper()
	played := ItemPlayedRange(item)
	key := ComputeAnalysisKey(identity, played, item.Active().PlayRate)
	return key, ComputeItemFingerprint(key, item)
}

// --- PlayedRange ---

func TestItemPlayedRangeIsSoffsToSoffsPlusLengthTimesPlayRate(t *testing.T) {
	item := baseItem()
	got := ItemPlayedRange(item)
	want := PlayedRange{Start: 0.5, End: 0.5 + 2*1}
	if got != want {
		t.Fatalf("PlayedRange = %#v, want %#v", got, want)
	}
}

func TestItemPlayedRangeAddsTheSectionWrapperOffset(t *testing.T) {
	item := baseItem()
	item.Takes[0].Section = &tracks.SectionOffsets{StartPos: 3, Length: 5, Overlap: 0}
	got := ItemPlayedRange(item)
	want := PlayedRange{Start: 0.5 + 3, End: 0.5 + 3 + 2*1}
	if got != want {
		t.Fatalf("PlayedRange with a SECTION wrapper = %#v, want %#v", got, want)
	}
}

// TestItemPlayedRangeOnTheRealSectionFixture pins the played-range function
// against the real "Section" track in saved-cases.rpp (item Length 1.5,
// SOFFS 0, PLAYRATE 1; the wrapper's own StartPos 0.5) - see
// tracks.TestASectionSourceIsUnwrappedToItsFile, which pins the same item's
// parse.
func TestItemPlayedRangeOnTheRealSectionFixture(t *testing.T) {
	project := reaperFixture(t, "saved-cases.rpp")
	item := project.Tracks[2].Items[0]
	got := ItemPlayedRange(item)
	want := PlayedRange{Start: 0.5, End: 0.5 + 1.5*1}
	if got != want {
		t.Fatalf("PlayedRange of the real Section fixture item = %#v, want %#v", got, want)
	}
}

// --- AnalysisKey ---

func TestComputeAnalysisKeyIsDeterministic(t *testing.T) {
	item := baseItem()
	identity := baseIdentity()
	first := ComputeAnalysisKey(identity, ItemPlayedRange(item), item.Active().PlayRate)
	second := ComputeAnalysisKey(identity, ItemPlayedRange(item), item.Active().PlayRate)
	if first != second || first == "" {
		t.Fatalf("ComputeAnalysisKey is not deterministic: %q vs %q", first, second)
	}
}

func TestComputeAnalysisKeyIgnoresModTime(t *testing.T) {
	item := baseItem()
	played := ItemPlayedRange(item)
	touched := baseIdentity()
	touched.ModTime = touched.ModTime.AddDate(0, 0, 1)

	before := ComputeAnalysisKey(baseIdentity(), played, item.Active().PlayRate)
	after := ComputeAnalysisKey(touched, played, item.Active().PlayRate)
	if before != after {
		t.Fatalf("AnalysisKey changed when only ModTime did (edit-type table: \"source touched, identical content\" must not always read as changed): %q vs %q", before, after)
	}
}

func TestComputeAnalysisKeyChangesWithEachContentAffectingInput(t *testing.T) {
	item := baseItem()
	identity := baseIdentity()
	played := ItemPlayedRange(item)
	rate := item.Active().PlayRate
	base := ComputeAnalysisKey(identity, played, rate)

	cases := map[string]AnalysisKey{
		"different partial hash": func() AnalysisKey {
			changed := identity
			changed.PartialHash = "hash-b"
			return ComputeAnalysisKey(changed, played, rate)
		}(),
		"different size": func() AnalysisKey {
			changed := identity
			changed.Size = identity.Size + 1
			return ComputeAnalysisKey(changed, played, rate)
		}(),
		"different path": func() AnalysisKey {
			changed := identity
			changed.Path = "media/other.wav"
			return ComputeAnalysisKey(changed, played, rate)
		}(),
		"different played range": ComputeAnalysisKey(identity, PlayedRange{Start: played.Start + 0.1, End: played.End}, rate),
		"different play rate":    ComputeAnalysisKey(identity, played, rate+0.1),
	}
	for name, got := range cases {
		if got == base {
			t.Errorf("%s: AnalysisKey did not change", name)
		}
	}
}

// --- ItemFingerprint ---

func TestComputeItemFingerprintIsDeterministic(t *testing.T) {
	item := baseItem()
	key, first := fingerprintOf(t, item, baseIdentity())
	_, second := fingerprintOf(t, item, baseIdentity())
	if first != second || key == "" {
		t.Fatalf("ComputeItemFingerprint is not deterministic: %q vs %q", first, second)
	}
}

// TestEditTypeTable is the PRD's Phase 2 acceptance table
// (docs/prds/analysis-evidence-ledger.prd.md#edit-type-table-phase-2-acceptance):
// every listed edit and the analysis key/item fingerprint columns it
// specifies.
func TestEditTypeTable(t *testing.T) {
	identity := baseIdentity()
	base := baseItem()
	baseKey, baseFingerprint := fingerprintOf(t, base, identity)

	tests := []struct {
		name        string
		item        tracks.Item
		identity    SourceIdentity
		wantKeySame bool
		wantFPSame  bool
	}{
		{
			name: "move item in time",
			item: func() tracks.Item {
				moved := base
				moved.Position += 1
				return moved
			}(),
			identity:    identity,
			wantKeySame: true,
			wantFPSame:  false,
		},
		{
			name: "trim start (SOFFS changes)",
			item: func() tracks.Item {
				trimmed := base
				trimmed.Takes = append([]tracks.Take(nil), base.Takes...)
				trimmed.Takes[0].SOFFS += 0.2
				return trimmed
			}(),
			identity:    identity,
			wantKeySame: false,
			wantFPSame:  false,
		},
		{
			name: "trim end (Length changes)",
			item: func() tracks.Item {
				trimmed := base
				trimmed.Length -= 0.5
				return trimmed
			}(),
			identity:    identity,
			wantKeySame: false,
			wantFPSame:  false,
		},
		{
			name: "mute",
			item: func() tracks.Item {
				muted := base
				muted.Muted = true
				return muted
			}(),
			identity:    identity,
			wantKeySame: true,
			wantFPSame:  false,
		},
		{
			name: "switch active take",
			item: func() tracks.Item {
				switched := base
				switched.ActiveTake = 1
				return switched
			}(),
			identity:    identity,
			wantKeySame: false,
			wantFPSame:  false,
		},
		{
			name: "change playrate",
			item: func() tracks.Item {
				fast := base
				fast.Takes = append([]tracks.Take(nil), base.Takes...)
				fast.Takes[0].PlayRate = 2
				return fast
			}(),
			identity:    identity,
			wantKeySame: false,
			wantFPSame:  false,
		},
		{
			name:        "source replaced on disk (identity's own hash/size differ)",
			item:        base,
			identity:    SourceIdentity{Path: identity.Path, Size: identity.Size + 10, PartialHash: "hash-replaced"},
			wantKeySame: false,
			wantFPSame:  false,
		},
		{
			name:        "source touched, identical content (only ModTime differs)",
			item:        base,
			identity:    SourceIdentity{Path: identity.Path, Size: identity.Size, PartialHash: identity.PartialHash, ModTime: identity.ModTime.AddDate(0, 0, 1)},
			wantKeySame: true,
			wantFPSame:  true,
		},
		{
			name: "cosmetic change (name) does not affect the key inputs",
			item: func() tracks.Item {
				renamed := base
				renamed.Name = "a brand new name"
				return renamed
			}(),
			identity:    identity,
			wantKeySame: true,
			wantFPSame:  true,
		},
		{
			name:        "re-save with no edits",
			item:        base,
			identity:    identity,
			wantKeySame: true,
			wantFPSame:  true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			key, fingerprint := fingerprintOf(t, test.item, test.identity)
			if gotSame := key == baseKey; gotSame != test.wantKeySame {
				t.Errorf("AnalysisKey same = %v, want %v", gotSame, test.wantKeySame)
			}
			if gotSame := fingerprint == baseFingerprint; gotSame != test.wantFPSame {
				t.Errorf("ItemFingerprint same = %v, want %v", gotSame, test.wantFPSame)
			}
		})
	}
}

// TestSplitItemYieldsTwoDifferentFingerprintsWithANewGuidForOneHalf covers
// the edit-type table's "split item" row (changes for both halves, a new
// GUID for one) against the real split-item fixture
// (testdata/reaper/line-identity.rpp, produced by a real REAPER split via
// the bridge's checklist script).
func TestSplitItemYieldsTwoDifferentFingerprintsWithANewGuidForOneHalf(t *testing.T) {
	project := reaperFixture(t, "line-identity.rpp")
	items := project.Tracks[0].Items
	if len(items) < 3 {
		t.Fatalf("expected at least 3 items (original stamp, split left, split right); got %d", len(items))
	}
	// Position 1.5 is the right half of the split (pinned by
	// tracks.TestLineIdentityFixtureListsTheSplitDuplicatedAndCopiedItems).
	left, right := items[0], items[2]
	if left.GUID == right.GUID {
		t.Fatalf("split halves must not share a GUID: both are %q", left.GUID)
	}

	identity := SourceIdentity{Path: "source.wav", Size: 1, PartialHash: "abc123"}
	_, leftFP := fingerprintOf(t, left, identity)
	_, rightFP := fingerprintOf(t, right, identity)
	if leftFP == rightFP {
		t.Fatal("the split item's two halves produced the same ItemFingerprint")
	}
}

// --- TrackFingerprint ---

func TestComputeTrackFingerprintExcludesMutedAndUnsupportedItems(t *testing.T) {
	identity := baseIdentity()
	audible := baseItem()
	_, audibleFP := fingerprintOf(t, audible, identity)

	muted := baseItem()
	muted.GUID = "{ITEM-MUTED}"
	muted.Muted = true
	_, mutedFP := fingerprintOf(t, muted, identity)

	unsupported := baseItem()
	unsupported.GUID = "{ITEM-MIDI}"
	unsupported.Supported = false
	_, unsupportedFP := fingerprintOf(t, unsupported, identity)

	withAllThree := ComputeTrackFingerprint([]TrackFingerprintEntry{
		{Item: audible, Fingerprint: audibleFP},
		{Item: muted, Fingerprint: mutedFP},
		{Item: unsupported, Fingerprint: unsupportedFP},
	})
	audibleOnly := ComputeTrackFingerprint([]TrackFingerprintEntry{
		{Item: audible, Fingerprint: audibleFP},
	})
	if withAllThree != audibleOnly {
		t.Fatalf("TrackFingerprint counted a muted or unsupported item: %q vs %q", withAllThree, audibleOnly)
	}
}

func TestComputeTrackFingerprintChangesWhenAnItemIsAddedOrRemoved(t *testing.T) {
	identity := baseIdentity()
	first := baseItem()
	_, firstFP := fingerprintOf(t, first, identity)
	second := baseItem()
	second.GUID = "{ITEM-2}"
	_, secondFP := fingerprintOf(t, second, identity)

	oneItem := ComputeTrackFingerprint([]TrackFingerprintEntry{{Item: first, Fingerprint: firstFP}})
	twoItems := ComputeTrackFingerprint([]TrackFingerprintEntry{
		{Item: first, Fingerprint: firstFP},
		{Item: second, Fingerprint: secondFP},
	})
	if oneItem == twoItems {
		t.Fatal("TrackFingerprint did not change when an item was added")
	}
}

func TestComputeTrackFingerprintIsOrderSensitive(t *testing.T) {
	identity := baseIdentity()
	first := baseItem()
	_, firstFP := fingerprintOf(t, first, identity)
	second := baseItem()
	second.GUID = "{ITEM-2}"
	_, secondFP := fingerprintOf(t, second, identity)

	forward := ComputeTrackFingerprint([]TrackFingerprintEntry{
		{Item: first, Fingerprint: firstFP},
		{Item: second, Fingerprint: secondFP},
	})
	backward := ComputeTrackFingerprint([]TrackFingerprintEntry{
		{Item: second, Fingerprint: secondFP},
		{Item: first, Fingerprint: firstFP},
	})
	if forward == backward {
		t.Fatal("TrackFingerprint did not change when item order (a reorder-by-position edit) changed")
	}
}

// TestRandomEditSequenceNeverLeavesAFingerprintUnchanged is the Phase 2
// success signal's property test ("a property test over random edit
// sequences never yields an unchanged fingerprint after a change to a
// listed field"), run with a fixed seed so the gate stays deterministic
// (ADR 0044): each step mutates exactly one field the fingerprint reads
// (position, length, mute, active take, SOFFS or play rate) on a
// two-take item and checks the fingerprint moved.
func TestRandomEditSequenceNeverLeavesAFingerprintUnchanged(t *testing.T) {
	random := rand.New(rand.NewSource(42))
	identity := baseIdentity()
	item := baseItem()
	_, fingerprint := fingerprintOf(t, item, identity)

	const steps = 200
	for step := 0; step < steps; step++ {
		previous := item
		previousFP := fingerprint

		switch random.Intn(6) {
		case 0:
			item.Position += 0.1 + random.Float64()
		case 1:
			item.Length += 0.1 + random.Float64()
		case 2:
			item.Muted = !item.Muted
		case 3:
			item.ActiveTake = (item.ActiveTake + 1) % len(item.Takes)
		case 4:
			item.Takes = append([]tracks.Take(nil), item.Takes...)
			item.Takes[item.ActiveTake].SOFFS += 0.1 + random.Float64()
		case 5:
			item.Takes = append([]tracks.Take(nil), item.Takes...)
			item.Takes[item.ActiveTake].PlayRate += 0.1 + random.Float64()
		}

		_, fingerprint = fingerprintOf(t, item, identity)
		if fingerprint == previousFP {
			t.Fatalf("step %d: fingerprint unchanged after an edit to a listed field\nbefore: %#v\nafter:  %#v", step, previous, item)
		}
	}
}

// TestNoOpResaveKeepsEveryItemFingerprint is the PRD's no-op stability
// success metric ("Re-saving a project with no edits ... keeps every
// fingerprint") checked against the real REAPER-saved pair. Both files
// name the same underlying media, but resave-noop.rpp's absolute paths
// don't resolve from this checkout (see
// tracks.TestANoOpResavedProjectKeepsItsTracksButNotTheRelativeMediaPaths),
// so a synthetic, shared identity stands in for a real Identify() call:
// what this test pins is that the item-level fields the fingerprint reads
// (GUID, position, length, mute, active take, SOFFS, play rate) survive
// REAPER's own no-op re-save unchanged, which is what
// tracks.TestANoOpResavedProjectKeepsItsTracksButNotTheRelativeMediaPaths
// does not itself check at the item level.
func TestNoOpResaveKeepsEveryItemFingerprint(t *testing.T) {
	before := reaperFixture(t, "saved-cases.rpp")
	after := reaperFixture(t, "resave-noop.rpp")
	identity := baseIdentity()

	if len(before.Tracks) != len(after.Tracks) {
		t.Fatalf("track counts differ: %d vs %d", len(before.Tracks), len(after.Tracks))
	}
	for trackIndex := range before.Tracks {
		beforeItems := before.Tracks[trackIndex].Items
		afterItems := after.Tracks[trackIndex].Items
		if len(beforeItems) != len(afterItems) {
			t.Fatalf("track %d: item counts differ: %d vs %d", trackIndex, len(beforeItems), len(afterItems))
		}
		for itemIndex := range beforeItems {
			_, beforeFP := fingerprintOf(t, beforeItems[itemIndex], identity)
			_, afterFP := fingerprintOf(t, afterItems[itemIndex], identity)
			if beforeFP != afterFP {
				t.Errorf("track %d item %d: ItemFingerprint changed on a no-op re-save", trackIndex, itemIndex)
			}
		}
	}
}
