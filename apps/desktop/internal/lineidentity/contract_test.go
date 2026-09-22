package lineidentity

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
)

// The two LineIdentityState wire payloads apps/ui needs for its schema and mock (ADR 0069, reaper-automation-
// follow-through PRD Phase 7: closing the wire-contract gap Phase 6 deliberately left open, since nothing called
// these bindings from the frontend yet). "line-identity-idle" is what LineIdentityState answers before any run;
// "line-identity-read-success" is a completed Read with one row of every status the classifier produces, so the
// UI's states (ok, drift, stale-source, removed, unrecognized, unknown never occurs once a manuscript is loaded)
// can be built and reviewed against a real shape rather than a hand-typed guess. runId is time-based (newRunID),
// so it is fixed here the way transcript/contract_test.go fixes its own volatile run id.
func stable(state map[string]any) map[string]any {
	if state["runId"] != nil {
		state["runId"] = "1790000000000000"
	}
	return state
}

func TestContractLineIdentityIdle(t *testing.T) {
	service := New(Config{Project: t.TempDir(), SessionDir: t.TempDir()}, nil, nil, nil)
	contractfile.Check(t, "line-identity-idle", stable(service.Snapshot()))
}

func TestContractLineIdentityReadSuccess(t *testing.T) {
	project, session := t.TempDir(), t.TempDir()
	writeManuscript(t, project, "sha-v1")
	client, err := bridge.New(session)
	if err != nil {
		t.Fatal(err)
	}
	service := New(Config{Project: project, SessionDir: session}, client, manuscript.New(project), nil)
	if err := service.Read(); err != nil {
		t.Fatal(err)
	}
	runID := service.Snapshot()["runId"].(string)
	reportPath := filepath.Join(session, "lines_read_"+runID+".txt")
	report := "{GUID-OK}|p-000001@sha-v1|0.000000|4.200000|It was the best of times.\n" +
		"{GUID-DRIFT}|p-000002@sha-v1|4.200000|3.100000|It was the worst of times, once.\n" +
		"{GUID-REMOVED}|p-999999@sha-v1|7.300000|2.000000|A paragraph that got deleted.\n" +
		"{GUID-STALE}|p-000001@old-sha|9.300000|4.200000|It was the best of times.\n" +
		"{GUID-UNRECOGNIZED}|line-000004|13.500000|2.500000|An identity from an older stamp scheme.\n"
	if err := os.WriteFile(reportPath, []byte(report), 0o600); err != nil {
		t.Fatal(err)
	}
	appendEvents(t, session, "LINES_STAMPED|"+runID+"|0|0|0|0") // benign no-op event, ignored while reading
	appendEvents(t, session, "LINES_READ|"+runID+"|"+bridge.PercentEncode(reportPath)+"|5")
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "line-identity-read-success", stable(service.Snapshot()))
}
