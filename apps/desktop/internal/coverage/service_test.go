package coverage

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
)

func latestRecord(t *testing.T, p *testProject) evidence.LedgerRecord {
	t.Helper()
	record, ok := evidence.NewLedgerStore(p.dir).Latest(AnalyzerID, testChapter)
	if !ok {
		t.Fatal("no ledger record was written")
	}
	return record
}

func recordCount(t *testing.T, p *testProject) int {
	t.Helper()
	records, err := evidence.NewLedgerStore(p.dir).List(AnalyzerID, "")
	if err != nil {
		t.Fatal(err)
	}
	return len(records)
}

func currentResult(t *testing.T, service *Service, alignment AlignmentParams) ChapterResult {
	t.Helper()
	result, err := service.Result(testChapter, alignment)
	if err != nil {
		t.Fatalf("Result: %v", err)
	}
	return result
}

func TestAFreshRunTranscribesEveryItemAndWritesACompleteRecordAndResult(t *testing.T) {
	p := newTestProject(t)
	sidecar := &fakeSidecar{present: 8}
	service := p.service(sidecar)

	state := run(t, service, testRequest())

	if state.Phase != PhaseComplete || state.Percent != 100 || state.Message != "Text present: 8 of 10 words." {
		t.Fatalf("state = %+v", state)
	}
	if got := sidecar.transcriptions(); !slices.Equal(got, []string{"{ITEM-A}", "{ITEM-B}"}) {
		t.Fatalf("transcribed %v, want both items", got)
	}
	record := latestRecord(t, p)
	if record.Outcome != evidence.LedgerComplete || record.ID != state.RecordID {
		t.Fatalf("record = %+v", record)
	}
	if scope := record.Scope; scope.DocumentID != testDocument || scope.ChapterID != testChapter || scope.TrackGUID != testTrack ||
		!slices.Equal(record.Scope.ItemGUIDs, []string{"{ITEM-A}", "{ITEM-B}"}) {
		t.Fatalf("scope = %+v", record.Scope)
	}
	if record.Counts["presentTokens"] != 8 || record.Counts["bodyTokens"] != 10 || record.Counts["itemsListed"] != 2 || record.Counts["wordsStored"] != 2 || record.Counts["itemsSeeded"] != 0 {
		t.Fatalf("counts = %v", record.Counts)
	}
	if len(record.Fingerprint.ItemFingerprints) != 2 || record.Fingerprint.TrackFingerprint == "" {
		t.Fatalf("fingerprint = %+v", record.Fingerprint)
	}
	if record.ProjectFile.Path != p.rpp || record.ProjectFile.ModTime.IsZero() {
		t.Fatalf("project file = %+v", record.ProjectFile)
	}
	if _, err := os.Stat(runsDir(p.dir)); err == nil {
		entries, _ := os.ReadDir(runsDir(p.dir))
		if len(entries) != 0 {
			t.Fatalf("the run folder was left behind: %v", entries)
		}
	}

	result := currentResult(t, service, DefaultAlignmentParams)
	if !result.Current() || result.Result.Report.PresentFraction() != 0.8 || result.Result.Model != "small" || result.Result.ManuscriptHash == "" {
		t.Fatalf("result = %+v", result)
	}
	if !strings.HasPrefix(result.Basis.Label, "saved project, file modified ") {
		t.Fatalf("basis = %+v", result.Basis)
	}
	if len(result.Result.Report.Regions) != 1 || result.Result.Report.TextComplete(DefaultThresholds) {
		t.Fatalf("a two-word tail must be reported and fail the default thresholds: %+v", result.Result.Report)
	}
}

func TestTheSidecarIsGivenOnlyPathsBuiltFromTheSavedProject(t *testing.T) {
	p := newTestProject(t)
	sidecar := &fakeSidecar{}
	service := p.service(sidecar)
	request := testRequest()
	request.Transcription = Transcription{Model: "medium", ModelDir: `C:\models\medium`, Language: "en"}
	request.Alignment = AlignmentParams{MaxMisreadRun: 5, MinAnchorRun: 2}

	run(t, service, request)

	sidecar.mu.Lock()
	launch := sidecar.launches[0]
	sidecar.mu.Unlock()
	if launch[0] != "python-sidecar" || launch[1] != "compare.py" || launch[2] != "--coverage" {
		t.Fatalf("launch = %v", launch)
	}
	args := flags(launch)
	for _, name := range []string{"--manifest", "--words-dir", "--out", "--progress"} {
		if !strings.HasPrefix(args[name], runsDir(p.dir)+string(filepath.Separator)) {
			t.Fatalf("%s = %q is not under the run folder", name, args[name])
		}
	}
	if args["--manuscript"] != filepath.Join(p.dir, "narration-utils", "manuscript", "manuscript.json") || args["--chapter-id"] != testChapter {
		t.Fatalf("args = %v", args)
	}
	if args["--model"] != "medium" || args["--model-dir"] != `C:\models\medium` || args["--language"] != "en" || args["--max-misread-run"] != "5" || args["--min-anchor-run"] != "2" {
		t.Fatalf("args = %v", args)
	}
}

func TestTheManifestListsActiveTakesInPlayOrderWithPlayedRangesAndMutedItems(t *testing.T) {
	p := newTestProject(t)
	p.items = []testItem{
		{guid: "{ITEM-B}", source: "media/b.wav", position: 20, length: 4, soffs: 1, playrate: 1.5},
		{guid: "{ITEM-A}", source: "media/a.wav", position: 0, length: 10, soffs: 5, playrate: 1},
		{guid: "{MUTED}", source: "media/a.wav", position: 12, length: 2, soffs: 30, playrate: 1, muted: true},
		{guid: "{MUTED-MIDI}", position: 15, length: 2, playrate: 1, muted: true, kind: "MIDI"},
	}
	p.writeRPP()
	service := p.service(&fakeSidecar{})
	project, _, err := service.savedProject()
	if err != nil {
		t.Fatal(err)
	}

	planned, err := buildPlan(project, testTrack, memoIdentify(p.dir))
	if err != nil {
		t.Fatal(err)
	}

	manifest := planned.manifest()
	want := []ManifestItem{
		{Index: 0, ItemGUID: "{ITEM-A}", SourceFile: filepath.Join(p.dir, "media", "a.wav"), StartOffset: 5, Length: 10},
		{Index: 1, ItemGUID: "{MUTED}", SourceFile: filepath.Join(p.dir, "media", "a.wav"), StartOffset: 30, Length: 2, Muted: true},
		{Index: 2, ItemGUID: "{ITEM-B}", SourceFile: filepath.Join(p.dir, "media", "b.wav"), StartOffset: 1, Length: 6},
	}
	if manifest.SchemaVersion != 1 || len(manifest.Items) != len(want) {
		t.Fatalf("manifest = %+v", manifest)
	}
	for i, item := range manifest.Items {
		name := item.WordsFile
		item.WordsFile = ""
		if item != want[i] {
			t.Fatalf("item %d = %+v, want %+v", i, item, want[i])
		}
		if !strings.HasPrefix(name, "w-") || strings.ContainsAny(name, `/\:`) {
			t.Fatalf("words file %q is not a plain name", name)
		}
	}
	if planned.mutedLeft != 1 || planned.overlapping != 0 {
		t.Fatalf("plan = %+v", planned)
	}
}

func TestOverlappingItemsAreCountedAndTwoItemsPlayingOneRangeShareAWordsFile(t *testing.T) {
	p := newTestProject(t)
	p.items = []testItem{
		{guid: "{ONE}", source: "media/a.wav", position: 0, length: 10, playrate: 1},
		{guid: "{TWO}", source: "media/a.wav", position: 8, length: 10, playrate: 1},
	}
	p.writeRPP()
	sidecar := &fakeSidecar{}
	service := p.service(sidecar)

	run(t, service, testRequest())

	if got := sidecar.transcriptions(); len(got) != 1 {
		t.Fatalf("one played range must be transcribed once, got %v", got)
	}
	if record := latestRecord(t, p); record.Counts["overlappingItems"] != 1 {
		t.Fatalf("counts = %v", record.Counts)
	}
}

func TestAnAllCachedRunTranscribesNothing(t *testing.T) {
	p := newTestProject(t)
	sidecar := &fakeSidecar{}
	service := p.service(sidecar)
	run(t, service, testRequest())

	run(t, service, testRequest())

	if got := sidecar.transcriptions(); len(got) != 2 {
		t.Fatalf("the second run transcribed again: %v", got)
	}
	if record := latestRecord(t, p); record.Counts["itemsSeeded"] != 2 || record.Counts["wordsStored"] != 0 {
		t.Fatalf("counts = %v", record.Counts)
	}
}

func TestAOneItemEditIsStaleAndOnlyThatItemIsTranscribedAgain(t *testing.T) {
	p := newTestProject(t)
	sidecar := &fakeSidecar{}
	service := p.service(sidecar)
	run(t, service, testRequest())
	p.items[1].length = 9 // item B now plays more of its source
	p.writeRPP()

	stale := currentResult(t, service, DefaultAlignmentParams)
	run(t, service, testRequest())

	if stale.State != evidence.StateStale || !slices.Contains(stale.Reasons, string(evidence.ReasonItemTrimmed)) {
		t.Fatalf("after the edit: %+v", stale)
	}
	if got := sidecar.transcriptions(); !slices.Equal(got, []string{"{ITEM-A}", "{ITEM-B}", "{ITEM-B}"}) {
		t.Fatalf("transcribed %v, want only item B again", got)
	}
	if !currentResult(t, service, DefaultAlignmentParams).Current() {
		t.Fatal("the new run must be current")
	}
}

func TestANarrowingTrimAndAMoveReuseTheCachedWords(t *testing.T) {
	p := newTestProject(t)
	sidecar := &fakeSidecar{}
	service := p.service(sidecar)
	run(t, service, testRequest())
	p.items[0].soffs, p.items[0].length = 6, 8 // trimmed on both sides
	p.items[1].position = 40                   // moved
	p.writeRPP()

	run(t, service, testRequest())

	if got := sidecar.transcriptions(); len(got) != 2 {
		t.Fatalf("a narrowing trim or a move transcribed again: %v", got)
	}
}

func TestItemsSharingASourceKeepTheirOwnRangesInTheCache(t *testing.T) {
	p := newTestProject(t)
	p.items = []testItem{
		{guid: "{ONE}", source: "media/a.wav", position: 0, length: 5, soffs: 0, playrate: 1},
		{guid: "{TWO}", source: "media/a.wav", position: 5, length: 5, soffs: 60, playrate: 1},
	}
	p.writeRPP()
	sidecar := &fakeSidecar{}
	service := p.service(sidecar)
	run(t, service, testRequest())

	run(t, service, testRequest())

	if got := sidecar.transcriptions(); len(got) != 2 {
		t.Fatalf("two ranges of one source must both stay cached: %v", got)
	}
}

func TestAMutedItemIsListedButNeverTranscribed(t *testing.T) {
	p := newTestProject(t)
	p.items[1].muted = true
	p.writeRPP()
	sidecar := &fakeSidecar{}
	service := p.service(sidecar)

	run(t, service, testRequest())

	if got := sidecar.transcriptions(); !slices.Equal(got, []string{"{ITEM-A}"}) {
		t.Fatalf("transcribed %v", got)
	}
	record := latestRecord(t, p)
	if !slices.Contains(record.Scope.ItemGUIDs, "{ITEM-B}") {
		t.Fatalf("the muted item must be listed: %+v", record.Scope)
	}
}

func TestCancelKeepsTheFinishedItemsAndRecordsAPartialRun(t *testing.T) {
	p := newTestProject(t)
	sidecar := &fakeSidecar{pauseAfter: 1, paused: make(chan struct{}), resume: make(chan struct{})}
	service := p.service(sidecar)
	if _, err := service.Start(testRequest()); err != nil {
		t.Fatal(err)
	}
	<-sidecar.paused

	service.Cancel()
	close(sidecar.resume)
	service.Wait()

	state := service.State()
	if state.Phase != PhaseCancelled || service.Busy() {
		t.Fatalf("state = %+v", state)
	}
	record := latestRecord(t, p)
	if record.Outcome != evidence.LedgerPartial || record.Counts["wordsStored"] != 1 {
		t.Fatalf("record = %+v", record)
	}
	if result := currentResult(t, service, DefaultAlignmentParams); result.State != evidence.StateNever {
		t.Fatalf("a partial run must never read as current: %+v", result)
	}

	next := &fakeSidecar{}
	nextService := p.service(next)
	run(t, nextService, testRequest())
	if got := next.transcriptions(); !slices.Equal(got, []string{"{ITEM-B}"}) {
		t.Fatalf("after a cancel only the unfinished item is transcribed, got %v", got)
	}
}

func TestAFailedSidecarRecordsAFailedRunWithItsMessage(t *testing.T) {
	p := newTestProject(t)
	service := p.service(&fakeSidecar{exitCode: 1, errorMessage: "The Whisper model could not be loaded."})

	state := run(t, service, testRequest())

	if state.Phase != PhaseFailed || state.Message != "The Whisper model could not be loaded." || service.Busy() {
		t.Fatalf("state = %+v", state)
	}
	if record := latestRecord(t, p); record.Outcome != evidence.LedgerFailed || record.Counts["wordsStored"] != 2 {
		t.Fatalf("record = %+v", record)
	}
	if result := currentResult(t, service, DefaultAlignmentParams); result.State != evidence.StateNever || result.Result != nil {
		t.Fatalf("result = %+v", result)
	}
}

func TestAFailureWithNoMessageNamesTheExitCode(t *testing.T) {
	p := newTestProject(t)
	state := run(t, p.service(&fakeSidecar{exitCode: 3}), testRequest())
	if state.Phase != PhaseFailed || state.Message != "The recording check stopped with exit code 3." {
		t.Fatalf("state = %+v", state)
	}
}

func TestResultsThatCannotBeReadFailTheRun(t *testing.T) {
	p := newTestProject(t)
	state := run(t, p.service(&fakeSidecar{badResults: true}), testRequest())
	if state.Phase != PhaseFailed || !strings.Contains(state.Message, "could not be read") {
		t.Fatalf("state = %+v", state)
	}
	if record := latestRecord(t, p); record.Outcome != evidence.LedgerFailed {
		t.Fatalf("record = %+v", record)
	}
}

func TestAnInputEditedDuringTheRunFailsItInsteadOfRecordingItComplete(t *testing.T) {
	edits := map[string]func(p *testProject){
		"the chapter text": func(p *testProject) { p.writeManuscript(testDocument, "Chapter One", "Something else entirely.") },
		"the equivalences": func(p *testProject) { p.writeFile("TranscriptCompare/equivalences.csv", "grey,gray") },
	}
	for name, edit := range edits {
		t.Run(name, func(t *testing.T) {
			p := newTestProject(t)
			state := run(t, p.service(&fakeSidecar{during: func() { edit(p) }}), testRequest())

			if state.Phase != PhaseFailed || !strings.Contains(state.Message, "changed during the recording check") {
				t.Fatalf("state = %+v", state)
			}
			if record := latestRecord(t, p); record.Outcome != evidence.LedgerFailed {
				t.Fatalf("record = %+v", record)
			}
		})
	}
}

func TestALaunchFailureWritesNothingAndLeavesTheServiceIdle(t *testing.T) {
	p := newTestProject(t)
	service := p.service(&fakeSidecar{launchErr: errors.New("no such file")})

	_, err := service.Start(testRequest())

	if err == nil || !strings.Contains(err.Error(), "no such file") || service.Busy() {
		t.Fatalf("err = %v busy = %v", err, service.Busy())
	}
	if recordCount(t, p) != 0 {
		t.Fatal("a run that never started must not be recorded")
	}
}

func TestRefusalsAreTypedAndRunNothing(t *testing.T) {
	cases := []struct {
		name   string
		change func(p *testProject, config *Config, request *Request)
		want   Reason
	}{
		{"a missing source", func(p *testProject, _ *Config, _ *Request) { _ = os.Remove(filepath.Join(p.dir, "media", "b.wav")) }, ReasonSourceMissing},
		{"an unmapped chapter", func(p *testProject, _ *Config, _ *Request) {
			_ = evidence.NewMappingStore(p.dir).Clear(testDocument, testTrack)
		}, ReasonUnmapped},
		{"two tracks for one chapter", func(p *testProject, _ *Config, _ *Request) { p.confirm(testDocument, "{EXTRA-0}", testChapter) }, ReasonMultipleTracks},
		{"a mapped track that is gone", func(p *testProject, _ *Config, _ *Request) {
			_ = evidence.NewMappingStore(p.dir).Clear(testDocument, testTrack)
			p.confirm(testDocument, "{GONE}", testChapter)
		}, ReasonMappedTrackMissing},
		{"an unsupported item", func(p *testProject, _ *Config, _ *Request) { p.items[0].kind = "MIDI"; p.writeRPP() }, ReasonUnsupportedItem},
		{"only muted items", func(p *testProject, _ *Config, _ *Request) {
			p.items[0].muted, p.items[1].muted = true, true
			p.writeRPP()
		}, ReasonNoItems},
		{"an empty played range", func(p *testProject, _ *Config, _ *Request) { p.items[0].playrate = 0; p.writeRPP() }, ReasonItemUnreadable},
		{"a Front Matter chapter", func(_ *testProject, _ *Config, request *Request) { request.ChapterID = "c-0002" }, ReasonNotNarration},
		{"an unknown chapter", func(_ *testProject, _ *Config, request *Request) { request.ChapterID = "c-0099" }, ReasonChapterNotFound},
		{"no manuscript", func(p *testProject, _ *Config, _ *Request) {
			_ = os.Remove(filepath.Join(p.dir, "narration-utils", "manuscript", "manuscript.json"))
		}, ReasonNoManuscript},
		{"a project file outside the folder", func(_ *testProject, config *Config, _ *Request) {
			config.ProjectFile = func() (string, error) { return filepath.Join(os.TempDir(), "elsewhere.rpp"), nil }
		}, ReasonNoProjectFile},
		{"no project file chosen", func(_ *testProject, config *Config, _ *Request) {
			config.ProjectFile = func() (string, error) { return "", errors.New("choose a project file") }
		}, ReasonNoProjectFile},
		{"an unreadable project file", func(p *testProject, _ *Config, _ *Request) { _ = os.WriteFile(p.rpp, []byte("not a project"), 0o600) }, ReasonProjectUnreadable},
		{"invalid alignment parameters", func(_ *testProject, _ *Config, request *Request) { request.Alignment.MinAnchorRun = 0 }, ReasonInvalidParams},
		{"no model", func(_ *testProject, _ *Config, request *Request) { request.Transcription.Model = "" }, ReasonInvalidParams},
		{"no sidecar", func(_ *testProject, config *Config, _ *Request) { config.Python = "" }, ReasonSidecarMissing},
		{"no project", func(_ *testProject, config *Config, _ *Request) { config.Project = "" }, ReasonNoProject},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := newTestProject(t)
			p.tracks = 1
			p.writeRPP()
			sidecar := &fakeSidecar{}
			config := Config{Project: p.dir, Python: "python", ProjectFile: func() (string, error) { return p.rpp, nil }, LoadManuscript: p.loadManuscript}
			request := testRequest()
			tc.change(p, &config, &request)
			service := New(config, sidecar.launcher(), nil)

			_, err := service.Start(request)

			if reason, ok := ReasonOf(err); !ok || reason != tc.want {
				t.Fatalf("err = %v, want reason %s", err, tc.want)
			}
			if len(sidecar.launches) != 0 || service.Busy() {
				t.Fatal("a refused run must not launch the sidecar or stay busy")
			}
			if tc.want != ReasonNoProject && recordCount(t, p) != 0 {
				t.Fatal("a refused run must not be recorded")
			}
		})
	}
}

func TestOnlyOneRunAtATime(t *testing.T) {
	p := newTestProject(t)
	sidecar := &fakeSidecar{pauseAfter: 1, paused: make(chan struct{}), resume: make(chan struct{})}
	service := p.service(sidecar)
	if _, err := service.Start(testRequest()); err != nil {
		t.Fatal(err)
	}
	<-sidecar.paused

	_, err := service.Start(testRequest())
	close(sidecar.resume)
	service.Wait()

	if reason, ok := ReasonOf(err); !ok || reason != ReasonBusy {
		t.Fatalf("err = %v", err)
	}
	if service.Busy() || service.State().Phase != PhaseComplete {
		t.Fatalf("the first run must finish normally: %+v", service.State())
	}
}

func waitFor(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !condition() {
		if time.Now().After(deadline) {
			t.Fatal("timed out")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestProgressIsReportedAndNeverMovesBackwards(t *testing.T) {
	p := newTestProject(t)
	sidecar := &fakeSidecar{pauseAfter: 1, paused: make(chan struct{}), resume: make(chan struct{})}
	var mu sync.Mutex
	var seen []State
	service := New(Config{Project: p.dir, Python: "python", ProjectFile: func() (string, error) { return p.rpp, nil }, LoadManuscript: p.loadManuscript},
		sidecar.launcher(), func(state State) { mu.Lock(); seen = append(seen, state); mu.Unlock() })
	service.pollInterval = time.Millisecond
	if _, err := service.Start(testRequest()); err != nil {
		t.Fatal(err)
	}
	<-sidecar.paused
	waitFor(t, func() bool { return service.State().Percent == 50 })
	progress := sidecar.lastArgs()["--progress"]

	progressLine(progress, "TRANSCRIBE", 20, "a lower percent")
	waitFor(t, func() bool { return service.State().Message == "a lower percent" })
	progressLine(progress, "TRANSCRIBE", 999, "not a percent")
	time.Sleep(20 * time.Millisecond)
	state := service.State()
	close(sidecar.resume)
	service.Wait()

	if state.Percent != 50 || state.Message != "a lower percent" {
		t.Fatalf("state = %+v, want the percent to stay at 50 and the bad line ignored", state)
	}
	mu.Lock()
	defer mu.Unlock()
	if seen[0].Phase != PhaseRunning || seen[len(seen)-1].Phase != PhaseComplete {
		t.Fatalf("states = %+v", seen)
	}
	for i := 1; i < len(seen); i++ {
		if seen[i].Percent < seen[i-1].Percent {
			t.Fatalf("percent moved backwards: %+v", seen)
		}
	}
}

func TestCancelWithNoRunDoesNothing(t *testing.T) {
	p := newTestProject(t)
	service := p.service(&fakeSidecar{})
	service.Cancel()
	service.Wait()
	if state := service.State(); state.Phase != PhaseIdle {
		t.Fatalf("state = %+v", state)
	}
}

// State, Busy and Cancel are called from bindings while the watch goroutine
// updates the job; under -race this pins that every access is locked.
func TestStateAndCancelAreSafeWhileARunIsInFlight(t *testing.T) {
	p := newTestProject(t)
	service := p.service(&fakeSidecar{})
	if _, err := service.Start(testRequest()); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range 200 {
				_ = service.State()
				_ = service.Busy()
			}
			service.Cancel()
		}()
	}
	wg.Wait()
	service.Wait()
	if phase := service.State().Phase; phase != PhaseComplete && phase != PhaseCancelled {
		t.Fatalf("phase = %s", phase)
	}
}
