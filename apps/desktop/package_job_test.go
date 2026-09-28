package main

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/packager"
)

// packageHost is a host with an export job already holding encoded files, ready to package.
func packageHost(t *testing.T, encodedPaths ...string) *Host {
	t.Helper()
	host := NewHost()
	job := &exportJob{id: "export-1", phase: "success"}
	for _, path := range encodedPaths {
		job.files = append(job.files, ExportFileResult{Kind: string(packager.KindChapter), Title: filepath.Base(path), Path: path, EncodedPath: path, Status: exportFileDone})
	}
	host.exportJob = job
	return host
}

func TestPackageRefusesWithoutAPriorExport(t *testing.T) {
	host := NewHost()
	_, err := host.startPackage(PackageRequest{ProfileID: "acx", Items: []PackageItem{{Kind: string(packager.KindChapter), Path: "C:/x.mp3"}}})
	if err == nil || !strings.Contains(err.Error(), "export the files") {
		t.Fatalf("expected an export-first refusal, got %v", err)
	}
}

func TestPackageRefusesAPathThatWasNotEncoded(t *testing.T) {
	host := packageHost(t, filepath.Join(t.TempDir(), "01.mp3"))
	_, err := host.startPackage(PackageRequest{ProfileID: "acx", Items: []PackageItem{{Kind: string(packager.KindChapter), Path: "C:/not-encoded.mp3"}}})
	if err == nil || !strings.Contains(err.Error(), "not encoded") {
		t.Fatalf("expected a not-encoded refusal, got %v", err)
	}
}

func TestPackageRefusesAnUnknownProfile(t *testing.T) {
	dir := t.TempDir()
	encoded := filepath.Join(dir, "01.mp3")
	writeFixtureFile(t, encoded, "encoded")
	host := packageHost(t, encoded)
	host.pickPackageFolder = func() (string, error) { return t.TempDir(), nil }
	_, err := host.startPackage(PackageRequest{ProfileID: "not-a-real-profile", Items: []PackageItem{{Kind: string(packager.KindChapter), Title: "01", Path: encoded}}})
	if err == nil || !strings.Contains(err.Error(), "no delivery profile") {
		t.Fatalf("expected an unknown-profile refusal, got %v", err)
	}
}

func TestPackageRefusesAnOutputFolderInsideTheProjectsSidecarTree(t *testing.T) {
	project := t.TempDir()
	encoded := filepath.Join(project, "narration-utils", "render-encode-master", "encoded", "01.mp3")
	writeFixtureFile(t, encoded, "encoded")
	host := packageHost(t, encoded)
	host.config.projectFolder = project
	host.pickPackageFolder = func() (string, error) {
		return filepath.Join(project, "narration-utils", "render-encode-master", "package"), nil
	}
	items := []PackageItem{{Kind: string(packager.KindChapter), Title: "01", Path: encoded}, {Kind: string(packager.KindRetailSample), Path: encoded}, {Kind: string(packager.KindCreditsOpening), Path: encoded}, {Kind: string(packager.KindCreditsClosing), Path: encoded}}
	_, err := host.startPackage(PackageRequest{ProfileID: "acx", Items: items})
	if err == nil || !strings.Contains(err.Error(), "narration-utils") {
		t.Fatalf("expected a sidecar-tree refusal, got %v", err)
	}
}

// TestPackageAssemblesARealPackage runs the real packager.Assemble (Phase 4) over an export's own encoded files,
// end to end: the job answers the manifest and checklist Assemble built.
func TestPackageAssemblesARealPackage(t *testing.T) {
	dir := t.TempDir()
	ch1, ch2, credits, sample := filepath.Join(dir, "1.mp3"), filepath.Join(dir, "2.mp3"), filepath.Join(dir, "c.mp3"), filepath.Join(dir, "s.mp3")
	for _, path := range []string{ch1, ch2, credits, sample} {
		writeFixtureFile(t, path, "encoded "+path)
	}
	host := packageHost(t, ch1, ch2, credits, sample)
	outDir := filepath.Join(t.TempDir(), "package")
	host.pickPackageFolder = func() (string, error) { return outDir, nil }

	// ACX requires both an opening and closing credits file; give it only one to prove the checklist reports it
	// missing rather than the whole request refusing, since ACX also requires a retail sample which this request
	// does supply.
	items := []PackageItem{
		{Kind: string(packager.KindChapter), Title: "Chapter One", Path: ch1},
		{Kind: string(packager.KindChapter), Title: "Chapter Two", Path: ch2},
		{Kind: string(packager.KindCreditsOpening), Path: credits},
		{Kind: string(packager.KindRetailSample), Path: sample},
	}
	if _, err := host.startPackage(PackageRequest{ProfileID: "acx", Items: items}); err != nil {
		t.Fatal(err)
	}
	job := waitPackage(t, host)
	if job.Phase != "error" {
		t.Fatalf("expected a refusal (missing closing credits), got %q (%s)", job.Phase, job.Message)
	}
}

func TestPackageWithEveryItemBuildsTheACXBookChecklist(t *testing.T) {
	dir := t.TempDir()
	ch1, opening, closing, sample := filepath.Join(dir, "1.mp3"), filepath.Join(dir, "o.mp3"), filepath.Join(dir, "c.mp3"), filepath.Join(dir, "s.mp3")
	for _, path := range []string{ch1, opening, closing, sample} {
		writeFixtureFile(t, path, "encoded "+path)
	}
	host := packageHost(t, ch1, opening, closing, sample)
	outDir := filepath.Join(t.TempDir(), "package")
	host.pickPackageFolder = func() (string, error) { return outDir, nil }

	items := []PackageItem{
		{Kind: string(packager.KindChapter), Title: "Chapter One", Path: ch1},
		{Kind: string(packager.KindCreditsOpening), Path: opening},
		{Kind: string(packager.KindCreditsClosing), Path: closing},
		{Kind: string(packager.KindRetailSample), Path: sample},
	}
	if _, err := host.startPackage(PackageRequest{ProfileID: "acx", Items: items}); err != nil {
		t.Fatal(err)
	}
	job := waitPackage(t, host)
	if job.Phase != "success" {
		t.Fatalf("expected success, got %q (%s)", job.Phase, job.Message)
	}
	if len(job.Files) != 4 {
		t.Fatalf("expected 4 packaged files, got %d (%+v)", len(job.Files), job.Files)
	}
	if job.OutputDir != outDir {
		t.Fatalf("expected outputDir %q, got %q", outDir, job.OutputDir)
	}
	for _, item := range job.Checklist {
		if item.Status == string(packager.ChecklistMissing) {
			t.Fatalf("expected no missing checklist item, got %+v", item)
		}
	}
}

func TestPackageCancelStopsBeforeWritingMore(t *testing.T) {
	dir := t.TempDir()
	ch1 := filepath.Join(dir, "1.mp3")
	writeFixtureFile(t, ch1, "encoded")
	host := packageHost(t, ch1)
	outDir := filepath.Join(t.TempDir(), "package")
	host.pickPackageFolder = func() (string, error) { return outDir, nil }
	host.assemblePackage = func(ctx context.Context, req packager.Request) (packager.Manifest, error) {
		<-ctx.Done()
		return packager.Manifest{}, ctx.Err()
	}

	items := []PackageItem{{Kind: string(packager.KindChapter), Title: "Chapter One", Path: ch1}, {Kind: string(packager.KindRetailSample), Path: ch1}}
	if _, err := host.startPackage(PackageRequest{ProfileID: "acx", Items: items}); err != nil {
		t.Fatal(err)
	}
	job := host.cancelPackage()
	if job.Phase != "running" {
		t.Fatalf("cancel should not itself change the phase synchronously, got %q", job.Phase)
	}
	job = waitPackage(t, host)
	if job.Phase != "cancelled" {
		t.Fatalf("expected cancelled, got %q (%s)", job.Phase, job.Message)
	}
}

func TestPackageEmptyFolderChoiceLeavesTheJobIdle(t *testing.T) {
	dir := t.TempDir()
	ch1 := filepath.Join(dir, "1.mp3")
	writeFixtureFile(t, ch1, "encoded")
	host := packageHost(t, ch1)
	host.pickPackageFolder = func() (string, error) { return "", nil }
	items := []PackageItem{{Kind: string(packager.KindChapter), Title: "Chapter One", Path: ch1}, {Kind: string(packager.KindRetailSample), Path: ch1}, {Kind: string(packager.KindCreditsOpening), Path: ch1}, {Kind: string(packager.KindCreditsClosing), Path: ch1}}
	job, err := host.startPackage(PackageRequest{ProfileID: "acx", Items: items})
	if err != nil {
		t.Fatal(err)
	}
	if job.Phase == "running" {
		t.Fatalf("closing the folder picker should not start a job, got %q", job.Phase)
	}
}

func TestPackageRefusesASecondBuildWhileOneRuns(t *testing.T) {
	dir := t.TempDir()
	ch1 := filepath.Join(dir, "1.mp3")
	writeFixtureFile(t, ch1, "encoded")
	host := packageHost(t, ch1)
	host.pickPackageFolder = func() (string, error) { return filepath.Join(t.TempDir(), "out"), nil }
	release := make(chan struct{})
	host.assemblePackage = func(ctx context.Context, req packager.Request) (packager.Manifest, error) {
		<-release
		return packager.Assemble(ctx, req)
	}
	items := []PackageItem{{Kind: string(packager.KindChapter), Title: "Chapter One", Path: ch1}, {Kind: string(packager.KindRetailSample), Path: ch1}, {Kind: string(packager.KindCreditsOpening), Path: ch1}, {Kind: string(packager.KindCreditsClosing), Path: ch1}}
	if _, err := host.startPackage(PackageRequest{ProfileID: "acx", Items: items}); err != nil {
		t.Fatal(err)
	}
	if _, err := host.startPackage(PackageRequest{ProfileID: "acx", Items: items}); err == nil || !strings.Contains(err.Error(), "already being built") {
		t.Fatalf("expected an already-building refusal, got %v", err)
	}
	close(release)
	waitPackage(t, host)
}

func waitPackage(t *testing.T, host *Host) PackageJob {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		job := host.packageState()
		if job.Phase != "running" {
			return job
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("package build did not finish in time")
	return PackageJob{}
}
