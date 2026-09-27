package encodeport_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/encodeport"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// The decode direction (delivery-platform-profiles Phase 8, P11): the same fake FFmpeg test binary that stands in for
// the Encoder (ffmpeg_test.go) also stands in for the Decoder, dispatched by fakeFFmpeg on the presence of
// "pcm_s16le" in the command line (decodeArgs). It reads the source MP3's frame headers for its nominal length and
// writes that many seconds of silent PCM WAV, so these tests exercise DecodeToWAV's own chain-of-custody and error
// handling without a real decoder.

// writeMP3Fixture writes count silent MPEG-1 Layer III frames at 192 kbps, mono, 44.1 kHz.
func writeMP3Fixture(t *testing.T, dir, name string, count int) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, frames(192, 44100, 1, count), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func fakeFFmpegDecode(args []string, option func(name, fallback string) string) int {
	out := strings.TrimPrefix(args[len(args)-1], "file:")
	in, err := os.Open(strings.TrimPrefix(option("-i", ""), "file:"))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	info, err := measure.ReadMP3(context.Background(), in, nil)
	_ = in.Close()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	switch os.Getenv(fakeModeEnv) {
	case "fail":
		fmt.Fprintln(os.Stderr, "the fake decoder broke")
		return 3
	case "hang":
		time.Sleep(time.Minute)
		return 0
	}
	samples := make([]int16, int(info.DurationSeconds*float64(info.SampleRate))*info.Channels())
	if err := os.WriteFile(out, pcmWAV(info.SampleRate, info.Channels(), samples), 0o600); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	return 0
}

func TestTheFFmpegRowIsRegisteredForDecodeOnMP3OnWindows(t *testing.T) {
	entry, err := encodeport.Decoders.Lookup(encodeport.FFmpegName)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(entry.Descriptor.Modes, []string{"mp3"}) || !slices.Equal(entry.Descriptor.Platforms, []string{"windows"}) {
		t.Errorf("descriptor = %+v, want mp3 on windows", entry.Descriptor)
	}
	if got := encodeport.Decoders.Names("windows"); !slices.Equal(got, []string{"ffmpeg"}) {
		t.Errorf("Decoders.Names(windows) = %v, want [ffmpeg]", got)
	}
	for _, platform := range []string{"darwin", "linux"} {
		if got := encodeport.Decoders.Names(platform); len(got) != 0 {
			t.Errorf("Decoders.Names(%s) = %v, want none: the catalogued build is a Windows executable", platform, got)
		}
	}
}

func TestDecodingAnMP3WritesAWAVTheAppsOwnReaderAccepts(t *testing.T) {
	dir := t.TempDir()
	src := writeMP3Fixture(t, dir, "chapter.mp3", 50)
	dst := filepath.Join(dir, "chapter.wav")
	decoder := encodeport.NewFFmpeg(fakeExecutable(t), nil)
	if err := decoder.DecodeToWAV(context.Background(), src, dst); err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(dst)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = file.Close() }()
	if _, err := measure.NewWAVReader(file); err != nil {
		t.Errorf("the app's own WAV reader refused the decoded file: %v", err)
	}
	assertOnly(t, dir, "chapter.mp3", "chapter.wav")
}

func TestDecodeRefusesADestinationThatIsTheSource(t *testing.T) {
	dir := t.TempDir()
	src := writeMP3Fixture(t, dir, "chapter.mp3", 10)
	decoder := encodeport.NewFFmpeg(fakeExecutable(t), nil)
	if err := decoder.DecodeToWAV(context.Background(), src, src); !errors.Is(err, encodeport.ErrSameFile) {
		t.Errorf("err = %v, want ErrSameFile", err)
	}
}

func TestDecodeRefusesAnExistingDestination(t *testing.T) {
	dir := t.TempDir()
	src := writeMP3Fixture(t, dir, "chapter.mp3", 10)
	dst := filepath.Join(dir, "chapter.wav")
	if err := os.WriteFile(dst, []byte("already here"), 0o600); err != nil {
		t.Fatal(err)
	}
	decoder := encodeport.NewFFmpeg(fakeExecutable(t), nil)
	if err := decoder.DecodeToWAV(context.Background(), src, dst); !errors.Is(err, encodeport.ErrDestinationExists) {
		t.Errorf("err = %v, want ErrDestinationExists", err)
	}
}

func TestAFailedDecodeLeavesNothingAndSaysWhatFFmpegSaid(t *testing.T) {
	dir := t.TempDir()
	src := writeMP3Fixture(t, dir, "chapter.mp3", 10)
	t.Setenv(fakeModeEnv, "fail")
	err := encodeport.NewFFmpeg(fakeExecutable(t), nil).DecodeToWAV(context.Background(), src, filepath.Join(dir, "chapter.wav"))
	if err == nil || !strings.Contains(err.Error(), "exit code 3") || !strings.Contains(err.Error(), "the fake decoder broke") {
		t.Errorf("err = %v, want the exit code and FFmpeg's own stderr", err)
	}
	assertOnly(t, dir, "chapter.mp3")
}

func TestCancellingMidDecodeLeavesNoFileAtTheDestinationAndNoPartialBesideIt(t *testing.T) {
	dir := t.TempDir()
	src := writeMP3Fixture(t, dir, "chapter.mp3", 10)
	dst := filepath.Join(dir, "chapter.wav")
	record := filepath.Join(dir, "args.txt")
	t.Setenv(fakeArgsEnv, record)
	t.Setenv(fakeModeEnv, "hang")
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- encodeport.NewFFmpeg(fakeExecutable(t), nil).DecodeToWAV(ctx, src, dst) }()

	deadline := time.After(10 * time.Second)
	for {
		if _, err := os.Stat(record); err == nil {
			break
		}
		select {
		case <-deadline:
			t.Fatal("the fake FFmpeg never started")
		case <-time.After(10 * time.Millisecond):
		}
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Errorf("DecodeToWAV after cancel = %v, want context.Canceled", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("DecodeToWAV did not return after its context was cancelled")
	}
	assertOnly(t, dir, "chapter.mp3", "args.txt")
}

// pcmWAV builds a minimal RIFF/WAVE header around 16-bit PCM samples, with no test dependency.
func pcmWAV(rate, channels int, samples []int16) []byte {
	dataLen := len(samples) * 2
	blockAlign := channels * 2
	byteRate := rate * blockAlign
	buf := make([]byte, 0, 44+dataLen)
	put32 := func(v uint32) { buf = append(buf, byte(v), byte(v>>8), byte(v>>16), byte(v>>24)) }
	put16 := func(v uint16) { buf = append(buf, byte(v), byte(v>>8)) }
	buf = append(buf, "RIFF"...)
	put32(uint32(36 + dataLen)) //nolint:gosec // G115: dataLen is bounded by test fixture sizes
	buf = append(buf, "WAVE"...)
	buf = append(buf, "fmt "...)
	put32(16)
	put16(1) // PCM
	put16(uint16(channels))
	put32(uint32(rate))
	put32(uint32(byteRate)) //nolint:gosec // G115: test fixture sizes only
	put16(uint16(blockAlign))
	put16(16)
	buf = append(buf, "data"...)
	put32(uint32(dataLen)) //nolint:gosec // G115: test fixture sizes only
	for _, s := range samples {
		put16(uint16(s))
	}
	return buf
}
