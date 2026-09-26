package coverage

import (
	"strings"
	"testing"
)

// sampleAlignment is the COVERAGE_TOKEN and COVERAGE_EXTRA lines a sidecar
// that also writes the workspace's alignment (ADR 0242) adds after
// sampleResults' own lines (report_test.go): two heard tokens (a read and a
// misread), one missing token (a tail, so it names no source position), and
// one run of extra words.
const sampleAlignment = `COVERAGE_TOKEN|{"i":0,"p":"p-000001","w":0,"text":"Chapter","status":"read","heard":null,"item":0,"start":1.0,"end":1.3}
COVERAGE_TOKEN|{"i":1,"p":"p-000001","w":1,"text":"One","status":"misread","heard":"Won","item":0,"start":1.3,"end":1.6}
COVERAGE_TOKEN|{"i":2,"p":"p-000003","w":0,"text":"So","status":"tail","heard":null,"item":null,"start":null,"end":null}
COVERAGE_EXTRA|{"text":"um","tokens":1,"start":{"itemIndex":0,"itemGuid":"{A}","sourceTime":1.6},"end":{"itemIndex":0,"itemGuid":"{A}","sourceTime":1.8},"afterToken":1}
`

func TestTheAlignmentLinesAreReadIntoTheReport(t *testing.T) {
	report, err := parseReport([]byte(sampleResults+sampleAlignment), "c-0001")
	if err != nil {
		t.Fatal(err)
	}
	if !report.HasAlignment() {
		t.Fatal("a report with COVERAGE_TOKEN lines must answer HasAlignment")
	}
	if len(report.Tokens) != 3 || report.Tokens[1].Status != "misread" || report.Tokens[1].Heard == nil || *report.Tokens[1].Heard != "Won" {
		t.Fatalf("tokens = %+v", report.Tokens)
	}
	if report.Tokens[0].ParagraphID == nil || *report.Tokens[0].ParagraphID != "p-000001" {
		t.Fatalf("token paragraph = %+v", report.Tokens[0].ParagraphID)
	}
	if report.Tokens[0].Item == nil || *report.Tokens[0].Item != 0 || report.Tokens[0].Start == nil || *report.Tokens[0].Start != 1.0 {
		t.Fatalf("a heard token must name its item and source position: %+v", report.Tokens[0])
	}
	if report.Tokens[2].Item != nil || report.Tokens[2].Start != nil || report.Tokens[2].End != nil {
		t.Fatalf("a missing token must have no source position: %+v", report.Tokens[2])
	}
	if len(report.Extras) != 1 || report.Extras[0].Text != "um" || report.Extras[0].Tokens != 1 {
		t.Fatalf("extras = %+v", report.Extras)
	}
	if got := report.Extras[0].AfterToken; got == nil || *got != 1 {
		t.Fatalf("extra afterToken = %+v", got)
	}
	if report.Extras[0].Start != (RegionPosition{ItemIndex: 0, ItemGUID: "{A}", SourceTime: 1.6}) {
		t.Fatalf("extra start = %+v", report.Extras[0].Start)
	}
}

func TestAResultWithNoTokenLinesNeedsAlignAgain(t *testing.T) {
	report, err := parseReport([]byte(sampleResults), "c-0001")
	if err != nil {
		t.Fatal(err)
	}
	if report.HasAlignment() {
		t.Fatal("sampleResults has no COVERAGE_TOKEN lines and must not answer HasAlignment")
	}
	if len(report.Tokens) != 0 || len(report.Extras) != 0 {
		t.Fatalf("a report with no alignment lines must have empty Tokens and Extras: %+v %+v", report.Tokens, report.Extras)
	}
}

func TestAnInvalidAlignmentLineIsRefused(t *testing.T) {
	replace := func(old, new string) string { return strings.Replace(sampleAlignment, old, new, 1) }
	cases := map[string]struct{ text, want string }{
		"an unknown status":    {replace(`"status":"read"`, `"status":"guessed"`), `invalid "guessed" status`},
		"a token out of order": {replace(`"i":1,`, `"i":5,`), "out of order"},
		"a source position on a missing token": {
			replace(`"status":"tail","heard":null,"item":null,"start":null,"end":null}`, `"status":"tail","heard":null,"item":0,"start":1.0,"end":1.1}`),
			"source position it should not",
		},
		"a heard word on a read": {
			replace(`"text":"Chapter","status":"read","heard":null`, `"text":"Chapter","status":"read","heard":"Chapter"`),
			"heard word it should not",
		},
		"an empty extra run":       {replace(`"tokens":1,`, `"tokens":0,`), "has no tokens"},
		"an extra past the tokens": {replace(`"afterToken":1`, `"afterToken":9`), "out of range"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := parseReport([]byte(sampleResults+tc.text), "c-0001")
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err = %v, want it to mention %q", err, tc.want)
			}
		})
	}
}
