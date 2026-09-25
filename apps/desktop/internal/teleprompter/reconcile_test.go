package teleprompter

import (
	"strings"
	"testing"
)

// Resume reconciles where the recording ends with where the prompter last was (read-aloud-resume-from-daw PRD
// Phase 3, RD1, RD3, RD8).

// reconcileScript is four sentences of words, "w0 ... w9.", "w10 ... w19.", "w20 ... w39." (longer than the
// tolerance) and "w40 ... w49.", one paragraph, followed by two punctuation-only tokens (so the chapter's last word is
// token 49 and it has 52 tokens).
func reconcileScript() ChapterScript {
	tokens := make([]string, 0, 52)
	for i := 0; i < 50; i++ {
		word := "w" + itoa(i)
		if i%10 == 9 && i != 29 {
			word += "."
		}
		tokens = append(tokens, word)
	}
	tokens = append(tokens, "—", "*")
	return ChapterScript{Tokens: tokens, Breaks: []int{0}}
}

func itoa(n int) string {
	if n < 10 {
		return string(rune('0' + n))
	}
	return itoa(n/10) + string(rune('0'+n%10))
}

func dawAt(word int, confident bool) *Located {
	last := word - 1
	return &Located{Word: &word, Last: &last, Confident: confident, Tokens: 52, Confidence: 0.4}
}

func readAt(read int) *Reading { return &Reading{Read: read, Tokens: 52} }

func TestReconcileAnswersEveryVerdict(t *testing.T) {
	script := reconcileScript()
	for _, c := range []struct {
		name        string
		daw         *Located
		prompter    *Reading
		kind        string
		start       *int
		confirmedBy string
	}{
		{"agree within the tolerance, across a sentence end", dawAt(18, true), readAt(24), VerdictAgree, intp(18), ""},
		{"agree in the same sentence beyond the tolerance", dawAt(21, true), readAt(35), VerdictAgree, intp(21), ""},
		{"agree at exactly the tolerance", dawAt(30, true), readAt(40), VerdictAgree, intp(30), ""},
		{"disagree past the tolerance in another sentence", dawAt(12, true), readAt(31), VerdictDisagree, nil, ""},
		{"the prompter settles a low-confidence DAW word", dawAt(33, false), readAt(35), VerdictAgree, intp(33), ConfirmedByPrompter},
		{"a low-confidence DAW word the prompter contradicts", dawAt(5, false), readAt(40), VerdictDisagree, nil, ""},
		{"a low-confidence DAW word alone is only offered", dawAt(5, false), nil, VerdictDAWOnly, nil, ""},
		{"a confident DAW word alone is only offered", dawAt(5, true), nil, VerdictDAWOnly, nil, ""},
		{"recorded to the last word", dawAt(50, true), nil, VerdictComplete, nil, ""},
		{"recorded past the last word, only punctuation left", dawAt(51, true), readAt(12), VerdictComplete, nil, ""},
		{"recorded to the end beats a prompter mid-chapter", dawAt(52, true), readAt(20), VerdictComplete, nil, ""},
		{"a low-confidence end the prompter confirms", dawAt(50, false), readAt(48), VerdictComplete, nil, ConfirmedByPrompter},
		{"a low-confidence end the prompter contradicts", dawAt(50, false), readAt(20), VerdictDisagree, nil, ""},
		{"a low-confidence end alone is complete", dawAt(52, false), nil, VerdictComplete, nil, ""},
		{"prompter only", nil, readAt(20), VerdictPrompterOnly, nil, ""},
		{"prompter only, but it read to the end", nil, readAt(52), VerdictNone, nil, ""},
		{"a tail that could not be placed counts as no DAW word", &Located{Tokens: 52}, readAt(20), VerdictPrompterOnly, nil, ""},
		{"neither", nil, nil, VerdictNone, nil, ""},
	} {
		t.Run(c.name, func(t *testing.T) {
			got := Reconcile(c.daw, c.prompter, script, ResumeTolerance)
			if got.Kind != c.kind || !sameIntp(got.Start, c.start) || got.ConfirmedBy != c.confirmedBy {
				t.Fatalf("Reconcile = %+v (start %v), want kind %q start %v confirmedBy %q", got, derefp(got.Start), c.kind, derefp(c.start), c.confirmedBy)
			}
			if got.Tokens != 52 {
				t.Fatalf("tokens = %d", got.Tokens)
			}
		})
	}
}

func TestReconcileQuotesBothPlacesOneBased(t *testing.T) {
	got := Reconcile(dawAt(12, true), readAt(31), reconcileScript(), ResumeTolerance)

	if got.DAW == nil || got.DAW.Word != 12 || got.DAW.Number != 13 || !got.DAW.Confident || got.DAW.Source != DAWSourceSaved {
		t.Fatalf("daw = %+v", got.DAW)
	}
	// Each place quotes the sentence holding the last word read before it.
	if got.DAW.Sentence == nil || got.DAW.Sentence.Start != 10 || !strings.HasSuffix(got.DAW.Sentence.Text, "w19.") {
		t.Fatalf("daw sentence = %+v", got.DAW.Sentence)
	}
	if got.Prompter == nil || got.Prompter.Word != 31 || got.Prompter.Number != 32 || got.Prompter.Sentence == nil || got.Prompter.Sentence.Start != 20 || !strings.HasSuffix(got.Prompter.Sentence.Text, "w39.") {
		t.Fatalf("prompter = %+v", got.Prompter)
	}
}

func TestReconcileNeverOffersAWordOutsideTheScript(t *testing.T) {
	script := reconcileScript()
	// A reading from another tokenisation of the chapter (its token count differs) is not compared.
	if got := Reconcile(dawAt(20, true), &Reading{Read: 20, Tokens: 60}, script, ResumeTolerance); got.Kind != VerdictDAWOnly || got.Prompter != nil {
		t.Fatalf("Reconcile = %+v", got)
	}
	// A locate over a different token count is not trusted either.
	word, last := 20, 19
	if got := Reconcile(&Located{Word: &word, Last: &last, Confident: true, Tokens: 40}, nil, script, ResumeTolerance); got.Kind != VerdictNone || got.DAW != nil {
		t.Fatalf("Reconcile = %+v", got)
	}
	// A reading at word 0 read nothing.
	if got := Reconcile(nil, readAt(0), script, ResumeTolerance); got.Kind != VerdictNone {
		t.Fatalf("Reconcile = %+v", got)
	}
}

func intp(n int) *int { return &n }

func sameIntp(a, b *int) bool { return (a == nil) == (b == nil) && (a == nil || *a == *b) }

func derefp(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}
