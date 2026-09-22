package takereview

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
)

// CreateTakeRequest is what the Lua create_take command (integrations/reaper/narration_take_review.lua) needs to
// attach a narrator-approved candidate's source range as a new take on the target item: the finding it came from
// (Q5/ADR 0098 provenance), the target item's own GUID (Q6's explicit, unstamped target identity - never
// preselected on a weak match, per the PRD's MVP scope), the candidate's own item GUID when it has one (an extra
// staleness check; empty skips it), the candidate's source file, and the matched span's range within that source
// (SourceRangeStart becomes the new take's D_STARTOFFS, per the phase 1 spike).
type CreateTakeRequest struct {
	FindingID         string
	TargetItemGUID    string
	CandidateItemGUID string
	SourceFile        string
	SourceRangeStart  float64
	SourceRangeEnd    float64
}

// CreateTakeResult is what the bridge reports back once the take exists: the target item's own GUID (unchanged)
// and the new take's GUID, both re-resolved by the Lua command after its Undo_EndBlock2 (the phase 1 spike's
// warning that undo/redo - and, defensively, ending an undo block - replace REAPER's item/take Lua objects
// project-wide).
type CreateTakeResult struct {
	TargetItemGUID string `json:"targetItemGuid"`
	NewTakeGUID    string `json:"newTakeGuid"`
}

// createTakeTimeout bounds how long CreateTake waits for REAPER to answer a create_take command before reporting a
// timeout rather than hanging the confirm dialog forever (REAPER not running, or the launcher script not loaded).
// A var, not a const, so createtake_test.go can shrink it for the timeout case without a real ten-second test.
var createTakeTimeout = 10 * time.Second

// createTakePollInterval is how often CreateTake asks the bridge client to read new lines from events.log while it
// waits; nothing else in this process polls the same client for this run, so a short interval costs little.
var createTakePollInterval = 50 * time.Millisecond

// bridgeClient is the subset of *bridge.Client CreateTake needs, so it can be exercised with a fake in tests
// without a real REAPER session directory or event log.
type bridgeClient interface {
	Send(action string, fields []string) (string, error)
	Subscribe(sub bridge.Subscription) (unsubscribe func())
	Dispatch() error
}

// CreateTake sends one create_take command to the REAPER bridge and waits for it to succeed, go stale, or fail.
// sessionDir is where the request payload file is written (the same session directory the bridge client itself
// uses); the wire protocol caps a command at a handful of positional fields (narration_bridge_core.lua's split),
// so - like stamp_item_lines and create_chapter_regions before it - the request's fields travel in a one-row
// payload file and the command itself carries only a run id and that file's path.
func CreateTake(ctx context.Context, client bridgeClient, sessionDir string, req CreateTakeRequest) (CreateTakeResult, error) {
	if client == nil {
		return CreateTakeResult{}, fmt.Errorf("REAPER is not connected; open the project from REAPER to create a take")
	}
	if req.TargetItemGUID == "" {
		return CreateTakeResult{}, fmt.Errorf("choose a target item before creating a take")
	}
	if req.SourceFile == "" {
		return CreateTakeResult{}, fmt.Errorf("the candidate has no source file to attach")
	}

	runID := fmt.Sprintf("take-%d", time.Now().UnixNano())
	payloadPath, err := writeCreateTakePayload(sessionDir, runID, req)
	if err != nil {
		return CreateTakeResult{}, err
	}
	defer func() { _ = os.Remove(payloadPath) }()

	results := make(chan bridge.Event, 1)
	unsubscribe := client.Subscribe(bridge.Subscription{
		Tags:   []string{"TAKE_CREATED", "TAKE_STALE", "ERROR"},
		Owns:   func(id string) bool { return id == runID },
		Handle: func(event bridge.Event) { results <- event },
	})
	defer unsubscribe()

	if _, err := client.Send("create_take", []string{runID, payloadPath}); err != nil {
		return CreateTakeResult{}, fmt.Errorf("could not send the take-creation request to REAPER: %w", err)
	}

	deadline := time.NewTimer(createTakeTimeout)
	defer deadline.Stop()
	ticker := time.NewTicker(createTakePollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return CreateTakeResult{}, ctx.Err()
		case <-deadline.C:
			return CreateTakeResult{}, fmt.Errorf("REAPER did not respond to the take-creation request in time")
		case <-ticker.C:
			if err := client.Dispatch(); err != nil {
				return CreateTakeResult{}, fmt.Errorf("could not read REAPER's response: %w", err)
			}
		case event := <-results:
			return handleCreateTakeEvent(event)
		}
	}
}

func handleCreateTakeEvent(event bridge.Event) (CreateTakeResult, error) {
	switch event.Tag {
	case "TAKE_CREATED":
		if len(event.Fields) < 4 {
			return CreateTakeResult{}, fmt.Errorf("REAPER reported a take was created but the message was incomplete")
		}
		return CreateTakeResult{TargetItemGUID: event.Fields[2], NewTakeGUID: event.Fields[3]}, nil
	case "TAKE_STALE":
		guid := ""
		if len(event.Fields) > 2 {
			guid = event.Fields[2]
		}
		return CreateTakeResult{}, fmt.Errorf("the project has changed in REAPER since this finding was found (%s no longer resolves); re-scan and try again", guid)
	default: // "ERROR"
		message := "REAPER could not create the take"
		if len(event.Fields) > 2 && event.Fields[2] != "" {
			message = event.Fields[2]
		}
		return CreateTakeResult{}, fmt.Errorf("%s", message)
	}
}

// writeCreateTakePayload writes the one-row request file narration_take_review.lua's create_take reads: target
// item GUID, candidate item GUID (may be empty), source start and end in seconds, finding id, then the source file
// last (the field most likely to contain a character the row's own separator would otherwise misparse).
func writeCreateTakePayload(sessionDir, runID string, req CreateTakeRequest) (string, error) {
	if sessionDir == "" {
		return "", fmt.Errorf("no REAPER session directory is available")
	}
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		return "", fmt.Errorf("could not create the REAPER session directory: %w", err)
	}
	row := strings.Join([]string{
		req.TargetItemGUID,
		req.CandidateItemGUID,
		strconv.FormatFloat(req.SourceRangeStart, 'f', -1, 64),
		strconv.FormatFloat(req.SourceRangeEnd, 'f', -1, 64),
		req.FindingID,
		req.SourceFile,
	}, "|")
	path := filepath.Join(sessionDir, fmt.Sprintf("create_take_%s.txt", runID))
	if err := os.WriteFile(path, []byte(row+"\n"), 0o600); err != nil {
		return "", fmt.Errorf("could not write the take-creation request: %w", err)
	}
	return path, nil
}
