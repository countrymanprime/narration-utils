package coverage

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"slices"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
)

// pinResult pins a CoverageResult answer (recording-coverage-analysis.prd.md Phase 5, ADR 0069). The basis label
// embeds the saved file's time, which Stabilize only replaces as a whole value, so it is fixed here.
func pinResult(t *testing.T, name string, result ChapterResult) {
	t.Helper()
	view := result.View(testChapter)
	if view.Basis != nil {
		view.Basis.Label = "saved project, file modified " + contractfile.FixedTime
	}
	stable, err := contractfile.Stabilize(view)
	if err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, name, stable)
}

func TestContractCoverageResults(t *testing.T) {
	p := newTestProject(t)
	service := p.service(&fakeSidecar{present: 8})
	pinResult(t, "coverage-result-never", currentResult(t, service, DefaultAlignmentParams))

	run(t, service, testRequest())
	current := currentResult(t, service, DefaultAlignmentParams)
	if !current.Current() || len(current.Result.Report.Regions) == 0 {
		t.Fatalf("the current fixture needs a region: %+v", current)
	}
	pinResult(t, "coverage-result-current", current)

	p.items[1].length = 9
	p.writeRPP()
	pinResult(t, "coverage-result-stale", currentResult(t, service, DefaultAlignmentParams))

	if err := os.Remove(evidence.MappingFile(p.dir)); err != nil {
		t.Fatal(err)
	}
	pinResult(t, "coverage-result-unmapped", currentResult(t, service, DefaultAlignmentParams))
}

func TestAResultViewCarriesTheFractionOnlyWhenCurrent(t *testing.T) {
	p := newTestProject(t)
	service := p.service(&fakeSidecar{present: 8})
	run(t, service, testRequest())

	current := currentResult(t, service, DefaultAlignmentParams).View(testChapter)
	p.writeManuscript(testDocument, "Chapter One", "Alice was beginning to get very tired indeed.")
	stale := currentResult(t, service, DefaultAlignmentParams).View(testChapter)

	if current.RecordedFraction == nil || *current.RecordedFraction != 0.8 || current.Result == nil || current.Record == nil {
		t.Fatalf("current = %+v", current)
	}
	if stale.RecordedFraction != nil || stale.Result == nil || stale.State != evidence.StateStale {
		t.Fatalf("a stale result keeps its report but carries no fraction: %+v", stale)
	}
}

// Every reason a result or a refusal can name, pinned so the UI's schema lists the same words.
func TestContractCoverageReasons(t *testing.T) {
	refusal := make([]string, 0, len(RefusalReasons))
	for _, reason := range RefusalReasons {
		refusal = append(refusal, string(reason))
	}
	evaluator := []string{}
	for _, reason := range []evidence.EvaluatorReason{
		evidence.ReasonItemAdded, evidence.ReasonItemRemoved, evidence.ReasonItemTrimmed, evidence.ReasonItemMoved,
		evidence.ReasonItemMuted, evidence.ReasonTakeSwitched, evidence.ReasonSourceChanged, evidence.ReasonAnalyzerChanged,
		evidence.ReasonParamsChanged, evidence.ReasonMappingChanged, evidence.ReasonMappedTrackMissing, evidence.ReasonProjectUnreadable,
	} {
		evaluator = append(evaluator, string(reason))
	}
	contractfile.Check(t, "coverage-reasons", map[string][]string{"refusal": refusal, "evaluator": evaluator})
}

// RefusalReasons must list every Reason constant in reason.go, so a new one reaches the contract.
func TestRefusalReasonsListsEveryReasonConstant(t *testing.T) {
	file, err := parser.ParseFile(token.NewFileSet(), "reason.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	declared := []string{}
	ast.Inspect(file, func(node ast.Node) bool {
		spec, ok := node.(*ast.ValueSpec)
		if !ok {
			return true
		}
		if ident, typed := spec.Type.(*ast.Ident); typed && ident.Name == "Reason" {
			for _, value := range spec.Values {
				if literal, isLiteral := value.(*ast.BasicLit); isLiteral {
					declared = append(declared, literal.Value[1:len(literal.Value)-1])
				}
			}
		}
		return true
	})
	listed := []string{}
	for _, reason := range RefusalReasons {
		listed = append(listed, string(reason))
	}
	slices.Sort(declared)
	slices.Sort(listed)
	if len(declared) == 0 || !slices.Equal(declared, listed) {
		t.Fatalf("reason.go declares %v, RefusalReasons lists %v", declared, listed)
	}
}
