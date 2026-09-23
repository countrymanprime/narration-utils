package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/layout"
	"github.com/countrymanprime/narration-utils/shell/internal/process"
)

// A smoke test that cannot fail proves nothing, so most of these tests break one thing in an otherwise healthy resource tree and require
// the smoke test to name it. The tree is an in-memory copy of what the release embeds; the sidecars are not run (a fake answers) except in
// the last test, which starts a real program.

const healthySelfCheck = `{"ok": true, "checks": [{"name": "cmudict", "ok": true, "detail": "hello = HH AH0 L OW1"}, {"name": "espeak", "ok": true, "detail": "hello = həlˈoʊ"}]}`

const healthyMoonshineCheck = `{"type": "engine_check", "engine": "moonshine", "ok": true, "detail": "moonshine-voice 0.1.5: native library loaded, 10 language(s)"}`

func sidecarFile(name string) string {
	if os.PathSeparator == '\\' {
		return name + ".exe"
	}
	return name
}

// healthyTree is what a good build embeds: the three sidecars, the four approved catalogs and the REAPER scripts.
func healthyTree(t *testing.T) fstest.MapFS {
	t.Helper()
	tree := fstest.MapFS{}
	for _, name := range smokeSidecars {
		tree[resourcesRoot+"/runtime/"+name+"/"+sidecarFile(name)] = &fstest.MapFile{Data: []byte("frozen " + name)}
	}
	for _, catalog := range []string{"tts-assets.json", "whisper-assets.json", "spacy-assets.json", "moonshine-assets.json"} {
		body, err := os.ReadFile(layout.RepoFile("config/" + catalog))
		if err != nil {
			t.Fatal(err)
		}
		tree[resourcesRoot+"/config/"+catalog] = &fstest.MapFile{Data: body}
	}
	for _, name := range smokeReaperFiles {
		tree[resourcesRoot+"/reaper/"+name] = &fstest.MapFile{Data: []byte("-- " + name)}
	}
	return tree
}

// fakeRun answers like healthy frozen sidecars, and records what it was asked to start.
type fakeRun struct {
	calls     [][]string
	failHelp  map[string]int    // sidecar name -> exit code of --help
	selfCheck string            // what `self-check` prints; healthySelfCheck when empty
	selfExit  int               // its exit code
	errFor    map[string]error  // sidecar name -> the error starting it
	stderrFor map[string]string // sidecar name -> what it says on stderr
	moonshine string            // what `--check-moonshine` prints; healthyMoonshineCheck when empty
	moonExit  int               // its exit code
}

func (f *fakeRun) run(_ context.Context, program string, args ...string) (int, string, string, error) {
	f.calls = append(f.calls, append([]string{program}, args...))
	name := strings.TrimSuffix(filepath.Base(program), ".exe")
	if err := f.errFor[name]; err != nil {
		return 0, "", "", err
	}
	if len(args) > 0 && args[0] == "self-check" {
		out := f.selfCheck
		if out == "" {
			out = healthySelfCheck
		}
		return f.selfExit, out, "", nil
	}
	if len(args) > 0 && args[0] == "--check-moonshine" {
		out := f.moonshine
		if out == "" {
			out = healthyMoonshineCheck
		}
		return f.moonExit, out, f.stderrFor[name], nil
	}
	return f.failHelp[name], "usage: " + name, f.stderrFor[name], nil
}

func smokeOptionsFor(t *testing.T, tree fstest.MapFS, run *fakeRun) smokeOptions {
	t.Helper()
	return smokeOptions{Resources: tree, UserCache: t.TempDir(), Executable: filepath.Join(t.TempDir(), "narration-utils.exe"), Version: "9.9.9", Moonshine: true, Run: run.run}
}

func failedChecks(report smokeReport) map[string]string {
	failed := map[string]string{}
	for _, check := range report.Checks {
		if !check.OK {
			failed[check.Name] = check.Detail
		}
	}
	return failed
}

func TestSmokePassesOnAHealthyPackage(t *testing.T) {
	run := &fakeRun{}
	report := smoke(context.Background(), smokeOptionsFor(t, healthyTree(t), run))
	if !report.OK || len(failedChecks(report)) != 0 {
		t.Fatalf("a healthy package failed: %+v", report)
	}
	var names []string
	for _, check := range report.Checks {
		names = append(names, check.Name)
	}
	for _, want := range []string{"resources", "asset-cache", "sidecar:manuscript-guide", "sidecar:transcript-compare", "sidecar:manuscript-teleprompter", "guide:cmudict", "guide:espeak", "teleprompter:moonshine", "catalogs", "reaper"} {
		if !slices.Contains(names, want) {
			t.Errorf("the report has no %q check: %v", want, names)
		}
	}
	if report.Version != "9.9.9" || report.ResourceRoot == "" {
		t.Errorf("the report lacks the version or the resource root: %+v", report)
	}
}

func TestSmokeFailsWhenABundledSidecarIsMissing(t *testing.T) {
	// The deliberately broken resource of the phase's success signal: a sidecar removed from the tree.
	for _, missing := range smokeSidecars {
		t.Run(missing, func(t *testing.T) {
			tree := healthyTree(t)
			delete(tree, resourcesRoot+"/runtime/"+missing+"/"+sidecarFile(missing))
			report := smoke(context.Background(), smokeOptionsFor(t, tree, &fakeRun{}))
			failed := failedChecks(report)
			if report.OK || !strings.Contains(failed["sidecar:"+missing], "missing") {
				t.Fatalf("a package without %s passed or did not say so: ok=%v failed=%v", missing, report.OK, failed)
			}
			// The guide and the teleprompter each have a second check that runs them, which fails with them; nothing else may fail.
			dependent := map[string]string{"manuscript-guide": "guide:self-check", "manuscript-teleprompter": "teleprompter:moonshine"}[missing]
			if _, ok := failed[dependent]; ok {
				delete(failed, dependent)
			} else if dependent != "" {
				t.Errorf("the check that runs %s (%s) did not fail with it: %v", missing, dependent, failed)
			}
			if len(failed) != 1 {
				t.Errorf("only the missing sidecar should fail, got %v", failed)
			}
		})
	}
}

func TestSmokeFailsWhenASidecarDoesNotStart(t *testing.T) {
	for name, run := range map[string]*fakeRun{
		"exits non-zero": {failHelp: map[string]int{"transcript-compare": 3}, stderrFor: map[string]string{"transcript-compare": "ModuleNotFoundError: faster_whisper"}},
		"cannot start":   {errFor: map[string]error{"transcript-compare": errors.New("could not start: access denied")}},
	} {
		t.Run(name, func(t *testing.T) {
			report := smoke(context.Background(), smokeOptionsFor(t, healthyTree(t), run))
			detail := failedChecks(report)["sidecar:transcript-compare"]
			if report.OK || detail == "" {
				t.Fatalf("a sidecar that does not start passed: %+v", report.Checks)
			}
			if name == "exits non-zero" && !strings.Contains(detail, "ModuleNotFoundError") {
				t.Errorf("the detail %q should carry what the sidecar said", detail)
			}
		})
	}
}

func TestSmokeFailsWhenTheFrozenGuideCannotLoadItsDictionaryOrEspeakData(t *testing.T) {
	broken := `{"ok": false, "checks": [{"name": "cmudict", "ok": false, "detail": "No package metadata was found for cmudict"}, {"name": "espeak", "ok": false, "detail": "the espeak-ng data directory was not found: piper/espeak-ng-data"}]}`
	report := smoke(context.Background(), smokeOptionsFor(t, healthyTree(t), &fakeRun{selfCheck: broken, selfExit: 1}))
	failed := failedChecks(report)
	if report.OK || !strings.Contains(failed["guide:cmudict"], "cmudict") || !strings.Contains(failed["guide:espeak"], "espeak-ng-data") {
		t.Fatalf("the frozen guide's failed checks were not reported: ok=%v failed=%v", report.OK, failed)
	}
}

func TestSmokeFailsWhenTheGuideSelfCheckPrintsNothingUseful(t *testing.T) {
	for name, run := range map[string]*fakeRun{
		"crashed with no report": {selfCheck: "Traceback (most recent call last)", selfExit: 1},
		"unknown command":        {selfCheck: "", selfExit: 2},
	} {
		t.Run(name, func(t *testing.T) {
			run.selfCheck = strings.TrimSpace(run.selfCheck)
			if run.selfCheck == "" {
				run.selfCheck = "usage: manuscript-guide.exe: error: invalid choice: 'self-check'"
			}
			report := smoke(context.Background(), smokeOptionsFor(t, healthyTree(t), run))
			if report.OK || failedChecks(report)["guide:self-check"] == "" {
				t.Fatalf("a self-check with no report passed: %+v", report.Checks)
			}
		})
	}
}

func TestSmokePassesAVoiceToTheGuideSoARealWordIsSpoken(t *testing.T) {
	run := &fakeRun{}
	options := smokeOptionsFor(t, healthyTree(t), run)
	options.PiperModel = filepath.Join(t.TempDir(), "voice.onnx")
	smoke(context.Background(), options)
	var selfCheck []string
	for _, call := range run.calls {
		if slices.Contains(call, "self-check") {
			selfCheck = call
		}
	}
	if !slices.Contains(selfCheck, "--piper-model") || !slices.Contains(selfCheck, options.PiperModel) {
		t.Fatalf("the guide self-check was started as %v, want it to be given the voice", selfCheck)
	}
}

func TestSmokeWithoutAVoiceNeverNeedsOne(t *testing.T) {
	run := &fakeRun{}
	smoke(context.Background(), smokeOptionsFor(t, healthyTree(t), run))
	for _, call := range run.calls {
		if slices.Contains(call, "--piper-model") {
			t.Fatalf("a run with no voice still asked for one: %v", call)
		}
	}
}

func TestSmokeProvesTheFrozenTeleprompterCanRunMoonshine(t *testing.T) {
	run := &fakeRun{}
	report := smoke(context.Background(), smokeOptionsFor(t, healthyTree(t), run))
	if !report.OK {
		t.Fatalf("a healthy Moonshine check failed: %+v", report.Checks)
	}
	asked := false
	for _, call := range run.calls {
		asked = asked || (strings.Contains(filepath.Base(call[0]), "manuscript-teleprompter") && slices.Contains(call, "--check-moonshine"))
	}
	if !asked {
		t.Fatalf("the frozen teleprompter was never asked to check Moonshine: %v", run.calls)
	}
}

func TestSmokeFailsWhenTheFrozenTeleprompterCannotRunMoonshine(t *testing.T) {
	lostDLL := `{"type": "engine_check", "engine": "moonshine", "ok": false, "detail": "MoonshineError: Failed to load Moonshine library from moonshine.dll"}`
	for name, tc := range map[string]struct {
		run    *fakeRun
		detail string
	}{
		"the native library is not in the freeze": {&fakeRun{moonshine: lostDLL, moonExit: 1}, "moonshine.dll"},
		"an older sidecar without the flag": {
			&fakeRun{moonshine: " ", moonExit: 2, stderrFor: map[string]string{"manuscript-teleprompter": "error: unrecognized arguments: --check-moonshine"}},
			"unrecognized arguments",
		},
		"an exit code the verdict does not explain": {&fakeRun{moonExit: 1}, "exit code 1"},
		"a verdict for another engine":              {&fakeRun{moonshine: `{"type": "engine_check", "engine": "whisper", "ok": true, "detail": "x"}`}, "whisper"},
	} {
		t.Run(name, func(t *testing.T) {
			report := smoke(context.Background(), smokeOptionsFor(t, healthyTree(t), tc.run))
			detail := failedChecks(report)["teleprompter:moonshine"]
			if report.OK || !strings.Contains(detail, tc.detail) {
				t.Fatalf("the smoke test passed or did not say why (want %q): ok=%v detail=%q", tc.detail, report.OK, detail)
			}
		})
	}
}

func TestSmokeLeavesMoonshineAloneWhereThePlatformHasNoWheel(t *testing.T) {
	run := &fakeRun{moonshine: "not json", moonExit: 1}
	options := smokeOptionsFor(t, healthyTree(t), run)
	options.Moonshine = false
	report := smoke(context.Background(), options)
	if !report.OK {
		t.Fatalf("a platform without Moonshine failed its smoke test: %+v", report.Checks)
	}
	for _, call := range run.calls {
		if slices.Contains(call, "--check-moonshine") {
			t.Fatalf("Moonshine was checked where it is not shipped: %v", call)
		}
	}
}

func TestSmokeFailsWhenACatalogIsMissingOrEmpty(t *testing.T) {
	for name, mutate := range map[string]func(fstest.MapFS){
		"missing": func(tree fstest.MapFS) { delete(tree, resourcesRoot+"/config/spacy-assets.json") },
		"empty": func(tree fstest.MapFS) {
			tree[resourcesRoot+"/config/tts-assets.json"] = &fstest.MapFile{Data: []byte(`{"catalogVersion":1,"voices":[]}`)}
		},
		"broken": func(tree fstest.MapFS) {
			tree[resourcesRoot+"/config/whisper-assets.json"] = &fstest.MapFile{Data: []byte(`{not json`)}
		},
	} {
		t.Run(name, func(t *testing.T) {
			tree := healthyTree(t)
			mutate(tree)
			report := smoke(context.Background(), smokeOptionsFor(t, tree, &fakeRun{}))
			if report.OK || failedChecks(report)["catalogs"] == "" {
				t.Fatalf("a package with a %s catalog passed: %+v", name, report.Checks)
			}
		})
	}
}

func TestSmokeFailsWhenAReaperScriptIsMissing(t *testing.T) {
	tree := healthyTree(t)
	delete(tree, resourcesRoot+"/reaper/NarrationUtils_Launcher.lua")
	report := smoke(context.Background(), smokeOptionsFor(t, tree, &fakeRun{}))
	if detail := failedChecks(report)["reaper"]; report.OK || !strings.Contains(detail, "NarrationUtils_Launcher.lua") {
		t.Fatalf("a package without the launcher passed or did not name it: ok=%v %q", report.OK, detail)
	}
}

func TestSmokeFailsWhenTheAssetCacheCannotBeWritten(t *testing.T) {
	// A regular file where the cache folder must go: neither the resources nor the asset cache can be created under it.
	blocker := filepath.Join(t.TempDir(), "not-a-folder")
	if err := os.WriteFile(blocker, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	options := smokeOptionsFor(t, healthyTree(t), &fakeRun{})
	options.UserCache = blocker
	report := smoke(context.Background(), options)
	if report.OK || len(report.Checks) == 0 || report.Checks[0].OK {
		t.Fatalf("an unwritable cache passed: %+v", report.Checks)
	}
	// The cache is also checked on its own, with a healthy resource unpack, so a good unpack cannot hide an unwritable asset folder.
	base := t.TempDir()
	if err := os.MkdirAll(filepath.Join(base, "narration-utils"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(base, "narration-utils", "assets"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	options.UserCache = base
	if detail := failedChecks(smoke(context.Background(), options))["asset-cache"]; detail == "" {
		t.Fatal("an asset cache folder that is a file passed")
	}
}

func TestSmokeLeavesTheLauncherPointingAtTheProgramThatRan(t *testing.T) {
	options := smokeOptionsFor(t, healthyTree(t), &fakeRun{})
	report := smoke(context.Background(), options)
	if !report.OK {
		t.Fatalf("setup: %+v", report.Checks)
	}
	// Someone else's pointer in the (content-addressed, already complete) folder: the next start refreshes it, and the smoke test looks
	// at what the launcher would read after that. The pointer is rewritten at every start, so it must name this program.
	pointer := filepath.Join(report.ResourceRoot, "reaper", "narration-utils-app-path.txt")
	body, err := os.ReadFile(pointer)
	if err != nil || strings.TrimSpace(string(body)) != options.Executable {
		t.Fatalf("the launcher pointer is %q (%v), want %q", body, err, options.Executable)
	}
}

func TestSmokeStopsAtAHungSidecarAfterTheCommandTimeoutInsteadOfHangingTheBuild(t *testing.T) {
	// The fake blocks until the context it is given is over; only the timeout the smoke test sets can end it.
	hung := func(ctx context.Context, _ string, _ ...string) (int, string, string, error) {
		<-ctx.Done()
		return 0, "", "", nil
	}
	options := smokeOptionsFor(t, healthyTree(t), &fakeRun{})
	options.Run = hung
	options.CommandTimeout = 20 * time.Millisecond
	started := time.Now()
	report := smoke(context.Background(), options)
	if report.OK {
		t.Fatalf("sidecars that never answered passed: %+v", report.Checks)
	}
	if detail := failedChecks(report)["sidecar:manuscript-guide"]; !strings.Contains(detail, "did not finish within 20ms") {
		t.Fatalf("the failure %q does not say it timed out", detail)
	}
	if took := time.Since(started); took > 10*time.Second {
		t.Fatalf("the smoke test took %s to give up on hung sidecars", took)
	}
}

func TestSmokeStopsWhenItsOwnContextIsOver(t *testing.T) {
	hung := func(ctx context.Context, _ string, _ ...string) (int, string, string, error) {
		<-ctx.Done()
		return 0, "", "", nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	options := smokeOptionsFor(t, healthyTree(t), &fakeRun{})
	options.Run = hung
	if report := smoke(ctx, options); report.OK {
		t.Fatalf("sidecars that were stopped passed: %+v", report.Checks)
	}
}

func TestSmokeHoldsTheGuideSelfCheckToItsExitCodeAndToEveryCheckItMustMake(t *testing.T) {
	onlyCmudict := `{"ok": true, "checks": [{"name": "cmudict", "ok": true, "detail": "hello"}]}`
	allOKButExitOne := healthySelfCheck
	okFalseNoFailingCheck := `{"ok": false, "checks": [{"name": "cmudict", "ok": true, "detail": "a"}, {"name": "espeak", "ok": true, "detail": "b"}]}`
	for name, tc := range map[string]struct {
		run    *fakeRun
		failed string
	}{
		"a check the sidecar stopped making": {&fakeRun{selfCheck: onlyCmudict}, "guide:espeak"},
		"an exit code no check explains":     {&fakeRun{selfCheck: allOKButExitOne, selfExit: 1}, "guide:self-check"},
		"a verdict no check explains":        {&fakeRun{selfCheck: okFalseNoFailingCheck}, "guide:self-check"},
	} {
		t.Run(name, func(t *testing.T) {
			report := smoke(context.Background(), smokeOptionsFor(t, healthyTree(t), tc.run))
			if report.OK || failedChecks(report)[tc.failed] == "" {
				t.Fatalf("the smoke test passed or did not fail %s: %+v", tc.failed, report.Checks)
			}
		})
	}
	// With a voice the synthesis check is required too.
	options := smokeOptionsFor(t, healthyTree(t), &fakeRun{})
	options.PiperModel = filepath.Join(t.TempDir(), "voice.onnx")
	if report := smoke(context.Background(), options); report.OK || failedChecks(report)["guide:synthesis"] == "" {
		t.Fatalf("a self-check that never spoke passed although a voice was given: %+v", report.Checks)
	}
}

func TestSmokeReportSaysWhyWhenTheResourcesCannotBeUnpacked(t *testing.T) {
	report := smoke(context.Background(), smokeOptionsFor(t, fstest.MapFS{}, &fakeRun{}))
	if report.OK || len(report.Checks) != 1 || report.Checks[0].Name != "resources" || report.Checks[0].OK {
		t.Fatalf("an empty package: %+v", report.Checks)
	}
}

func TestTheReaperFileListIsEveryTopLevelLuaScriptOfTheIntegration(t *testing.T) {
	entries, err := os.ReadDir(layout.RepoFile(layout.ReaperDir))
	if err != nil {
		t.Fatal(err)
	}
	var onDisk []string
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".lua") {
			onDisk = append(onDisk, entry.Name())
		}
	}
	listed := slices.Clone(smokeReaperFiles)
	slices.Sort(onDisk)
	slices.Sort(listed)
	if !slices.Equal(onDisk, listed) {
		t.Fatalf("smokeReaperFiles %v is not the Lua files of integrations/reaper %v", listed, onDisk)
	}
	// The build-time check has the same list; the two must not drift.
	script, err := os.ReadFile(layout.RepoFile("scripts/release/reaper-files.mjs"))
	if err != nil {
		t.Fatal(err)
	}
	var buildTime []string
	for _, match := range regexp.MustCompile(`'([^']+\.lua)'`).FindAllStringSubmatch(string(script), -1) {
		buildTime = append(buildTime, match[1])
	}
	slices.Sort(buildTime)
	if !slices.Equal(buildTime, listed) {
		t.Fatalf("scripts/release/reaper-files.mjs %v differs from smokeReaperFiles %v", buildTime, listed)
	}
}

func TestSmokeIsOnlyARequestWhenItIsTheFirstArgument(t *testing.T) {
	for arguments, want := range map[string]bool{"--smoke": true, "--smoke --report x.json": true, "": false, "--version": false, "--repo-root --smoke": false} {
		if got := isSmokeRequest(strings.Fields(arguments)); got != want {
			t.Errorf("isSmokeRequest(%q) = %v, want %v", arguments, got, want)
		}
	}
}

func TestSmokeCommandLine(t *testing.T) {
	parsed, err := parseSmokeArguments([]string{"--smoke", "--piper-model", "v.onnx", "--report", "r.json"})
	if err != nil || parsed.piperModel != "v.onnx" || parsed.reportPath != "r.json" {
		t.Fatalf("parsed %+v, %v", parsed, err)
	}
	for _, bad := range [][]string{{"--smoke", "--nope"}, {"--smoke", "--report"}, {"--smoke", "--report", ""}, {"--smoke", "extra"}} {
		if _, err := parseSmokeArguments(bad); err == nil {
			t.Errorf("%v was accepted", bad)
		}
	}
}

func TestSmokeExitCodesAndReportOutput(t *testing.T) {
	report := smoke(context.Background(), smokeOptionsFor(t, healthyTree(t), &fakeRun{}))
	reportFile := filepath.Join(t.TempDir(), "smoke.json")
	var stdout, stderr bytes.Buffer
	if code := writeSmokeReport(report, reportFile, &stdout, &stderr); code != 0 {
		t.Fatalf("a healthy report exited %d: %s", code, stderr.String())
	}
	var printed, written smokeReport
	if err := json.Unmarshal(stdout.Bytes(), &printed); err != nil || !printed.OK {
		t.Fatalf("stdout is not the report: %v %s", err, stdout.String())
	}
	if body, err := os.ReadFile(reportFile); err != nil || json.Unmarshal(body, &written) != nil || !written.OK {
		t.Fatalf("the --report file is not the report: %v %s", err, body)
	}

	tree := healthyTree(t)
	delete(tree, resourcesRoot+"/runtime/transcript-compare/"+sidecarFile("transcript-compare"))
	broken := smoke(context.Background(), smokeOptionsFor(t, tree, &fakeRun{}))
	stdout.Reset()
	stderr.Reset()
	if code := writeSmokeReport(broken, "", &stdout, &stderr); code != 1 {
		t.Fatalf("a broken package exited %d, want 1", code)
	}
	if !strings.Contains(stderr.String(), "FAILED sidecar:transcript-compare") {
		t.Fatalf("stderr %q does not name the failed check", stderr.String())
	}
	if code := writeSmokeReport(report, filepath.Join(t.TempDir(), "no", "such", "dir", "r.json"), &stdout, &stderr); code != 1 {
		t.Fatalf("an unwritable --report exited %d, want 1", code)
	}
}

func TestRunSmokeRefusesABadCommandLineWithExitCodeTwo(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := runSmoke(context.Background(), []string{"--smoke", "--bogus"}, fstest.MapFS{}, &stdout, &stderr); code != 2 {
		t.Fatalf("exit code %d, want 2 (stderr %q)", code, stderr.String())
	}
	if stdout.Len() != 0 {
		t.Fatalf("a bad command line printed a report: %q", stdout.String())
	}
}

// The real supervisor starts real programs: the test binary stands in for a frozen sidecar. This is the one test that runs a process.
func TestSmokeStartsRealProgramsAndReadsTheirExitCodes(t *testing.T) {
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	supervisor := process.NewSupervisor()
	t.Cleanup(func() { _ = supervisor.Close() })
	code, _, _, err := runBounded(context.Background(), smokeOptions{Run: supervisor.Run, CommandTimeout: time.Minute}, self, "-test.run=^$")
	if err != nil || code != 0 {
		t.Fatalf("the test binary exited %d (%v) on a run that matches no test", code, err)
	}
	code, _, stderr, err := runBounded(context.Background(), smokeOptions{Run: supervisor.Run, CommandTimeout: time.Minute}, self, "-test.no-such-flag")
	if err != nil || code == 0 {
		t.Fatalf("a program that fails to start its work exited %d (%v): %q", code, err, stderr)
	}
	if _, _, _, err := runBounded(context.Background(), smokeOptions{Run: supervisor.Run, CommandTimeout: time.Minute}, filepath.Join(t.TempDir(), "absent.exe")); err == nil {
		t.Fatal("a program that is not there did not error")
	}
}

func TestTheEarlyModesRunBeforeAnythingThatOpensAWindow(t *testing.T) {
	var stdout, stderr bytes.Buffer
	// --smoke with a bad command line is refused by the early mode itself: exit code 2, and nothing (update relaunch, window) started.
	code, handled := runEarlyModes([]string{"--smoke", "--bogus"}, fstest.MapFS{}, &stdout, &stderr)
	if !handled || code != 2 {
		t.Fatalf("--smoke --bogus: handled=%v code=%d", handled, code)
	}
	stdout.Reset()
	if code, handled := runEarlyModes([]string{"--version"}, fstest.MapFS{}, &stdout, &stderr); !handled || code != 0 || strings.TrimSpace(stdout.String()) != version {
		t.Fatalf("--version: handled=%v code=%d output %q", handled, code, stdout.String())
	}
	for _, ordinary := range [][]string{nil, {"--repo-root", "x"}, {"--project-folder", "p", "--smoke"}} {
		if _, handled := runEarlyModes(ordinary, fstest.MapFS{}, &stdout, &stderr); handled {
			t.Fatalf("%v was taken for an early mode: the window would never open", ordinary)
		}
	}
}
