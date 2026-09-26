package preview

import "testing"

func TestQuoteDialogueShareCountsPairedQuotesPerParagraph(t *testing.T) {
	paragraphs := []Paragraph{
		{Text: `She said "hello there" and smiled.`},
		{Text: "No quotes in this one at all."},
		{Text: "“Curly quotes work too,” he said."},
	}
	got := quoteDialogueShare(paragraphs)
	if want := 2.0 / 3.0; got != want {
		t.Fatalf("quoteDialogueShare = %v, want %v", got, want)
	}
}

func TestQuoteDialogueShareIgnoresASingleUnpairedQuote(t *testing.T) {
	paragraphs := []Paragraph{{Text: `A word that's not dialogue at all.`}}
	if got := quoteDialogueShare(paragraphs); got != 0 {
		t.Fatalf("a lone apostrophe-like quote must not read as dialogue: got %v", got)
	}
}

func TestDistinctEntitiesDeduplicatesAcrossParagraphs(t *testing.T) {
	paragraphs := []Paragraph{
		{EntityIDs: []string{"alice", "bob"}},
		{EntityIDs: []string{"bob", "carol"}},
		{EntityIDs: nil},
	}
	if got := distinctEntities(paragraphs); got != 3 {
		t.Fatalf("distinctEntities = %d, want 3 (alice, bob, carol)", got)
	}
}

func TestHardWordDensityIsZeroWithNoHardWordList(t *testing.T) {
	paragraphs := []Paragraph{{Text: "supercalifragilisticexpialidocious is a hard word"}}
	if got := hardWordDensity(paragraphs, nil); got != 0 {
		t.Fatalf("hardWordDensity with no list = %v, want 0 (no evidence either way, never a false positive)", got)
	}
}

func TestHardWordDensityMatchesCaseInsensitivelyAndStripsPunctuation(t *testing.T) {
	paragraphs := []Paragraph{{Text: "Supercalifragilisticexpialidocious, truly."}}
	hard := map[string]bool{"supercalifragilisticexpialidocious": true}
	got := hardWordDensity(paragraphs, hard)
	if want := 0.5; got != want {
		t.Fatalf("hardWordDensity = %v, want %v (1 of 2 words)", got, want)
	}
}

func TestScoreRewardsThePreferredDialogueBandOverEitherExtreme(t *testing.T) {
	settings := Settings{Preset: PresetSample}
	mixed := Candidate{features: candidateFeatures{dialogueShare: 0.3}}
	allNarration := Candidate{features: candidateFeatures{dialogueShare: 0}}
	allDialogue := Candidate{features: candidateFeatures{dialogueShare: 1}}
	if score(mixed, settings) <= score(allNarration, settings) {
		t.Fatal("a mixed window must score above an all-narration one")
	}
	if score(mixed, settings) <= score(allDialogue, settings) {
		t.Fatal("a mixed window must score above an all-dialogue one")
	}
}
