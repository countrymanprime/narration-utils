package preview

import (
	"sort"
	"strings"
)

// wordsPerSecond is the text length model (Q2 option A): the app's fixed
// pace estimate expressed per second instead of per hour, so a target in
// seconds converts to a target word count with one multiply.
const wordsPerSecond = float64(WordsPerFinishedHour) / 3600

// eligible reports whether kind is content the preview may draw from (Q4): narration only, and a missing kind (an
// older import, before structural classification) reads as narration.
func eligible(kind ContentKind) bool { return kind == "" || kind == ContentNarration }

// chapterParagraphs groups paragraphs by chapter, each chapter's own list
// sorted by Index (Suggest never trusts the caller's paragraph order,
// so its own determinism does not depend on the caller's).
func chapterParagraphs(paragraphs []Paragraph) map[string][]Paragraph {
	byChapter := map[string][]Paragraph{}
	for _, p := range paragraphs {
		byChapter[p.ChapterID] = append(byChapter[p.ChapterID], p)
	}
	for id, list := range byChapter {
		sorted := append([]Paragraph(nil), list...)
		sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Index < sorted[j].Index })
		byChapter[id] = sorted
	}
	return byChapter
}

// Suggest computes up to three ranked candidates, one per eligible chapter, deterministically: the same input
// always gives the same output, byte for byte.
func Suggest(in Input) Result {
	if len(in.Chapters) == 0 {
		return Result{Outcome: OutcomeNoManuscript}
	}
	settings := in.Settings
	if settings.TargetSeconds <= 0 {
		settings = DefaultSettings()
	}
	targetWords := settings.TargetSeconds * wordsPerSecond
	lowWords := targetWords * (1 - settings.ToleranceFraction)
	highWords := targetWords * (1 + settings.ToleranceFraction)

	chapters := excludeEnding(in.Chapters, settings.ExcludeEndingFraction)
	byChapter := chapterParagraphs(in.Paragraphs)

	var candidates []Candidate
	for _, chapter := range chapters {
		if !eligible(chapter.ContentKind) {
			continue
		}
		paragraphs := byChapter[chapter.ID]
		if len(paragraphs) == 0 {
			continue
		}
		if best, ok := bestWindow(chapter, paragraphs, lowWords, highWords, in.HardWords); ok {
			candidates = append(candidates, best)
		}
	}
	if len(candidates) == 0 {
		return Result{Outcome: OutcomeNothingEligible}
	}

	order := map[string]int{}
	firstIndex := map[string]int{}
	for _, chapter := range chapters {
		order[chapter.ID] = chapter.Order
	}
	for _, c := range candidates {
		if len(c.ParagraphIDs) > 0 {
			firstIndex[c.ChapterID] = paragraphIndexOf(byChapter[c.ChapterID], c.ParagraphIDs[0])
		}
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		si, sj := score(candidates[i], settings), score(candidates[j], settings)
		if si != sj {
			return si > sj
		}
		if order[candidates[i].ChapterID] != order[candidates[j].ChapterID] {
			return order[candidates[i].ChapterID] < order[candidates[j].ChapterID]
		}
		return firstIndex[candidates[i].ChapterID] < firstIndex[candidates[j].ChapterID]
	})
	if len(candidates) > 3 {
		candidates = candidates[:3]
	}
	return Result{Outcome: OutcomeOK, Candidates: candidates}
}

func paragraphIndexOf(paragraphs []Paragraph, id string) int {
	for _, p := range paragraphs {
		if p.ID == id {
			return p.Index
		}
	}
	return 0
}

// excludeEnding drops the last excludeFraction share of chapters by Order (Q4), off when excludeFraction is 0.
func excludeEnding(chapters []Chapter, excludeFraction float64) []Chapter {
	if excludeFraction <= 0 || len(chapters) == 0 {
		return chapters
	}
	max := 0
	for _, c := range chapters {
		if c.Order > max {
			max = c.Order
		}
	}
	cutoff := float64(max) * (1 - excludeFraction)
	kept := make([]Chapter, 0, len(chapters))
	for _, c := range chapters {
		if float64(c.Order) <= cutoff {
			kept = append(kept, c)
		}
	}
	return kept
}

// bestWindow finds one chapter's best-scoring contiguous run of whole paragraphs within tolerance of the target, by
// a two-pointer scan over cumulative word counts (linear in the chapter's own paragraph count: as the window's start
// advances, its required end never moves backward). When no window reaches lowWords even using every paragraph, it
// answers the whole chapter, honestly marked Shorter.
func bestWindow(chapter Chapter, paragraphs []Paragraph, lowWords, highWords float64, hardWords map[string]bool) (Candidate, bool) {
	counts := make([]int, len(paragraphs))
	total := 0
	for i, p := range paragraphs {
		counts[i] = len(strings.Fields(p.Text))
		total += counts[i]
	}
	if float64(total) < lowWords {
		return wholeChapterCandidate(chapter, paragraphs, total, hardWords), true
	}

	var best Candidate
	bestFound := false
	bestScore := -1.0
	end := 0
	sum := 0
	for start := 0; start < len(paragraphs); start++ {
		if end < start {
			end, sum = start, 0
		}
		for end < len(paragraphs) && float64(sum) < lowWords {
			sum += counts[end]
			end++
		}
		if end > len(paragraphs) || float64(sum) < lowWords {
			break
		}
		if float64(sum) > highWords {
			sum -= counts[start]
			continue
		}
		candidate := windowCandidate(chapter, paragraphs[start:end], sum, hardWords)
		s := score(candidate, Settings{Preset: PresetSample})
		if s > bestScore {
			best, bestScore, bestFound = candidate, s, true
		}
		sum -= counts[start]
	}
	if bestFound {
		return best, true
	}
	// Every window that reached lowWords overshot highWords (a chapter of very long paragraphs): the shortest
	// in-tolerance-or-better window available is still the most honest answer, so widen the tolerance's high side
	// to the first window that reaches lowWords at all, rather than reporting no candidate for a chapter that does
	// have enough text.
	end, sum = 0, 0
	for end < len(paragraphs) && float64(sum) < lowWords {
		sum += counts[end]
		end++
	}
	return windowCandidate(chapter, paragraphs[:end], sum, hardWords), true
}

func wholeChapterCandidate(chapter Chapter, paragraphs []Paragraph, total int, hardWords map[string]bool) Candidate {
	c := windowCandidate(chapter, paragraphs, total, hardWords)
	c.Shorter = true
	c.Warnings = append(c.Warnings, "This chapter is shorter than the target length even in full.")
	return c
}

func windowCandidate(chapter Chapter, paragraphs []Paragraph, wordCount int, hardWords map[string]bool) Candidate {
	ids := make([]string, len(paragraphs))
	for i, p := range paragraphs {
		ids[i] = p.ID
	}
	reasons, warnings := reasonsFor(chapter, paragraphs, hardWords)
	return Candidate{
		ChapterID:        chapter.ID,
		ChapterTitle:     chapter.Title,
		ParagraphIDs:     ids,
		WordCount:        wordCount,
		EstimatedSeconds: float64(wordCount) / wordsPerSecond,
		Reasons:          reasons,
		Warnings:         warnings,
		features: candidateFeatures{
			dialogueShare:    quoteDialogueShare(paragraphs),
			distinctEntities: distinctEntities(paragraphs),
			hardWordDensity:  hardWordDensity(paragraphs, hardWords),
		},
	}
}
