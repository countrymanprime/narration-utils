package stages

import (
	"testing"
	"time"
)

func TestStageNextAdvancesOneEvaluatedStage(t *testing.T) {
	cases := []struct {
		stage  Stage
		want   Stage
		wantOK bool
	}{
		{StageNotStarted, "", false},
		{StageRecording, StageEditing, true},
		{StageEditing, StageProofing, true},
		{StageProofing, StageFinalized, true},
		{StageFinalized, "", false},
		{Stage("proofed"), "", false},
		{Stage(""), "", false},
	}
	for _, tc := range cases {
		got, ok := tc.stage.Next()
		if got != tc.want || ok != tc.wantOK {
			t.Errorf("%q.Next() = (%q, %v), want (%q, %v)", tc.stage, got, ok, tc.want, tc.wantOK)
		}
	}
}

func TestSignalValidate(t *testing.T) {
	valid := Signal{ID: "recording.text_present", Stage: StageRecording, State: SignalMet}
	cases := []struct {
		name    string
		mutate  func(Signal) Signal
		wantErr bool
	}{
		{"met is valid", func(s Signal) Signal { return s }, false},
		{"not_met is valid", func(s Signal) Signal { s.State = SignalNotMet; return s }, false},
		{"unknown with a cause is valid", func(s Signal) Signal {
			s.State, s.Cause = SignalUnknown, CauseStale
			return s
		}, false},
		{"unknown without a cause", func(s Signal) Signal { s.State = SignalUnknown; return s }, true},
		{"unknown with an invented cause", func(s Signal) Signal {
			s.State, s.Cause = SignalUnknown, UnknownCause("tired")
			return s
		}, true},
		{"met with a cause", func(s Signal) Signal { s.Cause = CauseStale; return s }, true},
		{"invented state", func(s Signal) Signal { s.State = SignalState("maybe"); return s }, true},
		{"empty state", func(s Signal) Signal { s.State = ""; return s }, true},
		{"id of another stage", func(s Signal) Signal { s.ID = "editing.breaths"; return s }, true},
		{"id with no name", func(s Signal) Signal { s.ID = "recording."; return s }, true},
		{"id with no stage prefix", func(s Signal) Signal { s.ID = "text_present"; return s }, true},
		{"not_started is not evaluated", func(s Signal) Signal {
			s.ID, s.Stage = "not_started.x", StageNotStarted
			return s
		}, true},
		{"finalized is not evaluated", func(s Signal) Signal {
			s.ID, s.Stage = "finalized.x", StageFinalized
			return s
		}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.mutate(valid).Validate()
			if (err != nil) != tc.wantErr {
				t.Fatalf("Validate() error = %v, wantErr %v", err, tc.wantErr)
			}
		})
	}
}

func TestEveryCauseIsValidOnAnUnknownSignal(t *testing.T) {
	causes := []UnknownCause{
		CauseNeverAnalyzed, CauseStale, CauseIncompleteRun, CauseAnalysisRunning,
		CauseUnmappedTrack, CauseUnconfirmedMapping, CauseMultipleTracks,
		CauseMeasurementUnavailable, CauseProjectUnreadable, CauseProviderError,
	}
	if len(causes) != len(knownCauses) {
		t.Fatalf("test lists %d causes, package knows %d", len(causes), len(knownCauses))
	}
	for _, cause := range causes {
		signal := UnknownSignal("proofing.pickups", StageProofing, cause, "why")
		if err := signal.Validate(); err != nil {
			t.Errorf("cause %q: %v", cause, err)
		}
	}
}

func TestUnknownSignalHasEmptyNotNilCollections(t *testing.T) {
	signal := UnknownSignal("editing.clicks", StageEditing, CauseNeverAnalyzed, "not analyzed")
	if signal.Evidence == nil || signal.Basis.LedgerRecordIDs == nil {
		t.Fatalf("UnknownSignal must encode empty arrays, not null: %+v", signal)
	}
	if !signal.ComputedAt.Equal(time.Time{}) {
		t.Fatalf("UnknownSignal must not invent a computedAt: %v", signal.ComputedAt)
	}
}
