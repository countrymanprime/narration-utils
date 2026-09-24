package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/takecompare"
)

// Comparing the takes of one group of repeated reads, as a job (take-review-pickups-duplicates-take-intelligence.prd.md
// Phase 10, ADR 0165): the Review page starts it from a take-review group, polls the sidecar's own progress (ADR 0015)
// and can cancel it. The comparison it saves is a take_comparison finding under "take-comparison", listed and decided
// through the generic findings bindings (ADR 0120). The page sends only the group's id: everything the sidecar reads is
// built here from the saved project and the store (threat model 4f).

// TakeComparisonJob is the comparison as the dialog sees it, in the shape of the other host jobs: FindingID is the group
// being compared and ComparisonID the take_comparison finding a successful run saved.
type TakeComparisonJob struct {
	ID           *string  `json:"id"`
	Kind         string   `json:"kind"`
	Phase        string   `json:"phase"`
	Message      string   `json:"message"`
	Percent      int      `json:"percent"`
	Logs         []string `json:"logs"`
	Elapsed      float64  `json:"elapsed"`
	Error        string   `json:"error,omitempty"`
	FindingID    string   `json:"findingId"`
	ComparisonID string   `json:"comparisonId,omitempty"`
}

type takeComparisonJob struct {
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
	findingID string
	// +checklocks:mu
	comparisonID string
	progressPath string
	cancel       context.CancelFunc
}

func (j *takeComparisonJob) running() bool {
	j.mu.RLock()
	defer j.mu.RUnlock()
	return j.phase == "running"
}

func (j *takeComparisonJob) snapshot() TakeComparisonJob {
	j.mu.RLock()
	defer j.mu.RUnlock()
	id := j.id
	return TakeComparisonJob{
		ID: &id, Kind: jobKindTakeComparison, Phase: j.phase, Message: j.message, Percent: j.percent, Logs: append([]string{}, j.logs...),
		Elapsed: time.Since(j.started).Seconds(), Error: j.errorText, FindingID: j.findingID, ComparisonID: j.comparisonID,
	}
}

// pollProgress folds the sidecar's latest progress line into the job, never moving the percent backwards.
func (j *takeComparisonJob) pollProgress() {
	percent, message, ok := readSidecarProgress(j.progressPath)
	if !ok {
		return
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.phase != "running" {
		return
	}
	if int(percent) > j.percent && percent < 100 {
		j.percent = int(percent)
	}
	if message != "" && message != j.message {
		j.message = message
		j.logs = append(j.logs, message)
	}
}

func (j *takeComparisonJob) finish(saved findings.Finding, err error, cancelled bool) {
	j.mu.Lock()
	defer j.mu.Unlock()
	switch {
	case cancelled:
		j.phase, j.message = "cancelled", "Comparison cancelled. Nothing was saved."
	case err != nil:
		j.phase, j.message, j.errorText = "error", "The comparison did not finish.", err.Error()
	default:
		j.phase, j.percent, j.comparisonID = "success", 100, saved.ID
		j.message = "Compared the takes. Each one's evidence is shown side by side."
	}
	j.logs = append(j.logs, j.message)
}

// startTakeComparison checks the group, the saved project and the manuscript, then compares in the background.
func (h *Host) startTakeComparison(findingID string) (TakeComparisonJob, error) {
	svc := h.services()
	if svc.findings == nil || svc.manuscript == nil {
		return TakeComparisonJob{}, errNoProject
	}
	group, found, err := svc.findings.Get(findingID)
	switch {
	case err != nil:
		return TakeComparisonJob{}, err
	case !found:
		return TakeComparisonJob{}, fmt.Errorf("this group is not in the review list any more; reload the list")
	}
	parsed, err := takecompare.GroupOf(group)
	if err != nil {
		return TakeComparisonJob{}, err
	}
	chapterID, err := comparisonChapterID(svc, parsed.Manuscript.ChapterTitle)
	if err != nil {
		return TakeComparisonJob{}, err
	}
	project, err := h.tracksList()
	if err != nil {
		return TakeComparisonJob{}, err
	}

	ctx, cancel := context.WithCancel(context.Background())
	job := &takeComparisonJob{
		id: fmt.Sprintf("take-comparison-%d", time.Now().UnixNano()), phase: "running", started: time.Now(), findingID: findingID, cancel: cancel,
		message: fmt.Sprintf("Comparing %d reads.", len(parsed.Reads)),
	}
	job.logs = []string{job.message}
	sessionDir := takeReviewSessionDir(svc.config.sessionDir)
	job.progressPath = filepath.Join(sessionDir, "take_comparison_progress_"+job.id+".txt")

	h.mu.Lock()
	if h.takeComparisonJob != nil && h.takeComparisonJob.running() {
		h.mu.Unlock()
		cancel()
		return TakeComparisonJob{}, fmt.Errorf("a take comparison is already running")
	}
	h.takeComparisonJob = job
	h.mu.Unlock()

	comparer := &takecompare.Comparer{Runner: h.takeCompareRunnerFor(svc), Store: svc.findings}
	request := takecompare.Request{
		Group: group, Project: project, ProjectPath: svc.config.projectFolder, ManuscriptPath: takeReviewManuscriptPath(svc.config.projectFolder),
		ChapterID: chapterID, ProgressPath: job.progressPath, SessionDir: sessionDir,
	}
	go h.runTakeComparison(ctx, job, comparer, request)
	return job.snapshot(), nil
}

func (h *Host) runTakeComparison(ctx context.Context, job *takeComparisonJob, comparer *takecompare.Comparer, request takecompare.Request) {
	defer job.cancel()
	if err := os.MkdirAll(filepath.Dir(job.progressPath), 0o755); err != nil {
		job.finish(findings.Finding{}, fmt.Errorf("could not create the comparison's session folder: %w", err), false)
		h.publishTakeComparisonEnd(job)
		return
	}
	stop, stopped := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(stopped)
		ticker := time.NewTicker(takeReviewScanPollInterval)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				job.pollProgress()
			}
		}
	}()
	saved, err := comparer.Compare(ctx, request)
	close(stop)
	<-stopped
	job.pollProgress()
	job.finish(saved, err, ctx.Err() != nil)
	_ = os.Remove(job.progressPath)
	_ = os.Remove(job.progressPath + ".cancel")
	h.publishTakeComparisonEnd(job)
}

func (h *Host) publishTakeComparisonEnd(job *takeComparisonJob) {
	job.mu.RLock()
	event, ok := endedJob(job.id, jobKindTakeComparison, job.phase, job.message, job.started)
	job.mu.RUnlock()
	if ok {
		h.publishJobEnded(event)
	}
}

// takeComparisonState answers the current or last comparison, or an idle job.
func (h *Host) takeComparisonState() TakeComparisonJob {
	h.mu.RLock()
	job := h.takeComparisonJob
	h.mu.RUnlock()
	if job != nil {
		return job.snapshot()
	}
	return TakeComparisonJob{Kind: jobKindTakeComparison, Phase: "idle", Message: "Ready to compare takes.", Logs: []string{}}
}

// cancelTakeComparison asks a running comparison to stop: the sidecar stops between takes and the process is stopped
// regardless. Nothing is saved.
func (h *Host) cancelTakeComparison() TakeComparisonJob {
	h.mu.RLock()
	job := h.takeComparisonJob
	h.mu.RUnlock()
	if job == nil || !job.running() {
		return h.takeComparisonState()
	}
	job.mu.Lock()
	job.message = "Cancelling the comparison."
	job.mu.Unlock()
	_ = os.WriteFile(job.progressPath+".cancel", nil, 0o600)
	job.cancel()
	return job.snapshot()
}

// takeCompareRunnerFor builds the real runner from project config, unless h.takeCompareRunner is set (a test seam).
func (h *Host) takeCompareRunnerFor(svc hostServices) takecompare.SidecarRunner {
	if h.takeCompareRunner != nil {
		return h.takeCompareRunner
	}
	return &takecompare.ProcessRunner{
		Sidecars: h.sidecars, Python: svc.config.comparePython, Backend: svc.config.compareBackend, SessionDir: takeReviewSessionDir(svc.config.sessionDir),
	}
}

// comparisonChapterID is the manuscript chapter a group's sentence numbers belong to: the narration chapter the scan
// aligned to, which it chose by its title (compare.py's find_chapter_by_exact_title, a heading's lines joined by ": ").
func comparisonChapterID(svc hostServices, title string) (string, error) {
	data, err := svc.manuscript.Load()
	if err != nil {
		return "", err
	}
	var id string
	for _, raw := range asObjects(data["chapters"]) {
		kind, _ := raw["contentKind"].(string)
		chapterTitle, _ := raw["title"].(string)
		if (kind != "" && kind != "narration") || displayTitle(chapterTitle) != title {
			continue
		}
		if id != "" {
			return "", fmt.Errorf("more than one chapter of the manuscript is titled %q, so the part of the script to compare is not known", title)
		}
		id, _ = raw["id"].(string)
	}
	if id == "" {
		return "", fmt.Errorf("no chapter of the manuscript is titled %q any more; scan the chapter again", title)
	}
	return id, nil
}

// displayTitle joins a heading's lines as compare.py's display_title does.
func displayTitle(title string) string {
	var lines []string
	for _, line := range strings.Split(title, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			lines = append(lines, line)
		}
	}
	return strings.Join(lines, ": ")
}

func asObjects(value any) []map[string]any {
	list, _ := value.([]any)
	objects := make([]map[string]any, 0, len(list))
	for _, item := range list {
		if object, ok := item.(map[string]any); ok {
			objects = append(objects, object)
		}
	}
	return objects
}
