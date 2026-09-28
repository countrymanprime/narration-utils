package continuity

import (
	"github.com/countrymanprime/narration-utils/shell/internal/acoustic"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// FileMeasurer is the ClipMeasurer role over WAV files on disk: the
// Phase 4 features (acoustic.ExtractFile) and the range's RMS level and
// noise floor (measure.AnalyzeFileRange) for the recording-chain check.
type FileMeasurer struct{}

// Measure measures clip's range of its file.
func (FileMeasurer) Measure(clip Clip) (Measurement, error) {
	features, err := acoustic.ExtractFile(clip.File, &clip.Range)
	if err != nil {
		return Measurement{}, err
	}
	report, err := measure.AnalyzeFileRange(clip.File, clip.Range)
	if err != nil {
		return Measurement{}, err
	}
	return Measurement{Features: features, RMSdBFS: report.RMSdBFS, NoiseFloordBFS: report.NoiseFloordBFS}, nil
}
