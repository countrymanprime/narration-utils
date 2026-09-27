package measure

import (
	"context"
	"errors"
	"os"
	"path/filepath"
)

// Decoding an MP3 for level measurement (delivery-platform-profiles PRD Phase 8, P11): internal/measure never links a
// decoder itself (ADR 0025's "no third runtime" is about the measurement algorithms, which stay this package's own
// hand-written meters), so it asks a Decoder, supplied by the caller, to turn the compressed file back into PCM once. A
// production Decoder is the FFmpeg row render-encode-master's Encoder port already catalogues, run in reverse
// (internal/encodeport, wired in by the host); a fake stands in for it in every test in this package. Once decoded, the
// WAV audio is measured by this package's own analyze() unchanged, exactly as if it had been rendered as a WAV.

// Decoder turns an MP3 file into WAV audio so its levels can be measured. It is a port in spirit even though it is not a
// registered provider-port capability itself: MeasureFile depends on this interface, never on a concrete adapter.
type Decoder interface {
	// DecodeToWAV writes src, an MP3, as PCM WAV audio at dst. It never changes src, and it leaves nothing at dst on
	// failure (including a cancelled ctx).
	DecodeToWAV(ctx context.Context, src, dst string) error
}

// ErrDecoderNotAvailable is a Decoder's answer when it has nothing to decode with right now (the catalogued encoder is
// not installed, or this build offers none on the current platform). MeasureFile treats it as if no Decoder had been
// given at all: the file's levels stay "not checked", not "not measurable" — there was nothing wrong with the MP3, only
// nothing yet able to read it.
var ErrDecoderNotAvailable = errors.New("no MP3 decoder is available")

// decodeAndMeasureLevels decodes path's MP3 audio with decoder into a temporary WAV and measures it with this package's
// own meters, merging the sample-based fields into report. A decode failure other than ErrDecoderNotAvailable (a
// corrupt or truncated MP3, or audio the app's own WAV reader then refuses) leaves every level field null and
// MP3LevelsDecoded true: the attempt is recorded, but nothing is fabricated. ErrDecoderNotAvailable leaves
// MP3LevelsDecoded false, exactly as if decoder had been nil. Cancelling ctx is never swallowed: it is always
// returned so the caller's own cancellation handling still applies.
func decodeAndMeasureLevels(ctx context.Context, decoder Decoder, path string, report Report) (Report, error) {
	if err := ctx.Err(); err != nil {
		return Report{}, err
	}
	dir, err := os.MkdirTemp("", "narration-utils-mp3decode-*")
	if err != nil {
		// Nothing wrong with the MP3 itself; the container measurement still stands.
		return report, nil
	}
	defer func() { _ = os.RemoveAll(dir) }()
	wav := filepath.Join(dir, "decoded.wav")

	if err := decoder.DecodeToWAV(ctx, path, wav); err != nil {
		if errors.Is(err, ErrDecoderNotAvailable) {
			return report, nil
		}
		if ctxErr := ctx.Err(); ctxErr != nil {
			return Report{}, ctxErr
		}
		report.MP3LevelsDecoded = true
		return report, nil
	}

	file, err := os.Open(wav)
	if err != nil {
		report.MP3LevelsDecoded = true
		return report, nil
	}
	defer func() { _ = file.Close() }() // read-only, and temporary: removed with dir above

	decoded, err := analyze(ctx, file, Options{}, -1)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return Report{}, ctxErr
		}
		report.MP3LevelsDecoded = true
		return report, nil
	}

	report.MP3LevelsDecoded = true
	report.IntegratedLUFS, report.RMSdBFS = decoded.IntegratedLUFS, decoded.RMSdBFS
	report.SamplePeakdBFS, report.TruePeakdBTP, report.NoiseFloordBFS = decoded.SamplePeakdBFS, decoded.TruePeakdBTP, decoded.NoiseFloordBFS
	report.DigitalSilentWindows = decoded.DigitalSilentWindows
	report.HeadRoomToneSeconds, report.TailRoomToneSeconds = decoded.HeadRoomToneSeconds, decoded.TailRoomToneSeconds
	report.HeadDigitalSilenceSeconds, report.TailDigitalSilenceSeconds = decoded.HeadDigitalSilenceSeconds, decoded.TailDigitalSilenceSeconds
	report.FullScaleSamples, report.ClipRunCount, report.ClipRuns = decoded.FullScaleSamples, decoded.ClipRunCount, decoded.ClipRuns
	return report, nil
}
