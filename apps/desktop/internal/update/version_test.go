package update

import (
	"fmt"
	"math/rand"
	"testing"
)

func TestParseVersionAcceptsBareSemverOnly(t *testing.T) {
	good := map[string]Version{"0.0.0": {}, "0.2.7": {0, 2, 7}, "10.20.30": {10, 20, 30}, "999999.999999.999999": {999999, 999999, 999999}}
	for text, want := range good {
		got, err := ParseVersion(text)
		if err != nil || got != want {
			t.Errorf("ParseVersion(%q) = %v, %v; want %v", text, got, err, want)
		}
	}
	bad := []string{"", "1", "1.2", "1.2.3.4", "v1.2.3", "1.2.3-rc", "1.2.3-dev", "0.0.0-dev", "01.2.3", "1.02.3", "1.2.03", "-1.2.3", "1.2.-3", "a.b.c", "1.2.3 ", " 1.2.3", "1.2.3\n", "1..3", "1.2.", "1000000.0.0", "0.1000000.0", "99999999999999999999.0.0", "١.٢.٣"}
	for _, text := range bad {
		if v, err := ParseVersion(text); err == nil {
			t.Errorf("ParseVersion(%q) = %v, want an error", text, v)
		}
	}
}

func TestParseTagAcceptsReleaseAndCandidateTagsOnly(t *testing.T) {
	for _, test := range []struct {
		tag       string
		want      Version
		candidate bool
	}{
		{"v0.2.7", Version{0, 2, 7}, false},
		{"v0.2.7-rc", Version{0, 2, 7}, true},
		{"v1.0.0", Version{1, 0, 0}, false},
		{"v12.34.56-rc", Version{12, 34, 56}, true},
	} {
		got, candidate, err := ParseTag(test.tag)
		if err != nil || got != test.want || candidate != test.candidate {
			t.Errorf("ParseTag(%q) = %v, %v, %v; want %v, %v", test.tag, got, candidate, err, test.want, test.candidate)
		}
	}
	for _, tag := range []string{"", "0.2.7", "v0.2", "v0.2.7-rc.1", "v0.2.7-rc1", "v0.2.7-beta", "v0.2.7-RC", "V0.2.7", "v0.2.7-", "v0.2.7-rc-rc", "vv0.2.7", "v0.2.7+build", "v0.2.7 ", "v0.2.7\n", "latest", "v1.2.3-dev", "../v0.2.7", "v0.2.7/../x"} {
		if v, _, err := ParseTag(tag); err == nil {
			t.Errorf("ParseTag(%q) = %v, want an error", tag, v)
		}
	}
}

func TestCompareOrdersByMajorMinorPatch(t *testing.T) {
	ordered := []Version{{0, 0, 0}, {0, 0, 1}, {0, 1, 0}, {0, 2, 6}, {0, 2, 7}, {0, 10, 0}, {1, 0, 0}, {1, 0, 1}, {2, 0, 0}}
	for i, a := range ordered {
		for j, b := range ordered {
			want := 0
			if i < j {
				want = -1
			} else if i > j {
				want = 1
			}
			if got := a.Compare(b); got != want {
				t.Errorf("%v.Compare(%v) = %d, want %d", a, b, got, want)
			}
		}
	}
}

func TestARandomVersionRoundTripsAndCompareIsATotalOrder(t *testing.T) {
	random := rand.New(rand.NewSource(20260921)) //nolint:gosec // G404: a fixed seed for a deterministic test
	next := func() Version {
		return Version{uint32(random.Intn(maxComponent + 1)), uint32(random.Intn(12)), uint32(random.Intn(maxComponent + 1))}
	}
	for range 2000 {
		a, b, c := next(), next(), next()
		parsed, err := ParseVersion(a.String())
		if err != nil || parsed != a {
			t.Fatalf("%v did not round-trip: %v, %v", a, parsed, err)
		}
		if a.Compare(b) != -b.Compare(a) {
			t.Fatalf("Compare is not antisymmetric for %v and %v", a, b)
		}
		if a.Compare(a) != 0 {
			t.Fatalf("%v is not equal to itself", a)
		}
		if a.Compare(b) <= 0 && b.Compare(c) <= 0 && a.Compare(c) > 0 {
			t.Fatalf("Compare is not transitive for %v, %v, %v", a, b, c)
		}
		tag := fmt.Sprintf("v%s", a)
		if v, candidate, err := ParseTag(tag); err != nil || v != a || candidate {
			t.Fatalf("ParseTag(%q) = %v, %v, %v", tag, v, candidate, err)
		}
	}
}

func TestADevelopmentVersionIsRecognisedAndNeverInstallable(t *testing.T) {
	if !IsDevelopment(DevelopmentVersion) || !IsDevelopment("") {
		t.Fatal("0.0.0-dev and an empty version are development builds")
	}
	if IsDevelopment("0.2.7") || IsDevelopment("0.0.0") {
		t.Fatal("a release version is not a development build")
	}
}

// A release candidate and its promotion name the same version, so the one is not an update of the other.
func TestACandidateTagAndItsPromotionAreTheSameVersion(t *testing.T) {
	rc, _, err := ParseTag("v0.2.7-rc")
	if err != nil {
		t.Fatal(err)
	}
	stable, _, err := ParseTag("v0.2.7")
	if err != nil {
		t.Fatal(err)
	}
	if rc.Compare(stable) != 0 {
		t.Fatalf("%v and %v must compare equal", rc, stable)
	}
}

func FuzzParseVersionAndTag(f *testing.F) {
	for _, seed := range []string{"0.2.7", "v0.2.7-rc", "", "v", "1.2.3-", "999999.999999.999999", "01.2.3", "v0.2.7\x00", "١.٢.٣", "1.2.3\n"} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, text string) {
		if v, err := ParseVersion(text); err == nil {
			if v.String() != text {
				t.Fatalf("ParseVersion(%q) accepted text that does not round-trip: %v", text, v)
			}
		}
		if v, candidate, err := ParseTag(text); err == nil {
			want := "v" + v.String()
			if candidate {
				want += "-rc"
			}
			if want != text {
				t.Fatalf("ParseTag(%q) accepted text that does not round-trip: %q", text, want)
			}
		}
	})
}
