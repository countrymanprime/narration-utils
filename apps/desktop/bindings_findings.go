package main

import (
	"fmt"
	"time"
	"unicode/utf8"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

// The review bindings (review-dashboard-and-findings-adoption.prd.md Phase 4, ADR 0120): every analyzer's
// findings are read and decided through these four, whatever wrote them (Transcript Compare, the Story
// Bible, take review, and later the teleprompter's live flags), so a new analyzer needs no new binding.
// Filtering, sorting and paging run in Go over findings.Query (Q9); the UI stays a view.

// maxReviewNoteRunes bounds a narrator's note on a decision. The history is append-only and read in full
// on every save, so an unbounded note would grow every later read.
const maxReviewNoteRunes = 2000

// FindingsQuery is FindingsList's filter, sort and page, as the UI sends it. Every field is optional:
// an empty filter matches everything, an empty sort is chapter order, a zero limit is no limit. New
// filters are added here as optional fields, so an older UI keeps working.
type FindingsQuery struct {
	Analyzer              string   `json:"analyzer,omitempty"`
	Category              string   `json:"category,omitempty"`
	Severity              string   `json:"severity,omitempty"`
	Status                string   `json:"status,omitempty"`
	ChapterID             string   `json:"chapterId,omitempty"`
	MinConfidence         *float64 `json:"minConfidence,omitempty"`
	IncludeNotInLatestRun bool     `json:"includeNotInLatestRun,omitempty"`
	// Sort is "chapter" (the default), "time", "confidence" or "severity"; see findings.SortKey.
	Sort       string `json:"sort,omitempty"`
	Descending bool   `json:"descending,omitempty"`
	Limit      int    `json:"limit,omitempty"`
	Offset     int    `json:"offset,omitempty"`
}

func (q FindingsQuery) storeQuery() findings.Query {
	return findings.Query{
		Analyzer: q.Analyzer, Category: findings.Category(q.Category), Severity: findings.Severity(q.Severity),
		Status: findings.Status(q.Status), ChapterID: q.ChapterID, MinConfidence: q.MinConfidence,
		IncludeNotInLatestRun: q.IncludeNotInLatestRun, Sort: findings.SortKey(q.Sort), Descending: q.Descending,
		Limit: q.Limit, Offset: q.Offset,
	}
}

// FindingsList answers one page of the findings that match query, and how many matched in all.
func (h *Host) FindingsList(query FindingsQuery) (string, error) {
	store, err := h.findingsStore()
	if err != nil {
		return "", err
	}
	return encodeBinding(store.Page(query.storeQuery()))
}

// FindingsGet answers the finding with id, or an error when the store no longer has it (an analyzer
// re-run or a manuscript replacement can remove it while the page shows it).
func (h *Host) FindingsGet(id string) (string, error) {
	store, err := h.findingsStore()
	if err != nil {
		return "", err
	}
	return encodeBinding(existingFinding(store, id))
}

// FindingsReview records the narrator's decision on a finding, made against evidenceVersion (the
// finding's evidence_version as the page showed it), and answers the finding as the store now holds it.
// It refuses a finding whose evidence changed since it was shown, so a decision is never applied to
// evidence the narrator did not see; the page reloads it and the narrator decides again. status may be
// "unreviewed" to reopen a decision. The history stays append-only (findings.Store.RecordDecision).
func (h *Host) FindingsReview(id, evidenceVersion, status, note string) (string, error) {
	store, err := h.findingsStore()
	if err != nil {
		return "", err
	}
	if utf8.RuneCountInString(note) > maxReviewNoteRunes {
		return "", fmt.Errorf("a note can be at most %d characters", maxReviewNoteRunes)
	}
	current, err := existingFinding(store, id)
	if err != nil {
		return "", err
	}
	if current.EvidenceVersion != evidenceVersion {
		return "", fmt.Errorf("this finding changed since it was shown (its analyzer ran again); look at it again before deciding")
	}
	timestamp := time.Now().UTC().Format(time.RFC3339)
	finding, found, err := store.RecordDecision(id, evidenceVersion, findings.Status(status), note, timestamp)
	if err == nil && !found {
		err = errFindingGone
	}
	return encodeBinding(finding, err)
}

// FindingsSummary answers the review queue at a glance: counts by status (the navigation badge is the
// unreviewed count) and the analyzers, categories and chapters present, for the page's filters.
func (h *Host) FindingsSummary() (string, error) {
	store, err := h.findingsStore()
	if err != nil {
		return "", err
	}
	return encodeBinding(store.Summary())
}

var errFindingGone = fmt.Errorf("that finding is no longer in this project; reload the list")

func (h *Host) findingsStore() (*findings.Store, error) {
	store := h.services().findings
	if store == nil {
		return nil, fmt.Errorf("no project is open")
	}
	return store, nil
}

func existingFinding(store *findings.Store, id string) (findings.Finding, error) {
	finding, found, err := store.Get(id)
	if err == nil && !found {
		err = errFindingGone
	}
	return finding, err
}
