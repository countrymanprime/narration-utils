package main

import (
	"sync"

	"github.com/countrymanprime/narration-utils/shell/internal/runlog"
)

// teleprompterSessionRunID is jobRuns' key for the one live teleprompter session that can run at a time (bindings.go
// TeleprompterStart/TeleprompterStop): not an ADR 0076 job kind (its lifecycle is teleprompter:state, not job:ended),
// so it is a fixed key rather than a per-run id.
const teleprompterSessionRunID = "teleprompter-session"

// jobRuns tracks the runlog.Run for each in-flight job, keyed by the same job id ADR 0076's job:ended event already
// carries. jobs.go's publishJobEnded is the one place every job kind's end already flows through, so ending the
// tracked run there (jobRuns.end) is the one place every kind's run.end record comes from too: most job-start sites
// need only call begin where they first learn their id, not remember to end it later.
type jobRuns struct {
	mu   sync.Mutex
	runs map[string]*runlog.Run
}

// begin starts a run for kind, remembers it by id so end can find it, and returns it (for a job that also launches a
// sidecar: runlog.WithRun(ctx, run) before the launch). A nil *runlog.Logger begins a nil *runlog.Run, same as every
// other path into the runlog package, so a Host built without one (most tests) needs no checks.
func (t *jobRuns) begin(logger *runlog.Logger, id, kind string, attrs ...any) *runlog.Run {
	run := logger.Begin(kind, attrs...)
	t.mu.Lock()
	if t.runs == nil {
		t.runs = map[string]*runlog.Run{}
	}
	t.runs[id] = run
	t.mu.Unlock()
	return run
}

// end removes and returns the run begin recorded for id, or nil if begin was never called for it.
func (t *jobRuns) end(id string) *runlog.Run {
	t.mu.Lock()
	defer t.mu.Unlock()
	run := t.runs[id]
	delete(t.runs, id)
	return run
}

// jobKindBeginSites pairs every job kind (jobs.go) with the host function(s) that call jobRuns.begin (or, for
// transcript_compare, runLog.Begin directly — its run starts and ends inside transcriptWatch, not through jobRuns,
// since a comparison's id is a bridge run id the host learns from a live state, not from starting a job itself).
// TestEveryJobKindHasARegisteredBeginSiteThatCallsIt (runlog_jobs_test.go) is the guard: a job kind added to jobs.go
// without an entry here, or a registered function whose body stops calling begin/Begin, fails it.
var jobKindBeginSites = map[string][]string{
	jobKindStoryBible:        {"startGuideBuild"},
	jobKindManuscriptImport:  {"ManuscriptSelectFile", "ManuscriptBeginImport"},
	jobKindTtsInstall:        {"startInstall"},
	jobKindWhisperInstall:    {"startInstall"},
	jobKindSpacyInstall:      {"startInstall"},
	jobKindMoonshineInstall:  {"startInstall"},
	jobKindDictionaryInstall: {"startInstall"},
	jobKindAppUpdate:         {"startUpdateDownload"},
	jobKindTranscript:        {"observe"},
	jobKindCoverage:          {"coverageStart"},
	jobKindTakeReview:        {"startTakeReviewScan"},
	jobKindTakeComparison:    {"startTakeComparison"},
	jobKindMeasurement:       {"startMeasure"},
	jobKindDiagnostics:       {"startDiagnostics"},
}
