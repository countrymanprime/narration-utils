package encodeport_test

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"os"
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
	"github.com/countrymanprime/narration-utils/shell/internal/port"
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

func TestTheFFmpegRowIsRegisteredForMP3OnWindows(t *testing.T) {
	entry, err := encodeport.Encoders.Lookup(encodeport.FFmpegName)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(entry.Descriptor.Modes, []string{"mp3"}) || !slices.Equal(entry.Descriptor.Platforms, []string{"windows"}) {
		t.Errorf("descriptor = %+v, want mp3 on windows", entry.Descriptor)
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
		"a bitrate MP3 lacks":  {Format: "mp3", BitrateKbps: 190},
		"a sample rate":        {Format: "mp3", SampleRateHz: 96000},
		"three channels":       {Format: "mp3", Channels: 3},
		"a format it does not": {Format: "m4b"},
	} {
		if err := encodeport.NewFFmpeg(never, nil).Encode(context.Background(), wav, filepath.Join(dir, "out.mp3"), spec); err == nil {
			t.Errorf("%s: Encode accepted %+v", name, spec)
		}
	}
	var refusal *port.NotSupportedError
	if err := encodeport.NewFFmpeg(never, nil).Encode(context.Background(), wav, filepath.Join(dir, "out.m4b"), encodeport.Spec{Format: "m4b"}); !errors.As(err, &refusal) {
		t.Errorf("m4b: Encode = %v, want a *port.NotSupportedError (Phase 2 adds M4B)", err)
	}
	assertOnly(t, dir, "chapter.wav")
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
	_ = in.Close()
	format := reader.Format()
	seconds := float64(info.Size()) / float64(format.SampleRate*format.Channels*format.BitsPerSample/8)
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
