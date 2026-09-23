package findings

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func floatPtr(v float64) *float64 { return &v }

func validFinding() Finding {
	return Finding{
		SchemaVersion:    SchemaVersion,
		ID:               StableID("measure", "chapter-1", "rms"),
		Analyzer:         "measure",
		Category:         CategoryDeliveryQC,
		Severity:         SeverityWarning,
		Confidence:       floatPtr(1),
		ConfidenceReason: "measured directly from decoded samples",
		Review:           ReviewState{Status: StatusUnreviewed},
	}
}

func TestValidateAcceptsCompleteFinding(t *testing.T) {
	if err := validFinding().Validate(); err != nil {
		t.Fatalf("Validate() = %v, want nil", err)
	}
}

func TestValidateRejectsMalformedFindings(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*Finding)
		want   string
	}{
		{"wrong schema version", func(f *Finding) { f.SchemaVersion = 99 }, "schema_version"},
		{"missing id", func(f *Finding) { f.ID = "" }, "id"},
		{"missing analyzer", func(f *Finding) { f.Analyzer = "" }, "analyzer"},
		{"unknown category", func(f *Finding) { f.Category = "vibes" }, "category"},
		{"unknown severity", func(f *Finding) { f.Severity = "meh" }, "severity"},
		{"confidence below zero", func(f *Finding) { f.Confidence = floatPtr(-0.1) }, "confidence"},
		{"confidence above one", func(f *Finding) { f.Confidence = floatPtr(1.1) }, "confidence"},
		{"missing confidence reason", func(f *Finding) { f.ConfidenceReason = "" }, "confidence_reason"},
		{"unknown review status", func(f *Finding) { f.Review.Status = "maybe" }, "review"},
		{"inverted time range", func(f *Finding) { f.TimeRange = &TimeRange{Start: 5, End: 2} }, "time_range"},
		{"negative time range start", func(f *Finding) { f.TimeRange = &TimeRange{Start: -1, End: 2} }, "time_range"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := validFinding()
			tt.mutate(&f)
			err := f.Validate()
			if err == nil {
				t.Fatal("Validate() = nil, want an error")
			}
			if !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("Validate() = %q, want it to mention %q", err, tt.want)
			}
		})
	}
}

func TestValidateAcceptsEveryDocumentedCategory(t *testing.T) {
	for _, category := range Categories() {
		f := validFinding()
		f.Category = category
		if err := f.Validate(); err != nil {
			t.Errorf("category %q rejected: %v", category, err)
		}
	}
}

func TestStableIDIsDeterministicAndInputSensitive(t *testing.T) {
	a := StableID("measure", "chapter-1", "rms")
	if a != StableID("measure", "chapter-1", "rms") {
		t.Fatal("StableID must be deterministic for identical inputs")
	}
	if a == StableID("measure", "chapter-2", "rms") {
		t.Fatal("StableID must differ when a part differs")
	}
	// Joining parts naively would collide these two.
	if StableID("x", "ab", "c") == StableID("x", "a", "bc") {
		t.Fatal("StableID must not collide across part boundaries")
	}
	if StableID("measure", "chapter-1", "rms") == StableID("other", "chapter-1", "rms") {
		t.Fatal("StableID must differ across analyzers")
	}
}

func TestFindingJSONUsesContractFieldNames(t *testing.T) {
	f := validFinding()
	f.TimeRange = &TimeRange{Start: 1.5, End: 4}
	f.Evidence = map[string]any{"rms_dbfs": -21.5}
	f.SuggestedAction = &SuggestedAction{Kind: "review", RequiresConfirmation: true}

	raw, err := json.Marshal(f)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{
		"schema_version", "id", "analyzer", "time_range", "category", "severity",
		"confidence", "confidence_reason", "evidence", "suggested_action", "review",
	} {
		if _, ok := decoded[key]; !ok {
			t.Errorf("JSON is missing contract field %q: %s", key, raw)
		}
	}

	var round Finding
	if err := json.Unmarshal(raw, &round); err != nil {
		t.Fatal(err)
	}
	if err := round.Validate(); err != nil {
		t.Fatalf("round-tripped finding is invalid: %v", err)
	}
	if round.ID != f.ID || round.TimeRange == nil || round.TimeRange.End != 4 {
		t.Fatalf("round trip lost data: %+v", round)
	}
}

func TestWithReviewReturnsCopyAndLeavesOriginalUnreviewed(t *testing.T) {
	original := validFinding()
	reviewed, err := original.WithReview(StatusDismissed, "known room noise", "2026-09-19T10:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	if original.Review.Status != StatusUnreviewed {
		t.Fatalf("original mutated: %+v", original.Review)
	}
	if reviewed.Review.Status != StatusDismissed || reviewed.Review.Note != "known room noise" {
		t.Fatalf("reviewed = %+v", reviewed.Review)
	}
	if reviewed.ID != original.ID {
		t.Fatal("a review decision must not change the finding ID")
	}
	if _, err := original.WithReview("maybe", "", ""); err == nil {
		t.Fatal("WithReview must reject an unknown status")
	}
}

func TestValidateRejectsNonFiniteNumbers(t *testing.T) {
	tests := map[string]func(*Finding){
		"NaN confidence":  func(f *Finding) { f.Confidence = floatPtr(math.NaN()) },
		"NaN range start": func(f *Finding) { f.TimeRange = &TimeRange{Start: math.NaN(), End: 2} },
		"NaN range end":   func(f *Finding) { f.TimeRange = &TimeRange{Start: 1, End: math.NaN()} },
		"Inf range end":   func(f *Finding) { f.TimeRange = &TimeRange{Start: 1, End: math.Inf(1)} },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			f := validFinding()
			mutate(&f)
			if err := f.Validate(); err == nil {
				t.Fatal("Validate() = nil, want an error")
			}
		})
	}
}

func TestValidateAcceptsNilConfidenceWithAReason(t *testing.T) {
	f := validFinding()
	f.Confidence = nil
	if err := f.Validate(); err != nil {
		t.Fatalf("Validate() = %v, want nil (a nil confidence with a reason is honest, not invalid)", err)
	}
	f.ConfidenceReason = ""
	if err := f.Validate(); err == nil {
		t.Fatal("Validate() = nil, want an error: a nil confidence still needs a reason")
	}
}

func TestValidateChecksSourceRelativeTimeRangeOffsets(t *testing.T) {
	tests := []struct {
		name  string
		r     TimeRange
		valid bool
	}{
		{"no source offsets", TimeRange{Start: 1, End: 2}, true},
		{"valid source offsets", TimeRange{Start: 1, End: 2, SourceStart: floatPtr(10), SourceEnd: floatPtr(12)}, true},
		{"only source start", TimeRange{Start: 1, End: 2, SourceStart: floatPtr(10)}, false},
		{"only source end", TimeRange{Start: 1, End: 2, SourceEnd: floatPtr(12)}, false},
		{"inverted source range", TimeRange{Start: 1, End: 2, SourceStart: floatPtr(12), SourceEnd: floatPtr(10)}, false},
		{"negative source start", TimeRange{Start: 1, End: 2, SourceStart: floatPtr(-1), SourceEnd: floatPtr(2)}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := validFinding()
			f.TimeRange = &tt.r
			err := f.Validate()
			if tt.valid && err != nil {
				t.Fatalf("Validate() = %v, want nil", err)
			}
			if !tt.valid && err == nil {
				t.Fatal("Validate() = nil, want an error")
			}
		})
	}
}

func TestFindingJSONCarriesTheAdditiveSchemaV1Fields(t *testing.T) {
	f := validFinding()
	f.Confidence = nil
	f.EvidenceVersion = "sha256:abc123"
	f.NotInLatestRun = true
	f.Manuscript = &Manuscript{
		ChapterID: "c-0001",
		Expected:  "the quick brown fox",
		Span:      &Span{ParagraphID: "p-000042", Start: 10, End: 29, Ordinal: 1},
	}
	f.TimeRange = &TimeRange{Start: 1, End: 2, SourceStart: floatPtr(9), SourceEnd: floatPtr(10)}

	raw, err := json.Marshal(f)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["confidence"] != nil {
		t.Errorf("confidence = %v, want an explicit JSON null", decoded["confidence"])
	}
	if decoded["evidence_version"] != "sha256:abc123" {
		t.Errorf("evidence_version = %v", decoded["evidence_version"])
	}
	if decoded["not_in_latest_run"] != true {
		t.Errorf("not_in_latest_run = %v", decoded["not_in_latest_run"])
	}

	var round Finding
	if err := json.Unmarshal(raw, &round); err != nil {
		t.Fatal(err)
	}
	if err := round.Validate(); err != nil {
		t.Fatalf("round-tripped finding is invalid: %v", err)
	}
	if round.Manuscript == nil || round.Manuscript.Span == nil || round.Manuscript.Span.ParagraphID != "p-000042" || round.Manuscript.Span.Ordinal != 1 {
		t.Fatalf("round trip lost the manuscript span: %+v", round.Manuscript)
	}
	if round.TimeRange == nil || round.TimeRange.SourceStart == nil || *round.TimeRange.SourceStart != 9 {
		t.Fatalf("round trip lost the source-relative time range: %+v", round.TimeRange)
	}
	if !round.NotInLatestRun || round.EvidenceVersion != "sha256:abc123" {
		t.Fatalf("round trip lost the merge or evidence-version fields: %+v", round)
	}
}
