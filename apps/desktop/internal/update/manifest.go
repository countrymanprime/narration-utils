package update

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"runtime"
	"strings"
)

// Limits on what a release list may say. They are generous for a real release and small enough that a hostile response cannot use
// memory or disk it was not promised.
const (
	// MaxManifestBytes caps the release list response; the check reads no more than this.
	MaxManifestBytes = 4 << 20
	// MaxAssetBytes caps a platform asset (a Windows zip is about 200 MB; the unpacked program about 420 MB).
	MaxAssetBytes = 2 << 30
	// MaxChecksumBytes caps a .sha256 file (one line of about 100 bytes).
	MaxChecksumBytes = 4 << 10
	// MaxListedReleases is how many entries of the list are read: the check asks for a short page, and a hostile list of a million
	// tiny entries must not become a million log lines.
	MaxListedReleases = 60
	// MaxRejectionReasons bounds the reasons kept (and so the log lines written) for one list.
	MaxRejectionReasons = 20
)

// Channel says which releases count as an update.
type Channel string

const (
	// ChannelCandidates is the default: release candidates and stable releases. Every release so far is a candidate, so a
	// stable-only default would never find one.
	ChannelCandidates Channel = "candidates"
	// ChannelStable counts promoted releases only.
	ChannelStable Channel = "stable"
)

// ParseChannel reads the setting; anything unknown is the default.
func ParseChannel(text string) Channel {
	if text == string(ChannelStable) {
		return ChannelStable
	}
	return ChannelCandidates
}

// Platform is one release platform: its key and archive extension, from which the names of each release's asset and checksum are
// built (scripts/release/assets.mjs owns the table this mirrors), and whether the app can replace itself there.
type Platform struct {
	Key         string
	Extension   string
	SelfReplace bool
}

// AssetName is the platform's archive in the release of this version: narration-utils-<version>-<platform>.<ext>
// (docs/adr/0197). The version is bare, so a candidate and its promotion publish the same file names.
func (p Platform) AssetName(version Version) string {
	return "narration-utils-" + version.String() + "-" + p.Key + p.Extension
}

// ChecksumName is the .sha256 beside AssetName.
func (p Platform) ChecksumName(version Version) string { return p.AssetName(version) + ".sha256" }

// PlatformFor is the release platform of a Go OS and architecture, if there is one. Only Windows is a supported platform and
// replaces itself; macOS and Linux are preview assets and are told about a newer release only (owner decision D7).
func PlatformFor(goos, goarch string) (Platform, bool) {
	var key, extension string
	switch {
	case goos == "windows" && goarch == "amd64":
		key, extension = "windows-x64", ".zip"
	case goos == "darwin" && goarch == "arm64":
		key, extension = "macos-arm64", ".zip"
	case goos == "linux" && goarch == "amd64":
		key, extension = "linux-x64", ".tar.gz"
	default:
		return Platform{}, false
	}
	return Platform{Key: key, Extension: extension, SelfReplace: goos == "windows"}, true
}

// CurrentPlatform is the release platform this program runs on.
func CurrentPlatform() (Platform, bool) { return PlatformFor(runtime.GOOS, runtime.GOARCH) }

// Asset is a file of a release. Its URL is built here from the repository, the tag and the name: the release list never chooses it.
type Asset struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
	URL  string `json:"url"`
	// Digest is the SHA-256 GitHub computed when the file was uploaded, lower-case hexadecimal, or empty when the list had none.
	Digest string `json:"digest,omitempty"`
}

// Release is a release that passed every check: a tag that is one of ours, the platform's asset and checksum, and sizes that are
// plausible.
type Release struct {
	Tag         string  `json:"tag"`
	Version     Version `json:"version"`
	Candidate   bool    `json:"candidate"`
	PublishedAt string  `json:"publishedAt"`
	NotesURL    string  `json:"notesUrl"`
	Asset       Asset   `json:"asset"`
	Checksum    Asset   `json:"checksum"`
}

type listedAsset struct {
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	State  string `json:"state"`
	Digest string `json:"digest"`
}

type listedRelease struct {
	TagName     string        `json:"tag_name"`
	Draft       bool          `json:"draft"`
	Prerelease  bool          `json:"prerelease"`
	PublishedAt string        `json:"published_at"`
	Assets      []listedAsset `json:"assets"`
}

// ParseReleases reads the body of GET /repos/<repository>/releases and returns the releases this platform can use, in the order
// the list gave them, with one short reason for each release it left out. The reasons name the problem and never repeat a value
// from the list, so they are safe to write to the log. The error is for a body that is not a list at all or is too large: the
// caller keeps whatever it knew before.
func ParseReleases(body []byte, repository string, platform Platform) ([]Release, []string, error) {
	return parseReleasesFrom(body, releasesBase(repository), platform)
}

// releasesBase is where a repository's releases live; every asset and notes address is built under it.
func releasesBase(repository string) string { return "https://github.com/" + repository + "/releases" }

func parseReleasesFrom(body []byte, base string, platform Platform) ([]Release, []string, error) {
	if len(body) > MaxManifestBytes {
		return nil, nil, errors.New("the release list is larger than expected")
	}
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 || trimmed[0] != '[' && !bytes.Equal(trimmed, []byte("null")) {
		return nil, nil, errors.New("the release list is not a list")
	}
	var entries []json.RawMessage
	if err := json.Unmarshal(trimmed, &entries); err != nil {
		return nil, nil, errors.New("the release list is not valid JSON")
	}
	var releases []Release
	var rejected []string
	dropped := 0
	for index, entry := range entries {
		if index >= MaxListedReleases {
			// The check asked for a short page; a list that runs on is not one of GitHub's and is not read past its bound.
			rejected = append(rejected, fmt.Sprintf("%d more entries after the first %d were not read", len(entries)-index, MaxListedReleases))
			break
		}
		release, reason := parseRelease(entry, base, platform)
		if reason == "" {
			releases = append(releases, release)
			continue
		}
		if len(rejected) < MaxRejectionReasons {
			rejected = append(rejected, fmt.Sprintf("release %d: %s", index+1, reason))
		} else {
			dropped++
		}
	}
	if dropped > 0 {
		rejected = append(rejected, fmt.Sprintf("%d more entries were also rejected", dropped))
	}
	return releases, rejected, nil
}

func parseRelease(entry json.RawMessage, base string, platform Platform) (Release, string) {
	var listed listedRelease
	if err := json.Unmarshal(entry, &listed); err != nil {
		return Release{}, "the entry does not have the expected shape"
	}
	if listed.Draft {
		return Release{}, "a draft"
	}
	version, candidate, err := ParseTag(listed.TagName)
	if err != nil {
		return Release{}, "the tag is not a release tag"
	}
	// A candidate tag is always a pre-release and a promoted tag never is: a list that says otherwise is not describing one of ours.
	if candidate != listed.Prerelease {
		return Release{}, "the tag and the pre-release flag disagree"
	}
	asset, reason := pickAsset(listed.Assets, platform.AssetName(version), MaxAssetBytes)
	if reason != "" {
		return Release{}, "the platform asset: " + reason
	}
	checksum, reason := pickAsset(listed.Assets, platform.ChecksumName(version), MaxChecksumBytes)
	if reason != "" {
		return Release{}, "the checksum: " + reason
	}
	asset.URL = base + "/download/" + listed.TagName + "/" + asset.Name
	checksum.URL = base + "/download/" + listed.TagName + "/" + checksum.Name
	return Release{
		Tag: listed.TagName, Version: version, Candidate: candidate, PublishedAt: cleanTimestamp(listed.PublishedAt),
		NotesURL: base + "/tag/" + listed.TagName, Asset: asset, Checksum: checksum,
	}, ""
}

// pickAsset finds the one file with this exact name. Two files of one name, a file that is not uploaded, an implausible size or a
// digest that is not a SHA-256 make the release unusable rather than guessed at.
func pickAsset(assets []listedAsset, name string, maxSize int64) (Asset, string) {
	var found *listedAsset
	for index := range assets {
		if assets[index].Name != name {
			continue
		}
		if found != nil {
			return Asset{}, "listed more than once"
		}
		found = &assets[index]
	}
	switch {
	case found == nil:
		return Asset{}, "missing"
	case found.State != "" && found.State != "uploaded":
		return Asset{}, "not uploaded"
	case found.Size <= 0 || found.Size > maxSize:
		return Asset{}, "has an implausible size"
	}
	digest, ok := parseDigest(found.Digest)
	if !ok {
		return Asset{}, "has a digest that is not a SHA-256"
	}
	return Asset{Name: name, Size: found.Size, Digest: digest}, ""
}

// validHexDigest reports whether text is empty (no digest) or a bare lower-case SHA-256 in hexadecimal, which is the form an Asset
// keeps its digest in.
func validHexDigest(text string) bool {
	if text == "" {
		return true
	}
	if len(text) != 64 {
		return false
	}
	for index := 0; index < len(text); index++ {
		if (text[index] < '0' || text[index] > '9') && (text[index] < 'a' || text[index] > 'f') {
			return false
		}
	}
	return true
}

// parseDigest reads the `sha256:<hex>` GitHub puts on an asset. No digest is fine (older uploads have none); a digest of another
// kind or shape is not.
func parseDigest(text string) (string, bool) {
	if text == "" {
		return "", true
	}
	hex, ok := strings.CutPrefix(text, "sha256:")
	if !ok || len(hex) != 64 {
		return "", false
	}
	hex = strings.ToLower(hex)
	if !validHexDigest(hex) {
		return "", false
	}
	return hex, true
}

// cleanTimestamp keeps a publication time only if it looks like one; it is shown to the narrator, never used to decide anything.
func cleanTimestamp(text string) string {
	if len(text) < 10 || len(text) > 40 {
		return ""
	}
	for index := 0; index < len(text); index++ {
		character := text[index]
		if (character < '0' || character > '9') && !strings.ContainsRune("-:TZ+.", rune(character)) {
			return ""
		}
	}
	return text
}

// Newest is the release with the highest version on the channel. When a candidate and its promotion name the same version, the
// promoted release wins: they are the same bytes, and it is the one a narrator on the stable channel is offered.
func Newest(releases []Release, channel Channel) (Release, bool) {
	var best Release
	found := false
	for _, release := range releases {
		if channel == ChannelStable && release.Candidate {
			continue
		}
		switch {
		case !found, release.Version.Compare(best.Version) > 0, release.Version.Compare(best.Version) == 0 && best.Candidate && !release.Candidate:
			best, found = release, true
		}
	}
	return best, found
}

// IsUpdate reports whether release is strictly newer than the running version. A development build, or a version that is not one,
// has nothing to compare and is never offered an update.
func IsUpdate(current string, release Release) bool {
	if IsDevelopment(current) {
		return false
	}
	running, err := ParseVersion(current)
	if err != nil {
		return false
	}
	return release.Version.Compare(running) > 0
}
