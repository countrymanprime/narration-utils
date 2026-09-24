package update

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

var clock = time.Date(2026, 9, 21, 12, 0, 0, 0, time.UTC)

type fakeGitHub struct {
	server   *httptest.Server
	requests atomic.Int32
	last     atomic.Pointer[http.Request]
	// respond writes the answer; the default is the release list.
	respond func(w http.ResponseWriter, r *http.Request)
	etag    string
	body    []byte
}

func newFakeGitHub(t *testing.T, releases ...fakeRelease) *fakeGitHub {
	t.Helper()
	fake := &fakeGitHub{etag: `"v1"`, body: marshal(t, releases)}
	fake.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fake.requests.Add(1)
		fake.last.Store(r)
		if fake.respond != nil {
			fake.respond(w, r)
			return
		}
		if r.URL.Path != "/repos/"+testRepository+"/releases" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("If-None-Match") == fake.etag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("ETag", fake.etag)
		_, _ = w.Write(fake.body)
	}))
	t.Cleanup(fake.server.Close)
	return fake
}

func newChecker(t *testing.T, fake *fakeGitHub) *Checker {
	t.Helper()
	return &Checker{
		Client: fake.server.Client(), APIBase: fake.server.URL, Repository: testRepository, Platform: windows,
		CachePath: filepath.Join(t.TempDir(), "update", "check.json"), Current: "0.2.6", Now: func() time.Time { return clock },
	}
}

func TestACheckReadsTheReleaseListAndFindsTheNewestOnTheChannel(t *testing.T) {
	fake := newFakeGitHub(t, rc("v0.2.7-rc"), rc("v0.2.6-rc"))
	checker := newChecker(t, fake)
	state, err := checker.Check(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if fake.requests.Load() != 1 || state.ETag != `"v1"` || state.CheckedAt != clock || state.Failure != "" {
		t.Fatalf("requests %d state %+v", fake.requests.Load(), state)
	}
	status := checker.Status(ChannelCandidates)
	if status.Available == nil || status.Available.Tag != "v0.2.7-rc" || status.Available.Version != "0.2.7" || !status.Available.Candidate || !status.Available.Replaces {
		t.Fatalf("status = %+v", status)
	}
	if status.Available.Size != 400<<20 || status.Available.NotesURL != "https://github.com/"+testRepository+"/releases/tag/v0.2.7-rc" {
		t.Fatalf("available = %+v", status.Available)
	}
	if status.LastChecked != "2026-09-21T12:00:00Z" || status.Version != "0.2.6" || status.Platform != "windows-x64" || status.Channel != ChannelCandidates {
		t.Fatalf("status = %+v", status)
	}
	if stable := checker.Status(ChannelStable); stable.Available != nil {
		t.Fatalf("the stable channel has no release yet: %+v", stable.Available)
	}
}

func TestTheRequestIsAnUnauthenticatedReadThatSaysWhoAsks(t *testing.T) {
	fake := newFakeGitHub(t, rc("v0.2.7-rc"))
	checker := newChecker(t, fake)
	if _, err := checker.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	request := fake.last.Load()
	if request.Method != http.MethodGet || request.Header.Get("Authorization") != "" || request.Header.Get("Cookie") != "" {
		t.Fatalf("method %s headers %v", request.Method, request.Header)
	}
	if !strings.Contains(request.Header.Get("User-Agent"), "narration-utils/0.2.6") || !strings.Contains(request.Header.Get("Accept"), "application/vnd.github+json") {
		t.Fatalf("headers %v", request.Header)
	}
	if request.URL.Query().Get("per_page") == "" {
		t.Fatalf("the list must be bounded: %s", request.URL)
	}
}

func TestASecondCheckAsksWithTheETagAndAnUnchangedListCostsNothing(t *testing.T) {
	fake := newFakeGitHub(t, rc("v0.2.7-rc"))
	checker := newChecker(t, fake)
	if _, err := checker.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	clock = clock.Add(25 * time.Hour)
	defer func() { clock = clock.Add(-25 * time.Hour) }()
	state, err := checker.Check(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if fake.last.Load().Header.Get("If-None-Match") != `"v1"` {
		t.Fatal("the second request must be conditional")
	}
	if state.CheckedAt != clock || len(state.Releases) != 1 {
		t.Fatalf("a 304 keeps the releases and moves the check time: %+v", state)
	}
}

func TestTheAnswerSurvivesARestart(t *testing.T) {
	fake := newFakeGitHub(t, rc("v0.2.7-rc"))
	checker := newChecker(t, fake)
	if _, err := checker.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	again := newChecker(t, fake)
	again.CachePath = checker.CachePath
	if got := again.Status(ChannelCandidates); got.Available == nil || got.Available.Tag != "v0.2.7-rc" || got.LastChecked == "" {
		t.Fatalf("a fresh checker over the same cache file: %+v", got)
	}
}

func TestAFailedCheckKeepsWhatWasKnownAndSaysWhy(t *testing.T) {
	fake := newFakeGitHub(t, rc("v0.2.7-rc"))
	checker := newChecker(t, fake)
	if _, err := checker.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	clock = clock.Add(time.Hour)
	defer func() { clock = clock.Add(-time.Hour) }()
	for name, respond := range map[string]func(http.ResponseWriter, *http.Request){
		"a server error":            func(w http.ResponseWriter, _ *http.Request) { http.Error(w, "boom", http.StatusInternalServerError) },
		"a list that is not a list": func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{"message":"no"}`)) },
		"a body that is too large": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte("[" + strings.Repeat(" ", MaxManifestBytes+10) + "]"))
		},
		"a redirect": func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, "https://evil.example/", http.StatusFound)
		},
	} {
		fake.respond = respond
		state, err := checker.Check(context.Background())
		if err == nil || state.Failure == "" {
			t.Errorf("%s: err %v failure %q", name, err, state.Failure)
			continue
		}
		if state.AttemptedAt != clock || len(state.Releases) != 1 || state.CheckedAt.Equal(clock) {
			t.Errorf("%s: a failure keeps the earlier list and does not count as a check: %+v", name, state)
		}
		if strings.Contains(state.Failure, "evil.example") || strings.Contains(state.Failure, "boom") {
			t.Errorf("%s: the failure echoes the response: %q", name, state.Failure)
		}
	}
	if status := checker.Status(ChannelCandidates); status.Available == nil || status.Failure == "" {
		t.Fatalf("the status still offers the release and says the last check failed: %+v", status)
	}
}

func TestOfflineIsAFailureNotACrash(t *testing.T) {
	fake := newFakeGitHub(t, rc("v0.2.7-rc"))
	checker := newChecker(t, fake)
	fake.server.Close()
	state, err := checker.Check(context.Background())
	if err == nil || !strings.Contains(state.Failure, "reach GitHub") {
		t.Fatalf("err %v failure %q", err, state.Failure)
	}
}

func TestACancelledCheckStopsAndChangesNothing(t *testing.T) {
	fake := newFakeGitHub(t, rc("v0.2.7-rc"))
	checker := newChecker(t, fake)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := checker.Check(ctx); err == nil {
		t.Fatal("a cancelled context must fail the check")
	}
}

func TestTheRateLimitIsRememberedUntilItResets(t *testing.T) {
	fake := newFakeGitHub(t, rc("v0.2.7-rc"))
	checker := newChecker(t, fake)
	reset := clock.Add(40 * time.Minute)
	fake.respond = func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("X-RateLimit-Remaining", "0")
		w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(reset.Unix(), 10))
		http.Error(w, "rate limited", http.StatusForbidden)
	}
	state, err := checker.Check(context.Background())
	if err == nil || !state.BackoffUntil.Equal(reset) || !strings.Contains(state.Failure, "rate limit") {
		t.Fatalf("err %v state %+v", err, state)
	}
	if checker.Due(true, clock.Add(10*time.Minute)) {
		t.Fatal("no automatic check before the limit resets")
	}
	if !checker.Due(true, reset.Add(time.Second)) {
		t.Fatal("an automatic check is due once the limit resets and the retry interval has passed")
	}
}

func TestAHugeResetTimeIsCappedSoItCannotSilenceTheCheckForever(t *testing.T) {
	fake := newFakeGitHub(t, rc("v0.2.7-rc"))
	checker := newChecker(t, fake)
	fake.respond = func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("X-RateLimit-Remaining", "0")
		w.Header().Set("X-RateLimit-Reset", "99999999999")
		http.Error(w, "x", http.StatusTooManyRequests)
	}
	state, _ := checker.Check(context.Background())
	if state.BackoffUntil.After(clock.Add(maxBackoff)) {
		t.Fatalf("backoff until %v", state.BackoffUntil)
	}
}

func TestAnAutomaticCheckIsDueOncePerDayAndSoonerAfterAFailure(t *testing.T) {
	fake := newFakeGitHub(t, rc("v0.2.7-rc"))
	checker := newChecker(t, fake)
	if !checker.Due(true, clock) {
		t.Fatal("never checked: due")
	}
	if checker.Due(false, clock) {
		t.Fatal("switched off: never due")
	}
	if _, err := checker.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		after time.Duration
		want  bool
	}{{time.Minute, false}, {23 * time.Hour, false}, {24 * time.Hour, true}, {48 * time.Hour, true}, {-time.Hour, true}} {
		if got := checker.Due(true, clock.Add(test.after)); got != test.want {
			t.Errorf("after a good check, %v later: due %v, want %v", test.after, got, test.want)
		}
	}
	fake.respond = func(w http.ResponseWriter, _ *http.Request) { http.Error(w, "x", http.StatusBadGateway) }
	clock = clock.Add(time.Hour)
	defer func() { clock = clock.Add(-time.Hour) }()
	if _, err := checker.Check(context.Background()); err == nil {
		t.Fatal("want a failure")
	}
	for _, test := range []struct {
		after time.Duration
		want  bool
	}{{30 * time.Minute, false}, {failureRetry - time.Minute, false}, {failureRetry, true}} {
		if got := checker.Due(true, clock.Add(test.after)); got != test.want {
			t.Errorf("after a failed check, %v later: due %v, want %v", test.after, got, test.want)
		}
	}
}

func TestACorruptCacheFileIsLoggedAndTheCheckStartsFresh(t *testing.T) {
	fake := newFakeGitHub(t, rc("v0.2.7-rc"))
	checker := newChecker(t, fake)
	var logged []string
	checker.Persist = &persist.Reporter{Log: func(kind, message string) { logged = append(logged, kind+": "+message) }}
	if err := os.MkdirAll(filepath.Dir(checker.CachePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(checker.CachePath, []byte("{ not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if state := checker.State(); len(state.Releases) != 0 || !state.CheckedAt.IsZero() {
		t.Fatalf("a corrupt cache is empty: %+v", state)
	}
	if len(logged) != 1 || !strings.Contains(logged[0], "persisted_corrupt") {
		t.Fatalf("logged %v", logged)
	}
	if _, err := checker.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	if state := checker.State(); len(state.Releases) != 1 {
		t.Fatalf("the next check replaces it: %+v", state)
	}
}

func TestACacheFileFromAnotherSchemaOrWithBadReleasesIsIgnored(t *testing.T) {
	fake := newFakeGitHub(t, rc("v0.2.7-rc"))
	checker := newChecker(t, fake)
	if err := os.MkdirAll(filepath.Dir(checker.CachePath), 0o755); err != nil {
		t.Fatal(err)
	}
	future, _ := json.Marshal(map[string]any{"schema": 99, "releases": []any{}})
	if err := os.WriteFile(checker.CachePath, future, 0o600); err != nil {
		t.Fatal(err)
	}
	if state := checker.State(); !state.CheckedAt.IsZero() {
		t.Fatalf("a cache written by another schema is not trusted: %+v", state)
	}
	// A cache is data on disk that a narrator or another program could edit: its releases are checked like a fresh answer, and the
	// URLs are rebuilt from the repository whatever the file says.
	hostile := `{"schema":1,"checkedAt":"2026-09-20T00:00:00Z","releases":[` +
		`{"tag":"v0.2.8","asset":{"name":"narration-utils-0.2.8-windows-x64.zip","size":10,"url":"https://evil.example/x.zip"},"checksum":{"name":"narration-utils-0.2.8-windows-x64.zip.sha256","size":10,"url":"https://evil.example/x.sha256"},"notesUrl":"https://evil.example/notes"},` +
		`{"tag":"v0.2.9","asset":{"name":"evil.exe","size":10},"checksum":{"name":"narration-utils-0.2.9-windows-x64.zip.sha256","size":10}},` +
		`{"tag":"v0.3.1","asset":{"name":"narration-utils-0.2.8-windows-x64.zip","size":10},"checksum":{"name":"narration-utils-0.2.8-windows-x64.zip.sha256","size":10}},` +
		`{"tag":"not-a-tag","asset":{"name":"narration-utils-0.2.8-windows-x64.zip","size":10},"checksum":{"name":"narration-utils-0.2.8-windows-x64.zip.sha256","size":10}},` +
		`{"tag":"v0.3.0","asset":{"name":"narration-utils-0.3.0-windows-x64.zip","size":-1},"checksum":{"name":"narration-utils-0.3.0-windows-x64.zip.sha256","size":10}}]}`
	if err := os.WriteFile(checker.CachePath, []byte(hostile), 0o600); err != nil {
		t.Fatal(err)
	}
	state := checker.State()
	if len(state.Releases) != 1 || state.Releases[0].Tag != "v0.2.8" {
		t.Fatalf("only the release that passes the same checks survives: %+v", state.Releases)
	}
	kept := state.Releases[0]
	base := "https://github.com/" + testRepository + "/releases"
	if kept.Asset.URL != base+"/download/v0.2.8/narration-utils-0.2.8-windows-x64.zip" || kept.Checksum.URL != kept.Asset.URL+".sha256" || kept.NotesURL != base+"/tag/v0.2.8" {
		t.Fatalf("the URLs come from the repository, not the file: %+v", kept)
	}
}

func TestAnUnsupportedPlatformAndADevelopmentBuildAreNeverOfferedAnUpdate(t *testing.T) {
	fake := newFakeGitHub(t, rc("v0.2.7-rc"))
	checker := newChecker(t, fake)
	if _, err := checker.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	checker.Current = DevelopmentVersion
	if status := checker.Status(ChannelCandidates); status.Available != nil || !status.Development {
		t.Fatalf("development build status = %+v", status)
	}
	checker.Current = "0.2.6"
	checker.Platform = Platform{}
	if status := checker.Status(ChannelCandidates); status.Available != nil || status.Platform != "" {
		t.Fatalf("unsupported platform status = %+v", status)
	}
	if _, err := checker.Check(context.Background()); err == nil || fake.requests.Load() != 1 {
		t.Fatalf("an unsupported platform makes no request: %v, %d requests", err, fake.requests.Load())
	}
}

func TestOnlyANewerReleaseIsAvailable(t *testing.T) {
	fake := newFakeGitHub(t, rc("v0.2.7-rc"), stable("v0.2.6"))
	checker := newChecker(t, fake)
	if _, err := checker.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	checker.Current = "0.2.7"
	if status := checker.Status(ChannelCandidates); status.Available != nil {
		t.Fatalf("the same version is not an update: %+v", status.Available)
	}
	checker.Current = "0.3.0"
	if status := checker.Status(ChannelCandidates); status.Available != nil {
		t.Fatalf("an older release is not an update: %+v", status.Available)
	}
}

func TestASecondCheckIsRefusedWhileOneRunsAndStatusNeverWaitsForIt(t *testing.T) {
	fake := newFakeGitHub(t, rc("v0.2.7-rc"))
	checker := newChecker(t, fake)
	started, release := make(chan struct{}), make(chan struct{})
	fake.respond = func(w http.ResponseWriter, _ *http.Request) {
		close(started)
		<-release
		_, _ = w.Write(fake.body)
	}
	done := make(chan error, 1)
	go func() {
		_, err := checker.Check(context.Background())
		done <- err
	}()
	<-started
	if _, err := checker.Check(context.Background()); err != ErrChecking {
		t.Fatalf("second check err = %v, want ErrChecking", err)
	}
	status := make(chan Status, 1)
	go func() { status <- checker.Status(ChannelCandidates) }()
	select {
	case <-status:
	case <-time.After(5 * time.Second):
		t.Fatal("Status waited for the running check")
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
