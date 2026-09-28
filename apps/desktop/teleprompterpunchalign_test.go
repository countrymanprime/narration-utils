package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/process"
	"github.com/countrymanprime/narration-utils/shell/internal/teleprompter"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// fakeAlignMissEnv, when set, makes the fake `--align-word` sidecar answer that the word is not in the stretch.
const fakeAlignMissEnv = "SHELL_FAKE_TELEPROMPTER_ALIGN_MISS"

// runFakeTeleprompterAlign stands in for the sidecar's `--align-word` mode (align_word.py): it records its arguments in
// the locate's own arguments file (appending, so a test can count the runs) and answers that the word starts one
// second into the stretch it was given, the shape the Python contract test pins (teleprompter-word-time.json).
func runFakeTeleprompterAlign() bool {
	if len(os.Args) < 3 || os.Args[1] != "--align-word" {
		return false
	}
	if path := os.Getenv(fakeLocateArgsEnv); path != "" {
		file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
		if err == nil {
			_, _ = file.WriteString(strings.Join(os.Args[1:], " ") + "\n")
			_ = file.Close()
		}
	}
	from, _ := strconv.ParseFloat(fakeArg("--tail-start"), 64)
	if os.Getenv(fakeAlignMissEnv) != "" {
		fmt.Printf(`{"type":"word_time","word":%s,"time":null,"exact":false,"matched":2,"heard":9,"tokens":2196}`+"\n", os.Args[2])
		return true
	}
	fmt.Printf(`{"type":"word_time","word":%s,"time":%g,"exact":true,"matched":30,"heard":32,"tokens":2196}`+"\n", os.Args[2], from+1)
	return true
}

// --- resolvePunch's order: anchors, then the recording, then the anchors' pace ---

// fakeAligner is a punchAligner that records what it was asked.
type fakeAligner struct {
	position float64
	found    bool
	calls    int
	estimate *float64
}

func (f *fakeAligner) align(_ string, _ int, estimate *float64) (float64, bool) {
	f.calls++
	f.estimate = estimate
	return f.position, f.found
}

func punchHostWithAnchors(t *testing.T, anchors ...teleprompter.Anchor) *Host {
	t.Helper()
	host, project := newHostForPunchTest(t)
	for _, anchor := range anchors {
		if err := teleprompter.AppendAnchor(project, "c1", anchor); err != nil {
			t.Fatal(err)
		}
	}
	return host
}

func TestResolvePunchNeverAlignsAWordItsAnchorsBracket(t *testing.T) {
	host := punchHostWithAnchors(t, teleprompter.Anchor{Word: 0, Position: 0}, teleprompter.Anchor{Word: 10, Position: 5})
	aligner := &fakeAligner{position: 99, found: true}

	_, position, source, _, err := resolvePunch(host.services(), 4, aligner.align)

	if err != nil || position != 2 || source != teleprompter.SourceAnchor || aligner.calls != 0 {
		t.Fatalf("resolvePunch = %v, %q, %v; aligner called %d times", position, source, err, aligner.calls)
	}
}

func TestResolvePunchAlignsAWordPastTheAnchorsAroundTheirEstimate(t *testing.T) {
	host := punchHostWithAnchors(t, teleprompter.Anchor{Word: 0, Position: 0}, teleprompter.Anchor{Word: 10, Position: 5})
	aligner := &fakeAligner{position: 7.25, found: true}

	_, position, source, _, err := resolvePunch(host.services(), 14, aligner.align)

	if err != nil || position != 7.25 || source != teleprompter.SourceAlignment {
		t.Fatalf("resolvePunch = %v, %q, %v", position, source, err)
	}
	if aligner.estimate == nil || *aligner.estimate != 7 {
		t.Fatalf("the aligner was given estimate %v, want the anchors' pace estimate 7", aligner.estimate)
	}
}

func TestResolvePunchFallsBackToThePaceEstimateWhenTheRecordingCannotAnswer(t *testing.T) {
	host := punchHostWithAnchors(t, teleprompter.Anchor{Word: 0, Position: 0}, teleprompter.Anchor{Word: 10, Position: 5})
	aligner := &fakeAligner{}

	_, position, source, _, err := resolvePunch(host.services(), 14, aligner.align)

	if err != nil || position != 7 || source != teleprompter.SourceEstimate || aligner.calls != 1 {
		t.Fatalf("resolvePunch = %v, %q, %v", position, source, err)
	}
}

func TestResolvePunchAlignsAWordWithNoAnchorsAtAll(t *testing.T) {
	host := punchHostWithAnchors(t)
	aligner := &fakeAligner{position: 3.5, found: true}

	_, position, source, _, err := resolvePunch(host.services(), 5, aligner.align)

	if err != nil || position != 3.5 || source != teleprompter.SourceAlignment || aligner.estimate != nil {
		t.Fatalf("resolvePunch = %v, %q, %v (estimate %v)", position, source, err, aligner.estimate)
	}
}

func TestResolvePunchWithNoAnchorsAndNoAlignmentIsRefused(t *testing.T) {
	host := punchHostWithAnchors(t)

	if _, _, _, _, err := resolvePunch(host.services(), 5, (&fakeAligner{}).align); err != ErrNoPunchAnchor {
		t.Fatalf("err = %v, want ErrNoPunchAnchor", err)
	}
}

// --- which stretch of the recording is decoded ---

func TestAPunchItemMapsProjectTimeOntoItsSourceAndBack(t *testing.T) {
	item := punchItem{Position: 12, Length: 5, SourceStart: 2, Rate: 1.5}

	if got := item.toSource(14); got != 5 {
		t.Fatalf("toSource(14) = %v, want 5", got)
	}
	if got := item.toProject(5); got != 14 {
		t.Fatalf("toProject(5) = %v, want 14", got)
	}
}

func TestPickPunchStretchCentresOnTheEstimateInsideItsItem(t *testing.T) {
	items := []punchItem{{Position: 0, Length: 600, Rate: 1}, {Position: 700, Length: 50, Rate: 1}}
	estimate := 300.0

	item, from, to, ok := pickPunchStretch(items, &estimate)

	if !ok || item.Position != 0 || from != 240 || to != 360 {
		t.Fatalf("stretch = %+v %v-%v %v", item, from, to, ok)
	}
}

func TestPickPunchStretchKeepsTheFullLengthWhenTheEstimateIsNearAnItemsEdge(t *testing.T) {
	items := []punchItem{{Position: 100, Length: 600, Rate: 1}}
	for estimate, want := range map[float64][2]float64{110: {100, 220}, 690: {580, 700}} {
		value := estimate
		_, from, to, ok := pickPunchStretch(items, &value)
		if !ok || from != want[0] || to != want[1] {
			t.Fatalf("estimate %v: stretch %v-%v, want %v", estimate, from, to, want)
		}
	}
}

func TestPickPunchStretchTakesTheItemOnTopWhereTwoOverlap(t *testing.T) {
	items := []punchItem{{Position: 0, Length: 100, Rate: 1, File: "under"}, {Position: 40, Length: 20, Rate: 1, File: "top"}}
	estimate := 50.0

	item, from, to, ok := pickPunchStretch(items, &estimate)

	if !ok || item.File != "top" || from != 40 || to != 60 {
		t.Fatalf("stretch = %+v %v-%v", item, from, to)
	}
}

func TestPickPunchStretchWithNoEstimateReadsTheTailOfTheLastItem(t *testing.T) {
	items := []punchItem{{Position: 0, Length: 600, Rate: 1, File: "first"}, {Position: 700, Length: 300, Rate: 1, File: "last"}}
	outside := 650.0

	for _, estimate := range []*float64{nil, &outside} {
		item, from, to, ok := pickPunchStretch(items, estimate)
		if !ok || item.File != "last" || from != 1000-teleprompter.MaxTailSeconds || to != 1000 {
			t.Fatalf("estimate %v: stretch = %+v %v-%v", estimate, item, from, to)
		}
	}
	if _, _, _, ok := pickPunchStretch(nil, nil); ok {
		t.Fatal("no items should give no stretch")
	}
}

func TestSavedPunchItemsSkipWhatCannotBeDecoded(t *testing.T) {
	track := &tracks.Track{Items: []tracks.Item{
		{Position: 0, Length: 10, SourceFile: "ok.wav", SourceAvailable: true, Supported: true, SourceStart: 1, PlayRate: 0, TakeGUID: "t1", Takes: []tracks.Take{{GUID: "t1"}}},
		{Position: 10, Length: 10, SourceFile: "muted.wav", SourceAvailable: true, Supported: true, Muted: true},
		{Position: 20, Length: 10, SourceFile: "gone.wav", Supported: true},
		{Position: 30, Length: 10, SourceFile: "stretched.wav", SourceAvailable: true, Supported: true, TakeGUID: "t4", Takes: []tracks.Take{{GUID: "t4", StretchMarkerCount: 2}}},
		{Position: 40, Length: 10, SourceFile: "outside.wav", SourceAvailable: true, Supported: true},
	}}

	items := savedPunchItems(track, &tracks.Span{Start: 0, End: 40})

	if len(items) != 1 || items[0].File != "ok.wav" || items[0].Rate != 1 || items[0].SourceStart != 1 {
		t.Fatalf("items = %+v", items)
	}
	if savedPunchItems(nil, nil) != nil {
		t.Fatal("no saved track should give no items")
	}
}

// --- the whole fallback against the chapter-match project and the fake sidecar ---

// newPunchAlignHost is the locate host (Alice's Chapter I on a track whose second item sits at 12-17 s and plays
// source seconds 2 to 9.5 at rate 1.5) with a live session reading Chapter I, so "Punch from here" has a chapter.
func newPunchAlignHost(t *testing.T, install bool) locateHost {
	t.Helper()
	f := newTestHostForLocate(t, install)
	host := f.host
	supervisor := process.NewSupervisor()
	host.teleprompter = teleprompter.New(teleprompter.Config{Project: host.config.projectFolder, SessionDir: t.TempDir(), Python: os.Args[0]}, supervisor, host.emitTeleprompterEvent, host.emitTeleprompterState)
	t.Cleanup(func() {
		_ = host.teleprompter.Close(context.Background())
		_ = supervisor.Close()
	})
	if err := host.teleprompter.Start(map[string]string{"chapter": f.chapters[0], "device": "Mic", "model": "tiny"}); err != nil {
		t.Fatal(err)
	}
	for _, anchor := range []teleprompter.Anchor{{Word: 0, Position: 0}, {Word: 10, Position: 5}} {
		if err := teleprompter.AppendAnchor(host.config.projectFolder, f.chapters[0], anchor); err != nil {
			t.Fatal(err)
		}
	}
	return f
}

func (f locateHost) alignRuns(t *testing.T) []string {
	t.Helper()
	var runs []string
	for _, line := range f.sidecarArgs(t) {
		if strings.HasPrefix(line, "--align-word") {
			runs = append(runs, line)
		}
	}
	return runs
}

func TestPunchPreviewTimesAWordPastTheAnchorsFromTheRecording(t *testing.T) {
	f := newPunchAlignHost(t, true)

	// Word 30's pace estimate is 15 s, inside the item at 12-17 s: the whole item is decoded (source 2 to 9.5), the
	// fake hears the word 1 s into it (source 3), which is project time 12 + (3 - 2) / 1.5.
	result := punchOf(t, f.host.TeleprompterPunchPreview, 30)

	if result.Outcome != "resolved" || result.Source != teleprompter.SourceAlignment || result.ResolvedTime == nil {
		t.Fatalf("preview = %+v", result)
	}
	if got, want := *result.ResolvedTime, 12+1/1.5; got < want-1e-9 || got > want+1e-9 {
		t.Fatalf("resolved time = %v, want %v", got, want)
	}
	runs := f.alignRuns(t)
	media := filepath.Join(f.host.config.projectFolder, "media", "ch1.wav")
	if len(runs) != 1 || !strings.Contains(runs[0], "--align-word 30 --engine whisper --model tiny") || !strings.Contains(runs[0], "--wav "+media+" --tail-start 2.000 --tail-end 9.500") {
		t.Fatalf("sidecar runs = %q", runs)
	}
}

func TestPunchAfterItsPreviewReusesTheAlignment(t *testing.T) {
	f := newPunchAlignHost(t, true)
	puncher := &fakePuncherStub{cursor: 9.667}
	f.host.dawPortResolver = dawport.NewResolver(dawport.ResolverConfig{
		Adapter: fakePuncherAdapter{puncher: puncher},
		Runtime: func() dawport.Runtime { return dawport.Runtime{Bridge: true, Reachable: true} },
	})

	preview := punchOf(t, f.host.TeleprompterPunchPreview, 30)
	punched := punchOf(t, f.host.TeleprompterPunch, 30)

	if punched.Outcome != "punched" || punched.Source != teleprompter.SourceAlignment || *punched.ResolvedTime != *preview.ResolvedTime {
		t.Fatalf("punch = %+v after preview %+v", punched, preview)
	}
	if puncher.gotWordTime != *preview.ResolvedTime {
		t.Fatalf("PunchTo(%v), want the aligned time %v", puncher.gotWordTime, *preview.ResolvedTime)
	}
	if runs := f.alignRuns(t); len(runs) != 1 {
		t.Fatalf("the sidecar ran %d times, want once for the preview and the punch", len(runs))
	}
}

func TestPunchPreviewFallsBackToTheEstimateWhenTheWordIsNotInTheRecording(t *testing.T) {
	f := newPunchAlignHost(t, true)
	t.Setenv(fakeAlignMissEnv, "1")

	result := punchOf(t, f.host.TeleprompterPunchPreview, 30)

	if result.Source != teleprompter.SourceEstimate || *result.ResolvedTime != 15 {
		t.Fatalf("preview = %+v", result)
	}
}

func TestPunchPreviewNeverDownloadsAModelToAlign(t *testing.T) {
	f := newPunchAlignHost(t, false)

	result := punchOf(t, f.host.TeleprompterPunchPreview, 30)

	if result.Source != teleprompter.SourceEstimate || len(f.alignRuns(t)) != 0 {
		t.Fatalf("preview = %+v, sidecar runs %q", result, f.alignRuns(t))
	}
}

func TestPunchAlignmentReadsREAPERsLiveItemsAndNeverAlignsWhileRecording(t *testing.T) {
	f := newPunchAlignHost(t, true)
	state := f.liveChapterOne(t, 5)
	align := f.host.punchAlignerFor(f.host.services(), &fakeTrackState{state: state})

	// With no estimate the stretch is the tail of the item that ends last live: the take recorded after the last save,
	// at 20-26 s, which the saved project does not have.
	position, ok := align(f.chapters[0], 30, nil)
	if !ok || position != 21 {
		t.Fatalf("aligned = %v, %v; want 21 (one second into the new take)", position, ok)
	}
	newTake := filepath.Join(f.host.config.projectFolder, "media", "ch1-new.wav")
	if runs := f.alignRuns(t); len(runs) != 1 || !strings.Contains(runs[0], "--wav "+newTake+" --tail-start 0.000 --tail-end 6.000") {
		t.Fatalf("sidecar runs = %q", runs)
	}

	state.Recording, state.TrackArmed = true, true
	recording := f.host.punchAlignerFor(f.host.services(), &fakeTrackState{state: state})
	if _, ok := recording(f.chapters[0], 31, nil); ok || len(f.alignRuns(t)) != 1 {
		t.Fatalf("aligned while REAPER records onto the track (runs %q)", f.alignRuns(t))
	}
}

func TestPunchAlignmentWithNoTrackForTheChapterAnswersNothing(t *testing.T) {
	f := newPunchAlignHost(t, true)

	if _, ok := f.host.punchAlignerFor(f.host.services(), nil)(f.chapters[2], 30, nil); ok || len(f.alignRuns(t)) != 0 {
		t.Fatal("a chapter with no track was aligned")
	}
	if _, ok := (&Host{}).punchAlignerFor(hostServices{}, nil)(f.chapters[0], 30, nil); ok {
		t.Fatal("a host with no teleprompter service aligned")
	}
}

// punchOf calls a punch binding for word and decodes its answer.
func punchOf(t *testing.T, binding func(int) (string, error), word int) TeleprompterPunchResult {
	t.Helper()
	raw, err := binding(word)
	return decodedPunch(t, raw, err)
}
