package measure

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

func TestDiagnoseACleanReadRaisesNothing(t *testing.T) {
	samples, _ := cleanRead()
	result := diagnoseBytes(t, encodeFixture(t, samples), rawInput())

	if result.DurationSeconds != 20 || result.SampleRate != fixtureRate || result.Channels != 1 {
		t.Fatalf("format = %v s, %d Hz, %d ch; want 20 s mono 48 kHz", result.DurationSeconds, result.SampleRate, result.Channels)
	}
	if result.Clipping.RegionCount != 0 || len(result.Clipping.Regions) != 0 {
		t.Fatalf("clipping = %+v, want none", result.Clipping)
	}
	if len(result.LevelShifts) != 0 {
		t.Fatalf("level shifts = %+v, want none in an even read", result.LevelShifts)
	}
	if len(result.RoomTone) != 1 {
		t.Fatalf("room tone segments = %+v, want one steady segment", result.RoomTone)
	}
	within(t, "room tone", &result.RoomTone[0].LeveldBFS, fixtureToneDB, 1.5)
	if len(result.Silences) != 10 {
		t.Fatalf("silences = %d, want the 10 pauses", len(result.Silences))
	}
	if got := len(result.ShortTermLoudness); got != 18 {
		t.Fatalf("short-term points = %d, want 18 (3 s windows every 1 s over 20 s)", got)
	}
	if got := result.Findings(); len(got) != 0 {
		t.Fatalf("findings = %+v, want none for a clean read", got)
	}
}

func TestDiagnoseMapsAnIntentionalSilenceWithoutCallingItADefect(t *testing.T) {
	before, beforeWords := narration(0, readSpec{phrases: 5, peakDB: phrasePeakDB, toneDB: fixtureToneDB, seed: 2})
	pause := roomTone(fixtureRate, 8, fixtureToneDB, 3)
	after, afterWords := narration(18, readSpec{phrases: 5, peakDB: phrasePeakDB, toneDB: fixtureToneDB, seed: 4})
	raw := encodeFixture(t, concat(before, pause, after))

	result := diagnoseBytes(t, raw, rawInput())
	longest := SilenceRegion{}
	for _, region := range result.Silences {
		if region.EndSeconds-region.StartSeconds > longest.EndSeconds-longest.StartSeconds {
			longest = region
		}
	}
	if length := longest.EndSeconds - longest.StartSeconds; length < 8.3 || length > 8.6 {
		t.Fatalf("longest silence = %+v (%.2f s), want the 8 s pause plus the phrase's own 0.5 s", longest, length)
	}
	if got := result.Findings(); len(got) != 0 {
		t.Fatalf("findings without a transcript = %+v, want none: silence alone is not pacing evidence", got)
	}

	in := rawInput()
	in.Words = append(beforeWords, afterWords...)
	result = diagnoseBytes(t, raw, in)
	got := result.Findings()
	if len(got) != 1 {
		t.Fatalf("findings = %+v, want one long pause", got)
	}
	pause0 := got[0]
	if pause0.Category != findings.CategoryPacing || pause0.Severity != findings.SeverityInfo {
		t.Fatalf("long pause = %s/%s, want pacing/info: a long pause is never a defect by default", pause0.Category, pause0.Severity)
	}
	if pause0.Evidence["long_pause_seconds"] != DefaultPauseOptions().LongPauseSeconds {
		t.Fatalf("evidence = %+v, want the long-pause threshold reported", pause0.Evidence)
	}
	within(t, "pause start", &pause0.TimeRange.Start, 9.5, 1e-9)
	within(t, "pause end", &pause0.TimeRange.End, 18, 1e-9)
}

// clippedRead is a clean read with 0.2 s overdriven 6 dB past full scale
// from 6.5 s, inside the fourth phrase.
func clippedRead() []float64 {
	samples, _ := cleanRead()
	burst := sine(fixtureRate, 0.2, 220, 6, 0)
	copy(samples[int(6.5*fixtureRate):], burst)
	return samples
}

func TestDiagnoseFindsClippingAndItsRangeReproducesIt(t *testing.T) {
	raw := encodeFixture(t, clippedRead())
	result := diagnoseBytes(t, raw, rawInput())

	if result.Clipping.RegionCount != 1 || len(result.Clipping.Regions) != 1 {
		t.Fatalf("clipping = %+v, want one region", result.Clipping)
	}
	region := result.Clipping.Regions[0]
	within(t, "clip start", &region.StartSeconds, 6.5, 0.005)
	within(t, "clip end", &region.EndSeconds, 6.7, 0.005)

	inside := analyzeRangeBytes(t, raw, Range{StartSeconds: region.StartSeconds, LengthSeconds: region.EndSeconds - region.StartSeconds})
	if inside.ClipRunCount == 0 {
		t.Fatalf("the reported range holds no clipping: %+v", inside)
	}
	outside := analyzeRangeBytes(t, raw, Range{StartSeconds: 0, LengthSeconds: region.StartSeconds})
	if outside.ClipRunCount != 0 {
		t.Fatalf("audio before the reported range clips: %+v", outside)
	}

	got := result.Findings()
	if len(got) != 1 || got[0].Category != findings.CategoryAudioQuality || got[0].Evidence["kind"] != "clipping" {
		t.Fatalf("findings = %+v, want one audio_quality clipping finding", got)
	}
	if got[0].Evidence["ceiling_dbfs"] != 0.0 || got[0].Evidence["min_run_samples"] != minClipRunSamples {
		t.Fatalf("evidence = %+v, want the ceiling and run length that defined clipping", got[0].Evidence)
	}
}

// roomToneChange is 14 s of a read over -70 dBFS room tone, then 16 s over
// -55 dBFS: the room changed half way.
func roomToneChange() []float64 {
	quiet, _ := narration(0, readSpec{phrases: 7, peakDB: phrasePeakDB, toneDB: -70, seed: 5})
	noisy, _ := narration(14, readSpec{phrases: 8, peakDB: phrasePeakDB, toneDB: -55, seed: 6})
	return concat(quiet, noisy)
}

func TestDiagnoseFindsARoomToneChange(t *testing.T) {
	raw := encodeFixture(t, roomToneChange())
	result := diagnoseBytes(t, raw, rawInput())

	if len(result.RoomTone) != 2 {
		t.Fatalf("room tone = %+v, want two segments", result.RoomTone)
	}
	within(t, "first room tone", &result.RoomTone[0].LeveldBFS, -70, 1.5)
	within(t, "second room tone", &result.RoomTone[1].LeveldBFS, -55, 1.5)
	if len(result.LevelShifts) != 0 {
		t.Fatalf("level shifts = %+v; the read's level did not change", result.LevelShifts)
	}

	got := result.Findings()
	if len(got) != 1 || got[0].Evidence["kind"] != "room_tone_change" {
		t.Fatalf("findings = %+v, want one room-tone change", got)
	}
	change := got[0]
	within(t, "change start", &change.TimeRange.Start, 14, 0.1)
	within(t, "change end", &change.TimeRange.End, 15.5, 0.1)

	// The silences either side of the reported range carry the two tones.
	var beforeRegion, afterRegion *SilenceRegion
	for i, region := range result.Silences {
		if region.EndSeconds == change.TimeRange.Start {
			beforeRegion = &result.Silences[i]
		}
		if region.StartSeconds == change.TimeRange.End {
			afterRegion = &result.Silences[i]
		}
	}
	if beforeRegion == nil || afterRegion == nil {
		t.Fatalf("no silence ends at %v or starts at %v: %+v", change.TimeRange.Start, change.TimeRange.End, result.Silences)
	}
	for _, check := range []struct {
		region *SilenceRegion
		want   float64
	}{{beforeRegion, -70}, {afterRegion, -55}} {
		report := analyzeRangeBytes(t, raw, Range{StartSeconds: check.region.StartSeconds, LengthSeconds: check.region.EndSeconds - check.region.StartSeconds})
		within(t, "room tone RMS re-measured", report.RMSdBFS, check.want, 1.5)
	}
}

func TestDiagnoseLabelsARawRecordingAndARenderDifferently(t *testing.T) {
	raw := encodeFixture(t, roomToneChange())
	recording := diagnoseBytes(t, raw, rawInput()).Findings()
	render := diagnoseBytes(t, raw, DiagnosticInput{SourceKind: SourceProcessedRender, Options: DefaultDiagnosticOptions()}).Findings()

	if len(recording) != 1 || len(render) != 1 {
		t.Fatalf("findings = %d and %d, want one each", len(recording), len(render))
	}
	if recording[0].Evidence["source_kind"] != SourceRawRecording || render[0].Evidence["source_kind"] != SourceProcessedRender {
		t.Fatalf("source kinds = %v and %v", recording[0].Evidence["source_kind"], render[0].Evidence["source_kind"])
	}
	// A room that changed mid-session is worth a look; a render's room tone
	// may have been changed on purpose (noise reduction, gating).
	if recording[0].Severity != findings.SeverityWarning || render[0].Severity != findings.SeverityInfo {
		t.Fatalf("severities = %s and %s, want warning for a recording and info for a render", recording[0].Severity, render[0].Severity)
	}
	if !strings.Contains(recording[0].ConfidenceReason, "raw recording") || !strings.Contains(render[0].ConfidenceReason, "processed render") {
		t.Fatalf("reasons = %q and %q, want the source kind named", recording[0].ConfidenceReason, render[0].ConfidenceReason)
	}
}

func TestDiagnoseFindsALevelShift(t *testing.T) {
	loud, _ := narration(0, readSpec{phrases: 10, peakDB: phrasePeakDB, toneDB: fixtureToneDB, seed: 7})
	quiet, _ := narration(20, readSpec{phrases: 10, peakDB: phrasePeakDB - 10, toneDB: fixtureToneDB, seed: 8})
	raw := encodeFixture(t, concat(loud, quiet))
	result := diagnoseBytes(t, raw, rawInput())

	if len(result.LevelShifts) != 1 {
		t.Fatalf("level shifts = %+v, want one", result.LevelShifts)
	}
	shift := result.LevelShifts[0]
	within(t, "shift", &shift.DeltaLU, -10, 1.5)
	if shift.StartSeconds < 18 || shift.EndSeconds > 22 {
		t.Fatalf("shift at %v-%v s, want near 20 s", shift.StartSeconds, shift.EndSeconds)
	}

	before := analyzeRangeBytes(t, raw, Range{StartSeconds: shift.StartSeconds - 10, LengthSeconds: 10})
	after := analyzeRangeBytes(t, raw, Range{StartSeconds: shift.EndSeconds, LengthSeconds: 10})
	if delta := *after.IntegratedLUFS - *before.IntegratedLUFS; delta > -DefaultDiagnosticOptions().LevelShiftLU {
		t.Fatalf("re-measured either side of the shift: %.2f LU apart, want a drop of at least the threshold", delta)
	}

	got := result.Findings()
	if len(got) != 1 || got[0].Evidence["kind"] != "level_shift" || got[0].Confidence != nil {
		t.Fatalf("findings = %+v, want one level shift with no invented confidence", got)
	}
}

func TestDiagnosePacingIsUnavailableWhenTranscriptTimingIsUnresolved(t *testing.T) {
	samples, words := cleanRead()
	raw := encodeFixture(t, samples)

	reversed := append([]Word(nil), words...)
	reversed[0], reversed[1] = reversed[1], reversed[0]
	pastEnd := append(append([]Word(nil), words...), Word{Text: "late", StartSeconds: 25, EndSeconds: 26})
	nanWord := append([]Word(nil), words...)
	nanWord[3].EndSeconds = math.NaN()

	for _, tc := range []struct {
		name   string
		words  []Word
		reason string
	}{
		{"no transcript", nil, "no transcript"},
		{"one word", words[:1], "fewer than two"},
		{"words out of order", reversed, "unresolved"},
		{"a word with no end", nanWord, "unresolved"},
		{"words past the audio", pastEnd, "past the end"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			in := rawInput()
			in.Words = tc.words
			result := diagnoseBytes(t, raw, in)
			if result.Pacing.Status != StatusUnavailable || !strings.Contains(result.Pacing.Reason, tc.reason) {
				t.Fatalf("pacing = %+v, want unavailable because %q", result.Pacing.Evidence, tc.reason)
			}
			if result.Pacing.PauseSummary != nil {
				t.Fatalf("pacing has figures while unavailable: %+v", result.Pacing.PauseSummary)
			}
			if got := result.Findings(); len(got) != 0 {
				t.Fatalf("findings = %+v, want none", got)
			}
		})
	}

	in := rawInput()
	in.Words = words
	if result := diagnoseBytes(t, raw, in); result.Pacing.Status != StatusMeasured || result.Pacing.Count != 9 {
		t.Fatalf("pacing = %+v, want nine measured pauses", result.Pacing)
	}
}

func TestDiagnoseMeasuresARangeAndTimesFindingsInTheSource(t *testing.T) {
	raw := encodeFixture(t, clippedRead())
	whole := diagnoseBytes(t, raw, rawInput()).Findings()

	in := rawInput()
	in.Range = &Range{StartSeconds: 5, LengthSeconds: 5}
	result := diagnoseBytes(t, raw, in)
	if result.DurationSeconds != 5 || result.Range == nil {
		t.Fatalf("range result = %v s, range %+v", result.DurationSeconds, result.Range)
	}
	within(t, "clip start in the range", &result.Clipping.Regions[0].StartSeconds, 1.5, 0.005)

	got := result.Findings()
	if len(got) != 1 {
		t.Fatalf("findings = %+v, want the clipping", got)
	}
	within(t, "clip source start", got[0].TimeRange.SourceStart, 6.5, 0.005)
	if got[0].ID != whole[0].ID {
		t.Fatalf("the same clipping has id %s in a range and %s in the whole file", got[0].ID, whole[0].ID)
	}
}

func TestDiagnoseFindingsAreValidAndUnique(t *testing.T) {
	samples, words := narration(0, readSpec{phrases: 12, peakDB: phrasePeakDB, toneDB: fixtureToneDB, seed: 9})
	samples = concat(samples, roomTone(fixtureRate, 6, fixtureToneDB, 10), roomToneChange(), clippedRead())
	in := rawInput()
	in.Words = append(words, Word{Text: "resumes", StartSeconds: 30, EndSeconds: 31.5}) // after a 6.5 s pause
	in.Options.LevelShiftLU = 1                                                         // sensitive, to exercise every kind
	got := diagnoseBytes(t, encodeFixture(t, samples), in).Findings()

	kinds := map[string]int{}
	ids := map[string]bool{}
	for _, finding := range got {
		if err := finding.Validate(); err != nil {
			t.Fatalf("invalid finding %+v: %v", finding, err)
		}
		if ids[finding.ID] {
			t.Fatalf("duplicate id %s", finding.ID)
		}
		ids[finding.ID] = true
		kinds[finding.Evidence["kind"].(string)]++
		if finding.Analyzer != diagnosticsAnalyzer || finding.Review.Status != findings.StatusUnreviewed {
			t.Fatalf("finding %+v: want analyzer %q, unreviewed", finding, diagnosticsAnalyzer)
		}
	}
	for _, kind := range []string{"clipping", "room_tone_change", "long_pause"} {
		if kinds[kind] == 0 {
			t.Fatalf("kinds = %v, want at least one %s", kinds, kind)
		}
	}
}

func TestDiagnoseFileIsDeterministicAndLeavesTheFileUnchanged(t *testing.T) {
	raw := encodeFixture(t, clippedRead())
	path := filepath.Join(t.TempDir(), "chapter.wav")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	before := sha256.Sum256(raw)

	var outputs [2][]byte
	for i := range outputs {
		result, err := DiagnoseFile(context.Background(), path, rawInput())
		if err != nil {
			t.Fatalf("DiagnoseFile: %v", err)
		}
		if result.File != path {
			t.Fatalf("file = %q, want %q", result.File, path)
		}
		outputs[i], _ = json.Marshal(struct {
			Diagnostics
			Findings []findings.Finding
		}{result, result.Findings()})
	}
	if !bytes.Equal(outputs[0], outputs[1]) {
		t.Fatal("two runs over the same file differ")
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if sha256.Sum256(after) != before {
		t.Fatal("diagnosing modified the file")
	}

	if _, err := DiagnoseFile(context.Background(), filepath.Join(t.TempDir(), "missing.wav"), rawInput()); err == nil {
		t.Fatal("a missing file diagnosed without error")
	}
}

func TestDiagnoseStopsWhenCancelled(t *testing.T) {
	samples, _ := cleanRead()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := Diagnose(ctx, bytes.NewReader(encodeFixture(t, samples)), rawInput())
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
}

func TestDiagnoseRejectsInvalidInput(t *testing.T) {
	samples, _ := cleanRead()
	raw := encodeFixture(t, samples)
	valid := rawInput()

	cases := map[string]func(in *DiagnosticInput){
		"no source kind":           func(in *DiagnosticInput) { in.SourceKind = "" },
		"unknown source kind":      func(in *DiagnosticInput) { in.SourceKind = "mastered" },
		"ceiling above full scale": func(in *DiagnosticInput) { in.Options.ClipCeilingdBFS = 0.5 },
		"NaN ceiling":              func(in *DiagnosticInput) { in.Options.ClipCeilingdBFS = math.NaN() },
		"silence floor at 0":       func(in *DiagnosticInput) { in.Options.SilenceFloordBFS = 0 },
		"infinite silence floor":   func(in *DiagnosticInput) { in.Options.SilenceFloordBFS = math.Inf(-1) },
		"no minimum silence":       func(in *DiagnosticInput) { in.Options.MinSilenceSeconds = 0 },
		"no level-shift step":      func(in *DiagnosticInput) { in.Options.LevelShiftLU = 0 },
		"negative room-tone step":  func(in *DiagnosticInput) { in.Options.RoomToneStepDB = -3 },
		"long pause below minimum": func(in *DiagnosticInput) { in.Options.Pauses = PauseOptions{MinPauseSeconds: 2, LongPauseSeconds: 1} },
		"bad range":                func(in *DiagnosticInput) { in.Range = &Range{StartSeconds: -1, LengthSeconds: 1} },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			in := valid
			mutate(&in)
			if _, err := Diagnose(context.Background(), bytes.NewReader(raw), in); err == nil {
				t.Fatal("accepted invalid input")
			}
		})
	}
	if _, err := Diagnose(context.Background(), strings.NewReader("not a wav"), valid); err == nil {
		t.Fatal("accepted a non-WAV input")
	}
}

func TestDiagnoseOfSilenceAndOfAShortFileInventsNothing(t *testing.T) {
	for name, samples := range map[string][]float64{
		"digital silence": silence(fixtureRate, 5),
		"one second":      roomTone(fixtureRate, 1, -40, 11),
	} {
		t.Run(name, func(t *testing.T) {
			result := diagnoseBytes(t, encodeFixture(t, samples), rawInput())
			for _, point := range result.ShortTermLoudness {
				if point.LUFS != nil {
					t.Fatalf("short-term point %+v has a level for digital silence", point)
				}
			}
			if len(result.LevelShifts) != 0 || len(result.RoomTone) != 0 || len(result.Findings()) != 0 {
				t.Fatalf("result = %+v, want no shifts, no room tone and no findings", result)
			}
			encoded, err := json.Marshal(result)
			if err != nil || strings.Contains(string(encoded), "Inf") || strings.Contains(string(encoded), "NaN") {
				t.Fatalf("json = %s, %v", encoded, err)
			}
		})
	}
}
