package update

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

// Repository is the only place the app looks for a newer version. It is compiled in on purpose: no setting, argument or response
// can point the updater somewhere else (ADR 0072).
const Repository = "countrymanprime/narration-utils"

// APIBase is GitHub's REST API. A test points a Checker at a fake server instead.
const APIBase = "https://api.github.com"

const (
	// checkInterval is how often the automatic check may ask GitHub: once a day is plenty for a program released a few times a week
	// and keeps well inside the unauthenticated limit of 60 requests an hour.
	checkInterval = 24 * time.Hour
	// failureRetry is the earlier retry after an automatic check that failed (offline at startup, GitHub down).
	failureRetry = 2 * time.Hour
	// maxBackoff caps how long a rate-limit answer may silence the check: the header is data from the network.
	maxBackoff = 24 * time.Hour
	// releasesPerPage bounds the list: the newest releases are all a check needs, and the prune keeps ten candidates.
	releasesPerPage = 30
	// requestTimeout bounds one request end to end; a check must never hang the app.
	requestTimeout = 20 * time.Second
	stateSchema    = 1
)

// State is what a Checker remembers between runs, in the per-user cache. It is disposable: a file that cannot be read is logged
// and the next check rebuilds it. Its releases are checked again on every read, as a fresh answer is, because a file on disk is
// not more trustworthy than a response.
type State struct {
	Schema       int       `json:"schema"`
	AttemptedAt  time.Time `json:"attemptedAt"`
	CheckedAt    time.Time `json:"checkedAt"`
	ETag         string    `json:"etag"`
	Releases     []Release `json:"releases"`
	Failure      string    `json:"failure"`
	BackoffUntil time.Time `json:"backoffUntil"`
}

// Checker asks GitHub for the release list and remembers the answer. It is safe for concurrent use.
type Checker struct {
	// Client makes the request. It is given a redirect policy of "none" by Check: the API answers directly.
	Client     *http.Client
	APIBase    string
	Repository string
	// DownloadBase is where release assets and notes live, "https://github.com/<repository>/releases" when empty. Only a test sets it.
	DownloadBase string
	Platform     Platform
	// CachePath is the file that holds the State.
	CachePath string
	// Current is the running version, as Bootstrap reports it.
	Current string
	Now     func() time.Time
	Persist *persist.Reporter

	// mu guards the cache file; checking makes a second Check wait for nothing: it is refused, so a slow request never blocks Status.
	mu       sync.Mutex
	checking atomic.Bool
}

// ErrChecking is returned by Check while another check is still running.
var ErrChecking = errors.New("an update check is already running")

// ErrNoPlatform is returned by Check on a platform that has no release: there is nothing to ask about.
var ErrNoPlatform = errors.New("this platform has no release to update to")

// NewChecker is a Checker for this repository and platform, remembering its answer at cachePath.
func NewChecker(current, cachePath string, reporter *persist.Reporter) *Checker {
	platform, _ := CurrentPlatform()
	return &Checker{Client: &http.Client{Timeout: requestTimeout}, APIBase: APIBase, Repository: Repository, Platform: platform, CachePath: cachePath, Current: current, Now: time.Now, Persist: reporter}
}

// Clock is the time the Checker uses: the real one, or the fixed one a test gave it.
func (c *Checker) Clock() time.Time { return c.now() }

func (c *Checker) now() time.Time {
	if c.Now != nil {
		return c.Now()
	}
	return time.Now()
}

// State is the remembered answer: empty when nothing was ever checked or the file cannot be used.
func (c *Checker) State() State {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.load()
}

func (c *Checker) load() State {
	var state State
	c.Persist.ReadJSON(c.CachePath, "update check", persist.Disposable, func(bytes []byte) error {
		var decoded State
		if err := json.Unmarshal(bytes, &decoded); err != nil {
			return err
		}
		if decoded.Schema != stateSchema {
			return fmt.Errorf("update check schema %d, want %d", decoded.Schema, stateSchema)
		}
		state = decoded
		return nil
	})
	state.Schema = stateSchema
	cached := len(state.Releases)
	state.Releases = c.revalidate(state.Releases)
	if len(state.Releases) != cached {
		// Something the file said was not accepted: forget the ETag too, or a 304 would keep the smaller list for good.
		state.ETag = ""
	}
	return state
}

// revalidate keeps the cached releases that pass the checks a fresh answer passes and rebuilds their URLs from the repository.
func (c *Checker) revalidate(releases []Release) []Release {
	var kept []Release
	for _, release := range releases {
		version, candidate, err := ParseTag(release.Tag)
		if err != nil || release.Asset.Name != c.Platform.Asset || release.Checksum.Name != c.Platform.Checksum {
			continue
		}
		if release.Asset.Size <= 0 || release.Asset.Size > MaxAssetBytes || release.Checksum.Size <= 0 || release.Checksum.Size > MaxChecksumBytes {
			continue
		}
		if !validHexDigest(release.Asset.Digest) || !validHexDigest(release.Checksum.Digest) {
			continue
		}
		base := c.releasesBase()
		release.Version, release.Candidate = version, candidate
		release.PublishedAt = cleanTimestamp(release.PublishedAt)
		release.NotesURL = base + "/tag/" + release.Tag
		release.Asset.URL = base + "/download/" + release.Tag + "/" + release.Asset.Name
		release.Checksum.URL = base + "/download/" + release.Tag + "/" + release.Checksum.Name
		kept = append(kept, release)
	}
	return kept
}

func (c *Checker) save(state State) {
	state.Schema = stateSchema
	bytes, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(c.CachePath), 0o755); err != nil {
		c.Persist.Warn("update_check_unsaved", "the update check could not be remembered: "+err.Error())
		return
	}
	temporary := c.CachePath + ".tmp"
	if err := os.WriteFile(temporary, bytes, 0o600); err != nil {
		c.Persist.Warn("update_check_unsaved", "the update check could not be remembered: "+err.Error())
		return
	}
	if err := os.Rename(temporary, c.CachePath); err != nil {
		c.Persist.Warn("update_check_unsaved", "the update check could not be remembered: "+err.Error())
	}
}

// Check asks GitHub for the release list now. It is the one function that makes a request, and it is called only by the automatic
// check (at most once a day, unless switched off) and by an explicit Check now. A failure keeps what was known, records why, and
// counts as an attempt but not as a check. The returned State is the one that was saved.
func (c *Checker) Check(ctx context.Context) (State, error) {
	if !c.checking.CompareAndSwap(false, true) {
		return c.State(), ErrChecking
	}
	defer c.checking.Store(false)
	state := c.State()
	if c.Platform.Asset == "" {
		return state, ErrNoPlatform
	}
	// A rate limit says when to come back, and that holds for a click as well as for the automatic check.
	if c.now().Before(state.BackoffUntil) && state.Failure != "" {
		return state, errors.New(state.Failure)
	}
	state.AttemptedAt = c.now()
	// The request runs without the cache lock, so Status stays instant while it is in flight.
	body, etag, notModified, failure, backoff := c.fetch(ctx, state.ETag)
	if ctx.Err() != nil {
		return c.State(), ctx.Err()
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	switch {
	case failure != "":
		state.Failure, state.BackoffUntil = failure, backoff
		c.save(state)
		return state, errors.New(failure)
	case notModified:
		state.CheckedAt, state.Failure, state.BackoffUntil = c.now(), "", time.Time{}
		c.save(state)
		return state, nil
	}
	releases, rejected, err := parseReleasesFrom(body, c.releasesBase(), c.Platform)
	if err != nil {
		state.Failure = "GitHub sent a release list the app could not read."
		c.Persist.Warn("update_manifest_invalid", err.Error())
		c.save(state)
		return state, errors.New(state.Failure)
	}
	for _, reason := range rejected {
		c.Persist.Warn("update_manifest_invalid", reason)
	}
	state.Releases, state.ETag, state.CheckedAt, state.Failure, state.BackoffUntil = releases, etag, c.now(), "", time.Time{}
	c.save(state)
	return state, nil
}

// fetch makes the request. It returns the body, or notModified, or a failure the narrator can read (never the response text) and,
// for a rate limit, when to try again.
func (c *Checker) fetch(ctx context.Context, etag string) (body []byte, newETag string, notModified bool, failure string, backoff time.Time) {
	address := fmt.Sprintf("%s/repos/%s/releases?per_page=%d", c.APIBase, c.Repository, releasesPerPage)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return nil, "", false, "The update check could not be started.", time.Time{}
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	request.Header.Set("User-Agent", "narration-utils/"+c.Current)
	if etag != "" {
		request.Header.Set("If-None-Match", etag)
	}
	base := c.Client
	if base == nil {
		base = http.DefaultClient
	}
	client := *base
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := client.Do(request)
	if err != nil {
		return nil, "", false, "Could not reach GitHub to check for updates.", time.Time{}
	}
	defer func() { _ = response.Body.Close() }() // the body was read or abandoned; nothing to report
	switch {
	case response.StatusCode == http.StatusNotModified:
		return nil, etag, true, "", time.Time{}
	case response.StatusCode == http.StatusForbidden || response.StatusCode == http.StatusTooManyRequests:
		if response.Header.Get("X-RateLimit-Remaining") == "0" {
			until := c.rateLimitReset(response.Header.Get("X-RateLimit-Reset"))
			return nil, "", false, fmt.Sprintf("GitHub's rate limit was reached; try again after %s.", until.Local().Format("15:04")), until
		}
		return nil, "", false, "GitHub refused the update check.", time.Time{}
	case response.StatusCode == http.StatusMovedPermanently || response.StatusCode == http.StatusPermanentRedirect:
		return nil, "", false, "GitHub says the repository has moved, so this version of the app can no longer check for updates.", time.Time{}
	case response.StatusCode != http.StatusOK:
		return nil, "", false, fmt.Sprintf("GitHub answered the update check with status %d.", response.StatusCode), time.Time{}
	}
	body, err = io.ReadAll(io.LimitReader(response.Body, MaxManifestBytes+1))
	if err != nil {
		return nil, "", false, "The update check was interrupted.", time.Time{}
	}
	return body, cleanETag(response.Header.Get("ETag")), false, "", time.Time{}
}

// maxETagLength bounds an entity tag: it comes from the network, is written to disk and is sent back in a header.
const maxETagLength = 200

// cleanETag keeps an entity tag only if it is short and printable; otherwise there is none and the next request is unconditional.
func cleanETag(tag string) string {
	if len(tag) > maxETagLength {
		return ""
	}
	for index := 0; index < len(tag); index++ {
		if tag[index] < 0x20 || tag[index] > 0x7e {
			return ""
		}
	}
	return tag
}

// rateLimitReset reads X-RateLimit-Reset (Unix seconds). It is data from the network, so it is bounded: a missing, past or absurd
// value becomes a short wait and never more than a day.
func (c *Checker) rateLimitReset(header string) time.Time {
	now := c.now()
	seconds, err := strconv.ParseInt(header, 10, 64)
	if err != nil || seconds <= 0 {
		return now.Add(failureRetry)
	}
	until := time.Unix(seconds, 0).UTC()
	switch {
	case until.Before(now):
		return now.Add(failureRetry)
	case until.After(now.Add(maxBackoff)):
		return now.Add(maxBackoff)
	}
	return until
}

// Due reports whether the automatic check should run now: switched on, past any rate-limit wait, and a day since the last
// attempt (two hours after one that failed). A clock set back never leaves the check silent for good.
func (c *Checker) Due(enabled bool, now time.Time) bool {
	if !enabled || c.Platform.Asset == "" {
		return false
	}
	state := c.State()
	if !state.BackoffUntil.IsZero() {
		// A rate limit says exactly when to come back: not before, and then at once.
		return !now.Before(state.BackoffUntil)
	}
	if state.AttemptedAt.IsZero() || now.Before(state.AttemptedAt) {
		return true
	}
	interval := checkInterval
	if state.Failure != "" {
		interval = failureRetry
	}
	return now.Sub(state.AttemptedAt) >= interval
}

func (c *Checker) releasesBase() string {
	if c.DownloadBase != "" {
		return c.DownloadBase
	}
	return releasesBase(c.Repository)
}

// Available is a release newer than the running version, as the narrator is told about it.
type Available struct {
	Version     string `json:"version"`
	Tag         string `json:"tag"`
	Candidate   bool   `json:"candidate"`
	NotesURL    string `json:"notesUrl"`
	Size        int64  `json:"size"`
	PublishedAt string `json:"publishedAt"`
	// Replaces is whether this platform can replace itself with it; where it cannot (macOS, Linux) the narrator is told and linked.
	Replaces bool `json:"replaces"`
}

// Status is what Settings shows: the running version, when the last check was and whether it worked, and the newest release on the
// channel if it is newer than the running version.
type Status struct {
	Version     string     `json:"version"`
	Development bool       `json:"development"`
	Platform    string     `json:"platform"`
	Channel     Channel    `json:"channel"`
	LastChecked string     `json:"lastChecked"`
	Failure     string     `json:"failure"`
	Available   *Available `json:"available"`
}

// Status combines the remembered answer with the running version and the channel. It makes no request.
func (c *Checker) Status(channel Channel) Status {
	state := c.State()
	status := Status{Version: c.Current, Development: IsDevelopment(c.Current), Platform: c.Platform.Key, Channel: channel, Failure: state.Failure}
	if !state.CheckedAt.IsZero() {
		status.LastChecked = state.CheckedAt.UTC().Format(time.RFC3339)
	}
	if status.Platform == "" {
		return status
	}
	if release, ok := Newest(state.Releases, channel); ok && IsUpdate(c.Current, release) {
		status.Available = &Available{Version: release.Version.String(), Tag: release.Tag, Candidate: release.Candidate, NotesURL: release.NotesURL, Size: release.Asset.Size, PublishedAt: release.PublishedAt, Replaces: c.Platform.SelfReplace}
	}
	return status
}

// Newer is the newest release on the channel if it is newer than the running version: the release an update would install.
func (c *Checker) Newer(channel Channel) (Release, bool) {
	if c.Platform.Asset == "" {
		return Release{}, false
	}
	release, ok := Newest(c.State().Releases, channel)
	if !ok || !IsUpdate(c.Current, release) {
		return Release{}, false
	}
	return release, true
}

// MarshalText and UnmarshalText keep a Version a plain "0.2.7" in the cache file.
func (v Version) MarshalText() ([]byte, error) { return []byte(v.String()), nil }

func (v *Version) UnmarshalText(text []byte) error {
	parsed, err := ParseVersion(string(text))
	if err != nil {
		return err
	}
	*v = parsed
	return nil
}
