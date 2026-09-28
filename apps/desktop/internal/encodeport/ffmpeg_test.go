package encodeport_test

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/chaptertags"
	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
	"github.com/countrymanprime/narration-utils/shell/internal/encodeport"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// The test binary stands in for FFmpeg: re-run with fakeFFmpegEnv set, it reads the command line the encoder passes and writes
// silent CBR MPEG-1 Layer III frames (fakeFFmpeg). fakeModeEnv makes it fail, hang or write the wrong thing.
const (
	fakeFFmpegEnv = "ENCODEPORT_FAKE_FFMPEG"
	fakeModeEnv   = "ENCODEPORT_FAKE_FFMPEG_MODE"
	fakeArgsEnv   = "ENCODEPORT_FAKE_FFMPEG_ARGS"
	// realFFmpegEnv names a real FFmpeg executable for TestTheRealFFmpegWritesMP3sTheACXChecksAccept (the catalogued ffmpeg.exe on
	// Windows, or any build with libmp3lame); unset, that test is skipped.
	realFFmpegEnv = "NARRATION_UTILS_FFMPEG"
)

func TestMain(m *testing.M) {
	if os.Getenv(fakeFFmpegEnv) == "1" {
		os.Exit(fakeFFmpeg(os.Args[1:]))
	}
	exe, err := os.Executable()
	if err != nil {
		panic(err)
	}
	// The registered row runs the fake unless a test says otherwise, so the conformance suite runs its real code path.
	_ = os.Setenv(fakeFFmpegEnv, "1")
	encodeport.UseFFmpeg(func() (string, error) { return exe, nil }, nil)
	os.Exit(m.Run())
}

func fakeExecutable(t *testing.T) encodeport.Locator {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	return func() (string, error) { return exe, nil }
}

func TestTheFFmpegRowIsRegisteredForMP3M4BAndFlacOnWindows(t *testing.T) {
	entry, err := encodeport.Encoders.Lookup(encodeport.FFmpegName)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(entry.Descriptor.Modes, []string{"mp3", "m4b", "flac"}) || !slices.Equal(entry.Descriptor.Platforms, []string{"windows"}) {
		t.Errorf("descriptor = %+v, want mp3, m4b and flac on windows", entry.Descriptor)
	}
	if got := encodeport.Encoders.Names("windows"); !slices.Equal(got, []string{"ffmpeg"}) {
		t.Errorf("Encoders.Names(windows) = %v, want [ffmpeg]", got)
	}
	for _, platform := range []string{"darwin", "linux"} {
		if got := encodeport.Encoders.Names(platform); len(got) != 0 {
			t.Errorf("Encoders.Names(%s) = %v, want none: the catalogued build is a Windows executable", platform, got)
		}
	}
}

func TestEncodingAFixtureWAVWritesAnMP3TheACXFormatAndSampleRateRulesAccept(t *testing.T) {
	dir := t.TempDir()
	wav := writeWAV(t, dir, "chapter.wav", 44100, 1, 3*time.Second)
	dst := filepath.Join(dir, "chapter.mp3")
	encoder := encodeport.NewFFmpeg(fakeExecutable(t), nil)
	if err := encoder.Encode(context.Background(), wav, dst, encodeport.Spec{Format: "mp3", SampleRateHz: 44100}); err != nil {
		t.Fatal(err)
	}
	assertACXAccepts(t, dst, 192)
}

func TestTheEncoderAsksFFmpegForCBRLAMEWithNoTagFrameAndNoMetadata(t *testing.T) {
	dir := t.TempDir()
	wav := writeWAV(t, dir, "chapter.wav", 48000, 2, time.Second)
	record := filepath.Join(dir, "args.txt")
	t.Setenv(fakeArgsEnv, record)
	err := encodeport.NewFFmpeg(fakeExecutable(t), nil).
		Encode(context.Background(), wav, filepath.Join(dir, "out.mp3"), encodeport.Spec{Format: "mp3", BitrateKbps: 256, SampleRateHz: 44100, Channels: 1})
	if err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(record)
	if err != nil {
		t.Fatal(err)
	}
	args := strings.Join(strings.Split(strings.TrimSpace(string(body)), "\n"), " ")
	for _, want := range []string{
		"-nostdin", "-protocol_whitelist file", "-i file:" + wav, "-map 0:a:0", "-map_metadata -1", "-c:a libmp3lame", "-b:a 256k", "-ar 44100", "-ac 1",
		"-write_xing 0", "-id3v2_version 0", "-f mp3", "-progress pipe:1",
	} {
		if !strings.Contains(args, want) {
			t.Errorf("the command line %q lacks %q", args, want)
		}
	}
	if strings.Contains(args, "-q:a") || strings.Contains(args, "-abr") {
		t.Errorf("the command line %q asks for a variable bitrate", args)
	}
}

func TestProgressRisesToTheWAVsLengthAndNeverPassesIt(t *testing.T) {
	dir := t.TempDir()
	wav := writeWAV(t, dir, "chapter.wav", 44100, 1, 2*time.Second)
	var mu sync.Mutex
	var reports [][2]time.Duration
	spec := encodeport.Spec{Format: "mp3", Progress: func(done, total time.Duration) {
		mu.Lock()
		defer mu.Unlock()
		reports = append(reports, [2]time.Duration{done, total})
	}}
	if err := encodeport.NewFFmpeg(fakeExecutable(t), nil).Encode(context.Background(), wav, filepath.Join(dir, "out.mp3"), spec); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(reports) < 2 {
		t.Fatalf("progress was reported %d time(s), want a report per FFmpeg progress block and a last one", len(reports))
	}
	last := reports[len(reports)-1]
	if last[0] != last[1] || last[1] < 1900*time.Millisecond || last[1] > 2100*time.Millisecond {
		t.Errorf("the last report = %v, want done == total == about 2 s", last)
	}
	for i, r := range reports {
		if r[0] > r[1] || (i > 0 && r[0] < reports[i-1][0]) {
			t.Errorf("report %d = %v after %v: done must rise and stay within total", i, r, reports[max(i-1, 0)])
		}
	}
}

func TestCancellingMidEncodeLeavesNoFileAtTheDestinationAndNoPartialBesideIt(t *testing.T) {
	dir := t.TempDir()
	wav := writeWAV(t, dir, "chapter.wav", 44100, 1, time.Second)
	dst := filepath.Join(dir, "chapter.mp3")
	t.Setenv(fakeModeEnv, "hang")
	ctx, cancel := context.WithCancel(context.Background())
	started := make(chan struct{})
	var once sync.Once
	spec := encodeport.Spec{Format: "mp3", Progress: func(time.Duration, time.Duration) { once.Do(func() { close(started) }) }}
	done := make(chan error, 1)
	go func() { done <- encodeport.NewFFmpeg(fakeExecutable(t), nil).Encode(ctx, wav, dst, spec) }()
	select {
	case <-started:
	case <-time.After(10 * time.Second):
		t.Fatal("the fake FFmpeg never reported progress")
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Errorf("Encode after cancel = %v, want context.Canceled", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("Encode did not return after its context was cancelled")
	}
	assertOnly(t, dir, "chapter.wav")
}

func TestAFailedEncodeLeavesNothingAndSaysWhatFFmpegSaid(t *testing.T) {
	dir := t.TempDir()
	wav := writeWAV(t, dir, "chapter.wav", 44100, 1, time.Second)
	t.Setenv(fakeModeEnv, "fail")
	err := encodeport.NewFFmpeg(fakeExecutable(t), nil).Encode(context.Background(), wav, filepath.Join(dir, "chapter.mp3"), encodeport.Spec{Format: "mp3"})
	if err == nil || !strings.Contains(err.Error(), "exit code 3") || !strings.Contains(err.Error(), "the fake encoder broke") {
		t.Errorf("Encode = %v, want FFmpeg's exit code and its message", err)
	}
	assertOnly(t, dir, "chapter.wav")
}

func TestAnMP3ThatIsNotTheCBRAskedForIsRefusedAndRemoved(t *testing.T) {
	for _, mode := range []string{"vbr", "garbage"} {
		t.Run(mode, func(t *testing.T) {
			dir := t.TempDir()
			wav := writeWAV(t, dir, "chapter.wav", 44100, 1, time.Second)
			t.Setenv(fakeModeEnv, mode)
			err := encodeport.NewFFmpeg(fakeExecutable(t), nil).Encode(context.Background(), wav, filepath.Join(dir, "chapter.mp3"), encodeport.Spec{Format: "mp3"})
			if err == nil {
				t.Fatal("Encode accepted an MP3 that is not 192 kbps CBR")
			}
			assertOnly(t, dir, "chapter.wav")
		})
	}
}

func TestTheSourceIsNeverTheDestination(t *testing.T) {
	dir := t.TempDir()
	wav := writeWAV(t, dir, "chapter.wav", 44100, 1, time.Second)
	before, err := os.ReadFile(wav)
	if err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "link.wav")
	if err := os.Link(wav, link); err != nil {
		t.Fatal(err)
	}
	encoder := encodeport.NewFFmpeg(fakeExecutable(t), nil)
	for name, dst := range map[string]string{
		"the same path":         wav,
		"another spelling":      filepath.Join(dir, ".", "sub", "..", "chapter.wav"),
		"a hard link to it":     link,
		"a relative path to it": relative(t, wav),
	} {
		err := encoder.Encode(context.Background(), wav, dst, encodeport.Spec{Format: "mp3"})
		if !errors.Is(err, encodeport.ErrSameFile) {
			t.Errorf("%s: Encode = %v, want ErrSameFile", name, err)
		}
	}
	if after, _ := os.ReadFile(wav); !bytes.Equal(after, before) {
		t.Error("the WAV changed")
	}
	assertOnly(t, dir, "chapter.wav", "link.wav")
}

func TestPathsThatLookLikeOptionsOrURLsReachFFmpegAsAbsoluteFiles(t *testing.T) {
	dir := t.TempDir()
	t.Chdir(dir)
	if err := os.Mkdir("-y", 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir("http:", 0o755); err != nil {
		t.Skip("this file system has no folder called http:")
	}
	writeWAV(t, "http:", "-chapter.wav", 44100, 1, time.Second)
	record := filepath.Join(dir, "args.txt")
	t.Setenv(fakeArgsEnv, record)
	if err := encodeport.NewFFmpeg(fakeExecutable(t), nil).Encode(context.Background(), "http:/-chapter.wav", "-y/-out.mp3", encodeport.Spec{Format: "mp3"}); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(record)
	if err != nil {
		t.Fatal(err)
	}
	args := strings.Split(strings.TrimSpace(string(body)), "\n")
	input, output := args[slices.Index(args, "-i")+1], args[len(args)-1]
	for _, path := range []string{input, output} {
		if !strings.HasPrefix(path, "file:") || !filepath.IsAbs(strings.TrimPrefix(path, "file:")) {
			t.Errorf("FFmpeg was given %q, want an absolute path through the file protocol", path)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, "-y", "-out.mp3")); err != nil {
		t.Errorf("the MP3 is not where it was asked for: %v", err)
	}
}

func TestAnEncodeNeverReplacesAFileAlreadyAtTheDestination(t *testing.T) {
	dir := t.TempDir()
	wav := writeWAV(t, dir, "chapter.wav", 44100, 1, time.Second)
	dst := filepath.Join(dir, "chapter.mp3")
	if err := os.WriteFile(dst, []byte("an earlier delivery"), 0o600); err != nil {
		t.Fatal(err)
	}
	err := encodeport.NewFFmpeg(fakeExecutable(t), nil).Encode(context.Background(), wav, dst, encodeport.Spec{Format: "mp3"})
	if !errors.Is(err, encodeport.ErrDestinationExists) {
		t.Errorf("Encode = %v, want ErrDestinationExists", err)
	}
	if got, _ := os.ReadFile(dst); string(got) != "an earlier delivery" {
		t.Errorf("the file at dst is now %q", got)
	}
}

func TestASpecNoMP3CanHaveIsRefusedBeforeFFmpegRuns(t *testing.T) {
	dir := t.TempDir()
	wav := writeWAV(t, dir, "chapter.wav", 44100, 1, time.Second)
	never := func() (string, error) { t.Error("FFmpeg was located for a spec it cannot write"); return "", nil }
	for name, spec := range map[string]encodeport.Spec{
		"a bitrate MP3 lacks": {Format: "mp3", BitrateKbps: 190},
		"a sample rate":       {Format: "mp3", SampleRateHz: 96000},
		"three channels":      {Format: "mp3", Channels: 3},
	} {
		if err := encodeport.NewFFmpeg(never, nil).Encode(context.Background(), wav, filepath.Join(dir, "out.mp3"), spec); err == nil {
			t.Errorf("%s: Encode accepted %+v", name, spec)
		}
	}
	assertOnly(t, dir, "chapter.wav")
}

// The M4B/AAC tests below are render-encode-master Phase 2: fakeFFmpeg's m4b branch (further down this file) stands in for
// FFmpeg's own "ipod" muxer, writing a minimal but structurally real chapter track (the same tref/chap-and-text-track shape a
// real FFmpeg writes, verified against imageio-ffmpeg's Linux build of the pinned wheel family) so encodeport.ReadM4BChapters
// reads it back the same way it would a real encode's output.

func TestEncodingWithNoChaptersWritesAPlainM4BWithNoChapterTrack(t *testing.T) {
	dir := t.TempDir()
	wav := writeWAV(t, dir, "book.wav", 44100, 1, time.Second)
	dst := filepath.Join(dir, "book.m4b")
	if err := encodeport.NewFFmpeg(fakeExecutable(t), nil).Encode(context.Background(), wav, dst, encodeport.Spec{Format: "m4b"}); err != nil {
		t.Fatal(err)
	}
	chapters, err := encodeport.ReadM4BChapters(dst)
	if err != nil {
		t.Fatal(err)
	}
	if len(chapters) != 0 {
		t.Errorf("ReadM4BChapters = %v, want none: no chapters were asked for", chapters)
	}
}

func TestM4BChapterBoundariesMatchTheSamePerFileDurationsChaptertagsComputes(t *testing.T) {
	// Phase 2's own test (the PRD's phase table): the fixture set is chaptertags' own testdata, and its timeline is
	// chaptertags.BuildTimeline's real output, cross-checked against ReadM4BChapters rather than re-derived here.
	fixtures := []chaptertags.Chapter{
		{Title: "Chapter 1", Path: filepath.Join("..", "chaptertags", "testdata", "chapter1.mp3")},
		{Title: "Chapter 2", Path: filepath.Join("..", "chaptertags", "testdata", "chapter2.mp3")},
	}
	timeline, err := chaptertags.BuildTimeline(fixtures)
	if err != nil {
		t.Fatal(err)
	}
	chapters := make([]encodeport.Chapter, len(timeline))
	for i, c := range timeline {
		chapters[i] = encodeport.Chapter{Title: c.Title, Start: c.Start, End: c.End}
	}

	dir := t.TempDir()
	wav := writeWAV(t, dir, "book.wav", 44100, 1, timeline[len(timeline)-1].End)
	dst := filepath.Join(dir, "book.m4b")
	spec := encodeport.Spec{Format: "m4b", Chapters: chapters}
	if err := encodeport.NewFFmpeg(fakeExecutable(t), nil).Encode(context.Background(), wav, dst, spec); err != nil {
		t.Fatal(err)
	}

	got, err := encodeport.ReadM4BChapters(dst)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != len(timeline) {
		t.Fatalf("ReadM4BChapters read back %d chapter(s), want %d", len(got), len(timeline))
	}
	for i, want := range timeline {
		if d := absDuration(got[i].Start - want.Start); d > time.Millisecond {
			t.Errorf("chapter %d starts at %v, chaptertags computes %v", i+1, got[i].Start, want.Start)
		}
		if d := absDuration(got[i].End - want.End); d > time.Millisecond {
			t.Errorf("chapter %d ends at %v, chaptertags computes %v", i+1, got[i].End, want.End)
		}
	}
}

func TestTheEncoderAsksFFmpegForNativeAACAndTheIpodMuxerWithChaptersFromASecondFFMETADATAInput(t *testing.T) {
	dir := t.TempDir()
	wav := writeWAV(t, dir, "book.wav", 48000, 2, time.Second)
	record := filepath.Join(dir, "args.txt")
	t.Setenv(fakeArgsEnv, record)
	spec := encodeport.Spec{
		Format: "m4b", BitrateKbps: 96, Channels: 1,
		Chapters: []encodeport.Chapter{{Title: "Chapter One", Start: 0, End: time.Second}},
	}
	if err := encodeport.NewFFmpeg(fakeExecutable(t), nil).Encode(context.Background(), wav, filepath.Join(dir, "out.m4b"), spec); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(record)
	if err != nil {
		t.Fatal(err)
	}
	args := strings.Join(strings.Split(strings.TrimSpace(string(body)), "\n"), " ")
	for _, want := range []string{
		"-nostdin", "-protocol_whitelist file", "-i file:" + wav, "-f ffmetadata", "-map_metadata 1",
		"-map 0:a:0", "-c:a aac", "-b:a 96k", "-ac 1", "-f ipod", "-progress pipe:1",
	} {
		if !strings.Contains(args, want) {
			t.Errorf("the command line %q lacks %q", args, want)
		}
	}
	if strings.Contains(args, "-c:a libmp3lame") || strings.Contains(args, "-write_xing") {
		t.Errorf("the command line %q asks for MP3, not AAC", args)
	}
}

func TestAnM4BWithAMalformedChapterIsRefusedBeforeFFmpegRuns(t *testing.T) {
	dir := t.TempDir()
	wav := writeWAV(t, dir, "book.wav", 44100, 1, time.Second)
	never := func() (string, error) {
		t.Error("FFmpeg was located for a chapter list it cannot write")
		return "", nil
	}
	for name, chapters := range map[string][]encodeport.Chapter{
		"an empty title":          {{Title: "  ", Start: 0, End: time.Second}},
		"an end before its start": {{Title: "Chapter One", Start: time.Second, End: 0}},
		"a negative start":        {{Title: "Chapter One", Start: -time.Second, End: 0}},
	} {
		spec := encodeport.Spec{Format: "m4b", Chapters: chapters}
		if err := encodeport.NewFFmpeg(never, nil).Encode(context.Background(), wav, filepath.Join(dir, "out.m4b"), spec); err == nil {
			t.Errorf("%s: Encode accepted %+v", name, chapters)
		}
	}
	assertOnly(t, dir, "book.wav")
}

func TestCancellingMidM4BEncodeLeavesNoFileAtTheDestinationAndNoPartialBesideIt(t *testing.T) {
	dir := t.TempDir()
	wav := writeWAV(t, dir, "book.wav", 44100, 1, time.Second)
	dst := filepath.Join(dir, "book.m4b")
	t.Setenv(fakeModeEnv, "hang")
	ctx, cancel := context.WithCancel(context.Background())
	started := make(chan struct{})
	var once sync.Once
	spec := encodeport.Spec{
		Format: "m4b", Chapters: []encodeport.Chapter{{Title: "Chapter One", Start: 0, End: time.Second}},
		Progress: func(time.Duration, time.Duration) { once.Do(func() { close(started) }) },
	}
	done := make(chan error, 1)
	go func() { done <- encodeport.NewFFmpeg(fakeExecutable(t), nil).Encode(ctx, wav, dst, spec) }()
	select {
	case <-started:
	case <-time.After(10 * time.Second):
		t.Fatal("the fake FFmpeg never reported progress")
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Errorf("Encode after cancel = %v, want context.Canceled", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("Encode did not return after its context was cancelled")
	}
	assertOnly(t, dir, "book.wav")
}

func TestAnM4BWhoseChaptersDoNotMatchWhatWasAskedIsRefusedAndRemoved(t *testing.T) {
	dir := t.TempDir()
	wav := writeWAV(t, dir, "book.wav", 44100, 1, time.Second)
	t.Setenv(fakeModeEnv, "wrongchapters")
	spec := encodeport.Spec{Format: "m4b", Chapters: []encodeport.Chapter{{Title: "Chapter One", Start: 0, End: time.Second}}}
	err := encodeport.NewFFmpeg(fakeExecutable(t), nil).Encode(context.Background(), wav, filepath.Join(dir, "book.m4b"), spec)
	if err == nil {
		t.Fatal("Encode accepted an M4B whose written chapters do not match its Spec")
	}
	assertOnly(t, dir, "book.wav")
}

// The FLAC tests below are render-encode-master Phase 7 (Could, Q7): fakeFFmpeg's flac branch (further down this file) stands
// in for FFmpeg's own native "flac" encoder, writing a well-formed STREAMINFO block from the source WAV's own exact frame
// count (via WAVReader.Skip, not an estimate) so checkFLAC reads it back the same way it would a real encode's output.

func TestEncodingAFixtureWAVWritesAFLACAtTheSourcesSampleRateAndChannels(t *testing.T) {
	dir := t.TempDir()
	wav := writeWAV(t, dir, "book.wav", 48000, 2, 3*time.Second)
	dst := filepath.Join(dir, "book.flac")
	if err := encodeport.NewFFmpeg(fakeExecutable(t), nil).Encode(context.Background(), wav, dst, encodeport.Spec{Format: "flac"}); err != nil {
		t.Fatal(err)
	}
	if info, err := os.Stat(dst); err != nil || info.Size() == 0 {
		t.Fatalf("Stat(%s) = %v, %v, want a non-empty file", dst, info, err)
	}
}

func TestTheEncoderAsksFFmpegForNativeFLACWithNoBitrate(t *testing.T) {
	dir := t.TempDir()
	wav := writeWAV(t, dir, "book.wav", 48000, 2, time.Second)
	record := filepath.Join(dir, "args.txt")
	t.Setenv(fakeArgsEnv, record)
	spec := encodeport.Spec{Format: "flac", SampleRateHz: 44100, Channels: 1}
	if err := encodeport.NewFFmpeg(fakeExecutable(t), nil).Encode(context.Background(), wav, filepath.Join(dir, "out.flac"), spec); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(record)
	if err != nil {
		t.Fatal(err)
	}
	args := strings.Join(strings.Split(strings.TrimSpace(string(body)), "\n"), " ")
	for _, want := range []string{
		"-nostdin", "-protocol_whitelist file", "-i file:" + wav, "-map 0:a:0", "-map_metadata -1",
		"-c:a flac", "-ar 44100", "-ac 1", "-f flac", "-progress pipe:1",
	} {
		if !strings.Contains(args, want) {
			t.Errorf("the command line %q lacks %q", args, want)
		}
	}
	if strings.Contains(args, "-b:a") {
		t.Errorf("the command line %q asks for a bitrate, which has no meaning for lossless FLAC", args)
	}
}

func TestEncodingAFLACWithNoSampleRateOrChannelsAskedKeepsTheWAVsOwn(t *testing.T) {
	dir := t.TempDir()
	wav := writeWAV(t, dir, "book.wav", 48000, 2, time.Second)
	record := filepath.Join(dir, "args.txt")
	t.Setenv(fakeArgsEnv, record)
	dst := filepath.Join(dir, "out.flac")
	if err := encodeport.NewFFmpeg(fakeExecutable(t), nil).Encode(context.Background(), wav, dst, encodeport.Spec{Format: "flac"}); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(record)
	if err != nil {
		t.Fatal(err)
	}
	args := string(body)
	if strings.Contains(args, "-ar") || strings.Contains(args, "-ac") {
		t.Errorf("the command line %q forces a rate or channel count the spec left open", args)
	}
}

func TestProgressRisesToTheWAVsLengthForFLAC(t *testing.T) {
	dir := t.TempDir()
	wav := writeWAV(t, dir, "book.wav", 44100, 1, 2*time.Second)
	var mu sync.Mutex
	var reports [][2]time.Duration
	spec := encodeport.Spec{Format: "flac", Progress: func(done, total time.Duration) {
		mu.Lock()
		defer mu.Unlock()
		reports = append(reports, [2]time.Duration{done, total})
	}}
	if err := encodeport.NewFFmpeg(fakeExecutable(t), nil).Encode(context.Background(), wav, filepath.Join(dir, "out.flac"), spec); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(reports) < 2 {
		t.Fatalf("progress was reported %d time(s), want a report per FFmpeg progress block and a last one", len(reports))
	}
	last := reports[len(reports)-1]
	if last[0] != last[1] || last[1] < 1900*time.Millisecond || last[1] > 2100*time.Millisecond {
		t.Errorf("the last report = %v, want done == total == about 2 s", last)
	}
}

func TestCancellingMidFLACEncodeLeavesNoFileAtTheDestinationAndNoPartialBesideIt(t *testing.T) {
	dir := t.TempDir()
	wav := writeWAV(t, dir, "book.wav", 44100, 1, time.Second)
	dst := filepath.Join(dir, "book.flac")
	t.Setenv(fakeModeEnv, "hang")
	ctx, cancel := context.WithCancel(context.Background())
	started := make(chan struct{})
	var once sync.Once
	spec := encodeport.Spec{Format: "flac", Progress: func(time.Duration, time.Duration) { once.Do(func() { close(started) }) }}
	done := make(chan error, 1)
	go func() { done <- encodeport.NewFFmpeg(fakeExecutable(t), nil).Encode(ctx, wav, dst, spec) }()
	select {
	case <-started:
	case <-time.After(10 * time.Second):
		t.Fatal("the fake FFmpeg never reported progress")
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Errorf("Encode after cancel = %v, want context.Canceled", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("Encode did not return after its context was cancelled")
	}
	assertOnly(t, dir, "book.wav")
}

func TestAFLACWhoseStreamInfoDoesNotMatchWhatWasAskedIsRefusedAndRemoved(t *testing.T) {
	dir := t.TempDir()
	wav := writeWAV(t, dir, "book.wav", 44100, 1, time.Second)
	t.Setenv(fakeModeEnv, "wrongflac")
	spec := encodeport.Spec{Format: "flac", Channels: 1}
	err := encodeport.NewFFmpeg(fakeExecutable(t), nil).Encode(context.Background(), wav, filepath.Join(dir, "book.flac"), spec)
	if err == nil {
		t.Fatal("Encode accepted a FLAC whose written STREAMINFO does not match its Spec")
	}
	assertOnly(t, dir, "book.wav")
}

func TestAFileThatIsNotFLACIsRefusedAndRemoved(t *testing.T) {
	dir := t.TempDir()
	wav := writeWAV(t, dir, "book.wav", 44100, 1, time.Second)
	t.Setenv(fakeModeEnv, "garbage")
	err := encodeport.NewFFmpeg(fakeExecutable(t), nil).Encode(context.Background(), wav, filepath.Join(dir, "book.flac"), encodeport.Spec{Format: "flac"})
	if err == nil {
		t.Fatal("Encode accepted a file with no FLAC marker")
	}
	assertOnly(t, dir, "book.wav")
}

func TestASpecNoFLACCanHaveIsRefusedBeforeFFmpegRuns(t *testing.T) {
	dir := t.TempDir()
	wav := writeWAV(t, dir, "book.wav", 44100, 1, time.Second)
	never := func() (string, error) { t.Error("FFmpeg was located for a spec it cannot write"); return "", nil }
	for name, spec := range map[string]encodeport.Spec{
		"a bitrate, which is meaningless for lossless FLAC": {Format: "flac", BitrateKbps: 192},
		"three channels":  {Format: "flac", Channels: 3},
		"a negative rate": {Format: "flac", SampleRateHz: -1},
	} {
		if err := encodeport.NewFFmpeg(never, nil).Encode(context.Background(), wav, filepath.Join(dir, "out.flac"), spec); err == nil {
			t.Errorf("%s: Encode accepted %+v", name, spec)
		}
	}
	assertOnly(t, dir, "book.wav")
}

// TestTheRealFFmpegRoundTripsFLACLosslessly is Phase 7's own verification as a test, alongside Phase 0's and Phase 2's: run it
// with NARRATION_UTILS_FFMPEG set to the catalogued ffmpeg.exe (or any FFmpeg with a native "flac" encoder) to prove the real
// binary's FLAC output decodes back to the exact PCM samples it was given - the PRD's own "FLAC round-trips" test, run against
// this encoder's own fixture rather than a platform profile that does not exist yet (Q7's recommendation is v1 has none).
func TestTheRealFFmpegRoundTripsFLACLosslessly(t *testing.T) {
	executable := os.Getenv(realFFmpegEnv)
	if executable == "" {
		t.Skipf("set %s to an FFmpeg executable to run the real encode", realFFmpegEnv)
	}
	t.Setenv(fakeFFmpegEnv, "")
	locate := func() (string, error) { return executable, nil }

	dir := t.TempDir()
	wav := writeTone(t, dir, 48000, 2, 3*time.Second)
	flacPath := filepath.Join(dir, "book.flac")
	if err := encodeport.NewFFmpeg(locate, nil).Encode(context.Background(), wav, flacPath, encodeport.Spec{Format: "flac"}); err != nil {
		t.Fatal(err)
	}

	decoded := filepath.Join(dir, "decoded.wav")
	cmd := exec.Command(executable, "-hide_banner", "-nostdin", "-nostats", "-loglevel", "error", "-y",
		"-i", flacPath, "-c:a", "pcm_s16le", "-f", "wav", decoded)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("decoding the FLAC back with FFmpeg: %v: %s", err, out)
	}

	source := readAllSamples(t, wav)
	roundTripped := readAllSamples(t, decoded)
	if len(source) != len(roundTripped) {
		t.Fatalf("the round trip has %d frame(s), the source %d", len(roundTripped), len(source))
	}
	for i := range source {
		for c := range source[i] {
			if source[i][c] != roundTripped[i][c] {
				t.Fatalf("frame %d channel %d = %v after the round trip, source was %v: FLAC did not encode losslessly", i, c, roundTripped[i][c], source[i][c])
			}
		}
	}
}

// readAllSamples decodes path (a 16-bit PCM WAV) in full, for TestTheRealFFmpegRoundTripsFLACLosslessly's exact comparison.
func readAllSamples(t *testing.T, path string) [][]float64 {
	t.Helper()
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = file.Close() }()
	reader, err := measure.NewWAVReader(file)
	if err != nil {
		t.Fatal(err)
	}
	var frames [][]float64
	for {
		block, err := reader.Read(4096)
		if len(block) > 0 {
			channels := len(block)
			for i := range block[0] {
				frame := make([]float64, channels)
				for c := range block {
					frame[c] = block[c][i]
				}
				frames = append(frames, frame)
			}
		}
		if err != nil {
			break
		}
	}
	return frames
}

func TestAFileThatIsNotAWAVIsRefused(t *testing.T) {
	dir := t.TempDir()
	notWAV := filepath.Join(dir, "chapter.wav")
	if err := os.WriteFile(notWAV, []byte("ID3 not a wave"), 0o600); err != nil {
		t.Fatal(err)
	}
	err := encodeport.NewFFmpeg(fakeExecutable(t), nil).Encode(context.Background(), notWAV, filepath.Join(dir, "out.mp3"), encodeport.Spec{Format: "mp3"})
	if !errors.Is(err, measure.ErrNotWAV) {
		t.Errorf("Encode = %v, want measure.ErrNotWAV", err)
	}
	assertOnly(t, dir, "chapter.wav")
}

func TestWithNoFFmpegInstalledTheEncoderSaysSoAndWritesNothing(t *testing.T) {
	dir := t.TempDir()
	wav := writeWAV(t, dir, "chapter.wav", 44100, 1, time.Second)
	missing := func() (string, error) { return "", encodeport.ErrEncoderNotInstalled }
	err := encodeport.NewFFmpeg(missing, nil).Encode(context.Background(), wav, filepath.Join(dir, "out.mp3"), encodeport.Spec{Format: "mp3"})
	if !errors.Is(err, encodeport.ErrEncoderNotInstalled) {
		t.Errorf("Encode = %v, want ErrEncoderNotInstalled", err)
	}
	assertOnly(t, dir, "chapter.wav")
}

// TestTheRealFFmpegWritesMP3sTheACXChecksAccept is Phase 0's verification as a test: run it with NARRATION_UTILS_FFMPEG set to
// the catalogued ffmpeg.exe (or any FFmpeg with libmp3lame) to prove the real binary's output against the app's own checks.
func TestTheRealFFmpegWritesMP3sTheACXChecksAccept(t *testing.T) {
	executable := os.Getenv(realFFmpegEnv)
	if executable == "" {
		t.Skipf("set %s to an FFmpeg executable to run the real encode", realFFmpegEnv)
	}
	t.Setenv(fakeFFmpegEnv, "")
	locate := func() (string, error) { return executable, nil }
	for _, source := range []struct {
		rate, channels int
	}{{44100, 1}, {48000, 2}} {
		for _, bitrate := range []int{192, 256, 320} {
			t.Run(fmt.Sprintf("%d Hz %d ch %d kbps", source.rate, source.channels, bitrate), func(t *testing.T) {
				dir := t.TempDir()
				wav := writeTone(t, dir, source.rate, source.channels, 3*time.Second)
				dst := filepath.Join(dir, "chapter.mp3")
				spec := encodeport.Spec{Format: "mp3", BitrateKbps: bitrate, SampleRateHz: 44100}
				if err := encodeport.NewFFmpeg(locate, nil).Encode(context.Background(), wav, dst, spec); err != nil {
					t.Fatal(err)
				}
				assertACXAccepts(t, dst, bitrate)
			})
		}
	}
	t.Run("16000 Hz with the rate left open", func(t *testing.T) {
		dir := t.TempDir()
		wav := writeTone(t, dir, 16000, 1, 3*time.Second)
		dst := filepath.Join(dir, "chapter.mp3")
		if err := encodeport.NewFFmpeg(locate, nil).Encode(context.Background(), wav, dst, encodeport.Spec{Format: "mp3"}); err != nil {
			t.Fatal(err)
		}
		assertACXAccepts(t, dst, encodeport.DefaultMP3BitrateKbps)
	})
}

// TestTheRealFFmpegWritesM4BsWhoseChaptersReadMBack is Phase 2's own verification as a test, alongside Phase 0's: run it with
// NARRATION_UTILS_FFMPEG set to the catalogued ffmpeg.exe (or any FFmpeg with a native AAC encoder and an "ipod" muxer) to
// prove the real binary's chapters, not just fakeM4B's stand-in for them, read back through ReadM4BChapters.
func TestTheRealFFmpegWritesM4BsWhoseChaptersReadMBack(t *testing.T) {
	executable := os.Getenv(realFFmpegEnv)
	if executable == "" {
		t.Skipf("set %s to an FFmpeg executable to run the real encode", realFFmpegEnv)
	}
	t.Setenv(fakeFFmpegEnv, "")
	locate := func() (string, error) { return executable, nil }

	t.Run("no chapters", func(t *testing.T) {
		dir := t.TempDir()
		wav := writeTone(t, dir, 44100, 1, time.Second)
		dst := filepath.Join(dir, "book.m4b")
		if err := encodeport.NewFFmpeg(locate, nil).Encode(context.Background(), wav, dst, encodeport.Spec{Format: "m4b"}); err != nil {
			t.Fatal(err)
		}
		got, err := encodeport.ReadM4BChapters(dst)
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != 0 {
			t.Errorf("ReadM4BChapters = %v, want none", got)
		}
	})

	t.Run("chapters", func(t *testing.T) {
		want := []encodeport.Chapter{
			{Title: "Opening Credits", Start: 0, End: time.Second},
			{Title: "Chapter One: A Test; #Two \\ Three", Start: time.Second, End: 3 * time.Second},
		}
		dir := t.TempDir()
		wav := writeTone(t, dir, 48000, 2, 3*time.Second)
		dst := filepath.Join(dir, "book.m4b")
		spec := encodeport.Spec{Format: "m4b", BitrateKbps: 96, Chapters: want}
		if err := encodeport.NewFFmpeg(locate, nil).Encode(context.Background(), wav, dst, spec); err != nil {
			t.Fatal(err)
		}
		got, err := encodeport.ReadM4BChapters(dst)
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != len(want) {
			t.Fatalf("ReadM4BChapters read back %d chapter(s), want %d", len(got), len(want))
		}
		for i, w := range want {
			if d := absDuration(got[i].Start - w.Start); d > time.Millisecond {
				t.Errorf("chapter %d starts at %v, want %v", i+1, got[i].Start, w.Start)
			}
			if d := absDuration(got[i].End - w.End); d > time.Millisecond {
				t.Errorf("chapter %d ends at %v, want %v", i+1, got[i].End, w.End)
			}
		}
	})
}

// assertACXAccepts runs dst through the MP3 container check and the ACX profile's acx.format and acx.sample_rate rules, and
// through chaptertags' length reader, which must agree with the container check's length.
func assertACXAccepts(t *testing.T, dst string, bitrate int) {
	t.Helper()
	measured, err := measure.MeasureFile(context.Background(), dst, measure.Options{})
	if err != nil {
		t.Fatal(err)
	}
	info := measured.Report.MP3
	if info == nil || !info.CBR || info.BitrateKbps != bitrate || info.SampleRate != 44100 || info.LostBytes != 0 || info.VBRTag != "" || info.ID3v2Bytes != 0 {
		t.Fatalf("the MP3 container check read %+v, want %d kbps CBR at 44100 Hz, frames only", info, bitrate)
	}
	judgement := deliveryprofile.EvaluateFile(measured.Report, deliveryprofile.ACX())
	for _, id := range []string{"acx.format", "acx.sample_rate"} {
		i := slices.IndexFunc(judgement.Results, func(r deliveryprofile.Result) bool { return r.RuleID == id })
		if i < 0 || judgement.Results[i].Status != deliveryprofile.StatusMet {
			t.Errorf("%s = %+v, want met", id, judgement.Results[max(i, 0)])
		}
	}
	timeline, err := chaptertags.BuildTimeline([]chaptertags.Chapter{{Title: "Chapter", Path: dst}})
	if err != nil {
		t.Fatal(err)
	}
	container := time.Duration(info.DurationSeconds * float64(time.Second))
	if diff := timeline[0].End - container; diff > time.Microsecond || diff < -time.Microsecond {
		t.Errorf("chaptertags reads %v, the container check %v: the two MP3 readers disagree", timeline[0].End, container)
	}
}

// assertOnly fails unless dir holds exactly names: no output, and no partial file left beside it.
func assertOnly(t *testing.T, dir string, names ...string) {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, entry := range entries {
		got = append(got, entry.Name())
	}
	slices.Sort(got)
	slices.Sort(names)
	if !slices.Equal(got, names) {
		t.Errorf("the folder holds %v, want only %v", got, names)
	}
}

func relative(t *testing.T, path string) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	rel, err := filepath.Rel(wd, path)
	if err != nil {
		t.Skip("no relative path to the temporary folder on this machine")
	}
	return rel
}

// writeWAV writes length of 16-bit silence at rate and channels.
func writeWAV(t *testing.T, dir, name string, rate, channels int, length time.Duration) string {
	t.Helper()
	frames := int(length.Seconds() * float64(rate))
	return writePCM(t, filepath.Join(dir, name), rate, channels, make([]int16, frames*channels))
}

// writeTone writes length of a 220 Hz tone at -20 dBFS, for the real encoder (LAME encodes silence too, but a tone is a fairer test).
func writeTone(t *testing.T, dir string, rate, channels int, length time.Duration) string {
	t.Helper()
	frames := int(length.Seconds() * float64(rate))
	samples := make([]int16, 0, frames*channels)
	for i := range frames {
		v := int16(3277 * math.Sin(2*math.Pi*220*float64(i)/float64(rate)))
		for range channels {
			samples = append(samples, v)
		}
	}
	return writePCM(t, filepath.Join(dir, "tone.wav"), rate, channels, samples)
}

func writePCM(t *testing.T, path string, rate, channels int, samples []int16) string {
	t.Helper()
	var b bytes.Buffer
	data := len(samples) * 2
	b.WriteString("RIFF")
	_ = binary.Write(&b, binary.LittleEndian, uint32(36+data))
	b.WriteString("WAVEfmt ")
	for _, v := range []any{uint32(16), uint16(1), uint16(channels), uint32(rate), uint32(rate * channels * 2), uint16(channels * 2), uint16(16)} {
		_ = binary.Write(&b, binary.LittleEndian, v)
	}
	b.WriteString("data")
	_ = binary.Write(&b, binary.LittleEndian, uint32(data))
	_ = binary.Write(&b, binary.LittleEndian, samples)
	if err := os.WriteFile(path, b.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

// fakeFFmpeg is the stand-in FFmpeg: it reads the options the encoder passes, writes silent 44.1 kHz (or -ar) MPEG-1 Layer III
// frames at -b:a to the last argument, and prints -progress blocks. It answers its exit code.
func fakeFFmpeg(args []string) int {
	if record := os.Getenv(fakeArgsEnv); record != "" {
		_ = os.WriteFile(record, []byte(strings.Join(args, "\n")), 0o600)
	}
	option := func(name, fallback string) string {
		if i := slices.Index(args, name); i >= 0 && i+1 < len(args) {
			return args[i+1]
		}
		return fallback
	}
	if option("-c:a", "") == "pcm_s16le" {
		// The decode direction (decode_test.go): src is an MP3, not a WAV.
		return fakeFFmpegDecode(args, option)
	}
	out := strings.TrimPrefix(args[len(args)-1], "file:")
	in, err := os.Open(strings.TrimPrefix(option("-i", ""), "file:"))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	reader, err := measure.NewWAVReader(in)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	info, _ := in.Stat()
	format := reader.Format()
	// totalFrames is the source's own exact frame count (Skip discards without decoding), for fakeFLAC's STREAMINFO - unlike
	// seconds below, not an estimate from the file's byte size.
	totalFrames, _ := reader.Skip(math.MaxInt64)
	_ = in.Close()
	seconds := float64(info.Size()) / float64(format.SampleRate*format.Channels*format.BitsPerSample/8)
	switch option("-c:a", "libmp3lame") {
	case "aac":
		return fakeM4B(args, out, seconds)
	case "flac":
		return fakeFLAC(args, out, format, totalFrames, seconds)
	}
	bitrate, _ := strconv.Atoi(strings.TrimSuffix(option("-b:a", "192k"), "k"))
	rate, _ := strconv.Atoi(option("-ar", strconv.Itoa(format.SampleRate)))
	channels, _ := strconv.Atoi(option("-ac", strconv.Itoa(format.Channels)))

	switch os.Getenv(fakeModeEnv) {
	case "fail":
		_ = os.WriteFile(out, []byte("half an mp3"), 0o600)
		fmt.Fprintln(os.Stderr, "the fake encoder broke")
		return 3
	case "garbage":
		_ = os.WriteFile(out, bytes.Repeat([]byte("not audio "), 100), 0o600)
		return 0
	case "hang":
		_ = os.WriteFile(out, frames(bitrate, rate, channels, 10), 0o600)
		fmt.Printf("out_time_us=%d\nprogress=continue\n", 100000)
		time.Sleep(time.Minute)
		return 0
	case "vbr":
		body := append(frames(bitrate, rate, channels, 20), frames(128, rate, channels, 20)...)
		_ = os.WriteFile(out, body, 0o600)
		return 0
	}
	count := int(seconds*float64(rate)/1152) + 1
	for step := 1; step <= 4; step++ {
		fmt.Printf("out_time_us=%d\nprogress=continue\n", int64(seconds*1e6)*int64(step)/4)
	}
	fmt.Print("progress=end\n")
	if err := os.WriteFile(out, frames(bitrate, rate, channels, count), 0o600); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	return 0
}

// frames is count silent MPEG-1 Layer III frames (a zero body decodes as silence) at bitrate kbps and rate Hz, no padding.
func frames(bitrate, rate, channels, count int) []byte {
	bitrates := []int{0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320}
	rates := map[int]uint32{44100: 0, 48000: 1, 32000: 2}
	mode := uint32(1) // joint stereo
	if channels == 1 {
		mode = 3
	}
	header := uint32(0xFFE00000) | 3<<19 | 1<<17 | 1<<16 | uint32(slices.Index(bitrates, bitrate))<<12 | rates[rate]<<10 | mode<<6
	frame := make([]byte, 144*bitrate*1000/rate)
	binary.BigEndian.PutUint32(frame, header)
	return bytes.Repeat(frame, count)
}

func absDuration(d time.Duration) time.Duration {
	if d < 0 {
		return -d
	}
	return d
}

// fakeChapter is one [CHAPTER] section fakeM4B read from the FFMETADATA input m4bArgs gives it (encodeport/m4b.go), in the
// same milliseconds ffmetadata() writes (TIMEBASE=1/1000).
type fakeChapter struct{ startMs, endMs int64 }

// fakeM4B stands in for FFmpeg's "ipod" muxer: it writes a minimal MP4 with an audio (soun) track and, when args named an
// FFMETADATA input with any chapters, a QuickTime "chapters" text track in the tref/chap-and-stts shape
// encodeport.ReadM4BChapters reads back - the same shape a real FFmpeg 7.0.2 encode of the imageio-ffmpeg wheel family (the
// catalogued Windows build's own family, ADR 0342) was found to write, checked by hand against this reader while this phase
// was written.
func fakeM4B(args []string, out string, seconds float64) int {
	chapters := fakeM4BChaptersFromArgs(args)
	switch os.Getenv(fakeModeEnv) {
	case "fail":
		_ = os.WriteFile(out, []byte("half an m4b"), 0o600)
		fmt.Fprintln(os.Stderr, "the fake encoder broke")
		return 3
	case "hang":
		_ = os.WriteFile(out, []byte("partial m4b"), 0o600)
		fmt.Printf("out_time_us=%d\nprogress=continue\n", 100000)
		time.Sleep(time.Minute)
		return 0
	case "wrongchapters":
		// Extends every chapter's own duration, so the file's cumulative boundaries no longer match what was asked - proving
		// checkM4B reads what FFmpeg actually wrote rather than trusting the request.
		for i := range chapters {
			chapters[i].endMs += 500
		}
	}
	for step := 1; step <= 4; step++ {
		fmt.Printf("out_time_us=%d\nprogress=continue\n", int64(seconds*1e6)*int64(step)/4)
	}
	fmt.Print("progress=end\n")
	if err := os.WriteFile(out, fakeM4BBytes(chapters), 0o600); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	return 0
}

// fakeM4BChaptersFromArgs reads the chapters from the FFMETADATA file m4bArgs passed as a second input (the argument after
// the "-i" that follows "ffmetadata"), the same file a real FFmpeg would read them from. No such input (an m4b encode with no
// chapters) answers nil.
func fakeM4BChaptersFromArgs(args []string) []fakeChapter {
	idx := slices.Index(args, "ffmetadata")
	if idx < 0 {
		return nil
	}
	for i := idx; i < len(args)-1; i++ {
		if args[i] == "-i" {
			return parseFFMetadataChapters(strings.TrimPrefix(args[i+1], "file:"))
		}
	}
	return nil
}

// parseFFMetadataChapters reads an FFMETADATA1 file's [CHAPTER] sections (encodeport.ffmetadata's own format) for their
// START and END fields; a title is not needed to build the stts entries fakeM4BBytes writes.
func parseFFMetadataChapters(path string) []fakeChapter {
	body, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var chapters []fakeChapter
	var cur fakeChapter
	open := false
	for _, line := range strings.Split(string(body), "\n") {
		line = strings.TrimSpace(line)
		switch {
		case line == "[CHAPTER]":
			if open {
				chapters = append(chapters, cur)
			}
			cur, open = fakeChapter{}, true
		case strings.HasPrefix(line, "START="):
			cur.startMs, _ = strconv.ParseInt(strings.TrimPrefix(line, "START="), 10, 64)
		case strings.HasPrefix(line, "END="):
			cur.endMs, _ = strconv.ParseInt(strings.TrimPrefix(line, "END="), 10, 64)
		}
	}
	if open {
		chapters = append(chapters, cur)
	}
	return chapters
}

// fakeM4BBytes is a minimal MP4: an ftyp, then a moov with one audio (soun) trak and, when chapters is not empty, a second,
// chapter (text) trak the audio track's tref/chap names, its mdia/mdhd timescale 1000 (milliseconds) and one stts entry per
// chapter holding that chapter's duration - what encodeport.ReadM4BChapters walks back into Start/End boundaries.
func fakeM4BBytes(chapters []fakeChapter) []byte {
	tkhdAudio := make([]byte, 84) // version 0 (byte 0); track_ID at offset 12
	binary.BigEndian.PutUint32(tkhdAudio[12:16], 1)
	hdlrAudio := make([]byte, 12) // version/flags(4) + predefined(4) + handler_type(4)
	copy(hdlrAudio[8:12], "soun")

	audioChildren := [][]byte{mp4box("tkhd", tkhdAudio)}
	if len(chapters) > 0 {
		chapterTrackID := make([]byte, 4)
		binary.BigEndian.PutUint32(chapterTrackID, 2)
		audioChildren = append(audioChildren, mp4box("tref", mp4box("chap", chapterTrackID)))
	}
	audioChildren = append(audioChildren, mp4box("mdia", mp4box("hdlr", hdlrAudio)))
	trakAudio := mp4box("trak", audioChildren...)

	moovChildren := [][]byte{trakAudio}
	if len(chapters) > 0 {
		tkhdChap := make([]byte, 84)
		binary.BigEndian.PutUint32(tkhdChap[12:16], 2)
		mdhdChap := make([]byte, 24) // version/flags(4) creation(4) modification(4) timescale(4) duration(4) lang(2) pad(2)
		binary.BigEndian.PutUint32(mdhdChap[12:16], 1000)
		hdlrChap := make([]byte, 12)
		copy(hdlrChap[8:12], "text")

		var stts bytes.Buffer
		stts.Write(make([]byte, 4)) // version/flags
		entryCount := make([]byte, 4)
		binary.BigEndian.PutUint32(entryCount, uint32(len(chapters)))
		stts.Write(entryCount)
		for _, c := range chapters {
			entry := make([]byte, 8)
			binary.BigEndian.PutUint32(entry[0:4], 1) // sample_count=1: one sample (this chapter) per stts entry
			binary.BigEndian.PutUint32(entry[4:8], uint32(c.endMs-c.startMs))
			stts.Write(entry)
		}

		trakChap := mp4box("trak", mp4box("tkhd", tkhdChap), mp4box("mdia",
			mp4box("mdhd", mdhdChap), mp4box("hdlr", hdlrChap), mp4box("minf", mp4box("stbl", mp4box("stts", stts.Bytes())))))
		moovChildren = append(moovChildren, trakChap)
	}
	return append(mp4box("ftyp", []byte("M4A \x00\x00\x02\x00M4A isomiso2")), mp4box("moov", moovChildren...)...)
}

// mp4box wraps the concatenation of parts (raw bytes, or other boxes built the same way) in a box named typ.
func mp4box(typ string, parts ...[]byte) []byte {
	var payload []byte
	for _, p := range parts {
		payload = append(payload, p...)
	}
	b := make([]byte, 8, 8+len(payload))
	binary.BigEndian.PutUint32(b[0:4], uint32(8+len(payload)))
	copy(b[4:8], typ)
	return append(b, payload...)
}

// fakeFLAC stands in for FFmpeg's native "flac" encoder (render-encode-master Phase 7): it writes a minimal but well-formed
// FLAC file (the "fLaC" marker plus a single STREAMINFO metadata block) whose sample rate, channel count and total sample
// count encodeport.checkFLAC reads back, mirroring fakeM4B's own stand-in for the "ipod" muxer. format is the source WAV's
// own (measure.Format), used when args left -ar/-ac open (matching checkFLAC's own fallback), and totalFrames is the source's
// exact frame count (from WAVReader.Skip in fakeFFmpeg, not an estimate).
func fakeFLAC(args []string, out string, format measure.Format, totalFrames int64, seconds float64) int {
	option := func(name, fallback string) string {
		if i := slices.Index(args, name); i >= 0 && i+1 < len(args) {
			return args[i+1]
		}
		return fallback
	}
	rate, _ := strconv.Atoi(option("-ar", strconv.Itoa(format.SampleRate)))
	channels, _ := strconv.Atoi(option("-ac", strconv.Itoa(format.Channels)))

	switch os.Getenv(fakeModeEnv) {
	case "fail":
		_ = os.WriteFile(out, []byte("half a flac"), 0o600)
		fmt.Fprintln(os.Stderr, "the fake encoder broke")
		return 3
	case "hang":
		_ = os.WriteFile(out, []byte("partial flac"), 0o600)
		fmt.Printf("out_time_us=%d\nprogress=continue\n", 100000)
		time.Sleep(time.Minute)
		return 0
	case "garbage":
		_ = os.WriteFile(out, bytes.Repeat([]byte("not audio "), 100), 0o600)
		return 0
	case "wrongflac":
		// Writes a channel count other than what was asked, so checkFLAC's read-back disagrees with the Spec - proving it
		// reads what FFmpeg actually wrote rather than trusting the request.
		channels = 3 - channels // 1 <-> 2
	}
	for step := 1; step <= 4; step++ {
		fmt.Printf("out_time_us=%d\nprogress=continue\n", int64(seconds*1e6)*int64(step)/4)
	}
	fmt.Print("progress=end\n")
	if err := os.WriteFile(out, fakeFLACBytes(rate, channels, format.BitsPerSample, totalFrames), 0o600); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	return 0
}

// fakeFLACBytes is a minimal FLAC stream: the "fLaC" marker, then one (last) STREAMINFO metadata block (RFC 9639 §8.1-8.2)
// with no block size/frame size bounds (left zero, meaning unknown) and the given sample rate, channel count, bit depth and
// total sample count packed the way readFLACStreamInfo (encodeport/flac.go) reads them back, followed by a few placeholder
// bytes standing in for frame data no test here reads.
func fakeFLACBytes(sampleRate, channels, bitsPerSample int, totalSamples int64) []byte {
	var b bytes.Buffer
	b.WriteString("fLaC")
	b.Write([]byte{0x80, 0x00, 0x00, 34}) // last-metadata-block flag set, block type 0 (STREAMINFO), length 34
	body := make([]byte, 34)
	packed := uint64(sampleRate)<<44 | uint64(channels-1)<<41 | uint64(bitsPerSample-1)<<36 | (uint64(totalSamples) & 0xFFFFFFFFF)
	binary.BigEndian.PutUint64(body[10:18], packed)
	b.Write(body)
	b.Write(bytes.Repeat([]byte{0x00}, 8))
	return b.Bytes()
}
