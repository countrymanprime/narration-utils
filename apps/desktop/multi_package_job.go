package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
	"github.com/countrymanprime/narration-utils/shell/internal/encodeport"
	"github.com/countrymanprime/narration-utils/shell/internal/packager"
	"github.com/countrymanprime/narration-utils/shell/internal/runlog"
)

// Multi-platform export (render-encode-master.prd.md Phase 6): one mastered/encoded source produces packages for
// several selected delivery profiles in one action, built on top of the same export job's own encoded files
// PackageStart already packages (package_job.go, Phase 5). A selection that needs the export job's own current
// format reuses its already-encoded files; a selection whose profile requires a different container format (today
// only ACX's mp3_format rule exists, so a second format only ever comes from a custom or future profile) triggers
// exactly one additional encode per export-job file for that format, memoized so two selected profiles sharing a
// non-default format share one encode too (ADR 0480). Every profile's package is built in its own subfolder of one
// narrator-chosen root, sequentially (never concurrently: they would otherwise write into the same filesystem tree
// and share the encoder's own subprocess use, ADR 0480), so a cancel stops cleanly between profiles rather than
// leaving two half-written packages at once.

// requiredFormatMetric matches a file-scope rule's Metric that names the container format it requires, such as
// ACX's own "mp3_format" (internal/deliveryprofile/acx.go); its capture group is the format itself.
var requiredFormatMetric = regexp.MustCompile(`^(\w+)_format$`)

// requiredFormat is the encode format profile's own rules require: the capture group of the first file-scope rule
// whose Metric matches "<format>_format", or "mp3" when no such rule exists. deliveryprofile.Profile has no explicit
// format field (Q: internal/deliveryprofile's own Rule.Metric is the only signal), so this reads that existing
// naming convention rather than adding one to a package several tools already share (ADR 0480): it lives here, in
// apps/desktop, a caller of internal/deliveryprofile, not inside that package or internal/packager.
func requiredFormat(profile deliveryprofile.Profile) string {
	for _, rule := range profile.Rules {
		if rule.Scope != deliveryprofile.ScopeFile {
			continue
		}
		if match := requiredFormatMetric.FindStringSubmatch(rule.Metric); match != nil {
			return match[1]
		}
	}
	return "mp3"
}

// invalidFolderChars mirrors internal/packager's own invalidTitleChars: characters Windows refuses in a path segment
// name. packager.go keeps its own unexported copy rather than exporting one, so this is a light copy of the same
// character set, applied here to a profile's platform name instead of a chapter title.
const invalidFolderChars = `<>:"/\|?*`

// sanitizeFolderName turns a profile's own title into a folder name safe on every platform: the characters Windows
// refuses in a path segment, and control characters, become "_"; an empty result (a title of only such characters)
// falls back to "package" rather than naming a folder after nothing.
//
// A custom profile's own name has no character restriction beyond its length (internal/deliveryprofile/store.go's
// validateProfile), so it is a narrator-controlled string reaching filepath.Join for the first time here (a single
// PackageStart's own OutputDir always comes straight from the folder picker, never a joined-on name). Replacing every
// path separator leaves at most one path segment, but that one segment can still be "." or ".." outright - a name of
// exactly that, with nothing else - which would join to a no-op or to the *parent* of the narrator's chosen root
// instead of a subfolder of it. Both are refused the same way an all-invalid-characters name already is.
func sanitizeFolderName(name string) string {
	name = strings.TrimSpace(name)
	replaced := strings.Map(func(r rune) rune {
		if r < 0x20 || strings.ContainsRune(invalidFolderChars, r) {
			return '_'
		}
		return r
	}, name)
	if strings.Trim(replaced, ".") == "" {
		return "package"
	}
	return replaced
}

// ProfileSelection is one platform the narrator checked to build a package for.
type ProfileSelection struct {
	ProfileID      string `json:"profileId"`
	ProfileVersion string `json:"profileVersion"`
}

// MultiPackageRequest is what PackageStartMulti is asked to build: every selected platform, and the same encoded
// items a single PackageStart would be sent (an export job's own EncodedPaths for its current format).
type MultiPackageRequest struct {
	Selections []ProfileSelection `json:"selections"`
	Items      []PackageItem      `json:"items"`
}

// MultiPackageResult is one selected profile's own place in the run. Phase is "pending" (not reached, or the job was
// cancelled before this profile started), "running", "success" or "error" - there is no per-profile "cancelled": a
// cancel is a whole-job event (MultiPackageJob.Phase reports it), and a profile a cancel never reached is simply
// left "pending" rather than given a phase this type does not otherwise carry.
type MultiPackageResult struct {
	Profile   string                 `json:"profile"`
	Platform  string                 `json:"platform"`
	Phase     string                 `json:"phase"`
	Message   string                 `json:"message"`
	OutputDir string                 `json:"outputDir"`
	Files     []PackageManifestFile  `json:"files"`
	Checklist []PackageChecklistItem `json:"checklist"`
	Error     string                 `json:"error,omitempty"`
}

// MultiPackageJob is the whole run as the UI sees it, in the shape of the other host jobs; Results carries every
// selected profile's own progress, in the order the narrator selected them.
type MultiPackageJob struct {
	ID      *string              `json:"id"`
	Kind    string               `json:"kind"`
	Phase   string               `json:"phase"`
	Message string               `json:"message"`
	Results []MultiPackageResult `json:"results"`
	Elapsed float64              `json:"elapsed"`
	Error   string               `json:"error,omitempty"`
}

type multiPackageJobState struct {
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
	outputDir string
	// +checklocks:mu
	results []MultiPackageResult
	// +checklocks:mu
	started time.Time
	cancel  context.CancelFunc
}

func (j *multiPackageJobState) running() bool {
	j.mu.RLock()
	defer j.mu.RUnlock()
	return j.phase == "running"
}

func (j *multiPackageJobState) snapshot() MultiPackageJob {
	j.mu.RLock()
	defer j.mu.RUnlock()
	id := j.id
	return MultiPackageJob{
		ID: &id, Kind: jobKindRenderPackageMulti, Phase: j.phase, Message: j.message,
		Results: append([]MultiPackageResult{}, j.results...), Elapsed: time.Since(j.started).Seconds(), Error: j.errorText,
	}
}

func (j *multiPackageJobState) beginResult(index, total int, title string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.results[index].Phase = "running"
	j.message = fmt.Sprintf("Building the %s package (%d of %d).", title, index+1, total)
}

func (j *multiPackageJobState) failResult(index int, err error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.results[index].Phase, j.results[index].Error = "error", err.Error()
	j.results[index].Message = "The package could not be built: " + err.Error()
}

func (j *multiPackageJobState) succeedResult(index int, outputDir string, manifest packager.Manifest) {
	j.mu.Lock()
	defer j.mu.Unlock()
	r := &j.results[index]
	r.Phase, r.OutputDir = "success", outputDir
	r.Message = fmt.Sprintf("Built %d files.", len(manifest.Files))
	for _, file := range manifest.Files {
		r.Files = append(r.Files, PackageManifestFile{Kind: string(file.Kind), Name: file.Name, DestPath: file.DestPath, Tagged: file.Tagged})
	}
	for _, item := range manifest.Checklist {
		r.Checklist = append(r.Checklist, PackageChecklistItem{RuleID: item.RuleID, Label: item.Label, Status: string(item.Status), Detail: item.Detail})
	}
}

// multiPackageSelection is one selection, already resolved to its profile and the format it requires.
type multiPackageSelection struct {
	profile deliveryprofile.Profile
	format  string
}

// startMultiPackage validates every selection and the shared items (packageItems, unmodified from the single-profile
// path - it depends only on the export job's own EncodedPaths, not on any one profile), opens the folder picker once,
// then builds each profile's package in the background, in order; only one package job (single or multi-platform)
// or export runs at a time.
func (h *Host) startMultiPackage(req MultiPackageRequest) (MultiPackageJob, error) {
	if len(req.Selections) == 0 {
		return MultiPackageJob{}, errors.New("choose at least one platform to build for")
	}
	resolve := h.resolveProfile
	if resolve == nil {
		resolve = h.profileStore().Resolve
	}
	selections := make([]multiPackageSelection, 0, len(req.Selections))
	for _, sel := range req.Selections {
		profile, found, err := resolve(deliveryprofile.Ref{ID: sel.ProfileID, Version: sel.ProfileVersion})
		if err != nil {
			return MultiPackageJob{}, err
		}
		if !found {
			return MultiPackageJob{}, fmt.Errorf("there is no delivery profile %q", sel.ProfileID)
		}
		selections = append(selections, multiPackageSelection{profile: profile, format: requiredFormat(profile)})
	}

	items, err := h.packageItems(req.Items)
	if err != nil {
		return MultiPackageJob{}, err
	}

	h.mu.RLock()
	exportJob := h.exportJob
	h.mu.RUnlock()
	if exportJob == nil {
		return MultiPackageJob{}, errors.New("export the files to package first")
	}
	exportSnapshot := exportJob.snapshot()
	filesByEncodedPath := map[string]ExportFileResult{}
	for _, file := range exportSnapshot.Files {
		if file.EncodedPath != "" {
			filesByEncodedPath[file.EncodedPath] = file
		}
	}

	projectFolder := h.services().config.projectFolder
	pick := h.pickPackageFolder
	if pick == nil {
		pick = func() (string, error) { return pickFolder("Choose where to save the delivery packages") }
	}
	rootDir, err := pick()
	if err != nil {
		return MultiPackageJob{}, err
	}
	if rootDir == "" {
		return h.multiPackageState(), nil
	}
	if inSidecarTree(projectFolder, rootDir) {
		return MultiPackageJob{}, errors.New("a delivery package cannot be saved inside the project's narration-utils folder; choose a different folder")
	}

	ctx, cancel := context.WithCancel(context.Background())
	id := fmt.Sprintf("package-multi-%d", time.Now().UnixNano())
	ctx = runlog.WithRun(ctx, h.jobRuns.begin(h.runLog, id, jobKindRenderPackageMulti, "selection_count", len(selections)))
	job := &multiPackageJobState{id: id, phase: "running", started: time.Now(), cancel: cancel, outputDir: rootDir}
	job.message = fmt.Sprintf("Preparing %d packages.", len(selections))
	for _, sel := range selections {
		job.results = append(job.results, MultiPackageResult{Profile: sel.profile.Key(), Platform: sel.profile.Platform, Phase: "pending"})
	}

	h.mu.Lock()
	if h.multiPackageJob != nil && h.multiPackageJob.running() {
		h.mu.Unlock()
		cancel()
		return MultiPackageJob{}, errors.New("a multi-platform package is already being built")
	}
	if h.packageJob != nil && h.packageJob.running() {
		h.mu.Unlock()
		cancel()
		return MultiPackageJob{}, errors.New("a package is already being built")
	}
	if exportJob.running() {
		h.mu.Unlock()
		cancel()
		return MultiPackageJob{}, errors.New("an export is already running")
	}
	h.multiPackageJob = job
	h.mu.Unlock()

	assemble := h.assemblePackage
	if assemble == nil {
		assemble = packager.Assemble
	}
	go h.runMultiPackage(ctx, job, selections, exportSnapshot.Format, items, filesByEncodedPath, projectFolder, rootDir, assemble)
	return job.snapshot(), nil
}

// encodeFileFor is encodeFor(format) (export_job.go), unless a test has set h.encodeFile as a seam - the same seam
// export_job.go's own single-format run uses, asked here once per format a re-encode actually needs.
func (h *Host) encodeFileFor(format string) encodeFileFunc {
	if h.encodeFile != nil {
		return h.encodeFile
	}
	return encodeFor(format)
}

// reencodeItems freshly encodes every item to format, from its export job's own mastered file (if the export
// mastered) or its original source file - never from its currently-encoded file, which is in a different format -
// into encodedDir, mirroring exportScratchDir's own per-file naming. It is called once per format a run actually
// needs (startMultiPackage's caller memoizes by format), never once per selected profile.
func reencodeItems(
	ctx context.Context, format, encodedDir string, items []PackageItem, filesByEncodedPath map[string]ExportFileResult, encode encodeFileFunc,
) ([]PackageItem, error) {
	if err := os.MkdirAll(encodedDir, 0o755); err != nil {
		return nil, err
	}
	out := make([]PackageItem, 0, len(items))
	for i, item := range items {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		file, ok := filesByEncodedPath[item.Path]
		if !ok {
			return nil, fmt.Errorf("%q was not encoded in this session; export it again", item.Path)
		}
		source := file.Path
		if file.MasteredPath != "" {
			source = file.MasteredPath
		}
		dest := filepath.Join(encodedDir, fmt.Sprintf("%02d-%s.%s", i+1, item.Kind, format))
		_ = os.Remove(dest)
		if err := encode(ctx, source, dest, encodeport.Spec{Format: format}); err != nil {
			return nil, err
		}
		out = append(out, PackageItem{Kind: item.Kind, Title: item.Title, Path: dest})
	}
	return out, nil
}

// runMultiPackage builds each selection's package in turn: the format matching the export job's own current format
// reuses items as given; any other format is re-encoded once per format (memoized in itemsByFormat, shared by every
// selection that needs it, since every selection is built from the same shared items) before its first package. A
// panic ends the job as an error rather than taking the app down, matching runExport and runPackage.
func (h *Host) runMultiPackage(
	ctx context.Context, job *multiPackageJobState, selections []multiPackageSelection, currentFormat string,
	items []PackageItem, filesByEncodedPath map[string]ExportFileResult, projectFolder, rootDir string, assemble assembleFunc,
) {
	defer job.cancel()
	defer func() {
		var broken error
		if recovered := recover(); recovered != nil {
			broken = fmt.Errorf("%v", recovered)
		}
		h.finishMultiPackage(job, broken, ctx.Err() != nil)
	}()
	itemsByFormat := map[string][]PackageItem{currentFormat: items}
	for index, sel := range selections {
		if ctx.Err() != nil {
			return
		}
		job.beginResult(index, len(selections), sel.profile.Title())
		packItems, ok := itemsByFormat[sel.format]
		if !ok {
			encodedDir := exportScratchDir(projectFolder, "encoded-"+sel.format)
			encoded, err := reencodeItems(ctx, sel.format, encodedDir, items, filesByEncodedPath, h.encodeFileFor(sel.format))
			if err != nil {
				if ctx.Err() != nil {
					return
				}
				job.failResult(index, err)
				continue
			}
			itemsByFormat[sel.format] = encoded
			packItems = encoded
		}
		if ctx.Err() != nil {
			return
		}
		outputDir := filepath.Join(rootDir, sanitizeFolderName(sel.profile.Title()))
		manifest, err := assemble(ctx, packageRequest(sel.profile, packItems, outputDir))
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			job.failResult(index, err)
			continue
		}
		job.succeedResult(index, outputDir, manifest)
	}
}

func (h *Host) finishMultiPackage(job *multiPackageJobState, broken error, cancelled bool) {
	job.mu.Lock()
	success, failed := 0, 0
	for _, result := range job.results {
		switch result.Phase {
		case "success":
			success++
		case "error":
			failed++
		}
	}
	switch {
	case broken != nil:
		job.phase, job.errorText = "error", broken.Error()
		job.message = "The packages could not be built."
	case cancelled:
		job.phase = "cancelled"
		job.message = fmt.Sprintf("Cancelled. %d of %d packages were built.", success, len(job.results))
	case failed > 0:
		job.phase = "error"
		job.message = fmt.Sprintf("%d of %d packages could not be built; the rest are ready.", failed, len(job.results))
	default:
		job.phase = "success"
		job.message = fmt.Sprintf("Built %d packages.", success)
	}
	id, phase, message, started := job.id, job.phase, job.message, job.started
	job.mu.Unlock()
	if event, ok := endedJob(id, jobKindRenderPackageMulti, phase, message, started); ok {
		h.publishJobEnded(event)
	}
}

// multiPackageState answers the current or last multi-platform package job, or an idle job.
func (h *Host) multiPackageState() MultiPackageJob {
	h.mu.RLock()
	job := h.multiPackageJob
	h.mu.RUnlock()
	if job != nil {
		return job.snapshot()
	}
	return MultiPackageJob{Kind: jobKindRenderPackageMulti, Phase: "idle", Message: "Export files, then choose the platforms to build for.", Results: []MultiPackageResult{}}
}

// cancelMultiPackage stops a running multi-platform build before its next profile starts; profiles already built
// keep their results, and one not yet reached stays "pending" (MultiPackageResult's own doc comment).
func (h *Host) cancelMultiPackage() MultiPackageJob {
	h.mu.RLock()
	job := h.multiPackageJob
	h.mu.RUnlock()
	if job == nil || !job.running() {
		return h.multiPackageState()
	}
	job.mu.Lock()
	job.message = "Cancelling the package build."
	job.mu.Unlock()
	job.cancel()
	return job.snapshot()
}
