package preview

// pace.go is Phase 6's Q8-C fallback and its own "estimate error reported" success signal: coarse per-chapter
// pace evidence (chapter recorded seconds over chapter words) for when MapParagraphsToTime has nothing mapped -
// which, per audiomapper.go's decision, is every paragraph today, until a paragraph-stamping trigger exists.
// This is pace evidence for the whole chapter, never a claim about one window's audio quality (Phase 7 gates
// that separately): "never claims the window itself is clean" (PRD Q8).

// ChapterPace is a chapter's own recorded pace: recordedSeconds (RC's coverage summary Items.PlayedSeconds, the
// mapped track's total played time) divided by wordCount (this engine's own word count for the same chapter).
// ok is false when either input cannot give a real rate (no words, or nothing recorded yet) - the caller reads
// that as unknown, never as a rate of zero.
func ChapterPace(wordCount int, recordedSeconds float64) (secondsPerWord float64, ok bool) {
	if wordCount <= 0 || recordedSeconds <= 0 {
		return 0, false
	}
	return recordedSeconds / float64(wordCount), true
}

// EstimateErrorFraction is how far the engine's fixed WordsPerFinishedHour estimate sits from a chapter's real
// recorded seconds, as a fraction of the estimate: positive means the fixed estimate over-predicts length (the
// chapter was read faster than the fixed rate assumes), negative means it under-predicts. Phase 6's own success
// signal ("estimate error reported"); Q2's "TBD - needs measurement" input. wordCount <= 0 answers 0 (nothing to
// compare), read as unknown by the caller, same as ChapterPace's ok=false.
func EstimateErrorFraction(wordCount int, recordedSeconds float64) float64 {
	if wordCount <= 0 {
		return 0
	}
	estimated := float64(wordCount) / wordsPerSecond
	if estimated == 0 {
		return 0
	}
	return (estimated - recordedSeconds) / estimated
}
