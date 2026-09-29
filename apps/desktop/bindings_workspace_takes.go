package main

import (
	"context"
	"errors"
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/passagetakes"
	"github.com/countrymanprime/narration-utils/shell/internal/runlog"
	"github.com/countrymanprime/narration-utils/shell/internal/takecompare"
	"github.com/countrymanprime/narration-utils/shell/internal/takereview"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// The workspace's Takes panel (edit-and-proof-workspace.prd.md Phase 6, EP6 and EP7, ADR 0700): the alternate takes of
// a chapter passage, a passage-based comparison of them, and "Use this take". The page sends a chapter id and a range
// of token indices (and, to choose, the id of a candidate this host offered), never a GUID, a file or a time: every one
// of those is read here from the chapter's stored alignment, the saved REAPER project and the findings store
// (internal/passagetakes), exactly as WorkspaceGoTo does for a word (threat model rows 5l and 4f).

// workspaceTakesResolved reads the alternates of the passage [firstToken, lastToken] of chapterID, with the saved
// project they were resolved against (a choice acts on that project's GUIDs).
func (h *Host) workspaceTakesResolved(svc hostServices, chapterID string, firstToken, lastToken int) (passagetakes.Resolved, tracks.Project, error) {
	if svc.coverage == nil || svc.findings == nil || svc.manuscript == nil {
		return passagetakes.Resolved{}, tracks.Project{}, errNoProject
	}
	view, err := svc.coverage.Alignment(chapterID, coverageSettings(svc.settings).Alignment)
	if err != nil {
		return passagetakes.Resolved{}, tracks.Project{}, err
	}
	project, err := h.tracksList()
	if err != nil {
		return passagetakes.Resolved{}, tracks.Project{}, err
	}
	title, err := manuscriptChapterTitle(svc, chapterID)
	if err != nil {
		return passagetakes.Resolved{}, tracks.Project{}, err
	}
	groups, err := svc.findings.List(findings.Query{Analyzer: "take-review"})
	if err != nil {
		return passagetakes.Resolved{}, tracks.Project{}, err
	}
	// A take-review group names its chapter by the title the scan aligned it to (comparisonChapterID), not by the
	// manuscript's own id.
	var chapterGroups []findings.Finding
	for _, group := range groups {
		if group.Manuscript != nil && group.Manuscript.ChapterTitle == title {
			chapterGroups = append(chapterGroups, group)
		}
	}
	resolved, err := passagetakes.Resolve(passagetakes.Input{
		ChapterID: chapterID, View: view, FirstToken: firstToken, LastToken: lastToken, Project: project, Groups: chapterGroups,
		Comparison: func(passageID string) (findings.Finding, bool) {
			saved, found, err := svc.findings.Get(takecompare.PassageFindingID(svc.config.projectFolder, passageID))
			return saved, err == nil && found
		},
	})
	return resolved, project, err
}

// manuscriptChapterTitle is the display title of the manuscript's narration chapter chapterID.
func manuscriptChapterTitle(svc hostServices, chapterID string) (string, error) {
	data, err := svc.manuscript.Load()
	if err != nil {
		return "", err
	}
	for _, raw := range asObjects(data["chapters"]) {
		if id, _ := raw["id"].(string); id == chapterID {
			title, _ := raw["title"].(string)
			return displayTitle(title), nil
		}
	}
	return "", fmt.Errorf("no chapter of the manuscript has the id %q; reload the workspace", chapterID)
}

// WorkspaceTakes lists the takes the narrator can set beside the passage (the tokens firstToken to lastToken of the
// chapter's stored alignment, snapped out to whole paragraphs): the other takes of the item it was heard on, the other
// retakes of its line on a fixed-lane track, and reads a take-review group set beside it (EP6). It reads only; it works
// with REAPER closed.
func (h *Host) WorkspaceTakes(chapterID string, firstToken int, lastToken int) (string, error) {
	resolved, _, err := h.workspaceTakesResolved(h.services(), chapterID, firstToken, lastToken)
	return encodeBinding(resolved.View, err)
}

// WorkspaceTakesCompareStart compares the passage's usable takes as the one take comparison job (ADR 0165, ADR 0700):
// the same sidecar mode, state and cancel as a take-review group's comparison (TakeComparisonState and
// TakeComparisonCancel answer for it, with the passage's id as the job's FindingID), with a manifest built from the
// saved project. It saves one take_comparison finding whose id is computable from the passage, so the panel reads it back.
func (h *Host) WorkspaceTakesCompareStart(chapterID string, firstToken int, lastToken int) (string, error) {
	svc := h.services()
	resolved, project, err := h.workspaceTakesResolved(svc, chapterID, firstToken, lastToken)
	if err != nil {
		return "", err
	}
	view := resolved.View
	if view.PassageID == "" {
		return "", errors.New(view.Message)
	}
	reads := resolved.Reads()
	if len(reads) < 2 {
		return "", fmt.Errorf("fewer than two of this passage's takes can be compared; there is nothing to set side by side")
	}
	title, err := manuscriptChapterTitle(svc, chapterID)
	if err != nil {
		return "", err
	}
	request := takecompare.Request{
		Passage: &takecompare.Passage{
			ID: view.PassageID, FirstParagraph: view.FirstParagraph, LastParagraph: view.LastParagraph, ChapterTitle: title, Reads: reads,
		},
		Project: project, ProjectPath: svc.config.projectFolder, ManuscriptPath: takeReviewManuscriptPath(svc.config.projectFolder), ChapterID: chapterID,
	}
	return encodeBinding(h.launchTakeComparison(svc, "passage_id", view.PassageID, len(reads), request))
}

// WorkspaceUseTake makes a take of the passage the one that plays (EP7, ADR 0233, ADR 0700). candidateID is one of the
// ids WorkspaceTakes just offered: the host re-reads the alternates from the saved project and refuses an id it does
// not offer, so nothing but a listed take can be chosen. What happens depends on where the take came from: another take
// of the item is made active (set_active_take, one undo step); another retake on a fixed-lane track becomes the lane
// that plays (pick_retake_lane); a read from another item is added as a take (create_take) and then made active, in
// one action the page confirms first. Every REAPER refusal is answered as a refused outcome and changes nothing.
func (h *Host) WorkspaceUseTake(chapterID string, firstToken int, lastToken int, candidateID string) (string, error) {
	svc := h.services()
	resolved, project, err := h.workspaceTakesResolved(svc, chapterID, firstToken, lastToken)
	if err != nil {
		return "", err
	}
	choice, offered := resolved.Choice(candidateID)
	if !offered {
		return encodeBinding(passagetakes.Outcome{
			Outcome: passagetakes.OutcomeRefused, Reason: passagetakes.ReasonNotOffered,
			Message: "That take isn't one of this passage's takes any more, so nothing was changed. The list has been read again.",
		}, nil)
	}
	if status := reaperStatus(svc); status.Connection != reaperConnected {
		return encodeBinding(passagetakes.Outcome{Outcome: passagetakes.OutcomeRefused, Reason: status.Connection, Message: status.Message}, nil)
	}
	run := h.runLog.Begin("use_take", "chapter_id", chapterID, "action", choice.Candidate.Action, "source", choice.Candidate.Source)
	ctx, cancel := context.WithTimeout(context.Background(), 2*takeReviewCreateTakeTimeout)
	defer cancel()
	outcome := passagetakes.Use(ctx, workspaceTakeActors(svc, project, run), choice)
	if outcome.Outcome == passagetakes.OutcomeRefused {
		run.End("refused")
	} else {
		run.End("ok")
	}
	return encodeBinding(outcome, nil)
}

// workspaceTakeActors are the REAPER requests WorkspaceUseTake may make, each through the DAW port's own role (or the
// retake lanes service), so each is gated exactly as the same request from another page (dawport.CapTakes,
// CapTakeCreate, CapRetakeLanes; ADR 0230).
func workspaceTakeActors(svc hostServices, project tracks.Project, run *runlog.Run) passagetakes.Actors {
	return passagetakes.Actors{
		SetActiveTake: func(ctx context.Context, itemGUID, takeGUID string) (bool, error) {
			if svc.dawPortResolver == nil {
				return false, bridge.ErrUnavailable
			}
			role, err := dawport.Role[dawport.TakeSelector](svc.dawPortResolver, dawport.CapTakes)
			if err != nil {
				return false, roleRefusal(err)
			}
			set, err := role.SetActiveTake(ctx, itemGUID, takeGUID)
			return set.Changed, err
		},
		CreateTake: func(ctx context.Context, req takereview.CreateTakeRequest) (takereview.CreateTakeResult, error) {
			if svc.takeCreator == nil {
				return takereview.CreateTakeResult{}, bridge.ErrUnavailable
			}
			return takereview.CreateTake(ctx, svc.takeCreator, takeReviewSessionDir(svc.config.sessionDir), req)
		},
		PickLane: func(lineID, itemGUID string) error {
			if svc.retakeLanes == nil {
				return bridge.ErrUnavailable
			}
			return svc.retakeLanes.Pick(project, lineID, itemGUID, run)
		},
	}
}
