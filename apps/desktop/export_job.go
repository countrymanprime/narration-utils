package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
	"github.com/countrymanprime/narration-utils/shell/internal/encodeport"
	"github.com/countrymanprime/narration-utils/shell/internal/mastering"
	"github.com/countrymanprime/narration-utils/shell/internal/packager"
	"github.com/countrymanprime/narration-utils/shell/internal/runlog"
)

// The Master & QC export flow (render-encode-master.prd.md Phase 5): the narrator picks rendered chapter (and
// credits, and retail sample) WAV files, optionally masters them (internal/mastering, Phase 3, narrator-triggered,
// writes a new file), encodes them (internal/encodeport, Phases 1-2), then assembles one profile's package
// (internal/packager, Phase 4). Mastering and encoding run together as one job (ExportStart/ExportState/
// ExportCancel), matching the mock's one "Master & encode" action; packaging is its own job
// (PackageStart/PackageState/PackageCancel) so the narrator can build several platforms' packages from one export
// without re-encoding (Phase 6's own job, not built here, will reuse the same encoded files).
//
// Every stage writes a NEW file and never the source, following chaptertags' and mastering's own "new copy, never
// the source" rule. Mastered and encoded files are derived, intermediate data, so they live under the project's own
// narration-utils/ sidecar tree (exportDir); the assembled package is the narrator's deliverable and is never
// written there (Q5) - PackageStart asks for an output folder with the operating system's own picker.

// exportScratchDir is where a project's mastered and encoded intermediates are written, never the deliverable
// itself: <project>/narration-utils/render-encode-master/<mastered|encoded>.
func exportScratchDir(projectFolder, stage string) string {
	return filepath.Join(projectFolder, "narration-utils", "render-encode-master", stage)
}

// The status words of one file in an export job.
const (
	exportFilePending   = "pending"
	exportFileMastering = "mastering"
	exportFileEncoding  = "encoding"
	exportFileDone      = "done"
	exportFileFailed    = "failed"
	exportFileCancelled = "cancelled"
)

// ExportItem is one rendered WAV to master and encode: its place in the eventual package (one of packager.Kind's own
// values, kept a plain string on the wire so the UI's contract does not depend on a Go enum type) and, for a
// chapter, its title (packager.Assemble needs it to name the file; ignored for the other kinds).
type ExportItem struct {
	Kind  string `json:"kind"`
	Title string `json:"title"`
	Path  string `json:"path"`
}

// ExportRequest is what ExportStart is asked to master (optionally) and encode.
type ExportRequest struct {
	Items  []ExportItem `json:"items"`
	Master bool         `json:"master"`
	Format string       `json:"format"`
}

// MasteringSummary is the mastering chain's own report (mastering.Result), narrowed to what the Master & QC page
// shows per file: the chain's settings and the RMS/peak it measured before and after. It leaves out the full
// before/after reports and deliveryprofile.Judgement, which mastering.Result carries for a caller judging the file
// itself; the export job's own per-file status (done/failed) and the package job's own checklist already cover that
// for the UI.
type MasteringSummary struct {
	Targets       mastering.Targets `json:"targets"`
	HighPassHz    float64           `json:"highPassHz"`
	GainDB        float64           `json:"gainDb"`
	BeforeRMSdBFS *float64          `json:"beforeRmsDbfs"`
	AfterRMSdBFS  *float64          `json:"afterRmsDbfs"`
	AfterPeakDBFS *float64          `json:"afterPeakDbfs"`
}

func summarizeMastering(result mastering.Result) MasteringSummary {
	return MasteringSummary{
		Targets: result.Targets, HighPassHz: result.HighPassHz, GainDB: result.GainDB,
		BeforeRMSdBFS: result.Before.RMSdBFS, AfterRMSdBFS: result.After.RMSdBFS, AfterPeakDBFS: result.After.SamplePeakdBFS,
	}
}

// ExportFileResult is one item's progress through the export job. MasteredPath and EncodedPath are the new files it
// wrote (empty until that stage finishes); Mastering summarizes the mastering chain's own report, when Master was
// asked for.
type ExportFileResult struct {
	Kind         string            `json:"kind"`
	Title        string            `json:"title"`
	Path         string            `json:"path"`
	Status       string            `json:"status"`
	MasteredPath string            `json:"masteredPath,omitempty"`
	EncodedPath  string            `json:"encodedPath,omitempty"`
	Mastering    *MasteringSummary `json:"mastering,omitempty"`
	Error        string            `json:"error,omitempty"`
}

// ExportJob is the export as the UI sees it, in the shape of the other host jobs.
type ExportJob struct {
	ID      *string            `json:"id"`
	Kind    string             `json:"kind"`
	Phase   string             `json:"phase"`
	Message string             `json:"message"`
	Percent int                `json:"percent"`
	Master  bool               `json:"master"`
	Format  string             `json:"format"`
	Logs    []string           `json:"logs"`
	Elapsed float64            `json:"elapsed"`
	Error   string             `json:"error,omitempty"`
	Files   []ExportFileResult `json:"files"`
}

type exportJob struct {
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
	master bool
	// +checklocks:mu
	format string
	// +checklocks:mu
	files []ExportFileResult
	// +checklocks:mu
	weights []int64
	// +checklocks:mu
	totalWeight int64
	// +checklocks:mu
	doneWeight int64
	cancel     context.CancelFunc
}

func (j *exportJob) running() bool {
	j.mu.RLock()
	defer j.mu.RUnlock()
	return j.phase == "running"
}

func (j *exportJob) snapshot() ExportJob {
	j.mu.RLock()
	defer j.mu.RUnlock()
	id := j.id
	return ExportJob{
		ID: &id, Kind: jobKindRenderExport, Phase: j.phase, Message: j.message, Percent: j.percent, Master: j.master, Format: j.format,
		Logs: append([]string{}, j.logs...), Elapsed: time.Since(j.started).Seconds(), Error: j.errorText,
		Files: append([]ExportFileResult{}, j.files...),
	}
}

func (j *exportJob) begin(index int, status string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.files[index].Status = status
	verb := "Encoding"
	if status == exportFileMastering {
		verb = "Mastering"
	}
	j.message = fmt.Sprintf("%s %s (%d of %d).", verb, j.files[index].Title, index+1, len(j.files))
}

func (j *exportJob) progress(index int, done, total int64) {
	if total <= 0 {
		return
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	fraction := min(1, float64(done)/float64(total))
	percent := int(100 * (float64(j.doneWeight) + fraction*float64(j.weights[index])) / float64(j.totalWeight))
	j.percent = max(j.percent, min(99, percent))
}

func (j *exportJob) completeStage(index int, weightShare float64) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.doneWeight += int64(float64(j.weights[index]) * weightShare)
	j.percent = max(j.percent, min(99, int(100*j.doneWeight/j.totalWeight)))
}

func (j *exportJob) fail(index int, err error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.files[index].Status, j.files[index].Error = exportFileFailed, err.Error()
	j.logs = append(j.logs, fmt.Sprintf("%s could not be prepared: %s", j.files[index].Title, err.Error()))
	j.doneWeight += j.weights[index]
}

func (j *exportJob) succeed(index int, masteredPath string, mastering *MasteringSummary, encodedPath string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	file := &j.files[index]
	file.Status, file.MasteredPath, file.Mastering, file.EncodedPath = exportFileDone, masteredPath, mastering, encodedPath
	j.logs = append(j.logs, fmt.Sprintf("Prepared %s.", file.Title))
}

func (j *exportJob) finish(cancelled bool, broken error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	done, failed := 0, 0
	for i := range j.files {
		switch j.files[i].Status {
		case exportFileDone:
			done++
		case exportFileFailed:
			failed++
		case exportFileMastering, exportFileEncoding:
			if broken != nil {
				j.files[i].Status, j.files[i].Error = exportFileFailed, "the export stopped unexpectedly: "+broken.Error()
				failed++
				continue
			}
			j.files[i].Status = exportFileCancelled
		default:
			if cancelled || broken != nil {
				j.files[i].Status = exportFileCancelled
			}
		}
	}
	switch {
	case broken != nil:
		j.phase, j.message, j.errorText = "error", "The export stopped unexpectedly.", broken.Error()
	case cancelled:
		j.phase = "cancelled"
		j.message = fmt.Sprintf("Export cancelled. %d of %d files were prepared.", done, len(j.files))
	case failed > 0:
		j.phase, j.message = "error", fmt.Sprintf("%d of %d files could not be prepared; the rest are ready.", failed, len(j.files))
	default:
		j.phase, j.percent, j.message = "success", 100, fmt.Sprintf("Prepared %d files.", done)
	}
	j.logs = append(j.logs, j.message)
}

// masterFileFunc and encodeFileFunc are seams for tests: nil means mastering.Master and the real encoder registry.
type masterFileFunc func(ctx context.Context, req mastering.Request, opts mastering.Options) (mastering.Result, error)
type encodeFileFunc func(ctx context.Context, wav, dst string, spec encodeport.Spec) error

// exportPaths checks what ExportStart was sent: at least one item, each picked in this session (ADR 0156's own
// discipline, applied to the export flow's own picker), each once, every kind but "chapter" at most once, and every
// chapter with a title (packager.Assemble needs one to name its file).
func (h *Host) exportPaths(items []ExportItem) ([]ExportItem, error) {
	if len(items) == 0 {
		return nil, errors.New("choose at least one file to export")
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	seenPath := map[string]bool{}
	seenKind := map[string]bool{}
	out := make([]ExportItem, 0, len(items))
	for _, item := range items {
		clean := filepath.Clean(item.Path)
		if !filepath.IsAbs(clean) || !h.exportPicked[clean] {
			return nil, fmt.Errorf("%q was not chosen in the file picker; choose the files to export again", item.Path)
		}
		if item.Kind != string(packager.KindChapter) && item.Kind != string(packager.KindCreditsOpening) &&
			item.Kind != string(packager.KindCreditsClosing) && item.Kind != string(packager.KindRetailSample) {
			return nil, fmt.Errorf("%q is not a package item kind", item.Kind)
		}
		if item.Kind == string(packager.KindChapter) && item.Title == "" {
			return nil, fmt.Errorf("%q has no chapter title", item.Path)
		}
		if item.Kind != string(packager.KindChapter) && seenKind[item.Kind] {
			return nil, fmt.Errorf("only one %s file is expected", item.Kind)
		}
		if seenPath[clean] {
			continue
		}
		seenPath[clean], seenKind[item.Kind] = true, true
		out = append(out, ExportItem{Kind: item.Kind, Title: item.Title, Path: clean})
	}
	return out, nil
}

// startExport masters (if requested) and encodes every item in the background; only one export runs at once.
func (h *Host) startExport(req ExportRequest) (ExportJob, error) {
	items, err := h.exportPaths(req.Items)
	if err != nil {
		return ExportJob{}, err
	}
	format := req.Format
	if format == "" {
		format = "mp3"
	}
	svc := h.services()
	if svc.config.projectFolder == "" {
		return ExportJob{}, errors.New("open a project before exporting")
	}
	profile, _, _ := h.selectedDeliveryProfile(svc)

	ctx, cancel := context.WithCancel(context.Background())
	id := fmt.Sprintf("export-%d", time.Now().UnixNano())
	ctx = runlog.WithRun(ctx, h.jobRuns.begin(h.runLog, id, jobKindRenderExport, "file_count", len(items), "master", req.Master))
	job := &exportJob{id: id, phase: "running", started: time.Now(), cancel: cancel, master: req.Master, format: format}
	job.message = fmt.Sprintf("Preparing %d files.", len(items))
	job.logs = []string{job.message}
	for _, item := range items {
		weight := int64(1)
		if info, err := os.Stat(item.Path); err == nil {
			weight = max(1, info.Size())
		}
		job.files = append(job.files, ExportFileResult{Kind: item.Kind, Title: item.Title, Path: item.Path, Status: exportFilePending})
		job.weights = append(job.weights, weight)
		job.totalWeight += weight
	}

	h.mu.Lock()
	if h.exportJob != nil && h.exportJob.running() {
		h.mu.Unlock()
		cancel()
		return ExportJob{}, errors.New("an export is already running")
	}
	h.exportJob = job
	h.mu.Unlock()

	masterFile := h.masterFile
	if masterFile == nil {
		masterFile = mastering.Master
	}
	encodeFile := h.encodeFile
	if encodeFile == nil {
		encodeFile = encodeFor(format)
	}
	go h.runExport(ctx, job, items, svc.config.projectFolder, profile, req.Master, format, masterFile, encodeFile)
	return job.snapshot(), nil
}

// encodeFor is the real encodeFileFunc: the first registered Encoder row that writes format.
func encodeFor(format string) encodeFileFunc {
	return func(ctx context.Context, wav, dst string, spec encodeport.Spec) error {
		for _, entry := range encodeport.Encoders.Entries() {
			if entry.Descriptor.Supports(format) {
				return entry.New().Encode(ctx, wav, dst, spec)
			}
		}
		return encodeport.FormatNotSupported("encoder", "none installed", format)
	}
}

// runExport masters (if asked) then encodes each item in turn. A panic ends the job as an error rather than taking
// the app down, matching runMeasure.
func (h *Host) runExport(
	ctx context.Context, job *exportJob, items []ExportItem, projectFolder string, profile deliveryprofile.Profile,
	master bool, format string, masterFile masterFileFunc, encodeFile encodeFileFunc,
) {
	defer job.cancel()
	defer func() {
		var broken error
		if recovered := recover(); recovered != nil {
			broken = fmt.Errorf("%v", recovered)
		}
		job.finish(ctx.Err() != nil && broken == nil, broken)
		h.publishExportEnd(job)
	}()
	masteredDir, encodedDir := exportScratchDir(projectFolder, "mastered"), exportScratchDir(projectFolder, "encoded")
	if err := os.MkdirAll(encodedDir, 0o755); err != nil {
		panic(err)
	}
	for index, item := range items {
		if ctx.Err() != nil {
			return
		}
		source := item.Path
		var result *MasteringSummary
		var masteredPath string
		if master {
			job.begin(index, exportFileMastering)
			if err := os.MkdirAll(masteredDir, 0o755); err != nil {
				job.fail(index, err)
				continue
			}
			masteredPath = filepath.Join(masteredDir, fmt.Sprintf("%02d-%s.wav", index+1, string(item.Kind)))
			_ = os.Remove(masteredPath) // a rerun's earlier scratch file is never the narrator's own data
			mastered, err := masterFile(ctx, mastering.Request{Source: source, Destination: masteredPath, Profile: profile},
				mastering.Options{Progress: func(done, total int64) { job.progress(index, done, total) }})
			if ctx.Err() != nil {
				return
			}
			if err != nil {
				job.fail(index, err)
				continue
			}
			summary := summarizeMastering(mastered)
			result, source = &summary, masteredPath
			job.completeStage(index, 0.5)
		}
		job.begin(index, exportFileEncoding)
		encodedPath := filepath.Join(encodedDir, fmt.Sprintf("%02d-%s.%s", index+1, string(item.Kind), format))
		_ = os.Remove(encodedPath)
		spec := encodeport.Spec{Format: format, Progress: func(done, total time.Duration) {
			if total > 0 {
				job.progress(index, int64(done), int64(total))
			}
		}}
		if err := encodeFile(ctx, source, encodedPath, spec); err != nil {
			if ctx.Err() != nil {
				return
			}
			job.fail(index, err)
			continue
		}
		if ctx.Err() != nil {
			return
		}
		job.completeStage(index, weightRemaining(master))
		job.succeed(index, masteredPath, result, encodedPath)
	}
}

// weightRemaining is the share of a file's weight the encode stage accounts for: all of it when there was no
// mastering stage first, half when there was (mastering already claimed the other half).
func weightRemaining(mastered bool) float64 {
	if mastered {
		return 0.5
	}
	return 1
}

func (h *Host) publishExportEnd(job *exportJob) {
	job.mu.RLock()
	event, ok := endedJob(job.id, jobKindRenderExport, job.phase, job.message, job.started)
	job.mu.RUnlock()
	if ok {
		h.publishJobEnded(event)
	}
}

// exportState answers the current or last export, or an idle job.
func (h *Host) exportState() ExportJob {
	h.mu.RLock()
	job := h.exportJob
	h.mu.RUnlock()
	if job != nil {
		return job.snapshot()
	}
	return ExportJob{Kind: jobKindRenderExport, Phase: "idle", Message: "Choose the files to master and encode.", Logs: []string{}, Files: []ExportFileResult{}}
}

// cancelExport stops a running export at its next file; files already prepared keep their results.
func (h *Host) cancelExport() ExportJob {
	h.mu.RLock()
	job := h.exportJob
	h.mu.RUnlock()
	if job == nil || !job.running() {
		return h.exportState()
	}
	job.mu.Lock()
	job.message = "Cancelling the export."
	job.mu.Unlock()
	job.cancel()
	return job.snapshot()
}

// pickExportFiles opens the picker and remembers what it chose, so only those paths can be exported (mirrors
// pickMeasureFiles, ADR 0156's own discipline).
func (h *Host) pickExportFiles() (MeasurePickResult, error) {
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
	if h.exportPicked == nil {
		h.exportPicked = map[string]bool{}
	}
	for _, path := range paths {
		h.exportPicked[path] = true
	}
	h.mu.Unlock()
	return MeasurePickResult{Paths: paths}, nil
}
