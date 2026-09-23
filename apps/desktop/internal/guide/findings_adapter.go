// The Story Bible's findings adapter turns entities the narrator has not
// finished reviewing into shared findings.Finding records without touching
// the Story Bible itself (review-dashboard-and-findings-adoption.prd.md
// Phase 3, Q7 option A). It only reads what Service.Entities already
// normalizes; it never calls Edit, EditFields, Pronounce, Rescan, Merge,
// Delete, Create, CreateFull, Relate or Unrelate, or any other sidecar
// command that could change the guide file. A finding is never deleted
// here either: the store (findings.Store.SaveAnalyzerFindings) is the only
// thing that decides a finding is "resolved upstream", by the finding's id
// simply being absent from the fresh list this adapter builds on the next
// call - which happens on its own once the entity's review_state becomes
// something other than "needs review", or the entity becomes locked,
// because BuildFindings stops producing that id.
//
// Two independent conditions each produce their own finding for the same
// entity when both apply, because they resolve on different narrator
// actions and read differently in the queue:
//
//   - needs-review: review_state == "needs review" and the entity is not
//     locked (a locked entity is the narrator's own settled call, so it is
//     never flagged even if its review_state was never advanced).
//   - low-confidence pronunciation: the entity is not locked and its own
//     pronunciation's confidence label is "low" or "unknown" (manuscript_
//     guide.py's cmu/espeak/none tiers). An entity's aliases are not
//     checked: the contract's occurrence evidence is the entity's own, and
//     Q7 only asks about "unreviewed pronunciations", which the UI and the
//     sidecar both key off the primary name.
package guide

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

// analyzerName is the Store partition this adapter's findings are saved
// under (review-dashboard-and-findings-adoption.prd.md Q5).
const analyzerName = "story-bible"

// scopeName is the single Store scope every Story Bible finding is saved
// under. Unlike Transcript Compare, which re-runs and saves per chapter, the
// Story Bible build produces one file for the whole manuscript, so there is
// one natural regeneration unit: every call to SaveFindings replaces the
// complete fresh set in one SaveAnalyzerFindings call, which is what lets an
// entity's finding disappear the moment that entity no longer qualifies.
const scopeName = "entities"

// Condition kinds distinguish the two finding kinds an entity can produce,
// so an entity that needs review AND has a low-confidence pronunciation
// gets two independently-resolving findings sharing no id.
const (
	conditionNeedsReview                = "needs_review"
	conditionLowConfidencePronunciation = "low_confidence_pronunciation"
)

const reviewStateNeedsReview = "needs review"

// BuildFindings converts entities (Service.Entities' normalized shape) into
// findings.Finding records per Q7's two conditions. It performs no I/O and
// calls nothing on Service: it is a pure read of the maps it is given, so a
// caller cannot accidentally reach a mutating sidecar command through it.
func BuildFindings(entities []map[string]any, project findings.Project) []findings.Finding {
	var result []findings.Finding
	for _, entity := range entities {
		id := stringField(entity, "id")
		if id == "" {
			continue // an entity the guide file never assigned an id to cannot be addressed by a finding
		}
		locked := boolField(entity, "locked")
		name := stringField(entity, "canonical_name")
		manuscript, excerpt := manuscriptFor(entity, name)

		if !locked && stringField(entity, "review_state") == reviewStateNeedsReview {
			result = append(result, needsReviewFinding(project, id, name, excerpt, manuscript))
		}
		if confidence := pronunciationConfidence(entity); !locked && isLowConfidenceLabel(confidence) {
			result = append(result, lowConfidencePronunciationFinding(project, id, name, confidence, excerpt, manuscript))
		}
	}
	return result
}

func isLowConfidenceLabel(label string) bool {
	return label == "low" || label == "unknown"
}

func pronunciationConfidence(entity map[string]any) string {
	pronunciation, _ := entity["pronunciation"].(map[string]any)
	return stringField(pronunciation, "confidence")
}

// needsReviewFinding flags an entity the extraction build could not resolve
// with confidence (manuscript_guide.py's "Needs Review" category, or any
// entity whose review_state a rescan has not yet advanced past it). There is
// no numeric confidence signal for "has a narrator looked at this yet", so
// Confidence is honestly nil (findings-contract.md).
func needsReviewFinding(project findings.Project, id, name, excerpt string, manuscript *findings.Manuscript) findings.Finding {
	evidence := map[string]any{"condition": conditionNeedsReview, "entity_id": id}
	if excerpt != "" {
		evidence["excerpt"] = excerpt
	}
	f := findings.Finding{
		SchemaVersion:    findings.SchemaVersion,
		ID:               findings.StableID(analyzerName, id, conditionNeedsReview),
		Analyzer:         analyzerName,
		Project:          project,
		Category:         findings.CategoryEntity,
		Severity:         findings.SeverityWarning,
		Confidence:       nil,
		ConfidenceReason: "review_state is a narrator review flag, not a measured score, so no numeric confidence is reported.",
		Manuscript:       manuscript,
		Evidence:         evidence,
		Review:           findings.ReviewState{Status: findings.StatusUnreviewed},
	}
	f.EvidenceVersion = evidenceVersion(id, conditionNeedsReview, name, reviewStateNeedsReview, contextOf(manuscript))
	return f
}

// lowConfidencePronunciationFinding flags an unlocked entity whose own
// pronunciation the sidecar could not generate with confidence (label
// "low", the eSpeak NG fallback, or "unknown", nothing generated at all).
// The label is mapped to the same three-point scale Transcript Compare's
// adapter uses, honestly reporting "unknown" as no score at all.
func lowConfidencePronunciationFinding(project findings.Project, id, name, confidenceLabel, excerpt string, manuscript *findings.Manuscript) findings.Finding {
	confidence, reason, severity := pronunciationScore(confidenceLabel)
	evidence := map[string]any{"condition": conditionLowConfidencePronunciation, "entity_id": id, "pronunciation_confidence": confidenceLabel}
	if excerpt != "" {
		evidence["excerpt"] = excerpt
	}
	f := findings.Finding{
		SchemaVersion:    findings.SchemaVersion,
		ID:               findings.StableID(analyzerName, id, conditionLowConfidencePronunciation),
		Analyzer:         analyzerName,
		Project:          project,
		Category:         findings.CategoryPronunciation,
		Severity:         severity,
		Confidence:       confidence,
		ConfidenceReason: reason,
		Manuscript:       manuscript,
		Evidence:         evidence,
		Review:           findings.ReviewState{Status: findings.StatusUnreviewed},
	}
	f.EvidenceVersion = evidenceVersion(id, conditionLowConfidencePronunciation, name, confidenceLabel, contextOf(manuscript))
	return f
}

// pronunciationScore maps manuscript_guide.py's pronunciation confidence
// label to the shared record's numeric 0-1 confidence. "unknown" (nothing
// generated) reports honestly as no score at all, while "low" (eSpeak NG
// generated something, just without a dictionary match) is weak but real
// evidence.
func pronunciationScore(label string) (*float64, string, findings.Severity) {
	if label == "low" {
		score := 0.3
		return &score, "manuscript_guide.py generated this pronunciation from eSpeak NG, its fallback engine with no dictionary match - weaker evidence than a CMU dictionary hit.", findings.SeverityWarning
	}
	// "unknown": nothing generated at all.
	return nil, "manuscript_guide.py could not generate a pronunciation for this name at all, so no numeric confidence is reported.", findings.SeverityWarning
}

// manuscriptFor carries the entity's own evidence (Architecture Notes:
// "evidence excerpts and chapter carried from occurrences"), anchored to its
// first occurrence. Manuscript.Expected is the entity's name rather than
// docText/audioText (findings have no recorded audio: Phase 3's scope note,
// "findings have no time range or source by design"); the excerpt is
// returned separately for Evidence, since the contract reserves
// Manuscript.Recorded for what was actually heard, not manuscript prose.
func manuscriptFor(entity map[string]any, name string) (manuscript *findings.Manuscript, excerpt string) {
	occurrences, _ := entity["occurrences"].([]any)
	for _, raw := range occurrences {
		occurrence, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		m := &findings.Manuscript{
			ChapterID:    stringField(occurrence, "chapterId"),
			ChapterTitle: stringField(occurrence, "chapter"),
			Expected:     name,
		}
		if paragraphID := stringField(occurrence, "paragraphId"); paragraphID != "" {
			m.Span = &findings.Span{ParagraphID: paragraphID}
		}
		return m, stringField(occurrence, "excerpt")
	}
	return &findings.Manuscript{Expected: name}, ""
}

// contextOf is the manuscript context evidenceVersion hashes in addition to
// the condition-specific field, so a finding whose entity gained or lost
// manuscript occurrences (a rebuild against an edited manuscript) is treated
// as changed evidence even when review_state or pronunciation confidence
// happen to read the same.
func contextOf(manuscript *findings.Manuscript) string {
	if manuscript == nil {
		return ""
	}
	paragraphID := ""
	if manuscript.Span != nil {
		paragraphID = manuscript.Span.ParagraphID
	}
	return strings.Join([]string{manuscript.ChapterID, paragraphID}, "\x1f")
}

// evidenceVersion hashes the evidence a review decision is made against: the
// entity's name (a merge or rename is a material change), the condition's
// own field (review_state, or the pronunciation confidence label) and the
// manuscript context. A materially changed version returns a finding to
// unreviewed but keeps the earlier note (findings.Store's merge semantics);
// an unchanged one keeps the decision across rebuilds.
func evidenceVersion(parts ...string) string {
	hash := sha256.Sum256([]byte(strings.Join(parts, "\x1f")))
	return "sha256:" + hex.EncodeToString(hash[:])
}

func stringField(m map[string]any, key string) string {
	value, _ := m[key].(string)
	return value
}
func boolField(m map[string]any, key string) bool {
	value, _ := m[key].(bool)
	return value
}
