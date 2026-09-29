package takecompare

import (
	"context"
	"reflect"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

func (fx fixture) passageRequest() Request {
	request := fx.request()
	request.Group = findings.Finding{}
	request.Passage = &Passage{
		ID: "passage-ch1-0-0-itemA", FirstParagraph: 0, LastParagraph: 0, ChapterTitle: "Chapter One",
		Reads: []Read{
			{ItemGUID: "{ITEM-A}", TakeGUID: "{TAKE-A}", SourceFile: fx.project.Tracks[0].Items[0].Takes[0].SourceFile, SourceStart: 0, SourceLength: 8},
			{ItemGUID: "{ITEM-B}", TakeGUID: "{TAKE-B}", SourceFile: fx.project.Tracks[0].Items[1].Takes[0].SourceFile, SourceStart: 1.5, SourceLength: 8},
			{ItemGUID: "{ITEM-C}", TakeGUID: "{TAKE-C}", SourceFile: fx.project.Tracks[0].Items[2].Takes[0].SourceFile, SourceStart: 0, SourceLength: 8},
		},
	}
	return request
}

// A passage is named to the sidecar by its paragraphs: only the sidecar numbers sentences.
func TestComparePassageAsksTheSidecarForTheParagraphsAndSavesOneComparison(t *testing.T) {
	fx := newFixture(t)
	runner := &fakeRunner{output: goldenResults(t)}
	store := findings.NewStore(fx.dir)

	finding, err := (&Comparer{Runner: runner, Store: store}).Compare(context.Background(), fx.passageRequest())
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(runner.manifest["span"], map[string]any{"firstParagraph": 0.0, "lastParagraph": 0.0}) {
		t.Fatalf("manifest span = %v", runner.manifest["span"])
	}
	evidence := compareEvidence(t, finding)
	if evidence.SourceFindingID != "passage-ch1-0-0-itemA" || evidence.Compared != 3 || finding.Category != findings.CategoryTakeComparison {
		t.Fatalf("evidence = %+v", evidence)
	}
	if finding.ID != PassageFindingID(fx.dir, "passage-ch1-0-0-itemA") {
		t.Fatalf("id = %s, want the one a reader can compute from the passage", finding.ID)
	}
	if finding.Manuscript.ChapterID != "ch-1" || finding.Manuscript.Expected == "" {
		t.Fatalf("manuscript = %+v", finding.Manuscript)
	}
}

func TestComparePassageRefusesAnAnswerForOtherParagraphs(t *testing.T) {
	fx := newFixture(t)
	other := strings.Replace(goldenResults(t), `"firstParagraph":0,"lastParagraph":0`, `"firstParagraph":1,"lastParagraph":1`, 1)
	if _, err := (&Comparer{Runner: &fakeRunner{output: other}, Store: findings.NewStore(fx.dir)}).Compare(context.Background(), fx.passageRequest()); err == nil || !strings.Contains(err.Error(), "paragraph") {
		t.Fatalf("an answer for other paragraphs: %v", err)
	}
}

func TestComparePassageRefusesWhatIsNotAPassageOfTwoReads(t *testing.T) {
	fx := newFixture(t)
	comparer := &Comparer{Runner: &fakeRunner{output: goldenResults(t)}, Store: findings.NewStore(fx.dir)}
	one := fx.passageRequest()
	one.Passage.Reads = one.Passage.Reads[:1]
	if _, err := comparer.Compare(context.Background(), one); err == nil {
		t.Error("one read: no error")
	}
	backwards := fx.passageRequest()
	backwards.Passage.FirstParagraph, backwards.Passage.LastParagraph = 2, 1
	if _, err := comparer.Compare(context.Background(), backwards); err == nil {
		t.Error("last before first: no error")
	}
	unnamed := fx.passageRequest()
	unnamed.Passage.ID = ""
	if _, err := comparer.Compare(context.Background(), unnamed); err == nil {
		t.Error("no id: no error")
	}
}
