package main

import (
	"context"
	"path/filepath"
	"sync"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

// Delivery findings on the Review page (delivery-platform-profiles.prd.md Phase 9, P12): each measurement saves the
// rules a file misses into the project's findings store, and a change of profile re-judges what was measured.

func fv(x float64) *float64 { return &x }

// reportsByPath is a fake measurement whose reports the test changes between runs, as a re-render would.
type reportsByPath struct {
	mu      sync.Mutex
	reports map[string]measure.Report
	prints  map[string]string
}

func (r *reportsByPath) set(path string, change func(*measure.Report), print string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	report := measure.Report{
		File: path, SampleRate: 44100, Channels: 1, DurationSeconds: 600,
		IntegratedLUFS: fv(-19), RMSdBFS: fv(-20), SamplePeakdBFS: fv(-4), TruePeakdBTP: fv(-4), NoiseFloordBFS: fv(-65),
		HeadRoomToneSeconds: fv(1), TailRoomToneSeconds: fv(3), HeadDigitalSilenceSeconds: fv(0), TailDigitalSilenceSeconds: fv(0),
	}
	if change != nil {
		change(&report)
	}
	r.reports[path], r.prints[path] = report, print
}

func (r *reportsByPath) measure(_ context.Context, path string, _ measure.Options) (measure.FileMeasurement, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return measure.FileMeasurement{Report: r.reports[path], Fingerprint: measure.Fingerprint{SHA256: r.prints[path]}}, nil
}

// deliveryFindingsHost is a project with a findings store, a profile store and two picked chapter files.
func deliveryFindingsHost(t *testing.T) (*Host, *reportsByPath, []string) {
	t.Helper()
	t.Setenv("APPDATA", t.TempDir())
	project := t.TempDir()
	paths := []string{filepath.Join(project, "Chapter 01.wav"), filepath.Join(project, "Chapter 02.wav")}
	for _, path := range paths {
		writeFile(t, path, string(silentWAV(8000)))
	}
	host, _ := measureHost(t, paths...)
	host.config.projectFolder, host.config.projectName = project, "Alice"
	host.settings = settings.New(t.TempDir(), project)
	host.findings = findings.NewStore(project)
	withProfileStore(t, host)
	fake := &reportsByPath{reports: map[string]measure.Report{}, prints: map[string]string{}}
	host.measureFile = fake.measure
	return host, fake, paths
}

func measureAll(t *testing.T, host *Host, paths []string) {
	t.Helper()
	if _, err := host.startMeasure(paths); err != nil {
		t.Fatal(err)
	}
	waitForMeasurement(t, host)
}

// storedDelivery lists the delivery findings in the store, by file and rule, the latest run's and the rest.
func storedDelivery(t *testing.T, host *Host) map[string]findings.Finding {
	t.Helper()
	stored, err := host.findings.List(findings.Query{Analyzer: deliveryprofile.ReviewAnalyzer, IncludeNotInLatestRun: true})
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]findings.Finding{}
	for _, f := range stored {
		out[filepath.Base(f.Source.File)+" "+f.Evidence["rule"].(string)] = f
	}
	return out
}

func TestAMeasurementSavesOneReviewFindingPerRuleMissedPerFile(t *testing.T) {
	host, fake, paths := deliveryFindingsHost(t)
	fake.set(paths[0], func(r *measure.Report) { r.RMSdBFS, r.SamplePeakdBFS = fv(-24.1), fv(-2.5) }, "sha256:one")
	fake.set(paths[1], func(r *measure.Report) { r.NoiseFloordBFS = nil }, "sha256:two")
	measureAll(t, host, pickAll(t, host))

	got := storedDelivery(t, host)
	if len(got) != 3 {
		t.Fatalf("stored %d delivery findings, want 3: %v", len(got), got)
	}
	for _, key := range []string{"Chapter 01.wav acx.rms", "Chapter 01.wav acx.peak", "Chapter 02.wav acx.noise_floor"} {
		f, ok := got[key]
		if !ok || f.Category != findings.CategoryDeliveryQC || f.NotInLatestRun || f.Project.Path != host.config.projectFolder {
			t.Errorf("%s: %+v, want a delivery_qc finding of the latest run in the project", key, f)
		}
	}
	// The Review page reads them through the generic bindings, like every other category.
	page, err := host.findings.Page(findings.Query{Category: findings.CategoryDeliveryQC})
	if err != nil || page.Total != 3 {
		t.Fatalf("the Review page's list has %d delivery findings (%v), want 3", page.Total, err)
	}
	// Judging the job again (the Delivery page reading it) writes nothing new and gives the same ids.
	job := host.judgeMeasure(host.measureState())
	for _, file := range job.Files {
		for _, f := range file.Findings {
			if _, stored := got[filepath.Base(file.Path)+" "+f.Evidence["rule"].(string)]; !stored {
				t.Errorf("the page's finding %s on %s is not the stored one", f.ID, file.Name)
			}
		}
	}
}

func TestARuleMetAgainResolvesItsFindingAndADecisionHoldsWhileTheAudioIsTheSame(t *testing.T) {
	host, fake, paths := deliveryFindingsHost(t)
	picked := pickAll(t, host)
	fake.set(paths[0], func(r *measure.Report) { r.RMSdBFS, r.SamplePeakdBFS = fv(-24.1), fv(-2.5) }, "sha256:one")
	fake.set(paths[1], nil, "sha256:two")
	measureAll(t, host, picked)
	rms := storedDelivery(t, host)["Chapter 01.wav acx.rms"]
	if _, found, err := host.findings.RecordDecision(rms.ID, rms.EvidenceVersion, findings.StatusDeferred, "", "2026-09-27T12:00:00Z"); err != nil || !found {
		t.Fatalf("defer: %v %v", found, err)
	}

	measureAll(t, host, picked)
	if got := storedDelivery(t, host)["Chapter 01.wav acx.rms"]; got.Review.Status != findings.StatusDeferred || got.NotInLatestRun {
		t.Fatalf("after measuring the same audio again: %+v, want still deferred", got)
	}

	fake.set(paths[0], func(r *measure.Report) { r.SamplePeakdBFS = fv(-2.5) }, "sha256:fixed")
	measureAll(t, host, picked)
	got := storedDelivery(t, host)
	if !got["Chapter 01.wav acx.rms"].NotInLatestRun {
		t.Errorf("RMS is met again but its finding %+v is still open", got["Chapter 01.wav acx.rms"])
	}
	if got["Chapter 01.wav acx.peak"].NotInLatestRun {
		t.Error("the peak is still missed but its finding was resolved")
	}
}

func TestMeasuringOneFileLeavesAnotherFilesFindingsAlone(t *testing.T) {
	host, fake, paths := deliveryFindingsHost(t)
	picked := pickAll(t, host)
	fake.set(paths[0], func(r *measure.Report) { r.RMSdBFS = fv(-24.1) }, "sha256:one")
	fake.set(paths[1], func(r *measure.Report) { r.RMSdBFS = fv(-24.1) }, "sha256:two")
	measureAll(t, host, picked)
	measureAll(t, host, picked[:1])
	if got := storedDelivery(t, host)["Chapter 02.wav acx.rms"]; got.ID == "" || got.NotInLatestRun {
		t.Fatalf("measuring only chapter 1 changed chapter 2's finding: %+v", got)
	}
}

func TestChoosingAnotherProfileRejudgesTheLastMeasurementForReview(t *testing.T) {
	host, fake, paths := deliveryFindingsHost(t)
	picked := pickAll(t, host)
	fake.set(paths[0], func(r *measure.Report) { r.RMSdBFS = fv(-22.5) }, "sha256:one")
	fake.set(paths[1], nil, "sha256:two")
	measureAll(t, host, picked)
	if got := storedDelivery(t, host); len(got) != 0 {
		t.Fatalf("an RMS of -22.5 meets ACX, but %d findings were stored", len(got))
	}

	copied := answered[deliveryprofile.Profile](t)(host.DeliveryDuplicateProfile("acx", "2026-09"))
	answered[DeliveryProfilesState](t)(host.DeliverySelectProfile("project", copied.ID, ""))
	rules := []map[string]any{}
	for _, rule := range copied.Rules {
		edit := map[string]any{"id": rule.ID, "off": rule.Off, "min": rule.Min, "max": rule.Max}
		if rule.ID == "acx.rms" {
			edit["min"] = -22.0
		}
		rules = append(rules, edit)
	}
	body := mustJSON(t, map[string]any{"id": copied.ID, "name": "Tighter RMS", "rules": rules})
	answered[deliveryprofile.Profile](t)(host.DeliverySaveProfile(body))
	custom := storedDelivery(t, host)["Chapter 01.wav acx.rms"]
	if custom.ID == "" || custom.NotInLatestRun || custom.Evidence["profile_name"] != "Tighter RMS" {
		t.Fatalf("after tightening RMS in the project's custom profile: %+v, want an open finding against it", custom)
	}

	answered[DeliveryProfilesState](t)(host.DeliveryDeleteProfile(copied.ID))
	if got := storedDelivery(t, host)["Chapter 01.wav acx.rms"]; !got.NotInLatestRun {
		t.Fatalf("the custom profile is gone and ACX judges again, but its finding %+v is still open", got)
	}
}

func TestAMeasurementFromAnotherProjectIsNotSavedIntoThisOne(t *testing.T) {
	host, fake, paths := deliveryFindingsHost(t)
	fake.set(paths[0], func(r *measure.Report) { r.RMSdBFS = fv(-24.1) }, "sha256:one")
	fake.set(paths[1], nil, "sha256:two")
	measureAll(t, host, pickAll(t, host))

	other := t.TempDir()
	host.config.projectFolder = other
	host.findings = findings.NewStore(other)
	host.settings = settings.New(t.TempDir(), other)
	answered[DeliveryProfilesState](t)(host.DeliverySelectProfile("project", "acx", "2026-09"))
	if got := storedDelivery(t, host); len(got) != 0 {
		t.Fatalf("the other project's measurement was saved into this project's store: %v", got)
	}
}
