package coverage

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// The recording-coverage corpus (ADR 0125): the committed synthetic cases, and
// the results file the shipped sidecar writes for each at the shipped settings,
// pinned by sidecars/transcript-compare/tests/test_coverage_results_golden.py.
var corpusDir = filepath.Join("..", "..", "..", "..", "sidecars", "transcript-compare", "tests", "fixtures", "coverage")

const corpusDocument = "coverage-fixtures"

type corpusResults struct {
	SchemaVersion int `json:"schemaVersion"`
	Settings      struct {
		MinParagraphPresent float64 `json:"minParagraphPresent"`
		MaxMissingRun       int     `json:"maxMissingRun"`
		MaxMisreadRun       int     `json:"maxMisreadRun"`
		MinAnchorRun        int     `json:"minAnchorRun"`
	} `json:"settings"`
	Cases map[string]corpusCase `json:"cases"`
}

type corpusCase struct {
	ChapterID    string   `json:"chapterId"`
	Split        string   `json:"split"`
	TextComplete bool     `json:"textComplete"`
	Lines        []string `json:"lines"`
}

// corpusLabels is a case file's per-paragraph truth: present, partial or missing.
func corpusLabels(t *testing.T, caseID string) map[string]string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(corpusDir, "cases", caseID+".json"))
	if err != nil {
		t.Fatal(err)
	}
	var spec struct {
		Expected struct {
			Paragraphs map[string]string `json:"paragraphs"`
		} `json:"expected"`
	}
	if err := json.Unmarshal(raw, &spec); err != nil {
		t.Fatal(err)
	}
	return spec.Expected.Paragraphs
}

func loadCorpus(t *testing.T) (corpusResults, []byte) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(corpusDir, "results.golden.json"))
	if err != nil {
		t.Fatal(err)
	}
	var corpus corpusResults
	if err := json.Unmarshal(raw, &corpus); err != nil {
		t.Fatal(err)
	}
	manuscript, err := os.ReadFile(filepath.Join(corpusDir, "manuscript.json"))
	if err != nil {
		t.Fatal(err)
	}
	if corpus.SchemaVersion != 1 || len(corpus.Cases) == 0 {
		t.Fatalf("corpus results version %d with %d cases", corpus.SchemaVersion, len(corpus.Cases))
	}
	return corpus, manuscript
}

// corpusProject is a project holding the corpus manuscript, every chapter at
// recording, and the case's chapter linked to the fixture's one track.
type corpusProject struct {
	*testProject
	statuses map[string]stages.Stage
}

func newCorpusProject(t *testing.T, manuscript []byte, chapterID string) *corpusProject {
	t.Helper()
	p := &corpusProject{testProject: newTestProject(t), statuses: map[string]stages.Stage{}}
	p.writeFile("narration-utils/manuscript/manuscript.json", string(manuscript))
	p.confirm(corpusDocument, testTrack, chapterID)
	return p
}

func (p *corpusProject) chapters() ([]map[string]any, error) {
	canonical, err := p.loadManuscript()
	if err != nil {
		return nil, err
	}
	chapters := []map[string]any{}
	for _, raw := range canonical["chapters"].([]any) {
		chapter := raw.(map[string]any)
		id := chapter["id"].(string)
		status, ok := p.statuses[id]
		if !ok {
			status = stages.StageRecording
		}
		chapters = append(chapters, map[string]any{"id": id, "title": chapter["title"], "contentKind": chapter["contentKind"], "status": string(status)})
	}
	return chapters, nil
}

func (p *corpusProject) stagesService(coverage *Service, settings Settings) *stages.Service {
	provider := NewSignalProvider(coverage, SignalSources{Settings: func() Settings { return settings }, Now: func() time.Time { return signalNow }})
	return stages.NewService(stages.Config{
		Project:        p.dir,
		LoadManuscript: p.loadManuscript,
		Chapters:       p.chapters,
		SetChapterStatus: func(chapterID string, status stages.Stage) error {
			p.statuses[chapterID] = status
			return nil
		},
		Providers: []stages.Provider{provider},
		View:      coverage.EvidenceView,
		Now:       func() time.Time { return signalNow },
	})
}

func findRecommendation(t *testing.T, all []stages.ChapterRecommendation, chapterID string) stages.ChapterRecommendation {
	t.Helper()
	for _, recommendation := range all {
		if recommendation.ChapterID == chapterID {
			return recommendation
		}
	}
	t.Fatalf("no recommendation for %s in %+v", chapterID, all)
	return stages.ChapterRecommendation{}
}

// TestStageRecommendationsOverTheCoverageCorpus is the stage recommendations
// PRD's Phase 3 service test: each corpus case's real sidecar output is stored
// as a complete check, and the stages service, with the recording provider
// and the shared evidence view, suggests editing for exactly the chapters
// labelled text-complete. Every other chapter is not ready, and each
// paragraph the case labels missing is named in the evidence.
func TestStageRecommendationsOverTheCoverageCorpus(t *testing.T) {
	corpus, manuscript := loadCorpus(t)
	settings := Settings{
		Alignment:  AlignmentParams{MaxMisreadRun: corpus.Settings.MaxMisreadRun, MinAnchorRun: corpus.Settings.MinAnchorRun},
		Thresholds: Thresholds{MinParagraphPresent: corpus.Settings.MinParagraphPresent, MaxMissingRun: corpus.Settings.MaxMissingRun},
	}
	if settings != DefaultSettings {
		t.Fatalf("the corpus results were made at %+v, not the shipped %+v", settings, DefaultSettings)
	}
	ids := make([]string, 0, len(corpus.Cases))
	for id := range corpus.Cases {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	verdicts := map[stages.Verdict]int{}
	for _, id := range ids {
		c := corpus.Cases[id]
		t.Run(id, func(t *testing.T) {
			p := newCorpusProject(t, manuscript, c.ChapterID)
			sidecar := &fakeSidecar{results: c.Lines}
			coverage := p.service(sidecar)
			request := Request{ChapterID: c.ChapterID, Transcription: Transcription{Model: "small"}, Alignment: settings.Alignment}
			if state := run(t, coverage, request); state.Phase != PhaseComplete {
				t.Fatalf("the check did not complete: %+v", state)
			}
			service := p.stagesService(coverage, settings)

			all, err := service.Recommendations(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			got := findRecommendation(t, all, c.ChapterID)
			verdicts[got.Verdict]++
			if len(got.Signals) != 1 || got.Signals[0].ID != RecordingSignalID {
				t.Fatalf("signals = %+v", got.Signals)
			}
			signal := got.Signals[0]
			result, err := coverage.Result(c.ChapterID, settings.Alignment)
			if err != nil {
				t.Fatal(err)
			}
			// The dialog's judgement is the stage signal's (recording-check-summary PRD Phase 2, ADR 0204).
			if judgement := result.View(c.ChapterID, settings.Thresholds).Judgement; judgement == nil || judgement.State != signal.State || judgement.Reason != signal.Reason {
				t.Fatalf("judgement %+v, signal %s %q", judgement, signal.State, signal.Reason)
			}
			if c.TextComplete {
				assertCorpusRecommended(t, service, p, got)
			} else {
				assertCorpusNotReady(t, id, got, signal)
			}
			for _, other := range all {
				if other.ChapterID != c.ChapterID && (other.Verdict != stages.VerdictUnknown || !slices.Equal(other.Causes, []stages.UnknownCause{stages.CauseUnmappedTrack})) {
					t.Fatalf("an unlinked chapter must be unknown/unmapped_track: %+v", other.Assessment)
				}
			}
			sidecar.mu.Lock()
			launches := len(sidecar.launches)
			sidecar.mu.Unlock()
			if launches != 1 {
				t.Fatalf("evaluating ran the sidecar: %d launches", launches)
			}
		})
	}
	if verdicts[stages.VerdictRecommended] == 0 || verdicts[stages.VerdictNotReady] == 0 {
		t.Fatalf("the corpus must hold both outcomes: %v", verdicts)
	}
}

// assertCorpusRecommended checks a text-complete chapter end to end: suggested
// editing, confirmed, and the confirmation live with no contradiction.
func assertCorpusRecommended(t *testing.T, service *stages.Service, p *corpusProject, got stages.ChapterRecommendation) {
	t.Helper()
	if got.Verdict != stages.VerdictRecommended || got.Target != stages.StageEditing || got.Signals[0].State != stages.SignalMet {
		t.Fatalf("a text-complete chapter must be recommended: %+v", got.Assessment)
	}
	confirmed, err := service.Confirm(context.Background(), got.ChapterID, stages.StageEditing, got.BasisKey)
	if err != nil {
		t.Fatal(err)
	}
	if p.statuses[got.ChapterID] != stages.StageEditing || confirmed.Confirmation == nil || confirmed.Confirmation.EvidenceChanged || confirmed.Contradiction != nil {
		t.Fatalf("after Confirm: status %s, %+v", p.statuses[got.ChapterID], confirmed)
	}
}

// assertCorpusNotReady checks a chapter that is not text-complete: not ready,
// never recommended, with every paragraph the case labels missing named in
// the evidence.
func assertCorpusNotReady(t *testing.T, caseID string, got stages.ChapterRecommendation, signal stages.Signal) {
	t.Helper()
	if got.Verdict != stages.VerdictNotReady || signal.State != stages.SignalNotMet || signal.Reason == "" {
		t.Fatalf("an incomplete chapter must be not ready: %+v", got.Assessment)
	}
	named := map[string]bool{}
	for _, entry := range signal.Evidence {
		for _, paragraphID := range entry.ParagraphIDs {
			named[paragraphID] = true
		}
	}
	for paragraphID, label := range corpusLabels(t, caseID) {
		if label == "missing" && !named[paragraphID] {
			t.Fatalf("missing paragraph %s is not in the evidence: %+v", paragraphID, signal.Evidence)
		}
	}
}
