package preview

import (
	"fmt"
	"strings"
)

// preferredDialogueBand is the dialogue share a window scores best at: enough to show narration mixed with
// dialogue, not so much it reads as a transcript (Q5's "a dialogue share of the window inside a band scores best").
const (
	preferredDialogueLow  = 0.15
	preferredDialogueHigh = 0.6
)

// quoteDialogueShare is the precision-first quote heuristic (Q5 option A): the share of paragraphs that contain a
// complete pair of double quotes (straight or curly), counted per paragraph rather than per character so one long
// quoted paragraph cannot alone claim the whole window is dialogue. No speaker attribution; other languages and
// single-quote or dash dialogue styles score as no dialogue (a known, stated limitation, not a bug).
func quoteDialogueShare(paragraphs []Paragraph) float64 {
	if len(paragraphs) == 0 {
		return 0
	}
	dialogue := 0
	for _, p := range paragraphs {
		if hasPairedQuote(p.Text) {
			dialogue++
		}
	}
	return float64(dialogue) / float64(len(paragraphs))
}

func hasPairedQuote(text string) bool {
	straight := strings.Count(text, `"`)
	curlyOpen := strings.Count(text, "“")
	curlyClose := strings.Count(text, "”")
	return straight >= 2 || (curlyOpen >= 1 && curlyClose >= 1)
}

// distinctEntities counts the Story Bible entities mentioned anywhere in the window, without duplicates.
func distinctEntities(paragraphs []Paragraph) int {
	seen := map[string]bool{}
	for _, p := range paragraphs {
		for _, id := range p.EntityIDs {
			seen[id] = true
		}
	}
	return len(seen)
}

// hardWordDensity is hard words (case-insensitively matched against hardWords) over the window's total words; 0
// when hardWords is nil or empty, read as "no evidence either way", never as "no hard words".
func hardWordDensity(paragraphs []Paragraph, hardWords map[string]bool) float64 {
	if len(hardWords) == 0 {
		return 0
	}
	total, hard := 0, 0
	for _, p := range paragraphs {
		for _, word := range strings.Fields(p.Text) {
			total++
			if hardWords[strings.ToLower(strings.Trim(word, `.,;:!?"'()`))] {
				hard++
			}
		}
	}
	if total == 0 {
		return 0
	}
	return float64(hard) / float64(total)
}

// presetWeights are the named-feature weights Q1's two presets use. Equal today (Phase 1 is text-only, so there is
// no audio evidence yet for Sample and SpotCheck to actually pull apart - Architecture Notes: "presets differ only
// in weights"), kept as two separate constants so a later phase changes only these two lines, never the ranking
// logic in score().
type weights struct {
	dialogue, entities, hardWords float64
}

var presetWeights = map[Preset]weights{
	PresetSample:    {dialogue: 1, entities: 1, hardWords: 1},
	PresetSpotCheck: {dialogue: 1, entities: 1, hardWords: 1},
}

// score is candidate's ranking value under settings' preset: higher is a better suggestion. A Shorter candidate is
// scored like any other (it is still the best a short chapter has to offer), never zeroed out.
func score(candidate Candidate, settings Settings) float64 {
	w, ok := presetWeights[settings.Preset]
	if !ok {
		w = presetWeights[PresetSample]
	}
	f := candidate.features
	dialogueScore := 1 - dialogueBandDistance(f.dialogueShare)
	entityScore := 1 - 1/(1+float64(f.distinctEntities))
	return w.dialogue*dialogueScore + w.entities*entityScore + w.hardWords*f.hardWordDensity
}

// dialogueBandDistance is 0 inside the preferred band and grows toward 1 the further outside it dialogueShare sits.
func dialogueBandDistance(share float64) float64 {
	switch {
	case share < preferredDialogueLow:
		return (preferredDialogueLow - share) / preferredDialogueLow
	case share > preferredDialogueHigh:
		return (share - preferredDialogueHigh) / (1 - preferredDialogueHigh)
	default:
		return 0
	}
}

// reasonsFor computes this window's features and turns them into the human-readable reasons and warnings a
// narrator reads (Phase 1: "each feature returns its value and a human reason; the reasons are the evidence").
func reasonsFor(chapter Chapter, paragraphs []Paragraph, hardWords map[string]bool) ([]string, []string) {
	var reasons, warnings []string
	if chapter.ContentKind == "" {
		warnings = append(warnings, "This manuscript was imported before chapters were classified narration, opening or reference; treated as narration.")
	}
	dialogue := quoteDialogueShare(paragraphs)
	switch {
	case dialogue >= preferredDialogueLow && dialogue <= preferredDialogueHigh:
		reasons = append(reasons, fmt.Sprintf("Mixes narration and dialogue (%.0f%% of paragraphs have dialogue).", dialogue*100))
	case dialogue > preferredDialogueHigh:
		reasons = append(reasons, "Mostly dialogue.")
	default:
		reasons = append(reasons, "Mostly narration, little or no dialogue.")
	}
	entities := distinctEntities(paragraphs)
	switch entities {
	case 0:
		reasons = append(reasons, "No Story Bible entities mentioned in this range.")
	case 1:
		reasons = append(reasons, "One Story Bible entity present.")
	default:
		reasons = append(reasons, fmt.Sprintf("%d distinct Story Bible entities present.", entities))
	}
	if density := hardWordDensity(paragraphs, hardWords); density > 0 {
		reasons = append(reasons, fmt.Sprintf("%.1f%% of words are on the hard-word list.", density*100))
	}
	reasons = append(reasons, "Starts and ends on paragraph boundaries.")
	return reasons, warnings
}
