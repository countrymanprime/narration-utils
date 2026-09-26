package editing

import (
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// itemWith builds a minimal analyzable item: one WAVE take, source available,
// rate 1, no stretch markers, playing the whole 10 s file from its start.
func itemWith(mutate func(*tracks.Item, *tracks.Take)) tracks.Item {
	take := tracks.Take{
		GUID: "take-1", Name: "take", SourceKind: "WAVE", SourceFile: "/audio/a.wav",
		SourceAvailable: true, Supported: true, Active: true, SOFFS: 0, PlayRate: 1,
	}
	item := tracks.Item{GUID: "item-1", Position: 0, Length: 10, Supported: true}
	if mutate != nil {
		mutate(&item, &take)
	}
	item.Takes = []tracks.Take{take}
	item.ActiveTake = 0
	item.TakeGUID = take.GUID
	item.SourceKind = take.SourceKind
	item.SourceFile = take.SourceFile
	item.SourceAvailable = take.SourceAvailable
	item.PlayRate = take.Rate()
	return item
}

func TestResolveAnalyzable(t *testing.T) {
	item := itemWith(nil)
	res := Resolve(item, false)
	if !res.Analyzable() {
		t.Fatalf("Resolve() = %+v, want analyzable", res)
	}
	if res.Excluded || res.Reason != "" {
		t.Fatalf("Resolve() excluded=%v reason=%q, want neither", res.Excluded, res.Reason)
	}
	if res.Source.ItemGUID != "item-1" || res.Source.TakeGUID != "take-1" || res.Source.File != "/audio/a.wav" {
		t.Fatalf("Resolve() source = %+v", res.Source)
	}
	if res.Source.PlayedRange.Start != 0 || res.Source.PlayedRange.End != 10 {
		t.Fatalf("Resolve() played range = %+v, want [0,10)", res.Source.PlayedRange)
	}
}

func TestResolveExcludesMuted(t *testing.T) {
	item := itemWith(func(item *tracks.Item, take *tracks.Take) { item.Muted = true })
	res := Resolve(item, false)
	if !res.Excluded || res.Analyzable() {
		t.Fatalf("Resolve() = %+v, want excluded", res)
	}
	if res.Reason != "" {
		t.Fatalf("an excluded item must never carry a Reason too, got %q", res.Reason)
	}
}

func TestResolveExcludesNonAudio(t *testing.T) {
	item := itemWith(func(item *tracks.Item, take *tracks.Take) {
		item.Supported = false
		take.SourceKind, take.Supported = "MIDI", false
	})
	res := Resolve(item, false)
	if !res.Excluded {
		t.Fatalf("Resolve() = %+v, want excluded (non-audio)", res)
	}
}

func TestResolveTypedReasons(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*tracks.Item, *tracks.Take)
		want   UnknownReason
	}{
		{"playrate not one", func(_ *tracks.Item, take *tracks.Take) { take.PlayRate = 1.5 }, ReasonPlayRateNotOne},
		{"stretch markers", func(_ *tracks.Item, take *tracks.Take) { take.StretchMarkerCount = 2 }, ReasonStretchMarkers},
		{"non-WAV format", func(_ *tracks.Item, take *tracks.Take) { take.SourceKind = "MP3" }, ReasonUnsupportedFormat},
		{"missing file", func(_ *tracks.Item, take *tracks.Take) { take.SourceAvailable = false }, ReasonMissingFile},
		{"empty source path", func(_ *tracks.Item, take *tracks.Take) { take.SourceFile = "" }, ReasonMissingFile},
		{"zero length", func(item *tracks.Item, _ *tracks.Take) { item.Length = 0 }, ReasonNoPlayedRange},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			item := itemWith(tc.mutate)
			res := Resolve(item, false)
			if res.Excluded {
				t.Fatalf("Resolve() excluded, want reason %q", tc.want)
			}
			if res.Reason != tc.want {
				t.Fatalf("Resolve() reason = %q, want %q", res.Reason, tc.want)
			}
			if res.Analyzable() {
				t.Fatalf("Resolve() reports analyzable with reason %q set", res.Reason)
			}
		})
	}
}

// TestResolveSectionSourceIsAnalyzable is the correction this package's PRD
// task carried over the PRD document itself: the current tracks parser
// already folds a <SOURCE SECTION> wrapper's own StartPos into
// Take.SourceStart() (tracks.go), unlike the PRD's Evidence section, which
// describes an older parser that dropped section offsets. A section source
// must therefore be analyzable, not unsupported.
func TestResolveSectionSourceIsAnalyzable(t *testing.T) {
	item := itemWith(func(_ *tracks.Item, take *tracks.Take) {
		take.SOFFS = 1
		take.Section = &tracks.SectionOffsets{StartPos: 5, Length: 20}
	})
	res := Resolve(item, false)
	if !res.Analyzable() {
		t.Fatalf("Resolve() = %+v, want a SECTION source to be analyzable", res)
	}
	// SourceStart is Section.StartPos (5) + SOFFS (1) = 6, per tracks.Take.SourceStart.
	if res.Source.PlayedRange.Start != 6 {
		t.Fatalf("Resolve() played range start = %v, want 6 (section start + SOFFS)", res.Source.PlayedRange.Start)
	}
}

func TestResolveFXChainEvidence(t *testing.T) {
	item := itemWith(func(_ *tracks.Item, take *tracks.Take) { take.HasFXChain = true })
	res := Resolve(item, false)
	if !res.Source.HasFXChain {
		t.Fatalf("Resolve() did not carry the take's own FX-chain presence")
	}

	item2 := itemWith(nil)
	res2 := Resolve(item2, true) // the track has an FX chain, the take does not
	if !res2.Source.HasFXChain {
		t.Fatalf("Resolve() did not carry the track's FX-chain presence")
	}
}

func TestResolveTrack(t *testing.T) {
	track := tracks.Track{
		GUID: "track-1",
		Items: []tracks.Item{
			itemWith(nil),
			itemWith(func(item *tracks.Item, _ *tracks.Take) { item.GUID = "item-2"; item.Muted = true }),
		},
	}
	resolutions := ResolveTrack(track)
	if len(resolutions) != 2 {
		t.Fatalf("ResolveTrack() returned %d resolutions, want 2", len(resolutions))
	}
	if !resolutions[0].Analyzable() {
		t.Fatalf("ResolveTrack()[0] = %+v, want analyzable", resolutions[0])
	}
	if !resolutions[1].Excluded {
		t.Fatalf("ResolveTrack()[1] = %+v, want excluded (muted)", resolutions[1])
	}
}

func TestEveryReasonHasText(t *testing.T) {
	reasons := []UnknownReason{
		ReasonPlayRateNotOne, ReasonStretchMarkers, ReasonUnsupportedFormat,
		ReasonMultiChannel, ReasonMissingFile, ReasonUnreadable, ReasonNoPlayedRange,
	}
	for _, reason := range reasons {
		if reason.Text() == string(reason) {
			t.Errorf("reason %q has no human text entry in reasonText", reason)
		}
	}
	// ReasonReversedSource is documented as an undetected gap, not a case
	// Resolve returns; it deliberately has no text entry, so it is excluded
	// from the loop above rather than asserted to have one.
	if ReasonReversedSource.Text() != string(ReasonReversedSource) {
		t.Errorf("ReasonReversedSource unexpectedly has human text; it should stay a documented gap, not a UI-facing reason")
	}
}
