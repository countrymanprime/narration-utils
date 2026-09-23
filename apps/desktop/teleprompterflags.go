package main

import (
	"fmt"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/liveflags"
)

// TeleprompterSaveFlags writes a read-aloud session's suspected flags into the project's findings store as unreviewed
// findings (teleprompter-manuscript-integration.prd.md Phase 7, ADR 0117): a misread, extra or skip as a
// transcript_discrepancy, a restart as a pickup. The dialog calls it when a session ends and when it closes, so it is
// idempotent: a finding's id comes from the manuscript words, a repeat is one finding, and a flag the narrator dismissed
// is recorded once as a dismissed decision, never deleted. It answers one finding per flag, in order, as stored, so the
// dialog learns which flags an earlier session already dismissed.
func (h *Host) TeleprompterSaveFlags(chapterID string, flags []liveflags.Flag) (string, error) {
	return encodeBinding(h.teleprompterSaveFlags(chapterID, flags, time.Now()))
}

func (h *Host) teleprompterSaveFlags(chapterID string, flags []liveflags.Flag, now time.Time) ([]findings.Finding, error) {
	svc := h.services()
	if svc.findings == nil || svc.manuscript == nil {
		return nil, fmt.Errorf("no project is open")
	}
	if len(flags) == 0 {
		return []findings.Finding{}, nil
	}
	chapter, err := flagChapter(svc, chapterID)
	if err != nil {
		return nil, err
	}
	fresh, err := liveflags.ToFindings(chapter, findings.Project{Path: svc.config.projectFolder}, flags)
	if err != nil {
		return nil, err
	}
	merged, err := svc.findings.MergeAnalyzerFindings(liveflags.AnalyzerName, liveflags.Scope(chapterID), fresh)
	if err != nil {
		return nil, err
	}
	stored := make(map[string]findings.Finding, len(merged))
	for _, f := range merged {
		stored[f.ID] = f
	}
	result := make([]findings.Finding, len(fresh))
	for index, f := range fresh {
		current := stored[f.ID]
		if flags[index].Dismissed && current.Review.Status != findings.StatusDismissed {
			updated, found, err := svc.findings.RecordDecision(f.ID, f.EvidenceVersion, findings.StatusDismissed, "", now.UTC().Format(time.RFC3339))
			if err != nil {
				return nil, err
			}
			if found {
				current = updated
				stored[f.ID] = updated
			}
		}
		result[index] = current
	}
	return result, nil
}

// flagChapter reads the chapter's paragraphs from the imported manuscript, the text a flag's words are checked against.
func flagChapter(svc hostServices, chapterID string) (liveflags.Chapter, error) {
	paragraphs, err := svc.manuscript.Paragraphs(chapterID)
	if err != nil {
		return liveflags.Chapter{}, err
	}
	chapter := liveflags.Chapter{ID: chapterID, Paragraphs: make([]liveflags.Paragraph, 0, len(paragraphs))}
	for _, paragraph := range paragraphs {
		id, _ := paragraph["id"].(string)
		text, _ := paragraph["text"].(string)
		chapter.Paragraphs = append(chapter.Paragraphs, liveflags.Paragraph{ID: id, Text: text})
		if title, _ := paragraph["chapter"].(string); chapter.Title == "" {
			chapter.Title = title
		}
	}
	return chapter, nil
}
