package continuity

import (
	"errors"
	"math"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/character"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// guideJSON is the shape manuscript_guide.py writes (Phase 2, ADR 0345):
// a top-level dialogue_cues list; entities and other fields are ignored.
const guideJSON = `{
  "schema_version": 1,
  "entities": [{"id": "ent-alice", "canonical_name": "Alice"}],
  "dialogue_cues": [
    {"id": "cue-a", "chapterId": "ch-01", "paragraphId": "p-3", "quote_start": 0, "quote_end": 14,
     "quote_text": "Hello there", "speaker_entity_id": "ent-alice", "speaker_source": "tag",
     "evidence": {"excerpt": "\"Hello there,\" said Alice."}, "corrected": false},
    {"id": "cue-b", "chapterId": "ch-01", "paragraphId": "p-4", "quote_start": 2, "quote_end": 9,
     "quote_text": "Who?", "speaker_entity_id": null, "speaker_source": "unknown", "corrected": false},
    {"id": "cue-c", "chapterId": "ch-02", "paragraphId": "p-9", "quote_start": 0, "quote_end": 5,
     "quote_text": "Yes.", "speaker_entity_id": "ent-bob", "speaker_source": "correction", "corrected": true}
  ]
}`

func TestDecodeGuideCuesReadsTheManuscriptGuidesDialogueCues(t *testing.T) {
	cues, err := DecodeGuideCues([]byte(guideJSON))
	if err != nil {
		t.Fatal(err)
	}
	if len(cues) != 3 {
		t.Fatalf("len = %d", len(cues))
	}
	want := Cue{ID: "cue-a", ChapterID: "ch-01", ParagraphID: "p-3", QuoteStart: 0, QuoteEnd: 14, QuoteText: "Hello there", SpeakerID: "ent-alice", SpeakerSource: "tag", Excerpt: "\"Hello there,\" said Alice."}
	if cues[0] != want {
		t.Fatalf("cue = %+v\nwant  %+v", cues[0], want)
	}
	if cues[1].SpeakerID != "" {
		t.Fatalf("a null speaker must decode as unknown (empty), got %q", cues[1].SpeakerID)
	}
	if !cues[2].Corrected || cues[2].SpeakerSource != "correction" {
		t.Fatalf("corrected cue = %+v", cues[2])
	}
}

func TestDecodeGuideCuesToleratesAGuideWithNoCues(t *testing.T) {
	cues, err := DecodeGuideCues([]byte(`{"entities": []}`))
	if err != nil || len(cues) != 0 {
		t.Fatalf("cues = %v, err = %v", cues, err)
	}
	if _, err := DecodeGuideCues([]byte(`{`)); err == nil {
		t.Fatal("malformed JSON was accepted")
	}
}

func TestLocateKeepsOnlyAttributedReliablyAlignedLines(t *testing.T) {
	aligner := fakeAligner{
		"cue-a": {Reliable: true, Clip: Clip{File: "a.wav", Range: measure.Range{StartSeconds: 0, LengthSeconds: 1.5}}},
		"cue-u": {Reliable: false, Reason: "the aligned words disagree with the manuscript here"},
	}
	cues := []Cue{
		{ID: "cue-a", SpeakerID: "alice"},
		{ID: "cue-n", SpeakerID: character.NarrationCharacterID},
		{ID: "cue-x", SpeakerID: ""},
		{ID: "cue-u", SpeakerID: "alice"},
	}
	candidates, skipped, err := Locate(cues, aligner)
	if err != nil {
		t.Fatal(err)
	}
	if len(candidates) != 1 || candidates[0].Cue.ID != "cue-a" {
		t.Fatalf("candidates = %+v", candidates)
	}
	got := map[string]SkippedCue{}
	for _, s := range skipped {
		got[s.CueID] = s
	}
	if got["cue-x"].Reason != SkipUnknownSpeaker || got["cue-u"].Reason != SkipNoAlignment {
		t.Fatalf("skipped = %+v", skipped)
	}
	if !strings.Contains(got["cue-u"].Detail, "disagree") {
		t.Fatalf("the aligner's own reason was dropped: %+v", got["cue-u"])
	}
	// A dialogue cue is never attributed to plain narration by the guide,
	// and one that claims to be is not a character line to compare.
	if got["cue-n"].Reason != SkipUnknownSpeaker {
		t.Fatalf("narration cue = %+v", got["cue-n"])
	}
}

type failingAligner struct{}

func (failingAligner) Align(Cue) (Alignment, error) {
	return Alignment{}, errors.New("words file unreadable")
}

func TestLocateReportsAnAlignerFailure(t *testing.T) {
	if _, _, err := Locate([]Cue{{ID: "c", SpeakerID: "alice"}}, failingAligner{}); err == nil {
		t.Fatal("an aligner error was swallowed")
	}
}

func item(position, length float64, take tracks.Take) tracks.Item {
	take.Active = true
	return tracks.Item{Position: position, Length: length, Takes: []tracks.Take{take}}
}

func wave(file string, soffs, rate float64) tracks.Take {
	return tracks.Take{GUID: "{t-" + file + "}", SourceKind: "WAVE", SourceFile: file, SourceAvailable: true, Supported: true, SOFFS: soffs, PlayRate: rate}
}

func reference(start, end float64) character.Reference {
	return character.Reference{ID: "r", RegionGUID: "{r}", Snapshot: character.RegionSnapshot{Start: start, End: end}}
}

func TestRegionAudioMapsARegionOntoTheOneItemUnderIt(t *testing.T) {
	project := tracks.Project{Tracks: []tracks.Track{
		{Name: "Narration", Items: []tracks.Item{item(0, 10, wave("ch1.wav", 0, 1)), item(20, 30, wave("ch2.wav", 5, 1))}},
	}}
	clip, err := RegionAudio{Project: project}.ResolveIn(reference(25, 28))
	if err != nil {
		t.Fatal(err)
	}
	// Region starts 5 s into the item, whose take starts 5 s into its source.
	if clip.File != "ch2.wav" || math.Abs(clip.Range.StartSeconds-10) > 1e-9 || math.Abs(clip.Range.LengthSeconds-3) > 1e-9 {
		t.Fatalf("clip = %+v", clip)
	}
}

func TestRegionAudioFollowsAPlayrate(t *testing.T) {
	project := tracks.Project{Tracks: []tracks.Track{{Items: []tracks.Item{item(10, 10, wave("a.wav", 2, 2))}}}}
	clip, err := RegionAudio{Project: project}.ResolveIn(reference(12, 13))
	if err != nil {
		t.Fatal(err)
	}
	// 2 s into the item at 2x is 4 s of source past SOFFS 2; 1 s of region is 2 s of source.
	if math.Abs(clip.Range.StartSeconds-6) > 1e-9 || math.Abs(clip.Range.LengthSeconds-2) > 1e-9 {
		t.Fatalf("clip = %+v", clip)
	}
}

func TestRegionAudioRefusesWhatItCannotResolveExactly(t *testing.T) {
	stretched := wave("s.wav", 0, 1)
	stretched.StretchMarkerCount = 2
	mp3 := wave("m.mp3", 0, 1)
	mp3.SourceKind = "MP3"
	offline := wave("o.wav", 0, 1)
	offline.SourceAvailable = false
	cases := map[string]tracks.Project{
		"no item":           {Tracks: []tracks.Track{{Items: []tracks.Item{item(0, 5, wave("a.wav", 0, 1))}}}},
		"straddles an edge": {Tracks: []tracks.Track{{Items: []tracks.Item{item(0, 21, wave("a.wav", 0, 1))}}}},
		"two items overlap": {Tracks: []tracks.Track{{Items: []tracks.Item{item(0, 60, wave("a.wav", 0, 1))}}, {Items: []tracks.Item{item(0, 60, wave("b.wav", 0, 1))}}}},
		"stretch markers":   {Tracks: []tracks.Track{{Items: []tracks.Item{item(0, 60, stretched)}}}},
		"not WAV":           {Tracks: []tracks.Track{{Items: []tracks.Item{item(0, 60, mp3)}}}},
		"source offline":    {Tracks: []tracks.Track{{Items: []tracks.Item{item(0, 60, offline)}}}},
	}
	for name, project := range cases {
		if clip, err := (RegionAudio{Project: project}).ResolveIn(reference(20, 23)); err == nil {
			t.Errorf("%s: resolved to %+v", name, clip)
		}
	}
}

func TestRegionAudioReadsTheSavedProjectThroughItsReader(t *testing.T) {
	project := tracks.Project{Tracks: []tracks.Track{{Items: []tracks.Item{item(0, 10, wave("a.wav", 0, 1))}}}}
	audio := SavedProjectAudio{Read: func() (tracks.Project, error) { return project, nil }}
	if _, err := audio.Resolve(reference(1, 2)); err != nil {
		t.Fatal(err)
	}
	broken := SavedProjectAudio{Read: func() (tracks.Project, error) { return tracks.Project{}, errors.New("no project chosen") }}
	if _, err := broken.Resolve(reference(1, 2)); err == nil {
		t.Fatal("a project read failure was swallowed")
	}
}
