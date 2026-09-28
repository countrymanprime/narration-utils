// Package coverage is the recording-coverage analysis PRD's Go service
// (docs/utilities/recording-coverage.md, ADR 0128). For one
// manuscript chapter and its narrator-confirmed track, it builds the list of
// played items from the saved REAPER project only (never live REAPER state),
// seeds each item's words from the analysis evidence cache, runs the Transcript
// Compare sidecar's --coverage mode (ADR 0127) with real progress and cancel,
// stores the words the run produced back into the cache, and writes one
// analysis ledger record per run (ADR 0100). The sidecar reports counts; this
// package reads them back and applies the narrator's thresholds on read.
//
// It never changes the project, the manuscript or a chapter status: it reads
// the saved .rpp, the manuscript and the audio, and writes only under the
// project's narration-utils/analysis folder.
package coverage

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
)

// ChapterBasis is the manuscript side of a coverage result: which document and
// chapter it measured, and a hash of the text it measured against. Chapter ids
// are positional and reset on re-import (manuscript.resetDerived), and a text
// edit keeps the id, so a result is current only while both the document id and
// the hash still match.
type ChapterBasis struct {
	DocumentID string
	ChapterID  string
	Title      string
	Hash       string
}

// chapterBasis reads chapterID out of a loaded canonical manuscript (the map
// manuscript.Service.Load returns). A chapter that is missing, has no
// paragraphs or is not narration (Q4: Front Matter and reference sections are
// not targets) is an UnknownError.
func chapterBasis(data map[string]any, chapterID string) (ChapterBasis, error) {
	documentID, _ := data["documentId"].(string)
	if documentID == "" {
		return ChapterBasis{}, unknown(ReasonNoManuscript, "import a manuscript before checking a recording")
	}
	chapter, ok := findChapter(data, chapterID)
	if !ok {
		return ChapterBasis{}, unknown(ReasonChapterNotFound, fmt.Sprintf("chapter %s is not in the manuscript", chapterID))
	}
	if kind, _ := chapter["contentKind"].(string); kind != "" && kind != "narration" {
		return ChapterBasis{}, unknown(ReasonNotNarration, fmt.Sprintf("chapter %s is not a narration chapter", chapterID))
	}
	title, _ := chapter["title"].(string)
	subtitle, _ := chapter["subtitle"].(string)

	hash := sha256.New()
	write := func(part string) { _, _ = fmt.Fprintf(hash, "%d:%s", len(part), part) }
	write(chapterID)
	write(title)
	write(subtitle)
	paragraphs := 0
	rawParagraphs, _ := data["paragraphs"].([]any)
	for _, raw := range rawParagraphs {
		paragraph, _ := raw.(map[string]any)
		if owner, _ := paragraph["chapterId"].(string); owner != chapterID {
			continue
		}
		id, _ := paragraph["id"].(string)
		text, _ := paragraph["text"].(string)
		write(id)
		write(text)
		paragraphs++
	}
	if paragraphs == 0 {
		return ChapterBasis{}, unknown(ReasonChapterNotFound, fmt.Sprintf("chapter %s has no paragraphs", chapterID))
	}
	return ChapterBasis{DocumentID: documentID, ChapterID: chapterID, Title: title, Hash: hex.EncodeToString(hash.Sum(nil))}, nil
}

func findChapter(data map[string]any, chapterID string) (map[string]any, bool) {
	chapters, _ := data["chapters"].([]any)
	for _, raw := range chapters {
		chapter, _ := raw.(map[string]any)
		if id, _ := chapter["id"].(string); id == chapterID && chapterID != "" {
			return chapter, true
		}
	}
	return nil, false
}

// CreditsChapterID is the id a credits row's check runs and reads under: "credits-opening" or "credits-closing",
// matching the teleprompter's own credits script id (ADR 0150) and the row id the chapter table renders
// (credits-in-chapter-table.prd.md Phase 2).
func CreditsChapterID(kind string) string { return "credits-" + kind }

// CreditsKind reports the credits kind a chapterID names ("opening" or "closing"), and whether it is one at all - the
// coverage service's own dispatch between a manuscript chapter and a credits row (chapterID is never both).
func CreditsKind(chapterID string) (kind string, ok bool) {
	switch chapterID {
	case CreditsChapterID("opening"):
		return "opening", true
	case CreditsChapterID("closing"):
		return "closing", true
	default:
		return "", false
	}
}

// creditsBasis is a credits row's basis (Phase 3's "the rendered text, not manuscript paragraphs"): title and text
// are the same first-of-kind template render the Home row and the teleprompter show (ADR 0093, ADR 0150), so a
// template edit that changes either changes the hash and makes a stored result stale, exactly as an edited
// manuscript paragraph does for chapterBasis. documentID is the current manuscript's own documentId, not a fixed
// "credits" placeholder: a credits row's confirmed track link lives in the same chapter-track-map.json as every
// manuscript chapter's (evidence.MappingStore keeps one active document's links at a time), told apart by
// ChapterID alone.
func creditsBasis(documentID, kind, title, text string) ChapterBasis {
	hash := sha256.New()
	write := func(part string) { _, _ = fmt.Fprintf(hash, "%d:%s", len(part), part) }
	write(kind)
	write(title)
	write(text)
	return ChapterBasis{DocumentID: documentID, ChapterID: CreditsChapterID(kind), Title: title, Hash: hex.EncodeToString(hash.Sum(nil))}
}
