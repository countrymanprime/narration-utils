package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
	"github.com/countrymanprime/narration-utils/shell/internal/teleprompter"
)

// newHostForPunchTest is newHostWithARunningTeleprompter (teleprompter_test.go) plus host.config.projectFolder, which
// resolvePunch needs to find the chapter's anchors file: the two name the same REAPER project folder in real use, but
// the shared fixture only ever set the teleprompter service's own Config.Project.
func newHostForPunchTest(t *testing.T) (*Host, string) {
	t.Helper()
	t.Setenv(fakeTeleprompterEnv, "1")
	project := t.TempDir()
	manuscriptPath := filepath.Join(project, "narration-utils", "manuscript", "manuscript.json")
	if err := os.MkdirAll(filepath.Dir(manuscriptPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manuscriptPath, []byte(`{}`), 0o600); err != nil {
		t.Fatal(err)
	}
	host := NewHost()
	host.config.projectFolder = project
	host.teleprompter = teleprompter.New(teleprompter.Config{Project: project, SessionDir: t.TempDir(), Python: os.Args[0]}, host.sidecars, host.emitTeleprompterEvent, host.emitTeleprompterState)
	t.Cleanup(func() {
		_ = host.teleprompter.Close(context.Background())
		_ = host.sidecars.Close()
	})
	if err := host.teleprompter.Start(map[string]string{"chapter": "c1", "device": "Mic", "model": "tiny"}); err != nil {
		t.Fatal(err)
	}
	return host, project
}

func TestPunchPreRollFallsBackToDefaultWhenNoStoreIsConfigured(t *testing.T) {
	if got := punchPreRoll(hostServices{}); got != defaultPunchPreRoll {
		t.Fatalf("punchPreRoll = %v, want %v", got, defaultPunchPreRoll)
	}
}

func TestPunchPreRollReadsTheRepoDefault(t *testing.T) {
	host, _ := newHostForPunchTest(t)
	if got := punchPreRoll(host.services()); got != 3 {
		t.Fatalf("punchPreRoll = %v, want 3 (the repo default)", got)
	}
}

func TestPunchPreRollReadsANarratorOverride(t *testing.T) {
	host, _ := newHostForPunchTest(t)
	value := "5.5"
	if err := host.services().settings.Save("Teleprompter", "global", map[string]*string{"punch_preroll_seconds": &value}); err != nil {
		t.Fatal(err)
	}
	if got := punchPreRoll(host.services()); got != 5.5 {
		t.Fatalf("punchPreRoll = %v, want 5.5", got)
	}
}

func TestPunchPreRollFallsBackOnAnUnparseableStoredValue(t *testing.T) {
	host, _ := newHostForPunchTest(t)
	value := "not-a-number"
	if err := host.services().settings.Save("Teleprompter", "global", map[string]*string{"punch_preroll_seconds": &value}); err != nil {
		t.Fatal(err)
	}
	if got := punchPreRoll(host.services()); got != defaultPunchPreRoll {
		t.Fatalf("punchPreRoll = %v, want the default %v on a corrupt value", got, defaultPunchPreRoll)
	}
}

func TestResolvePunchWithNoProjectIsRefused(t *testing.T) {
	if _, _, _, _, err := resolvePunch(hostServices{}, 5, nil); err != errNoProject {
		t.Fatalf("resolvePunch error = %v, want errNoProject", err)
	}
}

func TestResolvePunchWithNoLiveChapterIsRefused(t *testing.T) {
	svc := hostServices{}
	svc.config.projectFolder = t.TempDir()
	if _, _, _, _, err := resolvePunch(svc, 5, nil); err != ErrNoLiveChapter {
		t.Fatalf("resolvePunch error = %v, want ErrNoLiveChapter", err)
	}
}

func TestResolvePunchWithNoAnchorsIsRefused(t *testing.T) {
	host, _ := newHostForPunchTest(t)
	if _, _, _, _, err := resolvePunch(host.services(), 5, nil); err != ErrNoPunchAnchor {
		t.Fatalf("resolvePunch error = %v, want ErrNoPunchAnchor", err)
	}
}

func TestResolvePunchInterpolatesFromRecordedAnchorsOfTheLiveChapter(t *testing.T) {
	host, project := newHostForPunchTest(t)
	for _, anchor := range []teleprompter.Anchor{{Word: 0, Position: 0}, {Word: 10, Position: 5}} {
		if err := teleprompter.AppendAnchor(project, "c1", anchor); err != nil {
			t.Fatal(err)
		}
	}
	chapterID, position, source, preRoll, err := resolvePunch(host.services(), 4, nil)
	if err != nil {
		t.Fatal(err)
	}
	if chapterID != "c1" || position != 2 || source != teleprompter.SourceAnchor || preRoll != 3 {
		t.Fatalf("resolvePunch = %q, %v, %q, %v", chapterID, position, source, preRoll)
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
	host, project := newHostForPunchTest(t)
	if err := teleprompter.AppendAnchor(project, "c1", teleprompter.Anchor{Word: 3, Position: 1.5}); err != nil {
		t.Fatal(err)
	}
	// dawPortResolver is deliberately left nil: a preview must never need REAPER at all.

	raw, err := host.TeleprompterPunchPreview(3)
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
	host, project := newHostForPunchTest(t)
	for _, anchor := range []teleprompter.Anchor{{Word: 1, Position: 0.5}, {Word: 3, Position: 1.5}, {Word: 9, Position: 4.5}} {
		if err := teleprompter.AppendAnchor(project, "c1", anchor); err != nil {
			t.Fatal(err)
		}
	}
	puncher := &fakePuncherStub{cursor: 1.5 - defaultPunchPreRoll}
	host.dawPortResolver = dawport.NewResolver(dawport.ResolverConfig{
		Adapter: fakePuncherAdapter{puncher: puncher},
		Runtime: func() dawport.Runtime { return dawport.Runtime{Bridge: true, Reachable: true} },
	})

	raw, err := host.TeleprompterPunch(3)
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
	host, project := newHostForPunchTest(t)
	if err := teleprompter.AppendAnchor(project, "c1", teleprompter.Anchor{Word: 3, Position: 1.5}); err != nil {
		t.Fatal(err)
	}
	// dawPortResolver stays nil: no bridge at all.

	raw, err := host.TeleprompterPunch(3)
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

func decodedPunch(t *testing.T, raw string, err error) TeleprompterPunchResult {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
	var result TeleprompterPunchResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

// The bindings' answers, pinned for the UI's schema (ADR 0069): one of each outcome.
func TestContractTeleprompterPunchResults(t *testing.T) {
	answers := map[string]TeleprompterPunchResult{}

	withAnchors, project := newHostForPunchTest(t)
	for _, anchor := range []teleprompter.Anchor{{Word: 0, Position: 0}, {Word: 10, Position: 5}} {
		if err := teleprompter.AppendAnchor(project, "c1", anchor); err != nil {
			t.Fatal(err)
		}
	}
	resolvedAnchorRaw, resolvedAnchorErr := withAnchors.TeleprompterPunchPreview(4)
	answers["resolved_anchor"] = decodedPunch(t, resolvedAnchorRaw, resolvedAnchorErr)
	// Past the anchors, with no track for the chapter to align: the anchors' pace estimate.
	resolvedEstimateRaw, resolvedEstimateErr := withAnchors.TeleprompterPunchPreview(14)
	answers["resolved_estimate"] = decodedPunch(t, resolvedEstimateRaw, resolvedEstimateErr)

	// Past the anchors, timed from the chapter's recording by the offline alignment (teleprompterpunchalign.go).
	aligned := newPunchAlignHost(t, true)
	resolvedAlignmentRaw, resolvedAlignmentErr := aligned.host.TeleprompterPunchPreview(30)
	answers["resolved_alignment"] = decodedPunch(t, resolvedAlignmentRaw, resolvedAlignmentErr)

	noAnchors, _ := newHostForPunchTest(t)
	noAnchorRaw, noAnchorErr := noAnchors.TeleprompterPunchPreview(5)
	answers["refused_no_anchor"] = decodedPunch(t, noAnchorRaw, noAnchorErr)

	noChapter := &Host{}
	noChapter.settings = settings.New("", "")
	noChapter.config.projectFolder = project
	noChapterRaw, noChapterErr := noChapter.TeleprompterPunchPreview(4)
	answers["refused_no_chapter"] = decodedPunch(t, noChapterRaw, noChapterErr)

	puncherHost, puncherProject := newHostForPunchTest(t)
	if err := teleprompter.AppendAnchor(puncherProject, "c1", teleprompter.Anchor{Word: 3, Position: 1.5}); err != nil {
		t.Fatal(err)
	}
	puncherHost.dawPortResolver = dawport.NewResolver(dawport.ResolverConfig{
		Adapter: fakePuncherAdapter{puncher: &fakePuncherStub{cursor: -1.5}},
		Runtime: func() dawport.Runtime { return dawport.Runtime{Bridge: true, Reachable: true} },
	})
	punchedRaw, punchedErr := puncherHost.TeleprompterPunch(3)
	answers["punched"] = decodedPunch(t, punchedRaw, punchedErr)

	noDawHost, noDawProject := newHostForPunchTest(t)
	if err := teleprompter.AppendAnchor(noDawProject, "c1", teleprompter.Anchor{Word: 3, Position: 1.5}); err != nil {
		t.Fatal(err)
	}
	noDawRaw, noDawErr := noDawHost.TeleprompterPunch(3)
	answers["refused_no_daw"] = decodedPunch(t, noDawRaw, noDawErr)

	contractfile.Check(t, "teleprompter-punch-results", answers)
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
