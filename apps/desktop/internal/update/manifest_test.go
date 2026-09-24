package update

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"strings"
	"testing"
)

const testRepository = "countrymanprime/narration-utils"

var windows = Platform{Key: "windows-x64", Extension: ".zip", SelfReplace: true}

// windowsZip is the Windows archive of release 0.2.7, the version most tests stage.
var windowsZip = windows.AssetName(Version{0, 2, 7})

type fakeAsset struct {
	Name               string `json:"name"`
	Size               int64  `json:"size"`
	State              string `json:"state,omitempty"`
	Digest             string `json:"digest,omitempty"`
	BrowserDownloadURL string `json:"browser_download_url,omitempty"`
}

type fakeRelease struct {
	TagName     string      `json:"tag_name"`
	Draft       bool        `json:"draft"`
	Prerelease  bool        `json:"prerelease"`
	PublishedAt string      `json:"published_at"`
	HTMLURL     string      `json:"html_url,omitempty"`
	Body        string      `json:"body"`
	Assets      []fakeAsset `json:"assets"`
}

// goodAssets are the files of the release tagged tag: every name carries the tag's bare version.
func goodAssets(tag string) []fakeAsset {
	version, _, _ := ParseTag(tag)
	return []fakeAsset{
		{Name: windows.AssetName(version), Size: 400 << 20},
		{Name: windows.ChecksumName(version), Size: 100},
		{Name: "narration-utils-" + version.String() + "-linux-x64.tar.gz", Size: 200 << 20},
	}
}

func rc(tag string) fakeRelease {
	return fakeRelease{TagName: tag, Prerelease: true, PublishedAt: "2026-09-20T10:00:00Z", Assets: goodAssets(tag)}
}

func stable(tag string) fakeRelease {
	return fakeRelease{TagName: tag, PublishedAt: "2026-09-21T10:00:00Z", Assets: goodAssets(tag)}
}

func marshal(t testing.TB, value any) []byte {
	t.Helper()
	bytes, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return bytes
}

func tags(releases []Release) string {
	names := make([]string, len(releases))
	for index, release := range releases {
		names[index] = release.Tag
	}
	return strings.Join(names, ",")
}

func TestParseReleasesKeepsTheReleasesThatCarryThePlatformAsset(t *testing.T) {
	body := marshal(t, []fakeRelease{stable("v0.2.7"), rc("v0.2.7-rc"), rc("v0.2.6-rc")})
	releases, rejected, err := ParseReleases(body, testRepository, windows)
	if err != nil || len(rejected) != 0 {
		t.Fatalf("err %v rejected %v", err, rejected)
	}
	if got := tags(releases); got != "v0.2.7,v0.2.7-rc,v0.2.6-rc" {
		t.Fatalf("tags = %s", got)
	}
	first := releases[0]
	if first.Version != (Version{0, 2, 7}) || first.Candidate || !releases[1].Candidate {
		t.Fatalf("versions or candidates wrong: %+v %+v", first, releases[1])
	}
	if first.Asset.Name != windowsZip || first.Asset.Size != 400<<20 || first.Checksum.Name != windowsZip+".sha256" {
		t.Fatalf("assets = %+v %+v", first.Asset, first.Checksum)
	}
}

// Nothing the JSON says about where to download or read is used: the URLs are built from the compiled-in repository, the tag and
// the known asset name.
func TestTheURLsAreBuiltFromTheRepositoryAndNeverTakenFromTheJSON(t *testing.T) {
	release := stable("v0.2.7")
	release.HTMLURL = "https://evil.example/releases/tag/v0.2.7"
	release.Assets[0].BrowserDownloadURL = "https://evil.example/narration-utils-0.2.7-windows-x64.zip"
	releases, _, err := ParseReleases(marshal(t, []fakeRelease{release}), testRepository, windows)
	if err != nil || len(releases) != 1 {
		t.Fatalf("releases %v err %v", releases, err)
	}
	got := releases[0]
	if got.NotesURL != "https://github.com/countrymanprime/narration-utils/releases/tag/v0.2.7" {
		t.Fatalf("notes URL = %s", got.NotesURL)
	}
	if got.Asset.URL != "https://github.com/countrymanprime/narration-utils/releases/download/v0.2.7/narration-utils-0.2.7-windows-x64.zip" {
		t.Fatalf("asset URL = %s", got.Asset.URL)
	}
	if got.Checksum.URL != got.Asset.URL+".sha256" {
		t.Fatalf("checksum URL = %s", got.Checksum.URL)
	}
}

func TestParseReleasesRefusesEachHostileOrMalformedRelease(t *testing.T) {
	mutate := func(edit func(*fakeRelease)) fakeRelease {
		release := stable("v0.2.8")
		release.Assets = goodAssets(release.TagName)
		edit(&release)
		return release
	}
	cases := map[string]fakeRelease{
		"a draft":                   mutate(func(r *fakeRelease) { r.Draft = true }),
		"a tag with another suffix": mutate(func(r *fakeRelease) { r.TagName = "v0.2.8-beta" }),
		"a tag that is a path":      mutate(func(r *fakeRelease) { r.TagName = "v0.2.8/../../x" }),
		"a candidate tag that is not a pre-release": mutate(func(r *fakeRelease) { r.TagName = "v0.2.8-rc" }),
		"a stable tag marked as a pre-release":      mutate(func(r *fakeRelease) { r.Prerelease = true }),
		"no platform asset":                         mutate(func(r *fakeRelease) { r.Assets = r.Assets[1:] }),
		"the files of another version":              mutate(func(r *fakeRelease) { r.Assets = goodAssets("v0.2.7") }),
		"an asset name without the version":         mutate(func(r *fakeRelease) { r.Assets[0].Name = "narration-utils-windows-x64.zip" }),
		"no checksum":                               mutate(func(r *fakeRelease) { r.Assets = append(r.Assets[:1], r.Assets[2:]...) }),
		"the asset listed twice":                    mutate(func(r *fakeRelease) { r.Assets = append(r.Assets, r.Assets[0]) }),
		"the checksum listed twice":                 mutate(func(r *fakeRelease) { r.Assets = append(r.Assets, r.Assets[1]) }),
		"a zero-size asset":                         mutate(func(r *fakeRelease) { r.Assets[0].Size = 0 }),
		"a negative-size asset":                     mutate(func(r *fakeRelease) { r.Assets[0].Size = -5 }),
		"an asset over the size cap":                mutate(func(r *fakeRelease) { r.Assets[0].Size = MaxAssetBytes + 1 }),
		"a huge checksum file":                      mutate(func(r *fakeRelease) { r.Assets[1].Size = MaxChecksumBytes + 1 }),
		"an asset that is not uploaded":             mutate(func(r *fakeRelease) { r.Assets[0].State = "starter" }),
		"a digest that is not sha256":               mutate(func(r *fakeRelease) { r.Assets[0].Digest = "md5:abc" }),
		"a digest with the wrong length":            mutate(func(r *fakeRelease) { r.Assets[0].Digest = "sha256:abcd" }),
		"a digest that is not hexadecimal":          mutate(func(r *fakeRelease) { r.Assets[0].Digest = "sha256:" + strings.Repeat("z", 64) }),
	}
	for name, release := range cases {
		releases, rejected, err := ParseReleases(marshal(t, []fakeRelease{release}), testRepository, windows)
		if err != nil {
			t.Errorf("%s: the whole list was refused: %v", name, err)
			continue
		}
		if len(releases) != 0 || len(rejected) != 1 {
			t.Errorf("%s: kept %v, rejected %v; want one rejection", name, tags(releases), rejected)
		}
	}
}

func TestOneBadReleaseDoesNotHideAGoodOne(t *testing.T) {
	bad := stable("v9.9.9")
	bad.Assets = nil
	releases, rejected, err := ParseReleases(marshal(t, []fakeRelease{bad, rc("v0.2.7-rc")}), testRepository, windows)
	if err != nil || tags(releases) != "v0.2.7-rc" || len(rejected) != 1 {
		t.Fatalf("releases %s rejected %v err %v", tags(releases), rejected, err)
	}
}

func TestARejectionNamesTheProblemAndNeverEchoesAValue(t *testing.T) {
	release := stable("v0.2.8")
	release.TagName = "v0.2.8-<script>alert(1)</script>"
	_, rejected, _ := ParseReleases(marshal(t, []fakeRelease{release}), testRepository, windows)
	if len(rejected) != 1 || strings.Contains(rejected[0], "script") {
		t.Fatalf("rejected = %v", rejected)
	}
}

func TestParseReleasesRefusesABodyThatIsNotAListOrIsTooLarge(t *testing.T) {
	for name, body := range map[string][]byte{
		"an object":          []byte(`{"message":"API rate limit exceeded"}`),
		"a string":           []byte(`"hello"`),
		"not JSON":           []byte(`<html>`),
		"empty":              nil,
		"too large":          append([]byte(`["`), make([]byte, MaxManifestBytes+1)...),
		"deeply nested":      []byte(strings.Repeat("[", 100000)),
		"a truncated object": []byte(`[{"tag_name":"v0.2.7"`),
	} {
		if releases, _, err := ParseReleases(body, testRepository, windows); err == nil {
			t.Errorf("%s: want an error, kept %s", name, tags(releases))
		}
	}
	if releases, _, err := ParseReleases([]byte(`null`), testRepository, windows); err != nil || len(releases) != 0 {
		t.Errorf("null is an empty list: %v %v", releases, err)
	}
	if releases, rejected, err := ParseReleases([]byte(`[1,2,3]`), testRepository, windows); err != nil || len(releases) != 0 || len(rejected) != 3 {
		t.Errorf("each number is its own problem: %v %v %v", releases, rejected, err)
	}
}

func TestAWrongTypeInOneReleaseRejectsThatReleaseOnly(t *testing.T) {
	body := []byte(fmt.Sprintf(`[{"tag_name": 5, "assets": "x"}, %s]`, marshal(t, rc("v0.2.7-rc"))))
	releases, rejected, err := ParseReleases(body, testRepository, windows)
	if err != nil || tags(releases) != "v0.2.7-rc" || len(rejected) != 1 {
		t.Fatalf("releases %s rejected %v err %v", tags(releases), rejected, err)
	}
}

func TestADigestThatIsPresentIsKeptLowerCase(t *testing.T) {
	release := stable("v0.2.7")
	release.Assets[0].Digest = "sha256:" + strings.Repeat("AB", 32)
	releases, _, err := ParseReleases(marshal(t, []fakeRelease{release}), testRepository, windows)
	if err != nil || len(releases) != 1 || releases[0].Asset.Digest != strings.Repeat("ab", 32) {
		t.Fatalf("releases %+v err %v", releases, err)
	}
}

func TestNewestPicksByVersionThenPrefersThePromotedRelease(t *testing.T) {
	body := marshal(t, []fakeRelease{rc("v0.2.9-rc"), rc("v0.2.7-rc"), stable("v0.2.7"), rc("v0.2.8-rc"), stable("v0.2.6")})
	releases, _, err := ParseReleases(body, testRepository, windows)
	if err != nil {
		t.Fatal(err)
	}
	if got, ok := Newest(releases, ChannelCandidates); !ok || got.Tag != "v0.2.9-rc" {
		t.Fatalf("candidates newest = %v %v", got.Tag, ok)
	}
	if got, ok := Newest(releases, ChannelStable); !ok || got.Tag != "v0.2.7" {
		t.Fatalf("stable newest = %v %v", got.Tag, ok)
	}
	tie, _, _ := ParseReleases(marshal(t, []fakeRelease{rc("v0.2.7-rc"), stable("v0.2.7")}), testRepository, windows)
	if got, _ := Newest(tie, ChannelCandidates); got.Tag != "v0.2.7" {
		t.Fatalf("with the same version the promoted release wins, got %s", got.Tag)
	}
	only, _, _ := ParseReleases(marshal(t, []fakeRelease{rc("v0.2.7-rc")}), testRepository, windows)
	if _, ok := Newest(only, ChannelStable); ok {
		t.Fatal("no stable release exists")
	}
	if _, ok := Newest(nil, ChannelCandidates); ok {
		t.Fatal("an empty list has no newest")
	}
}

func TestOnlyAStrictlyNewerVersionIsAnUpdate(t *testing.T) {
	release := Release{Version: Version{0, 2, 7}}
	for _, test := range []struct {
		current string
		want    bool
	}{{"0.2.6", true}, {"0.1.9", true}, {"0.2.7", false}, {"0.2.8", false}, {"1.0.0", false}, {"0.0.0-dev", false}, {"", false}, {"junk", false}} {
		if got := IsUpdate(test.current, release); got != test.want {
			t.Errorf("IsUpdate(%q, 0.2.7) = %v, want %v", test.current, got, test.want)
		}
	}
}

func TestParseChannelFallsBackToCandidates(t *testing.T) {
	for text, want := range map[string]Channel{"stable": ChannelStable, "candidates": ChannelCandidates, "": ChannelCandidates, "beta": ChannelCandidates, "STABLE": ChannelCandidates} {
		if got := ParseChannel(text); got != want {
			t.Errorf("ParseChannel(%q) = %q, want %q", text, got, want)
		}
	}
}

func TestPlatformForKnowsTheThreeReleasePlatformsAndOnlyWindowsReplacesItself(t *testing.T) {
	for _, test := range []struct {
		goos, goarch, key string
		replaces          bool
	}{{"windows", "amd64", "windows-x64", true}, {"darwin", "arm64", "macos-arm64", false}, {"linux", "amd64", "linux-x64", false}} {
		platform, ok := PlatformFor(test.goos, test.goarch)
		if !ok || platform.Key != test.key || platform.SelfReplace != test.replaces {
			t.Errorf("PlatformFor(%s, %s) = %+v, %v", test.goos, test.goarch, platform, ok)
		}
		asset := platform.AssetName(Version{0, 2, 7})
		if asset != "narration-utils-0.2.7-"+test.key+platform.Extension || platform.ChecksumName(Version{0, 2, 7}) != asset+".sha256" {
			t.Errorf("asset names %+v", platform)
		}
	}
	for _, pair := range [][2]string{{"windows", "arm64"}, {"darwin", "amd64"}, {"freebsd", "amd64"}, {"", ""}} {
		if _, ok := PlatformFor(pair[0], pair[1]); ok {
			t.Errorf("PlatformFor(%s, %s) is not a release platform", pair[0], pair[1])
		}
	}
}

func TestParseReleasesNeverPanicsOnGeneratedGarbage(t *testing.T) {
	random := rand.New(rand.NewSource(7)) //nolint:gosec // G404: a fixed seed for a deterministic test
	alphabet := []byte(`[]{}":,0123456789 truefalsnul\tag_nameassetsizedigest`)
	for range 3000 {
		body := make([]byte, random.Intn(200))
		for index := range body {
			body[index] = alphabet[random.Intn(len(alphabet))]
		}
		_, _, _ = ParseReleases(body, testRepository, windows)
	}
}

func FuzzParseReleases(f *testing.F) {
	seed, err := json.Marshal([]fakeRelease{stable("v0.2.7"), rc("v0.2.6-rc")})
	if err != nil {
		f.Fatal(err)
	}
	f.Add(seed)
	f.Add([]byte(`[{"tag_name":"v0.2.7","assets":[{"name":"narration-utils-0.2.7-windows-x64.zip","size":1}]}]`))
	f.Add([]byte(`{}`))
	f.Add([]byte(`[null,1,"x",[],{}]`))
	f.Fuzz(func(t *testing.T, body []byte) {
		releases, _, err := ParseReleases(body, testRepository, windows)
		if err != nil {
			return
		}
		for _, release := range releases {
			if !strings.HasPrefix(release.Asset.URL, "https://github.com/"+testRepository+"/releases/download/"+release.Tag+"/") {
				t.Fatalf("an asset URL outside the repository: %s", release.Asset.URL)
			}
			if release.Asset.Name != windows.AssetName(release.Version) || release.Checksum.Name != windows.ChecksumName(release.Version) {
				t.Fatalf("an unknown asset name: %+v", release)
			}
			if release.Asset.Size <= 0 || release.Asset.Size > MaxAssetBytes {
				t.Fatalf("an implausible size: %d", release.Asset.Size)
			}
			if _, _, err := ParseTag(release.Tag); err != nil {
				t.Fatalf("an unparseable tag was kept: %q", release.Tag)
			}
		}
	})
}
