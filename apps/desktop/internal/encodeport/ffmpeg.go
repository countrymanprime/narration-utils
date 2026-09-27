package encodeport

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/measure"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
	"github.com/countrymanprime/narration-utils/shell/internal/process"
)

// The FFmpeg row (render-encode-master Phase 1, ADR 0342): WAV to constant-bit-rate MP3 with libmp3lame, run as a separate
// process from the catalogued FFmpeg build (config/encoder-assets.json, internal/ffmpeg). The encode writes a dot-named temporary file beside
// dst, checks it with the app's own MP3 reader (measure.ReadMP3) and only then renames it to dst, so a failure, a timeout or a
// cancel leaves nothing at dst; the WAV is only ever read.

// FFmpegName is the FFmpeg row's name.
const FFmpegName = "ffmpeg"

// DefaultMP3BitrateKbps is the bitrate when a Spec leaves it to the encoder: ACX's floor (acx.format, 192 kbps CBR and above).
const DefaultMP3BitrateKbps = 192

var (
	// ErrSameFile is an encode asked to write over the WAV it reads: refused, the source is never changed.
	ErrSameFile = errors.New("the encoded file would replace the WAV it is encoded from")
	// ErrDestinationExists is an encode asked to write where a file already is: refused, an encode never overwrites.
	ErrDestinationExists = errors.New("a file is already at the destination; an encode never replaces one")
	// ErrEncoderNotInstalled is an encode with no FFmpeg installed: the caller offers the first-use download.
	ErrEncoderNotInstalled = errors.New("the FFmpeg encoder is not installed")
)

// mp3Bitrates are the Layer III bitrates of MPEG-1, the only ones a 32, 44.1 or 48 kHz MP3 can have.
var mp3Bitrates = []int{32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320}

// mp3SampleRates are the MPEG-1 sample rates an encode may be asked for.
var mp3SampleRates = []int{32000, 44100, 48000}

// Locator answers the path of the installed FFmpeg executable, or ErrEncoderNotInstalled.
type Locator func() (string, error)

// FFmpeg is the Encoder that runs the catalogued FFmpeg build.
type FFmpeg struct {
	locate     Locator
	supervisor *process.Supervisor
}

var _ Encoder = (*FFmpeg)(nil)

// NewFFmpeg is an FFmpeg encoder that finds its executable with locate and runs it under supervisor (so closing the app ends it).
func NewFFmpeg(locate Locator, supervisor *process.Supervisor) *FFmpeg {
	return &FFmpeg{locate: locate, supervisor: supervisor}
}

func (f *FFmpeg) Name() string { return FFmpegName }

// ffmpegRow is what the registered row's New builds from: set once by the host at start (UseFFmpeg), read on each New.
var ffmpegRow struct {
	mu sync.RWMutex
	// +checklocks:mu
	locate Locator
	// +checklocks:mu
	supervisor *process.Supervisor
}

// UseFFmpeg tells the registered FFmpeg row where to find the executable and which supervisor runs it. The host calls it once at
// start, when the asset registry is built; until then the row answers ErrEncoderNotInstalled.
func UseFFmpeg(locate Locator, supervisor *process.Supervisor) {
	ffmpegRow.mu.Lock()
	defer ffmpegRow.mu.Unlock()
	ffmpegRow.locate, ffmpegRow.supervisor = locate, supervisor
}

func notInstalled() (string, error) { return "", ErrEncoderNotInstalled }

func init() {
	Encoders.Register(port.Entry[Encoder]{
		Name: FFmpegName,
		// Windows only: the catalogued build is a Windows executable (ADR 0342); the PRD is Windows-first.
		Descriptor: port.Descriptor{Label: "FFmpeg (LAME MP3)", Platforms: []string{"windows"}, Modes: []string{"mp3"}},
		New: func() Encoder {
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

// Encode writes wav as a CBR MP3 at dst. It refuses a format other than mp3, a dst that is the WAV itself, a dst where a file
// already is, and a spec no MPEG-1 Layer III file can have. A spec that leaves the sample rate open keeps the WAV's when an MP3 can
// have it (32, 44.1, 48 kHz) and resamples to 44.1 kHz otherwise. Spec.Progress, when set, hears how much of the audio is encoded.
func (f *FFmpeg) Encode(ctx context.Context, wav, dst string, spec Spec) error {
	if spec.Format != "mp3" {
		return FormatNotSupported("encoder", FFmpegName, spec.Format)
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	bitrate, err := mp3Spec(&spec)
	if err != nil {
		return err
	}
	if err := distinct(wav, dst); err != nil {
		return err
	}
	if wav, err = filepath.Abs(wav); err != nil {
		return err
	}
	if dst, err = filepath.Abs(dst); err != nil {
		return err
	}
	length, format, err := readWAV(wav)
	if err != nil {
		return err
	}
	if spec.SampleRateHz == 0 && !slices.Contains(mp3SampleRates, format.SampleRate) {
		// Left to itself LAME would write a 16 or 22.05 kHz source as MPEG-2, which cannot reach 192 kbps.
		spec.SampleRateHz = 44100
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

	encodeCtx, cancel := context.WithTimeout(ctx, encodeTimeout(length))
	defer cancel()
	progress := progressReader(spec.Progress, length)
	child, err := f.supervise().StartStream(encodeCtx, progress, executable, mp3Args(wav, partial, bitrate, spec)...)
	if err != nil {
		return fmt.Errorf("could not start FFmpeg: %w", err)
	}
	<-child.Done()
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := encodeCtx.Err(); err != nil {
		return fmt.Errorf("FFmpeg did not finish within %s: %w", encodeTimeout(length), err)
	}
	if code, _ := child.ExitCode(); code != 0 {
		return fmt.Errorf("FFmpeg stopped with exit code %d: %s", code, strings.TrimSpace(child.StderrTail()))
	}
	if err := checkMP3(ctx, partial, bitrate, spec); err != nil {
		return err
	}
	if _, err := os.Lstat(dst); err == nil {
		return ErrDestinationExists
	}
	if err := os.Rename(partial, dst); err != nil {
		return err
	}
	keep = true
	if spec.Progress != nil {
		spec.Progress(length, length)
	}
	return nil
}

func (f *FFmpeg) supervise() *process.Supervisor {
	if f.supervisor != nil {
		return f.supervisor
	}
	return fallbackSupervisor()
}

// fallbackSupervisor runs an encoder that was given none (a test): one per program, which lives as long as it does.
var fallbackSupervisor = sync.OnceValue(process.NewSupervisor)

// mp3Spec fills a spec's defaults and refuses what no MPEG-1 Layer III file can hold; it answers the bitrate.
func mp3Spec(spec *Spec) (int, error) {
	bitrate := spec.BitrateKbps
	if bitrate == 0 {
		bitrate = DefaultMP3BitrateKbps
	}
	if !slices.Contains(mp3Bitrates, bitrate) {
		return 0, fmt.Errorf("an MP3 cannot have a constant bitrate of %d kbps (it can have %v)", bitrate, mp3Bitrates)
	}
	if spec.SampleRateHz != 0 && !slices.Contains(mp3SampleRates, spec.SampleRateHz) {
		return 0, fmt.Errorf("this encoder writes MP3 at %v Hz, not %d Hz", mp3SampleRates, spec.SampleRateHz)
	}
	if spec.Channels < 0 || spec.Channels > 2 {
		return 0, fmt.Errorf("an MP3 holds one or two channels, not %d", spec.Channels)
	}
	return bitrate, nil
}

// distinct refuses a dst that is wav (the same path, another spelling of it, or a link to it) and a dst where a file already is.
func distinct(wav, dst string) error {
	source, err := filepath.Abs(wav)
	if err != nil {
		return err
	}
	target, err := filepath.Abs(dst)
	if err != nil {
		return err
	}
	if source == target || (runtime.GOOS == "windows" && strings.EqualFold(source, target)) {
		return ErrSameFile
	}
	targetInfo, err := os.Stat(target)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if sourceInfo, err := os.Stat(source); err == nil && os.SameFile(sourceInfo, targetInfo) {
		return ErrSameFile
	}
	return ErrDestinationExists
}

// readWAV reads wav's header (refusing a file that is not a WAV the app can read) and estimates its length from its size, for
// progress and the time limit.
func readWAV(wav string) (time.Duration, measure.Format, error) {
	file, err := os.Open(wav)
	if err != nil {
		return 0, measure.Format{}, err
	}
	defer func() { _ = file.Close() }() // read-only
	info, err := file.Stat()
	if err != nil {
		return 0, measure.Format{}, err
	}
	reader, err := measure.NewWAVReader(file)
	if err != nil {
		return 0, measure.Format{}, fmt.Errorf("%s: %w", wav, err)
	}
	format := reader.Format()
	bytesPerSecond := int64(format.SampleRate) * int64(format.Channels) * int64(format.BitsPerSample/8)
	if bytesPerSecond <= 0 {
		return 0, measure.Format{}, fmt.Errorf("%s: the WAV header gives no byte rate", wav)
	}
	return time.Duration(float64(info.Size()) / float64(bytesPerSecond) * float64(time.Second)), format, nil
}

// encodeTimeout bounds one encode: FFmpeg encodes MP3 at many times real time, so twice the audio's length plus five minutes is
// only reached by a process that hangs.
func encodeTimeout(length time.Duration) time.Duration { return 2*length + 5*time.Minute }

// reservePartial creates the temporary file FFmpeg writes into: dot-named, beside dst (so the rename stays on one disk), and unique.
func reservePartial(dst string) (string, error) {
	file, err := os.CreateTemp(filepath.Dir(dst), "."+filepath.Base(dst)+".*.encoding")
	if err != nil {
		return "", err
	}
	name := file.Name()
	if err := file.Close(); err != nil {
		_ = os.Remove(name)
		return "", err
	}
	return name, nil
}

// mp3Args is the command line of one encode: the first audio stream of wav, no metadata, LAME at a constant bitrate, and an MP3
// holding audio frames only (no Info frame, no ID3v2 tag: ADR 0342), with machine-readable progress on stdout. Both paths are
// absolute and named through FFmpeg's file protocol, with every other input protocol refused, so neither can be read as an option
// ("-...") or as a URL FFmpeg would fetch or expand ("http:", "concat:", ...).
func mp3Args(wav, out string, bitrate int, spec Spec) []string {
	args := []string{
		"-hide_banner", "-nostdin", "-nostats", "-loglevel", "error", "-progress", "pipe:1",
		"-protocol_whitelist", "file", "-i", fileURL(wav), "-map", "0:a:0", "-map_metadata", "-1",
		"-c:a", "libmp3lame", "-b:a", strconv.Itoa(bitrate) + "k",
	}
	if spec.SampleRateHz != 0 {
		args = append(args, "-ar", strconv.Itoa(spec.SampleRateHz))
	}
	if spec.Channels != 0 {
		args = append(args, "-ac", strconv.Itoa(spec.Channels))
	}
	return append(args, "-write_xing", "0", "-id3v2_version", "0", "-f", "mp3", "-y", fileURL(out))
}

// fileURL names path through FFmpeg's file protocol. The caller has made it absolute (Encode), so it starts with "/" or a drive.
func fileURL(path string) string { return "file:" + path }

// progressReader turns FFmpeg's -progress lines into Spec.Progress calls: out_time_us is how much audio is written, never
// reported beyond the WAV's length.
func progressReader(report func(done, total time.Duration), total time.Duration) func(string) {
	return func(line string) {
		value, ok := strings.CutPrefix(line, "out_time_us=")
		if !ok || report == nil {
			return
		}
		micros, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
		if err != nil || micros < 0 {
			return
		}
		report(min(time.Duration(micros)*time.Microsecond, total), total)
	}
}

// checkMP3 reads what FFmpeg wrote with the app's own MP3 reader and refuses it unless it is the CBR MP3 that was asked for.
func checkMP3(ctx context.Context, path string, bitrate int, spec Spec) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer func() { _ = file.Close() }()
	info, err := measure.ReadMP3(ctx, file, nil)
	if err != nil {
		return fmt.Errorf("FFmpeg wrote a file the app cannot read as an MP3: %w", err)
	}
	switch {
	case !info.CBR || info.BitrateKbps != bitrate:
		return fmt.Errorf("FFmpeg wrote an MP3 at %.1f kbps (constant: %t), not %d kbps CBR", info.AverageBitrateKbps, info.CBR, bitrate)
	case spec.SampleRateHz != 0 && info.SampleRate != spec.SampleRateHz:
		return fmt.Errorf("FFmpeg wrote an MP3 at %d Hz, not %d Hz", info.SampleRate, spec.SampleRateHz)
	case spec.Channels != 0 && info.Channels() != spec.Channels:
		return fmt.Errorf("FFmpeg wrote an MP3 with %d channel(s), not %d", info.Channels(), spec.Channels)
	case info.LostBytes > 0:
		return fmt.Errorf("FFmpeg wrote an MP3 with %d bytes between its frames", info.LostBytes)
	}
	return nil
}
