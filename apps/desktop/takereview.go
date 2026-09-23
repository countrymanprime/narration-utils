package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/repeats"
	"github.com/countrymanprime/narration-utils/shell/internal/takereview"
)

// takeReviewCreateTakeTimeout bounds the confirm dialog's own wait, one notch above
// internal/takereview.CreateTake's internal bridge-response timeout, so a REAPER
// hang is reported by the more specific message first.
const takeReviewCreateTakeTimeout = 12 * time.Second

// takeReviewUnsafeScopeChars is everything findings.Store's scope name
// pattern rejects (apps/desktop/internal/findings/store.go's
// scopeNamePattern: letters, digits, dot, underscore, hyphen only) - a
// REAPER track name can contain spaces or other punctuation the findings
// store cannot use as a file name component.
var takeReviewUnsafeScopeChars = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

// takeReviewChapterID derives the findings store's scope id (and
// findings.Manuscript.ChapterID) from the chapter track name a scan
// covers: this milestone has no manuscript chapter picker (Q6 - spans come
// from alignment, not stamped ids), so the track name is both what the
// narrator chose to scan and the scope its findings are saved and read
// back under. The human-readable name stays intact as ChapterTitle.
func takeReviewChapterID(chapterTrackName string) string {
	id := strings.Trim(takeReviewUnsafeScopeChars.ReplaceAllString(chapterTrackName, "-"), "-")
	if id == "" {
		id = "chapter"
	}
	return id
}

// takeReviewManuscriptPath is the canonical manuscript file manuscript
// import writes (internal/manuscript.Service.Load reads the same path),
// the document the repeated-span detector aligns transcribed reads
// against.
func takeReviewManuscriptPath(projectFolder string) string {
	return filepath.Join(projectFolder, "narration-utils", "manuscript", "manuscript.json")
}

// takeReviewSessionDir mirrors configureLocked's teleprompterDir fallback
// (apps/desktop/app.go): a launch with no REAPER session directory still
// needs somewhere to write the sidecar's scratch --find-repeats output
// file.
func takeReviewSessionDir(sessionDir string) string {
	if sessionDir != "" {
		return sessionDir
	}
	return filepath.Join(os.TempDir(), "narration-utils")
}

// takeReviewRunnerFor builds the real SidecarRunner from project config,
// unless h.takeReviewRunner is set (a test seam; nil means the real
// process, apps/desktop/internal/takereview.ProcessRunner).
func (h *Host) takeReviewRunnerFor(svc hostServices) takereview.SidecarRunner {
	if h.takeReviewRunner != nil {
		return h.takeReviewRunner
	}
	return &takereview.ProcessRunner{
		Sidecars:   h.sidecars,
		Python:     svc.config.comparePython,
		Backend:    svc.config.compareBackend,
		SessionDir: takeReviewSessionDir(svc.config.sessionDir),
	}
}

// takeReviewScan runs one pickup/duplicate scan of chapterTrackName's items
// and takes (plus any narrator-configured pickup addition, Q3 of
// take-review-pickups-duplicates-take-intelligence.prd.md) and saves the
// fresh findings into the project's findings store, returning the store's
// merged result (fresh findings plus any carried-forward decision history).
//
// It runs to completion rather than reporting progress: phase 5's scope is
// triggering a scan and reading back results, not the real-progress
// polling job other long-running actions use (TranscriptStart, the asset
// install jobs). A later phase can add a polling job beside this
// synchronous path without changing its signature, the same way
// ManuscriptImportPreview grew a StartPreview sibling beside its
// synchronous Preview.
func (h *Host) takeReviewScan(chapterTrackName string) ([]findings.Finding, error) {
	if chapterTrackName == "" {
		return nil, fmt.Errorf("choose a track to scan for pickups and duplicates")
	}
	svc := h.services()
	if svc.settings == nil || svc.findings == nil {
		return nil, fmt.Errorf("no project is open")
	}
	project, err := h.tracksList()
	if err != nil {
		return nil, err
	}

	scanner := &takereview.Scanner{Runner: h.takeReviewRunnerFor(svc), Store: svc.findings}
	req := takereview.Request{
		Project:        project,
		ProjectPath:    svc.config.projectFolder,
		ManuscriptPath: takeReviewManuscriptPath(svc.config.projectFolder),
		ChapterID:      takeReviewChapterID(chapterTrackName),
		ChapterTitle:   chapterTrackName,
		Scope:          takereview.ResolvePickupScope(svc.settings, chapterTrackName),
		Thresholds:     takereview.ResolveThresholds(svc.settings),
	}
	return scanner.Scan(context.Background(), req)
}

// takeReviewFindings reads the take-review analyzer's saved findings for
// chapterTrackName (every chapter when empty) without running a new scan,
// so the scan-and-review surface can restore its last result when the
// Tracks page loads.
func (h *Host) takeReviewFindings(chapterTrackName string) ([]findings.Finding, error) {
	svc := h.services()
	if svc.findings == nil {
		return nil, fmt.Errorf("no project is open")
	}
	chapterID := ""
	if chapterTrackName != "" {
		chapterID = takeReviewChapterID(chapterTrackName)
	}
	return svc.findings.List(findings.Query{Analyzer: repeats.AnalyzerName, ChapterID: chapterID})
}

// takeReviewCreateTake sends the create_take bridge command for a narrator-approved candidate (phase 6 of
// take-review-pickups-duplicates-take-intelligence.prd.md): the finding id (provenance, ADR 0098), the target
// item's own GUID (Q4/Q6 - the narrator chooses it explicitly; this method never preselects one), the candidate's
// own item GUID when it has one, its source file, and the matched span's range within that source. It does not
// change the finding's review status in the store: that belongs to the Review page (review-dashboard-and-
// findings-adoption.prd.md), which this milestone does not yet have (phase 5's own delivery note).
func (h *Host) takeReviewCreateTake(req takereview.CreateTakeRequest) (takereview.CreateTakeResult, error) {
	svc := h.services()
	if svc.bridge == nil {
		return takereview.CreateTakeResult{}, fmt.Errorf("open the project from REAPER before creating a take")
	}
	ctx, cancel := context.WithTimeout(context.Background(), takeReviewCreateTakeTimeout)
	defer cancel()
	return takereview.CreateTake(ctx, svc.bridge, takeReviewSessionDir(svc.config.sessionDir), req)
}
