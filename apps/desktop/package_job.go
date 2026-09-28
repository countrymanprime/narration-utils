package main

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
	"github.com/countrymanprime/narration-utils/shell/internal/packager"
	"github.com/countrymanprime/narration-utils/shell/internal/runlog"
)

// The packaging half of the Master & QC export flow (render-encode-master.prd.md Phase 5): packager.Assemble (Phase
// 4) over the files ExportStart already mastered and encoded, into a folder the narrator chooses with the operating
// system's own picker (Q5) - never inside the project's narration-utils/ sidecar tree, so a package is never written
// where exportScratchDir's own intermediates live. Assemble copies already-small, already-encoded files (never the
// large WAVs the export job processes), so unlike ExportStart's own per-file progress, PackageStart reports only
// running and done; ADR 0075's 100 ms acknowledgement still holds because the copy runs in the background, not on
// the call that starts it.

// PackageItem is one already-encoded file (an ExportJob file's own EncodedPath) ready to package. Kind is one of
// packager.Kind's own values, kept a plain string on the wire so the UI's contract does not depend on a Go enum type.
type PackageItem struct {
	Kind  string `json:"kind"`
	Title string `json:"title"`
	Path  string `json:"path"`
}

// PackageRequest is what PackageStart is asked to assemble: one profile's book checklist, the encoded items ready,
// and (once the folder picker answers) where to write it.
type PackageRequest struct {
	ProfileID      string        `json:"profileId"`
	ProfileVersion string        `json:"profileVersion"`
	Items          []PackageItem `json:"items"`
}

// PackageManifestFile mirrors packager.ManifestFile over the wire (Kind as a plain string, see PackageItem).
type PackageManifestFile struct {
	Kind     string `json:"kind"`
	Name     string `json:"name"`
	DestPath string `json:"destPath"`
	Tagged   bool   `json:"tagged"`
}

// PackageChecklistItem mirrors packager.ChecklistItem over the wire.
type PackageChecklistItem struct {
	RuleID string `json:"ruleId"`
	Label  string `json:"label"`
	Status string `json:"status"`
	Detail string `json:"detail"`
}

// PackageJob is the package assembly as the UI sees it, in the shape of the other host jobs.
type PackageJob struct {
	ID        *string                `json:"id"`
	Kind      string                 `json:"kind"`
	Phase     string                 `json:"phase"`
	Message   string                 `json:"message"`
	Profile   string                 `json:"profile"`
	OutputDir string                 `json:"outputDir"`
	Files     []PackageManifestFile  `json:"files"`
	Checklist []PackageChecklistItem `json:"checklist"`
	Elapsed   float64                `json:"elapsed"`
	Error     string                 `json:"error,omitempty"`
}

type packageJobState struct {
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
	profile string
	// +checklocks:mu
	outputDir string
	// +checklocks:mu
	files []PackageManifestFile
	// +checklocks:mu
	checklist []PackageChecklistItem
	// +checklocks:mu
	started time.Time
	cancel  context.CancelFunc
}

func (j *packageJobState) running() bool {
	j.mu.RLock()
	defer j.mu.RUnlock()
	return j.phase == "running"
}

func (j *packageJobState) snapshot() PackageJob {
	j.mu.RLock()
	defer j.mu.RUnlock()
	id := j.id
	return PackageJob{
		ID: &id, Kind: jobKindRenderPackage, Phase: j.phase, Message: j.message, Profile: j.profile, OutputDir: j.outputDir,
		Files: append([]PackageManifestFile{}, j.files...), Checklist: append([]PackageChecklistItem{}, j.checklist...),
		Elapsed: time.Since(j.started).Seconds(), Error: j.errorText,
	}
}

// assembleFunc is a seam for tests: nil means packager.Assemble.
type assembleFunc func(ctx context.Context, req packager.Request) (packager.Manifest, error)

// packageItems checks what PackageStart was sent: at least one chapter, and every path an EncodedPath the last
// export job actually wrote (never an arbitrary host path), each once, every non-chapter kind at most once.
func (h *Host) packageItems(items []PackageItem) ([]PackageItem, error) {
	h.mu.RLock()
	job := h.exportJob
	h.mu.RUnlock()
	if job == nil {
		return nil, errors.New("export the files to package first")
	}
	encoded := map[string]bool{}
	for _, file := range job.snapshot().Files {
		if file.EncodedPath != "" {
			encoded[file.EncodedPath] = true
		}
	}
	seenPath := map[string]bool{}
	seenKind := map[string]bool{}
	out := make([]PackageItem, 0, len(items))
	for _, item := range items {
		if !encoded[item.Path] {
			return nil, fmt.Errorf("%q was not encoded in this session; export it again", item.Path)
		}
		if item.Kind != string(packager.KindChapter) && seenKind[item.Kind] {
			return nil, fmt.Errorf("only one %s file is expected", item.Kind)
		}
		if seenPath[item.Path] {
			continue
		}
		seenPath[item.Path], seenKind[item.Kind] = true, true
		out = append(out, item)
	}
	if len(out) == 0 {
		return nil, errors.New("choose at least one exported chapter to package")
	}
	return out, nil
}

func packageRequest(profile deliveryprofile.Profile, items []PackageItem, outputDir string) packager.Request {
	req := packager.Request{Profile: profile, OutputDir: outputDir}
	for _, item := range items {
		entry := packager.Item{Title: item.Title, Path: item.Path}
		switch packager.Kind(item.Kind) {
		case packager.KindChapter:
			req.Chapters = append(req.Chapters, entry)
		case packager.KindCreditsOpening:
			req.CreditsOpening = &entry
		case packager.KindCreditsClosing:
			req.CreditsClosing = &entry
		case packager.KindRetailSample:
			req.RetailSample = &entry
		}
	}
	return req
}

// startPackage opens the folder picker, then assembles the package in the background; only one package job runs at
// once.
func (h *Host) startPackage(req PackageRequest) (PackageJob, error) {
	items, err := h.packageItems(req.Items)
	if err != nil {
		return PackageJob{}, err
	}
	store := h.profileStore()
	profile, found, err := store.Resolve(deliveryprofile.Ref{ID: req.ProfileID, Version: req.ProfileVersion})
	if err != nil {
		return PackageJob{}, err
	}
	if !found {
		return PackageJob{}, fmt.Errorf("there is no delivery profile %q", req.ProfileID)
	}
	projectFolder := h.services().config.projectFolder

	pick := h.pickPackageFolder
	if pick == nil {
		pick = func() (string, error) { return pickFolder("Choose where to save the delivery package") }
	}
	outputDir, err := pick()
	if err != nil {
		return PackageJob{}, err
	}
	if outputDir == "" {
		return h.packageState(), nil
	}
	if inSidecarTree(projectFolder, outputDir) {
		return PackageJob{}, errors.New("a delivery package cannot be saved inside the project's narration-utils folder; choose a different folder")
	}

	ctx, cancel := context.WithCancel(context.Background())
	id := fmt.Sprintf("package-%d", time.Now().UnixNano())
	ctx = runlog.WithRun(ctx, h.jobRuns.begin(h.runLog, id, jobKindRenderPackage, "file_count", len(items), "profile", profile.Key()))
	job := &packageJobState{id: id, phase: "running", started: time.Now(), cancel: cancel, profile: profile.Key(), outputDir: outputDir}
	job.message = fmt.Sprintf("Building the %s package.", profile.Title())

	h.mu.Lock()
	if h.packageJob != nil && h.packageJob.running() {
		h.mu.Unlock()
		cancel()
		return PackageJob{}, errors.New("a package is already being built")
	}
	if h.multiPackageJob != nil && h.multiPackageJob.running() {
		h.mu.Unlock()
		cancel()
		return PackageJob{}, errors.New("a multi-platform package is already being built")
	}
	h.packageJob = job
	h.mu.Unlock()

	assemble := h.assemblePackage
	if assemble == nil {
		assemble = packager.Assemble
	}
	go h.runPackage(ctx, job, packageRequest(profile, items, outputDir), assemble)
	return job.snapshot(), nil
}

func (h *Host) runPackage(ctx context.Context, job *packageJobState, req packager.Request, assemble assembleFunc) {
	defer job.cancel()
	manifest, err := assemble(ctx, req)
	defer func() {
		var broken error
		if recovered := recover(); recovered != nil {
			broken = fmt.Errorf("%v", recovered)
		}
		h.finishPackage(job, manifest, err, broken, ctx.Err() != nil)
	}()
}

func (h *Host) finishPackage(job *packageJobState, manifest packager.Manifest, err, broken error, cancelled bool) {
	job.mu.Lock()
	switch {
	case broken != nil:
		job.phase, job.errorText = "error", broken.Error()
		job.message = "The package could not be built."
	case cancelled:
		job.phase, job.message = "cancelled", "Packaging cancelled."
	case err != nil:
		job.phase, job.errorText = "error", err.Error()
		job.message = "The package could not be built: " + err.Error()
	default:
		job.phase = "success"
		job.message = fmt.Sprintf("Built the %s package with %d files.", job.profile, len(manifest.Files))
		for _, file := range manifest.Files {
			job.files = append(job.files, PackageManifestFile{Kind: string(file.Kind), Name: file.Name, DestPath: file.DestPath, Tagged: file.Tagged})
		}
		for _, item := range manifest.Checklist {
			job.checklist = append(job.checklist, PackageChecklistItem{RuleID: item.RuleID, Label: item.Label, Status: string(item.Status), Detail: item.Detail})
		}
	}
	id, phase, message, started := job.id, job.phase, job.message, job.started
	job.mu.Unlock()
	if event, ok := endedJob(id, jobKindRenderPackage, phase, message, started); ok {
		h.publishJobEnded(event)
	}
}

// packageState answers the current or last package job, or an idle job.
func (h *Host) packageState() PackageJob {
	h.mu.RLock()
	job := h.packageJob
	h.mu.RUnlock()
	if job != nil {
		return job.snapshot()
	}
	return PackageJob{Kind: jobKindRenderPackage, Phase: "idle", Message: "Export files, then build a package.", Files: []PackageManifestFile{}, Checklist: []PackageChecklistItem{}}
}

// cancelPackage stops a running package build; packager.Assemble checks its context between files and writes
// nothing partial (it refuses before writing when a required item is missing, and every write it does make stays,
// since Assemble itself has no notion of "undo a copy already made" - a cancel simply stops it from writing more).
func (h *Host) cancelPackage() PackageJob {
	h.mu.RLock()
	job := h.packageJob
	h.mu.RUnlock()
	if job == nil || !job.running() {
		return h.packageState()
	}
	job.mu.Lock()
	job.message = "Cancelling the package build."
	job.mu.Unlock()
	job.cancel()
	return job.snapshot()
}

// inSidecarTree reports whether dir is the project's narration-utils folder or a folder inside it: a delivery
// package is the narrator's own deliverable, never derived app state (Q5), so it is refused there even when the
// narrator's own picker chose it. With no open project (or a relative dir Abs could not resolve) it answers false:
// nothing to protect.
func inSidecarTree(projectFolder, dir string) bool {
	if projectFolder == "" {
		return false
	}
	sidecar, err := filepath.Abs(filepath.Join(projectFolder, "narration-utils"))
	if err != nil {
		return false
	}
	target, err := filepath.Abs(dir)
	if err != nil {
		return false
	}
	if runtime.GOOS == "windows" {
		sidecar, target = strings.ToLower(sidecar), strings.ToLower(target)
	}
	return target == sidecar || strings.HasPrefix(target, sidecar+string(filepath.Separator))
}
