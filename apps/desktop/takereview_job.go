package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/chaptersync"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/process"
	"github.com/countrymanprime/narration-utils/shell/internal/runlog"
	"github.com/countrymanprime/narration-utils/shell/internal/takereview"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// The pickup and duplicate scan as a job (take-review-pickups-duplicates-take-intelligence.prd.md Phase 5): the Review
// page's scan dialog starts it with the scope the narrator chose (Q3), polls its real progress, the sidecar's own
// stage|pct|message line (ADR 0015), and can cancel it. The findings it saves go to the findings store under
// "take-review", where the Review page lists and decides them through the generic findings bindings (ADR 0120).

// takeReviewScanPollInterval is how often a running scan's progress file is read, as the Story Bible build does.
const takeReviewScanPollInterval = 250 * time.Millisecond

// TakeReviewScanScope is what the narrator chose to scan: a chapter track, and at most one pickup addition, a pickup
// track or a time range in project seconds (Q3). The idle job carries the project's saved pickup addition (the
// TakeReview settings) with no chapter track, for the dialog to offer.
type TakeReviewScanScope struct {
	ChapterTrackName string   `json:"chapterTrackName"`
	PickupTrackName  string   `json:"pickupTrackName,omitempty"`
	PickupRangeStart *float64 `json:"pickupRangeStart,omitempty"`
	PickupRangeEnd   *float64 `json:"pickupRangeEnd,omitempty"`
}

func (s TakeReviewScanScope) scope() takereview.Scope {
	return takereview.Scope{ChapterTrackName: s.ChapterTrackName, PickupTrackName: s.PickupTrackName, PickupRangeStart: s.PickupRangeStart, PickupRangeEnd: s.PickupRangeEnd}
}

func scanScopeOf(scope takereview.Scope) TakeReviewScanScope {
	return TakeReviewScanScope{ChapterTrackName: scope.ChapterTrackName, PickupTrackName: scope.PickupTrackName, PickupRangeStart: scope.PickupRangeStart, PickupRangeEnd: scope.PickupRangeEnd}
}

// TakeReviewScanJob is the scan as the dialog sees it, in the shape of the other host jobs (WorkJob in the UI): Phase
// is idle, running, success, cancelled or error; Percent and Message are the sidecar's own; Logs are the stages it went
// through; Found counts the groups of repeated reads the finished scan saved.
type TakeReviewScanJob struct {
	ID      *string             `json:"id"`
	Kind    string              `json:"kind"`
	Phase   string              `json:"phase"`
	Message string              `json:"message"`
	Percent int                 `json:"percent"`
	Logs    []string            `json:"logs"`
	Elapsed float64             `json:"elapsed"`
	Error   string              `json:"error,omitempty"`
	Scope   TakeReviewScanScope `json:"scope"`
	Found   int                 `json:"found"`
}

type takeReviewScanJob struct {
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
	scope TakeReviewScanScope
	// +checklocks:mu
	found        int
	progressPath string
	cancel       context.CancelFunc
}

func (j *takeReviewScanJob) running() bool {
	j.mu.RLock()
	defer j.mu.RUnlock()
	return j.phase == "running"
}

func (j *takeReviewScanJob) snapshot() TakeReviewScanJob {
	j.mu.RLock()
	defer j.mu.RUnlock()
	id := j.id
	return TakeReviewScanJob{
		ID: &id, Kind: jobKindTakeReview, Phase: j.phase, Message: j.message, Percent: j.percent,
		Logs: append([]string{}, j.logs...), Elapsed: time.Since(j.started).Seconds(), Error: j.errorText, Scope: j.scope, Found: j.found,
	}
}

// pollProgress folds the sidecar's latest progress line into the job: the percent never moves backwards, and each new
// stage message becomes a line of live activity. A missing or unreadable line keeps what the job already shows.
func (j *takeReviewScanJob) pollProgress() {
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

// finish records how the scan ended, from what Scan answered and whether the narrator cancelled it.
func (j *takeReviewScanJob) finish(saved []findings.Finding, err error, cancelled bool) {
	j.mu.Lock()
	defer j.mu.Unlock()
	track := j.scope.ChapterTrackName
	switch {
	case cancelled:
		j.phase, j.message = "cancelled", "Scan cancelled. Nothing was saved."
	case err != nil:
		j.phase, j.message, j.errorText = "error", "The scan did not finish.", err.Error()
	default:
		j.phase, j.percent = "success", 100
		for _, finding := range saved {
			if !finding.NotInLatestRun {
				j.found++
			}
		}
		switch j.found {
		case 0:
			j.message = fmt.Sprintf("No repeated reads found in %s.", track)
		case 1:
			j.message = fmt.Sprintf("Found 1 group of repeated reads in %s.", track)
		default:
			j.message = fmt.Sprintf("Found %d groups of repeated reads in %s.", j.found, track)
		}
	}
	j.logs = append(j.logs, j.message)
}

// startTakeReviewScan checks the scope against the project as it is now, then runs the scan in the background.
func (h *Host) startTakeReviewScan(requested TakeReviewScanScope) (TakeReviewScanJob, error) {
	scope := requested.scope()
	if err := takereview.ValidateScope(scope); err != nil {
		return TakeReviewScanJob{}, err
	}
	svc := h.services()
	if svc.settings == nil || svc.findings == nil {
		return TakeReviewScanJob{}, errNoProject
	}
	project, err := h.tracksList()
	if err != nil {
		return TakeReviewScanJob{}, err
	}
	for _, name := range []string{scope.ChapterTrackName, scope.PickupTrackName} {
		if name != "" && !hasTrack(project, name) {
			return TakeReviewScanJob{}, fmt.Errorf("the REAPER project has no track named %q; reload the tracks and choose again", name)
		}
	}

	ctx, cancel := context.WithCancel(context.Background())
	id := fmt.Sprintf("take-review-%d", time.Now().UnixNano())
	ctx = runlog.WithRun(ctx, h.jobRuns.begin(h.runLog, id, jobKindTakeReview, "chapter_track", scope.ChapterTrackName))
	job := &takeReviewScanJob{
		id: id, phase: "running", started: time.Now(), scope: requested, cancel: cancel,
		message: fmt.Sprintf("Scanning %s for pickups and duplicates.", scope.ChapterTrackName),
	}
	job.logs = []string{job.message}
	sessionDir := takeReviewSessionDir(svc.config.sessionDir)
	job.progressPath = filepath.Join(sessionDir, "take_review_progress_"+job.id+".txt")

	h.mu.Lock()
	if h.takeReviewJob != nil && h.takeReviewJob.running() {
		h.mu.Unlock()
		cancel()
		return TakeReviewScanJob{}, fmt.Errorf("a pickup and duplicate scan is already running")
	}
	h.takeReviewJob = job
	h.mu.Unlock()

	scanner := &takereview.Scanner{Runner: h.takeReviewRunnerFor(svc), Store: svc.findings}
	request := takereview.Request{
		Project:        project,
		ProjectPath:    svc.config.projectFolder,
		ManuscriptPath: takeReviewManuscriptPath(svc.config.projectFolder),
		ChapterID:      takeReviewChapterID(scope.ChapterTrackName),
		ChapterTitle:   scope.ChapterTrackName,
		Scope:          scope,
		Thresholds:     takereview.ResolveThresholds(svc.settings),
		ProgressPath:   job.progressPath,
	}
	go h.runTakeReviewScan(ctx, job, scanner, request)
	return job.snapshot(), nil
}

// runTakeReviewScan runs the scan while tailing its progress file, then records how it ended and says so (ADR 0076).
func (h *Host) runTakeReviewScan(ctx context.Context, job *takeReviewScanJob, scanner *takereview.Scanner, request takereview.Request) {
	defer job.cancel()
	if err := os.MkdirAll(filepath.Dir(job.progressPath), 0o755); err != nil {
		job.finish(nil, fmt.Errorf("could not create the scan's session folder: %w", err), false)
		h.publishTakeReviewEnd(job)
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
	saved, err := scanner.Scan(ctx, request)
	close(stop)
	<-stopped
	job.pollProgress()
	job.finish(saved, err, ctx.Err() != nil)
	_ = os.Remove(job.progressPath)
	_ = os.Remove(job.progressPath + ".cancel")
	if err == nil && ctx.Err() == nil {
		h.recordPickupScan(request)
	}
	h.publishTakeReviewEnd(job)
}

// recordPickupScan remembers, for a finished scan that included a pickup track, that track as it was scanned (its
// fingerprint in the project the scan read), so the chapter's row can say when it has pickups the scan has not seen
// (daw-chapter-track-auto-sync.prd.md Phase 8). A failure only means the row keeps saying the pickups changed; it is
// logged, never raised.
func (h *Host) recordPickupScan(request takereview.Request) {
	if request.Scope.PickupTrackName == "" {
		return
	}
	for _, track := range request.Project.Tracks {
		if track.Name != request.Scope.PickupTrackName {
			continue
		}
		scan := chaptersync.PickupScan{TrackGUID: track.GUID, Fingerprint: chaptersync.Fingerprint(track), ScannedAt: time.Now()}
		if err := chaptersync.NewStore(request.ProjectPath).RecordPickupScan(scan); err != nil {
			if h.log != nil {
				_ = h.log.Report("pickup_scan_record_failed", err.Error())
			}
			return
		}
		h.emitChapterSyncState()
		return
	}
}

func (h *Host) publishTakeReviewEnd(job *takeReviewScanJob) {
	job.mu.RLock()
	event, ok := endedJob(job.id, jobKindTakeReview, job.phase, job.message, job.started)
	job.mu.RUnlock()
	if ok {
		h.publishJobEnded(event)
	}
}

// takeReviewScanState answers the current or last scan, or an idle job offering the project's saved pickup scope.
func (h *Host) takeReviewScanState() TakeReviewScanJob {
	h.mu.RLock()
	job := h.takeReviewJob
	h.mu.RUnlock()
	if job != nil {
		return job.snapshot()
	}
	idle := TakeReviewScanJob{Kind: jobKindTakeReview, Phase: "idle", Message: "Ready to scan for pickups and duplicates.", Logs: []string{}}
	if store := h.services().settings; store != nil {
		idle.Scope = scanScopeOf(takereview.ResolvePickupScope(store, ""))
	}
	return idle
}

// cancelTakeReviewScan asks a running scan to stop: the sidecar stops at its next check (its cancel file) and the
// process is stopped regardless. The job reports cancelled once the scan has returned; nothing it found is saved.
func (h *Host) cancelTakeReviewScan() TakeReviewScanJob {
	h.mu.RLock()
	job := h.takeReviewJob
	h.mu.RUnlock()
	if job == nil || !job.running() {
		return h.takeReviewScanState()
	}
	job.mu.Lock()
	job.message = "Cancelling the scan."
	job.mu.Unlock()
	_ = os.WriteFile(job.progressPath+".cancel", nil, 0o600)
	job.cancel()
	return job.snapshot()
}

// readSidecarProgress reads the last stage|pct|message line a sidecar wrote to its progress file (ADR 0015); ok is false
// while there is none that parses.
func readSidecarProgress(path string) (percent float64, message string, ok bool) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return 0, "", false
	}
	lines := strings.Split(strings.TrimSpace(string(raw)), "\n")
	_, percent, message, err = process.ParseProgress(lines[len(lines)-1])
	return percent, message, err == nil
}

func hasTrack(project tracks.Project, name string) bool {
	for _, track := range project.Tracks {
		if track.Name == name {
			return true
		}
	}
	return false
}
