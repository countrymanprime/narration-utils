package stages

import (
	"fmt"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"
)

var evaluatedStages = []Stage{StageRecording, StageEditing, StageProofing}

// signalFor builds a contract-valid signal in the given state, with a basis
// that varies by id so basis keys differ between signals.
func signalFor(stage Stage, name string, state SignalState) Signal {
	id := string(stage) + "." + name
	signal := Signal{
		ID:     id,
		Stage:  stage,
		State:  state,
		Reason: "reason for " + id,
		Evidence: []Evidence{
			{Kind: "coverage", Label: "Present", Value: "100%"},
		},
		Basis: Basis{
			LedgerRecordIDs:    []string{"rec-" + name},
			Fingerprint:        "fp-" + name,
			ProjectFileModTime: time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC),
		},
		ComputedAt: time.Date(2026, 9, 2, 8, 0, 0, 0, time.UTC),
	}
	if state == SignalUnknown {
		signal.Cause = CauseNeverAnalyzed
	}
	return signal
}

func chapterAt(stage Stage) ChapterContext {
	return ChapterContext{DocumentID: "doc-1", ChapterID: "c-0003", Title: "Chapter Three", Status: stage}
}

// combinations returns every assignment of met/not_met/unknown to n signals.
func combinations(n int) [][]SignalState {
	states := []SignalState{SignalMet, SignalNotMet, SignalUnknown}
	result := [][]SignalState{{}}
	for range n {
		next := make([][]SignalState, 0, len(result)*len(states))
		for _, prefix := range result {
			for _, state := range states {
				next = append(next, append(slices.Clone(prefix), state))
			}
		}
		result = next
	}
	return result
}

// expectedVerdict is the PRD's verdict rule stated directly: any not_met is
// not_ready, else any unknown is unknown, else recommended.
func expectedVerdict(states []SignalState) Verdict {
	if slices.Contains(states, SignalNotMet) {
		return VerdictNotReady
	}
	if slices.Contains(states, SignalUnknown) {
		return VerdictUnknown
	}
	return VerdictRecommended
}

func TestEvaluateEveryStateCombinationForOneToFourRequiredSignals(t *testing.T) {
	total := 0
	for _, stage := range evaluatedStages {
		target, _ := stage.Next()
		for n := 1; n <= 4; n++ {
			for _, states := range combinations(n) {
				total++
				required := make([]string, n)
				signals := make([]Signal, n)
				for i, state := range states {
					signals[i] = signalFor(stage, fmt.Sprintf("s%d", i), state)
					required[i] = signals[i].ID
				}
				got := Evaluate(Input{Chapter: chapterAt(stage), Required: required, Signals: signals})

				name := fmt.Sprintf("%s %v", stage, states)
				if got.Verdict != expectedVerdict(states) {
					t.Errorf("%s: verdict %q, want %q", name, got.Verdict, expectedVerdict(states))
				}
				if slices.Contains(states, SignalUnknown) && got.Verdict == VerdictRecommended {
					t.Errorf("%s: an unknown signal was treated as met", name)
				}
				if got.From != stage || got.Target != target {
					t.Errorf("%s: from %q target %q, want %q %q", name, got.From, got.Target, stage, target)
				}
				if len(got.Signals) != n {
					t.Errorf("%s: %d signals in assessment, want %d", name, len(got.Signals), n)
				}
				if got.BasisKey == "" {
					t.Errorf("%s: an evaluated verdict needs a basis key", name)
				}
			}
		}
	}
	// 3 stages x (3 + 9 + 27 + 81) combinations.
	if total != 360 {
		t.Fatalf("ran %d combinations, want 360", total)
	}
}

func TestEvaluateNeverRecommendsWithoutAnEvaluatedStageOrRequiredSignals(t *testing.T) {
	met := func(stage Stage) []Signal { return []Signal{signalFor(stage, "a", SignalMet)} }
	cases := []struct {
		name       string
		input      Input
		wantReason NoneReason
		wantTarget Stage
	}{
		{"not_started", Input{Chapter: chapterAt(StageNotStarted), Required: []string{"not_started.a"}}, NoneStageNotEvaluated, ""},
		{"finalized", Input{Chapter: chapterAt(StageFinalized), Required: []string{"finalized.a"}}, NoneStageNotEvaluated, ""},
		{"unknown stored status", Input{Chapter: chapterAt(Stage("proofed")), Required: []string{"proofed.a"}}, NoneStageNotEvaluated, ""},
		{"empty status", Input{Chapter: chapterAt(""), Required: []string{".a"}}, NoneStageNotEvaluated, ""},
		{"recording, required set empty", Input{Chapter: chapterAt(StageRecording), Signals: met(StageRecording)}, NoneNoRequiredSignals, StageEditing},
		{"editing, required set empty", Input{Chapter: chapterAt(StageEditing), Required: []string{}, Signals: met(StageEditing)}, NoneNoRequiredSignals, StageProofing},
		{"proofing, required set empty", Input{Chapter: chapterAt(StageProofing), Signals: met(StageProofing)}, NoneNoRequiredSignals, StageFinalized},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Evaluate(tc.input)
			if got.Verdict != VerdictNone || got.NoneReason != tc.wantReason {
				t.Fatalf("verdict %q reason %q, want none %q", got.Verdict, got.NoneReason, tc.wantReason)
			}
			if got.Target != tc.wantTarget || got.BasisKey != "" || len(got.Signals) != 0 {
				t.Fatalf("a none verdict carries no basis or signals: %+v", got)
			}
			if got.Signals == nil || got.Causes == nil {
				t.Fatalf("collections must be empty, not nil: %+v", got)
			}
		})
	}
}

func TestEvaluateReplacesMissingInvalidAndDuplicateSignalsWithProviderError(t *testing.T) {
	good := signalFor(StageRecording, "b", SignalMet)
	invalid := signalFor(StageRecording, "a", SignalMet)
	invalid.Cause = CauseStale // a cause on a met signal breaks the contract
	duplicateMet := signalFor(StageRecording, "c", SignalMet)
	duplicateNotMet := signalFor(StageRecording, "c", SignalNotMet)

	cases := []struct {
		name    string
		signals []Signal
		wantID  string
	}{
		{"missing", []Signal{good}, "recording.a"},
		{"invalid", []Signal{invalid, good}, "recording.a"},
		{"duplicate", []Signal{good, duplicateMet, duplicateNotMet, signalFor(StageRecording, "a", SignalMet)}, "recording.c"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			required := []string{"recording.a", "recording.b"}
			if tc.wantID == "recording.c" {
				required = append(required, "recording.c")
			}
			got := Evaluate(Input{Chapter: chapterAt(StageRecording), Required: required, Signals: tc.signals})
			if got.Verdict != VerdictUnknown {
				t.Fatalf("verdict %q, want unknown", got.Verdict)
			}
			replaced := findSignal(t, got.Signals, tc.wantID)
			if replaced.State != SignalUnknown || replaced.Cause != CauseProviderError {
				t.Fatalf("%s: got %+v, want unknown provider_error", tc.wantID, replaced)
			}
			if replaced.Reason == "" {
				t.Fatal("a replaced signal must say why")
			}
			if !slices.Equal(got.Causes, []UnknownCause{CauseProviderError}) {
				t.Fatalf("causes %v", got.Causes)
			}
		})
	}
}

func TestEvaluateTreatsARequiredIDFromAnotherStageAsUnreported(t *testing.T) {
	got := Evaluate(Input{
		Chapter:  chapterAt(StageEditing),
		Required: []string{"recording.a"},
		Signals:  []Signal{signalFor(StageRecording, "a", SignalMet)},
	})
	if got.Verdict != VerdictUnknown {
		t.Fatalf("a signal of another stage satisfied a requirement: %+v", got)
	}
}

func TestEvaluateIgnoresSignalsThatAreNotRequired(t *testing.T) {
	got := Evaluate(Input{
		Chapter:  chapterAt(StageProofing),
		Required: []string{"proofing.pickups"},
		Signals: []Signal{
			signalFor(StageProofing, "pickups", SignalMet),
			signalFor(StageProofing, "loudness", SignalNotMet),
		},
	})
	if got.Verdict != VerdictRecommended || len(got.Signals) != 1 {
		t.Fatalf("an ignored signal changed the verdict: %+v", got)
	}
}

func TestEvaluateDeduplicatesAndSortsRequiredIDs(t *testing.T) {
	signals := []Signal{signalFor(StageEditing, "clicks", SignalMet), signalFor(StageEditing, "breaths", SignalMet)}
	got := Evaluate(Input{
		Chapter:  chapterAt(StageEditing),
		Required: []string{"editing.clicks", "editing.breaths", "editing.clicks"},
		Signals:  signals,
	})
	ids := []string{got.Signals[0].ID, got.Signals[1].ID}
	if len(got.Signals) != 2 || !slices.Equal(ids, []string{"editing.breaths", "editing.clicks"}) {
		t.Fatalf("signals %+v, want breaths then clicks once each", got.Signals)
	}
}

func TestEvaluateAppliesADismissalOnlyToItsOwnBasis(t *testing.T) {
	stage := StageRecording
	required := []string{"recording.text"}
	met := []Signal{signalFor(stage, "text", SignalMet)}
	recommended := Evaluate(Input{Chapter: chapterAt(stage), Required: required, Signals: met})
	if recommended.Verdict != VerdictRecommended {
		t.Fatalf("setup: %+v", recommended)
	}

	dismissed := Evaluate(Input{Chapter: chapterAt(stage), Required: required, Signals: met, DismissedBasisKeys: []string{"other", recommended.BasisKey}})
	if dismissed.Verdict != VerdictDismissed || dismissed.BasisKey != recommended.BasisKey {
		t.Fatalf("dismissed basis still recommended: %+v", dismissed)
	}

	changed := signalFor(stage, "text", SignalMet)
	changed.Basis.Fingerprint = "fp-after-edit"
	returned := Evaluate(Input{Chapter: chapterAt(stage), Required: required, Signals: []Signal{changed}, DismissedBasisKeys: []string{recommended.BasisKey}})
	if returned.Verdict != VerdictRecommended {
		t.Fatalf("a changed basis must bring the suggestion back: %+v", returned)
	}

	notMet := []Signal{signalFor(stage, "text", SignalNotMet)}
	notReady := Evaluate(Input{Chapter: chapterAt(stage), Required: required, Signals: notMet})
	stillNotReady := Evaluate(Input{Chapter: chapterAt(stage), Required: required, Signals: notMet, DismissedBasisKeys: []string{notReady.BasisKey}})
	if stillNotReady.Verdict != VerdictNotReady {
		t.Fatalf("a dismissal only hides a recommendation: %+v", stillNotReady)
	}
}

func TestEvaluateListsDistinctCausesInOrder(t *testing.T) {
	a := signalFor(StageRecording, "a", SignalUnknown)
	a.Cause = CauseUnmappedTrack
	b := signalFor(StageRecording, "b", SignalUnknown)
	b.Cause = CauseStale
	c := signalFor(StageRecording, "c", SignalUnknown)
	c.Cause = CauseStale
	got := Evaluate(Input{
		Chapter:  chapterAt(StageRecording),
		Required: []string{"recording.a", "recording.b", "recording.c", "recording.d"},
		Signals:  []Signal{a, b, c, signalFor(StageRecording, "d", SignalNotMet)},
	})
	want := []UnknownCause{CauseStale, CauseUnmappedTrack}
	if !slices.Equal(got.Causes, want) {
		t.Fatalf("causes %v, want %v", got.Causes, want)
	}
	if got.Verdict != VerdictNotReady {
		t.Fatalf("not_met outranks unknown: %q", got.Verdict)
	}
}

func TestEvaluateIsDeterministicAndOrderIndependent(t *testing.T) {
	stage := StageProofing
	signals := []Signal{
		signalFor(stage, "pickups", SignalMet),
		signalFor(stage, "loudness", SignalMet),
		signalFor(stage, "noise", SignalMet),
	}
	signals[0].Basis.LedgerRecordIDs = []string{"r2", "r1", "r3"}
	required := []string{"proofing.pickups", "proofing.loudness", "proofing.noise"}

	first := Evaluate(Input{Chapter: chapterAt(stage), Required: required, Signals: signals})
	second := Evaluate(Input{Chapter: chapterAt(stage), Required: required, Signals: signals})
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("same input, different assessment:\n%+v\n%+v", first, second)
	}

	reversedSignals := slices.Clone(signals)
	slices.Reverse(reversedSignals)
	reversedRequired := slices.Clone(required)
	slices.Reverse(reversedRequired)
	reshuffled := signalFor(stage, "pickups", SignalMet)
	reshuffled.Basis.LedgerRecordIDs = []string{"r3", "r1", "r2"}
	reversedSignals[2] = reshuffled
	reordered := Evaluate(Input{Chapter: chapterAt(stage), Required: reversedRequired, Signals: reversedSignals})
	if reordered.BasisKey != first.BasisKey || reordered.Verdict != first.Verdict {
		t.Fatalf("order changed the result: %q vs %q", reordered.BasisKey, first.BasisKey)
	}
}

func TestEvaluateDoesNotMutateItsInput(t *testing.T) {
	signal := signalFor(StageRecording, "a", SignalMet)
	signal.Basis.LedgerRecordIDs = []string{"r2", "r1"}
	required := []string{"recording.b", "recording.a"}
	signals := []Signal{signal}
	Evaluate(Input{Chapter: chapterAt(StageRecording), Required: required, Signals: signals})
	if !slices.Equal(required, []string{"recording.b", "recording.a"}) {
		t.Fatalf("required reordered: %v", required)
	}
	if !slices.Equal(signals[0].Basis.LedgerRecordIDs, []string{"r2", "r1"}) {
		t.Fatalf("record ids reordered: %v", signals[0].Basis.LedgerRecordIDs)
	}
}

func TestBasisKeyCoversOnlyTheIdentifyingFields(t *testing.T) {
	base := []Signal{signalFor(StageRecording, "a", SignalMet), signalFor(StageRecording, "b", SignalMet)}
	key := BasisKey("c-0001", StageEditing, base)
	if len(key) != 64 || strings.Trim(key, "0123456789abcdef") != "" {
		t.Fatalf("basis key %q is not a hex SHA-256", key)
	}

	same := func(name string, change func([]Signal) []Signal) {
		t.Helper()
		if got := BasisKey("c-0001", StageEditing, change(clone(base))); got != key {
			t.Errorf("%s changed the basis key", name)
		}
	}
	differs := func(name, chapter string, target Stage, change func([]Signal) []Signal) {
		t.Helper()
		if got := BasisKey(chapter, target, change(clone(base))); got == key {
			t.Errorf("%s did not change the basis key", name)
		}
	}
	unchanged := func(s []Signal) []Signal { return s }

	same("computedAt", func(s []Signal) []Signal { s[0].ComputedAt = time.Now(); return s })
	same("project file mtime", func(s []Signal) []Signal { s[1].Basis.ProjectFileModTime = time.Now(); return s })
	same("reason", func(s []Signal) []Signal { s[0].Reason = "reworded"; return s })
	same("evidence", func(s []Signal) []Signal { s[0].Evidence = nil; return s })
	same("signal order", func(s []Signal) []Signal { slices.Reverse(s); return s })
	if BasisKey("c-0001", StageEditing, withRecords(base, "y", "x")) != BasisKey("c-0001", StageEditing, withRecords(base, "x", "y")) {
		t.Error("record id order changed the basis key")
	}

	differs("chapter", "c-0002", StageEditing, unchanged)
	differs("target", "c-0001", StageProofing, unchanged)
	differs("state", "c-0001", StageEditing, func(s []Signal) []Signal { s[0].State = SignalNotMet; return s })
	differs("fingerprint", "c-0001", StageEditing, func(s []Signal) []Signal { s[1].Basis.Fingerprint = "new"; return s })
	differs("record ids", "c-0001", StageEditing, func(s []Signal) []Signal {
		s[0].Basis.LedgerRecordIDs = append(s[0].Basis.LedgerRecordIDs, "extra")
		return s
	})
	differs("signal id", "c-0001", StageEditing, func(s []Signal) []Signal { s[0].ID = "recording.z"; return s })
	differs("a signal removed", "c-0001", StageEditing, func(s []Signal) []Signal { return s[:1] })
}

func TestBasisKeyFieldsCannotRunTogether(t *testing.T) {
	// "ab" + "c" and "a" + "bc" must not collide.
	one := Signal{ID: "recording.x", State: SignalMet, Basis: Basis{LedgerRecordIDs: []string{"ab", "c"}}}
	two := Signal{ID: "recording.x", State: SignalMet, Basis: Basis{LedgerRecordIDs: []string{"a", "bc"}}}
	if BasisKey("c", StageEditing, []Signal{one}) == BasisKey("c", StageEditing, []Signal{two}) {
		t.Fatal("record ids ran together in the basis key")
	}
}

func findSignal(t *testing.T, signals []Signal, id string) Signal {
	t.Helper()
	for _, signal := range signals {
		if signal.ID == id {
			return signal
		}
	}
	t.Fatalf("signal %q not in %+v", id, signals)
	return Signal{}
}

func clone(signals []Signal) []Signal {
	out := make([]Signal, len(signals))
	for i, signal := range signals {
		signal.Basis.LedgerRecordIDs = slices.Clone(signal.Basis.LedgerRecordIDs)
		out[i] = signal
	}
	return out
}

func withRecords(signals []Signal, ids ...string) []Signal {
	out := clone(signals)
	out[0].Basis.LedgerRecordIDs = ids
	return out
}
