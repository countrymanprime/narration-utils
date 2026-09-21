// Package update is the application's own update path: it knows what a version is, reads this repository's GitHub releases,
// decides whether one is newer, and (in later phases) downloads, verifies and swaps it in. It has no Wails imports, so all of it
// is tested without a window. The trust model is docs/adr/0072; the rest is docs/architecture/in-app-update.md.
package update

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// DevelopmentVersion is what a build with no release stamp reports (apps/desktop/version.go). It is never compared with a release.
const DevelopmentVersion = "0.0.0-dev"

// maxComponent bounds each part of a version to six digits: a hostile tag cannot overflow anything, and no real release is near it.
const maxComponent = 999999

// Version is a bare semantic version. A release candidate and its promotion are the same bytes and name the same version, so
// there is no prerelease part to compare.
type Version struct{ Major, Minor, Patch uint32 }

func (v Version) String() string { return fmt.Sprintf("%d.%d.%d", v.Major, v.Minor, v.Patch) }

// Compare is -1, 0 or 1 as v is older than, the same as, or newer than other.
func (v Version) Compare(other Version) int {
	for _, pair := range [3][2]uint32{{v.Major, other.Major}, {v.Minor, other.Minor}, {v.Patch, other.Patch}} {
		switch {
		case pair[0] < pair[1]:
			return -1
		case pair[0] > pair[1]:
			return 1
		}
	}
	return 0
}

// ParseVersion reads `MAJOR.MINOR.PATCH` and nothing else: no `v`, no suffix, no space, no leading zero, each part at most six digits.
func ParseVersion(text string) (Version, error) {
	parts := strings.Split(text, ".")
	if len(parts) != 3 {
		return Version{}, errors.New("a version is MAJOR.MINOR.PATCH")
	}
	var numbers [3]uint32
	for index, part := range parts {
		number, err := parseComponent(part)
		if err != nil {
			return Version{}, err
		}
		numbers[index] = number
	}
	return Version{numbers[0], numbers[1], numbers[2]}, nil
}

func parseComponent(part string) (uint32, error) {
	if part == "" || len(part) > 6 || (len(part) > 1 && part[0] == '0') {
		return 0, errors.New("a version part is one to six digits with no leading zero")
	}
	for index := 0; index < len(part); index++ {
		if part[index] < '0' || part[index] > '9' {
			return 0, errors.New("a version part is digits")
		}
	}
	number, err := strconv.ParseUint(part, 10, 32)
	if err != nil || number > maxComponent {
		return 0, errors.New("a version part is out of range")
	}
	return uint32(number), nil
}

// candidateSuffix marks the tag of a release candidate. The workflows tag `v<version>-rc` and promotion creates `v<version>`.
const candidateSuffix = "-rc"

// ParseTag reads a release tag: `v<version>` or `v<version>-rc` (candidate true). Any other suffix is not one of ours.
func ParseTag(tag string) (version Version, candidate bool, err error) {
	rest, ok := strings.CutPrefix(tag, "v")
	if !ok {
		return Version{}, false, errors.New("a release tag starts with v")
	}
	if bare, isCandidate := strings.CutSuffix(rest, candidateSuffix); isCandidate {
		rest, candidate = bare, true
	}
	version, err = ParseVersion(rest)
	if err != nil {
		return Version{}, false, err
	}
	return version, candidate, nil
}

// IsDevelopment reports whether text is the version of a build that is not a release: the development stamp, or none at all.
func IsDevelopment(text string) bool { return text == "" || text == DevelopmentVersion }
