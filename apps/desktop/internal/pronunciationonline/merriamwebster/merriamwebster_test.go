package merriamwebster

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/credentialstore"
	"github.com/countrymanprime/narration-utils/shell/internal/pronunciationonline"
)

const rawKey = "0b5c1a3e-7d2f-4e6a-9c8b-2f1e0d9c8b7a"

var key = credentialstore.NewSecret(rawKey)

// A Collegiate answer for "croquet", shaped as the API's documentation shows it (two homographs, one with two
// pronunciations, plus an entry for another word that happens to contain it).
const croquet = `[
 {"meta":{"id":"croquet:1","stems":["croquet","croquets"]},"hwi":{"hw":"cro*quet","prs":[{"mw":"krō-ˈkā","sound":{"audio":"croque01"}},{"mw":"ˈkrō-ˌkā"}]},"fl":"noun"},
 {"meta":{"id":"croquet:2","stems":["croquet","croqueted"]},"hwi":{"hw":"croquet","prs":[{"mw":"krō-ˈkā"}]},"fl":"verb"},
 {"meta":{"id":"croquet ground","stems":["croquet ground"]},"hwi":{"hw":"croquet ground","prs":[{"mw":"-ˌgrau̇nd"}]}}
]`

type recorded struct {
	method, path, rawQuery, host string
	header                       http.Header
	body                         []byte
}

// server is a stand-in for the API that records every request it gets.
func server(t *testing.T, status int, body string) (*Dictionary, *[]recorded) {
	t.Helper()
	var mu sync.Mutex
	requests := []recorded{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got, _ := io.ReadAll(r.Body)
		mu.Lock()
		requests = append(requests, recorded{r.Method, r.URL.EscapedPath(), r.URL.RawQuery, r.Host, r.Header.Clone(), got})
		mu.Unlock()
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return newWithBase(srv.URL+"/api/v3/references/collegiate/json/", srv.Client()), &requests
}

// D72: a single lookup's request carries the looked-up word and the narrator's key, and nothing else: no passage, no
// file name, no project id, no header of the app's own, no cookie, no body.
func TestTheRequestCarriesTheWordAndTheKeyAndNothingElse(t *testing.T) {
	for _, word := range []string{"croquet", "Mock Turtle", "café", "O'Brien"} {
		dict, requests := server(t, http.StatusOK, croquet)
		if _, err := dict.Lookup(context.Background(), word, key); err != nil {
			t.Fatalf("Lookup(%q): %v", word, err)
		}
		if len(*requests) != 1 {
			t.Fatalf("Lookup(%q) sent %d requests, want 1", word, len(*requests))
		}
		got := (*requests)[0]
		if got.method != http.MethodGet || len(got.body) != 0 {
			t.Errorf("Lookup(%q) sent %s with a %d-byte body; want GET with none", word, got.method, len(got.body))
		}
		if want := "/api/v3/references/collegiate/json/" + escapeForTest(word); got.path != want {
			t.Errorf("Lookup(%q) path = %q, want %q", word, got.path, want)
		}
		if want := "key=" + rawKey; got.rawQuery != want {
			t.Errorf("Lookup(%q) query = %q, want exactly %q", word, got.rawQuery, want)
		}
		// Only what Go's own transport adds: its generic User-Agent and Accept-Encoding. No Referer, Cookie, or any
		// X- header naming the app, a project or a file.
		names := []string{}
		for name := range got.header {
			names = append(names, name)
		}
		slices.Sort(names)
		for _, name := range names {
			if name != "User-Agent" && name != "Accept-Encoding" {
				t.Errorf("Lookup(%q) sent the header %s: %v", word, name, got.header[name])
			}
		}
		if ua := got.header.Get("User-Agent"); ua != "Go-http-client/1.1" {
			t.Errorf("Lookup(%q) User-Agent = %q; want Go's generic one", word, ua)
		}
	}
}

func escapeForTest(word string) string {
	return strings.NewReplacer(" ", "%20", "é", "%C3%A9", "'", "%27").Replace(word)
}

func TestTheRealAdapterGoesToTheOneFixedHost(t *testing.T) {
	request, err := newRequest(context.Background(), New().base, "croquet", key)
	if err != nil {
		t.Fatal(err)
	}
	if request.URL.Scheme != "https" || request.URL.Host != Host || request.URL.Path != "/api/v3/references/collegiate/json/croquet" {
		t.Fatalf("the real request goes to %s://%s%s", request.URL.Scheme, request.URL.Host, request.URL.Path)
	}
	if New().Host() != Host || !strings.HasPrefix(SignUpURL, "https://dictionaryapi.com/") {
		t.Fatalf("Host() = %q, SignUpURL = %q", New().Host(), SignUpURL)
	}
	// A word that tries to become a path or a second query parameter stays one escaped segment.
	sneaky, _ := newRequest(context.Background(), New().base, "x/../../y?key=z&project=1", key)
	if sneaky.URL.Host != Host || sneaky.URL.RawQuery != "key="+rawKey || strings.Count(sneaky.URL.EscapedPath(), "/") != 6 {
		t.Fatalf("an unchecked word escaped its segment: %s", sneaky.URL.String())
	}
}

func TestAnAnswerKeepsTheWordsOwnPronunciations(t *testing.T) {
	dict, _ := server(t, http.StatusOK, croquet)
	answer, err := dict.Lookup(context.Background(), "croquet", key)
	if err != nil {
		t.Fatal(err)
	}
	want := []pronunciationonline.Pronunciation{{Headword: "cro·quet", Spelling: "krō-ˈkā"}, {Headword: "cro·quet", Spelling: "ˈkrō-ˌkā"}}
	if !answer.Found || !slices.Equal(answer.Pronunciations, want) || len(answer.Suggestions) != 0 {
		t.Fatalf("Lookup = %+v; want %+v", answer, want)
	}
}

func TestAWordNotInTheDictionaryGivesItsSuggestions(t *testing.T) {
	dict, _ := server(t, http.StatusOK, `["quorum","sorrel"]`)
	answer, err := dict.Lookup(context.Background(), "quorlen", key)
	if err != nil || answer.Found || !slices.Equal(answer.Suggestions, []string{"quorum", "sorrel"}) {
		t.Fatalf("Lookup = %+v, %v; want not found with suggestions", answer, err)
	}
	empty, _ := server(t, http.StatusOK, `[]`)
	if answer, err := empty.Lookup(context.Background(), "zzxq", key); err != nil || answer.Found {
		t.Fatalf("an empty answer = %+v, %v; want not found", answer, err)
	}
}

// The key and the word never appear in an error, whatever goes wrong.
func TestNoErrorQuotesTheKeyOrTheWord(t *testing.T) {
	const word = "Quorlenwick"
	cases := []struct {
		name   string
		status int
		body   string
		want   error
	}{
		{"a refused key (text)", http.StatusOK, "Invalid API key. Not subscribed for this reference.", pronunciationonline.ErrKeyRefused},
		{"a refused key (403)", http.StatusForbidden, "", pronunciationonline.ErrKeyRefused},
		{"the rate limit", http.StatusTooManyRequests, "", pronunciationonline.ErrRateLimited},
		{"a server error", http.StatusInternalServerError, "error for " + word + " key=" + rawKey, pronunciationonline.ErrUnavailable},
		{"a redirect", http.StatusFound, "", pronunciationonline.ErrUnavailable},
		{"not JSON", http.StatusOK, "<html>" + word + "</html>", pronunciationonline.ErrUnavailable},
		{"broken JSON", http.StatusOK, `[{"meta":`, pronunciationonline.ErrUnavailable},
	}
	for _, tc := range cases {
		dict, _ := server(t, tc.status, tc.body)
		_, err := dict.Lookup(context.Background(), word, key)
		if !errors.Is(err, tc.want) {
			t.Errorf("%s: err = %v, want %v", tc.name, err, tc.want)
		}
		if err != nil && (strings.Contains(err.Error(), rawKey) || strings.Contains(err.Error(), word)) {
			t.Errorf("%s: the error quotes the key or the word: %v", tc.name, err)
		}
	}
	// A host that cannot be reached: Go's own error would quote the whole URL, key included.
	unreachable := newWithBase("http://127.0.0.1:1/api/", nil)
	_, err := unreachable.Lookup(context.Background(), word, key)
	if !errors.Is(err, pronunciationonline.ErrUnreachable) || strings.Contains(err.Error(), rawKey) || strings.Contains(err.Error(), word) {
		t.Fatalf("an unreachable host = %v; want ErrUnreachable without the key or word", err)
	}
}

// A redirect is never followed, so the key in the query can never be forwarded to another host.
func TestARedirectIsNeverFollowed(t *testing.T) {
	var hits int
	other := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { hits++ }))
	defer other.Close()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, other.URL+"/steal?"+r.URL.RawQuery, http.StatusFound)
	}))
	defer srv.Close()
	dict := newWithBase(srv.URL+"/", srv.Client())
	if _, err := dict.Lookup(context.Background(), "croquet", key); err == nil {
		t.Fatal("a redirect answered as a success")
	}
	if hits != 0 {
		t.Fatalf("the redirect was followed %d times", hits)
	}
}

func TestACancelledLookupSaysSo(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := newWithBase(srv.URL+"/", srv.Client()).Lookup(ctx, "croquet", key); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("a timed-out lookup = %v, want context.DeadlineExceeded", err)
	}
}

func TestNoKeyMeansNoRequest(t *testing.T) {
	dict, requests := server(t, http.StatusOK, croquet)
	if _, err := dict.Lookup(context.Background(), "croquet", credentialstore.Secret{}); !errors.Is(err, pronunciationonline.ErrNoKey) {
		t.Fatalf("Lookup without a key = %v", err)
	}
	if len(*requests) != 0 {
		t.Fatalf("a lookup without a key sent %d requests", len(*requests))
	}
}
