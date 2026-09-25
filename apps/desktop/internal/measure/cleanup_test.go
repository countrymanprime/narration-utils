package measure

import (
	"math"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

// The cleanup fixtures follow the PRD's success signals for Phase 9: a breath after a plosive, a click inside
// silence, a long dramatic pause and a silence near the threshold, with ambiguous cases left at low confidence.

const cleanupRate = 44100

func cleanupDiagnose(t *testing.T, mono []float64, in DiagnosticInput) Diagnostics {
	t.Helper()
	if in.SourceKind == "" {
		in.SourceKind = SourceRawRecording
	}
	if in.Options == (DiagnosticOptions{}) {
		in.Options = DefaultDiagnosticOptions()
	}
	return diagnoseBytes(t, encodeWAV(t, 1, cleanupRate, 24, false, mono), in)
}

// speech stands in for a read: a low tone (few zero crossings, like voiced speech) at a reading level.
func speech(seconds float64) []float64 { return sine(cleanupRate, seconds, 180, -14, 0) }

func candidatesOf(d Diagnostics, class CleanupClass) []CleanupCandidate {
	out := []CleanupCandidate{}
	for _, candidate := range d.Cleanup.Candidates {
		if candidate.Class == class {
			out = append(out, candidate)
		}
	}
	return out
}

func near(got, want, tolerance float64) bool { return math.Abs(got-want) <= tolerance }

func TestCleanupFindsABreathAfterAPlosiveAndTheSilenceAfterIt(t *testing.T) {
	plosive := roomTone(cleanupRate, 0.02, -10, 3) // a burst straight out of the word
	breath := roomTone(cleanupRate, 0.4, -40, 5)   // noise-like, well below the read
	d := cleanupDiagnose(t, concat(speech(1.5), plosive, breath, roomTone(cleanupRate, 0.8, -65, 9), speech(1.5)), DiagnosticInput{})

	if d.Cleanup.SpeechLeveldBFS == nil || !near(*d.Cleanup.SpeechLeveldBFS, -17, 1.5) {
		t.Fatalf("speech level = %v, want about -17 dBFS (the tone's RMS)", d.Cleanup.SpeechLeveldBFS)
	}
	breaths := candidatesOf(d, CleanupBreath)
	if len(breaths) != 1 || !near(breaths[0].StartSeconds, 1.52, 0.02) || !near(breaths[0].EndSeconds, 1.92, 0.02) {
		t.Fatalf("breaths = %+v, want one from 1.52 to 1.92 s", breaths)
	}
	if breaths[0].Confidence > 0.5 || breaths[0].CutStart != breaths[0].StartSeconds || breaths[0].CutEnd != breaths[0].EndSeconds {
		t.Fatalf("breath = %+v, want at most a middling call, cut whole", breaths[0])
	}
	if clicks := candidatesOf(d, CleanupClick); len(clicks) != 0 {
		t.Fatalf("clicks = %+v, want none: the plosive has speech beside it", clicks)
	}
	silences := candidatesOf(d, CleanupSilence)
	if len(silences) != 1 || !near(silences[0].StartSeconds, 1.92, 0.06) || !near(silences[0].CutStart, silences[0].StartSeconds+0.15, 1e-9) ||
		!near(silences[0].CutEnd, silences[0].EndSeconds-0.15, 1e-9) || silences[0].Confidence != 0.6 {
		t.Fatalf("silences = %+v, want the room tone after the breath, cut inside a 0.15 s hold at each side", silences)
	}
}

func TestCleanupFindsAClickInsideSilence(t *testing.T) {
	room := roomTone(cleanupRate, 1.5, -65, 11)
	at := int(0.7 * cleanupRate)
	for i := range 88 { // a 2 ms spike
		room[at+i] = 0.5
	}
	d := cleanupDiagnose(t, concat(speech(1), room, speech(1)), DiagnosticInput{})

	clicks := candidatesOf(d, CleanupClick)
	if len(clicks) != 1 || !near(clicks[0].StartSeconds, 1.7, 0.011) || clicks[0].EndSeconds-clicks[0].StartSeconds > 0.031 {
		t.Fatalf("clicks = %+v, want one burst at 1.7 s of at most 30 ms", clicks)
	}
	if clicks[0].PeakdBFS == nil || !near(*clicks[0].PeakdBFS, -6.02, 0.1) || clicks[0].CutStart >= clicks[0].StartSeconds || clicks[0].CutEnd <= clicks[0].EndSeconds {
		t.Fatalf("click = %+v, want its -6 dBFS peak and a cut just around it", clicks[0])
	}
	if breaths := candidatesOf(d, CleanupBreath); len(breaths) != 0 {
		t.Fatalf("breaths = %+v, want none", breaths)
	}
}

func TestCleanupLeavesALongPauseAndAMarginalSilenceAtLowConfidence(t *testing.T) {
	d := cleanupDiagnose(t, concat(speech(1), roomTone(cleanupRate, 3, -65, 13), speech(1), roomTone(cleanupRate, 1, -51.5, 17), speech(1)), DiagnosticInput{})
	silences := candidatesOf(d, CleanupSilence)
	if len(silences) != 2 {
		t.Fatalf("silences = %+v, want the long pause and the marginal one", silences)
	}
	if silences[0].Confidence != 0.3 || !strings.Contains(silences[0].Why, "may be meant") {
		t.Errorf("a 3 s pause = %+v, want a low-confidence call that says it may be meant", silences[0])
	}
	if silences[1].Confidence != 0.3 || !strings.Contains(silences[1].Why, "marginal") {
		t.Errorf("a silence 1.5 dB under the floor = %+v, want a low-confidence marginal call", silences[1])
	}
	if breaths := candidatesOf(d, CleanupBreath); len(breaths) != 0 {
		t.Errorf("breaths = %+v, want none: the quiet stretches are under the floor", breaths)
	}
}

func TestCleanupCallsDigitalSilenceDeadAirAndAHummedSoundNoBreath(t *testing.T) {
	hum := sine(cleanupRate, 0.4, 150, -38, 0) // quiet, but voiced: few zero crossings
	d := cleanupDiagnose(t, concat(speech(1), silence(cleanupRate, 1), speech(1), hum, roomTone(cleanupRate, 0.6, -65, 19), speech(1)), DiagnosticInput{})
	silences := candidatesOf(d, CleanupSilence)
	if len(silences) != 2 || silences[0].Confidence != 0.8 || silences[0].LeveldBFS != nil || !strings.Contains(silences[0].Why, "digital silence") {
		t.Fatalf("silences = %+v, want the digital silence first, at 0.8 with no level", silences)
	}
	if breaths := candidatesOf(d, CleanupBreath); len(breaths) != 0 {
		t.Fatalf("breaths = %+v, want none: a hum is not noise-like", breaths)
	}
}

func TestCleanupHasNoBreathWithoutASpeechLevelAndNoCutInAShortPause(t *testing.T) {
	d := cleanupDiagnose(t, concat(roomTone(cleanupRate, 0.4, -40, 23), roomTone(cleanupRate, 0.3, -65, 29)), DiagnosticInput{})
	if d.Cleanup.SpeechLeveldBFS != nil || len(candidatesOf(d, CleanupBreath)) != 0 {
		t.Fatalf("speech level %v, breaths %+v: want neither in audio with no read", d.Cleanup.SpeechLeveldBFS, candidatesOf(d, CleanupBreath))
	}
	if silences := candidatesOf(d, CleanupSilence); len(silences) != 0 {
		t.Fatalf("silences = %+v, want none: a 0.3 s pause keeps its two 0.15 s holds and leaves nothing to cut", silences)
	}
}

func TestCleanupFindingsAreReviewableCandidatesWithAConfirmedAction(t *testing.T) {
	breath := roomTone(cleanupRate, 0.4, -40, 5)
	mono := concat(speech(1.5), breath, roomTone(cleanupRate, 0.8, -65, 9), speech(1.5))
	whole := cleanupDiagnose(t, mono, DiagnosticInput{})
	for _, finding := range whole.Findings() {
		if finding.Category == findings.CategorySilenceCleanup {
			t.Fatalf("Findings raised a cleanup candidate %+v; only CleanupFindings does", finding)
		}
	}
	listed := whole.CleanupFindings()
	if len(listed) != 2 {
		t.Fatalf("%d cleanup findings, want the breath and the silence", len(listed))
	}
	for _, finding := range listed {
		if err := finding.Validate(); err != nil {
			t.Fatalf("finding %+v does not validate: %v", finding, err)
		}
		action := finding.SuggestedAction
		if finding.Category != findings.CategorySilenceCleanup || finding.Severity != findings.SeverityInfo || finding.Confidence == nil ||
			action == nil || action.Kind != "split_and_trim" || !action.RequiresConfirmation {
			t.Fatalf("finding = %+v, want an info silence_cleanup candidate with a confirmed split_and_trim", finding)
		}
		for _, key := range []string{"class", "silence_floor_dbfs", "pad_seconds", "min_breath_seconds", "breath_below_speech_db", "click_above_silence_db", "source_kind"} {
			if _, ok := finding.Evidence[key]; !ok {
				t.Fatalf("finding evidence %v lacks %q", finding.Evidence, key)
			}
		}
	}

	// A range reports times, cuts and ids in the source file, as the other diagnostics do.
	ranged := cleanupDiagnose(t, concat(speech(2), mono), DiagnosticInput{Range: &Range{StartSeconds: 2, LengthSeconds: 5}})
	shifted := ranged.CleanupFindings()
	if len(shifted) != 2 {
		t.Fatalf("%d cleanup findings in the range, want 2", len(shifted))
	}
	for i := range listed {
		wantCut := listed[i].SuggestedAction.Parameters["cut_start_seconds"].(float64) + 2
		if got := shifted[i].SuggestedAction.Parameters["cut_start_seconds"].(float64); !near(got, wantCut, 0.02) || !near(shifted[i].TimeRange.Start, listed[i].TimeRange.Start+2, 0.02) {
			t.Fatalf("ranged finding %d cut at %v, starting %v; want the whole-file cut and start 2 s later", i, got, shifted[i].TimeRange.Start)
		}
	}
}

func TestCleanupOptionsAreCheckedAndDefaultWhenUnset(t *testing.T) {
	if got, err := (CleanupOptions{}).resolve(); err != nil || got != DefaultCleanupOptions() {
		t.Fatalf("unset options = %+v, %v; want the defaults", got, err)
	}
	for name, opts := range map[string]CleanupOptions{
		"negative hold":            {PadSeconds: -1, MinBreathSeconds: 0.1, MaxBreathSeconds: 1, BreathBelowSpeechDB: 12, ClickAboveSilenceDB: 30},
		"breath range upside down": {PadSeconds: 0.1, MinBreathSeconds: 1, MaxBreathSeconds: 0.5, BreathBelowSpeechDB: 12, ClickAboveSilenceDB: 30},
		"no breath margin":         {PadSeconds: 0.1, MinBreathSeconds: 0.1, MaxBreathSeconds: 1, ClickAboveSilenceDB: 30},
		"NaN click height":         {PadSeconds: 0.1, MinBreathSeconds: 0.1, MaxBreathSeconds: 1, BreathBelowSpeechDB: 12, ClickAboveSilenceDB: math.NaN()},
	} {
		if _, err := opts.resolve(); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	raw := encodeWAV(t, 1, cleanupRate, 16, false, speech(0.5))
	if _, err := Diagnose(t.Context(), strings.NewReader(string(raw)), DiagnosticInput{SourceKind: SourceRawRecording, Options: DefaultDiagnosticOptions(), Cleanup: CleanupOptions{PadSeconds: 5}}); err == nil {
		t.Fatal("Diagnose accepted a 5 s hold")
	}
}

func TestCleanupAcceptsNarratorOptionsAndRefusesAZeroBreath(t *testing.T) {
	custom := CleanupOptions{PadSeconds: 0.2, MinBreathSeconds: 0.1, MaxBreathSeconds: 1, BreathBelowSpeechDB: 10, ClickAboveSilenceDB: 25}
	if got, err := custom.resolve(); err != nil || got != custom {
		t.Fatalf("custom options = %+v, %v; want them kept", got, err)
	}
	custom.MinBreathSeconds = 0
	if _, err := custom.resolve(); err == nil {
		t.Fatal("a zero minimum breath was accepted")
	}
}

func TestCleanupHeightAndFlanksDecideAClick(t *testing.T) {
	spike := func(amplitude float64) []float64 {
		room := roomTone(cleanupRate, 1.5, -65, 31)
		at := int(0.7 * cleanupRate)
		for i := range 88 {
			room[at+i] = amplitude
		}
		return room
	}
	quiet := cleanupDiagnose(t, concat(speech(1), spike(0.5), speech(1)), DiagnosticInput{Cleanup: CleanupOptions{PadSeconds: 0.15, MinBreathSeconds: 0.12, MaxBreathSeconds: 0.9, BreathBelowSpeechDB: 12, ClickAboveSilenceDB: 80}})
	if clicks := candidatesOf(quiet, CleanupClick); len(clicks) != 0 {
		t.Fatalf("clicks = %+v, want none: 80 dB above the silence is more than the burst stands", clicks)
	}
	// A burst 30 ms after the read ends has speech within its flank, so it is the word's tail, not a click.
	room := roomTone(cleanupRate, 1, -65, 37)
	for i := range 88 {
		room[int(0.03*cleanupRate)+i] = 0.5
	}
	if clicks := candidatesOf(cleanupDiagnose(t, concat(speech(1), room, speech(1)), DiagnosticInput{}), CleanupClick); len(clicks) != 0 {
		t.Fatalf("clicks = %+v, want none beside speech", clicks)
	}
	loud := cleanupDiagnose(t, concat(speech(1), spike(0.5), speech(1)), DiagnosticInput{})
	for _, finding := range loud.CleanupFindings() {
		if finding.Evidence["class"] == CleanupClick {
			if _, ok := finding.Evidence["peak_dbfs"]; !ok {
				t.Fatalf("click evidence %v lacks its peak", finding.Evidence)
			}
			return
		}
	}
	t.Fatal("no click finding")
}
