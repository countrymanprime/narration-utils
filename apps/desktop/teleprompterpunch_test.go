package main

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
	"github.com/countrymanprime/narration-utils/shell/internal/teleprompter"
)

func punchTestServices(t *testing.T, project string) hostServices {
	t.Helper()
	t.Setenv("APPDATA", filepath.Join(t.TempDir(), "appdata"))
	svc := hostServices{settings: settings.New("", "")}
	svc.config.projectFolder = project
	return svc
}

func TestPunchPreRollFallsBackToDefaultWhenNoStoreIsConfigured(t *testing.T) {
	if got := punchPreRoll(hostServices{}); got != defaultPunchPreRoll {
		t.Fatalf("punchPreRoll = %v, want %v", got, defaultPunchPreRoll)
	}
}

func TestPunchPreRollReadsTheRepoDefault(t *testing.T) {
	svc := punchTestServices(t, t.TempDir())
	if got := punchPreRoll(svc); got != 3 {
		t.Fatalf("punchPreRoll = %v, want 3 (the repo default)", got)
	}
}

func TestPunchPreRollReadsANarratorOverride(t *testing.T) {
	svc := punchTestServices(t, t.TempDir())
	value := "5.5"
	if err := svc.settings.Save("Teleprompter", "global", map[string]*string{"punch_preroll_seconds": &value}); err != nil {
		t.Fatal(err)
	}
	if got := punchPreRoll(svc); got != 5.5 {
		t.Fatalf("punchPreRoll = %v, want 5.5", got)
	}
}

func TestPunchPreRollFallsBackOnAnUnparseableStoredValue(t *testing.T) {
	svc := punchTestServices(t, t.TempDir())
	value := "not-a-number"
	if err := svc.settings.Save("Teleprompter", "global", map[string]*string{"punch_preroll_seconds": &value}); err != nil {
		t.Fatal(err)
	}
	if got := punchPreRoll(svc); got != defaultPunchPreRoll {
		t.Fatalf("punchPreRoll = %v, want the default %v on a corrupt value", got, defaultPunchPreRoll)
	}
}

func TestResolvePunchWithNoProjectIsRefused(t *testing.T) {
	if _, _, _, err := resolvePunch(hostServices{}, "c1", 5); err != errNoProject {
		t.Fatalf("resolvePunch error = %v, want errNoProject", err)
	}
}

func TestResolvePunchWithNoAnchorsIsRefused(t *testing.T) {
	svc := punchTestServices(t, t.TempDir())
	if _, _, _, err := resolvePunch(svc, "c1", 5); err != ErrNoPunchAnchor {
		t.Fatalf("resolvePunch error = %v, want ErrNoPunchAnchor", err)
	}
}

func TestResolvePunchInterpolatesFromRecordedAnchors(t *testing.T) {
	project := t.TempDir()
	svc := punchTestServices(t, project)
	for _, anchor := range []teleprompter.Anchor{{Word: 0, Position: 0}, {Word: 10, Position: 5}} {
		if err := teleprompter.AppendAnchor(project, "c1", anchor); err != nil {
			t.Fatal(err)
		}
	}
	position, source, preRoll, err := resolvePunch(svc, "c1", 4)
	if err != nil {
		t.Fatal(err)
	}
	if position != 2 || source != teleprompter.SourceAnchor || preRoll != 3 {
		t.Fatalf("resolvePunch = %v, %q, %v", position, source, preRoll)
	}
}

// fakePuncherAdapter is a minimal dawport.Adapter declaring only CapPunch, so TeleprompterPunch's dawport.Role call
// resolves to a Puncher this test controls directly, with no REAPER bridge or Lua harness involved.
type fakePuncherAdapter struct{ puncher *fakePuncherStub }

func (fakePuncherAdapter) Kind() dawport.Kind { return dawport.KindREAPER }
func (fakePuncherAdapter) Declares() map[dawport.Capability]dawport.Level {
	return map[dawport.Capability]dawport.Level{dawport.CapPunch: dawport.Supported}
}
func (f fakePuncherAdapter) Role(c dawport.Capability) any {
	if c == dawport.CapPunch {
		return f.puncher
	}
	return nil
}

func TestTeleprompterPunchPreviewNeverMovesAnything(t *testing.T) {
	project := t.TempDir()
	if err := teleprompter.AppendAnchor(project, "c1", teleprompter.Anchor{Word: 3, Position: 1.5}); err != nil {
		t.Fatal(err)
	}
	host := &Host{}
	host.settings = settings.New("", "")
	host.config.projectFolder = project
	t.Setenv("APPDATA", filepath.Join(t.TempDir(), "appdata"))
	// dawPortResolver is deliberately left nil: a preview must never need REAPER at all.

	raw, err := host.TeleprompterPunchPreview("c1", 3)
	if err != nil {
		t.Fatal(err)
	}
	var result TeleprompterPunchResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	if result.Outcome != "resolved" || result.ResolvedTime == nil || *result.ResolvedTime != 1.5 || result.Source != teleprompter.SourceAnchor {
		t.Fatalf("TeleprompterPunchPreview = %+v", result)
	}
	if result.PreRoll == nil || *result.PreRoll != defaultPunchPreRoll {
		t.Fatalf("PreRoll = %v, want %v", result.PreRoll, defaultPunchPreRoll)
	}
}

func TestTeleprompterPunchMovesTheCursorAndDropsAnchorsAtOrAfterTheWord(t *testing.T) {
	project := t.TempDir()
	for _, anchor := range []teleprompter.Anchor{{Word: 1, Position: 0.5}, {Word: 3, Position: 1.5}, {Word: 9, Position: 4.5}} {
		if err := teleprompter.AppendAnchor(project, "c1", anchor); err != nil {
			t.Fatal(err)
		}
	}
	puncher := &fakePuncherStub{cursor: 1.5 - defaultPunchPreRoll}
	host := &Host{}
	host.settings = settings.New("", "")
	host.config.projectFolder = project
	host.dawPortResolver = dawport.NewResolver(dawport.ResolverConfig{Adapter: fakePuncherAdapter{puncher: puncher}})
	t.Setenv("APPDATA", filepath.Join(t.TempDir(), "appdata"))

	raw, err := host.TeleprompterPunch("c1", 3)
	if err != nil {
		t.Fatal(err)
	}
	var result TeleprompterPunchResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	if result.Outcome != "punched" || result.Cursor == nil || *result.Cursor != puncher.cursor {
		t.Fatalf("TeleprompterPunch = %+v", result)
	}
	if result.ResolvedTime == nil || *result.ResolvedTime != 1.5 {
		t.Fatalf("ResolvedTime = %v, want 1.5", result.ResolvedTime)
	}
	if !puncher.called {
		t.Fatal("PunchTo was never called")
	}
	if puncher.gotWordTime != 1.5 || puncher.gotPreRoll != defaultPunchPreRoll {
		t.Fatalf("PunchTo(%v, %v), want (1.5, %v)", puncher.gotWordTime, puncher.gotPreRoll, defaultPunchPreRoll)
	}

	anchors, err := teleprompter.LoadAnchors(project, "c1")
	if err != nil {
		t.Fatal(err)
	}
	if len(anchors) != 1 || anchors[0].Word != 1 {
		t.Fatalf("anchors after punch = %+v, want only word 1 kept", anchors)
	}
}

func TestTeleprompterPunchIsRefusedWithNoDawConnection(t *testing.T) {
	project := t.TempDir()
	if err := teleprompter.AppendAnchor(project, "c1", teleprompter.Anchor{Word: 3, Position: 1.5}); err != nil {
		t.Fatal(err)
	}
	host := &Host{}
	host.settings = settings.New("", "")
	host.config.projectFolder = project
	t.Setenv("APPDATA", filepath.Join(t.TempDir(), "appdata"))
	// dawPortResolver stays nil: no bridge at all.

	raw, err := host.TeleprompterPunch("c1", 3)
	if err != nil {
		t.Fatal(err)
	}
	var result TeleprompterPunchResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	if result.Outcome != "refused" || result.Cursor != nil {
		t.Fatalf("TeleprompterPunch = %+v, want a refusal that moved nothing", result)
	}
}

type fakePuncherStub struct {
	cursor                  float64
	called                  bool
	gotWordTime, gotPreRoll float64
}

func (f *fakePuncherStub) PunchTo(_ context.Context, wordTime, preRoll float64) (float64, error) {
	f.called, f.gotWordTime, f.gotPreRoll = true, wordTime, preRoll
	return f.cursor, nil
}
func (f *fakePuncherStub) PlayPosition(context.Context) (dawport.PlayPosition, error) {
	return dawport.PlayPosition{}, nil
}
