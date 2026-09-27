package deliveryprofile

import (
	"reflect"
	"regexp"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

const fingerprint = "sha256:0f1e2d3c"

var project = findings.Project{Path: "C:/Books/Alice"}

// failingReport misses RMS and peak, has no noise floor it could measure, and has a true peak above ACX's advice.
func failingReport() measure.Report {
	report := passingReport()
	report.RMSdBFS, report.SamplePeakdBFS, report.NoiseFloordBFS, report.TruePeakdBTP = v(-24.1), v(-2.4), nil, v(-1.9)
	return report
}

func byRule(t *testing.T, fs []findings.Finding) map[string]findings.Finding {
	t.Helper()
	out := map[string]findings.Finding{}
	for _, f := range fs {
		rule, _ := f.Evidence["rule"].(string)
		if _, twice := out[rule]; twice {
			t.Fatalf("rule %s has more than one review finding", rule)
		}
		out[rule] = f
	}
	return out
}

func TestReviewFindingsAreOneFindingPerRuleNotMetOrNotMeasurable(t *testing.T) {
	report := failingReport()
	got := byRule(t, ReviewFindings(report, fingerprint, ACX(), project))
	if len(got) != 3 || got["acx.rms"].ID == "" || got["acx.peak"].ID == "" || got["acx.noise_floor"].ID == "" {
		t.Fatalf("review findings for rules %v, want exactly acx.rms, acx.peak and acx.noise_floor (advice is not a finding)", keys(got))
	}
	// The same IDs the Delivery page and the report carry, so a decision made on the Review page is the report's too.
	judged := map[string]bool{}
	for _, f := range EvaluateFile(report, ACX()).Findings {
		judged[f.ID] = true
	}
	for rule, f := range got {
		if !judged[f.ID] {
			t.Errorf("%s: review finding %s is not a finding the page judges", rule, f.ID)
		}
		if err := f.Validate(); err != nil {
			t.Errorf("%s: %v", rule, err)
		}
		if f.Category != findings.CategoryDeliveryQC || f.Analyzer != ReviewAnalyzer || f.Source.File != report.File || f.Project != project {
			t.Errorf("%s: %+v is not a delivery_qc finding of %s on the file in the project", rule, f, report.File)
		}
		if f.EvidenceVersion == "" || f.Review.Status != findings.StatusUnreviewed || f.Manuscript != nil || f.TimeRange != nil {
			t.Errorf("%s: want an evidence version, unreviewed, no manuscript position and no time: %+v", rule, f)
		}
		if f.Evidence["rule_label"] == "" || f.Evidence["requirement"] == "" || f.Evidence["profile_name"] != "ACX (September 2026)" {
			t.Errorf("%s: evidence %v does not name the rule, its requirement and the profile", rule, f.Evidence)
		}
	}
	if got["acx.rms"].Severity != findings.SeverityError || got["acx.noise_floor"].Severity != findings.SeverityInfo {
		t.Errorf("severities = %s, %s: want a missed required rule an error and an unmeasurable value info", got["acx.rms"].Severity, got["acx.noise_floor"].Severity)
	}
}

func TestAFileThatMeetsEveryRuleHasNoReviewFindings(t *testing.T) {
	if got := ReviewFindings(passingReport(), fingerprint, ACX(), project); len(got) != 0 {
		t.Fatalf("review findings = %+v, want none", got)
	}
}

func TestTheEvidenceVersionChangesOnlyWithTheEvidence(t *testing.T) {
	version := func(report measure.Report, print string, profile Profile) string {
		return byRule(t, ReviewFindings(report, print, profile, project))["acx.rms"].EvidenceVersion
	}
	base := version(failingReport(), fingerprint, ACX())
	if again := version(failingReport(), fingerprint, ACX()); again != base {
		t.Error("measuring the same file again changed the evidence version")
	}
	lower := failingReport()
	lower.RMSdBFS = v(-25)
	if version(lower, fingerprint, ACX()) == base {
		t.Error("a different value kept the evidence version")
	}
	if version(failingReport(), "sha256:ffff", ACX()) == base {
		t.Error("different audio (another fingerprint) kept the evidence version")
	}
	custom := ACX()
	custom.BuiltIn, custom.ID, custom.Revision = false, "custom-1", 1
	*custom.Rules[0].Min = -22
	custom2 := custom.Clone()
	custom2.Revision = 2
	if version(failingReport(), fingerprint, custom) != version(failingReport(), fingerprint, custom2) {
		t.Error("saving a custom profile without changing the rule changed the evidence version")
	}
	*custom2.Rules[0].Min = -21
	if version(failingReport(), fingerprint, custom) == version(failingReport(), fingerprint, custom2) {
		t.Error("changing the rule's bound kept the evidence version")
	}
	newer := ACX()
	newer.Version = "2027-01"
	a, b := byRule(t, ReviewFindings(failingReport(), fingerprint, ACX(), project)), byRule(t, ReviewFindings(failingReport(), fingerprint, newer, project))
	if a["acx.rms"].ID != b["acx.rms"].ID || a["acx.rms"].EvidenceVersion != b["acx.rms"].EvidenceVersion {
		t.Error("a newer version of the same profile with the rule unchanged changed the finding's id or evidence version")
	}
}

func TestReviewScopeIsASafeStableNamePerFile(t *testing.T) {
	safe := regexp.MustCompile(`^[A-Za-z0-9._-]+$`)
	a, b := ReviewScope("C:/Renders/Chapter 01.wav"), ReviewScope("C:/Renders/Chapter 02.wav")
	if !safe.MatchString(a) || !safe.MatchString(b) || a == b || a != ReviewScope("C:/Renders/Chapter 01.wav") {
		t.Fatalf("scopes %q and %q: want safe, distinct per file and stable", a, b)
	}
}

// The review semantics every category shares, through the real store: a decision stays while the evidence is the same,
// a rule back to met resolves its finding, and a decision changes nothing but the review history.
func TestReviewFindingsFollowTheStoresDecisionSemantics(t *testing.T) {
	store := findings.NewStore(t.TempDir())
	report := failingReport()
	scope := ReviewScope(report.File)
	save := func(r measure.Report, print string) map[string]findings.Finding {
		t.Helper()
		saved, err := store.SaveAnalyzerFindings(ReviewAnalyzer, scope, ReviewFindings(r, print, ACX(), project))
		if err != nil {
			t.Fatal(err)
		}
		out := map[string]findings.Finding{}
		for _, f := range saved {
			out[f.Evidence["rule"].(string)] = f
		}
		return out
	}
	first := save(report, fingerprint)
	rms := first["acx.rms"]

	profileBefore, reportBefore, resultsBefore := ACX(), failingReport(), EvaluateFile(failingReport(), ACX()).Results
	if _, found, err := store.RecordDecision(rms.ID, rms.EvidenceVersion, findings.StatusDismissed, "ACX Check passes it", "2026-09-27T12:00:00Z"); err != nil || !found {
		t.Fatalf("dismiss: found=%v err=%v", found, err)
	}
	if !reflect.DeepEqual(ACX(), profileBefore) || !reflect.DeepEqual(report, reportBefore) || !reflect.DeepEqual(EvaluateFile(report, ACX()).Results, resultsBefore) {
		t.Fatal("dismissing a delivery finding changed the profile, the measurement or the judgement")
	}

	again := save(report, fingerprint)
	if again["acx.rms"].Review.Status != findings.StatusDismissed || again["acx.rms"].NotInLatestRun {
		t.Errorf("after measuring the same file again: %+v, want still dismissed and in the latest run", again["acx.rms"].Review)
	}

	rerendered := failingReport()
	rerendered.RMSdBFS = v(-23.6)
	changed := save(rerendered, "sha256:rerendered")
	if changed["acx.rms"].Review.Status != findings.StatusUnreviewed || changed["acx.rms"].Review.Note != "ACX Check passes it" {
		t.Errorf("after a re-render still below RMS: %+v, want back to unreviewed with the note kept", changed["acx.rms"].Review)
	}

	fixed := failingReport()
	fixed.RMSdBFS = v(-20)
	resolved := save(fixed, "sha256:fixed")
	if !resolved["acx.rms"].NotInLatestRun {
		t.Errorf("RMS met again but its finding %+v is still in the latest run", resolved["acx.rms"])
	}
	if resolved["acx.peak"].NotInLatestRun {
		t.Error("a rule still not met was marked resolved")
	}
}

func keys(m map[string]findings.Finding) []string {
	out := []string{}
	for k := range m {
		out = append(out, k)
	}
	return out
}
