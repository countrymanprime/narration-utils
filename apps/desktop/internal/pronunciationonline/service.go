package pronunciationonline

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/credentialstore"
)

// MaxBatchWords bounds one batch lookup (Q11).
const MaxBatchWords = 200

// key is a pasted key's shape: Merriam-Webster's keys are UUIDs; this accepts any run of letters, digits and hyphens
// of a plausible length, so a pasted sentence, URL or stray space is refused before it is stored.
var key = regexp.MustCompile(`^[A-Za-z0-9-]{8,128}$`)

// KeyStatus is what the UI may know about the narrator's key: whether one is saved, never the key.
type KeyStatus struct {
	Source          string `json:"source"`
	Label           string `json:"label"`
	Present         bool   `json:"present"`
	ProtectedAtRest bool   `json:"protectedAtRest"`
}

// Result is one lookup's answer, and whether it came from the cache (no request made).
type Result struct {
	Word     string `json:"word"`
	Source   string `json:"source"`
	Label    string `json:"label"`
	Notation string `json:"notation"`
	Answer
	Cached    bool   `json:"cached"`
	FetchedAt string `json:"fetchedAt"`
}

// BatchResult counts what a confirmed batch did.
type BatchResult struct {
	Words     int  `json:"words"`
	Fetched   int  `json:"fetched"`
	FromCache int  `json:"fromCache"`
	NotFound  int  `json:"notFound"`
	Failed    int  `json:"failed"`
	Stopped   bool `json:"stopped"`
	// StopReason is why a batch stopped early (the key refused, the rate limit, no connection); empty when it ran out.
	StopReason string `json:"stopReason"`
}

// Service is the online lookup: the port's one Dictionary, the narrator's key in the credential store, and the cache.
// Lookups run one at a time, so a batch and a single press never race to send the same word twice.
type Service struct {
	dict  Dictionary
	keys  *credentialstore.Store
	cache *Cache
	now   func() time.Time
	mu    sync.Mutex
}

// NewService is the lookup for dict, keeping the key in the credentials file at credentialsPath and answers in the
// cache file at cachePath.
func NewService(dict Dictionary, credentialsPath, cachePath string) *Service {
	return &Service{dict: dict, keys: credentialstore.New(credentialsPath), cache: NewCache(cachePath, dict.Name()), now: time.Now}
}

// SignUpURL is the dictionary's fixed sign-up page, for the host to open in the narrator's browser.
func (s *Service) SignUpURL() string { return s.dict.SignUpURL() }

// KeyStatus says whether a key is saved.
func (s *Service) KeyStatus() (KeyStatus, error) {
	present, err := s.keys.Present(s.dict.Name())
	if err != nil {
		return KeyStatus{}, err
	}
	return KeyStatus{Source: s.dict.Name(), Label: s.dict.Label(), Present: present, ProtectedAtRest: credentialstore.ProtectedAtRest()}, nil
}

// SetKey saves the narrator's pasted key. Its errors never quote what was pasted.
func (s *Service) SetKey(raw string) (KeyStatus, error) {
	trimmed := strings.TrimSpace(raw)
	if !key.MatchString(trimmed) {
		return KeyStatus{}, ErrBadKey
	}
	if err := s.keys.Set(s.dict.Name(), credentialstore.NewSecret(trimmed)); err != nil {
		return KeyStatus{}, err
	}
	return s.KeyStatus()
}

// ClearKey removes the saved key. Cached answers stay: they hold no key.
func (s *Service) ClearKey() (KeyStatus, error) {
	if err := s.keys.Delete(s.dict.Name()); err != nil {
		return KeyStatus{}, err
	}
	return s.KeyStatus()
}

// Lookup answers for one word the narrator asked about: from the cache when it has the word (no request, no key
// needed), otherwise from the dictionary on the narrator's key, caching the answer.
func (s *Service) Lookup(ctx context.Context, raw string) (Result, error) {
	word, err := CheckWord(raw)
	if err != nil {
		return Result{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	secret, err := s.secretIfNeeded(word)
	if err != nil {
		return Result{}, err
	}
	result, _, err := s.lookup(ctx, word, secret)
	return result, err
}

// secretIfNeeded reads the key only when word is not cached, so a cached lookup never unseals it.
func (s *Service) secretIfNeeded(word string) (credentialstore.Secret, error) {
	if _, ok := s.cache.Get(word); ok {
		return credentialstore.Secret{}, nil
	}
	secret, ok, err := s.keys.Get(s.dict.Name())
	if err != nil {
		return credentialstore.Secret{}, err
	}
	if !ok {
		return credentialstore.Secret{}, ErrNoKey
	}
	return secret, nil
}

// lookup answers word from the cache or, on a miss, the dictionary; fetched reports whether a request was made.
// The caller holds s.mu.
func (s *Service) lookup(ctx context.Context, word string, secret credentialstore.Secret) (result Result, fetched bool, err error) {
	if entry, ok := s.cache.Get(word); ok {
		return s.result(word, entry, true), false, nil
	}
	if secret.Empty() {
		return Result{}, false, ErrNoKey
	}
	answer, err := s.dict.Lookup(ctx, word, secret)
	if err != nil {
		return Result{}, true, err
	}
	answer = tidy(answer)
	entry := CacheEntry{Answer: answer, FetchedAt: s.now().UTC()}
	// A cache that cannot be written still answers this press; the next press asks again.
	_ = s.cache.Put(word, entry.Answer, entry.FetchedAt)
	return s.result(word, entry, false), true, nil
}

func (s *Service) result(word string, entry CacheEntry, cached bool) Result {
	return Result{
		Word: word, Source: s.dict.Name(), Label: s.dict.Label(), Notation: s.dict.Notation(),
		Answer: tidy(entry.Answer), Cached: cached, FetchedAt: entry.FetchedAt.UTC().Format(time.RFC3339),
	}
}

// tidy gives an answer's lists as empty, never null, on the wire.
func tidy(answer Answer) Answer {
	if answer.Pronunciations == nil {
		answer.Pronunciations = []Pronunciation{}
	}
	if answer.Suggestions == nil {
		answer.Suggestions = []string{}
	}
	return answer
}

// LookupBatch looks up every word in raw, once each (Q11: opt-in with a notice). confirmedCount is the word count the
// narrator confirmed in the notice; a batch whose distinct word count is not exactly that is refused before anything is
// sent, so a batch can never send more words than the narrator agreed to. Words already cached cost no request. A
// refused key, the rate limit or a lost connection stops the batch rather than trying every remaining word.
func (s *Service) LookupBatch(ctx context.Context, raw []string, confirmedCount int) (BatchResult, error) {
	words, err := BatchWords(raw)
	if err != nil {
		return BatchResult{}, err
	}
	if confirmedCount != len(words) {
		return BatchResult{}, ErrBatchNotConfirmed
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	result := BatchResult{Words: len(words)}
	var secret credentialstore.Secret
	for _, word := range words {
		if _, ok := s.cache.Get(word); !ok && secret.Empty() {
			if secret, err = s.secretIfNeeded(word); err != nil {
				return BatchResult{}, err
			}
		}
		answer, fetched, err := s.lookup(ctx, word, secret)
		switch {
		case err == nil && fetched:
			result.Fetched++
		case err == nil:
			result.FromCache++
		case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
			result.Stopped, result.StopReason = true, "The lookup was cancelled."
			return result, nil
		case errors.Is(err, ErrKeyRefused), errors.Is(err, ErrRateLimited), errors.Is(err, ErrUnreachable):
			result.Failed++
			result.Stopped, result.StopReason = true, capitalize(err.Error())
			return result, nil
		default:
			result.Failed++
			continue
		}
		if !answer.Found {
			result.NotFound++
		}
	}
	return result, nil
}

// BatchWords is the distinct words a batch of raw would send, in first-seen order: every entry must pass CheckWord, and
// "Wren" and "wren" are one word. The UI's notice counts the same list.
func BatchWords(raw []string) ([]string, error) {
	seen := map[string]bool{}
	words := []string{}
	for _, entry := range raw {
		word, err := CheckWord(entry)
		if err != nil {
			return nil, err
		}
		if seen[cacheKey(word)] {
			continue
		}
		seen[cacheKey(word)] = true
		words = append(words, word)
	}
	if len(words) == 0 {
		return nil, ErrNotAWord
	}
	if len(words) > MaxBatchWords {
		return nil, ErrBatchTooLarge
	}
	return words, nil
}

func capitalize(text string) string {
	if text == "" {
		return text
	}
	return strings.ToUpper(text[:1]) + text[1:]
}
