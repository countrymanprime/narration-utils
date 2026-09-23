package coverage

import (
	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// Result reads the chapter's newest complete coverage run back and says
// whether it is current: the saved project's items unchanged (EL's evaluator,
// ADR 0100), the same confirmed track, the same alignment parameters and
// project inputs (the parameter hash, which leaves model and language out,
// Q13), and the same manuscript text. It never runs anything. A chapter that
// cannot be evaluated at all (no manuscript, unmapped, no saved project) is a
// ChapterResult in state never with that Reason, not an error.
func (s *Service) Result(chapterID string, alignment AlignmentParams) (ChapterResult, error) {
	result, err := s.result(chapterID, alignment)
	if reason, ok := ReasonOf(err); ok {
		return ChapterResult{State: evidence.StateNever, Reasons: []string{string(reason)}}, nil
	}
	return result, err
}

func (s *Service) result(chapterID string, alignment AlignmentParams) (ChapterResult, error) {
	basis, err := s.readableChapter(chapterID, alignment)
	if err != nil {
		return ChapterResult{}, err
	}
	project, projectFile, err := s.savedProject()
	if err != nil {
		return ChapterResult{}, err
	}
	return s.evaluate(project, projectFile, basis, alignment)
}

// ResultIn is Result against a saved project the caller already parsed (the
// stage recommendations' shared EvidenceView), so evaluating every chapter
// reads the .rpp once.
func (s *Service) ResultIn(project tracks.Project, projectFile evidence.LedgerProjectFile, chapterID string, alignment AlignmentParams) (ChapterResult, error) {
	result, err := s.resultIn(project, projectFile, chapterID, alignment)
	if reason, ok := ReasonOf(err); ok {
		return ChapterResult{State: evidence.StateNever, Reasons: []string{string(reason)}}, nil
	}
	return result, err
}

func (s *Service) resultIn(project tracks.Project, projectFile evidence.LedgerProjectFile, chapterID string, alignment AlignmentParams) (ChapterResult, error) {
	basis, err := s.readableChapter(chapterID, alignment)
	if err != nil {
		return ChapterResult{}, err
	}
	return s.evaluate(project, projectFile, basis, alignment)
}

// readableChapter checks what every read needs before the saved project: an
// open project, valid alignment parameters and the chapter in the manuscript.
func (s *Service) readableChapter(chapterID string, alignment AlignmentParams) (ChapterBasis, error) {
	if s.config.Project == "" {
		return ChapterBasis{}, unknown(ReasonNoProject, "open a project first")
	}
	if err := alignment.validate(); err != nil {
		return ChapterBasis{}, err
	}
	return s.chapter(chapterID)
}

// latestRecord is the chapter's newest coverage ledger record of any outcome.
func (s *Service) latestRecord(chapterID string) (*evidence.LedgerRecord, error) {
	records, err := s.ledger.List(AnalyzerID, chapterID)
	if err != nil || len(records) == 0 {
		return nil, err
	}
	return &records[0], nil
}

// Checking reports whether a check of chapterID is running now.
func (s *Service) Checking(chapterID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.busy && s.state.Phase == PhaseRunning && s.state.ChapterID == chapterID
}

// RecordedFractions is the measured ManuscriptChapter.recordedFraction (D11):
// for every chapter whose newest complete coverage run is current, the share
// of its body words present. A chapter with no current complete result -
// never checked, stale, partial, failed, unmapped, or anything that cannot be
// read - is absent, so the UI keeps its labeled status estimate (Q12 A). It
// never runs anything (Q14), and it reads the saved project once, and only
// when the ledger holds a complete coverage record at all.
func (s *Service) RecordedFractions(alignment AlignmentParams) map[string]float64 {
	fractions := map[string]float64{}
	if s.config.Project == "" || alignment.validate() != nil {
		return fractions
	}
	chapters := s.checkedChapters()
	if len(chapters) == 0 {
		return fractions
	}
	project, projectFile, err := s.savedProject()
	if err != nil {
		return fractions
	}
	for _, chapterID := range chapters {
		basis, err := s.chapter(chapterID)
		if err != nil {
			continue
		}
		result, err := s.evaluate(project, projectFile, basis, alignment)
		if err == nil && result.Current() {
			fractions[chapterID] = result.Result.Report.PresentFraction()
		}
	}
	return fractions
}

// checkedChapters lists the chapters with at least one complete coverage
// record, each once.
func (s *Service) checkedChapters() []string {
	records, err := s.ledger.List(AnalyzerID, "")
	if err != nil {
		return nil
	}
	seen := map[string]bool{}
	chapters := []string{}
	for _, record := range records {
		if record.Outcome != evidence.LedgerComplete || seen[record.Scope.ChapterID] {
			continue
		}
		seen[record.Scope.ChapterID] = true
		chapters = append(chapters, record.Scope.ChapterID)
	}
	return chapters
}

// evaluate compares the chapter's newest complete run against the parsed
// saved project, the confirmed track, the parameters and the manuscript.
func (s *Service) evaluate(project tracks.Project, projectFile evidence.LedgerProjectFile, basis ChapterBasis, alignment AlignmentParams) (ChapterResult, error) {
	if _, err := confirmedTrack(s.mapping, basis.DocumentID, basis.ChapterID); err != nil {
		return ChapterResult{}, err
	}
	evaluation, evaluationBasis, err := evidence.EvaluateChapter(s.ledger, s.mapping, evidence.ChapterEvaluationRequest{
		Project: project, ProjectFolder: s.config.Project, ProjectFile: projectFile,
		DocumentID: basis.DocumentID, ChapterID: basis.ChapterID,
		AnalyzerID: AnalyzerID, AnalyzerVersion: AnalyzerVersion,
		ParamHash: paramHash(alignment, readProjectInputs(s.config.Project)),
	})
	if err != nil {
		return ChapterResult{}, err
	}
	answer := ChapterResult{State: evaluation.State, Reasons: reasonStrings(evaluation.Reasons), Basis: &evaluationBasis, Record: evaluation.Record}
	if evaluation.Record == nil {
		return answer, nil
	}
	stored, ok := s.results.read(evaluation.Record.ID)
	if !ok {
		answer.State = evidence.StateNever
		answer.Reasons = append(answer.Reasons, string(ReasonResultMissing))
		return answer, nil
	}
	answer.Result = &stored
	if stored.DocumentID != basis.DocumentID || stored.ManuscriptHash != basis.Hash || evaluation.Record.Scope.DocumentID != basis.DocumentID {
		answer.State = evidence.StateStale
		answer.Reasons = append(answer.Reasons, string(ReasonManuscriptChanged))
	}
	return answer, nil
}

func reasonStrings(reasons []evidence.EvaluatorReason) []string {
	result := make([]string, 0, len(reasons))
	for _, reason := range reasons {
		result = append(result, string(reason))
	}
	return result
}
