package continuity

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/acoustic"
	"github.com/countrymanprime/narration-utils/shell/internal/character"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// voice is a synthetic, hand-set feature profile: the continuity package
// consumes acoustic.Features, so its tests set them directly instead of
// synthesising audio (the acoustic package's own tests cover the DSP).
type voice struct {
	f0, spread, rate, rms, centroid, low, mid, high float64
}

var (
	aliceVoice     = voice{f0: 230, spread: 60, rate: 3.0, rms: 0.10, centroid: 1800, low: 0.40, mid: 0.45, high: 0.15}
	bobVoice       = voice{f0: 115, spread: 35, rate: 2.2, rms: 0.12, centroid: 1100, low: 0.60, mid: 0.33, high: 0.07}
	narrationVoice = voice{f0: 160, spread: 45, rate: 2.6, rms: 0.11, centroid: 1400, low: 0.50, mid: 0.40, high: 0.10}
)

// jitter returns v nudged by a small, deterministic per-clip variation, so a
// reference set has a real (non-zero) spread the way repeated reads do.
func (v voice) jitter(i int) voice {
	s := []float64{-1, 0.5, 1, -0.5, 0.25, -0.75}[i%6]
	return voice{
		f0: v.f0 + 4*s, spread: v.spread + 2*s, rate: v.rate + 0.05*s, rms: v.rms + 0.002*s,
		centroid: v.centroid + 30*s, low: v.low + 0.005*s, mid: v.mid - 0.004*s, high: v.high - 0.001*s,
	}
}

func (v voice) features() acoustic.Features {
	median, p10, p90 := v.f0, v.f0-v.spread/2, v.f0+v.spread/2
	return acoustic.Features{
		VoicedFraction: 0.7,
		F0MedianHz:     &median, F0P10Hz: &p10, F0P90Hz: &p90,
		RateVoicedRunsPerSecond: v.rate,
		RMSMean:                 v.rms,
		SpectralCentroidHz:      v.centroid,
		BandLowFraction:         v.low, BandMidFraction: v.mid, BandHighFraction: v.high,
	}
}

func (v voice) measurement() Measurement {
	return Measurement{Features: v.features(), RMSdBFS: ptr(-20.0), NoiseFloordBFS: ptr(-65.0)}
}

func ptr[T any](v T) *T { return &v }

// fakeReferences is the ReferenceSource role over a fixed list.
type fakeReferences struct {
	refs []character.ApprovedReference
	err  error
}

func (f fakeReferences) References() ([]character.ApprovedReference, error) { return f.refs, f.err }

// fakeAudio is the ReferenceAudio role: each reference id resolves to a
// clip whose File is the reference id, so fakeMeasurer can key on it.
type fakeAudio struct{ missing map[string]string }

func (f fakeAudio) Resolve(ref character.Reference) (Clip, error) {
	if reason, ok := f.missing[ref.ID]; ok {
		return Clip{}, errors.New(reason)
	}
	return Clip{File: ref.ID, Range: measure.Range{StartSeconds: ref.Snapshot.Start, LengthSeconds: ref.Snapshot.End - ref.Snapshot.Start}}, nil
}

// fakeMeasurer is the ClipMeasurer role keyed on Clip.File.
type fakeMeasurer struct {
	byFile map[string]Measurement
	calls  []Clip
}

func (f *fakeMeasurer) Measure(clip Clip) (Measurement, error) {
	f.calls = append(f.calls, clip)
	m, ok := f.byFile[clip.File]
	if !ok {
		return Measurement{}, fmt.Errorf("no audio for %s", clip.File)
	}
	return m, nil
}

// fakeAligner is the CueAligner role keyed on cue id; a cue it does not
// know is unaligned.
type fakeAligner map[string]Alignment

func (f fakeAligner) Align(cue Cue) (Alignment, error) {
	if a, ok := f[cue.ID]; ok {
		return a, nil
	}
	return Alignment{Reliable: false, Reason: "no aligned words cover this line"}, nil
}

// fixture builds a project with approved references and candidate lines.
type fixture struct {
	refs     []character.ApprovedReference
	measurer *fakeMeasurer
	aligner  fakeAligner
	cues     []Cue
}

func newFixture() *fixture {
	return &fixture{measurer: &fakeMeasurer{byFile: map[string]Measurement{}}, aligner: fakeAligner{}}
}

// approve adds n approved references for characterID in voice v.
func (f *fixture) approve(characterID string, v voice, n int) {
	for i := range n {
		id := fmt.Sprintf("ref-%s-%d", characterID, i)
		f.refs = append(f.refs, character.ApprovedReference{Reference: character.Reference{
			ID: id, CharacterID: characterID, RegionGUID: "{" + id + "}",
			Snapshot:   character.RegionSnapshot{Name: id, Start: float64(10 * i), End: float64(10*i + 3)},
			ApprovedAt: time.Date(2026, 9, 27, 12, 0, 0, 0, time.UTC),
		}})
		f.measurer.byFile[id] = v.jitter(i).measurement()
	}
}

// line adds a candidate dialogue cue for speakerID, aligned to audio
// measuring m.
func (f *fixture) line(cueID, speakerID string, m Measurement) {
	f.cues = append(f.cues, Cue{
		ID: cueID, ChapterID: "ch-01", ParagraphID: "p-" + cueID, QuoteStart: 4, QuoteEnd: 20,
		QuoteText: "a line of " + speakerID, SpeakerID: speakerID, SpeakerSource: "tag",
	})
	file := "take-" + cueID + ".wav"
	f.aligner[cueID] = Alignment{
		Reliable:  true,
		Clip:      Clip{File: file, Range: measure.Range{StartSeconds: 1, LengthSeconds: 2}},
		Source:    findings.Source{File: file, ItemGUID: "{item-" + cueID + "}"},
		TimeRange: findings.TimeRange{Start: 100, End: 102},
	}
	f.measurer.byFile[file] = m
}

func (f *fixture) config() Config {
	return Config{
		References:     fakeReferences{refs: f.refs},
		ReferenceAudio: fakeAudio{},
		Aligner:        f.aligner,
		Measurer:       f.measurer,
		Rule:           DefaultRule(),
		Project:        findings.Project{Path: "/books/one"},
	}
}

func (f *fixture) analyze(t *testing.T) Result {
	t.Helper()
	result, err := Analyze(f.config(), f.cues)
	if err != nil {
		t.Fatalf("Analyze: %v", err)
	}
	for _, finding := range result.Findings {
		if err := finding.Validate(); err != nil {
			t.Fatalf("finding %s does not validate against the contract: %v", finding.ID, err)
		}
	}
	return result
}

func findingFor(t *testing.T, result Result, cueID string) (findings.Finding, bool) {
	t.Helper()
	for _, finding := range result.Findings {
		if finding.Evidence["cue_id"] == cueID {
			return finding, true
		}
	}
	return findings.Finding{}, false
}
