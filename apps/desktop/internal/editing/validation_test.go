package editing

import (
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// passingRun is a held-out result that clears RecallTarget in every
// condition, for tests that need a record the gate would accept.
func passingRun() []ConditionResult {
	return []ConditionResult{
		{Condition: "studio", TruePositives: 19, Labels: 20, Candidates: 22},
		{Condition: "noisy_room", TruePositives: 18, Labels: 20, Candidates: 25},
	}
}

func TestIsValidatedNeedsAPermissionedRunAtTargetInEveryCondition(t *testing.T) {
	failingCondition := passingRun()
	failingCondition[1].TruePositives = 17 // 0.85 in one condition, 0.925 overall
	cases := []struct {
		name    string
		record  DetectorValidation
		id, ver string
		want    bool
	}{
		{"permissioned, every condition at target", DetectorValidation{AnalyzerID: AnalyzerClick, AnalyzerVersion: "v9", Corpus: CorpusPermissioned, HeldOut: passingRun()}, AnalyzerClick, "v9", true},
		{"another version of the same detector", DetectorValidation{AnalyzerID: AnalyzerClick, AnalyzerVersion: "v9", Corpus: CorpusPermissioned, HeldOut: passingRun()}, AnalyzerClick, "v10", false},
		{"the same version of another class", DetectorValidation{AnalyzerID: AnalyzerClick, AnalyzerVersion: "v9", Corpus: CorpusPermissioned, HeldOut: passingRun()}, AnalyzerBreath, "v9", false},
		{"synthetic audio is never a validation (Q10)", DetectorValidation{AnalyzerID: AnalyzerClick, AnalyzerVersion: "v9", Corpus: CorpusSynthetic, HeldOut: passingRun()}, AnalyzerClick, "v9", false},
		{"one condition below target", DetectorValidation{AnalyzerID: AnalyzerClick, AnalyzerVersion: "v9", Corpus: CorpusPermissioned, HeldOut: failingCondition}, AnalyzerClick, "v9", false},
		{"no held-out run at all", DetectorValidation{AnalyzerID: AnalyzerClick, AnalyzerVersion: "v9", Corpus: CorpusPermissioned}, AnalyzerClick, "v9", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsValidated([]DetectorValidation{tc.record}, tc.id, tc.ver); got != tc.want {
				t.Fatalf("IsValidated() = %v, want %v", got, tc.want)
			}
		})
	}
}

// TestShippedDetectorsAreGatedOff is Phase 4's outcome on main: neither the
// click nor the breath detector has a permissioned held-out run at target, so
// both ship gated off. A change that opens either gate has to change this
// test, on purpose, next to a recorded run.
func TestShippedDetectorsAreGatedOff(t *testing.T) {
	records := DetectorValidations()
	for _, class := range []struct{ id, version string }{{AnalyzerClick, ClickAnalyzerVersion}, {AnalyzerBreath, BreathAnalyzerVersion}} {
		if IsValidated(records, class.id, class.version) {
			t.Errorf("%s %s is validated; Phase 4 found no permissioned run at target", class.id, class.version)
		}
		found := false
		for _, record := range records {
			if record.AnalyzerID == class.id && record.AnalyzerVersion == class.version {
				found = true
			}
		}
		if !found {
			t.Errorf("no recorded validation run for %s %s", class.id, class.version)
		}
	}
}

func coveredClassInput(id, analyzerID, version string, validations []DetectorValidation) ClassSignalInput {
	return ClassSignalInput{
		ID: id, AnalyzerID: analyzerID, AnalyzerVersion: version, Validations: validations,
		Coverage: baseCoverage(), ComputedAt: time.Now().UTC(),
	}
}

// TestClassSignalGateTurnsAnUnvalidatedVersionUnknown is Phase 4's success
// signal: "the gate demonstrably turns a signal to unknown for an unvalidated
// version." The same fully covered, clean input is met under a validated
// version and unknown under any other.
func TestClassSignalGateTurnsAnUnvalidatedVersionUnknown(t *testing.T) {
	validated := []DetectorValidation{{AnalyzerID: AnalyzerClick, AnalyzerVersion: "click-test", Corpus: CorpusPermissioned, HeldOut: passingRun()}}

	met := ClassSignal(coveredClassInput(ClickSignalID, AnalyzerClick, "click-test", validated))
	if met.State != stages.SignalMet {
		t.Fatalf("validated version: state = %q, want met (reason: %s)", met.State, met.Reason)
	}
	if err := met.Validate(); err != nil {
		t.Fatalf("Validate(): %v", err)
	}

	gated := ClassSignal(coveredClassInput(ClickSignalID, AnalyzerClick, "click-other", validated))
	if gated.State != stages.SignalUnknown || gated.Cause != stages.CauseMeasurementUnavailable {
		t.Fatalf("unvalidated version: state=%q cause=%q, want unknown/measurement_unavailable", gated.State, gated.Cause)
	}
	if !strings.Contains(gated.Reason, "not validated") {
		t.Fatalf("reason %q does not say the detector is not validated", gated.Reason)
	}
	if err := gated.Validate(); err != nil {
		t.Fatalf("Validate(): %v", err)
	}
}

func TestClassSignalNotMetWithAnOpenCandidate(t *testing.T) {
	validated := []DetectorValidation{{AnalyzerID: AnalyzerBreath, AnalyzerVersion: "breath-test", Corpus: CorpusPermissioned, HeldOut: passingRun()}}
	in := coveredClassInput(BreathSignalID, AnalyzerBreath, "breath-test", validated)
	in.Candidates = []CandidateStatus{
		{Open: true, Evidence: stages.Evidence{Kind: "candidate", Label: "Candidate"}},
		{Open: false, Evidence: stages.Evidence{Kind: "candidate", Label: "Candidate"}},
	}
	signal := ClassSignal(in)
	if signal.State != stages.SignalNotMet {
		t.Fatalf("state = %q, want not_met (reason: %s)", signal.State, signal.Reason)
	}
	in.Candidates = in.Candidates[1:]
	if signal := ClassSignal(in); signal.State != stages.SignalMet {
		t.Fatalf("only a dismissed candidate left: state = %q, want met", signal.State)
	}
}

// TestClassSignalNeverMetFromUncoveredInput: a validated version still needs
// every item current, a confirmed mapping and no running scan.
func TestClassSignalNeverMetFromUncoveredInput(t *testing.T) {
	validated := []DetectorValidation{{AnalyzerID: AnalyzerClick, AnalyzerVersion: "click-test", Corpus: CorpusPermissioned, HeldOut: passingRun()}}
	for _, mapping := range []MappingState{MappingOK, MappingUnmapped, MappingMultiple, MappingTrackMissing} {
		for _, state := range []evidence.EvaluatorState{evidence.StateCurrent, evidence.StateStale, evidence.StateNever} {
			for _, running := range []bool{false, true} {
				for _, version := range []string{"click-test", ClickAnalyzerVersion} {
					in := coveredClassInput(ClickSignalID, AnalyzerClick, version, validated)
					in.Coverage.Mapping, in.Running = mapping, running
					in.Coverage.Items = []ItemCoverage{{GUID: "item-1", State: state, Reasons: []evidence.EvaluatorReason{evidence.ReasonAnalyzerChanged}}}
					uncovered := mapping != MappingOK || state != evidence.StateCurrent || running || version != "click-test"
					if signal := ClassSignal(in); uncovered && signal.State == stages.SignalMet {
						t.Fatalf("met from uncovered input: mapping=%v state=%v running=%v version=%v", mapping, state, running, version)
					}
				}
			}
		}
	}
}
