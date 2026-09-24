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
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Measuring the narrator's rendered chapter files as a job (diagnostics-delivery-and-cleanup-tools.prd.md Phase 1,
// ADR 0156). The narrator picks WAV files in the operating system's picker (MeasurePickFiles); MeasureAnalyze measures
// only files picked that way in this session, one after another, with progress from the bytes really read (ADR 0015)
// and a cancel that stops mid-file. Each file answers its internal/measure report and the fingerprint of the bytes it
// was measured from, or why it could not be measured. Nothing is written anywhere: the files are opened read-only.

// maxMeasureFiles bounds one measurement: more than any book has chapters, few enough that the job's answer stays small.
const maxMeasureFiles = 500

// The status words of one file in a measurement.
const (
	measureFilePending   = "pending"
	measureFileMeasuring = "measuring"
	measureFileMeasured  = "measured"
	measureFileFailed    = "failed"
	measureFileCancelled = "cancelled"
)

// MeasureFileResult is one file of a measurement. Report and Fingerprint are set once it is measured; a report's
// unmeasurable values are null, never a number (ADR 0025). Error says why a failed file could not be measured. Findings
// are the host's judgement of the report against the narrator's limits in force when the job is read (measure.Evaluate,
// judgeMeasureJob): delivery_qc findings with the IDs an exported report carries, empty when nothing is outside a limit.
type MeasureFileResult struct {
	Path        string               `json:"path"`
	Name        string               `json:"name"`
	Status      string               `json:"status"`
	Report      *measure.Report      `json:"report"`
	Fingerprint *measure.Fingerprint `json:"fingerprint"`
	Findings    []findings.Finding   `json:"findings"`
	Error       string               `json:"error,omitempty"`
}

// MeasureJob is the measurement as the UI sees it, in the shape of the other host jobs: Phase is idle, running,
// success, cancelled or error (error only when the measurement itself broke; a file it could not measure is a failed
// file of a successful job).
type MeasureJob struct {
	ID      *string             `json:"id"`
	Kind    string              `json:"kind"`
	Phase   string              `json:"phase"`
	Message string              `json:"message"`
	Percent int                 `json:"percent"`
	Logs    []string            `json:"logs"`
	Elapsed float64             `json:"elapsed"`
	Error   string              `json:"error,omitempty"`
	Files   []MeasureFileResult `json:"files"`
	// LimitsError says why the narrator's limits could not be read (a hand-edited settings file), so no file is judged.
	// judgeMeasureJob sets it, never the job itself.
	LimitsError string `json:"limitsError,omitempty"`
}

// MeasurePickResult is what the picker chose; empty when the narrator closed it.
type MeasurePickResult struct {
	Paths []string `json:"paths"`
}

type measureJob struct {
	mu sync.RWMutex
	// +checklocks:mu
	id string
	// +checklocks:mu
	phase string
	// +checklocks:mu
	message string
	// +checklocks:mu
	errorText string
	// +checklocks:mu
	percent int
	// +checklocks:mu
	logs []string
	// +checklocks:mu
	started time.Time
	// +checklocks:mu
	files []MeasureFileResult
	// weights are the files' sizes when the job started (at least 1), so the percent is the share of all bytes read.
	// +checklocks:mu
	weights []int64
	// +checklocks:mu
	totalWeight int64
	// +checklocks:mu
	doneWeight int64
	cancel     context.CancelFunc
}

func (j *measureJob) running() bool {
	j.mu.RLock()
	defer j.mu.RUnlock()
	return j.phase == "running"
}

func (j *measureJob) snapshot() MeasureJob {
	j.mu.RLock()
	defer j.mu.RUnlock()
	id := j.id
	return MeasureJob{
		ID: &id, Kind: jobKindMeasurement, Phase: j.phase, Message: j.message, Percent: j.percent, Logs: append([]string{}, j.logs...),
		Elapsed: time.Since(j.started).Seconds(), Error: j.errorText, Files: append([]MeasureFileResult{}, j.files...),
	}
}

func (j *measureJob) begin(index int) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.files[index].Status = measureFileMeasuring
	j.message = fmt.Sprintf("Measuring %s (%d of %d).", j.files[index].Name, index+1, len(j.files))
}

// progress folds one file's bytes read into the job's percent, which never moves backwards and reaches 100 only when
// the job succeeds.
func (j *measureJob) progress(index int, done, total int64) {
	if total <= 0 {
		return
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	fraction := min(1, float64(done)/float64(total))
	percent := int(100 * (float64(j.doneWeight) + fraction*float64(j.weights[index])) / float64(j.totalWeight))
	j.percent = max(j.percent, min(99, percent))
}

func (j *measureJob) complete(index int, measured measure.FileMeasurement, err error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	file := &j.files[index]
	if err != nil {
		file.Status, file.Error = measureFileFailed, err.Error()
		j.logs = append(j.logs, fmt.Sprintf("%s could not be measured: %s", file.Name, file.Error))
	} else {
		report, fingerprint := measured.Report, measured.Fingerprint
		file.Status, file.Report, file.Fingerprint = measureFileMeasured, &report, &fingerprint
		j.logs = append(j.logs, fmt.Sprintf("Measured %s.", file.Name))
	}
	j.doneWeight += j.weights[index]
	j.percent = max(j.percent, min(99, int(100*j.doneWeight/j.totalWeight)))
}

// finish records how the measurement ended: every file not measured yet is cancelled when the narrator cancelled.
func (j *measureJob) finish(cancelled bool, broken error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	measured, failed := 0, 0
	for i := range j.files {
		switch j.files[i].Status {
		case measureFileMeasured:
			measured++
		case measureFileFailed:
			failed++
		case measureFileMeasuring:
			if broken != nil {
				// The file being measured when the measurement broke: its own failure, not the narrator's cancel.
				j.files[i].Status, j.files[i].Error = measureFileFailed, "the measurement stopped unexpectedly: "+broken.Error()
				failed++
				continue
			}
			j.files[i].Status = measureFileCancelled
		default:
			if cancelled || broken != nil {
				j.files[i].Status = measureFileCancelled
			}
		}
	}
	switch {
	case broken != nil:
		j.phase, j.message, j.errorText = "error", "The measurement stopped unexpectedly.", broken.Error()
	case cancelled:
		j.phase = "cancelled"
		j.message = fmt.Sprintf("Measurement cancelled. %d of %s was measured.", measured, countFiles(len(j.files)))
		if measured != 1 {
			j.message = fmt.Sprintf("Measurement cancelled. %d of %s were measured.", measured, countFiles(len(j.files)))
		}
	default:
		j.phase, j.percent, j.message = "success", 100, measuredMessage(measured, failed)
	}
	j.logs = append(j.logs, j.message)
}

func countFiles(n int) string {
	if n == 1 {
		return "1 file"
	}
	return fmt.Sprintf("%d files", n)
}

func measuredMessage(measured, failed int) string {
	switch {
	case failed == 0:
		return fmt.Sprintf("Measured %s.", countFiles(measured))
	case measured == 0 && failed == 1:
		return "The file could not be measured."
	case measured == 0:
		return fmt.Sprintf("None of the %d files could be measured.", failed)
	}
	return fmt.Sprintf("Measured %d of %s; %d could not be measured.", measured, countFiles(measured+failed), failed)
}

// pickMeasureFiles opens the picker and remembers what it chose, so only those paths can be measured (ADR 0156).
func (h *Host) pickMeasureFiles() (MeasurePickResult, error) {
	pick := h.pickAudioFiles
	if pick == nil {
		pick = h.openAudioFilesDialog
	}
	chosen, err := pick()
	if err != nil {
		return MeasurePickResult{}, err
	}
	paths := []string{}
	for _, path := range chosen {
		if path == "" || !filepath.IsAbs(path) {
			continue
		}
		paths = append(paths, filepath.Clean(path))
	}
	h.mu.Lock()
	if h.measurePicked == nil {
		h.measurePicked = map[string]bool{}
	}
	for _, path := range paths {
		h.measurePicked[path] = true
	}
	h.mu.Unlock()
	return MeasurePickResult{Paths: paths}, nil
}

// openAudioFilesDialog is the real picker: WAV files first, and every file so a wrong one is refused with a reason.
func (h *Host) openAudioFilesDialog() ([]string, error) {
	h.mu.RLock()
	ctx := h.ctx
	h.mu.RUnlock()
	if ctx == nil {
		return nil, fmt.Errorf("the desktop host is not ready")
	}
	return runtime.OpenMultipleFilesDialog(ctx, runtime.OpenDialogOptions{
		Title: "Choose the rendered chapter files to measure",
		Filters: []runtime.FileFilter{
			{DisplayName: "WAV audio (*.wav)", Pattern: "*.wav;*.wave"},
			{DisplayName: "All files (*.*)", Pattern: "*.*"},
		},
	})
}

// measurePaths checks what MeasureAnalyze was sent: at least one path, each one picked in this session, each once.
func (h *Host) measurePaths(requested []string) ([]string, error) {
	if len(requested) == 0 {
		return nil, fmt.Errorf("choose at least one file to measure")
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	seen := map[string]bool{}
	paths := []string{}
	for _, path := range requested {
		clean := filepath.Clean(path)
		if !filepath.IsAbs(clean) || !h.measurePicked[clean] {
			return nil, fmt.Errorf("%q was not chosen in the file picker; choose the files to measure again", path)
		}
		if !seen[clean] {
			seen[clean] = true
			paths = append(paths, clean)
		}
	}
	if len(paths) > maxMeasureFiles {
		return nil, fmt.Errorf("at most %d files can be measured at once; %d were chosen", maxMeasureFiles, len(paths))
	}
	return paths, nil
}

// startMeasure measures the picked files in the background, one at a time; only one measurement runs at once.
func (h *Host) startMeasure(requested []string) (MeasureJob, error) {
	paths, err := h.measurePaths(requested)
	if err != nil {
		return MeasureJob{}, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	job := &measureJob{
		id: fmt.Sprintf("measure-%d", time.Now().UnixNano()), phase: "running", started: time.Now(), cancel: cancel,
		message: fmt.Sprintf("Measuring %s.", countFiles(len(paths))),
	}
	job.logs = []string{job.message}
	for _, path := range paths {
		weight := int64(1)
		if info, err := os.Stat(path); err == nil {
			weight = max(1, info.Size())
		}
		job.files = append(job.files, MeasureFileResult{Path: path, Name: filepath.Base(path), Status: measureFilePending})
		job.weights = append(job.weights, weight)
		job.totalWeight += weight
	}

	h.mu.Lock()
	if h.measureJob != nil && h.measureJob.running() {
		h.mu.Unlock()
		cancel()
		return MeasureJob{}, fmt.Errorf("a measurement is already running")
	}
	h.measureJob = job
	h.mu.Unlock()

	measureFile := h.measureFile
	if measureFile == nil {
		measureFile = measure.MeasureFile
	}
	go h.runMeasure(ctx, job, paths, measureFile)
	return job.snapshot(), nil
}

type measureFileFunc func(ctx context.Context, path string, opts measure.Options) (measure.FileMeasurement, error)

// runMeasure measures each file in turn, then records how the measurement ended and says so (ADR 0076). A panic in
// the measurement ends the job as an error instead of taking the app down.
func (h *Host) runMeasure(ctx context.Context, job *measureJob, paths []string, measureFile measureFileFunc) {
	defer job.cancel()
	defer func() {
		var broken error
		if recovered := recover(); recovered != nil {
			broken = fmt.Errorf("%v", recovered)
		}
		job.finish(ctx.Err() != nil && broken == nil, broken)
		h.publishMeasureEnd(job)
	}()
	for index, path := range paths {
		if ctx.Err() != nil {
			return
		}
		job.begin(index)
		measured, err := measureFile(ctx, path, measure.Options{Progress: func(done, total int64) { job.progress(index, done, total) }})
		if ctx.Err() != nil {
			return
		}
		job.complete(index, measured, err)
	}
}

func (h *Host) publishMeasureEnd(job *measureJob) {
	job.mu.RLock()
	event, ok := endedJob(job.id, jobKindMeasurement, job.phase, job.message, job.started)
	job.mu.RUnlock()
	if ok {
		h.publishJobEnded(event)
	}
}

// measureState answers the current or last measurement, or an idle job.
func (h *Host) measureState() MeasureJob {
	h.mu.RLock()
	job := h.measureJob
	h.mu.RUnlock()
	if job != nil {
		return job.snapshot()
	}
	return MeasureJob{Kind: jobKindMeasurement, Phase: "idle", Message: "Choose the files to measure.", Logs: []string{}, Files: []MeasureFileResult{}}
}

// cancelMeasure stops a running measurement at its next block of audio; what was measured before is kept.
func (h *Host) cancelMeasure() MeasureJob {
	h.mu.RLock()
	job := h.measureJob
	h.mu.RUnlock()
	if job == nil || !job.running() {
		return h.measureState()
	}
	job.mu.Lock()
	job.message = "Cancelling the measurement."
	job.mu.Unlock()
	job.cancel()
	return job.snapshot()
}
