package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// stagesTimingEnv names a project folder to time StageRecommendations on (chapter-stage-recommendations.prd.md Phase 4, the
// "Evaluation is read-only and cheap" metric and Q5). The folder is changed: every narration chapter is put in recording and,
// in the second pass, every unlinked track is linked to a chapter, so point it at a copy of a real project, never the project
// itself. Unset, the test is skipped.
const stagesTimingEnv = "STAGES_TIMING_PROJECT"

// stagesTimingRuns is how many reads each pass times after the first one.
const stagesTimingRuns = 5

func TestStageRecommendationsTimingOnAProjectCopy(t *testing.T) {
	project := os.Getenv(stagesTimingEnv)
	if project == "" {
		t.Skipf("set %s to a copy of a real project to time the evaluation", stagesTimingEnv)
	}
	t.Setenv("APPDATA", t.TempDir())
	host := NewHost()
	host.assets = newAssetRegistry(t.TempDir(), nil, whisperWithSmall(t, true), nil, nil)
	next := host.config
	next.projectFolder = project
	next.comparePython, next.compareBackend = "python-sidecar", "compare.py"
	if attached, reason := host.attachProjectLocked(next); !attached {
		t.Fatalf("attach failed: %s", reason)
	}
	chapters := decodeChapters(t, host)
	narration := []map[string]any{}
	for _, chapter := range chapters {
		if kind, _ := chapter["contentKind"].(string); kind == "" || kind == "narration" {
			narration = append(narration, chapter)
			if _, err := host.ManuscriptSetChapterStatus(chapter["id"].(string), "recording"); err != nil {
				t.Fatal(err)
			}
		}
	}
	parsed := timingProjectFacts(t, host)
	t.Logf("project: %d narration chapters, %d tracks, %d items, %d source files", len(narration), len(parsed.Tracks), countItems(parsed), countSources(parsed))

	timeRecommendations(t, host, "as linked")
	linkEveryTrack(t, host, parsed, narration)
	timeRecommendations(t, host, "every track linked")
}

func timingProjectFacts(t *testing.T, host *Host) tracks.Project {
	t.Helper()
	path, err := selectedProjectFile(host.services().config.projectFolder, host.services().settings)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := tracks.Parse(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("saved project %s: %d bytes", filepath.Base(path), info.Size())
	return parsed
}

func countItems(project tracks.Project) int {
	items := 0
	for _, track := range project.Tracks {
		items += len(track.Items)
	}
	return items
}

func countSources(project tracks.Project) int {
	sources := map[string]bool{}
	for _, track := range project.Tracks {
		for _, item := range track.Items {
			sources[item.SourceFile] = true
		}
	}
	return len(sources)
}

// linkEveryTrack links each track no chapter is linked to with the next chapter that has no link, in order.
func linkEveryTrack(t *testing.T, host *Host, project tracks.Project, chapters []map[string]any) {
	t.Helper()
	folder := host.services().config.projectFolder
	canonical, err := host.services().manuscript.Load()
	if err != nil {
		t.Fatal(err)
	}
	documentID, _ := canonical["documentId"].(string)
	store := evidence.NewMappingStore(folder)
	links, err := store.List(documentID)
	if err != nil {
		t.Fatal(err)
	}
	linkedTracks, linkedChapters := map[string]bool{}, map[string]bool{}
	for _, link := range links {
		linkedTracks[link.TrackGUID], linkedChapters[link.ChapterID] = true, true
	}
	next := 0
	for _, track := range project.Tracks {
		for next < len(chapters) && linkedChapters[chapters[next]["id"].(string)] {
			next++
		}
		if linkedTracks[track.GUID] || next == len(chapters) {
			continue
		}
		chapter := chapters[next]
		if _, err := store.Confirm(documentID, track.GUID, chapter["id"].(string), chapter["title"].(string)); err != nil {
			t.Fatal(err)
		}
		linkedChapters[chapter["id"].(string)] = true
	}
}

func timeRecommendations(t *testing.T, host *Host, pass string) {
	t.Helper()
	started := time.Now()
	first := stageVerdicts(t, host)
	firstRead := time.Since(started)
	var total, slowest time.Duration
	for range stagesTimingRuns {
		started := time.Now()
		stageVerdicts(t, host)
		elapsed := time.Since(started)
		total += elapsed
		slowest = max(slowest, elapsed)
	}
	t.Logf("%s: first read %v, then %d reads mean %v, slowest %v; verdicts %v", pass, firstRead.Round(time.Millisecond), stagesTimingRuns,
		(total / stagesTimingRuns).Round(time.Millisecond), slowest.Round(time.Millisecond), first)
}

// stageVerdicts reads every chapter's verdict and counts them, with the causes of the unknown ones.
func stageVerdicts(t *testing.T, host *Host) map[string]int {
	t.Helper()
	answer := decodeAnswer(t)(host.StageRecommendations())
	counts := map[string]int{}
	for _, item := range answer["chapters"].([]any) {
		chapter := item.(map[string]any)
		key := chapter["verdict"].(string)
		for _, cause := range chapter["causes"].([]any) {
			key += "/" + cause.(string)
		}
		counts[key]++
	}
	return counts
}
