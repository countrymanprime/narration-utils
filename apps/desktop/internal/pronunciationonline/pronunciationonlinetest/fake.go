// Package pronunciationonlinetest is a fake online Dictionary (D67: mock-first behind the port). Tests, the contract
// goldens and the privacy-rule tests run against it; nothing here touches the network.
package pronunciationonlinetest

import (
	"context"
	"strings"
	"sync"

	"github.com/countrymanprime/narration-utils/shell/internal/credentialstore"
	"github.com/countrymanprime/narration-utils/shell/internal/pronunciationonline"
)

// Call is one request the fake received: the word and the key it would have sent.
type Call struct {
	Word string
	Key  string
}

// Fake answers from Answers (keyed by the lower-cased word); a word it does not have is not found, with no suggestions.
// Errs, when it has the word, answers with that error instead.
type Fake struct {
	Answers map[string]pronunciationonline.Answer
	Errs    map[string]error
	mu      sync.Mutex
	calls   []Call
}

var _ pronunciationonline.Dictionary = (*Fake)(nil)

// New is a fake that knows the Merriam-Webster answers the demo build and the goldens use.
func New() *Fake {
	return &Fake{Answers: map[string]pronunciationonline.Answer{
		"croquet": {Found: true, Pronunciations: []pronunciationonline.Pronunciation{{Headword: "cro·quet", Spelling: "krō-ˈkā"}}},
		"wren":    {Found: true, Pronunciations: []pronunciationonline.Pronunciation{{Headword: "wren", Spelling: "ˈren"}}},
		"quorlen": {Found: false, Suggestions: []string{"quorum", "sorrel"}},
	}}
}

func (f *Fake) Name() string      { return "merriam_webster" }
func (f *Fake) Label() string     { return "Merriam-Webster" }
func (f *Fake) Host() string      { return "fake.invalid" }
func (f *Fake) SignUpURL() string { return "https://fake.invalid/register" }
func (f *Fake) Notation() string  { return "Merriam-Webster respelling" }

func (f *Fake) Lookup(ctx context.Context, word string, key credentialstore.Secret) (pronunciationonline.Answer, error) {
	if err := ctx.Err(); err != nil {
		return pronunciationonline.Answer{}, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, Call{Word: word, Key: key.Reveal()})
	lower := strings.ToLower(word)
	if err := f.Errs[lower]; err != nil {
		return pronunciationonline.Answer{}, err
	}
	return f.Answers[lower], nil
}

// Calls is every request the fake received, in order.
func (f *Fake) Calls() []Call {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]Call(nil), f.calls...)
}
