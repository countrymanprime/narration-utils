// This file is Phase 8 of docs/prds/editing-readiness-analysis.prd.md: the
// render source's own scan loop and signal gathering, run alongside (never
// instead of) the item path's own run (scan.go) and gatherCoverage/
// gatherCandidates (provider.go). Unlike run, there is no per-item loop - one
// file, one decode - so progress is a single 0%->100% jump around that one
// DecodeRender call: ADR 0015's real-progress honesty is still satisfied (0%
// until the decode returns, then 100%, never a fabricated in-between number),
// the same single-file-job precedent apps/desktop/internal/proofing's own
// render measurement job already sets for one file's worth of work.
package editing

import (
	"context"
	"errors"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
	"github.com/countrymanprime/narration-utils/shell/internal/proofing"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// sourceChoice reads the chapter's Q6 choice; a nil Choices store (a Config
// literal built before this field existed, or a project with none
// configured) reads as every chapter's own default, SourceItems - "no choice
// made yet" is never an error.
func (s *Service) sourceChoice(documentID, chapterID string) (SourceChoice, error) {
	if s.config.Choices == nil {
		return SourceItems, nil
	}
	return s.config.Choices.Get(documentID, chapterID)
}

// SourceChoice is sourceChoice's exported form, for the binding layer
// (apps/desktop/bindings_editing.go's EditingSourceChoice) - never reaches
// into s.config itself, the same encapsulation every other binding in this
// package already keeps.
func (s *Service) SourceChoice(documentID, chapterID string) (SourceChoice, error) {
	return s.sourceChoice(documentID, chapterID)
}

// SetSourceChoice sets documentID/chapterID's Q6 source choice (Editing­
// SetSourceChoice). A nil Choices store (no project attached, or one
// configured without this store) refuses rather than silently doing
// nothing - the narrator's choice must actually be kept or the caller needs
// to know it was not.
func (s *Service) SetSourceChoice(documentID, chapterID string, choice SourceChoice) error {
	if s.config.Choices == nil {
		return errors.New("no editing source-choice store is configured for this project")
	}
	return s.config.Choices.Set(documentID, chapterID, choice)
}

// startRender resolves the chapter's current render (Q6) and decides whether
// a render-choice scan may even start. Unlike resolveChapter (service.go),
// a render that is missing, stale or an unsupported format is allowed to
// start: proofing.RenderMissing/RenderStale/RenderUnsupported still name a
// real file the narrator once chose, and the resulting unknown cause is
// exactly what RenderEmptySpaceSignal should show once the run "completes"
// having decoded nothing - refusing to start here would hide that cause
// behind a rejected Start() instead. Only proofing.RenderNone - no
// association at all - refuses to start, mirroring "an unconfirmed mapping
// refuses to start" for the item path (resolveChapter's own doc comment).
func (s *Service) startRender(ctx context.Context, request Request) (proofing.RenderStatus, evidence.LedgerProjectFile, error) {
	if err := ctx.Err(); err != nil {
		return proofing.RenderStatus{}, evidence.LedgerProjectFile{}, err
	}
	if s.config.Project == "" {
		return proofing.RenderStatus{}, evidence.LedgerProjectFile{}, unknown(ReasonNoProject, "open a project before checking editing")
	}
	if s.config.Renders == nil {
		return proofing.RenderStatus{}, evidence.LedgerProjectFile{}, unknown(ReasonNoRender, "choose the rendered file for this chapter before checking it")
	}
	project, projectFile, err := s.savedProject()
	if err != nil {
		return proofing.RenderStatus{}, evidence.LedgerProjectFile{}, err
	}
	view := stages.EvidenceView{
		DocumentID: request.DocumentID, ProjectFolder: s.config.Project, Project: project,
		ProjectFile: projectFile, Ledger: s.ledger, Mapping: s.mapping,
	}
	chapter := stages.ChapterContext{DocumentID: request.DocumentID, ChapterID: request.ChapterID, Title: request.ChapterTitle, Status: stages.StageEditing}
	status, err := proofing.EvaluateRender(s.config.Renders, chapter, view)
	if err != nil {
		return proofing.RenderStatus{}, evidence.LedgerProjectFile{}, err
	}
	if status.State == proofing.RenderNone {
		return proofing.RenderStatus{}, evidence.LedgerProjectFile{}, unknown(ReasonNoRender, "choose the rendered file for this chapter before checking it")
	}
	return status, projectFile, nil
}

// runRender is the render path's own scan loop: it never returns an error,
// matching run's own rule (scan.go) - every outcome, including a render that
// turned out not to be current by the time the goroutine actually runs, is
// recorded in s.state.
func (s *Service) runRender(ctx context.Context, request Request, status proofing.RenderStatus, projectFile evidence.LedgerProjectFile) {
	if status.State != proofing.RenderCurrent || status.Association == nil {
		// The render is missing, stale or unsupported (startRender's own doc
		// comment): there is nothing to decode. The run still "completes" -
		// RenderEmptySpaceSignal reads the real cause from a fresh
		// proofing.EvaluateRender on its own next read, not from anything this
		// run writes, so no ledger record is written for a file that was never
		// actually decoded.
		s.finish(request, projectFile, PhaseComplete, 1, 1, 0, 0, 0, "Check complete; the render is not current.")
		return
	}
	path, renderKey := status.Association.Path, status.Association.Render.Key
	started := s.now()
	scan, _, err := DecodeRender(ctx, path, s.scanOptions())
	completed := s.now()
	if err != nil {
		if ctx.Err() != nil {
			s.finish(request, projectFile, PhaseCancelled, 0, 1, 0, 0, 0, "Cancelled.")
			return
		}
		_, _ = WriteRenderRecord(s.ledger, request.DocumentID, request.ChapterID, renderKey, path, projectFile, started, completed, evidence.LedgerFailed, nil, err)
		s.finish(request, projectFile, PhaseComplete, 1, 1, 0, 0, 1, "Check complete; the rendered file could not be read.")
		return
	}
	_, _ = WriteRenderRecord(s.ledger, request.DocumentID, request.ChapterID, renderKey, path, projectFile, started, completed, evidence.LedgerComplete, &scan, nil)
	s.composeAndPersistRender(request, path, scan)
	s.finish(request, projectFile, PhaseComplete, 1, 1, 0, 1, 0, "Check complete.")
}

// renderFindingsScope is the findings store scope (a file name,
// findings.Store.SaveAnalyzerFindings's own scope parameter) the render path
// writes to - deliberately different from the item path's own
// request.ChapterID (scan.go's composeAndPersist), so a render scan and an
// item scan of the same chapter never overwrite each other's stored
// candidates. Both still carry the chapter's real id in
// Finding.Manuscript.ChapterID, so a findings.Query{ChapterID: ...} still
// finds both; evidence["source"] (findings.go, provider.go) is what tells
// them apart at read time.
func renderFindingsScope(chapterID string) string { return chapterID + "-render" }

// composeAndPersistRender is composeAndPersist's (scan.go) render-path
// counterpart: Phase 3's own composition (ComposeRenderEmptySpace) for empty
// space, plus one ClassCandidateFinding (findings.go, Phase 4) per click and
// breath candidate the render's own decode found, fed the same synthetic
// whole-file ItemAudible renderAudible builds for composition - all saved
// together to the render's own findings scope in one call, tagged
// evidence["source"] = "render" so gatherCandidates (provider.go) never
// mixes them into the item path's own candidates.
func (s *Service) composeAndPersistRender(request Request, path string, scan RenderScan) {
	if s.findings == nil {
		return
	}
	policy := s.policy()
	fresh := []findings.Finding{}
	if candidates, ok := ComposeRenderEmptySpace(path, scan, policy); ok {
		for _, candidate := range candidates {
			fresh = append(fresh, RenderEmptySpaceFinding(request.DocumentID, request.ChapterID, request.ChapterTitle, candidate, path, policy))
		}
	}
	audible := renderAudible(path, scan)
	for _, candidate := range scan.Cleanup.Candidates {
		if candidate.Class != measure.CleanupClick && candidate.Class != measure.CleanupBreath {
			continue
		}
		finding := ClassCandidateFinding(request.DocumentID, request.ChapterID, request.ChapterTitle, audible, scan.Cleanup, candidate)
		finding.Evidence["source"] = "render"
		fresh = append(fresh, finding)
	}
	_, _ = s.findings.SaveAnalyzerFindings(analyzerName, renderFindingsScope(request.ChapterID), fresh)
}

// renderSignals is provider.go's SignalProvider.Signals render-choice branch
// (Q6): it reads stored evidence only, exactly like gatherCoverage/
// gatherCandidates do for the item path (Q12) - proofing.EvaluateRender reads
// the render association and the saved project already in view, this
// package's own CurrentRenderRecord reads the ledger for scan currency, and
// every class's candidates come from the render's own persisted findings
// (gatherRenderCandidates), never a fresh decode or the raw ledger payload.
func (s *Service) renderSignals(chapter stages.ChapterContext, view stages.EvidenceView, now time.Time) ([]stages.Signal, error) {
	basis := stages.Basis{ProjectFileModTime: view.ProjectFile.ModTime}
	validations := DetectorValidations()
	if s.config.Renders == nil {
		unknownEmptySpace := unknownEditingSignal(
			stages.Signal{ID: EmptySpaceSignalID, Stage: stages.StageEditing, Evidence: []stages.Evidence{processedAudioCaveat(), renderSourceEvidence()}, Basis: basis, ComputedAt: now},
			stages.CauseProviderError, "No rendered-file store is configured for this project.",
		)
		return []stages.Signal{
			unknownEmptySpace,
			RenderClassSignal(RenderClassSignalInput{ID: ClickSignalID, AnalyzerID: AnalyzerClick, AnalyzerVersion: ClickAnalyzerVersion, Validations: validations, Basis: basis, ComputedAt: now}),
			RenderClassSignal(RenderClassSignalInput{ID: BreathSignalID, AnalyzerID: AnalyzerBreath, AnalyzerVersion: BreathAnalyzerVersion, Validations: validations, Basis: basis, ComputedAt: now}),
		}, nil
	}

	status, err := proofing.EvaluateRender(s.config.Renders, chapter, view)
	if err != nil {
		return nil, err
	}

	scanState := RenderScanNever
	if status.Association != nil {
		renderKey := status.Association.Render.Key
		_, _, ok, err := CurrentRenderRecord(s.ledger, chapter.DocumentID, chapter.ChapterID, renderKey)
		if err != nil {
			return nil, err
		}
		switch {
		case ok:
			scanState = RenderScanCurrent
		default:
			anyRecords, err := s.ledger.List(AnalyzerEditingRender, chapter.ChapterID)
			if err != nil {
				return nil, err
			}
			if len(anyRecords) > 0 {
				scanState = RenderScanStale
			}
		}
	}

	running := s.Busy() && s.State().ChapterID == chapter.ChapterID
	renderCandidates, err := s.gatherRenderCandidates(chapter.ChapterID)
	if err != nil {
		return nil, err
	}

	emptySpace := RenderEmptySpaceSignal(RenderEmptySpaceInput{
		Render: status, ScanState: scanState, Policy: s.policy(), Candidates: renderCandidates["silence"], Running: running,
		Basis: basis, ComputedAt: now,
	})
	click := RenderClassSignal(RenderClassSignalInput{
		ID: ClickSignalID, AnalyzerID: AnalyzerClick, AnalyzerVersion: ClickAnalyzerVersion, Validations: validations,
		Render: status, ScanState: scanState, Candidates: renderCandidates["click"], Running: running, Basis: basis, ComputedAt: now,
	})
	breath := RenderClassSignal(RenderClassSignalInput{
		ID: BreathSignalID, AnalyzerID: AnalyzerBreath, AnalyzerVersion: BreathAnalyzerVersion, Validations: validations,
		Render: status, ScanState: scanState, Candidates: renderCandidates["breath"], Running: running, Basis: basis, ComputedAt: now,
	})
	return []stages.Signal{emptySpace, click, breath}, nil
}
