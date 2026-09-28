package coverage

import (
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
)

// cascadeRequest is testRequest with the model cascade turned on (recording-check-model-cascade
// PRD Phase 4): Phase 5 resolves this from settings; these tests build it directly.
func cascadeRequest() Request {
	request := testRequest()
	request.Recheck = Transcription{Model: "large-v3-turbo"}
	return request
}

func TestModelCascadeNoSecondPassWhenNothingIsMissing(t *testing.T) {
	p := newTestProject(t)
	sidecar := &fakeSidecar{} // present defaults to 10: the first pass calls the chapter complete
	service := p.service(sidecar)

	state := run(t, service, cascadeRequest())

	if state.Phase != PhaseComplete {
		t.Fatalf("state = %+v", state)
	}
	if len(sidecar.launches) != 1 {
		t.Fatalf("a complete first pass must never launch a second one: %d launches", len(sidecar.launches))
	}
	if len(sidecar.rechecks()) != 0 {
		t.Fatal("nothing must have been re-checked")
	}
}

func TestModelCascadeWindowedRecheckSplicesAndRealigns(t *testing.T) {
	p := newTestProject(t)
	sidecar := &fakeSidecar{present: 8, afterRecheckPresent: 10} // the first pass misses a tail; the re-check resolves it
	service := p.service(sidecar)

	state := run(t, service, cascadeRequest())

	if state.Phase != PhaseComplete || state.Percent != 100 {
		t.Fatalf("state = %+v", state)
	}
	if len(sidecar.launches) != 3 {
		t.Fatalf("want a first pass, a windowed re-check and a realign, got %d launches", len(sidecar.launches))
	}
	recheckArgs := flags(sidecar.launches[1])
	if recheckArgs["--recheck"] == "" || recheckArgs["--model"] != "large-v3-turbo" {
		t.Fatalf("the re-check stage's args = %v", recheckArgs)
	}
	realignArgs := flags(sidecar.launches[2])
	if realignArgs["--align-only"] != "true" || realignArgs["--model"] != "small" {
		t.Fatalf("the realign stage's args = %v (must use the first pass's own model)", realignArgs)
	}
	if len(sidecar.rechecks()) != 1 {
		t.Fatalf("want exactly one words file re-checked, got %v", sidecar.rechecks())
	}
	result := currentResult(t, service, DefaultAlignmentParams)
	if !result.Current() || result.Result.Report.PresentFraction() != 1 || len(result.Result.Report.Regions) != 0 {
		t.Fatalf("the realigned result must show the region resolved: %+v", result.Result.Report)
	}
	if result.Result.Model != "small" {
		t.Fatalf("the stored result must still name the first pass's own model, got %q", result.Result.Model)
	}
	if result.Result.Recheck == nil || result.Result.Recheck.Model != "large-v3-turbo" || result.Result.Recheck.WholeChapter || result.Result.Recheck.Windows != 1 {
		t.Fatalf("Recheck = %+v, want one window with the re-check model named (MC5)", result.Result.Recheck)
	}
	if result.Result.Recheck.Seconds <= 0 {
		t.Fatalf("Recheck.Seconds = %v, want the re-checked window's own length", result.Result.Recheck.Seconds)
	}
}

func TestModelCascadeNoSecondPassStoresNoRecheck(t *testing.T) {
	p := newTestProject(t)
	sidecar := &fakeSidecar{} // present defaults to 10: the first pass calls the chapter complete
	service := p.service(sidecar)

	run(t, service, cascadeRequest())

	result := currentResult(t, service, DefaultAlignmentParams)
	if result.Result.Recheck != nil {
		t.Fatalf("Recheck = %+v, want nil: nothing was missing, so nothing was re-checked", result.Result.Recheck)
	}
}

func TestModelCascadePlainCheckStoresNoRecheck(t *testing.T) {
	p := newTestProject(t)
	sidecar := &fakeSidecar{present: 8} // a region is missing, but no Recheck model was asked for
	service := p.service(sidecar)

	run(t, service, testRequest())

	result := currentResult(t, service, DefaultAlignmentParams)
	if result.Result.Recheck != nil {
		t.Fatalf("Recheck = %+v, want nil for a plain, single-model check", result.Result.Recheck)
	}
}

func TestModelCascadeStateNamesThePassAndModels(t *testing.T) {
	p := newTestProject(t)
	sidecar := &fakeSidecar{present: 8, afterRecheckPresent: 10}
	service := p.service(sidecar)
	var seen []State
	service.changed = func(state State) { seen = append(seen, state) }

	run(t, service, cascadeRequest())

	first := seen[0]
	if first.Pass != "first_pass" || first.FirstPassModel != "small" || first.RecheckModel != "large-v3-turbo" {
		t.Fatalf("the run's initial state = %+v, want the first pass named with both models", first)
	}
	var sawWindows, sawRealign bool
	for _, state := range seen {
		if state.Pass == "recheck_windows" {
			sawWindows = true
			if state.RecheckWindows != 1 {
				t.Fatalf("recheck_windows state = %+v, want RecheckWindows = 1", state)
			}
		}
		if state.Pass == "realign" {
			sawRealign = true
		}
	}
	if !sawWindows || !sawRealign {
		t.Fatalf("want a recheck_windows state and a realign state among %+v", seen)
	}
}

func TestModelCascadeWholeChapterStateNamesThePass(t *testing.T) {
	p := newTestProject(t)
	p.items[0].length = 2
	p.items[1].length = 10
	p.writeRPP()
	sidecar := &fakeSidecar{present: 8, wholeChapterPresent: 10}
	service := p.service(sidecar)
	var seen []State
	service.changed = func(state State) { seen = append(seen, state) }

	run(t, service, cascadeRequest())

	var sawWhole bool
	for _, state := range seen {
		if state.Pass == "recheck_whole" {
			sawWhole = true
		}
	}
	if !sawWhole {
		t.Fatalf("want a recheck_whole state among %+v", seen)
	}
}

func TestPlainCheckStateNamesNoPass(t *testing.T) {
	p := newTestProject(t)
	sidecar := &fakeSidecar{}
	service := p.service(sidecar)

	state := run(t, service, testRequest())

	if state.Pass != "" || state.FirstPassModel != "" || state.RecheckModel != "" {
		t.Fatalf("a plain check's state = %+v, want no cascade fields", state)
	}
}

func TestModelCascadeWholeChapterFallback(t *testing.T) {
	p := newTestProject(t)
	// Item B, the one the first pass's own tail region falls on (fixtures_test.go's fakeSidecar),
	// now plays most of the chapter (10 of 12 seconds): the region's window, clamped to that one
	// item, covers over the 60% fallback fraction (MC3), so the second pass must run over the
	// whole chapter instead of windows.
	p.items[0].length = 2
	p.items[1].length = 10
	p.writeRPP()
	sidecar := &fakeSidecar{present: 8, wholeChapterPresent: 10}
	service := p.service(sidecar)

	state := run(t, service, cascadeRequest())

	if state.Phase != PhaseComplete {
		t.Fatalf("state = %+v", state)
	}
	if len(sidecar.launches) != 2 {
		t.Fatalf("want a first pass and one whole-chapter pass, no windowed re-check, got %d launches", len(sidecar.launches))
	}
	if len(sidecar.rechecks()) != 0 {
		t.Fatal("the whole-chapter fallback must never use --recheck")
	}
	second := flags(sidecar.launches[1])
	if second["--recheck"] != "" || second["--align-only"] == "true" || second["--model"] != "large-v3-turbo" {
		t.Fatalf("the whole-chapter stage's args = %v", second)
	}
	result := currentResult(t, service, DefaultAlignmentParams)
	if !result.Current() || result.Result.Report.PresentFraction() != 1 {
		t.Fatalf("the whole-chapter pass's own report must be the final one: %+v", result.Result.Report)
	}
}

func TestModelCascadeCancelDuringTheRecheckStage(t *testing.T) {
	p := newTestProject(t)
	sidecar := &fakeSidecar{present: 8, recheckExitCode: exitCancelled}
	service := p.service(sidecar)

	state := run(t, service, cascadeRequest())

	if state.Phase != PhaseCancelled {
		t.Fatalf("state = %+v", state)
	}
	if record := latestRecord(t, p); record.Outcome != evidence.LedgerPartial {
		t.Fatalf("record = %+v", record)
	}
}

func TestModelCascadeFailureDuringTheRecheckStage(t *testing.T) {
	p := newTestProject(t)
	sidecar := &fakeSidecar{present: 8, recheckExitCode: 1, recheckErrorMessage: "the re-check model could not be loaded"}
	service := p.service(sidecar)

	state := run(t, service, cascadeRequest())

	if state.Phase != PhaseFailed || state.Message != "the re-check model could not be loaded" {
		t.Fatalf("state = %+v", state)
	}
}

func TestModelCascadeFailureDuringTheRealignStage(t *testing.T) {
	p := newTestProject(t)
	sidecar := &fakeSidecar{present: 8, realignExitCode: 1, realignErrorMessage: "the realign pass could not read the spliced words"}
	service := p.service(sidecar)

	state := run(t, service, cascadeRequest())

	if state.Phase != PhaseFailed || state.Message != "the realign pass could not read the spliced words" {
		t.Fatalf("state = %+v", state)
	}
	if len(sidecar.launches) != 3 {
		t.Fatalf("a realign failure must still have gone through all three stages: %d launches", len(sidecar.launches))
	}
}

func TestWordsCacheKeySeparatesACascadesWordsFromAPlainCheck(t *testing.T) {
	p := newTestProject(t)
	first := &fakeSidecar{} // present 10: no second pass runs, only the cache key itself is under test
	run(t, p.service(first), cascadeRequest())

	plain := &fakeSidecar{}
	run(t, p.service(plain), testRequest())

	if got := plain.transcriptions(); len(got) != 2 {
		t.Fatalf("a plain check must not reuse a cascade run's words (a different cache key): transcribed %v, want both items again", got)
	}
}
