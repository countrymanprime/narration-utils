package pronunciationonline_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/pronunciationonline"
	"github.com/countrymanprime/narration-utils/shell/internal/pronunciationonline/pronunciationonlinetest"
)

const rawKey = "0b5c1a3e-7d2f-4e6a-9c8b-2f1e0d9c8b7a"

func newService(t *testing.T) (*pronunciationonline.Service, *pronunciationonlinetest.Fake, string) {
	t.Helper()
	dir := t.TempDir()
	fake := pronunciationonlinetest.New()
	return pronunciationonline.NewService(fake, filepath.Join(dir, "credentials.json"), filepath.Join(dir, "pronunciation", "cache.json")), fake, dir
}

func withKey(t *testing.T) (*pronunciationonline.Service, *pronunciationonlinetest.Fake, string) {
	t.Helper()
	service, fake, dir := newService(t)
	if _, err := service.SetKey(rawKey); err != nil {
		t.Fatal(err)
	}
	return service, fake, dir
}

func TestCheckWordAcceptsANameAndRefusesEverythingElse(t *testing.T) {
	for raw, want := range map[string]string{
		"croquet":           "croquet",
		"  Mock   Turtle ":  "Mock Turtle",
		"O'Brien":           "O'Brien",
		"O\u2019Brien":      "O\u2019Brien",
		"café":              "café",
		"Jean-Luc":          "Jean-Luc",
		"St. John":          "St. John",
		"Henry VIII":        "Henry VIII",
		"Louis 14":          "Louis 14",
		"Ælfgifu":           "Ælfgifu",
		"Nguyễn":            "Nguyễn",
		"Zoë":               "Zoë",
		"R2-D2":             "R2-D2",
		"Dr. Jekyll's Maid": "Dr. Jekyll's Maid",
	} {
		got, err := pronunciationonline.CheckWord(raw)
		if err != nil || got != want {
			t.Errorf("CheckWord(%q) = %q, %v; want %q", raw, got, err, want)
		}
	}
	for _, raw := range []string{
		"",
		"   ",
		"The Mock Turtle sighed deeply", // a passage: more than three words
		"chapter-01.docx/../x",          // a path
		`C:\Books\alice.docx`,           // a file name
		"alice.docx?id=42",              // a query
		"wren\nsparrow",                 // a line break joins two lines into one request
		"proj_7f3a",                     // an identifier's underscore
		"who?",                          // sentence punctuation
		"a,b",                           // a list
		"42",                            // no letter
		strings.Repeat("a", pronunciationonline.MaxWordRunes+1),
		"\xff\xfe",
	} {
		if got, err := pronunciationonline.CheckWord(raw); !errors.Is(err, pronunciationonline.ErrNotAWord) {
			t.Errorf("CheckWord(%q) = %q, %v; want ErrNotAWord", raw, got, err)
		} else if raw != "" && strings.TrimSpace(raw) != "" && strings.Contains(err.Error(), strings.TrimSpace(raw)) {
			t.Errorf("CheckWord(%q)'s error quotes it: %v", raw, err)
		}
	}
}

// D72: an online lookup sends one word only. The dictionary is handed exactly the checked word and the narrator's key.
func TestALookupHandsTheDictionaryTheWordAndTheKeyAlone(t *testing.T) {
	service, fake, _ := withKey(t)
	result, err := service.Lookup(context.Background(), "  croquet ")
	if err != nil {
		t.Fatal(err)
	}
	if !result.Found || result.Cached || len(result.Pronunciations) != 1 || result.Pronunciations[0].Spelling != "krō-ˈkā" {
		t.Fatalf("Lookup = %+v; want croquet's pronunciation, fetched", result)
	}
	calls := fake.Calls()
	if len(calls) != 1 || calls[0] != (pronunciationonlinetest.Call{Word: "croquet", Key: rawKey}) {
		t.Fatalf("the dictionary was called with %+v; want exactly one call with the word and the key", calls)
	}
}

// D72: a passage, a file name or a project id is refused before the dictionary is ever asked.
func TestALookupOfMoreThanOneWordNeverReachesTheDictionary(t *testing.T) {
	service, fake, _ := withKey(t)
	for _, raw := range []string{"The Mock Turtle sighed deeply and drew", `C:\Books\alice.docx`, "proj_7f3a"} {
		if _, err := service.Lookup(context.Background(), raw); !errors.Is(err, pronunciationonline.ErrNotAWord) {
			t.Errorf("Lookup(%q) = %v; want ErrNotAWord", raw, err)
		}
	}
	if calls := fake.Calls(); len(calls) != 0 {
		t.Fatalf("the dictionary was called %d times for refused input", len(calls))
	}
}

// D72: results are cached locally. A second lookup of the same word, in any case, makes no second request, and is
// answered even with the key removed (an offline narrator still sees the last answer).
func TestASecondLookupOfTheSameWordIsServedFromTheCache(t *testing.T) {
	service, fake, dir := withKey(t)
	if _, err := service.Lookup(context.Background(), "croquet"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ClearKey(); err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{"croquet", "Croquet", " CROQUET "} {
		result, err := service.Lookup(context.Background(), raw)
		if err != nil || !result.Cached || !result.Found {
			t.Fatalf("Lookup(%q) again = %+v, %v; want the cached answer", raw, result, err)
		}
	}
	if calls := fake.Calls(); len(calls) != 1 {
		t.Fatalf("the dictionary was called %d times; want once, the rest from the cache", len(calls))
	}
	// A fresh service over the same files still has it: the cache is on disk, not in memory.
	again := pronunciationonline.NewService(fake, filepath.Join(dir, "credentials.json"), filepath.Join(dir, "pronunciation", "cache.json"))
	if result, err := again.Lookup(context.Background(), "croquet"); err != nil || !result.Cached {
		t.Fatalf("a fresh service's lookup = %+v, %v; want the cached answer", result, err)
	}
	// A not-found answer is cached too: asking again for a word the dictionary lacks costs nothing.
	if _, err := service.SetKey(rawKey); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if result, err := service.Lookup(context.Background(), "quorlen"); err != nil || result.Found || len(result.Suggestions) != 2 {
			t.Fatalf("Lookup(quorlen) = %+v, %v; want not found with suggestions", result, err)
		}
	}
	if calls := fake.Calls(); len(calls) != 2 {
		t.Fatalf("the dictionary was called %d times; want 2 (croquet and quorlen, once each)", len(calls))
	}
	// The cache holds answers, never the key.
	bytes, err := os.ReadFile(filepath.Join(dir, "pronunciation", "cache.json"))
	if err != nil || strings.Contains(string(bytes), rawKey) {
		t.Fatalf("the cache file = %v, holds the key %v", err, strings.Contains(string(bytes), rawKey))
	}
}

// A failed lookup is not cached: the next press asks again.
func TestAFailedLookupIsNotCached(t *testing.T) {
	service, fake, _ := withKey(t)
	fake.Errs = map[string]error{"croquet": pronunciationonline.ErrUnreachable}
	if _, err := service.Lookup(context.Background(), "croquet"); !errors.Is(err, pronunciationonline.ErrUnreachable) {
		t.Fatalf("Lookup = %v, want ErrUnreachable", err)
	}
	fake.Errs = nil
	if result, err := service.Lookup(context.Background(), "croquet"); err != nil || result.Cached {
		t.Fatalf("Lookup after a failure = %+v, %v; want a fresh fetch", result, err)
	}
}

// The key is the narrator's own: without one, nothing is sent.
func TestALookupWithoutAKeySendsNothing(t *testing.T) {
	service, fake, _ := newService(t)
	if _, err := service.Lookup(context.Background(), "croquet"); !errors.Is(err, pronunciationonline.ErrNoKey) {
		t.Fatalf("Lookup without a key = %v, want ErrNoKey", err)
	}
	if _, err := service.LookupBatch(context.Background(), []string{"croquet"}, 1); !errors.Is(err, pronunciationonline.ErrNoKey) {
		t.Fatalf("LookupBatch without a key = %v, want ErrNoKey", err)
	}
	if calls := fake.Calls(); len(calls) != 0 {
		t.Fatalf("the dictionary was called %d times without a key", len(calls))
	}
}

func TestSetKeyStoresOnlyAKeyShapedValueAndNeverQuotesIt(t *testing.T) {
	service, _, dir := newService(t)
	for _, bad := range []string{"", "short", "https://dictionaryapi.com/?key=" + rawKey, rawKey + " and more", "key with spaces"} {
		if _, err := service.SetKey(bad); !errors.Is(err, pronunciationonline.ErrBadKey) {
			t.Errorf("SetKey(%q) = %v; want ErrBadKey", bad, err)
		} else if strings.Contains(err.Error(), rawKey) {
			t.Errorf("SetKey's error quotes the pasted text: %v", err)
		}
	}
	status, err := service.SetKey("  " + rawKey + "\n")
	if err != nil || !status.Present || status.Source != "merriam_webster" {
		t.Fatalf("SetKey = %+v, %v; want a saved key", status, err)
	}
	cleared, err := service.ClearKey()
	if err != nil || cleared.Present {
		t.Fatalf("ClearKey = %+v, %v; want no key", cleared, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "credentials.json")); err != nil {
		t.Fatalf("the key went somewhere other than the credentials file: %v", err)
	}
}

// Q11: a batch is opt-in with a notice. The confirmed count must be exactly the number of distinct words the batch would
// send, or nothing is sent.
func TestABatchSendsNothingUnlessItsWordCountWasConfirmed(t *testing.T) {
	service, fake, _ := withKey(t)
	words := []string{"croquet", "Wren", "wren", "quorlen"} // three distinct words
	for _, confirmed := range []int{0, 1, 2, 4, -1} {
		if _, err := service.LookupBatch(context.Background(), words, confirmed); !errors.Is(err, pronunciationonline.ErrBatchNotConfirmed) {
			t.Errorf("LookupBatch confirmed %d of 3 = %v; want ErrBatchNotConfirmed", confirmed, err)
		}
	}
	if calls := fake.Calls(); len(calls) != 0 {
		t.Fatalf("an unconfirmed batch sent %d requests", len(calls))
	}
	result, err := service.LookupBatch(context.Background(), words, 3)
	if err != nil {
		t.Fatal(err)
	}
	if result != (pronunciationonline.BatchResult{Words: 3, Fetched: 3, NotFound: 1}) {
		t.Fatalf("LookupBatch = %+v", result)
	}
	// Once per batch, never once per word, and a word looked up before costs nothing.
	again, err := service.LookupBatch(context.Background(), []string{"croquet", "wren"}, 2)
	if err != nil || again.FromCache != 2 || again.Fetched != 0 {
		t.Fatalf("LookupBatch of cached words = %+v, %v", again, err)
	}
	if calls := fake.Calls(); len(calls) != 3 {
		t.Fatalf("the dictionary was called %d times; want 3", len(calls))
	}
}

func TestABatchRefusesABadWordAndTooManyWordsBeforeSendingAny(t *testing.T) {
	service, fake, _ := withKey(t)
	if _, err := service.LookupBatch(context.Background(), []string{"croquet", "a whole sentence of text"}, 2); !errors.Is(err, pronunciationonline.ErrNotAWord) {
		t.Fatalf("a batch with a passage = %v, want ErrNotAWord", err)
	}
	many := make([]string, 0, pronunciationonline.MaxBatchWords+1)
	for i := range pronunciationonline.MaxBatchWords + 1 {
		many = append(many, "w"+string([]rune{rune('a' + i/676%26), rune('a' + i/26%26), rune('a' + i%26)}))
	}
	if _, err := service.LookupBatch(context.Background(), many, len(many)); !errors.Is(err, pronunciationonline.ErrBatchTooLarge) {
		t.Fatalf("a batch of %d = %v, want ErrBatchTooLarge", len(many), err)
	}
	if calls := fake.Calls(); len(calls) != 0 {
		t.Fatalf("a refused batch sent %d requests", len(calls))
	}
}

func TestABatchStopsWhenTheKeyIsRefused(t *testing.T) {
	service, fake, _ := withKey(t)
	fake.Errs = map[string]error{"wren": pronunciationonline.ErrKeyRefused}
	result, err := service.LookupBatch(context.Background(), []string{"croquet", "wren", "quorlen"}, 3)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Stopped || result.Fetched != 1 || result.Failed != 1 || !strings.HasPrefix(result.StopReason, "Merriam-Webster refused") {
		t.Fatalf("LookupBatch = %+v; want it stopped at the refused key", result)
	}
	if calls := fake.Calls(); len(calls) != 2 {
		t.Fatalf("the dictionary was called %d times; want 2, none after the refusal", len(calls))
	}
}
