package coverage

import (
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
)

func TestAModelOrLanguageChangeKeepsTheResultCurrentAndLabelled(t *testing.T) {
	p := newTestProject(t)
	sidecar := &fakeSidecar{}
	service := p.service(sidecar)
	request := testRequest()
	request.Transcription = Transcription{Model: "small", Language: "en"}
	run(t, service, request)

	// The narrator now uses another model and language: the result stays current (Q13 A), labelled with what made it.
	result := currentResult(t, service, DefaultAlignmentParams)
	if !result.Current() || result.Result.Model != "small" || result.Result.Language != "en" {
		t.Fatalf("result = %+v", result)
	}

	// A run with the new model does not reuse the other model's words.
	request.Transcription = Transcription{Model: "large-v3", Language: "de"}
	run(t, service, request)
	if got := sidecar.transcriptions(); len(got) != 4 {
		t.Fatalf("a new model must transcribe again, got %v", got)
	}
	if first, second := latestRecord(t, p).ParamHash, paramHash(DefaultAlignmentParams, readProjectInputs(p.dir)); first != second {
		t.Fatalf("the parameter hash must not depend on the model: %s != %s", first, second)
	}
	if result := currentResult(t, service, DefaultAlignmentParams); result.Result.Model != "large-v3" {
		t.Fatalf("the newest run labels the result: %+v", result.Result)
	}
}

func TestAnAlignmentParameterChangeMakesTheResultStale(t *testing.T) {
	p := newTestProject(t)
	service := p.service(&fakeSidecar{})
	run(t, service, testRequest())

	result := currentResult(t, service, AlignmentParams{MaxMisreadRun: 4, MinAnchorRun: 3})

	if result.State != evidence.StateStale || !slices.Equal(result.Reasons, []string{string(evidence.ReasonParamsChanged)}) {
		t.Fatalf("result = %+v", result)
	}
}

func TestEditingTheEquivalencesOrTheHintsMakesTheResultStale(t *testing.T) {
	for _, file := range []string{"equivalences.csv", "vocabulary_hints.txt"} {
		t.Run(file, func(t *testing.T) {
			p := newTestProject(t)
			service := p.service(&fakeSidecar{})
			run(t, service, testRequest())

			p.writeFile("TranscriptCompare/"+file, "grey,gray\n")
			result := currentResult(t, service, DefaultAlignmentParams)

			if result.State != evidence.StateStale || !slices.Contains(result.Reasons, string(evidence.ReasonParamsChanged)) {
				t.Fatalf("result = %+v", result)
			}
		})
	}
}

func TestAManuscriptTextChangeMakesTheResultStale(t *testing.T) {
	p := newTestProject(t)
	service := p.service(&fakeSidecar{})
	run(t, service, testRequest())

	p.writeManuscript(testDocument, "Chapter One", "Alice was beginning to get very tired indeed.")
	result := currentResult(t, service, DefaultAlignmentParams)

	if result.State != evidence.StateStale || !slices.Equal(result.Reasons, []string{string(ReasonManuscriptChanged)}) {
		t.Fatalf("result = %+v", result)
	}
}

func TestAReimportIsUnmappedUntilConfirmedAndThenStale(t *testing.T) {
	p := newTestProject(t)
	service := p.service(&fakeSidecar{})
	run(t, service, testRequest())

	// A re-import gives the manuscript a new document id and resetDerived clears the mapping.
	p.writeManuscript("doc-2", "Chapter One", "Alice was beginning to get very tired.")
	_ = os.Remove(evidence.MappingFile(p.dir))
	unmapped := currentResult(t, service, DefaultAlignmentParams)
	p.confirm("doc-2", testTrack, testChapter)
	remapped := currentResult(t, service, DefaultAlignmentParams)

	if unmapped.State != evidence.StateNever || !slices.Equal(unmapped.Reasons, []string{string(ReasonUnmapped)}) {
		t.Fatalf("unmapped = %+v", unmapped)
	}
	if remapped.State != evidence.StateStale || !slices.Contains(remapped.Reasons, string(ReasonManuscriptChanged)) {
		t.Fatalf("remapped = %+v", remapped)
	}
}

func TestAChapterNeverCheckedReadsNever(t *testing.T) {
	p := newTestProject(t)
	result := currentResult(t, p.service(&fakeSidecar{}), DefaultAlignmentParams)
	if result.State != evidence.StateNever || result.Record != nil || result.Current() || result.Basis == nil {
		t.Fatalf("result = %+v", result)
	}
}

func TestACompleteRecordWhoseReportIsGoneIsNotCurrent(t *testing.T) {
	p := newTestProject(t)
	service := p.service(&fakeSidecar{})
	state := run(t, service, testRequest())
	if err := os.Remove(filepath.Join(resultsDir(p.dir), state.RecordID+".json")); err != nil {
		t.Fatal(err)
	}

	result := currentResult(t, service, DefaultAlignmentParams)

	if result.State != evidence.StateNever || !slices.Contains(result.Reasons, string(ReasonResultMissing)) || result.Current() {
		t.Fatalf("result = %+v", result)
	}
}

func TestResultRefusalsAreReadAsNeverWithTheirReason(t *testing.T) {
	p := newTestProject(t)
	service := p.service(&fakeSidecar{})
	if result := currentResult(t, service, AlignmentParams{MinAnchorRun: 0}); !slices.Equal(result.Reasons, []string{string(ReasonInvalidParams)}) {
		t.Fatalf("result = %+v", result)
	}
	_ = os.Remove(p.rpp)
	if result := currentResult(t, service, DefaultAlignmentParams); result.State != evidence.StateNever || !slices.Equal(result.Reasons, []string{string(ReasonProjectUnreadable)}) {
		t.Fatalf("result = %+v", result)
	}
	if result, err := New(Config{}, nil, nil).Result(testChapter, DefaultAlignmentParams); err != nil || !slices.Equal(result.Reasons, []string{string(ReasonNoProject)}) {
		t.Fatalf("result = %+v, %v", result, err)
	}
	if result, err := New(Config{Project: p.dir}, nil, nil).Result(testChapter, DefaultAlignmentParams); err != nil || !slices.Equal(result.Reasons, []string{string(ReasonNoManuscript)}) {
		t.Fatalf("result = %+v, %v", result, err)
	}
	if result, err := New(Config{Project: p.dir, LoadManuscript: p.loadManuscript}, nil, nil).Result(testChapter, DefaultAlignmentParams); err != nil || !slices.Equal(result.Reasons, []string{string(ReasonNoProjectFile)}) {
		t.Fatalf("result = %+v, %v", result, err)
	}
}
