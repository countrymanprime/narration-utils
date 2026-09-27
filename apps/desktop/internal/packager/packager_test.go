package packager

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
	"github.com/countrymanprime/narration-utils/shell/internal/encodeport"
	"github.com/countrymanprime/narration-utils/shell/internal/encodeport/encodeporttest"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

func writeSource(t *testing.T, dir, name string, body string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func acxRequest(t *testing.T) Request {
	t.Helper()
	dir := t.TempDir()
	credOpen := writeSource(t, dir, "credits-open.mp3", "opening credits")
	credClose := writeSource(t, dir, "credits-close.mp3", "closing credits")
	sample := writeSource(t, dir, "sample.mp3", "retail sample")
	ch1 := writeSource(t, dir, "ch1.mp3", "chapter one")
	ch2 := writeSource(t, dir, "ch2.mp3", "chapter two")
	return Request{
		Profile:        deliveryprofile.ACX(),
		Chapters:       []Item{{Title: "Chapter One", Path: ch1}, {Title: "Chapter Two", Path: ch2}},
		CreditsOpening: &Item{Path: credOpen},
		CreditsClosing: &Item{Path: credClose},
		RetailSample:   &Item{Path: sample},
		OutputDir:      filepath.Join(dir, "package"),
	}
}

func TestAssembleWithEveryItemProducesExactlyTheACXBookChecklistFiles(t *testing.T) {
	req := acxRequest(t)
	manifest, err := Assemble(context.Background(), req)
	if err != nil {
		t.Fatalf("Assemble: %v", err)
	}
	wantNames := map[string]bool{
		"Credits, Opening.mp3": true,
		"01 - Chapter One.mp3": true,
		"02 - Chapter Two.mp3": true,
		"Credits, Closing.mp3": true,
		"Retail Sample.mp3":    true,
	}
	if len(manifest.Files) != len(wantNames) {
		t.Fatalf("got %d files, want %d: %+v", len(manifest.Files), len(wantNames), manifest.Files)
	}
	for _, file := range manifest.Files {
		if !wantNames[file.Name] {
			t.Errorf("unexpected file name %q", file.Name)
		}
		if _, err := os.Stat(file.DestPath); err != nil {
			t.Errorf("%s: not written at %s: %v", file.Name, file.DestPath, err)
		}
		delete(wantNames, file.Name)
	}
	if len(wantNames) != 0 {
		t.Errorf("missing files: %v", wantNames)
	}
}

func TestAssembleChecklistCoversEveryBookRule(t *testing.T) {
	req := acxRequest(t)
	manifest, err := Assemble(context.Background(), req)
	if err != nil {
		t.Fatalf("Assemble: %v", err)
	}
	statuses := map[string]ChecklistStatus{}
	for _, item := range manifest.Checklist {
		statuses[item.RuleID] = item.Status
	}
	want := map[string]ChecklistStatus{
		"acx.channels":             ChecklistNotApplicable,
		"acx.one_section_per_file": ChecklistIncluded,
		"acx.credits":              ChecklistIncluded,
		"acx.retail_sample":        ChecklistIncluded,
		"acx.consistency":          ChecklistNotApplicable,
	}
	for id, status := range want {
		if got, ok := statuses[id]; !ok || got != status {
			t.Errorf("rule %s: got %v, want %v", id, got, status)
		}
	}
}

func TestAssembleRefusesWhenTheRetailSampleIsMissing(t *testing.T) {
	req := acxRequest(t)
	req.RetailSample = nil
	_, err := Assemble(context.Background(), req)
	if !errors.Is(err, ErrMissingRequiredItem) {
		t.Fatalf("got %v, want ErrMissingRequiredItem", err)
	}
}

func TestAssembleRefusesWhenOnlyOneCreditsFileIsGiven(t *testing.T) {
	req := acxRequest(t)
	req.CreditsClosing = nil
	_, err := Assemble(context.Background(), req)
	if !errors.Is(err, ErrMissingRequiredItem) {
		t.Fatalf("got %v, want ErrMissingRequiredItem", err)
	}
}

func TestAssembleWritesNothingWhenAnItemIsMissing(t *testing.T) {
	req := acxRequest(t)
	req.RetailSample = nil
	if _, err := Assemble(context.Background(), req); err == nil {
		t.Fatal("expected a refusal")
	}
	entries, err := os.ReadDir(req.OutputDir)
	if err == nil && len(entries) != 0 {
		t.Errorf("Assemble left files behind after refusing: %v", entries)
	}
}

func TestATurnedOffBookRuleIsNotRequired(t *testing.T) {
	req := acxRequest(t)
	profile := req.Profile.Clone()
	for i, rule := range profile.Rules {
		if rule.ID == "acx.retail_sample" {
			profile.Rules[i].Off = true
		}
	}
	req.Profile = profile
	req.RetailSample = nil

	manifest, err := Assemble(context.Background(), req)
	if err != nil {
		t.Fatalf("Assemble: %v", err)
	}
	for _, item := range manifest.Checklist {
		if item.RuleID == "acx.retail_sample" && item.Status != ChecklistOff {
			t.Errorf("acx.retail_sample: got %v, want ChecklistOff", item.Status)
		}
	}
	for _, file := range manifest.Files {
		if file.Kind == KindRetailSample {
			t.Error("a retail sample was written although the rule is off and none was given")
		}
	}
}

func TestAssembleNeverChangesItsSourceFiles(t *testing.T) {
	req := acxRequest(t)
	before := map[string][]byte{}
	for _, item := range req.Chapters {
		body, err := os.ReadFile(item.Path)
		if err != nil {
			t.Fatal(err)
		}
		before[item.Path] = body
	}
	if _, err := Assemble(context.Background(), req); err != nil {
		t.Fatalf("Assemble: %v", err)
	}
	for path, want := range before {
		got, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if string(got) != string(want) {
			t.Errorf("%s changed", path)
		}
	}
}

func TestAssembleRefusesToOverwriteAnExistingPackage(t *testing.T) {
	req := acxRequest(t)
	if err := os.MkdirAll(req.OutputDir, 0o755); err != nil {
		t.Fatal(err)
	}
	collidingPath := filepath.Join(req.OutputDir, "01 - Chapter One.mp3")
	if err := os.WriteFile(collidingPath, []byte("already here"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := Assemble(context.Background(), req)
	if !errors.Is(err, ErrDestinationExists) {
		t.Fatalf("got %v, want ErrDestinationExists", err)
	}
	got, err := os.ReadFile(collidingPath)
	if err != nil || string(got) != "already here" {
		t.Errorf("the existing file was touched: %q, %v", got, err)
	}
}

func TestAssembleRefusesWhenTheDestinationIsAnItemsOwnSourceFile(t *testing.T) {
	req := acxRequest(t)
	req.Chapters[0].Path = filepath.Join(req.OutputDir, "01 - Chapter One.mp3")
	if err := os.MkdirAll(req.OutputDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(req.Chapters[0].Path, []byte("chapter one"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := Assemble(context.Background(), req)
	if !errors.Is(err, ErrSameFile) {
		t.Fatalf("got %v, want ErrSameFile", err)
	}
}

func TestChapterTitlesWithIllegalFileNameCharactersAreRefused(t *testing.T) {
	req := acxRequest(t)
	req.Chapters[0].Title = `Chapter <One>`
	if _, err := Assemble(context.Background(), req); err == nil {
		t.Fatal("expected a refusal")
	}
}

func TestAssembleRefusesWithNoChapters(t *testing.T) {
	req := acxRequest(t)
	req.Chapters = nil
	if _, err := Assemble(context.Background(), req); err == nil {
		t.Fatal("expected a refusal")
	}
}

func TestAssembleRefusesWithNoOutputDir(t *testing.T) {
	req := acxRequest(t)
	req.OutputDir = ""
	if _, err := Assemble(context.Background(), req); err == nil {
		t.Fatal("expected a refusal")
	}
}

func TestAssembleWithNoPackagerRowCopiesFilesUnmodified(t *testing.T) {
	req := acxRequest(t)
	req.Tags = encodeport.Tags{"title": "My Book"}
	manifest, err := Assemble(context.Background(), req)
	if err != nil {
		t.Fatalf("Assemble: %v", err)
	}
	for _, file := range manifest.Files {
		if file.Tagged {
			t.Errorf("%s: reported tagged with no Packager row registered", file.Name)
		}
	}
}

func TestAssembleEmbedsTagsThroughAMatchingPackagerRow(t *testing.T) {
	req := acxRequest(t)
	req.Tags = encodeport.Tags{"title": "My Book", "narrator": "Suite"}
	registry := &port.Registry[encodeport.Packager]{Kind: "packager"}
	registry.Register(port.Entry[encodeport.Packager]{
		Name:       "fake",
		Descriptor: port.Descriptor{Label: "Fake", Modes: []string{"mp3"}},
		New:        func() encodeport.Packager { return encodeporttest.NewFakePackager("fake", "mp3") },
	})
	req.Packagers = registry

	manifest, err := Assemble(context.Background(), req)
	if err != nil {
		t.Fatalf("Assemble: %v", err)
	}
	for _, file := range manifest.Files {
		if !file.Tagged {
			t.Errorf("%s: not reported tagged with a matching Packager row registered", file.Name)
		}
		body, err := os.ReadFile(file.DestPath)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(body), "tag narrator=Suite") || !strings.Contains(string(body), "tag title=My Book") {
			t.Errorf("%s: does not carry the embedded tags: %q", file.Name, body)
		}
	}
}

func TestAssembleCancelledContextStopsBeforeWritingMore(t *testing.T) {
	req := acxRequest(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Assemble(ctx, req); err == nil {
		t.Fatal("expected a refusal for a cancelled context")
	}
}
