package proofing

import (
	"context"
	"math"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

var measuredAt = time.Date(2026, 9, 26, 11, 30, 0, 0, time.UTC)

func bound(v float64) *float64 { return &v }

// testProfile is a custom profile with one required RMS rule, one advice peak
// rule and one turned-off noise-floor rule.
func testProfile() deliveryprofile.Profile {
	return deliveryprofile.Profile{ID: "custom-1", Revision: 3, Name: "Mine", Rules: []deliveryprofile.Rule{
		{ID: "r.rms", Label: "RMS", Scope: deliveryprofile.ScopeFile, Metric: "rms_dbfs", Unit: "dBFS", Min: bound(-23), Max: bound(-18), Level: deliveryprofile.LevelRequired, CheckedBy: deliveryprofile.CheckedMeasured},
		{ID: "r.peak", Label: "Peak", Scope: deliveryprofile.ScopeFile, Metric: "sample_peak_dbfs", Unit: "dBFS", Max: bound(-3), Level: deliveryprofile.LevelAdvice, CheckedBy: deliveryprofile.CheckedMeasured},
		{ID: "r.noise", Label: "Noise floor", Scope: deliveryprofile.ScopeFile, Metric: "noise_floor_dbfs", Unit: "dBFS", Max: bound(-60), Level: deliveryprofile.LevelRequired, CheckedBy: deliveryprofile.CheckedMeasured, Off: true},
		{ID: "r.channels", Label: "Channels", Scope: deliveryprofile.ScopeBook, Metric: "channels", OneOf: []float64{1, 2}, Level: deliveryprofile.LevelRequired, CheckedBy: deliveryprofile.CheckedMeasured},
	}}
}

func currentRender(report *measure.Report) RenderStatus {
	status := RenderStatus{
		State: RenderCurrent, Association: &RenderAssociation{Path: "/renders/chapter-one.wav"},
		RecordIDs: []string{"measure-1"}, Fingerprint: "render|items",
	}
	if report != nil {
		status.Measurement = &RenderMeasurement{RecordID: "measure-1", Report: *report, MeasuredAt: measuredAt}
	}
	return status
}

func reportWith(set func(*measure.Report)) *measure.Report {
	report := measure.Report{SampleRate: 44100, Channels: 1, DurationSeconds: 600, RMSdBFS: level(-20), SamplePeakdBFS: level(-4), NoiseFloordBFS: level(-65)}
	set(&report)
	return &report
}

func checkFor(metric string) DeliveryCheck {
	for _, check := range DeliveryChecks() {
		if check.Metric == metric {
			return check
		}
	}
	panic("no check for " + metric)
}

// TestDeliverySignalMatrix is Phase 5's success signal: in range is met, out of
// range is not_met with value and limit, and nil or non-finite values, no
// render, a stale render, a non-WAV render, a failed or missing measurement are
// unknown - never met.
func TestDeliverySignalMatrix(t *testing.T) {
	cases := []struct {
		name      string
		render    RenderStatus
		want      stages.SignalState
		wantCause stages.UnknownCause
		reason    string
	}{
		{"in range", currentRender(reportWith(func(*measure.Report) {})), stages.SignalMet, "", ""},
		{"at the inclusive bound", currentRender(reportWith(func(r *measure.Report) { r.RMSdBFS = level(-18) })), stages.SignalMet, "", ""},
		{"above the maximum", currentRender(reportWith(func(r *measure.Report) { r.RMSdBFS = level(-15.5) })), stages.SignalNotMet, "", "-15.5"},
		{"below the minimum", currentRender(reportWith(func(r *measure.Report) { r.RMSdBFS = level(-30) })), stages.SignalNotMet, "", "-23"},
		{"nil value (silence)", currentRender(reportWith(func(r *measure.Report) { r.RMSdBFS = nil })), stages.SignalUnknown, stages.CauseMeasurementUnavailable, ""},
		{"NaN value", currentRender(reportWith(func(r *measure.Report) { r.RMSdBFS = level(math.NaN()) })), stages.SignalUnknown, stages.CauseMeasurementUnavailable, ""},
		{"infinite value", currentRender(reportWith(func(r *measure.Report) { r.RMSdBFS = level(math.Inf(-1)) })), stages.SignalUnknown, stages.CauseMeasurementUnavailable, ""},
		{"an MP3 report", currentRender(reportWith(func(r *measure.Report) { r.MP3 = &measure.MP3Info{} })), stages.SignalUnknown, stages.CauseMeasurementUnavailable, ""},
		{"never measured", currentRender(nil), stages.SignalUnknown, stages.CauseNeverAnalyzed, "Measure"},
		{"measurement failed", RenderStatus{State: RenderCurrent, MeasurementFailed: true, Association: &RenderAssociation{Path: "/r.wav"}}, stages.SignalUnknown, stages.CauseIncompleteRun, ""},
		{"no render chosen", RenderStatus{State: RenderNone, Cause: stages.CauseNeverAnalyzed, Reason: "Choose the rendered file for this chapter."}, stages.SignalUnknown, stages.CauseNeverAnalyzed, "Choose the rendered file"},
		{"stale render", RenderStatus{State: RenderStale, Cause: stages.CauseStale, Reason: "The rendered file changed."}, stages.SignalUnknown, stages.CauseStale, ""},
		{"not a WAV", RenderStatus{State: RenderUnsupported, Cause: stages.CauseMeasurementUnavailable, Reason: "not a WAV"}, stages.SignalUnknown, stages.CauseMeasurementUnavailable, ""},
		{"render unreadable", RenderStatus{State: RenderMissing, Cause: stages.CauseMeasurementUnavailable, Reason: "gone"}, stages.SignalUnknown, stages.CauseMeasurementUnavailable, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			signal := DeliverySignal(DeliveryInput{Check: checkFor("rms_dbfs"), Profile: testProfile(), Render: tc.render, ComputedAt: rollupNow})
			if err := signal.Validate(); err != nil {
				t.Fatalf("Validate() = %v", err)
			}
			if signal.ID != "proofing.delivery.rms_dbfs" || signal.State != tc.want || signal.Cause != tc.wantCause {
				t.Fatalf("signal = %s %q/%q (%s), want %q/%q", signal.ID, signal.State, signal.Cause, signal.Reason, tc.want, tc.wantCause)
			}
			if !strings.Contains(signal.Reason, tc.reason) {
				t.Fatalf("reason %q should mention %q", signal.Reason, tc.reason)
			}
		})
	}
}

// TestDeliverySignalAdviceAndOffRules: an advice rule never gates (its miss is
// evidence), a rule turned off is not judged, and a metric with neither is not
// required, which reads unknown (the required set filter keeps it out).
func TestDeliverySignalAdviceAndOffRules(t *testing.T) {
	loudPeak := currentRender(reportWith(func(r *measure.Report) { r.SamplePeakdBFS = level(-1) }))
	peak := DeliverySignal(DeliveryInput{Check: checkFor("sample_peak_dbfs"), Profile: testProfile(), Render: loudPeak, ComputedAt: rollupNow})
	if peak.State != stages.SignalUnknown || !strings.Contains(peak.Reason, "not required") {
		t.Fatalf("an advice-only metric is not required: %q (%s)", peak.State, peak.Reason)
	}
	noise := DeliverySignal(DeliveryInput{Check: checkFor("noise_floor_dbfs"), Profile: testProfile(), Render: loudPeak, ComputedAt: rollupNow})
	if noise.State != stages.SignalUnknown || !strings.Contains(noise.Reason, "not required") {
		t.Fatalf("a rule turned off is not required: %q (%s)", noise.State, noise.Reason)
	}
	rms := DeliverySignal(DeliveryInput{Check: checkFor("rms_dbfs"), Profile: testProfile(), Render: loudPeak, ComputedAt: rollupNow})
	if rms.State != stages.SignalMet {
		t.Fatalf("rms = %q (%s)", rms.State, rms.Reason)
	}
}

// TestDeliverySignalEvidenceAndBasis: evidence names the render, the value and
// the limit; the basis changes with the profile's limits and with the
// measurement, not with the clock.
func TestDeliverySignalEvidenceAndBasis(t *testing.T) {
	span := 598.0
	in := DeliveryInput{Check: checkFor("rms_dbfs"), Profile: testProfile(), Render: currentRender(reportWith(func(r *measure.Report) { r.RMSdBFS = level(-15) })), ChapterSpan: &span, ComputedAt: rollupNow}
	signal := DeliverySignal(in)
	var texts []string
	for _, entry := range signal.Evidence {
		texts = append(texts, entry.Kind+": "+entry.Label+" = "+entry.Value)
	}
	joined := strings.Join(texts, "\n")
	for _, want := range []string{"render: Rendered file = chapter-one.wav", "measurement: RMS = -15.0 dBFS", "-23 to -18 dBFS", "length: ", "600.0 s", "598.0 s"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("evidence missing %q:\n%s", want, joined)
		}
	}
	if !slices.Equal(signal.Basis.LedgerRecordIDs, []string{"measure-1"}) || signal.Basis.Fingerprint == "" {
		t.Fatalf("basis = %+v", signal.Basis)
	}
	later := in
	later.ComputedAt = rollupNow.Add(time.Hour)
	if DeliverySignal(later).Basis.Fingerprint != signal.Basis.Fingerprint {
		t.Fatal("the clock must not change the basis")
	}
	stricter := in
	stricter.Profile = testProfile()
	stricter.Profile.Rules[0].Max = bound(-19)
	if DeliverySignal(stricter).Basis.Fingerprint == signal.Basis.Fingerprint {
		t.Fatal("a changed limit must change the basis")
	}
}

// TestRenderLengthSignal is Q9 C: shown as evidence always, gating only when the
// narrator sets a tolerance.
func TestRenderLengthSignal(t *testing.T) {
	span := 598.0
	render := currentRender(reportWith(func(*measure.Report) {})) // 600 s
	cases := []struct {
		name      string
		tolerance *float64
		span      *float64
		render    RenderStatus
		want      stages.SignalState
	}{
		{"no tolerance set", nil, &span, render, stages.SignalUnknown},
		{"within tolerance", bound(2), &span, render, stages.SignalMet},
		{"outside tolerance", bound(1), &span, render, stages.SignalNotMet},
		{"no chapter span", bound(2), nil, render, stages.SignalUnknown},
		{"not measured", bound(2), &span, currentRender(nil), stages.SignalUnknown},
		{"stale render", bound(2), &span, RenderStatus{State: RenderStale, Cause: stages.CauseStale, Reason: "changed"}, stages.SignalUnknown},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			signal := RenderLengthSignal(LengthInput{Tolerance: tc.tolerance, ChapterSpan: tc.span, Render: tc.render, ComputedAt: rollupNow})
			if err := signal.Validate(); err != nil {
				t.Fatal(err)
			}
			if signal.ID != RenderLengthSignalID || signal.State != tc.want {
				t.Fatalf("signal = %q (%s), want %q", signal.State, signal.Reason, tc.want)
			}
		})
	}
}

// TestFilterRequired is Q7 B and the required-check validation: a metric check
// is required only while the profile has a required, measured, file rule for
// it turned on; the length check only while a tolerance is set; pickups and
// other ids pass through.
func TestFilterRequired(t *testing.T) {
	provider := NewSignalProvider(Config{Profile: func() deliveryprofile.Profile { return testProfile() }})
	all := append([]string{"recording.text_present"}, provider.SignalIDs()...)
	got := provider.FilterRequired(all)
	want := []string{"recording.text_present", PickupsSignalID, "proofing.delivery.rms_dbfs"}
	if !slices.Equal(got, want) {
		t.Fatalf("FilterRequired() = %v, want %v", got, want)
	}
	withTolerance := NewSignalProvider(Config{Profile: func() deliveryprofile.Profile { return testProfile() }, LengthTolerance: func() *float64 { return bound(1) }})
	if got := withTolerance.FilterRequired(all); !slices.Contains(got, RenderLengthSignalID) {
		t.Fatalf("a set tolerance makes the length check required: %v", got)
	}
	acx := NewSignalProvider(Config{Profile: deliveryprofile.Default})
	got = acx.FilterRequired(acx.SignalIDs())
	for _, id := range []string{"proofing.delivery.rms_dbfs", "proofing.delivery.sample_peak_dbfs", "proofing.delivery.noise_floor_dbfs", "proofing.delivery.sample_rate", "proofing.delivery.duration_seconds", "proofing.delivery.head_room_tone_seconds", "proofing.delivery.tail_room_tone_seconds"} {
		if !slices.Contains(got, id) {
			t.Fatalf("ACX requires %s: %v", id, got)
		}
	}
	if slices.Contains(got, "proofing.delivery.integrated_lufs") || slices.Contains(got, "proofing.delivery.true_peak_dbtp") {
		t.Fatalf("ACX has no integrated-loudness or true-peak rule: %v", got)
	}
	none := NewSignalProvider(Config{})
	if got := none.FilterRequired(none.SignalIDs()); !slices.Equal(got, []string{PickupsSignalID}) {
		t.Fatalf("with no profile only pickups can be required: %v", got)
	}
}

// TestDeliveryCatalogueCoversTheProfiles: every file rule a shipped or legacy
// profile measures on a WAV has a check, and every check is a metric the
// profile evaluator can judge on a WAV report (never "not checked").
func TestDeliveryCatalogueCoversTheProfiles(t *testing.T) {
	metrics := map[string]bool{}
	for _, check := range DeliveryChecks() {
		metrics[check.Metric] = true
		probe := deliveryprofile.Profile{ID: "probe", Rules: []deliveryprofile.Rule{{ID: "p", Scope: deliveryprofile.ScopeFile, Metric: check.Metric, Max: bound(1e9), Level: deliveryprofile.LevelRequired, CheckedBy: deliveryprofile.CheckedMeasured}}}
		full := measure.Report{SampleRate: 44100, Channels: 1, DurationSeconds: 1, IntegratedLUFS: level(-20), RMSdBFS: level(-20), SamplePeakdBFS: level(-3), TruePeakdBTP: level(-3), NoiseFloordBFS: level(-60), HeadRoomToneSeconds: level(1), TailRoomToneSeconds: level(1)}
		if result := deliveryprofile.EvaluateFile(full, probe).Results[0]; result.Status != deliveryprofile.StatusMet {
			t.Fatalf("check %s: the evaluator answers %q on a WAV report", check.ID, result.Status)
		}
	}
	legacy, _ := deliveryprofile.ParseLegacyLimits(map[string]string{"integrated_lufs_min": "-23", "true_peak_dbtp_max": "-1", "rms_dbfs_max": "-18", "sample_peak_dbfs_max": "-3", "noise_floor_dbfs_max": "-60"})
	for _, profile := range append(deliveryprofile.BuiltIns(), legacy.Profile("legacy")) {
		for _, rule := range profile.Rules {
			if rule.Scope != deliveryprofile.ScopeFile || rule.CheckedBy != deliveryprofile.CheckedMeasured || rule.Metric == "mp3_format" {
				continue
			}
			if !metrics[rule.Metric] {
				t.Fatalf("profile %s rule %s measures %s, which has no proofing check", profile.ID, rule.ID, rule.Metric)
			}
		}
	}
}

// TestSignalProviderReportsDeliverySignals: the provider answers every declared
// id, reads the chapter's render through the store, and says in the pickups
// evidence which delivery checks the profile requires.
func TestSignalProviderReportsDeliverySignals(t *testing.T) {
	f := newRenderFixture(t)
	f.attest(t, f.render)
	if _, err := RecordRenderMeasurements(f.ledger, f.store, testDocument, f.dir, f.render, *reportWith(func(*measure.Report) {}), "", nil, measuredAt, measuredAt); err != nil {
		t.Fatal(err)
	}
	provider := NewSignalProvider(Config{Findings: f.findings, Renders: f.store, Profile: func() deliveryprofile.Profile { return testProfile() }})
	signals, err := provider.Signals(context.Background(), proofingChapter(), f.savedView())
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]stages.Signal{}
	for _, signal := range signals {
		if err := signal.Validate(); err != nil {
			t.Fatalf("%s: %v", signal.ID, err)
		}
		byID[signal.ID] = signal
	}
	if len(byID) != len(provider.SignalIDs()) {
		t.Fatalf("answered %d of %d declared ids", len(byID), len(provider.SignalIDs()))
	}
	if rms := byID["proofing.delivery.rms_dbfs"]; rms.State != stages.SignalMet {
		t.Fatalf("rms = %q (%s)", rms.State, rms.Reason)
	}
	scope := ""
	for _, entry := range byID[PickupsSignalID].Evidence {
		if entry.Kind == EvidenceDeliveryScope {
			scope = entry.Value
		}
	}
	if !strings.Contains(scope, "Mine") || !strings.Contains(scope, "RMS") {
		t.Fatalf("delivery scope evidence = %q", scope)
	}

	empty := NewSignalProvider(Config{Findings: f.findings})
	signals, _ = empty.Signals(context.Background(), proofingChapter(), f.savedView())
	for _, signal := range signals {
		for _, entry := range signal.Evidence {
			if entry.Kind == EvidenceDeliveryScope && !strings.Contains(entry.Value, "No delivery check is required") {
				t.Fatalf("no profile: %q", entry.Value)
			}
		}
	}
}

// TestSignalProviderSurvivesAnUnreadableRendersFile: a corrupt renders.json
// makes the delivery signals unknown with the reason; pickups still answer.
func TestSignalProviderSurvivesAnUnreadableRendersFile(t *testing.T) {
	f := newRenderFixture(t)
	f.attest(t, f.render)
	writeAudio(t, Dir(f.dir), "renders.json", "{broken")
	provider := NewSignalProvider(Config{Findings: f.findings, Renders: f.store, Profile: func() deliveryprofile.Profile { return testProfile() }})
	signals, err := provider.Signals(context.Background(), proofingChapter(), f.savedView())
	if err != nil {
		t.Fatal(err)
	}
	for _, signal := range signals {
		if signal.ID == "proofing.delivery.rms_dbfs" && (signal.State != stages.SignalUnknown || signal.Cause != stages.CauseProviderError) {
			t.Fatalf("rms = %q/%q (%s)", signal.State, signal.Cause, signal.Reason)
		}
	}
}
