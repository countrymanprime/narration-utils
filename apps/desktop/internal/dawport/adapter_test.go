package dawport

import "testing"

// --daw is a free-form launch label (the REAPER launcher passes "REAPER", ProjectSwitch sets "Standalone"); only the two DAWs
// the suite knows change what the host does, and neither the launcher's casing nor stray spaces may decide which.
func TestClassifyKnowsReaperAndAudacityAndNothingElse(t *testing.T) {
	cases := map[string]Kind{
		"REAPER": KindREAPER, "reaper": KindREAPER, " Reaper ": KindREAPER,
		"Audacity": KindAudacity, "audacity": KindAudacity, "AUDACITY": KindAudacity,
		"": KindNone, "Standalone": KindNone, "Pro Tools": KindNone, "Audacity2": KindNone,
	}
	for label, want := range cases {
		if got := Classify(label); got != want {
			t.Errorf("Classify(%q) = %v, want %v", label, got, want)
		}
	}
}

func TestKindStringNamesEachEngine(t *testing.T) {
	cases := map[Kind]string{KindNone: "none", KindREAPER: "REAPER", KindAudacity: "Audacity"}
	for kind, want := range cases {
		if got := kind.String(); got != want {
			t.Errorf("%v.String() = %q, want %q", kind, got, want)
		}
	}
}

func TestIsREAPERLaunch(t *testing.T) {
	if IsREAPERLaunch("Audacity") {
		t.Error("IsREAPERLaunch(Audacity) = true, want false")
	}
	if !IsREAPERLaunch("REAPER") {
		t.Error("IsREAPERLaunch(REAPER) = false, want true")
	}
}
