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
	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
	"github.com/countrymanprime/narration-utils/shell/internal/deliveryreport"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
	projectmanifest "github.com/countrymanprime/narration-utils/shell/internal/project"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

// The report export (diagnostics PRD Phase 7) and the host's judgement of a measurement against the project's delivery
// profile (ADR 0179), which the Delivery page shows and the report carries with the same IDs.

// withProfileStore gives host a delivery-profile store in a temporary folder.
func withProfileStore(t *testing.T, host *Host) *Host {
	t.Helper()
	host.deliveryProfiles = deliveryprofile.NewStore(filepath.Join(t.TempDir(), deliveryprofile.FileName))
	return host
}

func finishedContractJob() *measureJob {
	job := contractMeasureJob()
	job.complete(0, contractMeasured(contractMeasurePaths[0]), nil)
	job.complete(1, contractUnavailable(contractMeasurePaths[1]), nil)
	job.complete(2, measure.FileMeasurement{}, errors.New("not a RIFF/WAVE file"))
	job.finish(false, nil)
	return job
}

func ruleStatus(file MeasureFileResult, id string) deliveryprofile.Status {
	for _, result := range file.Rules {
		if result.RuleID == id {
			return result.Status
		}
	}
	return ""
}

func TestTheHostJudgesAMeasurementAgainstTheProjectsProfileWhenItIsRead(t *testing.T) {
	project := t.TempDir()
	host := withProfileStore(t, &Host{config: config{projectFolder: project, projectName: "Alice"}, settings: settings.New(t.TempDir(), project)})
	job := finishedContractJob()

	judged := host.judgeMeasure(job.snapshot())
	if judged.Profile == nil || judged.Profile.Key() != "acx@2026-09" || judged.ProfileNotice != "" {
		t.Fatalf("a new project is judged against %v (%q), want ACX with no notice", judged.Profile, judged.ProfileNotice)
	}
	first := judged.Files[0]
	if ruleStatus(first, "acx.sample_rate") != deliveryprofile.StatusNotMet || ruleStatus(first, "acx.format") != deliveryprofile.StatusNotChecked {
		t.Fatalf("Chapter 01 rules = %+v, want the 48 kHz render not met and the MP3 not checked", first.Rules)
	}
	want := deliveryprofile.EvaluateFile(*first.Report, deliveryprofile.ACX()).Findings
	if len(first.Findings) != 1 || first.Findings[0].ID != want[0].ID {
		t.Fatalf("Chapter 01 findings = %+v, want EvaluateFile's %+v", first.Findings, want)
	}
	if got := len(judged.Files[1].Findings); got != 5 {
		t.Fatalf("the silent render raises %d findings, want 5 not-measurable ones (levels and room tone)", got)
	}
	if judged.Files[2].Findings == nil || len(judged.Files[2].Findings) != 0 || len(judged.Files[2].Rules) != 0 {
		t.Fatal("a file that could not be measured is not judged, and its lists are empty, not null")
	}
	if len(judged.BookRules) != 5 || judged.BookRules[0].RuleID != "acx.channels" {
		t.Fatalf("book rules = %+v", judged.BookRules)
	}

	copied, err := host.profileStore().Duplicate(deliveryprofile.Ref{ID: "acx"})
	if err != nil {
		t.Fatal(err)
	}
	copied.Rules[3].Off = true // sample rate
	if _, err := host.profileStore().Save(copied); err != nil {
		t.Fatal(err)
	}
	if _, err := host.selectDeliveryProfile("project", copied.ID, ""); err != nil {
		t.Fatal(err)
	}
	rejudged := host.judgeMeasure(job.snapshot())
	if rejudged.Profile.ID != copied.ID || len(rejudged.Files[0].Findings) != 0 || ruleStatus(rejudged.Files[0], "acx.sample_rate") != deliveryprofile.StatusOff {
		t.Fatalf("after choosing a copy with the sample rate off: %s, findings %+v", rejudged.Profile.Key(), rejudged.Files[0].Findings)
	}

	if err := host.profileStore().Delete(copied.ID); err != nil {
		t.Fatal(err)
	}
	fallen := host.judgeMeasure(job.snapshot())
	if fallen.Profile.Key() != "acx@2026-09" || !strings.Contains(fallen.ProfileNotice, "no longer there") {
		t.Fatalf("after deleting the chosen profile: %s, notice %q", fallen.Profile.Key(), fallen.ProfileNotice)
	}
}

func saveDeliveryLimits(t *testing.T, store *settings.Store, scope string, values map[string]string) {
	t.Helper()
	changes := map[string]*string{}
	for key, value := range values {
		changes[key] = &value
	}
	if err := store.Save(deliverySettingsTool, scope, changes); err != nil {
		t.Fatal(err)
	}
}

func TestOldLimitsMoveIntoProfilesSoAProjectJudgesTheSameValuesTheSameWay(t *testing.T) {
	cases := []struct {
		name         string
		global       map[string]string
		project      map[string]string
		wantProfile  string
		wantManifest bool
	}{
		{"no limits", nil, nil, "acx@", false},
		{"global only", map[string]string{"true_peak_dbtp_max": "-3.5"}, nil, "custom-", false},
		{"a project override", nil, map[string]string{"rms_dbfs_min": "-26"}, "custom-", true},
		{"a project set equal to ACX", nil, map[string]string{"rms_dbfs_min": "-23", "rms_dbfs_max": "-18", "sample_peak_dbfs_max": "-3", "noise_floor_dbfs_max": "-60"}, "acx@", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			project := t.TempDir()
			t.Setenv("APPDATA", t.TempDir())
			store := settings.New(t.TempDir(), project)
			if tc.global != nil {
				saveDeliveryLimits(t, store, "global", tc.global)
			}
			if tc.project != nil {
				saveDeliveryLimits(t, store, "project", tc.project)
			}
			host := withProfileStore(t, &Host{config: config{projectFolder: project, projectName: "Alice"}, settings: store})
			judged := host.judgeMeasure(finishedContractJob().snapshot())
			if !strings.HasPrefix(judged.Profile.Key(), tc.wantProfile) || judged.ProfileNotice != "" {
				t.Fatalf("judged against %s (%q), want %s", judged.Profile.Key(), judged.ProfileNotice, tc.wantProfile)
			}
			manifest, ok, _ := projectmanifest.Load(nil, project)
			if chosen := ok && manifest.DeliveryProfile != nil; chosen != tc.wantManifest {
				t.Fatalf("the manifest holds a choice: %v, want %v", chosen, tc.wantManifest)
			}
			again := host.judgeMeasure(finishedContractJob().snapshot())
			if again.Profile.Key() != judged.Profile.Key() {
				t.Fatalf("a second read judged against %s, the first %s", again.Profile.Key(), judged.Profile.Key())
			}
			if catalog, _ := host.profileStore().Catalog(); len(catalog.Profiles) > 2 {
				t.Fatalf("%d profiles after two reads, want the limits moved once", len(catalog.Profiles))
			}
		})
	}
}

func TestAHandEditedLimitIsReportedNotGuessedAt(t *testing.T) {
	project := t.TempDir()
	t.Setenv("APPDATA", t.TempDir())
	store := settings.New(t.TempDir(), project)
	if err := os.MkdirAll(filepath.Join(project, "narration-utils"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, "narration-utils", "settings.json"), []byte(`{"Delivery":{"rms_dbfs_min":"loud"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	host := withProfileStore(t, &Host{config: config{projectFolder: project}, settings: store})
	judged := host.judgeMeasure(finishedContractJob().snapshot())
	if judged.Profile.Key() != "acx@2026-09" || !strings.Contains(judged.ProfileNotice, "not a finite number") {
		t.Fatalf("judged against %s with notice %q, want ACX and the reason the limits were not moved", judged.Profile.Key(), judged.ProfileNotice)
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
	host := withProfileStore(t, &Host{config: config{projectFolder: project}, settings: settings.New(t.TempDir(), project), findings: findings.NewStore(project), version: "0.9.0-test"})
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
