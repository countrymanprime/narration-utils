package update

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// The digest GitHub puts on an asset is kept as bare hexadecimal; the cache must accept it back, or the release vanishes on the next read.
func TestAReleaseWithDigestsSurvivesTheCacheAndIsStillOffered(t *testing.T) {
	release := rc("v0.2.7-rc")
	release.Assets[0].Digest = "sha256:" + strings.Repeat("ab", 32)
	release.Assets[1].Digest = "sha256:" + strings.Repeat("cd", 32)
	fake := newFakeGitHub(t, release)
	checker := newChecker(t, fake)
	if _, err := checker.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	if status := checker.Status(ChannelCandidates); status.Available == nil {
		t.Fatalf("a release with digests must be offered after it went through the cache: %+v", status)
	}
	state := checker.State()
	if len(state.Releases) != 1 || state.Releases[0].Asset.Digest != strings.Repeat("ab", 32) || state.Releases[0].Checksum.Digest != strings.Repeat("cd", 32) {
		t.Fatalf("digests after the cache: %+v", state.Releases)
	}
}

func TestACacheThatHoldsABadDigestIsDroppedWithItsETag(t *testing.T) {
	fake := newFakeGitHub(t, rc("v0.2.7-rc"))
	checker := newChecker(t, fake)
	if err := os.MkdirAll(filepath.Dir(checker.CachePath), 0o755); err != nil {
		t.Fatal(err)
	}
	bad := `{"schema":1,"etag":"\"v1\"","checkedAt":"2026-09-20T00:00:00Z","releases":[{"tag":"v0.2.7-rc","asset":{"name":"narration-utils-windows-x64.zip","size":10,"digest":"nonsense"},"checksum":{"name":"narration-utils-windows-x64.zip.sha256","size":10}}]}`
	if err := os.WriteFile(checker.CachePath, []byte(bad), 0o600); err != nil {
		t.Fatal(err)
	}
	state := checker.State()
	if len(state.Releases) != 0 || state.ETag != "" {
		t.Fatalf("a dropped release must not leave an ETag that turns the next answer into a 304 for an empty list: %+v", state)
	}
	if _, err := checker.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	if fake.last.Load().Header.Get("If-None-Match") != "" {
		t.Fatal("the next request must be unconditional")
	}
	if status := checker.Status(ChannelCandidates); status.Available == nil {
		t.Fatal("and it recovers the release")
	}
}

func TestARateLimitHoldsForAClickAndIsForgottenAfterALaterFailure(t *testing.T) {
	fake := newFakeGitHub(t, rc("v0.2.7-rc"))
	checker := newChecker(t, fake)
	reset := clock.Add(40 * time.Minute)
	fake.respond = func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("X-RateLimit-Remaining", "0")
		w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(reset.Unix(), 10))
		http.Error(w, "x", http.StatusForbidden)
	}
	if _, err := checker.Check(context.Background()); err == nil {
		t.Fatal("want the rate limit")
	}
	before := fake.requests.Load()
	if _, err := checker.Check(context.Background()); err == nil || fake.requests.Load() != before {
		t.Fatalf("a click inside the wait must not ask again: %v, %d requests", err, fake.requests.Load()-before)
	}
	clock = reset.Add(time.Minute)
	defer func() { clock = time.Date(2026, 9, 21, 12, 0, 0, 0, time.UTC) }()
	fake.respond = func(w http.ResponseWriter, _ *http.Request) { http.Error(w, "x", http.StatusBadGateway) }
	if state, err := checker.Check(context.Background()); err == nil || !state.BackoffUntil.IsZero() {
		t.Fatalf("a later failure that is not a rate limit forgets the old wait: %+v %v", state, err)
	}
}

func TestAListOfAMillionTinyEntriesIsReadNoFurtherThanItsBoundAndLogsLittle(t *testing.T) {
	body := []byte("[" + strings.Repeat("{},", 200000) + "{}]")
	releases, rejected, err := ParseReleases(body, testRepository, windows)
	if err != nil || len(releases) != 0 {
		t.Fatalf("releases %d err %v", len(releases), err)
	}
	if len(rejected) > MaxRejectionReasons+2 {
		t.Fatalf("%d reasons: the log must not grow with a hostile list", len(rejected))
	}
}

func TestAnETagThatIsLongOrUnprintableIsNotKeptOrSentBack(t *testing.T) {
	for name, tag := range map[string]string{"long": strings.Repeat("a", maxETagLength+1), "control": "\"a\x01b\"", "non-ASCII": "\"é\""} {
		if got := cleanETag(tag); got != "" {
			t.Errorf("%s: kept %q", name, got)
		}
	}
	if cleanETag(`W/"abc123"`) != `W/"abc123"` {
		t.Fatal("a normal entity tag is kept")
	}
}

func TestARepositoryThatMovedIsSaidPlainly(t *testing.T) {
	fake := newFakeGitHub(t, rc("v0.2.7-rc"))
	checker := newChecker(t, fake)
	fake.respond = func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/elsewhere", http.StatusMovedPermanently)
	}
	state, err := checker.Check(context.Background())
	if err == nil || !strings.Contains(state.Failure, "moved") {
		t.Fatalf("err %v failure %q", err, state.Failure)
	}
}

func TestAPlatformWithNoReleaseIsNeverDueAndMakesNoRequest(t *testing.T) {
	fake := newFakeGitHub(t, rc("v0.2.7-rc"))
	checker := newChecker(t, fake)
	checker.Platform = Platform{}
	if checker.Due(true, clock) {
		t.Fatal("no release platform, nothing to check")
	}
	if _, err := checker.Check(context.Background()); err != ErrNoPlatform || fake.requests.Load() != 0 {
		t.Fatalf("err %v requests %d", err, fake.requests.Load())
	}
}
