// Transcript Compare's findings adapter turns one run's discrepancy rows
// into shared findings.Finding records without touching compare.py, the
// marker protocol, or the Lua bridge (review-dashboard-and-findings-
// adoption.prd.md Phase 2). It reads two things Go already has:
//
//   - the bridge-built rows kept in Service.state["rows"] (docText/
//     audioText, project-relative time, chapter title, global paragraph
//     index, script and audio context, marker state and any existing
//     marker name);
//   - the sidecar's own results_<run>.txt, for the two fields the Lua
//     bridge deliberately does not forward: confidence and
//     timing_gap_seconds (narration_compare.lua's inspect_results has the
//     "not yet forwarded" comment; ADR 0008 forbids changing the marker
//     protocol to add them there instead).
//
// The two are joined on the same row id Lua computes:
// "<item_index>@<srcpos formatted %.6f>". A third file, manifest_<run>.txt,
// gives each item index its audio source file for Source.File identity.
package transcript

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"os"
	"regexp"
	"strconv"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

const analyzerName = "transcript-compare"

// The row keys holding the REAPER identity COMPARE_MARKER carries after srcpos (review-dashboard PRD Phase 6): the item,
// take and track GUIDs as they were when the comparison was prepared. Host-only: Service.snapshotLocked drops them.
const (
	rowItemGUID  = "itemGuid"
	rowTakeGUID  = "takeGuid"
	rowTrackGUID = "trackGuid"
)

// timingToleranceSeconds quantizes project time before it enters
// EvidenceVersion, so ASR-model jitter under the tolerance does not reset a
// narrator's decision. The PRD's Q2 marks the tolerance value itself
// "TBD - needs research on real timing jitter between models"; this is a
// provisional default, not a tuned threshold, and is called out as such in
// the phase 2 PR.
const timingToleranceSeconds = 1.0

// ManuscriptLookup resolves what the adapter needs from the manuscript to
// anchor a finding's id (PRD Q2): the chapter id for a Transcript Compare
// chapter title, and the paragraph id for a chapter's global paragraph
// index. Both report ok=false when nothing matches, so the adapter falls
// back to the raw title/index rather than fail the whole run.
// *manuscript.Service satisfies this; transcript need not import manuscript,
// app.go wires the concrete value in.
type ManuscriptLookup interface {
	ChapterIDByTitle(title string) (id string, ambiguous, ok bool)
	ParagraphID(chapterID string, globalIndex int) (id string, ok bool)
}

// markerEvidence is what results_<run>.txt adds to a bridge-built row.
type markerEvidence struct {
	confidence string // "high" | "medium" | "low" | "unknown", compare.py's label
	timingGap  *float64
}

// BuildFindings converts one run's bridge-built discrepancy rows into
// findings.Finding records, grouped by the store scope each belongs in
// (findings.Store partitions by analyzer and chapter, PRD Q5, so re-running
// one chapter never touches another's saved findings). resultsPath is this
// run's results_<run>.txt (confidence and timing_gap_seconds only);
// manifestPath is this run's manifest_<run>.txt (source file identity only)
// and may be unreadable without failing the build. lookup may be nil, in
// which case every finding's chapter id falls back to its raw chapter title
// and is flagged unresolved in its evidence (Architecture Notes: "fall back
// to the title with a flag").
func BuildFindings(rows []map[string]any, resultsPath, manifestPath string, project findings.Project, lookup ManuscriptLookup) (map[string][]findings.Finding, error) {
	evidence, err := parseResultsEvidence(resultsPath)
	if err != nil {
		return nil, err
	}
	sources := parseManifestSources(manifestPath)
	ordinals := map[string]int{}
	result := map[string][]findings.Finding{}
	for _, row := range rows {
		f, scope := buildFinding(row, evidence, sources, project, lookup, ordinals)
		if scope == "" {
			continue
		}
		result[scope] = append(result[scope], f)
	}
	return result, nil
}

func buildFinding(row map[string]any, evidence map[string]markerEvidence, sources map[int]string, project findings.Project, lookup ManuscriptLookup, ordinals map[string]int) (findings.Finding, string) {
	kind := textOf(row, "kind")
	docText := textOf(row, "docText")
	audioText := textOf(row, "audioText")
	chapterTitle := textOf(row, "chapter")
	paragraph := intOf(row, "paragraph")
	itemIndex := intOf(row, "itemIndex")
	srcpos := floatOf(row, "srcpos")
	projectTime := floatOf(row, "projectTime")
	scriptContext := textOf(row, "scriptContext")
	audioContext := textOf(row, "audioContext")
	markerState := textOf(row, "markerState")
	existingMarkerName := textOf(row, "existingMarkerName")
	sourceFile := sources[itemIndex]

	chapterID, chapterUnresolved := resolveChapterID(chapterTitle, lookup)
	paragraphID := ""
	if lookup != nil {
		paragraphID, _ = lookup.ParagraphID(chapterID, paragraph)
	}

	// The "expected span text" a manuscript-anchored id keys on
	// (findings-contract.md): what the manuscript says. EXTRA has no
	// expected text at all (nothing was supposed to be there), so the
	// audio's own text is the only thing left to anchor the id on.
	spanText := docText
	if spanText == "" {
		spanText = audioText
	}
	ordinalKey := strings.Join([]string{chapterID, strconv.Itoa(paragraph), kind, spanText}, "\x1f")
	ordinal := ordinals[ordinalKey]
	ordinals[ordinalKey] = ordinal + 1

	id := findings.StableID(analyzerName, chapterID, strconv.Itoa(paragraph), kind, spanText, strconv.Itoa(ordinal))

	confidence, _ := confidenceScore("unknown")
	reason := "Transcript Compare's results file had no matching row, so no timing-confidence signal is available for this finding."
	var timingGap *float64
	if ev, ok := evidence[rowID(itemIndex, srcpos)]; ok {
		confidence, reason = confidenceScore(ev.confidence)
		timingGap = ev.timingGap
	}

	evidenceMap := map[string]any{
		"kind": kind, "marker_state": markerState,
		"script_context": scriptContext, "audio_context": audioContext,
	}
	if existingMarkerName != "" {
		evidenceMap["existing_marker_name"] = existingMarkerName
	}
	if timingGap != nil {
		evidenceMap["timing_gap_seconds"] = *timingGap
	}
	if chapterUnresolved {
		evidenceMap["chapter_id_unresolved"] = true
	}

	sourceStart, sourceEnd := srcpos, srcpos
	finding := findings.Finding{
		SchemaVersion: findings.SchemaVersion,
		ID:            id,
		Analyzer:      analyzerName,
		Project:       project,
		Source: findings.Source{
			File: sourceFile, ItemGUID: textOf(row, rowItemGUID), TakeGUID: textOf(row, rowTakeGUID), TrackGUID: textOf(row, rowTrackGUID),
		},
		TimeRange: &findings.TimeRange{
			Start: projectTime, End: projectTime,
			SourceStart: &sourceStart, SourceEnd: &sourceEnd,
		},
		Manuscript: &findings.Manuscript{
			ChapterID: chapterID, ChapterTitle: chapterTitle,
			Expected: docText, Recorded: audioText,
			Span: &findings.Span{ParagraphID: paragraphID, Ordinal: ordinal},
		},
		Category:         findings.CategoryTranscriptDiscrepancy,
		Severity:         severityFor(kind),
		Confidence:       confidence,
		ConfidenceReason: reason,
		Evidence:         evidenceMap,
		Review:           findings.ReviewState{Status: findings.StatusUnreviewed},
	}
	finding.EvidenceVersion = evidenceVersion(audioText, sourceFile, projectTime)
	return finding, scopeFor(chapterID)
}

// resolveChapterID looks up chapterTitle through lookup. unresolved is true
// when there is no lookup, no match, or more than one chapter shares the
// title (Architecture Notes: duplicate titles fall back to the title with a
// flag) — in every unresolved case the chapter id used is the raw title, so
// a finding still groups with its siblings from the same run even before the
// manuscript link is trustworthy.
func resolveChapterID(chapterTitle string, lookup ManuscriptLookup) (id string, unresolved bool) {
	if lookup == nil {
		return chapterTitle, true
	}
	resolved, ambiguous, ok := lookup.ChapterIDByTitle(chapterTitle)
	if !ok || ambiguous {
		return chapterTitle, true
	}
	return resolved, false
}

// scopeNamePattern mirrors findings.Store's own (unexported) validation: a
// scope name is used as a path component, so it must contain no separators
// or "..". A resolved manuscript chapter id is expected to already match
// this; the raw-title fallback usually will not (titles have spaces and
// punctuation), so it is rewritten into a short, safe, still-deterministic
// name rather than sent through unchanged and rejected by the store.
var scopeNamePattern = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

func scopeFor(chapterID string) string {
	if chapterID != "" && scopeNamePattern.MatchString(chapterID) {
		return chapterID
	}
	hash := sha256.Sum256([]byte(chapterID))
	return "title-" + hex.EncodeToString(hash[:8])
}

// severityFor is a provisional mapping: the PRD's Architecture Notes say
// "Severity mapping for the three kinds is TBD - needs a user decision
// during phase 2 planning." MISREAD and SKIPPED both usually mean the line
// needs a fresh take; EXTRA (extra recorded words, nothing missing or wrong)
// is sometimes a deliberate ad-lib, so it starts at info rather than
// warning. Called out for owner review in the PR that adds this file.
func severityFor(kind string) findings.Severity {
	if kind == "EXTRA" {
		return findings.SeverityInfo
	}
	return findings.SeverityWarning
}

// confidenceScore maps compare.py's timing-gap label to the shared record's
// numeric 0-1 confidence, honestly reporting "unknown" as no score at all
// (findings-contract.md: an analyzer "must identify uncertain or
// unavailable evidence rather than fabricate a score"). The three numeric
// points are an ordering, not a probability, and provisional pending the
// PRD's own "needs research" note on Q2.
func confidenceScore(label string) (*float64, string) {
	switch label {
	case "high":
		return floatPointer(0.9), "compare.py measured a clear pause at this discrepancy's audio boundary (timing_gap_seconds at or above its pause threshold) — stronger secondary evidence, not proof of a genuine misread, skip, or insertion."
	case "medium":
		return floatPointer(0.6), "compare.py measured a middling pause at this discrepancy's audio boundary — a provisional signal, not proof."
	case "low":
		return floatPointer(0.3), "compare.py found no meaningful pause at this discrepancy's audio boundary (the words ran together) — weaker evidence, possibly a token-split artifact of the diff itself rather than a genuine discrepancy."
	default:
		return nil, "compare.py could not measure an audio-timing gap at this discrepancy's boundary (no adjacent word timing available), so no numeric confidence is reported."
	}
}

func floatPointer(v float64) *float64 { return &v }

// evidenceVersion hashes the audio-side evidence a review decision is made
// against (PRD Q2/Q3: recorded text, source file identity, timing beyond a
// tolerance), separately from the manuscript-anchored id, so a re-recorded
// line that now says something different resets review even though its id
// (chapter/paragraph/kind/expected text) has not changed. sourceFile being
// empty (an unresolved manifest entry) is still hashed, rather than skipped,
// so a later run that DOES resolve it is treated as changed evidence instead
// of silently matching forever.
func evidenceVersion(audioText, sourceFile string, projectTime float64) string {
	quantized := math.Round(projectTime/timingToleranceSeconds) * timingToleranceSeconds
	hash := sha256.Sum256([]byte(fmt.Sprintf("%s\x1f%s\x1f%.3f", audioText, sourceFile, quantized)))
	return "sha256:" + hex.EncodeToString(hash[:])
}

// parseResultsEvidence reads results_<run>.txt and returns, per row id, the
// confidence and timing-gap fields the bridge never receives (see package
// comment). A results file that cannot be opened is reported to the caller
// rather than silently skipped: a missing sidecar output means findings
// would silently lose their confidence signal.
func parseResultsEvidence(path string) (map[string]markerEvidence, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("could not read Transcript Compare results for findings: %w", err)
	}
	defer func() { _ = file.Close() }()

	result := map[string]markerEvidence{}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		body, ok := strings.CutPrefix(line, "MARKER|")
		if !ok {
			continue
		}
		// 12 fields: item_index|srcpos|kind|name|doc_text|audio_text|
		// chapter_title|paragraph|script_context|audio_context|
		// confidence|timing_gap_seconds (compare.py's module docstring).
		fields := strings.SplitN(body, "|", 12)
		if len(fields) < 12 {
			continue // an older sidecar without confidence/timing_gap_seconds; those two fields are skipped, not the whole run
		}
		itemIndex, errIdx := strconv.Atoi(fields[0])
		srcpos, errPos := strconv.ParseFloat(fields[1], 64)
		if errIdx != nil || errPos != nil {
			continue
		}
		row := markerEvidence{confidence: fields[10]}
		if gap, err := strconv.ParseFloat(fields[11], 64); err == nil {
			row.timingGap = &gap
		}
		result[rowID(itemIndex, srcpos)] = row
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("could not read Transcript Compare results for findings: %w", err)
	}
	return result, nil
}

// parseManifestSources reads manifest_<run>.txt
// (item_index|source_file|start_offset_seconds|length_seconds,
// narration_compare.lua's prepare_compare) mapping item index to its audio
// source file, for Source.File identity. A manifest that cannot be read
// yields an empty map: every row's Source.File is then "", which still
// produces a valid, if less specific, finding rather than failing the run.
func parseManifestSources(path string) map[int]string {
	file, err := os.Open(path)
	if err != nil {
		return map[int]string{}
	}
	defer func() { _ = file.Close() }()
	result := map[int]string{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.SplitN(scanner.Text(), "|", 4)
		if len(fields) < 2 {
			continue
		}
		index, err := strconv.Atoi(fields[0])
		if err != nil {
			continue
		}
		result[index] = fields[1]
	}
	return result
}

// rowID mirrors narration_compare.lua's inspect_results: tostring(item_index)
// .. '@' .. string.format('%.6f', srcpos). Both sides parse the same
// results_<run>.txt srcpos and format it the same way, so results-file rows
// and COMPARE_MARKER-built rows join on identical strings.
func rowID(itemIndex int, srcpos float64) string {
	return fmt.Sprintf("%d@%.6f", itemIndex, srcpos)
}

func textOf(row map[string]any, key string) string {
	value, _ := row[key].(string)
	return value
}
func intOf(row map[string]any, key string) int {
	switch v := row[key].(type) {
	case int:
		return v
	case float64:
		return int(v)
	}
	return 0
}
func floatOf(row map[string]any, key string) float64 {
	switch v := row[key].(type) {
	case float64:
		return v
	case int:
		return float64(v)
	}
	return 0
}
