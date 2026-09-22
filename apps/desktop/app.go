package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/guide"
	"github.com/countrymanprime/narration-utils/shell/internal/hostlog"
	"github.com/countrymanprime/narration-utils/shell/internal/layout"
	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
	"github.com/countrymanprime/narration-utils/shell/internal/persist"
	"github.com/countrymanprime/narration-utils/shell/internal/process"
	"github.com/countrymanprime/narration-utils/shell/internal/project"
	"github.com/countrymanprime/narration-utils/shell/internal/recents"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
	"github.com/countrymanprime/narration-utils/shell/internal/teleprompter"
	"github.com/countrymanprime/narration-utils/shell/internal/transcript"
	"github.com/countrymanprime/narration-utils/shell/internal/tts"
	"github.com/countrymanprime/narration-utils/shell/internal/update"
	"github.com/countrymanprime/narration-utils/shell/internal/whisper"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Keep this in lockstep with apps/ui/src/hostApi.ts.  The frontend rejects
// an older host before bootstrapping so a partial update cannot run against a
// binding contract it does not understand.
const hostAPIVersion = 15

// Host is the Wails binding boundary. The frontend invokes only this bound
// object; it never receives a loopback port or an HTTP capability.
type Host struct {
	mu         sync.RWMutex
	ctx        context.Context
	cancel     context.CancelFunc
	diagnostic string
	version    string
	config     config
	manuscript *manuscript.Service
	sidecars   *process.Supervisor
	settings   *settings.Store
	// assets is the registry of everything that can be downloaded (assetregistry.go). It is set once, in Startup, and never replaced: a project
	// switch does not touch it, so it is read with registry() and needs no snapshot.
	assets *assetRegistry
	// installJobs are the asset downloads, voices and models alike (installjobs.go); h.mu guards the map and each job its own fields.
	installJobs map[string]*installJob
	// removing holds the assets (kind/id) that are being removed, so a download of the same asset cannot start under the removal (h.mu).
	removing   map[string]bool
	guide      *guide.Service
	guideJob   *workJob
	transcript *transcript.Service
	// findings is the store Transcript Compare's adapter saves into on
	// every completed run (review-dashboard-and-findings-adoption.prd.md
	// Phase 2). No binding reads it yet (Phase 4 does that); it exists
	// here only so the adapter has somewhere durable to write.
	findings     *findings.Store
	teleprompter *teleprompter.Service
	recents      *recents.Store
	log          *hostlog.Log
	// updates asks GitHub for a newer release and remembers the answer (ADR 0072). It is set once in NewHost and never swapped, so it is
	// read directly, like recents.
	updates *update.Checker
	// stager downloads and unpacks an update into the per-user cache; updateJob is the download in progress or the last one (h.mu).
	stager    *update.Stager
	updateJob *updateJob
	// updateDelay is a seam for tests: how long Startup waits before the automatic update check; zero means startupUpdateDelay.
	updateDelay time.Duration
	// updateEvents and openURL are seams for tests: nil means the Wails runtime.
	updateEvents func(updateStatus)
	openURL      func(ctx context.Context, address string)
	// jobEvents is a seam for tests: nil means the Wails runtime (jobs.go). transcriptRuns turns transcript states into job ends.
	jobEvents      func(jobEnded)
	transcriptRuns transcriptWatch
	// installUpdate, quitApp, executable and pendingPath are seams for tests: nil or empty means the real thing.
	installUpdate func(context.Context, update.InstallOptions) error
	quitApp       func()
	executable    func() (string, error)
	openFolder    func(dir string) error
	pendingPath   string
	confirmUpdate sync.Once
	// writable* remember whether the install folder can be written to, for a short while (see writable).
	writableMu  sync.Mutex
	writableDir string
	writableAt  time.Time
	writableOK  bool
	// persist reports a file that cannot be read: to the host log and, for the narrator's own data, to the narrator (ADR 0069).
	persist *persist.Reporter
	// notifySender is a seam for tests: nil means the real Wails notification API. notifyInitOnce guards the lazy
	// InitializeNotifications call SystemNotify makes on the first qualifying send (notifications.go, N2).
	notifySender   notificationSender
	notifyInitOnce sync.Once
}

type workJob struct {
	mu                                  sync.RWMutex
	id, kind, phase, message, errorText string
	percent                             int
	logs                                []string
	started                             time.Time
	// report writes to the host log; badProgress is set once a malformed progress line was reported, so a stuck line is not repeated.
	report      func(kind, message string)
	badProgress bool
}

type config struct {
	repoRoot      string
	sessionDir    string
	projectFolder string
	projectName   string
	// projectFile is the REAPER-launched rpp's own path (PRD
	// project-workspace-and-daw-link.prd.md Phase 5, --project-file). It maps
	// back to whichever project's manifest links it (resolveProjectFile),
	// which may not be projectFolder: the launcher only ever sets projectFolder
	// to the rpp's own containing folder (W4/W6), and the two can diverge once
	// the rpp is linked from a project that lives elsewhere.
	projectFile                             string
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
	logger := hostlog.New(hostlog.DefaultPath(), 0)
	// The services are built and given their reporter before the Host exists, so nothing reads a swappable field off a Host here
	// (hostguard_test.go); the reporter reaches the narrator through the host once it does.
	var host *Host
	reporter := &persist.Reporter{Log: func(kind, message string) { _ = logger.Report(kind, message) }, Notify: func(text string) { host.noticeNarrator(text) }}
	store, notes, recent := settings.New(repoRoot, ""), manuscript.New(""), recents.New(recentProjectsPath())
	store.SetPersist(reporter)
	notes.SetPersist(reporter)
	recent.SetPersist(reporter)
	notes.SetOnJobEnd(func(job manuscript.ImportJob) { host.importJobEnded(job) })
	host = &Host{diagnostic: fmt.Sprintf("go-%d", time.Now().UnixNano()), version: version, config: config{repoRoot: repoRoot}, manuscript: notes, sidecars: process.NewSupervisor(), settings: store, installJobs: map[string]*installJob{}, recents: recent, log: logger, persist: reporter, updates: update.NewChecker(version, updateCachePath(), reporter), stager: newUpdateStager(), pendingPath: updatePendingPath()}
	return host
}

// noticeNarrator tells the narrator something the app did on their behalf, such as keeping a file it could not read (the
// system:notice event). It is best effort before the window exists, and it never holds h.mu across the emit.
func (h *Host) noticeNarrator(text string) {
	h.mu.RLock()
	ctx := h.ctx
	h.mu.RUnlock()
	if ctx != nil {
		runtime.EventsEmit(ctx, "system:notice", noticePayload(text))
	}
}

// noticePayload is the system:notice event: the text to show the narrator.
func noticePayload(text string) map[string]any { return map[string]any{"text": text} }

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
	next := h.resolveProjectFileLocked(parseConfig(h.config.repoRoot))
	// A REAPER launch (--daw REAPER, set unconditionally by
	// NarrationUtils_Launcher.lua) that still has no project folder after
	// matching means the narrator lands on the picker with nothing chosen for
	// them (W5): an unsaved rpp (next.projectFile empty) or a saved one no
	// project has linked yet. Captured before configureLocked so the reason
	// text can tell those two cases apart.
	unresolvedReaperLaunch := next.daw != "" && next.projectFolder == ""
	unresolvedReason := startupProjectFileReason(next.projectFile)
	h.configureLocked(next)
	h.assets = h.buildAssetRegistry()
	runtimeContext, delay := h.ctx, h.updateDelay
	h.mu.Unlock()
	if unresolvedReaperLaunch {
		runtime.EventsEmit(runtimeContext, "system:attached", map[string]any{"attached": false, "reason": unresolvedReason})
	}
	if delay == 0 {
		delay = startupUpdateDelay
	}
	go h.transcriptLoop(runtimeContext)
	go h.startupUpdateCheck(runtimeContext, delay)
	go h.cleanStaleDownloads()
}

// cleanStaleDownloads removes the leftovers of a download or repair that was interrupted long ago. It never runs while a download of this
// session could be using them: it only touches folders older than a week (or an hour for the aside copy of a repair).
func (h *Host) cleanStaleDownloads() {
	base, err := assetCacheBase()
	if err != nil {
		return
	}
	for _, removed := range cleanAssetCaches(base) {
		_ = h.log.Report("asset_cache_cleaned", removed)
	}
}

// configureLocked rebuilds project-scoped services from launcher arguments.
// Its caller holds h.mu and has already established that no active work can
// be displaced. Release resources are materialized only when the launcher did
// not explicitly name development sidecars.
func (h *Host) configureLocked(next config) {
	next.repoRoot = layout.FindRoot(next.repoRoot)
	h.config = next
	h.settings = settings.New(h.config.repoRoot, h.config.projectFolder)
	h.settings.SetPersist(h.persist)
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
	h.manuscript.SetPersist(h.persist)
	h.findings = findings.NewStore(h.config.projectFolder)
	h.findings.SetPersist(h.persist)
	h.settings.SetProject(h.config.projectFolder)
	h.guide = guide.New(h.config.projectFolder, h.config.manuscriptPython, h.config.manuscriptBackend, h.settings, h.sidecars)
	h.guide.SetPersist(h.persist)
	var client *bridge.Client
	if h.config.sessionDir != "" {
		client, _ = bridge.New(h.config.sessionDir)
		if client != nil {
			client.SetLog(func(kind, message string) { _ = h.log.Report(kind, message) })
		}
	}
	h.transcript = transcript.New(transcript.Config{Project: h.config.projectFolder, SessionDir: h.config.sessionDir, Python: h.config.comparePython, Backend: h.config.compareBackend}, client, h.settings, h.sidecars, h.emitTranscript)
	h.transcript.SetPersist(h.persist)
	h.transcript.SetFindings(h.findings, h.manuscript)
	teleprompterDir := h.config.sessionDir
	if teleprompterDir == "" {
		teleprompterDir = filepath.Join(os.TempDir(), "narration-utils")
	}
	h.teleprompter = teleprompter.New(teleprompter.Config{Project: h.config.projectFolder, SessionDir: teleprompterDir, Python: h.config.teleprompterPython, Backend: h.config.teleprompterBackend}, h.sidecars, h.emitTeleprompterEvent, h.emitTeleprompterState)
	h.teleprompter.SetLog(func(kind, message string) { _ = h.log.Report(kind, message) })
}

// packagedResources materializes the embedded release resources under the per-user cache so Python/ONNX dynamic libraries can use
// ordinary filesystem paths. Developer launches pass explicit paths and never use this route. It answers the folder, or "" when they
// could not be unpacked.
func (h *Host) packagedResources() string {
	cache, err := os.UserCacheDir()
	if err != nil {
		return ""
	}
	root, err := materializeResources(resources, cache, executablePath())
	if err != nil {
		return ""
	}
	return root
}

// materializeResources unpacks the resources embedded in source into <userCache>/narration-utils/runtime/<key> and returns that folder.
// The folder is content-addressed and is only written when it is missing or incomplete, so it is safe to call at every start. The
// packaged smoke test (smoke.go) calls it with the embedded resources of the real executable.
func materializeResources(source fs.FS, userCache, executable string) (string, error) {
	key, err := resourceKeyFor(source)
	if err != nil {
		return "", err
	}
	target := filepath.Join(userCache, "narration-utils", "runtime", key)
	if _, err := os.Stat(filepath.Join(target, ".complete")); err == nil {
		// The payload may be unchanged while the app executable moves (for
		// example after a user relocates a portable install). Refresh this
		// tiny launcher pointer on every startup; REAPER import itself remains
		// an explicit, user-controlled action.
		_ = writeReaperLauncherPath(target, executable)
		return target, nil
	}
	staging := target + ".staging"
	if err := os.RemoveAll(staging); err != nil {
		return "", err
	}
	if err := fs.WalkDir(source, resourcesRoot, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(resourcesRoot, path)
		if err != nil || relative == "." {
			return nil
		}
		destination := filepath.Join(staging, relative)
		if entry.IsDir() {
			return os.MkdirAll(destination, 0o755)
		}
		bytes, err := fs.ReadFile(source, path)
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
		return "", err
	}
	if err := os.WriteFile(filepath.Join(staging, ".complete"), []byte(key+"\n"), 0o600); err != nil {
		_ = os.RemoveAll(staging)
		return "", err
	}
	if err := os.RemoveAll(target); err != nil {
		_ = os.RemoveAll(staging)
		return "", err
	}
	if err := os.Rename(staging, target); err != nil {
		return "", err
	}
	// The REAPER action is intentionally materialized beside the immutable
	// sidecars.  It needs the installed Wails executable rather than a
	// checkout-relative path; the Lua launcher reads this one-line file.
	// REAPER is never modified automatically: Settings shows this path for a
	// user-controlled import or re-import.
	_ = writeReaperLauncherPath(target, executable)
	return target, nil
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

// resourceKeyFor changes whenever any embedded release resource changes. Keeping
// the cache content-addressed means an installed app update never starts an
// obsolete Python sidecar or REAPER action from a previous build.
func resourceKeyFor(source fs.FS) (string, error) {
	hash := sha256.New()
	err := fs.WalkDir(source, resourcesRoot, func(path string, entry fs.DirEntry, walkErr error) error {
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
	// A run that just ended is reported once, as a job end, before the state event that carries its results (jobs.go).
	if event, ended := h.transcriptRuns.observe(state); ended {
		h.publishJobEnded(event)
	}
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
		next := h.resolveProjectFileLocked(parseConfigArgs(h.config.repoRoot, instance.Args))
		if next.projectFolder == "" {
			reason = startupProjectFileReason(next.projectFile)
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
		"--project-name": &result.projectName, "--project-file": &result.projectFile, "--daw": &result.daw, "--manuscript-python": &result.manuscriptPython,
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

// resolveProjectFile maps next.projectFile (the REAPER-launched rpp's own
// path, PRD project-workspace-and-daw-link.prd.md Phase 5) back to whichever
// project's manifest links it, scanning projectsDir with
// project.FindByDawFile (W5: "match by linked file"). A match always wins
// over next.projectFolder/projectName, because those are only ever the rpp's
// own containing folder as the launcher sees it (Lua has no notion of the
// link, W4): once a project has claimed this rpp, later launches must keep
// attaching that project even if the rpp now lives outside its folder.
//
// With no match - an rpp nothing has linked yet, or projectFile empty (an
// unsaved REAPER project, W5) - next is returned unchanged, so the caller's
// existing behaviour keeps working: an existing REAPER session with no link
// still attaches the rpp's own folder (W6), and an unsaved project (empty
// projectFolder too) still falls through to the picker.
func resolveProjectFile(reporter *persist.Reporter, projectsDir string, next config) config {
	if next.projectFile == "" {
		return next
	}
	folder, name, ok := project.FindByDawFile(reporter, projectsDir, next.projectFile)
	if !ok {
		return next
	}
	next.projectFolder = folder
	next.projectName = name
	return next
}

// resolveProjectFileLocked resolves the real projects directory and applies
// resolveProjectFile. A failure to resolve the projects directory (W7: an
// unresolvable home folder) is non-fatal here too, matching every other use
// of project.ResolveDir: next is returned unchanged and the caller's existing
// fallback takes over.
func (h *Host) resolveProjectFileLocked(next config) config {
	projectsDir, err := project.ResolveDir("")
	if err != nil {
		return next
	}
	return resolveProjectFile(h.persist, projectsDir, next)
}

// startupProjectFileReason is the narrator-facing explanation emitted (W5)
// when a REAPER launch could not be resolved to any project: an unsaved
// REAPER project has no file to match at all, and a saved one may simply not
// be linked to a Narration Utils project yet. Either way the picker (already
// shown whenever projectFolder is empty) is where the narrator resolves it.
func startupProjectFileReason(projectFile string) string {
	if projectFile == "" {
		return "This REAPER project has not been saved yet, so it has no file to link. Save it in REAPER, or choose or create a Narration Utils project."
	}
	return "This REAPER project isn't linked to a Narration Utils project yet. Choose or create one to link it."
}

// canAttachLocked implements the REAPER single-instance rule: attach a new
// saved project only when that cannot discard an import draft, sidecar run,
// Story Bible build, or voice download in the visible window.
func (h *Host) canAttachLocked() bool {
	return h.idleLocked() && (h.updateJob == nil || !h.updateJob.installing())
}

// idleLocked reports whether nothing is running that a restart or a project switch would displace: an import draft, a Story Bible
// build, a download, a comparison or a teleprompter session. The caller holds h.mu.
func (h *Host) idleLocked() bool {
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
	for _, job := range h.installJobs {
		if job.running() {
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

// idle is idleLocked under a read lock. The update install asks it again just before the swap; the update job itself is not work
// it would displace.
func (h *Host) idle() bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.idleLocked()
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
	// The first Bootstrap means the window loaded and the UI accepted this host: an update that was just installed has worked.
	h.confirmUpdate.Do(h.confirmInstalledUpdate)
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
	dawFileLinked, dawReachable, dawProjectMatches := dawLinkFacts(h.persist, config.projectFolder, config.daw)
	return map[string]any{
		"apiVersion": hostAPIVersion, "diagnosticId": h.diagnostic, "version": h.version,
		"projectFolder": config.projectFolder, "projectName": config.projectName, "daw": config.daw,
		// dawFileLinked/dawReachable/dawProjectMatches are the three separate facts PRD
		// project-workspace-and-daw-link.prd.md W13 asks for, modeled apart from `daw` (see dawfacts.go).
		"dawFileLinked": dawFileLinked, "dawReachable": dawReachable, "dawProjectMatches": dawProjectMatches,
		"manuscript": imported, "manuscriptCandidate": manuscriptCandidate,
		"runtime": map[string]any{
			"ManuscriptGuide":   map[string]string{"python_exe": config.manuscriptPython, "backend": config.manuscriptBackend},
			"TranscriptCompare": map[string]string{"python_exe": config.comparePython, "compare_script": config.compareBackend},
			"Reaper":            map[string]string{"launcherPath": config.reaperLauncher},
		},
		"transcript": transcriptState,
	}
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
	"General":           {{"log_verbosity", "Log verbosity", "choice", []string{"quiet", "normal", "verbose"}}, {"notifications", "Notify me when a long task finishes while I'm away", "bool", nil}},
	"Manuscript":        {{"color_note", "Note color", "color", nil}},
	"ManuscriptGuide":   {{"spacy_model", "spaCy model", "choice", []string{"en_core_web_sm", "en_core_web_lg"}}, {"build_after_import", "Build the Story Bible after import", "bool", nil}},
	"Piper":             {{"tts_provider", "TTS provider", "choice", []string{"piper"}}, {"tts_voice_id", "Preview voice", "choice", []string{"en_US-ljspeech-high"}}},
	"Updates":           {{"check_on_startup", "Check for updates on startup", "bool", nil}, {"channel", "Update channel", "choice", []string{"candidates", "stable"}}},
	"TranscriptCompare": {{"model_size", "Default Whisper model", "choice", []string{"tiny", "small", "medium", "large-v3-turbo", "large-v3"}}, {"chunk_seconds", "Default chunk length", "choice", []string{"30", "60", "300", "600"}}, {"color_misread", "Misread marker color", "color", nil}, {"color_skipped", "Skipped marker color", "color", nil}, {"color_extra", "Extra marker color", "color", nil}},
}

// settingsSchemas is the settings the app offers with each choice that comes from an approved catalog filled in from it: the spaCy model
// choice is the catalog's models, whether or not they are installed, so a narrator can select a model before downloading it.
func (h *Host) settingsSchemas() map[string][]fieldSchema {
	schemas := make(map[string][]fieldSchema, len(fieldSchemas))
	for tool, fields := range fieldSchemas {
		schemas[tool] = fields
	}
	if models := h.registry().spacy; models != nil {
		// Replace only the spacy_model choices with the catalog's models; a bug fixed on the way in (found while adding
		// build_after_import, N19d): this used to replace the whole ManuscriptGuide list, silently dropping every other
		// field in it whenever the spaCy registry was built.
		updated := make([]fieldSchema, len(schemas["ManuscriptGuide"]))
		for i, field := range schemas["ManuscriptGuide"] {
			if field.key == "spacy_model" {
				field.choices = models.IDs()
			}
			updated[i] = field
		}
		schemas["ManuscriptGuide"] = updated
	}
	return schemas
}

func (h *Host) settingsForScope(scope string) (map[string]any, error) {
	if scope != "global" && scope != "project" {
		return nil, fmt.Errorf("unsupported settings scope")
	}
	store := h.services().settings
	result := map[string]any{}
	for tool, schemas := range h.settingsSchemas() {
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
	schemas, ok := h.settingsSchemas()[tool]
	if !ok {
		return fmt.Errorf("unsupported settings tool")
	}
	if tool == "Updates" && scope != "global" {
		return fmt.Errorf("update settings are global: a project does not choose how the app updates")
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
	registry := h.registry()
	if registry.tts == nil {
		return nil, registry.catalogUnavailable("TTS")
	}
	if _, ok := registry.tts.Voice(voiceID); !ok {
		return nil, fmt.Errorf("the selected voice is not in the approved catalog")
	}
	snapshot, err := h.startAssetInstall(installKindTts, voiceID)
	if err != nil {
		return nil, err
	}
	return legacyInstall(snapshot), nil
}
func (h *Host) ttsInstallState(id string) (map[string]any, error) {
	job, err := h.installJobByID(id, "TTS")
	if err != nil {
		return nil, err
	}
	return legacyInstall(snapshotInstall(job)), nil
}
func (h *Host) cancelTtsInstall(id string) (map[string]any, error) {
	job, err := h.installJobByID(id, "TTS")
	if err != nil {
		return nil, err
	}
	job.cancel()
	return legacyInstall(snapshotInstall(job)), nil
}
func (h *Host) startWhisperInstall(modelID string) (map[string]any, error) {
	registry := h.registry()
	if registry.whisper == nil {
		return nil, registry.catalogUnavailable("Whisper")
	}
	if _, ok := registry.whisper.Model(modelID); !ok {
		return nil, fmt.Errorf("the selected Whisper model is not in the approved catalog")
	}
	snapshot, err := h.startAssetInstall(installKindWhisper, modelID)
	if err != nil {
		return nil, err
	}
	return legacyInstall(snapshot), nil
}
func (h *Host) whisperInstallState(id string) (map[string]any, error) {
	job, err := h.installJobByID(id, "Whisper")
	if err != nil {
		return nil, err
	}
	return legacyInstall(snapshotInstall(job)), nil
}
func (h *Host) cancelWhisperInstall(id string) (map[string]any, error) {
	job, err := h.installJobByID(id, "Whisper")
	if err != nil {
		return nil, err
	}
	job.cancel()
	return legacyInstall(snapshotInstall(job)), nil
}

// startGuideBuild starts the Story Bible build with the language model the narrator selected. The model is an asset: when it is not
// installed nothing starts and the answer is asset_required (the first-use gate), so the narrator chooses to download it, to build with
// the rules-only extraction this once, or to cancel. rulesOnly is that second choice.
func (h *Host) startGuideBuild(rulesOnly bool) (map[string]any, error) {
	svc := h.services()
	if svc.guide == nil {
		return nil, fmt.Errorf("the Story Bible is unavailable")
	}
	model, gate, err := h.spacyForBuild(svc.settings, rulesOnly)
	if err != nil || gate != nil {
		return gate, err
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
	job := &workJob{id: fmt.Sprintf("guide-%d", time.Now().UnixNano()), kind: "story_bible", phase: "running", message: "Story Bible rebuild started.", percent: 1, started: time.Now(), report: func(kind, message string) { _ = h.log.Report(kind, message) }}
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
		_, err := svc.guide.Build(progress, log, model)
		close(stop)
		<-stopped
		pollWorkJob(job, progress, log, &logAt)
		job.mu.Lock()
		if err != nil {
			job.phase = "error"
			job.errorText = err.Error()
			job.message = err.Error()
		} else {
			job.phase = "success"
			job.percent = 100
			job.message = "Story Bible rebuild complete."
			if rulesOnly {
				job.message = "Story Bible rebuild complete with the rules-only extraction, which is lower quality than a language model."
			}
		}
		event, ok := endedJob(job.id, jobKindStoryBible, job.phase, job.message, job.started)
		job.mu.Unlock()
		if ok {
			h.publishJobEnded(event)
		}
	}()
	return map[string]any{"status": "started", "job": snapshotWork(job)}, nil
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
		if _, parsed, text, parseErr := process.ParseProgress(lines[len(lines)-1]); parseErr != nil {
			// A bad line keeps the last good progress; it is reported once per job, not on every poll.
			if job.report != nil && !job.badProgress {
				job.badProgress = true
				job.report("progress_line_ignored", fmt.Sprintf("Story Bible progress line ignored: %v", parseErr))
			}
		} else {
			percent, message = int(parsed), text
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
