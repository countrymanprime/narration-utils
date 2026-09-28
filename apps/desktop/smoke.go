package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/asrport"
	"github.com/countrymanprime/narration-utils/shell/internal/assets"
	"github.com/countrymanprime/narration-utils/shell/internal/captureport"
	"github.com/countrymanprime/narration-utils/shell/internal/dictionary"
	"github.com/countrymanprime/narration-utils/shell/internal/ffmpeg"
	"github.com/countrymanprime/narration-utils/shell/internal/moonshine"
	"github.com/countrymanprime/narration-utils/shell/internal/process"
	"github.com/countrymanprime/narration-utils/shell/internal/pronunciationport"
	"github.com/countrymanprime/narration-utils/shell/internal/spacy"
	"github.com/countrymanprime/narration-utils/shell/internal/tts"
	"github.com/countrymanprime/narration-utils/shell/internal/ttsport"
	"github.com/countrymanprime/narration-utils/shell/internal/whisper"
	"github.com/countrymanprime/narration-utils/shell/internal/wiktextract"
)

// The packaged-app smoke test: `narration-utils --smoke`. Wails is a GUI program, so a CI job cannot start it and look at a window; this
// mode runs before the window, the single-instance lock and the update relaunch logic exist, checks what a release must carry, prints a
// short JSON report and exits: 0 when every check passed, 1 when one did not, 2 for a bad command line. It is what turns "the release
// contains everything needed to start" (first-use dependency provisioning) from a claim into a check, on the executable that would ship.
//
// It checks, on the real embedded resources and the real per-user cache:
//   - the bundled resources unpack (the same code the app runs at launch);
//   - every bundled sidecar exists and starts (`--help` exits 0);
//   - the frozen Story Bible sidecar can start its espeak-ng phonemizer and read the CMU dictionary (`self-check`), which is what a freeze
//     silently loses; with --piper-model it also speaks one word;
//   - on Windows, the frozen Teleprompter sidecar can load Moonshine's native library (`--check-moonshine`), which PyInstaller cannot
//     see it needs; no model is loaded and nothing is downloaded;
//   - the frozen Teleprompter sidecar's own `--capabilities` report names every ASR and capture row Go's own registries declare for
//     this platform (sidecar-capabilities-flag PRD Phase 1: registration only, not the Moonshine check's native-library load);
//   - the frozen Story Bible sidecar's own `capabilities` report names every TTS and pronunciation row Go's own registries declare
//     for this platform, and the frozen Transcript Compare sidecar's own `--capabilities` report names every batch ASR row (Phase 2:
//     same registration-only comparison, extended to the other two sidecars);
//   - the four approved asset catalogs load and name assets;
//   - the asset cache folder can be found and written;
//   - the REAPER launcher and its scripts are there, with the pointer to this executable.
//
// It downloads nothing and opens no window. Do not run it while the app is open: both use the same per-user cache. Point LocalAppData (Windows; XDG_CACHE_HOME on a Linux development host) at an empty folder to
// keep it out of the real per-user cache.
const smokeFlag = "--smoke"

// resourcesRoot is where the release resources sit inside the embedded file system (main.go).
const resourcesRoot = "cmd/narration-utils/resources"

// smokeCommandTimeout bounds one sidecar command. A frozen sidecar starts in under a second; this is generous for a cold, scanned disk.
const smokeCommandTimeout = 90 * time.Second

// smokeSidecars are the frozen sidecars a release carries, by name (runtime/<name>/<name>[.exe]).
var smokeSidecars = []string{"manuscript-guide", "transcript-compare", "manuscript-teleprompter"}

// smokeReaperFiles are the REAPER scripts a release carries: every top-level Lua file of integrations/reaper, the launcher first.
// scripts/release/reaper-files.mjs is the build-time copy of this list, and smoke_test.go holds both to the folder.
var smokeReaperFiles = []string{
	"NarrationUtils_Launcher.lua",
	"narration_bridge_core.lua",
	"narration_cleanup.lua",
	"narration_cleanup_preview.lua",
	"narration_compare.lua",
	"narration_level_normalize.lua",
	"narration_line_identity.lua",
	"narration_master_render.lua",
	"narration_navigation.lua",
	"narration_pickups.lua",
	"narration_project_state.lua",
	"narration_punch.lua",
	"narration_regions.lua",
	"narration_render.lua",
	"narration_retake_lanes.lua",
	"narration_take_review.lua",
	"narration_track_select.lua",
	"narration_track_state.lua",
	"narration_transport.lua",
	"narration_ui_bridge.lua",
	"narration_workspace.lua",
	"reaper_common_core.lua",
	"reaper_common_process.lua",
}

// isSmokeRequest reports whether the program was started as the smoke test.
func isSmokeRequest(arguments []string) bool { return len(arguments) > 0 && arguments[0] == smokeFlag }

// smokeCheck is one line of the report.
type smokeCheck struct {
	Name   string `json:"name"`
	OK     bool   `json:"ok"`
	Detail string `json:"detail"`
	Millis int64  `json:"ms"`
}

// smokeReport is what the smoke test prints.
type smokeReport struct {
	OK           bool         `json:"ok"`
	Version      string       `json:"version"`
	Executable   string       `json:"executable"`
	ResourceRoot string       `json:"resourceRoot"`
	Checks       []smokeCheck `json:"checks"`
}

// smokeRun starts a program and answers its exit code and output: process.Supervisor.Run, or a fake in a test.
type smokeRun func(ctx context.Context, program string, args ...string) (code int, stdout, stderr string, err error)

// smokeOptions is everything the smoke test reads from outside itself, so a test can hand it a broken resource tree.
type smokeOptions struct {
	// Resources is the embedded resource file system (the `resources` variable of main.go).
	Resources fs.FS
	// UserCache is the per-user cache folder; empty asks the operating system.
	UserCache  string
	Executable string
	Version    string
	// PiperModel, when set, is a voice file the frozen guide sidecar loads and speaks one word with.
	PiperModel string
	// Moonshine asks the frozen teleprompter sidecar to prove it can run the Moonshine engine. True on Windows, the one platform the
	// moonshine-voice wheel is pinned for (pyproject.toml); elsewhere the sidecar is frozen without it.
	Moonshine bool
	Run       smokeRun
	// CommandTimeout bounds each sidecar command; smokeCommandTimeout when zero.
	CommandTimeout time.Duration
	// Platform is the GOOS value checkCapabilities takes the platform-applicable rows for; runtime.GOOS when empty (a test sets it
	// to check a platform other than the one running the test).
	Platform string
}

// smoke runs every check and returns the report. A check that cannot run because an earlier one failed says so, so the report never
// passes on a tree it did not look at.
func smoke(ctx context.Context, options smokeOptions) smokeReport {
	report := smokeReport{Version: options.Version, Executable: options.Executable}
	if options.CommandTimeout == 0 {
		options.CommandTimeout = smokeCommandTimeout
	}
	if options.Platform == "" {
		options.Platform = runtime.GOOS
	}
	add := func(name string, started time.Time, err error, detail string) bool {
		check := smokeCheck{Name: name, OK: err == nil, Detail: detail, Millis: time.Since(started).Milliseconds()}
		if err != nil {
			check.Detail = err.Error()
		}
		report.Checks = append(report.Checks, check)
		return err == nil
	}
	userCache := options.UserCache
	if userCache == "" {
		var err error
		if userCache, err = os.UserCacheDir(); err != nil {
			add("resources", time.Now(), fmt.Errorf("the per-user cache folder could not be found: %w", err), "")
			return finishSmoke(report)
		}
	}
	started := time.Now()
	root, err := materializeResources(options.Resources, userCache, options.Executable)
	report.ResourceRoot = root
	if !add("resources", started, wrapf(err, "the bundled resources could not be unpacked"), root) {
		return finishSmoke(report)
	}
	started = time.Now()
	add("asset-cache", started, checkAssetCache(assets.CacheBaseIn(userCache)), assets.CacheBaseIn(userCache))
	for _, name := range smokeSidecars {
		started = time.Now()
		detail, err := checkSidecarStarts(ctx, options, root, name)
		add("sidecar:"+name, started, err, detail)
	}
	report.Checks = append(report.Checks, checkFrozenGuide(ctx, options, root)...)
	started = time.Now()
	capsDetail, capsErr := checkCapabilities(ctx, options, root)
	add("teleprompter:capabilities", started, capsErr, capsDetail)
	started = time.Now()
	guideCapsDetail, guideCapsErr := checkGuideCapabilities(ctx, options, root)
	add("guide:capabilities", started, guideCapsErr, guideCapsDetail)
	started = time.Now()
	compareCapsDetail, compareCapsErr := checkCompareCapabilities(ctx, options, root)
	add("compare:capabilities", started, compareCapsErr, compareCapsDetail)
	started = time.Now()
	detail, err := checkCatalogs(root)
	add("catalogs", started, err, detail)
	started = time.Now()
	detail, err = checkReaper(root, options.Executable)
	add("reaper", started, err, detail)
	return finishSmoke(report)
}

func finishSmoke(report smokeReport) smokeReport {
	report.OK = len(report.Checks) > 0
	for _, check := range report.Checks {
		report.OK = report.OK && check.OK
	}
	return report
}

// wrapf is fmt.Errorf that keeps a nil error nil.
func wrapf(err error, message string) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%s: %w", message, err)
}

// checkAssetCache proves the asset cache folder can be created and written: a download that could not be written would fail at the
// narrator's first use, not here, unless it is looked at.
func checkAssetCache(base string) error {
	if err := os.MkdirAll(base, 0o755); err != nil {
		return fmt.Errorf("the asset cache folder %s could not be created: %w", base, err)
	}
	probe, err := os.CreateTemp(base, ".smoke-*")
	if err != nil {
		return fmt.Errorf("the asset cache folder %s is not writable: %w", base, err)
	}
	name := probe.Name()
	_, writeErr := probe.WriteString("smoke")
	closeErr := probe.Close()
	removeErr := os.Remove(name)
	if err := errors.Join(writeErr, closeErr, removeErr); err != nil {
		return fmt.Errorf("the asset cache folder %s could not be written: %w", base, err)
	}
	return nil
}

// checkSidecarStarts finds one frozen sidecar in the unpacked resources and starts it with --help, which every one answers with exit code 0.
func checkSidecarStarts(ctx context.Context, options smokeOptions, root, name string) (string, error) {
	executable := sidecarPath(root, name)
	if executable == "" {
		return "", fmt.Errorf("the %s sidecar is missing from the bundled resources (expected %s)", name, expectedSidecar(root, name))
	}
	code, _, stderr, err := runBounded(ctx, options, executable, "--help")
	if err != nil {
		return "", fmt.Errorf("the %s sidecar did not start: %w", name, err)
	}
	if code != 0 {
		return "", fmt.Errorf("the %s sidecar exited with code %d on --help: %s", name, code, firstLine(stderr))
	}
	return executable, nil
}

func expectedSidecar(root, name string) string {
	executable := name
	if os.PathSeparator == '\\' {
		executable += ".exe"
	}
	return filepath.Join(root, "runtime", name, executable)
}

// runBounded runs a command under the options' timeout and says so when it was the timeout that ended it.
func runBounded(ctx context.Context, options smokeOptions, program string, args ...string) (int, string, string, error) {
	bounded, cancel := context.WithTimeout(ctx, options.CommandTimeout)
	defer cancel()
	code, stdout, stderr, err := options.Run(bounded, program, args...)
	if err == nil && bounded.Err() != nil {
		if errors.Is(bounded.Err(), context.DeadlineExceeded) {
			err = fmt.Errorf("it did not finish within %s", options.CommandTimeout)
		} else {
			err = fmt.Errorf("it was stopped before it finished: %w", bounded.Err())
		}
	}
	return code, stdout, stderr, err
}

// frozenGuideReport is what `manuscript-guide self-check` prints.
type frozenGuideReport struct {
	OK     bool `json:"ok"`
	Checks []struct {
		Name   string `json:"name"`
		OK     bool   `json:"ok"`
		Detail string `json:"detail"`
	} `json:"checks"`
}

// checkFrozenGuide runs the frozen Story Bible sidecar's own check of the two things a freeze silently loses: the CMU dictionary and
// Piper's espeak-ng data (and, with a voice, one spoken word). Each of its checks is one line of the report.
func checkFrozenGuide(ctx context.Context, options smokeOptions, root string) []smokeCheck {
	started := time.Now()
	fail := func(err error) []smokeCheck {
		return []smokeCheck{{Name: "guide:self-check", Detail: err.Error(), Millis: time.Since(started).Milliseconds()}}
	}
	executable := sidecarPath(root, "manuscript-guide")
	if executable == "" {
		return fail(errors.New("the manuscript-guide sidecar is missing, so its dictionary and espeak-ng data could not be checked"))
	}
	args := []string{"self-check"}
	if options.PiperModel != "" {
		args = append(args, "--piper-model", options.PiperModel)
	}
	code, stdout, stderr, err := runBounded(ctx, options, executable, args...)
	if err != nil {
		return fail(fmt.Errorf("the manuscript-guide self-check did not run: %w", err))
	}
	var parsed frozenGuideReport
	if jsonErr := json.Unmarshal([]byte(strings.TrimSpace(stdout)), &parsed); jsonErr != nil || len(parsed.Checks) == 0 {
		return fail(fmt.Errorf("the manuscript-guide self-check (exit code %d) printed no report: %s", code, firstLine(stderr+" "+stdout)))
	}
	elapsed := time.Since(started).Milliseconds()
	checks := make([]smokeCheck, 0, len(parsed.Checks)+1)
	reported := map[string]bool{}
	failing := false
	for _, entry := range parsed.Checks {
		reported[entry.Name] = true
		failing = failing || !entry.OK
		checks = append(checks, smokeCheck{Name: "guide:" + entry.Name, OK: entry.OK, Detail: entry.Detail, Millis: elapsed})
	}
	// Every check the sidecar must make has to be in its report: a sidecar that stopped making one must not pass by saying nothing.
	required := []string{"cmudict", "espeak"}
	if options.PiperModel != "" {
		required = append(required, "synthesis")
	}
	for _, name := range required {
		if !reported[name] {
			failing = true
			checks = append(checks, smokeCheck{Name: "guide:" + name, Detail: "the manuscript-guide self-check did not report this check", Millis: elapsed})
		}
	}
	// The exit code and the report's own verdict must agree with the checks: a failure they do not explain is still a failure.
	if !failing && (code != 0 || !parsed.OK) {
		checks = append(checks, smokeCheck{Name: "guide:self-check", Detail: fmt.Sprintf("exit code %d and ok=%v although every check passed", code, parsed.OK), Millis: elapsed})
	}
	return checks
}

// capabilityRow is one row of a --capabilities report - only the fields checkCapabilities itself reads (presence, and, with
// --verify, whether it loaded); every other field (label, platforms, modes, asset) is the sidecar's own business.
type capabilityRow struct {
	Loadable *bool  `json:"loadable"`
	Detail   string `json:"detail"`
}

// capabilitiesReport is what `manuscript-teleprompter --capabilities` prints (sidecars/manuscript-teleprompter/core/live_asr.py's
// capabilities_report): every row it has actually registered, by port then name.
type capabilitiesReport struct {
	Type    string                   `json:"type"`
	Asr     map[string]capabilityRow `json:"asr"`
	Capture map[string]capabilityRow `json:"capture"`
}

// checkCapabilities runs the frozen Teleprompter sidecar's own --capabilities report and requires every ASR and capture row Go's
// own registries declare for options.Platform to be one this process actually registered (sidecar-capabilities-flag PRD, generalizing
// the single hardcoded Moonshine comparison the retired checkFrozenMoonshine made into a loop over every registered provider row
// instead). With options.Moonshine (Windows, the one platform moonshine-voice is pinned for), it also asks for --verify and requires
// the moonshine row to report loadable=true - the same guarantee --check-moonshine made alone before Phase 3 folded it into this
// generic flag and retired the bespoke one (sidecar-capabilities-flag PRD Phase 3, ADR 0403). Every other row stays
// registration-only (loadable: null) until a future phase gives it its own verify hook.
func checkCapabilities(ctx context.Context, options smokeOptions, root string) (string, error) {
	executable := sidecarPath(root, "manuscript-teleprompter")
	if executable == "" {
		return "", errors.New("the manuscript-teleprompter sidecar is missing, so its capabilities could not be checked")
	}
	args := []string{"--capabilities"}
	if options.Moonshine {
		args = append(args, "--verify")
	}
	code, stdout, stderr, err := runBounded(ctx, options, executable, args...)
	if err != nil {
		return "", fmt.Errorf("the capabilities check did not run: %w", err)
	}
	var parsed capabilitiesReport
	if jsonErr := json.Unmarshal([]byte(strings.TrimSpace(stdout)), &parsed); jsonErr != nil || parsed.Type != "capabilities" {
		return "", fmt.Errorf("the capabilities check (exit code %d) printed no report: %s", code, firstLine(stderr+" "+stdout))
	}
	var missing []string
	for _, e := range asrport.Engines.Entries() {
		if e.Descriptor.RunsOn(options.Platform) {
			if _, ok := parsed.Asr[e.Name]; !ok {
				missing = append(missing, "asr:"+e.Name)
			}
		}
	}
	for _, e := range captureport.Backends.Entries() {
		if e.Descriptor.RunsOn(options.Platform) {
			if _, ok := parsed.Capture[e.Name]; !ok {
				missing = append(missing, "capture:"+e.Name)
			}
		}
	}
	if len(missing) > 0 {
		return "", fmt.Errorf("the frozen teleprompter never registered %s, which this build declares for %s", strings.Join(missing, ", "), options.Platform)
	}
	if options.Moonshine {
		row, ok := parsed.Asr["moonshine"]
		if !ok || row.Loadable == nil || !*row.Loadable {
			detail := "the report did not verify it"
			if ok && row.Detail != "" {
				detail = row.Detail
			}
			return "", fmt.Errorf("the frozen teleprompter cannot run Moonshine: %s", detail)
		}
	}
	if code != 0 {
		return "", fmt.Errorf("the capabilities check passed but exited with exit code %d: %s", code, firstLine(stderr))
	}
	return fmt.Sprintf("%d ASR row(s), %d capture row(s)", len(parsed.Asr), len(parsed.Capture)), nil
}

// guideCapabilitiesReport is what `manuscript-guide capabilities` prints (sidecars/manuscript-guide/core/manuscript_guide.py's
// capabilities_report): every row it has actually registered, by port then name. Only the keys matter here, as in capabilitiesReport.
type guideCapabilitiesReport struct {
	Type          string                     `json:"type"`
	Tts           map[string]json.RawMessage `json:"tts"`
	Pronunciation map[string]json.RawMessage `json:"pronunciation"`
}

// checkGuideCapabilities runs the frozen Story Bible sidecar's own `capabilities` report and requires every TTS and pronunciation
// row Go's own registries declare for options.Platform to be one this process actually registered (sidecar-capabilities-flag PRD
// Phase 2, the same comparison checkCapabilities makes for the Teleprompter sidecar). It proves only that the row registered, not
// that it loads (Q2/ADR 0403).
func checkGuideCapabilities(ctx context.Context, options smokeOptions, root string) (string, error) {
	executable := sidecarPath(root, "manuscript-guide")
	if executable == "" {
		return "", errors.New("the manuscript-guide sidecar is missing, so its capabilities could not be checked")
	}
	code, stdout, stderr, err := runBounded(ctx, options, executable, "capabilities")
	if err != nil {
		return "", fmt.Errorf("the guide capabilities check did not run: %w", err)
	}
	var parsed guideCapabilitiesReport
	if jsonErr := json.Unmarshal([]byte(strings.TrimSpace(stdout)), &parsed); jsonErr != nil || parsed.Type != "capabilities" {
		return "", fmt.Errorf("the guide capabilities check (exit code %d) printed no report: %s", code, firstLine(stderr+" "+stdout))
	}
	if code != 0 {
		return "", fmt.Errorf("the guide capabilities check passed but exited with exit code %d: %s", code, firstLine(stderr))
	}
	var missing []string
	for _, e := range ttsport.Engines.Entries() {
		if e.Descriptor.RunsOn(options.Platform) {
			if _, ok := parsed.Tts[e.Name]; !ok {
				missing = append(missing, "tts:"+e.Name)
			}
		}
	}
	for _, e := range pronunciationport.Sources.Entries() {
		if e.Descriptor.RunsOn(options.Platform) {
			if _, ok := parsed.Pronunciation[e.Name]; !ok {
				missing = append(missing, "pronunciation:"+e.Name)
			}
		}
	}
	if len(missing) > 0 {
		return "", fmt.Errorf("the frozen guide never registered %s, which this build declares for %s", strings.Join(missing, ", "), options.Platform)
	}
	return fmt.Sprintf("%d TTS row(s), %d pronunciation row(s)", len(parsed.Tts), len(parsed.Pronunciation)), nil
}

// compareCapabilitiesReport is what `transcript-compare --capabilities` prints (sidecars/transcript-compare/core/compare.py's
// capabilities_report): every row it has actually registered, by name. Only the keys matter here, as in capabilitiesReport.
type compareCapabilitiesReport struct {
	Type string                     `json:"type"`
	Asr  map[string]json.RawMessage `json:"asr"`
}

// checkCompareCapabilities runs the frozen Transcript Compare sidecar's own --capabilities report and requires every batch-mode ASR
// row Go's own registries declare for options.Platform to be one this process actually registered (sidecar-capabilities-flag PRD
// Phase 2). Unlike checkCapabilities (the live/Teleprompter sidecar), this filters to rows that declare the batch mode: Transcript
// Compare only ever imports asr_batch, so a live-only, platform-applicable row (Moonshine) would never appear in its report even on
// a platform it ships for, and that must not be mistaken for a missing registration. --manuscript is passed only because compare.py's
// argument parser requires it for every invocation (see compare.py's module docstring); --capabilities ignores its value.
func checkCompareCapabilities(ctx context.Context, options smokeOptions, root string) (string, error) {
	executable := sidecarPath(root, "transcript-compare")
	if executable == "" {
		return "", errors.New("the transcript-compare sidecar is missing, so its capabilities could not be checked")
	}
	code, stdout, stderr, err := runBounded(ctx, options, executable, "--capabilities", "--manuscript", "smoke-test-unused.json")
	if err != nil {
		return "", fmt.Errorf("the compare capabilities check did not run: %w", err)
	}
	var parsed compareCapabilitiesReport
	if jsonErr := json.Unmarshal([]byte(strings.TrimSpace(stdout)), &parsed); jsonErr != nil || parsed.Type != "capabilities" {
		return "", fmt.Errorf("the compare capabilities check (exit code %d) printed no report: %s", code, firstLine(stderr+" "+stdout))
	}
	if code != 0 {
		return "", fmt.Errorf("the compare capabilities check passed but exited with exit code %d: %s", code, firstLine(stderr))
	}
	var missing []string
	for _, e := range asrport.Engines.Entries() {
		if e.Descriptor.RunsOn(options.Platform) && e.Descriptor.Supports(asrport.ModeBatch) {
			if _, ok := parsed.Asr[e.Name]; !ok {
				missing = append(missing, "asr:"+e.Name)
			}
		}
	}
	if len(missing) > 0 {
		return "", fmt.Errorf("the frozen transcript-compare never registered %s, which this build declares for %s", strings.Join(missing, ", "), options.Platform)
	}
	return fmt.Sprintf("%d ASR row(s)", len(parsed.Asr)), nil
}

// checkCatalogs loads the seven approved asset catalogs the release carries (config/*-assets.json in the unpacked resources) and requires
// each to name at least one asset: an empty or unreadable catalog would leave the narrator nothing to download. A Pending row (the
// wiktextract catalog, prep-depth Phase 8, until a future session verifies its download) still counts: this check is "the catalog lists
// something," not "it can be installed." The frozen sidecar's own Moonshine support is checked apart from its catalog, by checkCapabilities's
// verify pass.
func checkCatalogs(root string) (string, error) {
	configDir := filepath.Join(root, "config")
	voices, err := tts.New(filepath.Join(configDir, "tts-assets.json"), "")
	if err != nil {
		return "", fmt.Errorf("the voice catalog could not be loaded: %w", err)
	}
	models, err := whisper.New(filepath.Join(configDir, "whisper-assets.json"), "")
	if err != nil {
		return "", fmt.Errorf("the Whisper catalog could not be loaded: %w", err)
	}
	languageModels, err := spacy.New(filepath.Join(configDir, "spacy-assets.json"), "")
	if err != nil {
		return "", fmt.Errorf("the spaCy catalog could not be loaded: %w", err)
	}
	liveModels, err := moonshine.New(filepath.Join(configDir, "moonshine-assets.json"), "")
	if err != nil {
		return "", fmt.Errorf("the Moonshine catalog could not be loaded: %w", err)
	}
	dictionaries, err := dictionary.New(filepath.Join(configDir, "dictionary-assets.json"), "")
	if err != nil {
		return "", fmt.Errorf("the dictionary catalog could not be loaded: %w", err)
	}
	pronunciationSources, err := wiktextract.New(filepath.Join(configDir, "wiktextract-assets.json"), "")
	if err != nil {
		return "", fmt.Errorf("the wiktextract catalog could not be loaded: %w", err)
	}
	// The encoder catalog is read for Windows whatever the machine: its one build is a Windows executable (ADR 0342), and the release
	// the smoke test checks is the Windows one.
	encoders, err := ffmpeg.NewFor(filepath.Join(configDir, "encoder-assets.json"), "", "windows")
	if err != nil {
		return "", fmt.Errorf("the encoder catalog could not be loaded: %w", err)
	}
	counts := map[string]int{"voices": len(voices.Voices()), "Whisper models": len(models.Models()), "spaCy models": len(languageModels.Models()), "Moonshine models": len(liveModels.Models()),
		"dictionaries": len(dictionaries.Dictionaries()), "wiktextract sources": len(pronunciationSources.Sources()), "encoders": len(encoders.Builds())}
	for _, kind := range []string{"voices", "Whisper models", "spaCy models", "Moonshine models", "dictionaries", "wiktextract sources", "encoders"} {
		if counts[kind] == 0 {
			return "", fmt.Errorf("the catalog of %s names no assets", kind)
		}
	}
	return fmt.Sprintf("%d voice(s), %d Whisper model(s), %d spaCy model(s), %d Moonshine model(s), %d dictionary(ies), %d wiktextract source(s), %d encoder(s)", counts["voices"],
		counts["Whisper models"], counts["spaCy models"], counts["Moonshine models"], counts["dictionaries"], counts["wiktextract sources"], counts["encoders"]), nil
}

// checkReaper requires the REAPER launcher and every script it loads in the unpacked resources, and the pointer file that tells the
// launcher where this executable is.
func checkReaper(root, executable string) (string, error) {
	var missing []string
	for _, name := range smokeReaperFiles {
		if info, err := os.Stat(filepath.Join(root, "reaper", name)); err != nil || info.IsDir() {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		return "", fmt.Errorf("the REAPER package is missing %s", strings.Join(missing, ", "))
	}
	if executable == "" {
		return fmt.Sprintf("%d scripts", len(smokeReaperFiles)), nil
	}
	pointer, err := os.ReadFile(filepath.Join(root, "reaper", "narration-utils-app-path.txt"))
	if err != nil {
		return "", fmt.Errorf("the launcher pointer to the app was not written: %w", err)
	}
	if got := strings.TrimSpace(string(pointer)); got != executable {
		return "", fmt.Errorf("the launcher points at %q, want %q", got, executable)
	}
	return fmt.Sprintf("%d scripts, launcher points at the app", len(smokeReaperFiles)), nil
}

// smokeArguments is the parsed command line: --smoke [--piper-model FILE] [--report FILE].
type smokeArguments struct{ piperModel, reportPath string }

func parseSmokeArguments(arguments []string) (smokeArguments, error) {
	var parsed smokeArguments
	rest := arguments[1:]
	for len(rest) > 0 {
		flag := rest[0]
		var target *string
		switch flag {
		case "--piper-model":
			target = &parsed.piperModel
		case "--report":
			target = &parsed.reportPath
		}
		if target == nil || len(rest) < 2 || rest[1] == "" {
			return parsed, fmt.Errorf("usage: --smoke [--piper-model FILE] [--report FILE] (unexpected %q)", flag)
		}
		*target = rest[1]
		rest = rest[2:]
	}
	return parsed, nil
}

// runSmoke is the program's whole run in smoke mode: it prints the report to stdout (and to --report, where a GUI-subsystem Windows
// program's stdout may not reach a caller), a line per failure to stderr, and answers the exit code.
func runSmoke(ctx context.Context, arguments []string, resourcesFS fs.FS, stdout, stderr io.Writer) int {
	parsed, err := parseSmokeArguments(arguments)
	if err != nil {
		_, _ = fmt.Fprintln(stderr, err)
		return 2
	}
	supervisor := process.NewSupervisor()
	defer func() { _ = supervisor.Close() }()
	report := smoke(ctx, smokeOptions{Resources: resourcesFS, Executable: executablePath(), Version: version, PiperModel: parsed.piperModel, Moonshine: runtime.GOOS == "windows", Run: supervisor.Run})
	return writeSmokeReport(report, parsed.reportPath, stdout, stderr)
}

// writeSmokeReport prints the report and answers the exit code: 0 when every check passed, otherwise 1.
func writeSmokeReport(report smokeReport, reportPath string, stdout, stderr io.Writer) int {
	encoded, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		_, _ = fmt.Fprintln(stderr, "smoke: the report could not be written:", err)
		return 1
	}
	_, _ = fmt.Fprintln(stdout, string(encoded))
	code := 0
	if reportPath != "" {
		if err := os.WriteFile(reportPath, append(encoded, '\n'), 0o600); err != nil {
			_, _ = fmt.Fprintln(stderr, "smoke: the report file could not be written:", err)
			code = 1
		}
	}
	for _, check := range report.Checks {
		if !check.OK {
			_, _ = fmt.Fprintf(stderr, "smoke: FAILED %s: %s\n", check.Name, check.Detail)
			code = 1
		}
	}
	if !report.OK {
		code = 1
	}
	return code
}

// firstLine is the first non-empty line of some output, for a failure message.
func firstLine(text string) string {
	for _, line := range strings.Split(text, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			return line
		}
	}
	return "(no output)"
}
