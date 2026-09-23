package coverage

import "testing"

func lookupFrom(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

func TestResolveSettingsReadsEveryKey(t *testing.T) {
	got := ResolveSettings(lookupFrom(map[string]string{
		SettingMinParagraphPresent: "0.9", SettingMaxMissingRun: "5", SettingMaxMisreadRun: "4", SettingMinAnchorRun: "2",
	}))
	want := Settings{Alignment: AlignmentParams{MaxMisreadRun: 4, MinAnchorRun: 2}, Thresholds: Thresholds{MinParagraphPresent: 0.9, MaxMissingRun: 5}}
	if got != want {
		t.Fatalf("ResolveSettings = %+v, want %+v", got, want)
	}
}

func TestResolveSettingsWithNothingSetIsTheShippedDefaults(t *testing.T) {
	got := ResolveSettings(lookupFrom(nil))
	want := Settings{Alignment: AlignmentParams{MaxMisreadRun: 8, MinAnchorRun: 3}, Thresholds: Thresholds{MinParagraphPresent: 0.8, MaxMissingRun: 3}}
	if got != want || got != DefaultSettings {
		t.Fatalf("ResolveSettings = %+v, want the shipped defaults (ADR 0132) %+v", got, want)
	}
}

func TestResolveSettingsFallsBackPerKeyOnABadValue(t *testing.T) {
	cases := map[string]map[string]string{
		"not numbers":  {SettingMinParagraphPresent: "most", SettingMaxMissingRun: "3.5", SettingMaxMisreadRun: "x", SettingMinAnchorRun: ""},
		"out of range": {SettingMinParagraphPresent: "1.5", SettingMaxMissingRun: "-1", SettingMaxMisreadRun: "-2", SettingMinAnchorRun: "0"},
		"NaN share":    {SettingMinParagraphPresent: "NaN"},
	}
	for name, values := range cases {
		t.Run(name, func(t *testing.T) {
			if got := ResolveSettings(lookupFrom(values)); got != DefaultSettings {
				t.Fatalf("ResolveSettings(%v) = %+v, want every bad key at its default", values, got)
			}
		})
	}
	mixed := ResolveSettings(lookupFrom(map[string]string{SettingMaxMissingRun: "7", SettingMinAnchorRun: "zero"}))
	if mixed.Thresholds.MaxMissingRun != 7 || mixed.Alignment.MinAnchorRun != 3 {
		t.Fatalf("a good key must survive a bad neighbour: %+v", mixed)
	}
}

func TestThresholdsValidate(t *testing.T) {
	for _, bad := range []Thresholds{{MinParagraphPresent: -0.1}, {MinParagraphPresent: 1.1}, {MinParagraphPresent: 0.5, MaxMissingRun: -1}} {
		if bad.validate() == nil {
			t.Fatalf("%+v should be invalid", bad)
		}
	}
	if err := DefaultThresholds.validate(); err != nil {
		t.Fatal(err)
	}
}
