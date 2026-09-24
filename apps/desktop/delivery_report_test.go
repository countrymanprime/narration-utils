package main

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/deliveryreport"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

// The report export (diagnostics PRD Phase 7) and the host's judgement of a measurement against the narrator's limits,
// which the Delivery page shows and the report carries with the same IDs.

func saveDeliveryLimits(t *testing.T, store *settings.Store, values map[string]string) {
	t.Helper()
	changes := map[string]*string{}
	for key, value := range values {
		changes[key] = &value
	}
	if err := store.Save(deliverySettingsTool, "project", changes); err != nil {
		t.Fatal(err)
	}
}

func TestTheHostJudgesAMeasurementAgainstTheLimitsInForceWhenItIsRead(t *testing.T) {
	project := t.TempDir()
	host := &Host{settings: settings.New(t.TempDir(), project)}
	job := contractMeasureJob()
	job.complete(0, contractMeasured(contractMeasurePaths[0]), nil)
	job.complete(1, contractUnavailable(contractMeasurePaths[1]), nil)
	job.complete(2, measure.FileMeasurement{}, errors.New("not a RIFF/WAVE file"))
	job.finish(false, nil)

	unjudged := host.judgeMeasure(job.snapshot())
	for _, file := range unjudged.Files {
		if file.Findings == nil || len(file.Findings) != 0 {
			t.Fatalf("with no limits set, %s has findings %v, want an empty list", file.Name, file.Findings)
		}
	}

	saveDeliveryLimits(t, host.settings, map[string]string{"true_peak_dbtp_max": "-3.5", "integrated_lufs_min": "-19"})
	judged := host.judgeMeasure(job.snapshot())
	first := judged.Files[0].Findings
	want := measure.Evaluate(*judged.Files[0].Report, mustProfile(t, host.settings))
	if len(first) != 2 || first[0].ID != want[0].ID || first[1].ID != want[1].ID {
		t.Fatalf("Chapter 01 findings = %+v, want Evaluate's %+v", first, want)
	}
	if got := len(judged.Files[1].Findings); got != 2 {
		t.Fatalf("the silent render raises %d findings, want 2 not-measurable ones", got)
	}
	if len(judged.Files[2].Findings) != 0 {
		t.Fatal("a file that could not be measured is not judged")
	}

	saveDeliveryLimits(t, host.settings, map[string]string{"true_peak_dbtp_max": ""})
	if got := len(host.judgeMeasure(job.snapshot()).Files[0].Findings); got != 1 {
		t.Fatalf("after clearing a limit, Chapter 01 has %d findings, want 1: a limit changed in Settings re-judges", got)
	}
}

func mustProfile(t *testing.T, store *settings.Store) measure.Profile {
	t.Helper()
	profile, problem := deliveryProfile(store)
	if problem != "" {
		t.Fatal(problem)
	}
	return profile
}

func TestUnreadableLimitsJudgeNothingAndSayWhy(t *testing.T) {
	store := settings.New(t.TempDir(), t.TempDir())
	report := contractMeasured("a.wav").Report
	job := judgeMeasureJob(MeasureJob{Files: []MeasureFileResult{{Status: measureFileMeasured, Report: &report}}},
		measure.Profile{}, "delivery limit true_peak_dbtp_max is \"loud\", which is not a finite number")
	if job.LimitsError == "" || len(job.Files[0].Findings) != 0 {
		t.Fatalf("job = %+v", job)
	}
	if profile, problem := deliveryProfile(store); problem != "" || profile.HasLimits() || profile.Name != deliveryreport.ProfileName {
		t.Fatalf("empty settings = %+v, %q; want a named profile with no limits", profile, problem)
	}
}

// exportHost is a project with the three contract files measured (their paths real files in a temp folder, so the test
// can prove they are not touched) and, when checked is set, the same files checked for diagnostics.
func exportHost(t *testing.T, checked bool) (*Host, string, []string) {
	t.Helper()
	project := t.TempDir()
	renders := filepath.Join(t.TempDir(), "OutgoingAudio")
	if err := os.MkdirAll(renders, 0o755); err != nil {
		t.Fatal(err)
	}
	paths := []string{}
	for _, name := range []string{"Chapter 01.wav", "Chapter 02.wav", "Chapter 03.mp3"} {
		path := filepath.Join(renders, name)
		if err := os.WriteFile(path, []byte("audio of "+name), 0o644); err != nil {
			t.Fatal(err)
		}
		paths = append(paths, path)
	}
	host := &Host{config: config{projectFolder: project}, settings: settings.New(t.TempDir(), project), findings: findings.NewStore(project), version: "0.9.0-test"}
	job := &measureJob{id: "measure-1", phase: "running", started: time.Now(), cancel: func() {}}
	for _, path := range paths {
		job.files = append(job.files, MeasureFileResult{Path: path, Name: filepath.Base(path), Status: measureFilePending})
		job.weights, job.totalWeight = append(job.weights, 1), job.totalWeight+1
	}
	job.complete(0, contractMeasured(paths[0]), nil)
	job.complete(1, contractUnavailable(paths[1]), nil)
	job.complete(2, measure.FileMeasurement{}, errors.New("open "+paths[2]+": not a RIFF/WAVE file"))
	job.finish(false, nil)
	host.measureJob = job
	if checked {
		diagnostics := contractDiagnosticsJob()
		for i, path := range paths {
			diagnostics.files[i].Path = path
		}
		diagnostics.complete(0, contractDiagnosed(paths[0]), nil)
		diagnostics.complete(1, contractQuiet(paths[1]), nil)
		diagnostics.complete(2, measure.Diagnostics{}, errors.New("not a RIFF/WAVE file"))
		diagnostics.finish(false, nil)
		host.diagnosticsJob = diagnostics
	}
	return host, project, paths
}

func hashes(t *testing.T, paths []string) []string {
	t.Helper()
	out := []string{}
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(data)
		out = append(out, string(sum[:]))
	}
	return out
}

func readReport(t *testing.T, project string, export DeliveryReportExport) (map[string]any, string) {
	t.Helper()
	folder := filepath.Join(project, filepath.FromSlash(export.Folder))
	encoded, err := os.ReadFile(filepath.Join(folder, export.JSONFile))
	if err != nil {
		t.Fatal(err)
	}
	page, err := os.ReadFile(filepath.Join(folder, export.HTMLFile))
	if err != nil {
		t.Fatal(err)
	}
	var report map[string]any
	if err := json.Unmarshal(encoded, &report); err != nil {
		t.Fatal(err)
	}
	return report, string(encoded) + string(page)
}

var driveOrUNCPath = regexp.MustCompile(`(?i)\b[a-z]:[\\/]|\\\\\\\\|OutgoingAudio`)

func TestAnExportWritesBothFilesInTheSidecarFolderWithoutPathsAndLeavesTheAudioAlone(t *testing.T) {
	host, project, paths := exportHost(t, true)
	saveDeliveryLimits(t, host.settings, map[string]string{"true_peak_dbtp_max": "-3.5"})
	before := hashes(t, paths)

	export, err := host.exportDeliveryReport(false)
	if err != nil {
		t.Fatal(err)
	}
	if export.Folder != "narration-utils/delivery" || !strings.HasPrefix(export.HTMLFile, "delivery-report-") || strings.TrimSuffix(export.HTMLFile, ".html") != strings.TrimSuffix(export.JSONFile, ".json") {
		t.Fatalf("export = %+v", export)
	}
	if export.Files != 3 || export.PathsIncluded || export.Findings == 0 || export.OpenFindings != export.Findings {
		t.Fatalf("export = %+v", export)
	}
	report, text := readReport(t, project, export)
	if found := driveOrUNCPath.FindString(text); found != "" {
		t.Fatalf("the redacted report holds %q", found)
	}
	if report["generated_at"] == "" || report["app"].(map[string]any)["version"] != "0.9.0-test" {
		t.Fatalf("report header = %v, %v", report["generated_at"], report["app"])
	}
	if strings.Join(hashes(t, paths), "") != strings.Join(before, "") {
		t.Fatal("exporting changed an audio file")
	}
	entries, err := os.ReadDir(filepath.Dir(paths[0]))
	if err != nil || len(entries) != len(paths) {
		t.Fatalf("the audio folder holds %d entries, want only the %d files (nothing written next to the audio)", len(entries), len(paths))
	}

	again, err := host.exportDeliveryReport(true)
	if err != nil {
		t.Fatal(err)
	}
	if again.HTMLFile == export.HTMLFile {
		t.Fatal("a second export overwrote the first")
	}
	if _, text := readReport(t, project, again); !strings.Contains(text, filepath.ToSlash(paths[0])) && !strings.Contains(text, strings.ReplaceAll(paths[0], `\`, `\\`)) {
		t.Fatal("the report with paths included does not hold the first file's path")
	}
}

func TestTheReportCarriesTheSameIDsAsThePageAndTheStoresReviewDecision(t *testing.T) {
	host, project, _ := exportHost(t, false)
	saveDeliveryLimits(t, host.settings, map[string]string{"true_peak_dbtp_max": "-3.5"})
	onPage := host.judgeMeasure(host.measureState()).Files[0].Findings
	if len(onPage) != 1 {
		t.Fatalf("the page is shown %d findings for Chapter 01, want 1", len(onPage))
	}
	id := onPage[0].ID
	if _, err := host.findings.SaveAnalyzerFindings("measure", "delivery", onPage); err != nil {
		t.Fatal(err)
	}
	if _, _, err := host.findings.RecordDecision(id, "", findings.StatusDismissed, "mastered on purpose", "2026-09-23T15:00:00Z"); err != nil {
		t.Fatal(err)
	}
	export, err := host.exportDeliveryReport(false)
	if err != nil {
		t.Fatal(err)
	}
	report, _ := readReport(t, project, export)
	var carried map[string]any
	for _, f := range report["findings"].([]any) {
		if f.(map[string]any)["id"] == id {
			carried = f.(map[string]any)
		}
	}
	if carried == nil {
		t.Fatalf("the report does not carry the page's finding %s", id)
	}
	if review := carried["review"].(map[string]any); review["status"] != "dismissed" || carried["open"] != false {
		t.Fatalf("finding = %v, want the store's dismissal", carried)
	}
	if diagnostics := report["diagnostics"].(map[string]any); diagnostics["run"] != false {
		t.Fatalf("with no check, diagnostics = %v", diagnostics)
	}
}

func TestAnExportIsRefusedWithoutAProjectWhileAJobRunsOrWithNothingMeasured(t *testing.T) {
	if _, err := (&Host{}).exportDeliveryReport(false); err == nil || !strings.Contains(err.Error(), "open a project first") {
		t.Fatalf("without a project: %v", err)
	}
	project := t.TempDir()
	empty := &Host{config: config{projectFolder: project}, findings: findings.NewStore(project)}
	if _, err := empty.exportDeliveryReport(false); err == nil || !strings.Contains(err.Error(), "nothing has been measured or checked") {
		t.Fatalf("with nothing measured: %v", err)
	}
	host, project, _ := exportHost(t, false)
	host.measureJob.phase = "running"
	if _, err := host.exportDeliveryReport(false); err == nil || !strings.Contains(err.Error(), "wait for the measurement") {
		t.Fatalf("while measuring: %v", err)
	}
	if _, err := os.Stat(filepath.Join(project, filepath.FromSlash(deliveryreport.Dir))); !os.IsNotExist(err) {
		t.Fatal("a refused export wrote something")
	}
}

func TestFreeReportStemAddsANumberWhenASecondsReportExists(t *testing.T) {
	folder := t.TempDir()
	stem, err := freeReportStem(folder, "2026-09-23T14:00:00Z")
	if err != nil || stem != "delivery-report-20260923-140000Z" {
		t.Fatalf("stem = %q, %v", stem, err)
	}
	if err := os.WriteFile(filepath.Join(folder, stem+".html"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if next, _ := freeReportStem(folder, "2026-09-23T14:00:00Z"); next != stem+"-2" {
		t.Fatalf("next = %q", next)
	}
}

func TestContractDeliveryReportExport(t *testing.T) {
	contractfile.Check(t, "delivery-report-export", DeliveryReportExport{
		Folder: deliveryreport.Dir, HTMLFile: "delivery-report-20260923-140000Z.html", JSONFile: "delivery-report-20260923-140000Z.json",
		Files: 3, Findings: 4, OpenFindings: 3, PathsIncluded: false,
	})
}
