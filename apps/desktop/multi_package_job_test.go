package main

import (
	"context"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
	"github.com/countrymanprime/narration-utils/shell/internal/encodeport"
	"github.com/countrymanprime/narration-utils/shell/internal/packager"
)

// m4bProfile is a synthetic profile requiring the M4B format (no built-in profile asks for anything but MP3 today):
// one file-scope rule whose Metric is "m4b_format", otherwise a minimal copy of what ACX carries. It is only ever
// handed to a test host through resolveProfile (a seam, app.go), never saved through the real deliveryprofile.Store,
// whose own validation would refuse an "m4b_format" metric it does not yet know (internal/deliveryprofile/store.go's
// knownMetrics) - exactly the situation ADR 0480 records: no built-in profile needs a format helper yet, so the
// PRD's own "a profile requiring M4B" test wording is only reachable with a profile built directly in a test.
func m4bProfile(id string) deliveryprofile.Profile {
	profile := deliveryprofile.ACX()
	name := "M4B Platform (" + id + ")"
	profile.ID, profile.BuiltIn, profile.Name, profile.Platform = id, false, name, name
	for i := range profile.Rules {
		switch profile.Rules[i].ID {
		case "acx.format":
			profile.Rules[i].Metric, profile.Rules[i].BoundText = "m4b_format", "M4B"
		case "acx.credits", "acx.retail_sample":
			// Turned off so these tests can package chapters alone: credits and a retail sample are exercised by
			// the matching-format tests below, which already carry them.
			profile.Rules[i].Off = true
		}
	}
	return profile
}

// secondACXProfile is a distinct custom profile that also requires MP3 (its rules are a copy of ACX's own), so two
// selections can share the export job's current format without being the very same profile.
func secondACXProfile(id string) deliveryprofile.Profile {
	profile := deliveryprofile.ACX()
	profile.ID, profile.BuiltIn, profile.Name, profile.Platform = id, false, "Second MP3 Platform", "Second MP3 Platform"
	return profile
}

// resolverFor answers a resolveProfile seam over a fixed set of profiles, keyed by id.
func resolverFor(profiles ...deliveryprofile.Profile) func(deliveryprofile.Ref) (deliveryprofile.Profile, bool, error) {
	byID := map[string]deliveryprofile.Profile{}
	for _, p := range profiles {
		byID[p.ID] = p
	}
	return func(ref deliveryprofile.Ref) (deliveryprofile.Profile, bool, error) {
		if p, ok := deliveryprofile.BuiltIn(ref); ok {
			return p, true, nil
		}
		p, ok := byID[ref.ID]
		return p, ok, nil
	}
}

// countingEncoder answers an encodeFileFunc that writes dst (as writeFixtureFile does) and counts its own calls.
func countingEncoder(t *testing.T) (encodeFileFunc, *atomic.Int64) {
	var calls atomic.Int64
	return func(_ context.Context, wav, dst string, spec encodeport.Spec) error {
		calls.Add(1)
		writeFixtureFile(t, dst, "encoded "+wav+" as "+spec.Format)
		return nil
	}, &calls
}

// multiPackageHost is a host with an export job already holding encoded (mp3) files for chapters named ch1..chN,
// ready to package under several profiles at once. Its export job also carries a MasteredPath per file, so a
// re-encode test can assert it reads from there rather than from Path.
func multiPackageHost(t *testing.T, format string, chapterPaths ...string) *Host {
	t.Helper()
	host := NewHost()
	host.config.projectFolder = t.TempDir()
	job := &exportJob{id: "export-1", phase: "success", format: format}
	for _, path := range chapterPaths {
		mastered := filepath.Join(t.TempDir(), filepath.Base(path)+".mastered.wav")
		writeFixtureFile(t, mastered, "mastered "+path)
		job.files = append(job.files, ExportFileResult{
			Kind: string(packager.KindChapter), Title: filepath.Base(path), Path: path, MasteredPath: mastered, EncodedPath: path, Status: exportFileDone,
		})
	}
	host.exportJob = job
	return host
}

func waitMultiPackage(t *testing.T, host *Host) MultiPackageJob {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		job := host.multiPackageState()
		if job.Phase != "running" {
			return job
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("multi-package build did not finish in time")
	return MultiPackageJob{}
}

func TestMultiPackageRefusesAnEmptySelection(t *testing.T) {
	host := NewHost()
	_, err := host.startMultiPackage(MultiPackageRequest{Items: []PackageItem{{Kind: string(packager.KindChapter), Path: "C:/x.mp3"}}})
	if err == nil || !strings.Contains(err.Error(), "choose at least one platform") {
		t.Fatalf("expected an empty-selection refusal, got %v", err)
	}
}

func TestMultiPackageRefusesAnUnknownProfile(t *testing.T) {
	dir := t.TempDir()
	encoded := filepath.Join(dir, "01-chapter.mp3")
	writeFixtureFile(t, encoded, "encoded")
	host := multiPackageHost(t, "mp3", encoded)
	host.pickPackageFolder = func() (string, error) { return t.TempDir(), nil }
	_, err := host.startMultiPackage(MultiPackageRequest{
		Selections: []ProfileSelection{{ProfileID: "not-a-real-profile"}},
		Items:      []PackageItem{{Kind: string(packager.KindChapter), Title: "Chapter 1", Path: encoded}},
	})
	if err == nil || !strings.Contains(err.Error(), "no delivery profile") {
		t.Fatalf("expected an unknown-profile refusal, got %v", err)
	}
}

func TestMultiPackageRefusesWithoutAPriorExport(t *testing.T) {
	host := NewHost()
	_, err := host.startMultiPackage(MultiPackageRequest{
		Selections: []ProfileSelection{{ProfileID: deliveryprofile.ACXID, ProfileVersion: deliveryprofile.ACXVersion}},
		Items:      []PackageItem{{Kind: string(packager.KindChapter), Title: "Chapter 1", Path: "C:/x.mp3"}},
	})
	if err == nil || !strings.Contains(err.Error(), "export the files") {
		t.Fatalf("expected an export-first refusal, got %v", err)
	}
}

func TestMultiPackageRefusesASecondBuildWhileOneRuns(t *testing.T) {
	dir := t.TempDir()
	encoded := filepath.Join(dir, "01-chapter.mp3")
	writeFixtureFile(t, encoded, "encoded")
	host := multiPackageHost(t, "mp3", encoded)
	host.pickPackageFolder = func() (string, error) { return filepath.Join(t.TempDir(), "out"), nil }
	release := make(chan struct{})
	host.assemblePackage = func(ctx context.Context, req packager.Request) (packager.Manifest, error) {
		<-release
		return packager.Assemble(ctx, req)
	}
	items := []PackageItem{{Kind: string(packager.KindChapter), Title: "Chapter 1", Path: encoded}}
	sel := []ProfileSelection{{ProfileID: deliveryprofile.ACXID, ProfileVersion: deliveryprofile.ACXVersion}}

	if _, err := host.startMultiPackage(MultiPackageRequest{Selections: sel, Items: items}); err != nil {
		t.Fatal(err)
	}
	if _, err := host.startMultiPackage(MultiPackageRequest{Selections: sel, Items: items}); err == nil || !strings.Contains(err.Error(), "already being built") {
		t.Fatalf("expected an already-building refusal, got %v", err)
	}
	// A single PackageStart is refused too, since it shares the same files and folder-picker concerns.
	host2 := host
	if _, err := host2.startPackage(PackageRequest{ProfileID: deliveryprofile.ACXID, Items: []PackageItem{{Kind: string(packager.KindChapter), Title: "Chapter 1", Path: encoded}}}); err == nil ||
		!strings.Contains(err.Error(), "already being built") {
		t.Fatalf("expected startPackage to refuse while a multi-platform build runs, got %v", err)
	}
	close(release)
	waitMultiPackage(t, host)
}

// TestMultiPackageMatchingFormatsReuseTheSameEncodedFiles is the PRD's own Phase 6 test requirement: "two profiles
// sharing MP3 at the same bitrate reuse one encoded file". Both selected profiles require MP3, the export job's own
// current format, so no encode call is made at all - the job packages straight from the given (already-encoded)
// items.
func TestMultiPackageMatchingFormatsReuseTheSameEncodedFiles(t *testing.T) {
	dir := t.TempDir()
	chapter, opening, closing, sample := filepath.Join(dir, "1.mp3"), filepath.Join(dir, "o.mp3"), filepath.Join(dir, "c.mp3"), filepath.Join(dir, "s.mp3")
	for _, path := range []string{chapter, opening, closing, sample} {
		writeFixtureFile(t, path, "encoded "+path)
	}
	host := multiPackageHost(t, "mp3", chapter, opening, closing, sample)
	rootDir := filepath.Join(t.TempDir(), "root")
	host.pickPackageFolder = func() (string, error) { return rootDir, nil }
	encode, calls := countingEncoder(t)
	host.encodeFile = encode
	host.resolveProfile = resolverFor(secondACXProfile("second-mp3"))

	items := []PackageItem{
		{Kind: string(packager.KindChapter), Title: "Chapter 1", Path: chapter},
		{Kind: string(packager.KindRetailSample), Path: sample},
		{Kind: string(packager.KindCreditsOpening), Path: opening},
		{Kind: string(packager.KindCreditsClosing), Path: closing},
	}
	sel := []ProfileSelection{{ProfileID: deliveryprofile.ACXID, ProfileVersion: deliveryprofile.ACXVersion}, {ProfileID: "second-mp3"}}
	if _, err := host.startMultiPackage(MultiPackageRequest{Selections: sel, Items: items}); err != nil {
		t.Fatal(err)
	}
	job := waitMultiPackage(t, host)
	if job.Phase != "success" {
		t.Fatalf("expected success, got %q (%s)", job.Phase, job.Message)
	}
	if calls.Load() != 0 {
		t.Fatalf("expected no additional encode calls when every selection matches the export job's own format, got %d", calls.Load())
	}
	if len(job.Results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(job.Results))
	}
	for _, result := range job.Results {
		if result.Phase != "success" {
			t.Fatalf("expected every profile to succeed, got %+v", result)
		}
		for _, file := range result.Files {
			if file.Kind != string(packager.KindChapter) {
				continue
			}
			if !strings.HasSuffix(file.DestPath, ".mp3") {
				t.Fatalf("expected an .mp3 file for a matching-format profile, got %q", file.DestPath)
			}
		}
	}
}

// TestMultiPackageDifferingFormatEncodesOncePerFile is the PRD's other Phase 6 test requirement: "a profile
// requiring M4B triggers a second encode only for that format" - exactly one encode call per export-job file
// (memoized, not once per selection), even though two of the three selected profiles both require M4B.
func TestMultiPackageDifferingFormatEncodesOncePerFile(t *testing.T) {
	dir := t.TempDir()
	ch1, ch2 := filepath.Join(dir, "01-chapter.mp3"), filepath.Join(dir, "02-chapter.mp3")
	writeFixtureFile(t, ch1, "encoded 1")
	writeFixtureFile(t, ch2, "encoded 2")
	host := multiPackageHost(t, "mp3", ch1, ch2)
	rootDir := filepath.Join(t.TempDir(), "root")
	host.pickPackageFolder = func() (string, error) { return rootDir, nil }
	encode, calls := countingEncoder(t)
	host.encodeFile = encode
	host.resolveProfile = resolverFor(m4bProfile("m4b-a"), m4bProfile("m4b-b"))

	items := []PackageItem{{Kind: string(packager.KindChapter), Title: "Chapter 1", Path: ch1}, {Kind: string(packager.KindChapter), Title: "Chapter 2", Path: ch2}}
	sel := []ProfileSelection{{ProfileID: "m4b-a"}, {ProfileID: "m4b-b"}}
	if _, err := host.startMultiPackage(MultiPackageRequest{Selections: sel, Items: items}); err != nil {
		t.Fatal(err)
	}
	job := waitMultiPackage(t, host)
	if job.Phase != "success" {
		t.Fatalf("expected success, got %q (%s)", job.Phase, job.Message)
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("expected exactly one encode call per export-job file (2), got %d", got)
	}
	encodedDir := exportScratchDir(host.config.projectFolder, "encoded-m4b")
	for _, result := range job.Results {
		if result.Phase != "success" {
			t.Fatalf("expected success, got %+v", result)
		}
		for _, file := range result.Files {
			if file.Kind != string(packager.KindChapter) {
				continue
			}
			if !strings.HasSuffix(file.DestPath, ".m4b") {
				t.Fatalf("expected an .m4b file for an m4b-requiring profile, got %q", file.DestPath)
			}
		}
	}
	if _, err := filepath.Glob(filepath.Join(encodedDir, "*.m4b")); err != nil {
		t.Fatal(err)
	}
}

// TestMultiPackageReencodesFromTheMasteredFileNotTheCurrentlyEncodedOne proves a differing-format re-encode reads
// from the export job's own MasteredPath (when it mastered), never from the currently-encoded file, which is
// already in the wrong container format.
func TestMultiPackageReencodesFromTheMasteredFileNotTheCurrentlyEncodedOne(t *testing.T) {
	dir := t.TempDir()
	ch1 := filepath.Join(dir, "01-chapter.mp3")
	writeFixtureFile(t, ch1, "encoded")
	host := multiPackageHost(t, "mp3", ch1)
	host.pickPackageFolder = func() (string, error) { return filepath.Join(t.TempDir(), "root"), nil }
	var sourceSeen string
	host.encodeFile = func(_ context.Context, wav, dst string, spec encodeport.Spec) error {
		sourceSeen = wav
		writeFixtureFile(t, dst, "encoded "+wav)
		return nil
	}
	host.resolveProfile = resolverFor(m4bProfile("m4b-a"))

	items := []PackageItem{{Kind: string(packager.KindChapter), Title: "Chapter 1", Path: ch1}, {Kind: string(packager.KindRetailSample), Path: ch1}, {Kind: string(packager.KindCreditsOpening), Path: ch1}, {Kind: string(packager.KindCreditsClosing), Path: ch1}}
	if _, err := host.startMultiPackage(MultiPackageRequest{Selections: []ProfileSelection{{ProfileID: "m4b-a"}}, Items: items}); err != nil {
		t.Fatal(err)
	}
	waitMultiPackage(t, host)
	if !strings.HasSuffix(sourceSeen, ".mastered.wav") {
		t.Fatalf("expected the re-encode to read the export job's own mastered file, got %q", sourceSeen)
	}
}

func TestMultiPackageEachProfileGetsItsOwnNamedSubfolder(t *testing.T) {
	dir := t.TempDir()
	chapter, opening, closing, sample := filepath.Join(dir, "1.mp3"), filepath.Join(dir, "o.mp3"), filepath.Join(dir, "c.mp3"), filepath.Join(dir, "s.mp3")
	for _, path := range []string{chapter, opening, closing, sample} {
		writeFixtureFile(t, path, "encoded "+path)
	}
	host := multiPackageHost(t, "mp3", chapter, opening, closing, sample)
	rootDir := filepath.Join(t.TempDir(), "root")
	host.pickPackageFolder = func() (string, error) { return rootDir, nil }
	host.resolveProfile = resolverFor(secondACXProfile("second-mp3"))

	items := []PackageItem{
		{Kind: string(packager.KindChapter), Title: "Chapter 1", Path: chapter},
		{Kind: string(packager.KindRetailSample), Path: sample},
		{Kind: string(packager.KindCreditsOpening), Path: opening},
		{Kind: string(packager.KindCreditsClosing), Path: closing},
	}
	sel := []ProfileSelection{{ProfileID: deliveryprofile.ACXID, ProfileVersion: deliveryprofile.ACXVersion}, {ProfileID: "second-mp3"}}
	if _, err := host.startMultiPackage(MultiPackageRequest{Selections: sel, Items: items}); err != nil {
		t.Fatal(err)
	}
	job := waitMultiPackage(t, host)
	if job.Phase != "success" {
		t.Fatalf("expected success, got %q (%s)", job.Phase, job.Message)
	}
	seen := map[string]bool{}
	for _, result := range job.Results {
		if result.OutputDir == "" || seen[result.OutputDir] {
			t.Fatalf("expected a distinct non-empty output folder per profile, got %+v", job.Results)
		}
		seen[result.OutputDir] = true
		if filepath.Dir(result.OutputDir) != rootDir {
			t.Fatalf("expected %q to be a subfolder of %q", result.OutputDir, rootDir)
		}
	}
}

func TestMultiPackageCancelLeavesLaterProfilesPendingAndWritesNoFiles(t *testing.T) {
	dir := t.TempDir()
	ch1 := filepath.Join(dir, "01-chapter.mp3")
	writeFixtureFile(t, ch1, "encoded")
	host := multiPackageHost(t, "mp3", ch1)
	rootDir := filepath.Join(t.TempDir(), "root")
	host.pickPackageFolder = func() (string, error) { return rootDir, nil }
	host.resolveProfile = resolverFor(secondACXProfile("second-mp3"))

	release := make(chan struct{})
	var started sync.WaitGroup
	started.Add(1)
	var startedOnce sync.Once
	host.assemblePackage = func(ctx context.Context, req packager.Request) (packager.Manifest, error) {
		startedOnce.Do(started.Done)
		<-release
		return packager.Manifest{}, ctx.Err()
	}

	items := []PackageItem{{Kind: string(packager.KindChapter), Title: "Chapter 1", Path: ch1}, {Kind: string(packager.KindRetailSample), Path: ch1}, {Kind: string(packager.KindCreditsOpening), Path: ch1}, {Kind: string(packager.KindCreditsClosing), Path: ch1}}
	sel := []ProfileSelection{{ProfileID: deliveryprofile.ACXID, ProfileVersion: deliveryprofile.ACXVersion}, {ProfileID: "second-mp3"}}
	if _, err := host.startMultiPackage(MultiPackageRequest{Selections: sel, Items: items}); err != nil {
		t.Fatal(err)
	}
	started.Wait()
	job := host.cancelMultiPackage()
	if job.Phase != "running" {
		t.Fatalf("cancel should not itself change the phase synchronously, got %q", job.Phase)
	}
	close(release)
	job = waitMultiPackage(t, host)
	if job.Phase != "cancelled" {
		t.Fatalf("expected cancelled, got %q (%s)", job.Phase, job.Message)
	}
	if job.Results[1].Phase != "pending" {
		t.Fatalf("expected the second profile to stay pending, got %+v", job.Results[1])
	}
	if entries, _ := filepath.Glob(filepath.Join(rootDir, "*", "*")); len(entries) != 0 {
		t.Fatalf("expected no files written for a cancelled profile's package, got %v", entries)
	}
}

func TestRequiredFormatDefaultsToMP3WithNoFormatRule(t *testing.T) {
	profile := deliveryprofile.Profile{Rules: []deliveryprofile.Rule{{ID: "x", Scope: deliveryprofile.ScopeFile, Metric: "rms_dbfs"}}}
	if got := requiredFormat(profile); got != "mp3" {
		t.Fatalf("expected mp3, got %q", got)
	}
}

func TestRequiredFormatReadsACXsOwnMP3Rule(t *testing.T) {
	if got := requiredFormat(deliveryprofile.ACX()); got != "mp3" {
		t.Fatalf("expected mp3, got %q", got)
	}
}

func TestRequiredFormatReadsASyntheticM4BRule(t *testing.T) {
	profile := deliveryprofile.Profile{Rules: []deliveryprofile.Rule{
		{ID: "x.rms", Scope: deliveryprofile.ScopeFile, Metric: "rms_dbfs"},
		{ID: "x.format", Scope: deliveryprofile.ScopeFile, Metric: "m4b_format"},
	}}
	if got := requiredFormat(profile); got != "m4b" {
		t.Fatalf("expected m4b, got %q", got)
	}
}

func TestRequiredFormatIgnoresABookScopeFormatLikeRule(t *testing.T) {
	profile := deliveryprofile.Profile{Rules: []deliveryprofile.Rule{{ID: "x", Scope: deliveryprofile.ScopeBook, Metric: "flac_format"}}}
	if got := requiredFormat(profile); got != "mp3" {
		t.Fatalf("expected mp3 (a book-scope rule is not a file's own container format), got %q", got)
	}
}

func TestSanitizeFolderNameReplacesInvalidCharacters(t *testing.T) {
	if got := sanitizeFolderName(`Kobo: "Books"/2026`); strings.ContainsAny(got, invalidFolderChars) {
		t.Fatalf("expected no invalid characters left, got %q", got)
	}
	if got := sanitizeFolderName("   "); got != "package" {
		t.Fatalf("expected the empty-after-trim fallback, got %q", got)
	}
}

// TestSanitizeFolderNameRejectsPathEscapingDotSegments proves a custom profile named exactly "." or ".." (no
// character restriction stops a narrator naming one that) never becomes a no-op or a parent-directory escape when
// joined under the chosen root: internal/deliveryprofile's own store enforces only a name's length, not its
// characters, so this is reachable from a real saved profile, not just a contrived test.
func TestSanitizeFolderNameRejectsPathEscapingDotSegments(t *testing.T) {
	for _, name := range []string{".", "..", "...", " .. "} {
		if got := sanitizeFolderName(name); got != "package" {
			t.Fatalf("sanitizeFolderName(%q) = %q, want the fallback (a dot-only name would join as . or .. under the root)", name, got)
		}
	}
	root := t.TempDir()
	joined, err := filepath.Abs(filepath.Join(root, sanitizeFolderName("..")))
	if err != nil {
		t.Fatal(err)
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(joined) != absRoot {
		t.Fatalf("expected the sanitized name to stay a subfolder of %q, got %q", absRoot, joined)
	}
}
