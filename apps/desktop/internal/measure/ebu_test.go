package measure

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/fs"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// The EBU loudness test set may not be redistributed (its terms forbid
// copying or publishing the sequences), so it is never committed. The
// gated test reads the unpacked set from the directory this variable names;
// testdata/ebu/README.md says how to get it and what to record.
const ebuDirEnv = "NARRATION_EBU_DIR"

const (
	ebuExpectedFile = "testdata/ebu/expected.json"

	ebuMeasureIntegrated = "integrated_lufs"
	ebuMeasureTruePeak   = "true_peak_dbtp"
	ebuMeasureRefused    = "refused" // the file must be refused with an error
	ebuMeasureNone       = "none"    // not something this package measures

	// The EBU files are synthesised at 48 kHz (Tech 3341 section 2.9).
	ebuRate = 48000
)

// ebuSetFileName matches the set's file names, for example
// seq-3341-1-16bit.wav, seq-3341-7_seq-3342-5-24bit.wav and
// seq-3341-2011-8_seq-3342-6-24bit-v02.wav, capturing the standard and the
// test case number.
var ebuSetFileName = regexp.MustCompile(`^seq-(3341|3342)-(?:\d{4}-)?(\d+)(?:[-_.]|$)`)

type ebuCase struct {
	Standard string   `json:"standard"`
	Case     int      `json:"case"`
	Signal   string   `json:"signal"`
	Measure  string   `json:"measure"`
	Expected *float64 `json:"expected"`
	Above    float64  `json:"above"`
	Below    float64  `json:"below"`
	Reason   string   `json:"reason"`
}

func (c ebuCase) key() string { return fmt.Sprintf("%s-%d", c.Standard, c.Case) }

func (c ebuCase) name() string { return fmt.Sprintf("tech%s/case%02d", c.Standard, c.Case) }

func loadEBUCases(t *testing.T) []ebuCase {
	t.Helper()
	raw, err := os.ReadFile(ebuExpectedFile)
	if err != nil {
		t.Fatal(err)
	}
	var table struct {
		Source string    `json:"source"`
		Cases  []ebuCase `json:"cases"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&table); err != nil {
		t.Fatalf("%s: %v", ebuExpectedFile, err)
	}
	return table.Cases
}

// ebuValue picks the measurement a case is judged on from a report.
func ebuValue(c ebuCase, report Report) *float64 {
	if c.Measure == ebuMeasureTruePeak {
		return report.TruePeakdBTP
	}
	return report.IntegratedLUFS
}

// checkEBU reports whether got is inside the case's asymmetric tolerance,
// and a line describing the result for the recorded outcome.
func checkEBU(c ebuCase, got *float64) (bool, string) {
	want := fmt.Sprintf("want %.1f +%.1f/-%.1f", *c.Expected, c.Above, c.Below)
	if got == nil {
		return false, fmt.Sprintf("%s = unavailable, %s", c.Measure, want)
	}
	pass := *got-*c.Expected <= c.Above+1e-9 && *c.Expected-*got <= c.Below+1e-9
	verdict := "pass"
	if !pass {
		verdict = "FAIL"
	}
	return pass, fmt.Sprintf("%s = %.2f, %s: %s", c.Measure, *got, want, verdict)
}

func TestEBUExpectedTableCoversEveryPublishedCaseOnce(t *testing.T) {
	cases := loadEBUCases(t)
	counts := map[string]int{}
	for _, c := range cases {
		counts[c.key()]++
		switch c.Measure {
		case ebuMeasureIntegrated, ebuMeasureTruePeak:
			if c.Expected == nil || c.Above <= 0 || c.Below <= 0 {
				t.Errorf("%s: a measured case needs an expected value and positive tolerances", c.name())
			}
		case ebuMeasureRefused, ebuMeasureNone:
			if c.Reason == "" || c.Expected != nil {
				t.Errorf("%s: an unmeasured case needs a reason and no expected value", c.name())
			}
		default:
			t.Errorf("%s: unknown measure %q", c.name(), c.Measure)
		}
	}
	// Tech 3341 Table 1 has cases 1 to 23; Tech 3342 Table 1 has 1 to 6.
	for standard, last := range map[string]int{"3341": 23, "3342": 6} {
		for n := 1; n <= last; n++ {
			if key := fmt.Sprintf("%s-%d", standard, n); counts[key] != 1 {
				t.Errorf("case %s appears %d times, want once", key, counts[key])
			}
		}
	}
	if len(counts) != 29 {
		t.Errorf("table has %d distinct cases, want 29", len(counts))
	}
}

func TestEBUSetFileNamesMapToTheirTestCase(t *testing.T) {
	for name, want := range map[string]string{
		"seq-3341-1-16bit.wav":                      "3341-1",
		"seq-3341-3-16bit-v02.wav":                  "3341-3",
		"seq-3341-6-6channels-WAVEEX-16bit.wav":     "3341-6",
		"seq-3341-7_seq-3342-5-24bit.wav":           "3341-7",
		"seq-3341-2011-8_seq-3342-6-24bit-v02.wav":  "3341-8",
		"seq-3341-10-1-24bit.wav":                   "3341-10",
		"seq-3341-15-24bit.wav.wav":                 "3341-15",
		"seq-3342-4-16bit.wav":                      "3342-4",
		"1kHz Sine -20 LUFS-16bit.wav":              "",
		"seq-3343-calibration-pink-noise-24bit.wav": "",
	} {
		if got := ebuCaseKey(name); got != want {
			t.Errorf("ebuCaseKey(%q) = %q, want %q", name, got, want)
		}
	}
}

// ebuCaseKey maps a file name in the set to its "<standard>-<case>" key, or
// "" for a file that is not one of the numbered test cases.
func ebuCaseKey(name string) string {
	match := ebuSetFileName.FindStringSubmatch(name)
	if match == nil {
		return ""
	}
	return match[1] + "-" + match[2]
}

// TestEBUTech3341SignalsSynthesisedFromTable1 rebuilds the Table 1 signals
// that are fully specified by their description (cases 1 to 5 and 15 to 19)
// and holds them to the same committed expectations as the official files.
// It runs in the gate, so the expected table is always exercised; cases 20
// to 23 (synthesised at 4fs and filtered) and the authentic programmes need
// the official files.
func TestEBUTech3341SignalsSynthesisedFromTable1(t *testing.T) {
	tone := func(seconds, peakDB float64) []float64 { return sine(ebuRate, seconds, 1000, peakDB, 0) }
	peakTone := func(divisor, amplitude, phaseDeg float64) []float64 {
		mono := sine(ebuRate, 1, ebuRate/divisor, 20*math.Log10(amplitude), phaseDeg*math.Pi/180)
		return fadeInOut(mono, ebuRate/100) // Table 1: a 10 ms fade-in and fade-out
	}
	signals := map[int][]float64{
		1:  tone(20, -23),
		2:  tone(20, -33),
		3:  concat(tone(10, -36), tone(60, -23), tone(10, -36)),
		4:  concat(tone(10, -72), tone(10, -36), tone(60, -23), tone(10, -36), tone(10, -72)),
		5:  concat(tone(20, -26), tone(20.1, -20), tone(20, -26)),
		15: peakTone(4, 0.50, 0),
		16: peakTone(4, 0.50, 45),
		17: peakTone(6, 0.50, 60),
		18: peakTone(8, 0.50, 67.5),
		19: peakTone(4, 1.41, 45),
	}
	for _, c := range loadEBUCases(t) {
		mono, ok := signals[c.Case]
		if c.Standard != "3341" || !ok {
			continue
		}
		t.Run(c.name(), func(t *testing.T) {
			t.Parallel()
			report := analyzeBytes(t, encodeWAV(t, 2, ebuRate, 24, false, stereo(mono)))
			if pass, line := checkEBU(c, ebuValue(c, report)); !pass {
				t.Error(line)
			}
		})
	}
}

// TestEBULoudnessTestSet measures the official EBU loudness test set against
// the published tolerances. It runs only when NARRATION_EBU_DIR names the
// unpacked set; see testdata/ebu/README.md. Run it with -v to get the lines
// to record in docs/architecture/delivery-measurement-validation.md.
func TestEBULoudnessTestSet(t *testing.T) {
	dir := os.Getenv(ebuDirEnv)
	if dir == "" {
		t.Skipf("set %s to the unpacked EBU loudness test set to run this (testdata/ebu/README.md)", ebuDirEnv)
	}
	measureEBUSet(t, dir, loadEBUCases(t))
}

// measureEBUSet judges every case against the files for it under dir. A
// case this package does not measure is skipped with its reason; a measured
// case with no file fails, so an incomplete set cannot pass.
func measureEBUSet(t *testing.T, dir string, cases []ebuCase) {
	t.Helper()
	files := ebuSetFiles(t, dir)
	if len(files) == 0 {
		t.Fatalf("%s holds no seq-3341-*/seq-3342-* WAV files; point %s at the unpacked set", dir, ebuDirEnv)
	}
	for _, c := range cases {
		t.Run(c.name(), func(t *testing.T) {
			if c.Measure == ebuMeasureNone {
				t.Skip(c.Reason)
			}
			paths := files[c.key()]
			if len(paths) == 0 {
				t.Fatalf("no file for %s (%s) in %s", c.name(), c.Signal, dir)
			}
			for _, path := range paths {
				checkEBUFile(t, c, path)
			}
		})
	}
}

// TestEBUSetRunnerJudgesFilesNamedAsInTheSet runs the gated test's runner
// over stand-in files named as the official ones, so the path the recorded
// result depends on is exercised in the gate too.
func TestEBUSetRunnerJudgesFilesNamedAsInTheSet(t *testing.T) {
	dir := t.TempDir()
	nested := filepath.Join(dir, "ebu-loudness-test-setv05")
	if err := os.Mkdir(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(name string, raw []byte) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(nested, name), raw, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	tone := sine(ebuRate, 20, 1000, -23, 0)
	write("seq-3341-1-16bit.wav", encodeWAV(t, 2, ebuRate, 16, false, stereo(tone)))
	peak := fadeInOut(sine(ebuRate, 1, ebuRate/4, 20*math.Log10(0.5), 0), ebuRate/100)
	write("seq-3341-15-24bit.wav.wav", encodeWAV(t, 2, ebuRate, 24, false, stereo(peak)))
	short := sine(ebuRate, 1, 1000, -28, 0)
	write("seq-3341-6-5channels-16bit.wav", encodeWAV(t, 5, ebuRate, 16, false, interleave(short, short, short, short, short)))
	write("1kHz Sine -20 LUFS-16bit.wav", encodeWAV(t, 2, ebuRate, 16, false, stereo(short)))

	var picked []ebuCase
	for _, c := range loadEBUCases(t) {
		switch c.key() {
		case "3341-1", "3341-6", "3341-15", "3341-9", "3342-1":
			picked = append(picked, c)
		}
	}
	if len(picked) != 5 {
		t.Fatalf("picked %d cases, want 5", len(picked))
	}
	measureEBUSet(t, dir, picked)
}

func TestCheckEBUAppliesTheAsymmetricTolerance(t *testing.T) {
	expected := -6.0
	c := ebuCase{Measure: ebuMeasureTruePeak, Expected: &expected, Above: 0.2, Below: 0.4}
	for _, tc := range []struct {
		got  *float64
		pass bool
	}{
		{ptr(-6.0), true},
		{ptr(-5.8), true},
		{ptr(-5.79), false},
		{ptr(-6.4), true},
		{ptr(-6.41), false},
		{nil, false},
	} {
		if pass, line := checkEBU(c, tc.got); pass != tc.pass {
			t.Errorf("checkEBU(%v) = %v (%s), want %v", tc.got, pass, line, tc.pass)
		}
	}
}

func checkEBUFile(t *testing.T, c ebuCase, path string) {
	t.Helper()
	name := filepath.Base(path)
	report, err := AnalyzeFile(path)
	if c.Measure == ebuMeasureRefused {
		if err == nil {
			t.Errorf("%s: measured, want refused (%s)", name, c.Reason)
			return
		}
		t.Logf("%s: refused: %v", name, err)
		return
	}
	if err != nil {
		t.Errorf("%s: %v", name, err)
		return
	}
	pass, line := checkEBU(c, ebuValue(c, report))
	if !pass {
		t.Errorf("%s: %s", name, line)
		return
	}
	t.Logf("%s: %s", name, line)
}

// ebuSetFiles lists the set's numbered WAV files under dir by case key.
func ebuSetFiles(t *testing.T, dir string) map[string][]string {
	t.Helper()
	files := map[string][]string{}
	err := filepath.WalkDir(dir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || !strings.EqualFold(filepath.Ext(path), ".wav") {
			return nil
		}
		if key := ebuCaseKey(entry.Name()); key != "" {
			files[key] = append(files[key], path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for key := range files {
		sort.Strings(files[key])
	}
	return files
}
