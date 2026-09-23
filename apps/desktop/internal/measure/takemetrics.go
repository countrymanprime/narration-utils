package measure

import (
	"errors"
	"fmt"
	"io/fs"
	"math"
	"os"

	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// Take metrics are per-category evidence about one take (ADR 0140): each
// category is measured or unavailable with a reason, and nothing combines
// the categories into one number (take-review PRD, Q9). A category that
// cannot be measured carries no figures and lowers Coverage; it is never a
// penalty and never a guessed value (ADR 0025).

// EvidenceStatus says whether a category was measured.
type EvidenceStatus string

const (
	StatusMeasured    EvidenceStatus = "measured"
	StatusUnavailable EvidenceStatus = "unavailable"
)

// The evidence categories, in the order Coverage lists them.
const (
	CategoryClipping         = "clipping"
	CategoryNoise            = "noise"
	CategoryLevelConsistency = "level_consistency"
	CategoryDuration         = "duration"
	CategoryPauseProfile     = "pause_profile"
)

// waveSourceKind is REAPER's <SOURCE WAVE> kind, the only one measured.
const waveSourceKind = "WAVE"

// Evidence is a category's availability and, when unavailable, why.
type Evidence struct {
	Status EvidenceStatus `json:"status"`
	Reason string         `json:"reason,omitempty"`
}

var measured = Evidence{Status: StatusMeasured}

func unavailable(reason string) Evidence {
	return Evidence{Status: StatusUnavailable, Reason: reason}
}

// NeighborLevel is the integrated loudness of an item near the take (the
// caller measures it, typically the active take of an adjacent item); nil
// when that item could not be measured.
type NeighborLevel struct {
	ItemGUID       string   `json:"item_guid"`
	IntegratedLUFS *float64 `json:"integrated_lufs"`
}

// TakeInput is everything MeasureTake needs about one take.
type TakeInput struct {
	Item      tracks.Item
	TakeIndex int
	// Words is the take's transcript, timed from the start of its source
	// range. Nil means there is no transcript; an empty slice means one
	// that found no words.
	Words     []Word
	Neighbors []NeighborLevel
	// Pauses are the pause thresholds; zero means DefaultPauseOptions.
	Pauses PauseOptions
}

// ClippingEvidence is the take's full-scale samples and clip runs.
type ClippingEvidence struct {
	Evidence
	FullScaleSamples *int64    `json:"full_scale_samples"`
	ClipRunCount     *int      `json:"clip_run_count"`
	ClipRuns         []ClipRun `json:"clip_runs"`
}

// NoiseEvidence is the take's room-tone floor.
type NoiseEvidence struct {
	Evidence
	NoiseFloordBFS       *float64 `json:"noise_floor_dbfs"`
	DigitalSilentWindows *int     `json:"digital_silent_windows"`
}

// LevelConsistencyEvidence compares the take's integrated loudness with
// the median of its measurable neighbours.
type LevelConsistencyEvidence struct {
	Evidence
	IntegratedLUFS       *float64 `json:"integrated_lufs"`
	NeighborMedianLUFS   *float64 `json:"neighbor_median_lufs"`
	DeltaLU              *float64 `json:"delta_lu"`
	NeighborsMeasured    int      `json:"neighbors_measured"`
	NeighborsUnavailable int      `json:"neighbors_unavailable"`
}

// DurationEvidence is the take's length in the project, in its source, in
// the audio that exists, and of its speech.
type DurationEvidence struct {
	Evidence
	ItemSeconds    *float64 `json:"item_seconds"`
	SourceSeconds  *float64 `json:"source_seconds"`
	AudioSeconds   *float64 `json:"audio_seconds"`
	SpeechSeconds  *float64 `json:"speech_seconds"`
	WordsPerMinute *float64 `json:"words_per_minute"`
}

// PauseProfileEvidence is the silences between the take's words, with the
// thresholds that defined them.
type PauseProfileEvidence struct {
	Evidence
	PauseOptions
	*PauseSummary
}

// Coverage counts the measured categories. Unavailable names the others,
// in category order; it is empty, not null, when everything was measured.
type Coverage struct {
	Measured    int      `json:"measured"`
	Total       int      `json:"total"`
	Unavailable []string `json:"unavailable"`
}

// SourceRange is the part of a source file a take plays.
type SourceRange struct {
	File  string `json:"file"`
	Kind  string `json:"kind"`
	Range Range  `json:"range"`
}

// TakeMetrics is the evidence for one take. Audio is the underlying range
// measurement, kept so every figure can be reproduced from it.
type TakeMetrics struct {
	TakeGUID         string                   `json:"take_guid"`
	TakeIndex        int                      `json:"take_index"`
	Source           *SourceRange             `json:"source"`
	Audio            *Report                  `json:"audio"`
	Clipping         ClippingEvidence         `json:"clipping"`
	Noise            NoiseEvidence            `json:"noise"`
	LevelConsistency LevelConsistencyEvidence `json:"level_consistency"`
	Duration         DurationEvidence         `json:"duration"`
	PauseProfile     PauseProfileEvidence     `json:"pause_profile"`
	Coverage         Coverage                 `json:"coverage"`
}

// MeasureTake measures one take of an item. Anything about the take's
// audio or transcript that stops a category being measured is reported
// as that category's unavailability; an error means the input itself is
// wrong (no such take, malformed words or thresholds).
func MeasureTake(in TakeInput) (TakeMetrics, error) {
	if in.TakeIndex < 0 || in.TakeIndex >= len(in.Item.Takes) {
		return TakeMetrics{}, fmt.Errorf("item has no take %d (it has %d)", in.TakeIndex, len(in.Item.Takes))
	}
	if err := validateWords(in.Words); err != nil {
		return TakeMetrics{}, err
	}
	opts, err := in.Pauses.resolve()
	if err != nil {
		return TakeMetrics{}, err
	}

	source, audio, reason := measureTakeAudio(in.Item, in.TakeIndex)
	metrics := TakeMetrics{
		TakeGUID:         in.Item.Takes[in.TakeIndex].GUID,
		TakeIndex:        in.TakeIndex,
		Source:           source,
		Audio:            audio,
		Clipping:         clippingEvidence(audio, reason),
		Noise:            noiseEvidence(audio, reason),
		LevelConsistency: levelEvidence(audio, reason, in.Neighbors),
		Duration:         durationEvidence(in.Item, source, audio, in.Words),
		PauseProfile:     pauseEvidence(in.Words, source, opts),
	}
	metrics.Coverage = coverageOf(metrics)
	return metrics, nil
}

// measureTakeAudio measures the take's source range, or says why not.
func measureTakeAudio(item tracks.Item, index int) (*SourceRange, *Report, string) {
	source, err := TakeSourceRange(item, index)
	if err != nil {
		return nil, nil, "the take's source range cannot be derived: " + err.Error()
	}
	take := item.Takes[index]
	switch {
	case source.Kind != waveSourceKind:
		return &source, nil, fmt.Sprintf("source format %q is not measured: only WAV is (ADR 0025)", source.Kind)
	case !take.SourceAvailable:
		return &source, nil, "the take's source file is not available"
	}
	report, err := analyzeSource(source)
	if err != nil {
		return &source, nil, "the take's source could not be read: " + err.Error()
	}
	if report.DurationSeconds == 0 {
		return &source, nil, "the take's range lies outside its source audio"
	}
	report.File = source.File
	return &source, &report, ""
}

// analyzeSource measures a source range. Errors leave out the file path
// (Source already names it), so a reason is safe to show or export.
func analyzeSource(source SourceRange) (Report, error) {
	file, err := os.Open(source.File)
	if err != nil {
		var pathErr *fs.PathError
		if errors.As(err, &pathErr) {
			return Report{}, pathErr.Err
		}
		return Report{}, err
	}
	defer func() { _ = file.Close() }() // read-only
	return AnalyzeRange(file, source.Range)
}

// TakeSourceRange is the range of its source file that a take plays:
// from its SOFFS (plus a SECTION wrapper's start) for the item length
// times the playrate. It refuses what it cannot derive exactly rather than
// approximate it: stretch markers (source time is then not linear in item
// time), a negative offset (the take starts before its source), and a
// range running past a SECTION's end (REAPER loops the section there).
func TakeSourceRange(item tracks.Item, index int) (SourceRange, error) {
	if index < 0 || index >= len(item.Takes) {
		return SourceRange{}, fmt.Errorf("item has no take %d", index)
	}
	take := item.Takes[index]
	source := SourceRange{File: take.SourceFile, Kind: take.SourceKind}
	rate := take.PlayRate
	if rate == 0 {
		rate = 1 // no PLAYRATE line: REAPER's default rate
	}
	switch {
	case !finite(item.Length) || item.Length <= 0:
		return source, fmt.Errorf("item length %v is not a usable length", item.Length)
	case !finite(rate) || rate < 0:
		return source, fmt.Errorf("playrate %v is not usable", take.PlayRate)
	case take.StretchMarkerCount > 0:
		return source, fmt.Errorf("the take has %d stretch markers, so its source time is not a linear map of item time", take.StretchMarkerCount)
	case !finite(take.SOFFS) || take.SOFFS < 0:
		return source, fmt.Errorf("the take starts %v s before its source", -take.SOFFS)
	}
	source.Range = Range{StartSeconds: take.SOFFS, LengthSeconds: item.Length * rate}
	if section := take.Section; section != nil {
		if section.Length > 0 && take.SOFFS+source.Range.LengthSeconds > section.Length+sectionTolerance {
			return source, fmt.Errorf("the take plays past the end of its %v s section, where REAPER loops the section", section.Length)
		}
		source.Range.StartSeconds += section.StartPos
	}
	return source, nil
}

// sectionTolerance absorbs the float rounding in REAPER's saved lengths.
const sectionTolerance = 1e-6

func clippingEvidence(audio *Report, reason string) ClippingEvidence {
	if audio == nil {
		return ClippingEvidence{Evidence: unavailable(reason)}
	}
	fullScale, runs := audio.FullScaleSamples, audio.ClipRunCount
	return ClippingEvidence{Evidence: measured, FullScaleSamples: &fullScale, ClipRunCount: &runs, ClipRuns: audio.ClipRuns}
}

func noiseEvidence(audio *Report, reason string) NoiseEvidence {
	if audio == nil {
		return NoiseEvidence{Evidence: unavailable(reason)}
	}
	silent := audio.DigitalSilentWindows
	evidence := NoiseEvidence{Evidence: measured, NoiseFloordBFS: audio.NoiseFloordBFS, DigitalSilentWindows: &silent}
	if audio.NoiseFloordBFS == nil {
		evidence.Evidence = unavailable("no 500 ms window of the take holds signal (it is too short or digitally silent)")
	}
	return evidence
}

func levelEvidence(audio *Report, reason string, neighbors []NeighborLevel) LevelConsistencyEvidence {
	var levels []float64
	for _, n := range neighbors {
		if n.IntegratedLUFS != nil && finite(*n.IntegratedLUFS) {
			levels = append(levels, *n.IntegratedLUFS)
		}
	}
	evidence := LevelConsistencyEvidence{NeighborsMeasured: len(levels), NeighborsUnavailable: len(neighbors) - len(levels)}
	switch {
	case audio == nil:
		evidence.Evidence = unavailable(reason)
		return evidence
	case audio.IntegratedLUFS == nil:
		evidence.Evidence = unavailable("the take is too short or silent for integrated loudness (it needs 400 ms of signal)")
		return evidence
	}
	evidence.IntegratedLUFS = audio.IntegratedLUFS
	if len(levels) == 0 {
		evidence.Evidence = unavailable("no neighbouring item has a measurable integrated loudness")
		return evidence
	}
	middle := median(levels)
	delta := *audio.IntegratedLUFS - middle
	evidence.Evidence, evidence.NeighborMedianLUFS, evidence.DeltaLU = measured, &middle, &delta
	return evidence
}

func durationEvidence(item tracks.Item, source *SourceRange, audio *Report, words []Word) DurationEvidence {
	evidence := DurationEvidence{Evidence: measured}
	if !finite(item.Length) || item.Length <= 0 {
		evidence.Evidence = unavailable("the item has no usable length in the project")
	} else {
		length := item.Length
		evidence.ItemSeconds = &length
	}
	if source != nil {
		length := source.Range.LengthSeconds
		evidence.SourceSeconds = &length
	}
	if audio != nil {
		length := audio.DurationSeconds
		evidence.AudioSeconds = &length
	}
	if len(words) > 0 {
		span := lastEnd(words) - words[0].StartSeconds
		evidence.SpeechSeconds = &span
		if span > 0 {
			rate := float64(len(words)) / span * 60
			evidence.WordsPerMinute = &rate
		}
	}
	return evidence
}

func lastEnd(words []Word) float64 {
	end := 0.0
	for _, w := range words {
		end = max(end, w.EndSeconds)
	}
	return end
}

func pauseEvidence(words []Word, source *SourceRange, opts PauseOptions) PauseProfileEvidence {
	evidence := PauseProfileEvidence{PauseOptions: opts}
	switch {
	case words == nil:
		evidence.Evidence = unavailable("no transcript for this take")
		return evidence
	case len(words) < 2:
		evidence.Evidence = unavailable("fewer than two timed words, so there is no silence between words to profile")
		return evidence
	}
	rangeLength := math.NaN() // no derivable range: no trailing figure
	if source != nil {
		rangeLength = source.Range.LengthSeconds
	}
	summary := pauseProfile(words, rangeLength, opts)
	evidence.Evidence, evidence.PauseSummary = measured, &summary
	return evidence
}

func coverageOf(m TakeMetrics) Coverage {
	coverage := Coverage{Unavailable: []string{}}
	for _, category := range []struct {
		name     string
		evidence Evidence
	}{
		{CategoryClipping, m.Clipping.Evidence},
		{CategoryNoise, m.Noise.Evidence},
		{CategoryLevelConsistency, m.LevelConsistency.Evidence},
		{CategoryDuration, m.Duration.Evidence},
		{CategoryPauseProfile, m.PauseProfile.Evidence},
	} {
		coverage.Total++
		if category.evidence.Status == StatusMeasured {
			coverage.Measured++
		} else {
			coverage.Unavailable = append(coverage.Unavailable, category.name)
		}
	}
	return coverage
}
