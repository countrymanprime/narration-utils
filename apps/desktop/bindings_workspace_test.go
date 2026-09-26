package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/coverage"
)

// fakeAlignedCoverageSidecar stands in for `compare.py --coverage` once it also writes the chapter's word alignment
// (edit-and-proof-workspace PRD Phase 1, ADR 0242): coverageProject's one item, one paragraph, one token, read in full.
func fakeAlignedCoverageSidecar() coverage.Launcher {
	return func(_ context.Context, _ string, args ...string) (coverage.Child, error) {
		values := map[string]string{}
		for i := 0; i+1 < len(args); i++ {
			if strings.HasPrefix(args[i], "--") {
				values[args[i]] = args[i+1]
			}
		}
		child := &coverageChild{}
		go func() {
			results := fmt.Sprintf(`COVERAGE|{"schemaVersion":1,"chapterId":%q,"bodyTokens":1,"presentTokens":1,"missingTokens":0,"extraTokens":0,"longestMissingRun":0,"alignment":{"maxMisreadRun":8,"minAnchorRun":3},"items":{"analyzed":1,"muted":0,"playedSeconds":4,"transcribed":1,"reused":0},"analysis":{"model":"small","language":null,"equivalencesHash":null}}`+"\n", values["--chapter-id"])
			results += `COVERAGE_ITEM|{"index":0,"itemGuid":"{ITEM-1}","status":"analyzed","words":"transcribed","playedSeconds":4,"wordCount":1,"model":"small","language":null}` + "\n"
			results += `COVERAGE_PARAGRAPH|{"id":"p-000001","tokens":1,"present":1,"longestMissingRun":0}` + "\n"
			results += `COVERAGE_TOKEN|{"i":0,"p":"p-000001","w":0,"text":"Alice.","status":"read","heard":null,"item":0,"start":0.0,"end":0.5}` + "\n"
			code := 0
			if err := os.WriteFile(values["--out"], []byte(results), 0o600); err != nil {
				code = 1
			}
			_ = os.WriteFile(values["--progress"], []byte("DONE|100|Finished\n"), 0o600)
			child.mu.Lock()
			child.code = &code
			child.mu.Unlock()
		}()
		return child, nil
	}
}

func TestWorkspaceAlignmentJoinsParagraphsAndPlayedRanges(t *testing.T) {
	host := coverageHost(t, coverageProject(t), true, fakeAlignedCoverageSidecar())
	if _, err := host.CoverageStart("c-0001"); err != nil {
		t.Fatal(err)
	}
	host.services().coverage.Wait()

	answer := decodeAnswer(t)(host.WorkspaceAlignment("c-0001"))

	if answer["state"] != "current" || answer["needsAlignAgain"] != false {
		t.Fatalf("answer = %v", answer)
	}
	paragraphs, _ := answer["paragraphs"].([]any)
	if len(paragraphs) != 1 || paragraphs[0].(map[string]any)["text"] != "Alice." {
		t.Fatalf("paragraphs = %v", paragraphs)
	}
	tokens, _ := answer["tokens"].([]any)
	if len(tokens) != 1 || tokens[0].(map[string]any)["status"] != "read" {
		t.Fatalf("tokens = %v", tokens)
	}
	items, _ := answer["items"].([]any)
	item, _ := items[0].(map[string]any)
	// coverageProject's fixture item has no take-level GUID line, so takeGuid (omitempty) is left out of the wire.
	if _, hasTakeGuid := item["takeGuid"]; len(items) != 1 || item["live"] != true || item["itemGuid"] != "{ITEM-1}" || hasTakeGuid {
		t.Fatalf("items = %v", items)
	}
}

func TestWorkspaceAlignmentOfAnOlderReportNeedsAlignAgain(t *testing.T) {
	// fakeCoverageSidecar (bindings_coverage_test.go) writes a results file with no COVERAGE_TOKEN lines, as a report
	// stored before ADR 0242 shipped alignment output would read.
	host := coverageHost(t, coverageProject(t), true, fakeCoverageSidecar(8))
	if _, err := host.CoverageStart("c-0001"); err != nil {
		t.Fatal(err)
	}
	host.services().coverage.Wait()

	answer := decodeAnswer(t)(host.WorkspaceAlignment("c-0001"))

	if answer["state"] != "current" || answer["needsAlignAgain"] != true {
		t.Fatalf("answer = %v", answer)
	}
	if tokens, _ := answer["tokens"].([]any); len(tokens) != 0 {
		t.Fatalf("tokens = %v", tokens)
	}
}

func TestWorkspaceAlignmentWithNoProjectIsNever(t *testing.T) {
	host := NewHost()

	answer := decodeAnswer(t)(host.WorkspaceAlignment("c-0001"))

	if answer["state"] != "never" || answer["reasons"].([]any)[0] != string(coverage.ReasonNoProject) {
		t.Fatalf("answer = %v", answer)
	}
}
