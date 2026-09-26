package editing

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// ScanOptions are the parameters one decode pass uses: DX Phase 2/4's silence
// analyzer thresholds (silence floor, minimum silence) plus DX Phase 9's
// cleanup detector thresholds for clicks and breaths. Zero value resolves to
// each package's own defaults (measure.DefaultDiagnosticOptions,
// measure.DefaultCleanupOptions).
type ScanOptions struct {
	Silence measure.DiagnosticOptions
	Cleanup measure.CleanupOptions
}

// ItemScan is what one decode pass over a Source measured: the silence runs
// and the click/breath candidates. Every time is in the source file's own
// seconds relative to Source.PlayedRange.Start (0 at the played range's
// start), matching measure.DiagnosticInput.Range's own convention ("times in
// the result are then from the range start"). A caller maps them to timeline
// time itself (empty_space.go): this package only ever decodes and reports,
// it never assumes what "timeline" means for its caller.
type ItemScan struct {
	DurationSeconds float64
	Silences        []measure.SilenceRegion
	Cleanup         measure.CleanupDiagnostics
}

// Decode runs the windowed analyzers over exactly src's played range,
// streaming the source file at its native rate per channel (Architecture
// Notes: "Decoding streams blocks at the native sample rate, per channel,
// without loading the file, with context cancellation and progress"). It
// never reads audio before or after the played range: a fixture with dead
// air before SOFFS must report nothing for that dead air (Phase 2's success
// signal), and measure.DiagnosticInput.Range's skip-ahead does exactly that.
//
// A decode failure is classified into a stable UnknownReason (never a raw,
// library-specific error string a caller would have to keep re-guessing at)
// and returned alongside the error, so a caller can record why an item
// became unknown without inspecting err itself. ctx being done is not a
// refusal: Decode returns ctx.Err() with an empty reason, and a caller
// records a partial outcome for it (Phase 5), not an unknown one.
func Decode(ctx context.Context, src Source, opts ScanOptions, progress measure.Progress) (ItemScan, UnknownReason, error) {
	width := src.PlayedRange.End - src.PlayedRange.Start
	if width <= 0 {
		return ItemScan{}, ReasonNoPlayedRange, fmt.Errorf("source %s has no played range to decode", src.File)
	}
	silenceOpts := opts.Silence
	if silenceOpts == (measure.DiagnosticOptions{}) {
		// Unlike measure.CleanupOptions.resolve, measure.DiagnosticOptions.resolve
		// does not treat its zero value as "use the defaults" - it validates the
		// zero SilenceFloordBFS/MinSilenceSeconds as invalid. A caller with no
		// opinion (ScanOptions{}, this package's own zero value) gets DX's own
		// defaults instead of a confusing validation error.
		silenceOpts = measure.DefaultDiagnosticOptions()
	}
	rng := measure.Range{StartSeconds: src.PlayedRange.Start, LengthSeconds: width}
	diagnostics, err := measure.DiagnoseFile(ctx, src.File, measure.DiagnosticInput{
		SourceKind: measure.SourceRawRecording,
		Options:    silenceOpts,
		Range:      &rng,
		Progress:   progress,
		Cleanup:    opts.Cleanup,
	})
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return ItemScan{}, "", ctxErr
		}
		return ItemScan{}, classifyDecodeError(err), fmt.Errorf("%s: %w", src.File, err)
	}
	return ItemScan{
		DurationSeconds: diagnostics.DurationSeconds,
		Silences:        diagnostics.Silences,
		Cleanup:         diagnostics.Cleanup,
	}, "", nil
}

// classifyDecodeError maps a measure package decode failure to a stable
// UnknownReason. measure.ErrNotWAV and the channel-count error are the only
// typed/matchable signals the package exports for this; anything else
// (a truncated header, an unreadable fmt chunk) is ReasonUnreadable, still a
// typed reason, just a less specific one - never a guess at what a raw error
// string might mean release to release.
func classifyDecodeError(err error) UnknownReason {
	switch {
	case errors.Is(err, measure.ErrNotWAV):
		return ReasonUnsupportedFormat
	case errors.Is(err, fs.ErrNotExist):
		return ReasonMissingFile
	case strings.Contains(err.Error(), "unsupported channel count"):
		return ReasonMultiChannel
	default:
		return ReasonUnreadable
	}
}
