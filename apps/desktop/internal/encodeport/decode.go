package encodeport

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/measure"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

// The decode direction (render-encode-master Phase 1 built the encode side only; delivery-platform-profiles Phase 8,
// P11 needs the decode side too, to measure levels on an already-encoded MP3): the same catalogued FFmpeg build
// Phase 1 runs to write MP3s also reads one back to PCM. internal/measure never imports this package — it already
// imports measure, for ReadMP3 (checkMP3 below) — so the host wires a Decoders row into measure.Options.Decoder
// instead of measure depending on encodeport (see apps/desktop's own glue, mp3decode.go).

// Decoder turns a compressed audio file back into WAV audio, for measurement rather than delivery.
type Decoder interface {
	// Name is the registry row's name.
	Name() string
	// DecodeToWAV writes src, in one of the row's Descriptor.Modes, as PCM WAV audio at dst. It never changes src,
	// and on failure (including a cancelled ctx) it leaves nothing at dst.
	DecodeToWAV(ctx context.Context, src, dst string) error
}

// NewDecoders is an empty decoder registry. A test registers a fake on its own copy.
func NewDecoders() *port.Registry[Decoder] { return &port.Registry[Decoder]{Kind: "decoder"} }

// Decoders is the program's registry. The FFmpeg row registers itself here, reusing the executable UseFFmpeg already
// points at for encoding: one asset, one license record, both directions.
var Decoders = NewDecoders()

func init() {
	Decoders.Register(port.Entry[Decoder]{
		Name: FFmpegName,
		// Windows only, matching the Encoders row: the catalogued build is a Windows executable (ADR 0342).
		Descriptor: port.Descriptor{Label: "FFmpeg (MP3 decode)", Platforms: []string{"windows"}, Modes: []string{"mp3"}},
		New: func() Decoder {
			ffmpegRow.mu.RLock()
			defer ffmpegRow.mu.RUnlock()
			locate, supervisor := ffmpegRow.locate, ffmpegRow.supervisor
			if locate == nil {
				locate = notInstalled
			}
			return NewFFmpeg(locate, supervisor)
		},
	})
}

var _ Decoder = (*FFmpeg)(nil)

// decodeTimeout bounds one decode the same way encodeTimeout bounds an encode: FFmpeg decodes MP3 far faster than real
// time, so twice the audio's length plus five minutes is only reached by a process that hangs.
func decodeTimeout(length time.Duration) time.Duration { return 2*length + 5*time.Minute }

// DecodeToWAV runs FFmpeg to decode src (an MP3) to a PCM WAV at dst, following the same chain-of-custody rules Encode
// does: refuses a dst that is src (the same path, another spelling, or a link to it), refuses an existing dst, writes
// a dot-named partial beside dst and renames it only once the app's own WAV reader accepts it, and leaves nothing at
// dst on failure, a timeout or a cancel.
func (f *FFmpeg) DecodeToWAV(ctx context.Context, src, dst string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := distinct(src, dst); err != nil {
		return err
	}
	var err error
	if src, err = filepath.Abs(src); err != nil {
		return err
	}
	if dst, err = filepath.Abs(dst); err != nil {
		return err
	}
	length, err := mp3Length(ctx, src)
	if err != nil {
		return err
	}
	executable, err := f.locate()
	if err != nil {
		return err
	}

	partial, err := reservePartial(dst)
	if err != nil {
		return err
	}
	keep := false
	defer func() {
		if !keep {
			_ = os.Remove(partial)
		}
	}()

	decodeCtx, cancel := context.WithTimeout(ctx, decodeTimeout(length))
	defer cancel()
	child, err := f.supervise().StartStream(decodeCtx, nil, executable, decodeArgs(src, partial)...)
	if err != nil {
		return fmt.Errorf("could not start FFmpeg: %w", err)
	}
	<-child.Done()
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := decodeCtx.Err(); err != nil {
		return fmt.Errorf("FFmpeg did not finish within %s: %w", decodeTimeout(length), err)
	}
	if code, _ := child.ExitCode(); code != 0 {
		return fmt.Errorf("FFmpeg stopped with exit code %d: %s", code, strings.TrimSpace(child.StderrTail()))
	}
	if err := checkWAV(partial); err != nil {
		return err
	}
	if _, err := os.Lstat(dst); err == nil {
		return ErrDestinationExists
	}
	if err := os.Rename(partial, dst); err != nil {
		return err
	}
	keep = true
	return nil
}

// mp3Length reads src's frame headers only, for the decode's time limit.
func mp3Length(ctx context.Context, src string) (time.Duration, error) {
	file, err := os.Open(src)
	if err != nil {
		return 0, err
	}
	defer func() { _ = file.Close() }() // read-only
	info, err := measure.ReadMP3(ctx, file, nil)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", src, err)
	}
	return time.Duration(info.DurationSeconds * float64(time.Second)), nil
}

// decodeArgs is the command line of one decode: the first audio stream of src, written as 16-bit PCM WAV at its own
// sample rate and channel count (no resampling: internal/measure's own meters read whatever the WAV header says).
// Both paths are absolute and named through FFmpeg's file protocol, with every other input protocol refused, mirroring
// mp3Args's own reasoning: a path shaped like an option or a URL cannot become one.
func decodeArgs(src, dst string) []string {
	return []string{
		"-hide_banner", "-nostdin", "-nostats", "-loglevel", "error", "-progress", "pipe:1",
		"-protocol_whitelist", "file", "-i", fileURL(src), "-map", "0:a:0",
		"-c:a", "pcm_s16le", "-f", "wav", "-y", fileURL(dst),
	}
}

// checkWAV confirms FFmpeg wrote a file the app's own WAV reader accepts, mirroring checkMP3's use of the app's own
// MP3 reader to confirm an encode.
func checkWAV(path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer func() { _ = file.Close() }() // read-only
	if _, err := measure.NewWAVReader(file); err != nil {
		return fmt.Errorf("FFmpeg wrote a file the app cannot read as a WAV: %w", err)
	}
	return nil
}
