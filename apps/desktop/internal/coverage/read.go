package coverage

import (
	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
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
	if s.config.Project == "" {
		return ChapterResult{}, unknown(ReasonNoProject, "open a project first")
	}
	if err := alignment.validate(); err != nil {
		return ChapterResult{}, err
	}
	basis, err := s.chapter(chapterID)
	if err != nil {
		return ChapterResult{}, err
	}
	project, projectFile, err := s.savedProject()
	if err != nil {
		return ChapterResult{}, err
	}
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
