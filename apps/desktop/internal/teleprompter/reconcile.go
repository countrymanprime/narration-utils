package teleprompter

// ResumeTolerance is how many script words apart the DAW word and the prompter's last word may be and still agree
// (read-aloud-resume-from-daw PRD RD1 (c): within ten words, or in the same sentence). Locate is accurate to about
// two words (ADR 0111), the tracker's last `read` lags speech by about one confirmed word, and a narrator often reads
// a few words past where the recording stopped.
const ResumeTolerance = 10

// Verdict kinds: what the resume prompt shows (PRD Phase 3).
const (
	// VerdictAgree: both sources are within the tolerance; Start reading is preset to Start, with a notice.
	VerdictAgree = "agree"
	// VerdictDisagree: both are known and far apart (or a low-confidence DAW word the prompter contradicts); the
	// narrator picks one of the two places.
	VerdictDisagree = "disagree"
	// VerdictComplete: the recording reaches the chapter's last word; there is nothing to resume.
	VerdictComplete = "complete"
	// VerdictDAWOnly: only the recording has a place (no reading stored); it is offered, never preset.
	VerdictDAWOnly = "daw_only"
	// VerdictPrompterOnly: only the last reading has a place (no track or nothing placed); it is offered, never
	// preset, because reading is not recording (RD8).
	VerdictPrompterOnly = "prompter_only"
	// VerdictNone: neither source has a place; nothing is shown and Start reading begins at the top.
	VerdictNone = "none"
)

// ConfirmedByPrompter marks a verdict whose DAW word was a low-confidence guess until the prompter's last word
// agreed with it: the prompter settles the ambiguity the confidence reports.
const ConfirmedByPrompter = "prompter"

// DAWSourceSaved is a DAW place read from the saved .rpp ("as of the project's last save"). Phase 4 adds the live
// source ("in REAPER now").
const DAWSourceSaved = "saved"

// ResumePlace is one source's place in the chapter. Word is the next script word to read, zero-based (the index
// Start reading takes); Number is the same word one-based, for display; Sentence is the sentence holding the last
// word read before it.
type ResumePlace struct {
	Word      int       `json:"word"`
	Number    int       `json:"number"`
	Sentence  *Sentence `json:"sentence"`
	Confident bool      `json:"confident"`
	Source    string    `json:"source,omitempty"`
}

// ResumeVerdict is the host's one answer to "where does reading resume" (PRD Phase 3): the UI renders it and does
// no arithmetic. Start is set only for agree: the word Start reading begins at without a click. DAW and Prompter are
// each source's place, when it has one; Tokens is the chapter's token count.
type ResumeVerdict struct {
	Kind        string       `json:"kind"`
	Start       *int         `json:"start"`
	ConfirmedBy string       `json:"confirmedBy,omitempty"`
	DAW         *ResumePlace `json:"daw"`
	Prompter    *ResumePlace `json:"prompter"`
	Tokens      int          `json:"tokens"`
}

// Reconcile compares where the recording ends (daw, the tail locate over the saved project, ADR 0111) with where the
// prompter last was (prompter, ADR 0205) in script. A source whose token count is not script's is ignored rather
// than compared across two tokenisations. The DAW word wins when they agree (RD3): the recording is the truth, and
// the prompter may have read on without recording. A low-confidence DAW word never agrees by itself; within the
// tolerance of the prompter's word it agrees, confirmed by the prompter.
func Reconcile(daw *Located, prompter *Reading, script ChapterScript, tolerance int) ResumeVerdict {
	tokens := len(script.Tokens)
	verdict := ResumeVerdict{Kind: VerdictNone, Tokens: tokens}
	if daw != nil && daw.Word != nil && daw.Tokens == tokens && *daw.Word >= 0 && *daw.Word <= tokens {
		verdict.DAW = script.place(*daw.Word, daw.Confident)
		verdict.DAW.Source = DAWSourceSaved
	}
	if prompter != nil && prompter.Tokens == tokens && prompter.Read > 0 && prompter.Read <= tokens {
		verdict.Prompter = script.place(prompter.Read, true)
	}
	d, p := verdict.DAW, verdict.Prompter
	switch {
	case d == nil && p == nil:
		return verdict
	case d == nil:
		if script.WordsLeft(p.Word) {
			verdict.Kind = VerdictPrompterOnly
		}
		return verdict
	case p == nil:
		verdict.Kind = VerdictDAWOnly
		if !script.WordsLeft(d.Word) {
			verdict.Kind = VerdictComplete
		}
		return verdict
	}
	near := script.near(d.Word, p.Word, tolerance)
	if !script.WordsLeft(d.Word) {
		switch {
		case d.Confident:
			verdict.Kind = VerdictComplete
		case near:
			verdict.Kind, verdict.ConfirmedBy = VerdictComplete, ConfirmedByPrompter
		default:
			verdict.Kind = VerdictDisagree
		}
		return verdict
	}
	if !near {
		verdict.Kind = VerdictDisagree
		return verdict
	}
	start := d.Word
	verdict.Kind, verdict.Start = VerdictAgree, &start
	if !d.Confident {
		verdict.ConfirmedBy = ConfirmedByPrompter
	}
	return verdict
}

// lastRead is the token holding the last word read before next word word, clamped into the script.
func (script ChapterScript) lastRead(word int) int {
	return min(max(word-1, 0), len(script.Tokens)-1)
}

// place is the ResumePlace for next word word.
func (script ChapterScript) place(word int, confident bool) *ResumePlace {
	place := &ResumePlace{Word: word, Number: word + 1, Confident: confident}
	if len(script.Tokens) > 0 {
		sentence := script.SentenceAt(script.lastRead(word))
		place.Sentence = &sentence
	}
	return place
}

// near reports whether next words a and b agree: within tolerance words, or with their last read words in the same
// sentence.
func (script ChapterScript) near(a, b, tolerance int) bool {
	if abs(a-b) <= tolerance {
		return true
	}
	if len(script.Tokens) == 0 {
		return false
	}
	return script.SentenceAt(script.lastRead(a)).Start == script.SentenceAt(script.lastRead(b)).Start
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}
