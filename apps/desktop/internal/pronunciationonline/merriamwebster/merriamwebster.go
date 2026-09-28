// Package merriamwebster is the Merriam-Webster Collegiate Dictionary API adapter for the online pronunciation port
// (pronunciationonline.Dictionary; ADR 0405 point 2, ADR 0355; prep-depth.prd.md Phase 9). It is the only package in the Go
// host's pronunciation code that makes an HTTP request, and .golangci.yml's depguard rule allows net here for that alone.
//
// A request goes to one fixed host and path, built here from the looked-up word and the narrator's key and nothing else:
// no header of its own, no cookie, no body, no redirect followed (a redirect could carry the key to another host). The
// key and the word never appear in an error: a transport error is replaced by pronunciationonline.ErrUnreachable
// rather than wrapped, because Go's *url.Error quotes the whole URL, key included.
//
// The endpoint, sign-up page and response shape are per Merriam-Webster's own developer documentation
// (dictionaryapi.com), not re-read live: this session's egress proxy refuses dictionaryapi.com (Phase 0 note,
// docs/research/merriam-webster-api.md). CI and tests never call it.
package merriamwebster

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/credentialstore"
	"github.com/countrymanprime/narration-utils/shell/internal/pronunciationonline"
)

const (
	// Host is the one host this adapter sends a request to.
	Host = "www.dictionaryapi.com"
	// endpoint is the Collegiate Dictionary's lookup path; the word is its last path segment.
	endpoint = "https://" + Host + "/api/v3/references/collegiate/json/"
	// SignUpURL is Merriam-Webster's free developer key sign-up page, opened in the narrator's browser.
	SignUpURL = "https://dictionaryapi.com/register/index"
	// maxBody bounds a response read; a Collegiate answer for one word is a few kilobytes.
	maxBody = 2 << 20
	// timeout bounds one request.
	timeout = 15 * time.Second
	// maxPronunciations and maxSuggestions bound what one answer keeps.
	maxPronunciations = 8
	maxSuggestions    = 10
)

// Dictionary is the Merriam-Webster adapter.
type Dictionary struct {
	base   string
	client *http.Client
}

var _ pronunciationonline.Dictionary = (*Dictionary)(nil)

// New is the adapter for the real API.
func New() *Dictionary { return newWithBase(endpoint, nil) }

// newWithBase is the adapter against base (a test server); client nil means a default one.
func newWithBase(base string, client *http.Client) *Dictionary {
	if client == nil {
		client = &http.Client{Timeout: timeout}
	}
	// Never follow a redirect: the key is in the query, and a redirect could forward it to another host.
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &Dictionary{base: base, client: client}
}

func (d *Dictionary) Name() string      { return "merriam_webster" }
func (d *Dictionary) Label() string     { return "Merriam-Webster" }
func (d *Dictionary) Host() string      { return Host }
func (d *Dictionary) SignUpURL() string { return SignUpURL }
func (d *Dictionary) Notation() string  { return "Merriam-Webster respelling" }

// newRequest builds the one request a lookup sends: GET base + the word as one escaped path segment + ?key=, with no
// header, cookie or body of its own.
func newRequest(ctx context.Context, base, word string, key credentialstore.Secret) (*http.Request, error) {
	address := base + url.PathEscape(word) + "?" + url.Values{"key": {key.Reveal()}}.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		// Never wrap: the error would quote the address.
		return nil, pronunciationonline.ErrUnavailable
	}
	return request, nil
}

// Lookup asks Merriam-Webster for word's pronunciations.
func (d *Dictionary) Lookup(ctx context.Context, word string, key credentialstore.Secret) (pronunciationonline.Answer, error) {
	if key.Empty() {
		return pronunciationonline.Answer{}, pronunciationonline.ErrNoKey
	}
	request, err := newRequest(ctx, d.base, word, key)
	if err != nil {
		return pronunciationonline.Answer{}, err
	}
	response, err := d.client.Do(request)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return pronunciationonline.Answer{}, ctxErr
		}
		return pronunciationonline.Answer{}, pronunciationonline.ErrUnreachable
	}
	defer func() { _ = response.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(response.Body, maxBody))
	if err != nil {
		return pronunciationonline.Answer{}, pronunciationonline.ErrUnreachable
	}
	switch {
	case response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden:
		return pronunciationonline.Answer{}, pronunciationonline.ErrKeyRefused
	case response.StatusCode == http.StatusTooManyRequests:
		return pronunciationonline.Answer{}, pronunciationonline.ErrRateLimited
	case response.StatusCode != http.StatusOK:
		return pronunciationonline.Answer{}, pronunciationonline.ErrUnavailable
	}
	return parse(word, body)
}

// entry is the part of a Collegiate entry this adapter reads.
type entry struct {
	Meta struct {
		ID    string   `json:"id"`
		Stems []string `json:"stems"`
	} `json:"meta"`
	Hwi struct {
		Hw  string `json:"hw"`
		Prs []struct {
			Mw string `json:"mw"`
		} `json:"prs"`
	} `json:"hwi"`
}

// parse reads a Collegiate answer: an array of entries when the word is in the dictionary, an array of suggested
// spellings when it is not, and (per the API's documentation) a plain-text message rather than JSON when the key is
// not valid for this reference.
func parse(word string, body []byte) (pronunciationonline.Answer, error) {
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 || trimmed[0] != '[' {
		if bytes.Contains(bytes.ToLower(trimmed), []byte("key")) {
			return pronunciationonline.Answer{}, pronunciationonline.ErrKeyRefused
		}
		return pronunciationonline.Answer{}, pronunciationonline.ErrUnavailable
	}
	var raw []json.RawMessage
	if err := json.Unmarshal(trimmed, &raw); err != nil {
		return pronunciationonline.Answer{}, pronunciationonline.ErrUnavailable
	}
	answer := pronunciationonline.Answer{Pronunciations: []pronunciationonline.Pronunciation{}, Suggestions: []string{}}
	if len(raw) == 0 {
		return answer, nil
	}
	var suggestion string
	if json.Unmarshal(raw[0], &suggestion) == nil {
		for _, item := range raw {
			if len(answer.Suggestions) == maxSuggestions {
				break
			}
			if json.Unmarshal(item, &suggestion) == nil && suggestion != "" {
				answer.Suggestions = append(answer.Suggestions, suggestion)
			}
		}
		return answer, nil
	}
	entries := make([]entry, 0, len(raw))
	for _, item := range raw {
		var e entry
		if json.Unmarshal(item, &e) == nil {
			entries = append(entries, e)
		}
	}
	if len(entries) == 0 {
		return pronunciationonline.Answer{}, pronunciationonline.ErrUnavailable
	}
	// The entries for this word itself ("croquet", "croquet:1", or a stem of it) come first; an answer whose entries are
	// all for other words (a phrase containing it) falls back to the first entry.
	matching := []entry{}
	for _, e := range entries {
		if matches(e, word) {
			matching = append(matching, e)
		}
	}
	if len(matching) == 0 {
		matching = entries[:1]
	}
	seen := map[string]bool{}
	for _, e := range matching {
		headword := strings.ReplaceAll(e.Hwi.Hw, "*", "·")
		for _, pr := range e.Hwi.Prs {
			spelling := strings.TrimSpace(pr.Mw)
			if spelling == "" || seen[spelling] || len(answer.Pronunciations) == maxPronunciations {
				continue
			}
			seen[spelling] = true
			answer.Pronunciations = append(answer.Pronunciations, pronunciationonline.Pronunciation{Headword: headword, Spelling: spelling})
		}
	}
	answer.Found = len(answer.Pronunciations) > 0
	return answer, nil
}

func matches(e entry, word string) bool {
	id, _, _ := strings.Cut(e.Meta.ID, ":")
	if strings.EqualFold(id, word) {
		return true
	}
	for _, stem := range e.Meta.Stems {
		if strings.EqualFold(stem, word) {
			return true
		}
	}
	return false
}
