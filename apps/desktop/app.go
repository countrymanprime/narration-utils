package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/guide"
	"github.com/countrymanprime/narration-utils/shell/internal/hostlog"
	"github.com/countrymanprime/narration-utils/shell/internal/layout"
	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
	"github.com/countrymanprime/narration-utils/shell/internal/process"
	"github.com/countrymanprime/narration-utils/shell/internal/recents"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
	"github.com/countrymanprime/narration-utils/shell/internal/teleprompter"
	"github.com/countrymanprime/narration-utils/shell/internal/transcript"
	"github.com/countrymanprime/narration-utils/shell/internal/tts"
	"github.com/countrymanprime/narration-utils/shell/internal/whisper"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Keep this in lockstep with apps/ui/src/hostApi.ts.  The frontend rejects
// an older host before bootstrapping so a partial update cannot run against a
// binding contract it does not understand.
const hostAPIVersion = 5

// Host is the Wails binding boundary. The frontend invokes only this bound
// object; it never receives a loopback port or an HTTP capability.
type Host struct {
	mu           sync.RWMutex
	ctx          context.Context
	cancel       context.CancelFunc
	diagnostic   string
	config       config
	manuscript   *manuscript.Service
	sidecars     *process.Supervisor
	settings     *settings.Store
	tts          *tts.Manager
	ttsJobs      map[string]*ttsJob
	whisper      *whisper.Manager
	whisperJobs  map[string]*whisperJob
	guide        *guide.Service
	guideJob     *workJob
	transcript   *transcript.Service
	teleprompter *teleprompter.Service
	recents      *recents.Store
	log          *hostlog.Log
}

// ttsPhaseDownloading is the phase of a voice install that is running. It is the word the UI polls for (contracts/tts.ts), and the
// project-attach guard (canAttachLocked) waits on it too, so both use this name.
const ttsPhaseDownloading = "downloading"

type ttsJob struct {
	mu                          sync.RWMutex
	id, voiceID, phase, message string
	cancel                      context.CancelFunc
}
type whisperJob struct {
	mu                          sync.RWMutex
	id, modelID, phase, message string
	cancel                      context.CancelFunc
}
type workJob struct {
	mu                                  sync.RWMutex
	id, kind, phase, message, errorText string
	percent                             int
	logs                                []string
	started                             time.Time
}

type config struct {
	repoRoot                                string
	sessionDir                              string
	projectFolder                           string
	projectName                             string
	daw                                     string
	manuscriptPython                        string
	manuscriptBackend                       string
	comparePython                           string
	compareBackend                          string
	teleprompterPython, teleprompterBackend string
	reaperLauncher                          string
}

func NewHost() *Host {
	workingDirectory, _ := os.Getwd()
	repoRoot := layout.FindRoot(workingDirectory)
	return &Host{diagnostic: fmt.Sprintf("go-%d", time.Now().UnixNano()), config: config{repoRoot: repoRoot}, manuscript: manuscript.New(""), sidecars: process.NewSupervisor(), settings: settings.New(repoRoot, ""), ttsJobs: map[string]*ttsJob{}, whisperJobs: map[string]*whisperJob{}, recents: recents.New(recentProjectsPath()), log: hostlog.New(hostlog.DefaultPath(), 0)}
}

// recentProjectsPath resolves the per-user recent-projects file. Recent
// projects are not project-scoped, so this is constructed exactly once in
// NewHost and never rebuilt by configureLocked. Mirrors the %APPDATA%-with-
// %USERPROFILE%-fallback chain in apps/desktop/internal/settings/store.go's
// globalPath(), duplicated inline rather than shared since it is only a few
// lines.
func recentProjectsPath() string {
	if value := os.Getenv("APPDATA"); value != "" {
		return filepath.Join(value, "narration-utils", "recent-projects.json")
	}
	if value := os.Getenv("USERPROFILE"); value != "" {
		return filepath.Join(value, "AppData", "Roaming", "narration-utils", "recent-projects.json")
	}
	return filepath.Join("AppData", "Roaming", "narration-utils", "recent-projects.json")
}

func (h *Host) Startup(ctx context.Context) {
	h.mu.Lock()
	h.ctx, h.cancel = context.WithCancel(ctx)
	h.configureLocked(parseConfig(h.config.repoRoot))
	runtimeContext := h.ctx
	h.mu.Unlock()
	go h.transcriptLoop(runtimeContext)
}

// configureLocked rebuilds project-scoped services from launcher arguments.
// Its caller holds h.mu and has already established that no active work can
// be displaced. Release resources are materialized only when the launcher did
// not explicitly name development sidecars.
func (h *Host) configureLocked(next config) {
	next.repoRoot = layout.FindRoot(next.repoRoot)
	h.config = next
	h.settings = settings.New(h.config.repoRoot, h.config.projectFolder)
	h.resolveDeveloperSidecars()
	packagedRoot := ""
	if h.config.manuscriptPython == "" || h.config.comparePython == "" || h.config.teleprompterPython == "" {
		packagedRoot = h.packagedResources()
	}
	if h.config.manuscriptPython == "" {
		h.config.manuscriptPython = sidecarPath(packagedRoot, "manuscript-guide")
	}
	if h.config.comparePython == "" {
		h.config.comparePython = sidecarPath(packagedRoot, "transcript-compare")
	}
	if h.config.teleprompterPython == "" {
		h.config.teleprompterPython = sidecarPath(packagedRoot, "manuscript-teleprompter")
	}
	if packagedRoot != "" {
		h.config.reaperLauncher = filepath.Join(packagedRoot, "reaper", "NarrationUtils_Launcher.lua")
	} else {
		h.config.reaperLauncher = layout.Path(h.config.repoRoot, layout.LauncherFile)
	}
	h.manuscript = manuscript.New(h.config.projectFolder)
	h.settings.SetProject(h.config.projectFolder)
	h.guide = guide.New(h.config.projectFolder, h.config.manuscriptPython, h.config.manuscriptBackend, h.settings, h.sidecars)
	cacheBase, cacheErr := os.UserCacheDir()
	if cacheErr != nil {
		cacheBase = os.TempDir()
	}
	cacheRoot := filepath.Join(cacheBase, "narration-utils", "assets", "tts")
	catalog := layout.Path(h.config.repoRoot, layout.TTSCatalogFile)
	if _, err := os.Stat(catalog); err != nil && packagedRoot != "" {
		catalog = filepath.Join(packagedRoot, "config", "tts-assets.json")
	}
	if manager, err := tts.New(catalog, cacheRoot); err == nil {
		h.tts = manager
	}
	whisperCacheRoot := filepath.Join(cacheBase, "narration-utils", "assets", "whisper")
	whisperCatalog := layout.Path(h.config.repoRoot, layout.WhisperCatalogFile)
	if _, err := os.Stat(whisperCatalog); err != nil && packagedRoot != "" {
		whisperCatalog = filepath.Join(packagedRoot, "config", "whisper-assets.json")
	}
	if manager, err := whisper.New(whisperCatalog, whisperCacheRoot); err == nil {
		h.whisper = manager
	}
	var client *bridge.Client
	if h.config.sessionDir != "" {
		client, _ = bridge.New(h.config.sessionDir)
	}
	h.transcript = transcript.New(transcript.Config{Project: h.config.projectFolder, SessionDir: h.config.sessionDir, Python: h.config.comparePython, Backend: h.config.compareBackend}, client, h.settings, h.sidecars, h.emitTranscript)
	teleprompterDir := h.config.sessionDir
	if teleprompterDir == "" {
		teleprompterDir = filepath.Join(os.TempDir(), "narration-utils")
	}
	h.teleprompter = teleprompter.New(teleprompter.Config{Project: h.config.projectFolder, SessionDir: teleprompterDir, Python: h.config.teleprompterPython, Backend: h.config.teleprompterBackend}, h.sidecars, h.emitTeleprompterEvent, h.emitTeleprompterState)
	h.teleprompter.SetLog(func(kind, message string) { _ = h.log.Report(kind, message) })
}

// packagedSidecar materializes an embedded release resource under the
// per-user cache so Python/ONNX dynamic libraries can use ordinary filesystem
// paths. Developer launches pass explicit paths and never use this route.
func (h *Host) packagedResources() string {
	cache, err := os.UserCacheDir()
	if err != nil {
		return ""
	}
	key, err := resourceKey()
	if err != nil {
		return ""
	}
	target := filepath.Join(cache, "narration-utils", "runtime", key)
	if _, err := os.Stat(filepath.Join(target, ".complete")); err == nil {
		// The payload may be unchanged while the app executable moves (for
		// example after a user relocates a portable install). Refresh this
		// tiny launcher pointer on every startup; REAPER import itself remains
		// an explicit, user-controlled action.
		_ = writeReaperLauncherPath(target, executablePath())
		return target
	}
	staging := target + ".staging"
	if err := os.RemoveAll(staging); err != nil {
		return ""
	}
	if err := fs.WalkDir(resources, "cmd/narration-utils/resources", func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel("cmd/narration-utils/resources", path)
		if err != nil || relative == "." {
			return nil
		}
		destination := filepath.Join(staging, relative)
		if entry.IsDir() {
			return os.MkdirAll(destination, 0o755)
		}
		bytes, err := resources.ReadFile(path)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
			return err
		}
		// 0o700: the extracted sidecar executables need their owner execute bit outside Windows.
		return os.WriteFile(destination, bytes, 0o700) //nolint:gosec // G306: executable resources
	}); err != nil {
		_ = os.RemoveAll(staging)
		return ""
	}
	if err := os.WriteFile(filepath.Join(staging, ".complete"), []byte(key+"\n"), 0o600); err != nil {
		_ = os.RemoveAll(staging)
		return ""
	}
	if err := os.RemoveAll(target); err != nil {
		_ = os.RemoveAll(staging)
		return ""
	}
	if err := os.Rename(staging, target); err != nil {
		return ""
	}
	// The REAPER action is intentionally materialized beside the immutable
	// sidecars.  It needs the installed Wails executable rather than a
	// checkout-relative path; the Lua launcher reads this one-line file.
	// REAPER is never modified automatically: Settings shows this path for a
	// user-controlled import or re-import.
	_ = writeReaperLauncherPath(target, executablePath())
	return target
}

func executablePath() string {
	executable, err := os.Executable()
	if err != nil {
		return ""
	}
	return executable
}

func writeReaperLauncherPath(root, executable string) error {
	if executable == "" {
		return nil
	}
	directory := filepath.Join(root, "reaper")
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return err
	}
	target := filepath.Join(directory, "narration-utils-app-path.txt")
	temporary := target + ".tmp"
	if err := os.WriteFile(temporary, []byte(executable+"\n"), 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, target)
}

// resourceKey changes whenever any embedded release resource changes. Keeping
// the cache content-addressed means an installed app update never starts an
// obsolete Python sidecar or REAPER action from a previous build.
func resourceKey() (string, error) {
	return resourceKeyFor(resources)
}

func resourceKeyFor(source fs.FS) (string, error) {
	hash := sha256.New()
	err := fs.WalkDir(source, "cmd/narration-utils/resources", func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		bytes, err := fs.ReadFile(source, path)
		if err != nil {
			return err
		}
		_, _ = hash.Write([]byte(path))
		_, _ = hash.Write([]byte{0})
		_, _ = hash.Write(bytes)
		return nil
	})
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("v1-%x", hash.Sum(nil)[:12]), nil
}

func sidecarPath(root, name string) string {
	if root == "" {
		return ""
	}
	executable := name
	if os.PathSeparator == '\\' {
		executable += ".exe"
	}
	candidate := filepath.Join(root, "runtime", name, executable)
	if _, err := os.Stat(candidate); err != nil {
		return ""
	}
	return candidate
}

func (h *Host) emitTranscript(state map[string]any) {
	h.mu.RLock()
	ctx := h.ctx
	h.mu.RUnlock()
	if ctx != nil {
		runtime.EventsEmit(ctx, "transcript:state", state)
	}
}

// emitTeleprompterEvent relays one sidecar event (script, partial, word,
// position, segment_end) to the frontend exactly as the sidecar printed it.
func (h *Host) emitTeleprompterEvent(event json.RawMessage) {
	h.mu.RLock()
	ctx := h.ctx
	h.mu.RUnlock()
	if ctx != nil {
		runtime.EventsEmit(ctx, "teleprompter:event", event)
	}
}

func (h *Host) emitTeleprompterState(state map[string]any) {
	h.mu.RLock()
	ctx := h.ctx
	h.mu.RUnlock()
	if ctx != nil {
		runtime.EventsEmit(ctx, "teleprompter:state", state)
	}
}

func (h *Host) transcriptLoop(ctx context.Context) {
	ticker := time.NewTicker(150 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.pollTranscript()
		}
	}
}

// pollTranscript is one tick of transcriptLoop: drain and poll the current
// project's transcript service, if it has one.
func (h *Host) pollTranscript() {
	if service := h.services().transcript; service != nil {
		_ = service.Drain()
		service.Poll()
	}
}

func (h *Host) Shutdown(context.Context) {
	// Stop a live session first, without holding h.mu: the service reports its
	// phase changes through emitTeleprompterState, which takes h.mu.RLock.
	if live := h.services().teleprompter; live != nil {
		stopContext, cancelStop := context.WithTimeout(context.Background(), 12*time.Second)
		_ = live.Close(stopContext)
		cancelStop()
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.cancel != nil {
		h.cancel()
	}
	if h.sidecars != nil {
		_ = h.sidecars.Close()
	}
}

// attachBusyReason is what the UI is told when an attach is refused because
// in-flight work would be displaced.
const attachBusyReason = "Narration Utils is busy, so the current project was left unchanged."

// canAttach reports, under a read lock, whether a project switch would be
// accepted right now. It is only a pre-check: attachProjectLocked asks again
// under the write lock.
func (h *Host) canAttach() bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.canAttachLocked()
}

// attachProjectLocked applies next onto the running host, subject to the same
// in-flight-work guard shared by the REAPER second-instance attach path and
// the picker-driven UI bindings. The caller holds h.mu and builds next itself
// (e.g. from a fresh argv parse, or from h.config with only folder/name/daw
// overridden) so each caller controls exactly which fields carry over.
func (h *Host) attachProjectLocked(next config) (bool, string) {
	if next.projectFolder == "" {
		return false, "No project folder was provided."
	}
	if !h.canAttachLocked() {
		return false, attachBusyReason
	}
	h.configureLocked(next)
	return true, ""
}

func (h *Host) onSecondInstance(instance options.SecondInstanceData) {
	h.mu.Lock()
	ctx := h.ctx
	attached, reason := false, ""
	if hasArgument(instance.Args, "--project-folder") {
		next := parseConfigArgs(h.config.repoRoot, instance.Args)
		if next.projectFolder == "" {
			reason = "The second launch did not include a project folder."
		} else {
			attached, reason = h.attachProjectLocked(next)
		}
	}
	h.mu.Unlock()
	if ctx != nil {
		runtime.WindowShow(ctx)
		runtime.WindowUnminimise(ctx)
		runtime.WindowSetAlwaysOnTop(ctx, true)
		runtime.WindowSetAlwaysOnTop(ctx, false)
		if attached {
			runtime.EventsEmit(ctx, "system:attached", map[string]any{"attached": true})
		} else if reason != "" {
			runtime.EventsEmit(ctx, "system:attached", map[string]any{"attached": false, "reason": reason})
		}
	}
}

func parseConfig(defaultRoot string) config {
	return parseConfigArgs(defaultRoot, os.Args[1:])
}

func parseConfigArgs(defaultRoot string, arguments []string) config {
	result := config{repoRoot: defaultRoot}
	values := map[string]*string{
		"--repo-root": &result.repoRoot, "--session-dir": &result.sessionDir, "--project-folder": &result.projectFolder,
		"--project-name": &result.projectName, "--daw": &result.daw, "--manuscript-python": &result.manuscriptPython,
		"--manuscript-backend": &result.manuscriptBackend, "--compare-python": &result.comparePython, "--compare-backend": &result.compareBackend,
		"--teleprompter-python": &result.teleprompterPython, "--teleprompter-backend": &result.teleprompterBackend,
	}
	for index := 0; index+1 < len(arguments); index++ {
		if target, ok := values[arguments[index]]; ok {
			*target = arguments[index+1]
			index++
		}
	}
	if absolute, err := filepath.Abs(result.repoRoot); err == nil {
		result.repoRoot = absolute
	}
	return result
}

func hasArgument(arguments []string, wanted string) bool {
	for _, argument := range arguments {
		if argument == wanted {
			return true
		}
	}
	return false
}

// canAttachLocked implements the REAPER single-instance rule: attach a new
// saved project only when that cannot discard an import draft, sidecar run,
// Story Bible build, or voice download in the visible window.
func (h *Host) canAttachLocked() bool {
	if h.manuscript != nil && !h.manuscript.CanSwitchProject() {
		return false
	}
	if h.guideJob != nil {
		h.guideJob.mu.RLock()
		running := h.guideJob.phase == "running"
		h.guideJob.mu.RUnlock()
		if running {
			return false
		}
	}
	for _, job := range h.ttsJobs {
		job.mu.RLock()
		running := job.phase == ttsPhaseDownloading
		job.mu.RUnlock()
		if running {
			return false
		}
	}
	for _, job := range h.whisperJobs {
		job.mu.RLock()
		running := job.phase == "running"
		job.mu.RUnlock()
		if running {
			return false
		}
	}
	if h.transcript != nil {
		phase, _ := h.transcript.Snapshot()["phase"].(string)
		switch phase {
		case "preparing", "running", "inspecting", "need_chapter":
			return false
		}
	}
	if h.teleprompter != nil && h.teleprompter.Busy() {
		return false
	}
	return true
}

func (h *Host) resolveDeveloperSidecars() {
	python := filepath.Join(h.config.repoRoot, ".venv", "Scripts", "python.exe")
	if os.PathSeparator != '\\' {
		python = filepath.Join(h.config.repoRoot, ".venv", "bin", "python")
	}
	if _, err := os.Stat(python); err != nil {
		return
	}
	if h.config.manuscriptPython == "" {
		h.config.manuscriptPython = python
	}
	if h.config.manuscriptBackend == "" {
		h.config.manuscriptBackend = layout.Path(h.config.repoRoot, layout.ManuscriptGuideBackend)
	}
	if h.config.comparePython == "" {
		h.config.comparePython = python
	}
	if h.config.compareBackend == "" {
		h.config.compareBackend = layout.Path(h.config.repoRoot, layout.TranscriptCompareBackend)
	}
	if h.config.teleprompterPython == "" {
		h.config.teleprompterPython = python
	}
	if h.config.teleprompterBackend == "" {
		h.config.teleprompterBackend = layout.Path(h.config.repoRoot, layout.TeleprompterBackend)
	}
}

func (h *Host) Ready() map[string]any {
	return map[string]any{"apiVersion": hostAPIVersion, "diagnosticId": h.diagnostic}
}

func (h *Host) Bootstrap() map[string]any {
	svc := h.services()
	config := svc.config
	var imported any
	if config.projectFolder != "" {
		if bytes, err := os.ReadFile(filepath.Join(config.projectFolder, "narration-utils", "manuscript", "manuscript.json")); err == nil {
			var data map[string]any
			if json.Unmarshal(bytes, &data) == nil {
				importer, _ := data["importer"].(map[string]any)
				source, _ := data["source"].(map[string]any)
				words, chapters := narratableManuscriptStats(data)
				imported = map[string]any{"id": data["documentId"], "format": importer["format"], "sourceName": source["fileName"], "importedAt": data["importedAt"], "narratableWordCount": words, "narratableChapterCount": chapters}
			}
		}
	}
	// A manuscript file sitting in the project folder is offered, never
	// imported on its own (ADR-0019).
	var manuscriptCandidate any
	if imported == nil {
		if path := manuscript.DetectSource(config.projectFolder); path != "" {
			manuscriptCandidate = map[string]any{"path": path, "name": filepath.Base(path)}
		}
	}
	transcriptState := emptyTranscript()
	if svc.transcript != nil {
		transcriptState = svc.transcript.Snapshot()
	}
	return map[string]any{"apiVersion": hostAPIVersion, "diagnosticId": h.diagnostic, "projectFolder": config.projectFolder, "projectName": config.projectName, "daw": config.daw, "manuscript": imported, "manuscriptCandidate": manuscriptCandidate, "runtime": map[string]any{"ManuscriptGuide": map[string]string{"python_exe": config.manuscriptPython, "backend": config.manuscriptBackend}, "TranscriptCompare": map[string]string{"python_exe": config.comparePython, "compare_script": config.compareBackend}, "Reaper": map[string]string{"launcherPath": config.reaperLauncher}}, "transcript": transcriptState}
}

func narratableManuscriptStats(data map[string]any) (int, int) {
	chapters, _ := data["chapters"].([]any)
	words, count := 0, 0
	for _, raw := range chapters {
		chapter, ok := raw.(map[string]any)
		if !ok || chapter["contentKind"] == "opening" || chapter["contentKind"] == "reference" {
			continue
		}
		count++
		switch value := chapter["wordCount"].(type) {
		case float64:
			words += int(value)
		case int:
			words += value
		}
	}
	return words, count
}

func emptyTranscript() map[string]any {
	return map[string]any{"phase": "idle", "percent": 0, "message": "", "logs": []string{}, "chapters": []string{}, "rows": []any{}, "diff": "", "summary": "", "elapsed": 0, "markerExport": map[string]any{"phase": "idle", "message": "", "added": 0, "skipped": 0}}
}

func previewVoice(voice tts.Voice) map[string]any {
	return map[string]any{"id": voice.ID, "provider": voice.Provider, "displayName": voice.DisplayName, "locale": voice.Locale, "version": voice.Version, "publisher": voice.Publisher, "license": voice.License, "licenseUrl": voice.LicenseURL, "modelCardUrl": voice.ModelCardURL, "provenanceUrl": voice.ProvenanceURL, "attribution": voice.Attribution}
}

func voiceDownloadSize(voice tts.Voice) int64 {
	var total int64
	for _, file := range voice.Files {
		total += file.Size
	}
	return total
}

func previewModel(model whisper.Model) map[string]any {
	return map[string]any{"id": model.ID, "provider": model.Provider, "displayName": model.DisplayName, "version": model.Version, "publisher": model.Publisher, "license": model.License, "licenseUrl": model.LicenseURL, "modelCardUrl": model.ModelCardURL, "provenanceUrl": model.ProvenanceURL, "attribution": model.Attribution}
}

func modelDownloadSize(model whisper.Model) int64 {
	var total int64
	for _, file := range model.Files {
		total += file.Size
	}
	return total
}

// resolveWhisperModelID mirrors the "model" option fallback already used to
// build the compare.py --model argument in transcript.Service, so the
// first-use gate checks the exact model that would otherwise be requested.
func resolveWhisperModelID(store *settings.Store, options map[string]string) string {
	if value := options["model"]; value != "" {
		return value
	}
	value, _ := store.Effective("TranscriptCompare", "model_size", "small")
	return value
}

// resolveTeleprompterModelID picks the Whisper model for live transcription.
// It defaults to tiny, not the offline Transcript Compare default: live
// transcription must keep up with speech (tiny decodes at about 0.03x real
// time on CPU, larger models are unmeasured).
func resolveTeleprompterModelID(options map[string]string) string {
	if value := options["model"]; value != "" {
		return value
	}
	return "tiny"
}

type fieldSchema struct {
	key, label, kind string
	choices          []string
}

var fieldSchemas = map[string][]fieldSchema{
	"General":           {{"log_verbosity", "Log verbosity", "choice", []string{"quiet", "normal", "verbose"}}},
	"Manuscript":        {{"color_note", "Note color", "color", nil}},
	"ManuscriptGuide":   {{"spacy_model", "spaCy model", "choice", []string{"en_core_web_sm", "en_core_web_lg"}}},
	"Piper":             {{"tts_provider", "TTS provider", "choice", []string{"piper"}}, {"tts_voice_id", "Preview voice", "choice", []string{"en_US-ljspeech-high"}}},
	"TranscriptCompare": {{"model_size", "Default Whisper model", "choice", []string{"tiny", "small", "medium", "large-v3-turbo", "large-v3"}}, {"chunk_seconds", "Default chunk length", "choice", []string{"30", "60", "300", "600"}}, {"color_misread", "Misread marker color", "color", nil}, {"color_skipped", "Skipped marker color", "color", nil}, {"color_extra", "Extra marker color", "color", nil}},
}

func (h *Host) settingsForScope(scope string) (map[string]any, error) {
	if scope != "global" && scope != "project" {
		return nil, fmt.Errorf("unsupported settings scope")
	}
	store := h.services().settings
	result := map[string]any{}
	for tool, schemas := range fieldSchemas {
		values := []map[string]any{}
		scoped := store.Global(tool)
		if scope == "project" {
			scoped = store.Project(tool)
		}
		for _, schema := range schemas {
			effective, source := store.Effective(tool, schema.key, "")
			current, set := scoped[schema.key]
			values = append(values, map[string]any{"key": schema.key, "label": schema.label, "kind": schema.kind, "choices": schema.choices, "value": current, "isSet": set, "effectiveValue": effective, "effectiveSource": source})
		}
		result[tool] = values
	}
	return result, nil
}
func (h *Host) saveSettings(tool, scope string, values map[string]*string) error {
	schemas, ok := fieldSchemas[tool]
	if !ok {
		return fmt.Errorf("unsupported settings tool")
	}
	valid := map[string]fieldSchema{}
	for _, schema := range schemas {
		valid[schema.key] = schema
	}
	for key, value := range values {
		schema, ok := valid[key]
		if !ok {
			return fmt.Errorf("unsupported setting %s", key)
		}
		if value == nil {
			continue
		}
		if err := validateSettingValue(schema, *value); err != nil {
			return err
		}
	}
	return h.services().settings.Save(tool, scope, values)
}

// validateSettingValue checks one value against its field's kind. Every value is a string in the settings files, so a
// bool is stored as "true" or "false". An unknown kind fails closed: it would otherwise be written as it came.
func validateSettingValue(schema fieldSchema, value string) error {
	switch schema.kind {
	case "text":
		return nil
	case "color":
		if len(value) != 6 || !isHex(value) {
			return fmt.Errorf("setting %s must be a six-digit color", schema.key)
		}
	case "choice":
		if !contains(schema.choices, value) {
			return fmt.Errorf("unsupported value for %s", schema.key)
		}
	case "bool":
		if value != "true" && value != "false" {
			return fmt.Errorf("setting %s must be true or false", schema.key)
		}
	default:
		return fmt.Errorf("unsupported setting kind %q for %s", schema.kind, schema.key)
	}
	return nil
}
func (h *Host) startTtsInstall(voiceID string) (map[string]any, error) {
	manager := h.services().tts
	if manager == nil {
		return nil, fmt.Errorf("the approved TTS catalog is unavailable")
	}
	if _, ok := manager.Voice(voiceID); !ok {
		return nil, fmt.Errorf("the selected voice is not in the approved catalog")
	}
	ctx, cancel := context.WithCancel(context.Background())
	job := &ttsJob{id: fmt.Sprintf("tts-%d", time.Now().UnixNano()), voiceID: voiceID, phase: ttsPhaseDownloading, message: "Downloading and verifying the approved voice…", cancel: cancel}
	h.mu.Lock()
	h.ttsJobs[job.id] = job
	h.mu.Unlock()
	go func() {
		err := manager.Install(ctx, voiceID)
		job.mu.Lock()
		defer job.mu.Unlock()
		if err != nil {
			if ctx.Err() != nil {
				job.phase = "cancelled"
				job.message = "Voice download cancelled."
			} else {
				job.phase = "error"
				job.message = err.Error()
			}
		} else {
			job.phase = "success"
			job.message = "Voice installed and verified."
		}
	}()
	return snapshotTts(job), nil
}
func (h *Host) ttsInstallState(id string) (map[string]any, error) {
	h.mu.RLock()
	job := h.ttsJobs[id]
	h.mu.RUnlock()
	if job == nil {
		return nil, fmt.Errorf("unknown TTS install job")
	}
	return snapshotTts(job), nil
}
func (h *Host) cancelTtsInstall(id string) (map[string]any, error) {
	h.mu.RLock()
	job := h.ttsJobs[id]
	h.mu.RUnlock()
	if job == nil {
		return nil, fmt.Errorf("unknown TTS install job")
	}
	job.cancel()
	return snapshotTts(job), nil
}
func snapshotTts(job *ttsJob) map[string]any {
	job.mu.RLock()
	defer job.mu.RUnlock()
	// The contract (contracts/tts.ts) has a phase of "downloading", a percent and an error; the install reports no byte progress yet, so
	// percent is 0 until it ends and 100 once it succeeded, and error carries the failure text.
	percent, failure := 0, ""
	switch job.phase {
	case "success":
		percent = 100
	case "error":
		failure = job.message
	}
	return map[string]any{"id": job.id, "voiceId": job.voiceID, "phase": job.phase, "message": job.message, "percent": percent, "error": failure}
}
func (h *Host) startWhisperInstall(modelID string) (map[string]any, error) {
	manager := h.services().whisper
	if manager == nil {
		return nil, fmt.Errorf("the approved Whisper catalog is unavailable")
	}
	if _, ok := manager.Model(modelID); !ok {
		return nil, fmt.Errorf("the selected Whisper model is not in the approved catalog")
	}
	ctx, cancel := context.WithCancel(context.Background())
	job := &whisperJob{id: fmt.Sprintf("whisper-%d", time.Now().UnixNano()), modelID: modelID, phase: "running", message: "Downloading and verifying the approved Whisper model…", cancel: cancel}
	h.mu.Lock()
	h.whisperJobs[job.id] = job
	h.mu.Unlock()
	go func() {
		err := manager.Install(ctx, modelID)
		job.mu.Lock()
		defer job.mu.Unlock()
		if err != nil {
			if ctx.Err() != nil {
				job.phase = "cancelled"
				job.message = "Whisper model download cancelled."
			} else {
				job.phase = "error"
				job.message = err.Error()
			}
		} else {
			job.phase = "success"
			job.message = "Whisper model installed and verified."
		}
	}()
	return snapshotWhisper(job), nil
}
func (h *Host) whisperInstallState(id string) (map[string]any, error) {
	h.mu.RLock()
	job := h.whisperJobs[id]
	h.mu.RUnlock()
	if job == nil {
		return nil, fmt.Errorf("unknown Whisper install job")
	}
	return snapshotWhisper(job), nil
}
func (h *Host) cancelWhisperInstall(id string) (map[string]any, error) {
	h.mu.RLock()
	job := h.whisperJobs[id]
	h.mu.RUnlock()
	if job == nil {
		return nil, fmt.Errorf("unknown Whisper install job")
	}
	job.cancel()
	return snapshotWhisper(job), nil
}
func snapshotWhisper(job *whisperJob) map[string]any {
	job.mu.RLock()
	defer job.mu.RUnlock()
	return map[string]any{"id": job.id, "modelId": job.modelID, "phase": job.phase, "message": job.message}
}
func (h *Host) startGuideBuild() (map[string]any, error) {
	svc := h.services()
	if svc.guide == nil {
		return nil, fmt.Errorf("the Story Bible is unavailable")
	}
	h.mu.Lock()
	if h.guideJob != nil {
		h.guideJob.mu.RLock()
		running := h.guideJob.phase == "running"
		h.guideJob.mu.RUnlock()
		if running {
			h.mu.Unlock()
			return nil, fmt.Errorf("a Story Bible rebuild is already running")
		}
	}
	job := &workJob{id: fmt.Sprintf("guide-%d", time.Now().UnixNano()), kind: "story_bible", phase: "running", message: "Story Bible rebuild started.", percent: 1, started: time.Now()}
	h.guideJob = job
	h.mu.Unlock()
	// The build runs on the snapshot's Story Bible and session directory, which
	// belong to one project; the goroutine never re-reads h.guide.
	progress := filepath.Join(svc.config.sessionDir, "guide_progress_"+job.id+".txt")
	log := filepath.Join(svc.config.sessionDir, "guide_log_"+job.id+".txt")
	go func() {
		// The sidecar writes a stage|pct|message progress file and an
		// append-only log while it works; tail both so the dialog shows real
		// activity instead of sitting at 1% until the build finishes (ADR-0015).
		var logAt int64
		stop, stopped := make(chan struct{}), make(chan struct{})
		go func() {
			defer close(stopped)
			ticker := time.NewTicker(250 * time.Millisecond)
			defer ticker.Stop()
			for {
				select {
				case <-stop:
					return
				case <-ticker.C:
					pollWorkJob(job, progress, log, &logAt)
				}
			}
		}()
		_, err := svc.guide.Build(progress, log)
		close(stop)
		<-stopped
		pollWorkJob(job, progress, log, &logAt)
		job.mu.Lock()
		defer job.mu.Unlock()
		if err != nil {
			job.phase = "error"
			job.errorText = err.Error()
			job.message = err.Error()
		} else {
			job.phase = "success"
			job.percent = 100
			job.message = "Story Bible rebuild complete."
		}
	}()
	return snapshotWork(job), nil
}
func (h *Host) guideBuildState() map[string]any {
	h.mu.RLock()
	job := h.guideJob
	h.mu.RUnlock()
	if job == nil {
		return map[string]any{"id": nil, "kind": "story_bible", "phase": "idle", "message": "Ready to build the Story Bible.", "percent": 0, "logs": []string{}, "elapsed": 0}
	}
	return snapshotWork(job)
}

// pollWorkJob folds the sidecar's latest progress line and any new log lines
// into job. Progress never moves backwards, and *logAt remembers how much of
// the log has already been read.
func pollWorkJob(job *workJob, progressPath, logPath string, logAt *int64) {
	var percent int
	var message string
	if raw, err := os.ReadFile(progressPath); err == nil {
		lines := strings.Split(strings.TrimSpace(string(raw)), "\n")
		if parts := strings.SplitN(lines[len(lines)-1], "|", 3); len(parts) >= 2 {
			percent, _ = strconv.Atoi(strings.TrimSpace(parts[1]))
			if len(parts) == 3 {
				message = strings.TrimSpace(parts[2])
			}
		}
	}
	var fresh []string
	if raw, err := os.ReadFile(logPath); err == nil && *logAt < int64(len(raw)) {
		for _, line := range strings.Split(string(raw[*logAt:]), "\n") {
			if line = strings.TrimRight(line, "\r"); line != "" {
				fresh = append(fresh, line)
			}
		}
		*logAt = int64(len(raw))
	}
	job.mu.Lock()
	defer job.mu.Unlock()
	if percent > job.percent && percent < 100 {
		job.percent = percent
	}
	if message != "" {
		job.message = message
	}
	job.logs = append(job.logs, fresh...)
}
func snapshotWork(job *workJob) map[string]any {
	job.mu.RLock()
	defer job.mu.RUnlock()
	return map[string]any{"id": job.id, "kind": job.kind, "phase": job.phase, "message": job.message, "percent": job.percent, "logs": job.logs, "elapsed": time.Since(job.started).Seconds(), "error": job.errorText}
}
func contains(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}
func isHex(value string) bool {
	for _, rune := range value {
		if (rune < '0' || rune > '9') && (rune < 'a' || rune > 'f') && (rune < 'A' || rune > 'F') {
			return false
		}
	}
	return true
}
