package preview

import "strings"

// EvaluateRange scores an arbitrary contiguous paragraph range the same way Suggest's own ranked candidates are
// scored (windowCandidate, attachFindings, attachAudioChecked): for a pin the narrator adjusted by hand, never
// re-subjected to Suggest's top-three cap (Q12) or to Sample's hard-gate exclusion (Q7) - those are rules for what
// Suggest offers, not a limit on what the narrator may keep once they have made their own choice. ok is false when
// paragraphIDs is empty or any id does not resolve to a paragraph of chapter.
func EvaluateRange(chapter Chapter, paragraphs []Paragraph, paragraphIDs []string, hardWords map[string]bool, allFindings []OpenFinding, settings Settings, audio ChapterAudioEvidence) (Candidate, bool) {
	if len(paragraphIDs) == 0 {
		return Candidate{}, false
	}
	byID := make(map[string]Paragraph, len(paragraphs))
	for _, p := range paragraphs {
		if p.ChapterID == chapter.ID {
			byID[p.ID] = p
		}
	}
	ordered := make([]Paragraph, 0, len(paragraphIDs))
	total := 0
	for _, id := range paragraphIDs {
		p, ok := byID[id]
		if !ok {
			return Candidate{}, false
		}
		ordered = append(ordered, p)
		total += len(strings.Fields(p.Text))
	}

	candidate := windowCandidate(chapter, ordered, total, hardWords)
	findingsByChap := findingsByChapter(allFindings)
	candidate, _ = attachFindings(candidate, findingsByChap[chapter.ID])
	candidate = attachAudioChecked(candidate, audio)
	return candidate, true
}
