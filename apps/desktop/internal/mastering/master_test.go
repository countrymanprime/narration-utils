package mastering

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"math"
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// narration is a speech-like analytic fixture: a 220 Hz voice with a 3 kHz overtone at speechAmp, 40 Hz rumble, a
// second of near-silence at each edge, and a few isolated plosive spikes of spikeAmp, so its RMS and peak are set
// independently.
func narration(speechAmp, spikeAmp float64) []float64 {
	voice := sine(rate, 6, 220, speechAmp)
	overtone := sine(rate, 6, 3000, speechAmp/4)
	rumble := sine(rate, 6, 40, speechAmp/3)
	for i := range voice {
		voice[i] += overtone[i] + rumble[i]
	}
	for _, at := range []int{rate, 3 * rate, 5*rate + 17} {
		voice[at] = spikeAmp
		voice[at+1] = -spikeAmp * 0.8
	}
	edge := sine(rate, 1, 150, 0.0005) // room tone, not digital silence
	return concat(edge, voice, edge)
}

func judged(t *testing.T, judgement deliveryprofile.Judgement, ruleID string) deliveryprofile.Result {
	t.Helper()
	for _, result := range judgement.Results {
		if result.RuleID == ruleID {
			return result
		}
	}
	t.Fatalf("no result for rule %s", ruleID)
	return deliveryprofile.Result{}
}

func fileHash(t *testing.T, path string) [32]byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return sha256.Sum256(data)
}

func TestMasterLandsInsideACXWindow(t *testing.T) {
	cases := []struct {
		name     string
		channels [][]float64
	}{
		{"quiet mono", [][]float64{narration(0.02, 0.3)}},
		{"hot mono with clipped plosives", [][]float64{narration(0.3, 1.0)}},
		{"stereo", [][]float64{narration(0.05, 0.9), narration(0.04, 0.7)}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			source := writeFixture(t, "chapter.wav", rate, tc.channels...)
			dest := filepath.Join(t.TempDir(), "chapter-mastered.wav")
			result, err := Master(context.Background(), Request{Source: source, Destination: dest, Profile: deliveryprofile.ACX()}, Options{})
			if err != nil {
				t.Fatal(err)
			}
			// Re-measure the written file independently with measure's own reader: the number the checker will see.
			after, err := measure.AnalyzeFile(dest)
			if err != nil {
				t.Fatal(err)
			}
			if *after.RMSdBFS < -23 || *after.RMSdBFS > -18 {
				t.Fatalf("mastered RMS = %.2f dBFS, want inside -23..-18", *after.RMSdBFS)
			}
			if *after.SamplePeakdBFS > -3 {
				t.Fatalf("mastered sample peak = %.2f dBFS, want at most -3", *after.SamplePeakdBFS)
			}
			if math.Abs(*after.RMSdBFS-(-20.5)) > 0.25 {
				t.Fatalf("mastered RMS = %.2f dBFS, want the window's middle, -20.5 ± 0.25", *after.RMSdBFS)
			}
			if after.Channels != len(tc.channels) || after.SampleRate != rate {
				t.Fatalf("format changed: %d channels at %d Hz", after.Channels, after.SampleRate)
			}
			if after.DurationSeconds != result.Before.DurationSeconds {
				t.Fatalf("duration %g, want the source's %g", after.DurationSeconds, result.Before.DurationSeconds)
			}
			for _, rule := range []string{"acx.rms", "acx.peak"} {
				if status := judged(t, result.Judgement, rule).Status; status != deliveryprofile.StatusMet {
					t.Fatalf("%s is %s on the mastered file, want met", rule, status)
				}
			}
			if *result.After.RMSdBFS != *after.RMSdBFS {
				t.Fatalf("result reports RMS %.3f, the file measures %.3f", *result.After.RMSdBFS, *after.RMSdBFS)
			}
		})
	}
}

func TestMasterHonoursACustomProfilesTarget(t *testing.T) {
	source := writeFixture(t, "chapter.wav", rate, narration(0.1, 0.9))
	dest := filepath.Join(t.TempDir(), "quiet.wav")
	profile := customProfile(-28, -24, -8)
	result, err := Master(context.Background(), Request{Source: source, Destination: dest, Profile: profile}, Options{})
	if err != nil {
		t.Fatal(err)
	}
	after, err := measure.AnalyzeFile(dest)
	if err != nil {
		t.Fatal(err)
	}
	if *after.RMSdBFS < -28 || *after.RMSdBFS > -24 || *after.SamplePeakdBFS > -8 {
		t.Fatalf("mastered to %.2f dBFS RMS, %.2f dBFS peak; want -28..-24 and at most -8", *after.RMSdBFS, *after.SamplePeakdBFS)
	}
	if result.Targets.RMS != -26 {
		t.Fatalf("target RMS %g, want -26", result.Targets.RMS)
	}
	if status := judged(t, result.Judgement, "acx.rms").Status; status != deliveryprofile.StatusMet {
		t.Fatalf("the custom RMS rule is %s, want met", status)
	}
}

func TestMasterNeverTouchesTheSource(t *testing.T) {
	source := writeFixture(t, "chapter.wav", rate, narration(0.3, 1.0))
	if err := os.Chmod(source, 0o444); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(source)
	if err != nil {
		t.Fatal(err)
	}
	hash := fileHash(t, source)
	dest := filepath.Join(t.TempDir(), "out.wav")
	if _, err := Master(context.Background(), Request{Source: source, Destination: dest, Profile: deliveryprofile.ACX()}, Options{}); err != nil {
		t.Fatalf("mastering a read-only source: %v", err)
	}
	after, err := os.Stat(source)
	if err != nil {
		t.Fatal(err)
	}
	if fileHash(t, source) != hash || !after.ModTime().Equal(info.ModTime()) || after.Mode() != info.Mode() {
		t.Fatal("the source file changed")
	}
	if fileHash(t, dest) == hash {
		t.Fatal("the destination is a copy of the source, not a mastered file")
	}
}

func TestMasterRefusesToWriteOverTheSource(t *testing.T) {
	source := writeFixture(t, "chapter.wav", rate, narration(0.1, 0.5))
	hash := fileHash(t, source)
	dir := filepath.Dir(source)
	for _, dest := range []string{source, filepath.Join(dir, ".", "chapter.wav"), filepath.Join(dir, "sub", "..", "chapter.wav")} {
		_, err := Master(context.Background(), Request{Source: source, Destination: dest, Profile: deliveryprofile.ACX()}, Options{})
		if !errors.Is(err, ErrSameFile) {
			t.Fatalf("dest %q: err = %v, want ErrSameFile", dest, err)
		}
	}
	if fileHash(t, source) != hash {
		t.Fatal("the source file changed")
	}
}

func TestMasterRefusesAHardLinkToTheSource(t *testing.T) {
	source := writeFixture(t, "chapter.wav", rate, narration(0.1, 0.5))
	link := filepath.Join(t.TempDir(), "alias.wav")
	if err := os.Link(source, link); err != nil {
		t.Skipf("hard links unavailable: %v", err)
	}
	_, err := Master(context.Background(), Request{Source: source, Destination: link, Profile: deliveryprofile.ACX()}, Options{})
	if !errors.Is(err, ErrSameFile) {
		t.Fatalf("err = %v, want ErrSameFile", err)
	}
}

func TestMasterRefusesAnExistingDestination(t *testing.T) {
	source := writeFixture(t, "chapter.wav", rate, narration(0.1, 0.5))
	dest := filepath.Join(t.TempDir(), "taken.wav")
	if err := os.WriteFile(dest, []byte("keep me"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := Master(context.Background(), Request{Source: source, Destination: dest, Profile: deliveryprofile.ACX()}, Options{})
	if !errors.Is(err, ErrDestinationExists) {
		t.Fatalf("err = %v, want ErrDestinationExists", err)
	}
	if data, _ := os.ReadFile(dest); !bytes.Equal(data, []byte("keep me")) {
		t.Fatal("an existing destination was overwritten")
	}
}

func TestMasterCancelledLeavesNoFile(t *testing.T) {
	source := writeFixture(t, "chapter.wav", rate, narration(0.1, 0.5))
	dir := t.TempDir()
	dest := filepath.Join(dir, "out.wav")
	ctx, cancel := context.WithCancel(context.Background())
	var calls int
	_, err := Master(ctx, Request{Source: source, Destination: dest, Profile: deliveryprofile.ACX()}, Options{
		Progress: func(done, total int64) {
			calls++
			if done*2 >= total { // cancel halfway, during the write pass
				cancel()
			}
		},
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Fatalf("a cancelled master left %d file(s) behind, first %q", len(entries), entries[0].Name())
	}
	if calls == 0 {
		t.Fatal("no progress was reported")
	}
}

func TestMasterReportsProgressToCompletion(t *testing.T) {
	source := writeFixture(t, "chapter.wav", rate, narration(0.1, 0.5))
	dest := filepath.Join(t.TempDir(), "out.wav")
	var last, lastTotal int64
	_, err := Master(context.Background(), Request{Source: source, Destination: dest, Profile: deliveryprofile.ACX()}, Options{
		Progress: func(done, total int64) {
			if done < last {
				t.Fatalf("progress went back from %d to %d", last, done)
			}
			last, lastTotal = done, total
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if last != lastTotal || last == 0 {
		t.Fatalf("progress ended at %d of %d", last, lastTotal)
	}
}

func TestMasterRefusesANonWAVSource(t *testing.T) {
	source := filepath.Join(t.TempDir(), "chapter.mp3")
	if err := os.WriteFile(source, []byte("ID3\x04\x00\x00\x00\x00\x00\x00"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := Master(context.Background(), Request{Source: source, Destination: filepath.Join(t.TempDir(), "x.wav"), Profile: deliveryprofile.ACX()}, Options{})
	if !errors.Is(err, measure.ErrNotWAV) {
		t.Fatalf("err = %v, want measure.ErrNotWAV", err)
	}
}

func TestMasterRefusesSilence(t *testing.T) {
	source := writeFixture(t, "silence.wav", rate, make([]float64, rate))
	dir := t.TempDir()
	_, err := Master(context.Background(), Request{Source: source, Destination: filepath.Join(dir, "x.wav"), Profile: deliveryprofile.ACX()}, Options{})
	if !errors.Is(err, ErrSilent) {
		t.Fatalf("err = %v, want ErrSilent", err)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Fatal("a refused master left a file behind")
	}
}
