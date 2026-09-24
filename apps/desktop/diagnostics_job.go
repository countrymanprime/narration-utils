package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// The Diagnostics view's job (diagnostics-delivery-and-cleanup-tools.prd.md Phase 6). It runs the windowed analyzers
// (measure.DiagnoseFile, ADR 0158) over files the narrator chose in the measurement picker this session (the same
// allowlist as MeasureAnalyze, ADR 0156), one after another, with progress from the audio bytes really read (ADR 0015)
// and a cancel that stops mid-file. Each file answers a summary and its findings, every one with the thresholds that
// raised it and whether the audio is a raw recording or a processed render. It is read-only: the files are opened
// read-only, nothing is saved (the findings store keeps no diagnostics until the review dashboard ingests them, PRD Open
// Question 4, so every finding is unreviewed), and nothing runs or plays in REAPER.

// The status words of one file in a diagnostics check.
const (
	diagnosticsFilePending   = "pending"
	diagnosticsFileChecking  = "checking"
	diagnosticsFileChecked   = "checked"
	diagnosticsFileFailed    = "failed"
	diagnosticsFileCancelled = "cancelled"
)

// DiagnosticsFileResult is one file of a check. Summary and Findings are set once it is checked (Findings is empty, not
// null, when nothing crossed a threshold); Error says why a failed file could not be checked.
type DiagnosticsFileResult struct {
	Path     string                     `json:"path"`
	Name     string                     `json:"name"`
	Status   string                     `json:"status"`
	Summary  *measure.DiagnosticSummary `json:"summary"`
	Findings []findings.Finding         `json:"findings"`
	Error    string                     `json:"error,omitempty"`
}

// DiagnosticsJob is the check as the UI sees it, in the shape of the other host jobs. SourceKind is what the narrator
// said the files are (null before any check); Thresholds are the ones the analyzers use, shown even before a check so
// they are never hidden.
type DiagnosticsJob struct {
	ID         *string                   `json:"id"`
	Kind       string                    `json:"kind"`
	Phase      string                    `json:"phase"`
	Message    string                    `json:"message"`
	Percent    int                       `json:"percent"`
	Logs       []string                  `json:"logs"`
	Elapsed    float64                   `json:"elapsed"`
	Error      string                    `json:"error,omitempty"`
	SourceKind *measure.SourceKind       `json:"sourceKind"`
	Thresholds measure.DiagnosticOptions `json:"thresholds"`
	Files      []DiagnosticsFileResult   `json:"files"`
}

type diagnoseFileFunc func(ctx context.Context, path string, in measure.DiagnosticInput) (measure.Diagnostics, error)

// diagnosticThresholds are the thresholds a check uses: ADR 0158's starting values until the narrator's own settings for
// them exist (the PRD's Phase 9 brings the analyzer thresholds into the layered settings).
func diagnosticThresholds() measure.DiagnosticOptions {
	return measure.DefaultDiagnosticOptions()
}

type diagnosticsJob struct {
	mu         sync.RWMutex
	id         string
	phase      string
	message    string
	errorText  string
	percent    int
	logs       []string
	started    time.Time
	sourceKind measure.SourceKind
	thresholds measure.DiagnosticOptions
	files      []DiagnosticsFileResult
	// weights are the files' sizes when the check started (at least 1), so the percent is the share of all bytes read.
	weights     []int64
	totalWeight int64
	doneWeight  int64
	cancel      context.CancelFunc
}

func (j *diagnosticsJob) running() bool {
	j.mu.RLock()
	defer j.mu.RUnlock()
	return j.phase == "running"
}

func (j *diagnosticsJob) snapshot() DiagnosticsJob {
	j.mu.RLock()
	defer j.mu.RUnlock()
	// A file's findings are set once, when it is checked, and never changed after, so sharing them is safe.
	id, kind := j.id, j.sourceKind
	return DiagnosticsJob{
		ID: &id, Kind: jobKindDiagnostics, Phase: j.phase, Message: j.message, Percent: j.percent, Logs: append([]string{}, j.logs...),
		Elapsed: time.Since(j.started).Seconds(), Error: j.errorText, SourceKind: &kind, Thresholds: j.thresholds,
		Files: append([]DiagnosticsFileResult{}, j.files...),
	}
}

func (j *diagnosticsJob) begin(index int) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.files[index].Status = diagnosticsFileChecking
	j.message = fmt.Sprintf("Checking %s (%d of %d).", j.files[index].Name, index+1, len(j.files))
}

// progress folds one file's bytes read into the check's percent, which never moves backwards and reaches 100 only when
// the check succeeds.
func (j *diagnosticsJob) progress(index int, done, total int64) {
	if total <= 0 {
		return
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	fraction := min(1, float64(done)/float64(total))
	percent := int(100 * (float64(j.doneWeight) + fraction*float64(j.weights[index])) / float64(j.totalWeight))
	j.percent = max(j.percent, min(99, percent))
}

func (j *diagnosticsJob) complete(index int, result measure.Diagnostics, err error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	file := &j.files[index]
	if err != nil {
		file.Status, file.Error = diagnosticsFileFailed, err.Error()
		j.logs = append(j.logs, fmt.Sprintf("%s could not be checked: %s", file.Name, file.Error))
	} else {
		summary := result.Summary()
		file.Status, file.Summary, file.Findings = diagnosticsFileChecked, &summary, result.Findings()
		j.logs = append(j.logs, fmt.Sprintf("Checked %s: %s.", file.Name, countFindings(len(file.Findings))))
	}
	j.doneWeight += j.weights[index]
	j.percent = max(j.percent, min(99, int(100*j.doneWeight/j.totalWeight)))
}

// finish records how the check ended: every file not checked yet is cancelled when the narrator cancelled.
func (j *diagnosticsJob) finish(cancelled bool, broken error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	checked, failed := 0, 0
	for i := range j.files {
		switch j.files[i].Status {
		case diagnosticsFileChecked:
			checked++
		case diagnosticsFileFailed:
			failed++
		case diagnosticsFileChecking:
			if broken != nil {
				// The file being checked when the check broke: its own failure, not the narrator's cancel.
				j.files[i].Status, j.files[i].Error = diagnosticsFileFailed, "the diagnostics stopped unexpectedly: "+broken.Error()
				failed++
				continue
			}
			j.files[i].Status = diagnosticsFileCancelled
		default:
			if cancelled || broken != nil {
				j.files[i].Status = diagnosticsFileCancelled
			}
		}
	}
	switch {
	case broken != nil:
		j.phase, j.message, j.errorText = "error", "The diagnostics stopped unexpectedly.", broken.Error()
	case cancelled:
		verb := "were"
		if checked == 1 {
			verb = "was"
		}
		j.phase, j.message = "cancelled", fmt.Sprintf("Diagnostics cancelled. %d of %s %s checked.", checked, countFiles(len(j.files)), verb)
	default:
		j.phase, j.percent, j.message = "success", 100, checkedMessage(checked, failed)
	}
	j.logs = append(j.logs, j.message)
}

func countFindings(n int) string {
	if n == 1 {
		return "1 finding"
	}
	return fmt.Sprintf("%d findings", n)
}

func checkedMessage(checked, failed int) string {
	switch {
	case failed == 0:
		return fmt.Sprintf("Checked %s.", countFiles(checked))
	case checked == 0 && failed == 1:
		return "The file could not be checked."
	case checked == 0:
		return fmt.Sprintf("None of the %d files could be checked.", failed)
	}
	return fmt.Sprintf("Checked %d of %s; %d could not be checked.", checked, countFiles(checked+failed), failed)
}

func parseSourceKind(value string) (measure.SourceKind, error) {
	switch kind := measure.SourceKind(value); kind {
	case measure.SourceRawRecording, measure.SourceProcessedRender:
		return kind, nil
	}
	return "", fmt.Errorf("say whether the files are raw recordings or processed renders (%q is neither)", value)
}

// startDiagnostics checks the picked files in the background, one at a time; only one check runs at once. It refuses
// what MeasureAnalyze refuses (ADR 0156) and a source kind that is not raw_recording or processed_render.
func (h *Host) startDiagnostics(requested []string, sourceKind string) (DiagnosticsJob, error) {
	kind, err := parseSourceKind(sourceKind)
	if err != nil {
		return DiagnosticsJob{}, err
	}
	paths, err := h.measurePaths(requested)
	if err != nil {
		return DiagnosticsJob{}, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	job := &diagnosticsJob{
		id: fmt.Sprintf("diagnostics-%d", time.Now().UnixNano()), phase: "running", started: time.Now(), cancel: cancel,
		sourceKind: kind, thresholds: diagnosticThresholds(), message: fmt.Sprintf("Checking %s.", countFiles(len(paths))),
	}
	job.logs = []string{job.message}
	for _, path := range paths {
		weight := int64(1)
		if info, err := os.Stat(path); err == nil {
			weight = max(1, info.Size())
		}
		job.files = append(job.files, DiagnosticsFileResult{Path: path, Name: filepath.Base(path), Status: diagnosticsFilePending})
		job.weights = append(job.weights, weight)
		job.totalWeight += weight
	}

	h.mu.Lock()
	if h.diagnosticsJob != nil && h.diagnosticsJob.running() {
		h.mu.Unlock()
		cancel()
		return DiagnosticsJob{}, fmt.Errorf("a diagnostics check is already running")
	}
	h.diagnosticsJob = job
	diagnose := h.diagnoseFile
	h.mu.Unlock()

	if diagnose == nil {
		diagnose = measure.DiagnoseFile
	}
	go h.runDiagnostics(ctx, job, paths, diagnose)
	return job.snapshot(), nil
}

// runDiagnostics checks each file in turn, then records how the check ended and says so (ADR 0076). A panic in the
// analyzers ends the job as an error instead of taking the app down.
func (h *Host) runDiagnostics(ctx context.Context, job *diagnosticsJob, paths []string, diagnose diagnoseFileFunc) {
	defer job.cancel()
	defer func() {
		var broken error
		if recovered := recover(); recovered != nil {
			broken = fmt.Errorf("%v", recovered)
		}
		job.finish(ctx.Err() != nil && broken == nil, broken)
		job.mu.RLock()
		event, ok := endedJob(job.id, jobKindDiagnostics, job.phase, job.message, job.started)
		job.mu.RUnlock()
		if ok {
			h.publishJobEnded(event)
		}
	}()
	for index, path := range paths {
		if ctx.Err() != nil {
			return
		}
		job.begin(index)
		result, err := diagnose(ctx, path, measure.DiagnosticInput{
			SourceKind: job.sourceKind,
			Options:    job.thresholds,
			Progress:   func(done, total int64) { job.progress(index, done, total) },
		})
		if ctx.Err() != nil {
			return
		}
		job.complete(index, result, err)
	}
}

// diagnosticsState answers the current or last check, or an idle job with the thresholds a check would use.
func (h *Host) diagnosticsState() DiagnosticsJob {
	h.mu.RLock()
	job := h.diagnosticsJob
	h.mu.RUnlock()
	if job != nil {
		return job.snapshot()
	}
	return DiagnosticsJob{
		Kind: jobKindDiagnostics, Phase: "idle", Message: "Choose the files to check.", Logs: []string{},
		Thresholds: diagnosticThresholds(), Files: []DiagnosticsFileResult{},
	}
}

// cancelDiagnostics stops a running check at its next block of audio; what was checked before is kept.
func (h *Host) cancelDiagnostics() DiagnosticsJob {
	h.mu.RLock()
	job := h.diagnosticsJob
	h.mu.RUnlock()
	if job == nil || !job.running() {
		return h.diagnosticsState()
	}
	job.mu.Lock()
	job.message = "Cancelling the diagnostics."
	job.mu.Unlock()
	job.cancel()
	return job.snapshot()
}
