package deliveryprofile

import (
	"math"
	"slices"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// acxRuleTable is the checked-in list of ACX's requirements (docs/research/acx-delivery-requirements.md): every row is a
// rule of the built-in profile, with how the app checks it and how it was verified. A requirement added to or dropped
// from the profile without this table changing fails here.
var acxRuleTable = []struct {
	id           string
	scope        Scope
	checkedBy    CheckedBy
	verification Verification
}{
	{"acx.rms", ScopeFile, CheckedMeasured, ToVerify},
	{"acx.peak", ScopeFile, CheckedMeasured, ToVerify},
	{"acx.noise_floor", ScopeFile, CheckedMeasured, ToVerify},
	{"acx.sample_rate", ScopeFile, CheckedMeasured, Verified},
	{"acx.file_length", ScopeFile, CheckedMeasured, Verified},
	{"acx.room_tone_head", ScopeFile, CheckedMeasured, Conflicting},
	{"acx.room_tone_tail", ScopeFile, CheckedMeasured, Verified},
	{"acx.format", ScopeFile, CheckedMeasured, Verified},
	{"acx.channels", ScopeBook, CheckedMeasured, ToVerify},
	{"acx.one_section_per_file", ScopeBook, CheckedListen, Verified},
	{"acx.credits", ScopeBook, CheckedNotYet, Verified},
	{"acx.retail_sample", ScopeBook, CheckedNotYet, Verified},
	{"acx.consistency", ScopeBook, CheckedListen, ToVerify},
}

func TestTheACXProfileHoldsEveryRequirementOfTheCheckedInTable(t *testing.T) {
	profile := ACX()
	if profile.Key() != "acx@2026-09" || profile.Title() != "ACX (September 2026)" || !profile.BuiltIn {
		t.Fatalf("profile = %s %q builtIn=%v, want acx@2026-09 \"ACX (September 2026)\" built in", profile.Key(), profile.Title(), profile.BuiltIn)
	}
	if len(profile.Rules) != len(acxRuleTable) {
		t.Fatalf("the profile has %d rules, the table %d", len(profile.Rules), len(acxRuleTable))
	}
	for i, want := range acxRuleTable {
		got := profile.Rules[i]
		if got.ID != want.id || got.Scope != want.scope || got.CheckedBy != want.checkedBy || got.Verification != want.verification {
			t.Errorf("rule %d = %s %s %s %s, want %s %s %s %s", i, got.ID, got.Scope, got.CheckedBy, got.Verification,
				want.id, want.scope, want.checkedBy, want.verification)
		}
	}
}

func TestEveryBuiltInRuleCitesItsSource(t *testing.T) {
	for _, profile := range BuiltIns() {
		for _, rule := range profile.Rules {
			source := rule.Source
			if source.Title == "" || !strings.HasPrefix(source.URL, "https://") || source.Requirement == "" || len(source.ReadOn) != len("2006-01-02") {
				t.Errorf("%s: source %+v lacks a title, an https URL, the requirement or the date it was read", rule.ID, source)
			}
			if rule.Verification != Verified && rule.VerificationNote == "" {
				t.Errorf("%s is %s with no note saying what is left to verify", rule.ID, rule.Verification)
			}
			if rule.CheckedBy != CheckedMeasured && rule.NotCheckedWhy == "" {
				t.Errorf("%s is %s with no reason the app does not check it", rule.ID, rule.CheckedBy)
			}
			if rule.Label == "" || rule.Level == "" || rule.Metric == "" {
				t.Errorf("%s lacks a label, a level or a metric", rule.ID)
			}
		}
	}
}

func TestACXIsANewCopyEachCall(t *testing.T) {
	first := ACX()
	*first.Rules[0].Min = 0
	first.Rules[3].OneOf[0] = 1
	if second := ACX(); *second.Rules[0].Min != -23 || second.Rules[3].OneOf[0] != 44100 {
		t.Fatal("changing one copy of the ACX profile changed the built-in")
	}
	clone := ACX().Clone()
	*clone.Rules[0].Max = 0
	if *ACX().Rules[0].Max != -18 {
		t.Fatal("a clone shares its numbers with the built-in")
	}
}

func v(x float64) *float64 { return &x }

// passingReport meets every file rule ACX's profile measures, each on its boundary where it has one.
func passingReport() measure.Report {
	return measure.Report{
		File: "C:/Renders/Chapter 01.wav", SampleRate: 44100, Channels: 1, DurationSeconds: 7200,
		IntegratedLUFS: v(-19), RMSdBFS: v(-23), SamplePeakdBFS: v(-3), TruePeakdBTP: v(-3), NoiseFloordBFS: v(-60),
		HeadRoomToneSeconds: v(0.5), TailRoomToneSeconds: v(5), HeadDigitalSilenceSeconds: v(0), TailDigitalSilenceSeconds: v(0),
	}
}

func resultsByRule(results []Result) map[string]Result {
	out := map[string]Result{}
	for _, result := range results {
		out[result.RuleID] = result
	}
	return out
}

func TestAFileOnEveryBoundaryMeetsEveryMeasuredRuleAndTheRestAreNotChecked(t *testing.T) {
	judgement := EvaluateFile(passingReport(), ACX())
	if len(judgement.Findings) != 0 {
		t.Fatalf("findings = %+v, want none", judgement.Findings)
	}
	got := resultsByRule(judgement.Results)
	for _, id := range []string{"acx.rms", "acx.peak", "acx.noise_floor", "acx.sample_rate", "acx.file_length", "acx.room_tone_head", "acx.room_tone_tail"} {
		if got[id].Status != StatusMet || got[id].Value == nil {
			t.Errorf("%s = %+v, want met with its value", id, got[id])
		}
	}
	for _, id := range []string{"acx.format"} {
		if got[id].Status != StatusNotChecked || got[id].Why == "" || got[id].Value != nil {
			t.Errorf("%s = %+v, want not checked with why and no value", id, got[id])
		}
	}
	if !strings.Contains(got["acx.format"].Why, "WAV") || !strings.Contains(got["acx.format"].Why, "measure the MP3") {
		t.Errorf("the MP3 rule's reason %q does not say the WAV render was measured", got["acx.format"].Why)
	}
	if len(judgement.Results) != 8 {
		t.Errorf("%d file results, want one per file rule (8)", len(judgement.Results))
	}
}

func TestAMissIsNotMetWithAnErrorFindingNamingTheRuleAndTheBound(t *testing.T) {
	report := passingReport()
	report.RMSdBFS, report.SamplePeakdBFS, report.SampleRate = v(-24.1), v(-2.4), 48000
	judgement := EvaluateFile(report, ACX())
	got := resultsByRule(judgement.Results)
	want := map[string]string{"acx.rms": ViolationBelowMin, "acx.peak": ViolationAboveMax, "acx.sample_rate": ViolationNotOneOf}
	for id, violation := range want {
		if got[id].Status != StatusNotMet || got[id].Violation != violation {
			t.Errorf("%s = %+v, want not met, %s", id, got[id], violation)
		}
	}
	if len(judgement.Findings) != 3 {
		t.Fatalf("%d findings, want 3: %+v", len(judgement.Findings), judgement.Findings)
	}
	for _, finding := range judgement.Findings {
		if finding.Category != findings.CategoryDeliveryQC || finding.Severity != findings.SeverityError || finding.Analyzer != "measure" {
			t.Errorf("finding %+v is not a delivery_qc error of the measure analyzer", finding)
		}
		if finding.Evidence["profile"] != "acx@2026-09" || finding.Evidence["rule"] == nil || finding.Evidence["value"] == nil {
			t.Errorf("finding evidence %v lacks the profile, the rule or the value", finding.Evidence)
		}
	}
	rms := judgement.Findings[0]
	if rms.Evidence["metric"] != "rms_dbfs" || rms.Evidence["limit_min"] != -23.0 || rms.Evidence["limit_max"] != -18.0 {
		t.Errorf("the RMS finding's evidence %v does not carry its metric and bounds", rms.Evidence)
	}
	if rate := judgement.Findings[2]; !slices.Equal(rate.Evidence["allowed"].([]float64), []float64{44100}) {
		t.Errorf("the sample-rate finding's evidence %v does not carry the allowed rates", rate.Evidence)
	}
}

func TestAnUnmeasurableValueIsNeverMet(t *testing.T) {
	report := passingReport()
	report.RMSdBFS, report.NoiseFloordBFS = nil, v(math.Inf(-1))
	judgement := EvaluateFile(report, ACX())
	got := resultsByRule(judgement.Results)
	for _, id := range []string{"acx.rms", "acx.noise_floor"} {
		if got[id].Status != StatusNotMeasurable || got[id].Value != nil {
			t.Errorf("%s = %+v, want not measurable with no value", id, got[id])
		}
	}
	if len(judgement.Findings) != 2 || judgement.Findings[0].Severity != findings.SeverityInfo || judgement.Findings[0].Evidence["available"] != false {
		t.Fatalf("findings = %+v, want two info findings saying the value was not available", judgement.Findings)
	}
}

func TestTruePeakAboveTheAdviceAddsAWarningButLeavesTheRuleMet(t *testing.T) {
	report := passingReport()
	report.SamplePeakdBFS, report.TruePeakdBTP = v(-3.2), v(-1.9)
	judgement := EvaluateFile(report, ACX())
	peak := resultsByRule(judgement.Results)["acx.peak"]
	if peak.Status != StatusMet || !strings.Contains(peak.Advice, "MP3") {
		t.Fatalf("peak = %+v, want met with the true-peak advice", peak)
	}
	if len(judgement.Findings) != 1 || judgement.Findings[0].Severity != findings.SeverityWarning ||
		judgement.Findings[0].Evidence["metric"] != "true_peak_dbtp" || judgement.Findings[0].Evidence["value"] != -1.9 {
		t.Fatalf("findings = %+v, want one true-peak warning", judgement.Findings)
	}
}

func TestARuleTurnedOffIsListedAsOffAndNeverJudged(t *testing.T) {
	profile := ACX().Clone()
	profile.ID, profile.BuiltIn, profile.Revision = "custom-1", false, 1
	profile.Rules[0].Off = true
	report := passingReport()
	report.RMSdBFS = v(-40)
	judgement := EvaluateFile(report, profile)
	if rms := resultsByRule(judgement.Results)["acx.rms"]; rms.Status != StatusOff || rms.Value != nil {
		t.Fatalf("rms = %+v, want off with no value", rms)
	}
	if len(judgement.Findings) != 0 {
		t.Fatalf("findings = %+v, want none for a rule turned off", judgement.Findings)
	}
}

func TestAnAdviceLevelRuleRaisesAWarningNotAnError(t *testing.T) {
	profile := ACX().Clone()
	profile.Rules[0].Level = LevelAdvice
	report := passingReport()
	report.RMSdBFS = v(-30)
	if got := EvaluateFile(report, profile).Findings; len(got) != 1 || got[0].Severity != findings.SeverityWarning {
		t.Fatalf("findings = %+v, want one warning", got)
	}
}

func TestAFindingKeepsItsIDAcrossProfileVersionsButNotAcrossProfiles(t *testing.T) {
	report := passingReport()
	report.RMSdBFS = v(-30)
	older := ACX()
	newer := ACX()
	newer.Version = "2027-03"
	custom := ACX().Clone()
	custom.ID, custom.BuiltIn = "custom-1", false
	a, b, c := EvaluateFile(report, older).Findings[0], EvaluateFile(report, newer).Findings[0], EvaluateFile(report, custom).Findings[0]
	if a.ID != b.ID {
		t.Errorf("the ID changed with the profile's version: %s then %s", a.ID, b.ID)
	}
	if a.ID == c.ID {
		t.Errorf("a custom profile's finding has the built-in's ID %s", a.ID)
	}
	if a.ID != findings.StableID("measure", report.File, "acx", "acx.rms", "out_of_range") {
		t.Errorf("ID %s is not StableID(measure, file, profile id, rule id, kind)", a.ID)
	}
}

func TestBookRulesJudgeTheSetOfFiles(t *testing.T) {
	mono := passingReport()
	stereo := passingReport()
	stereo.Channels = 2
	surround := passingReport()
	surround.Channels = 6
	cases := []struct {
		name      string
		reports   []measure.Report
		status    Status
		violation string
	}{
		{"all mono", []measure.Report{mono, mono}, StatusMet, ""},
		{"all stereo", []measure.Report{stereo}, StatusMet, ""},
		{"a mix", []measure.Report{mono, stereo}, StatusNotMet, ViolationDiffers},
		{"neither mono nor stereo", []measure.Report{surround}, StatusNotMet, ViolationNotOneOf},
		{"nothing measured", nil, StatusNotMeasurable, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := resultsByRule(EvaluateBook(tc.reports, ACX()))
			channels := got["acx.channels"]
			if channels.Status != tc.status || channels.Violation != tc.violation {
				t.Fatalf("channels = %+v, want %s %s", channels, tc.status, tc.violation)
			}
			for _, id := range []string{"acx.one_section_per_file", "acx.credits", "acx.retail_sample", "acx.consistency"} {
				if got[id].Status != StatusNotChecked || got[id].Why == "" {
					t.Errorf("%s = %+v, want not checked with why", id, got[id])
				}
			}
			if len(got) != 5 {
				t.Errorf("%d book results, want 5", len(got))
			}
		})
	}
}

func TestBuiltInLooksUpByIDAndVersion(t *testing.T) {
	if profile, ok := BuiltIn(Ref{ID: "acx"}); !ok || profile.Version != ACXVersion {
		t.Fatalf("BuiltIn(acx) = %s %v, want the newest ACX", profile.Key(), ok)
	}
	if _, ok := BuiltIn(Ref{ID: "acx", Version: "2020-01"}); ok {
		t.Fatal("an unknown version of ACX was found")
	}
	if _, ok := BuiltIn(Ref{ID: "findaway"}); ok {
		t.Fatal("a platform that ships no profile was found")
	}
	if Default().Key() != "acx@2026-09" {
		t.Fatalf("the default profile is %s, want acx@2026-09", Default().Key())
	}
}

func TestOnlyAMeasuredRangeIsAdjustable(t *testing.T) {
	want := map[string]bool{
		"acx.rms": true, "acx.peak": true, "acx.noise_floor": true, "acx.file_length": true, "acx.room_tone_head": true,
		"acx.room_tone_tail": true, "acx.format": true,
	}
	for _, rule := range ACX().Rules {
		if rule.Adjustable() != want[rule.ID] {
			t.Errorf("%s adjustable = %v, want %v", rule.ID, rule.Adjustable(), want[rule.ID])
		}
	}
}

func TestRoomToneIsJudgedFromTheMeasuredEdges(t *testing.T) {
	report := passingReport()
	report.HeadRoomToneSeconds, report.TailRoomToneSeconds = v(0.3), v(6)
	got := resultsByRule(EvaluateFile(report, ACX()).Results)
	if got["acx.room_tone_head"].Status != StatusNotMet || got["acx.room_tone_head"].Violation != ViolationBelowMin {
		t.Errorf("a 0.3 s head = %+v, want not met below the minimum", got["acx.room_tone_head"])
	}
	if got["acx.room_tone_tail"].Status != StatusNotMet || got["acx.room_tone_tail"].Violation != ViolationAboveMax {
		t.Errorf("a 6 s tail = %+v, want not met above the maximum", got["acx.room_tone_tail"])
	}

	report = passingReport()
	report.HeadRoomToneSeconds, report.TailRoomToneSeconds = nil, nil
	got = resultsByRule(EvaluateFile(report, ACX()).Results)
	for _, id := range []string{"acx.room_tone_head", "acx.room_tone_tail"} {
		if got[id].Status != StatusNotMeasurable {
			t.Errorf("%s with no reading in the file = %+v, want not measurable", id, got[id])
		}
	}
}

func TestDigitalSilenceAtAnEdgeIsAdviceBesideTheRoomToneRule(t *testing.T) {
	report := passingReport()
	report.HeadRoomToneSeconds, report.HeadDigitalSilenceSeconds = v(1), v(0.4)
	report.TailRoomToneSeconds, report.TailDigitalSilenceSeconds = v(2), v(2)
	judgement := EvaluateFile(report, ACX())
	got := resultsByRule(judgement.Results)
	for _, id := range []string{"acx.room_tone_head", "acx.room_tone_tail"} {
		if got[id].Status != StatusMet || !strings.Contains(got[id].Advice, "digital silence") {
			t.Errorf("%s = %+v, want met with the digital-silence advice", id, got[id])
		}
	}
	warnings := 0
	for _, finding := range judgement.Findings {
		if finding.Severity == findings.SeverityWarning && finding.Evidence["advice"] != nil {
			warnings++
		}
	}
	if warnings != 2 {
		t.Errorf("%d advice warnings, want one per edge", warnings)
	}
}

func mp3Report(cbr bool, bitrate int, average float64) measure.Report {
	return measure.Report{
		File: "C:/Renders/Chapter 01.mp3", SampleRate: 44100, Channels: 1, DurationSeconds: 1800, ClipRuns: []measure.ClipRun{},
		MP3: &measure.MP3Info{Version: "MPEG-1", Layer: 3, CBR: cbr, BitrateKbps: bitrate, AverageBitrateKbps: average,
			SampleRate: 44100, ChannelMode: "mono", Frames: 68906, DurationSeconds: 1800},
	}
}

func TestAnMP3IsJudgedOnItsContainerAndItsLevelsAreNotChecked(t *testing.T) {
	judgement := EvaluateFile(mp3Report(true, 192, 192), ACX())
	got := resultsByRule(judgement.Results)
	if got["acx.format"].Status != StatusMet || got["acx.format"].Value == nil || *got["acx.format"].Value != 192 {
		t.Errorf("a 192 kbps CBR MP3 = %+v, want the format met at 192", got["acx.format"])
	}
	for _, id := range []string{"acx.sample_rate", "acx.file_length"} {
		if got[id].Status != StatusMet {
			t.Errorf("%s on an MP3 = %+v, want met from its headers", id, got[id])
		}
	}
	for _, id := range []string{"acx.rms", "acx.peak", "acx.noise_floor", "acx.room_tone_head", "acx.room_tone_tail"} {
		if got[id].Status != StatusNotChecked || !strings.Contains(got[id].Why, "does not decode") {
			t.Errorf("%s on an MP3 = %+v, want not checked because it is not decoded", id, got[id])
		}
	}
	if len(judgement.Findings) != 0 {
		t.Errorf("findings = %+v, want none: nothing unmeasured on an MP3 is reported as missing", judgement.Findings)
	}
}

func TestAnMP3BelowTheBitrateOrNotCBRMissesTheFormatRule(t *testing.T) {
	low := resultsByRule(EvaluateFile(mp3Report(true, 128, 128), ACX()).Results)["acx.format"]
	if low.Status != StatusNotMet || low.Violation != ViolationBelowMin || *low.Value != 128 {
		t.Errorf("a 128 kbps CBR MP3 = %+v, want not met below the minimum", low)
	}
	judgement := EvaluateFile(mp3Report(false, 0, 201.4), ACX())
	vbr := resultsByRule(judgement.Results)["acx.format"]
	if vbr.Status != StatusNotMet || vbr.Violation != ViolationNotCBR || *vbr.Value != 201.4 {
		t.Errorf("a VBR MP3 averaging 201 kbps = %+v, want not met as not CBR with its average", vbr)
	}
	if len(judgement.Findings) != 1 || judgement.Findings[0].Evidence["violation"] != ViolationNotCBR || judgement.Findings[0].Severity != findings.SeverityError {
		t.Errorf("findings = %+v, want one error saying not CBR", judgement.Findings)
	}
}

func TestTheBookJudgesChannelsAcrossWAVAndMP3Files(t *testing.T) {
	stereoMP3 := mp3Report(true, 192, 192)
	stereoMP3.Channels = 2
	got := resultsByRule(EvaluateBook([]measure.Report{passingReport(), stereoMP3}, ACX()))
	if got["acx.channels"].Status != StatusNotMet || got["acx.channels"].Violation != ViolationDiffers {
		t.Errorf("a mono WAV beside a stereo MP3 = %+v, want the channels differing", got["acx.channels"])
	}
}
