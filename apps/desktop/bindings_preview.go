package main

import (
	"math"
	"strconv"

	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
	"github.com/countrymanprime/narration-utils/shell/internal/preview"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

// The proofing-preview-suggestion PRD's Phase 2 read binding: the UI's only way to reach Phase 1's pure engine
// (apps/desktop/internal/preview, preview.Suggest). It never runs anything and stores nothing (SR D1, shared by
// CoverageResult and WorkspaceAlignment): every call recomputes from the manuscript's current chapters and
// paragraphs, at the narrator's own Preview settings (Phase 4, previewSettings below) - target length, tolerance,
// preset and ending exclusion, layered project over global over config/defaults.json like every other tool.
// HardWords is always nil (no vocabulary-candidates source exists yet - the sibling proofing-vocabulary-hints PRD,
// not built) and Phase 1's engine already treats nil as "no evidence either way".

// previewSettingsTool is the settings.Store tool the four Preview settings (Phase 4, app.go's fieldSchemas) live
// under.
const previewSettingsTool = "Preview"

const (
	previewSettingTargetSeconds = "target_seconds"
	previewSettingTolerance     = "tolerance_fraction"
	previewSettingPreset        = "preset"
	previewSettingExcludeEnding = "exclude_ending_fraction"
)

// previewSettings are the narrator's four preview settings from the layered store (coverageSettings' own pattern,
// bindings_coverage.go). A value that is missing, unparsable or outside numberSpecs["Preview"]'s declared range - a
// hand-edited settings file, since saveSettings' own validateSettingValue already refuses one at save time (Phase
// 4's success signal: "invalid values are rejected at the boundary") - falls back to that one setting's shipped
// default (preview.DefaultSettings) rather than making every read fail.
func previewSettings(store *settings.Store) preview.Settings {
	defaults := preview.DefaultSettings()
	lookup := func(key string) string {
		value, _ := store.Effective(previewSettingsTool, key, "")
		return value
	}
	return preview.Settings{
		TargetSeconds:         previewFloatSetting(lookup(previewSettingTargetSeconds), 60, 3600, defaults.TargetSeconds),
		ToleranceFraction:     previewFloatSetting(lookup(previewSettingTolerance), 0.01, 0.5, defaults.ToleranceFraction),
		Preset:                previewPresetSetting(lookup(previewSettingPreset), defaults.Preset),
		ExcludeEndingFraction: previewFloatSetting(lookup(previewSettingExcludeEnding), 0, 0.5, defaults.ExcludeEndingFraction),
	}
}

// previewFloatSetting parses raw as a plain decimal inside [min, max] inclusive (numberSpecs["Preview"]'s own
// bounds), falling back to fallback for anything else - missing, not a number, NaN, Inf or out of range.
func previewFloatSetting(raw string, min, max, fallback float64) float64 {
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) || value < min || value > max {
		return fallback
	}
	return value
}

// previewPresetSetting accepts only the two presets the engine knows (preview.PresetSample, preview.PresetSpotCheck),
// falling back to fallback for anything else.
func previewPresetSetting(raw string, fallback preview.Preset) preview.Preset {
	switch preview.Preset(raw) {
	case preview.PresetSample, preview.PresetSpotCheck:
		return preview.Preset(raw)
	default:
		return fallback
	}
}

// previewCandidateView is one preview.Candidate as the wire sends it. preview.Candidate itself carries no json
// tags (Phase 1's package is pure Go with no I/O, internal/preview/types.go's own doc comment), so this is the
// boundary's own copy, camelCased like every other binding payload.
type previewCandidateView struct {
	ChapterID        string   `json:"chapterId"`
	ChapterTitle     string   `json:"chapterTitle"`
	ParagraphIDs     []string `json:"paragraphIds"`
	WordCount        int      `json:"wordCount"`
	EstimatedSeconds float64  `json:"estimatedSeconds"`
	// Shorter is true when even this chapter's every eligible paragraph together falls short of the target's lower
	// tolerance bound (preview.Candidate.Shorter's own doc: "the candidate is the whole chapter, honestly labelled
	// rather than padded or hidden").
	Shorter  bool     `json:"shorter"`
	Reasons  []string `json:"reasons"`
	Warnings []string `json:"warnings"`
}

// previewResultView is preview.Result as the wire sends it: an Outcome the UI names a state by (Success Metrics:
// an empty Candidates list must never be conflated with "nothing eligible" - Outcome is the state, not the list's
// length), and up to three ranked candidates when it is "ok".
type previewResultView struct {
	Outcome    string                 `json:"outcome"`
	Candidates []previewCandidateView `json:"candidates"`
}

func previewView(result preview.Result) previewResultView {
	view := previewResultView{Outcome: string(result.Outcome), Candidates: make([]previewCandidateView, 0, len(result.Candidates))}
	for _, candidate := range result.Candidates {
		view.Candidates = append(view.Candidates, previewCandidateView{
			ChapterID:        candidate.ChapterID,
			ChapterTitle:     candidate.ChapterTitle,
			ParagraphIDs:     candidate.ParagraphIDs,
			WordCount:        candidate.WordCount,
			EstimatedSeconds: candidate.EstimatedSeconds,
			Shorter:          candidate.Shorter,
			Reasons:          candidate.Reasons,
			Warnings:         candidate.Warnings,
		})
	}
	return view
}

// previewNoManuscript is PreviewCandidates' answer with no chapters to read at all: no project attached, or a
// project open with no manuscript imported yet (manuscript.Service.Chapters' own "import a manuscript first"
// error). Both read as the engine's own OutcomeNoManuscript rather than a rejected promise, so the panel (Phase 3)
// names the state instead of catching an error - the same "never an error for a named state" shape CoverageResult
// and WorkspaceAlignment already use for "no project".
var previewNoManuscript = previewView(preview.Result{Outcome: preview.OutcomeNoManuscript})

// PreviewCandidates reads up to three ranked five-minute preview candidates from the imported manuscript
// (proofing-preview-suggestion.prd.md Phase 1's preview.Suggest over this file's own adapter). It never runs
// anything and stores nothing.
func (h *Host) PreviewCandidates() (string, error) {
	svc := h.services()
	service := svc.manuscript
	if service == nil {
		return encodeBinding(previewNoManuscript, nil)
	}
	input, err := previewInput(service, previewSettings(svc.settings))
	if err != nil {
		return encodeBinding(previewNoManuscript, nil)
	}
	return encodeBinding(previewView(preview.Suggest(input)), nil)
}

// previewInput builds preview.Input from the manuscript service's loosely-typed reader payloads (Chapters,
// Paragraphs: apps/desktop/internal/manuscript/reader.go has no typed structs, only map[string]any). It loops
// Chapters(), then Paragraphs(chapterID) per chapter - the simplest shape, and the one reader.go's own
// chapterPayload already builds "paragraphIds" from.
func previewInput(service *manuscript.Service, resolved preview.Settings) (preview.Input, error) {
	chapterPayloads, err := service.Chapters()
	if err != nil {
		return preview.Input{}, err
	}
	chapters := make([]preview.Chapter, 0, len(chapterPayloads))
	var paragraphs []preview.Paragraph
	for _, payload := range chapterPayloads {
		id := previewString(payload, "id")
		order, _ := previewOrder(payload["index"])
		chapters = append(chapters, preview.Chapter{
			ID:          id,
			Title:       previewString(payload, "title"),
			ContentKind: preview.ContentKind(previewString(payload, "contentKind")),
			Order:       order,
		})

		paragraphPayloads, err := service.Paragraphs(id)
		if err != nil {
			return preview.Input{}, err
		}
		for index, paragraphPayload := range paragraphPayloads {
			paragraphs = append(paragraphs, preview.Paragraph{
				ID:        previewString(paragraphPayload, "id"),
				ChapterID: id,
				// Index is this paragraph's position within its own chapter (preview.Paragraph's own contract), not
				// the reader contract's global "index" field (reader.go:39's own comment calls it that:
				// "the reader contract's global 'index' field"). Paragraphs(id) is already filtered to this
				// chapter and kept in the manuscript's own paragraph order, so the loop position is exactly the
				// chapter-local index the engine wants.
				Index:     index,
				Text:      previewString(paragraphPayload, "text"),
				EntityIDs: previewEntityIDs(paragraphPayload),
			})
		}
	}
	return preview.Input{Chapters: chapters, Paragraphs: paragraphs, Settings: resolved}, nil
}

func previewString(payload map[string]any, key string) string {
	value, _ := payload[key].(string)
	return value
}

// previewOrder reads a chapter's reader-contract "index" (its 0-based position in the book,
// internal/manuscript/service.go's own import-time assignment): a float64 once the canonical manuscript has been
// through encoding/json (every number decodes into map[string]any as float64), and int accepted too, defensively,
// for a payload a caller might build directly in Go.
func previewOrder(value any) (int, bool) {
	switch typed := value.(type) {
	case float64:
		return int(typed), true
	case int:
		return typed, true
	}
	return 0, false
}

// previewEntityIDs reads a paragraph payload's entityIds: always []string{} today (apps/desktop/internal/manuscript/reader.go's
// paragraphPayload hardcodes it - no entity-mention tracking exists anywhere in this codebase yet), read
// defensively here since the map is loosely typed.
func previewEntityIDs(payload map[string]any) []string {
	if ids, ok := payload["entityIds"].([]string); ok {
		return ids
	}
	return nil
}
