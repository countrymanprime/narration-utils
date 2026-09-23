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

	"github.com/countrymanprime/narration-utils/shell/internal/assets"
	"github.com/countrymanprime/narration-utils/shell/internal/dictionary"
	"github.com/countrymanprime/narration-utils/shell/internal/moonshine"
	"github.com/countrymanprime/narration-utils/shell/internal/process"
	"github.com/countrymanprime/narration-utils/shell/internal/spacy"
	"github.com/countrymanprime/narration-utils/shell/internal/tts"
	"github.com/countrymanprime/narration-utils/shell/internal/whisper"
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
//   - the four approved asset catalogs load and name assets;
//   - the asset cache folder can be found and written;
//   - the REAPER launcher and its scripts are there, with the pointer to this executable.
//
// It downloads nothing and opens no window. Do not run it while the app is open: both use the same per-user cache. Point LocalAppData (Windows), XDG_CACHE_HOME (Linux) or HOME (macOS) at an empty folder to
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
	"narration_compare.lua",
	"narration_line_identity.lua",
	"narration_navigation.lua",
	"narration_pickups.lua",
	"narration_project_state.lua",
	"narration_render.lua",
	"narration_take_review.lua",
	"narration_ui_bridge.lua",
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
}

// smoke runs every check and returns the report. A check that cannot run because an earlier one failed says so, so the report never
// passes on a tree it did not look at.
func smoke(ctx context.Context, options smokeOptions) smokeReport {
	report := smokeReport{Version: options.Version, Executable: options.Executable}
	if options.CommandTimeout == 0 {
		options.CommandTimeout = smokeCommandTimeout
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
	if options.Moonshine {
		started = time.Now()
		detail, err := checkFrozenMoonshine(ctx, options, root)
		add("teleprompter:moonshine", started, err, detail)
	}
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

// moonshineCheckReport is what `manuscript-teleprompter --check-moonshine` prints (sidecars/manuscript-teleprompter/core/moonshine_engine.py).
type moonshineCheckReport struct {
	Type   string `json:"type"`
	Engine string `json:"engine"`
	OK     bool   `json:"ok"`
	Detail string `json:"detail"`
}

// checkFrozenMoonshine runs the frozen Teleprompter sidecar's own check that it can load Moonshine's native library (moonshine.dll and
// the onnxruntime.dll beside it, loaded with ctypes, so a freeze can lose them and still start). Its verdict and its exit code must agree.
func checkFrozenMoonshine(ctx context.Context, options smokeOptions, root string) (string, error) {
	executable := sidecarPath(root, "manuscript-teleprompter")
	if executable == "" {
		return "", errors.New("the manuscript-teleprompter sidecar is missing, so its Moonshine engine could not be checked")
	}
	code, stdout, stderr, err := runBounded(ctx, options, executable, "--check-moonshine")
	if err != nil {
		return "", fmt.Errorf("the Moonshine check did not run: %w", err)
	}
	var parsed moonshineCheckReport
	if jsonErr := json.Unmarshal([]byte(strings.TrimSpace(stdout)), &parsed); jsonErr != nil || parsed.Type != "engine_check" {
		return "", fmt.Errorf("the Moonshine check (exit code %d) printed no report: %s", code, firstLine(stderr+" "+stdout))
	}
	switch {
	case parsed.Engine != "moonshine":
		return "", fmt.Errorf("the Moonshine check reported on the %q engine instead", parsed.Engine)
	case !parsed.OK:
		return "", fmt.Errorf("the frozen teleprompter cannot run Moonshine: %s", parsed.Detail)
	case code != 0:
		return "", fmt.Errorf("the Moonshine check passed but exited with exit code %d: %s", code, firstLine(stderr))
	}
	return parsed.Detail, nil
}

// checkCatalogs loads the five approved asset catalogs the release carries (config/*-assets.json in the unpacked resources) and requires
// each to name at least one asset: an empty or unreadable catalog would leave the narrator nothing to download. The frozen sidecar's own
// Moonshine support is checked apart from its catalog, by checkFrozenMoonshine.
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
	counts := map[string]int{"voices": len(voices.Voices()), "Whisper models": len(models.Models()), "spaCy models": len(languageModels.Models()), "Moonshine models": len(liveModels.Models()),
		"dictionaries": len(dictionaries.Dictionaries())}
	for _, kind := range []string{"voices", "Whisper models", "spaCy models", "Moonshine models", "dictionaries"} {
		if counts[kind] == 0 {
			return "", fmt.Errorf("the catalog of %s names no assets", kind)
		}
	}
	return fmt.Sprintf("%d voice(s), %d Whisper model(s), %d spaCy model(s), %d Moonshine model(s), %d dictionary(ies)", counts["voices"], counts["Whisper models"], counts["spaCy models"],
		counts["Moonshine models"], counts["dictionaries"]), nil
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
