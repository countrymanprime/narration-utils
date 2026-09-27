package preview

import "testing"

func TestChapterPaceDividesRecordedSecondsByWordCount(t *testing.T) {
	rate, ok := ChapterPace(1000, 400)
	if !ok || rate != 0.4 {
		t.Fatalf("ChapterPace(1000, 400) = %v, %v; want 0.4, true", rate, ok)
	}
}

func TestChapterPaceIsUnknownWithNoWordsOrNoRecording(t *testing.T) {
	if _, ok := ChapterPace(0, 400); ok {
		t.Fatal("zero words must be unknown, not a rate of zero")
	}
	if _, ok := ChapterPace(1000, 0); ok {
		t.Fatal("nothing recorded yet must be unknown, not a rate of zero")
	}
}

// TestEstimateErrorFractionSignReflectsOverOrUnderPrediction pins the sign convention documented on the
// function: positive when the fixed estimate runs longer than the real recording (over-predicts), negative
// when the chapter took longer to read than the fixed rate assumes (under-predicts).
func TestEstimateErrorFractionSignReflectsOverOrUnderPrediction(t *testing.T) {
	wordCount := 9300 // exactly one finished hour (WordsPerFinishedHour) at the fixed rate: estimated = 3600s
	if got := EstimateErrorFraction(wordCount, 3000); got <= 0 {
		t.Fatalf("recorded faster than the fixed estimate must be a positive error, got %v", got)
	}
	if got := EstimateErrorFraction(wordCount, 3600); got != 0 {
		t.Fatalf("a recording exactly matching the estimate must be zero error, got %v", got)
	}
	if got := EstimateErrorFraction(wordCount, 4200); got >= 0 {
		t.Fatalf("recorded slower than the fixed estimate must be a negative error, got %v", got)
	}
}

func TestEstimateErrorFractionIsZeroWithNoWords(t *testing.T) {
	if got := EstimateErrorFraction(0, 100); got != 0 {
		t.Fatalf("EstimateErrorFraction(0, 100) = %v, want 0", got)
	}
}
