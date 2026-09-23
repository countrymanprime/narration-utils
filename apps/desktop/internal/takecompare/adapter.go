package takecompare

import (
	"encoding/json"
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// confidenceReason says why a comparison has no confidence score: it is evidence side by side, not a judgement.
const confidenceReason = "A comparison shows each take's evidence per category, side by side. It does not add the categories up or pick a take: you choose the take in REAPER."

// TakeEvidence is one read of the group in the comparison: where it is, whether it was compared, and when it was, how
// it read the span and what its audio measured. Every figure is the sidecar's or MeasureTake's own, unchanged.
type TakeEvidence struct {
	ItemGUID          string               `json:"item_guid"`
	TakeGUID          string               `json:"take_guid"`
	SourceFile        string               `json:"source_file"`
	SourceStart       float64              `json:"source_start"`
	SourceLength      float64              `json:"source_length"`
	Compared          bool                 `json:"compared"`
	NotComparedReason string               `json:"not_compared_reason,omitempty"`
	Fidelity          *float64             `json:"fidelity"`
	Counts            *CountsEvidence      `json:"counts"`
	Words             []WordEvidence       `json:"words"`
	Divergences       []DivergenceEvidence `json:"divergences"`
	Metrics           *measure.TakeMetrics `json:"metrics"`
}

// CountsEvidence, WordEvidence and DivergenceEvidence are the sidecar's Counts, WordState and Divergence as the findings
// contract writes evidence: snake_case, values unchanged.
type CountsEvidence struct {
	Matched    int `json:"matched"`
	Misread    int `json:"misread"`
	Skipped    int `json:"skipped"`
	Unread     int `json:"unread"`
	ExtraWords int `json:"extra_words"`
}

type WordEvidence struct {
	Index  int      `json:"index"`
	Status string   `json:"status"`
	Start  *float64 `json:"start"`
	End    *float64 `json:"end"`
}

type DivergenceEvidence struct {
	Kind           string   `json:"kind"`
	Position       string   `json:"position"`
	FirstWord      *int     `json:"first_word"`
	LastWord       *int     `json:"last_word"`
	ManuscriptText string   `json:"manuscript_text"`
	AudioText      string   `json:"audio_text"`
	Start          *float64 `json:"start"`
	End            *float64 `json:"end"`
}

func alignmentEvidence(take TakeDivergence) (*CountsEvidence, []WordEvidence, []DivergenceEvidence) {
	counts := CountsEvidence(take.Counts)
	words := make([]WordEvidence, len(take.Words))
	for i, word := range take.Words {
		words[i] = WordEvidence(word)
	}
	divergences := make([]DivergenceEvidence, len(take.Divergences))
	for i, divergence := range take.Divergences {
		divergences[i] = DivergenceEvidence(divergence)
	}
	return &counts, words, divergences
}

// SpanEvidence is the span every compared take was aligned to.
type SpanEvidence struct {
	FirstUnit int        `json:"first_unit"`
	LastUnit  int        `json:"last_unit"`
	Words     []SpanWord `json:"words"`
}

// Evidence is a take_comparison finding's evidence. Members keeps the group's read order, so a read is the same
// number here as on the group, and Go to or Loop by index (FindingsGoToRead) reaches the same take.
type Evidence struct {
	SourceFindingID string         `json:"source_finding_id"`
	Span            SpanEvidence   `json:"span"`
	Model           string         `json:"model"`
	Compared        int            `json:"compared"`
	Members         []TakeEvidence `json:"members"`
}

// ToFinding builds the take_comparison finding for group from its evidence. Its id depends only on the project and the
// group, so comparing the same group again replaces the comparison; its evidence version hashes the whole evidence, so
// a decision made against one set of measurements returns to unreviewed when they change (ADR 0120).
func ToFinding(group Group, projectPath string, manuscript findings.Manuscript, evidence Evidence) (findings.Finding, error) {
	asMap, version, err := encodeEvidence(evidence)
	if err != nil {
		return findings.Finding{}, err
	}
	manuscript.Expected = spanText(evidence.Span.Words)
	finding := findings.Finding{
		SchemaVersion:    findings.SchemaVersion,
		ID:               findings.StableID(AnalyzerName, projectPath, group.ID),
		Analyzer:         AnalyzerName,
		Project:          findings.Project{Path: projectPath},
		Manuscript:       &manuscript,
		Category:         findings.CategoryTakeComparison,
		Severity:         findings.SeverityInfo,
		EvidenceVersion:  version,
		ConfidenceReason: confidenceReason,
		Evidence:         asMap,
		Review:           findings.ReviewState{Status: findings.StatusUnreviewed},
	}
	return finding, finding.Validate()
}

// encodeEvidence turns evidence into the finding's open evidence record, the shape the store reads back, and hashes it.
func encodeEvidence(evidence Evidence) (map[string]any, string, error) {
	encoded, err := json.Marshal(evidence)
	if err != nil {
		return nil, "", fmt.Errorf("takecompare: the comparison evidence could not be encoded: %w", err)
	}
	var asMap map[string]any
	if err := json.Unmarshal(encoded, &asMap); err != nil {
		return nil, "", fmt.Errorf("takecompare: the comparison evidence could not be encoded: %w", err)
	}
	return asMap, findings.StableID(AnalyzerName, string(encoded)), nil
}

func spanText(words []SpanWord) string {
	text := ""
	for i, word := range words {
		if i > 0 {
			text += " "
		}
		text += word.Text
	}
	return text
}
