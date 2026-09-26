package bridge

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// GainCandidate is one item to change the volume of, by a dB delta a caller already decided
// (apps/desktop/internal/levelnormalize.GainDeltaDB; diagnostics-delivery-and-cleanup-tools PRD Phase 11's
// level-normalize half, ADR 0252). Unlike a cleanup candidate, a gain change touches the whole item: there is no
// take or cut range.
type GainCandidate struct {
	ItemGUID  string
	DeltaDB   float64
	FindingID string
}

// StaleGainCandidate is one candidate GAIN_STALE reported: its finding id, the item GUID that failed, and why -
// always "item", since a whole-item gain change has no take or range to be stale about.
type StaleGainCandidate struct {
	FindingID, GUID, Reason string
}

// GainChange is one item apply_item_gain actually changed: its volume before and after, linear (REAPER's D_VOL
// unit), so a before/after report needs no second measurement pass.
type GainChange struct {
	ItemGUID                  string
	BeforeVolume, AfterVolume float64
}

// ApplyGainResult is apply_item_gain's answer.
type ApplyGainResult struct {
	Changed []GainChange
	Stale   []StaleGainCandidate
}

// LevelMatchClient sends gain changes to REAPER (integrations/reaper/narration_level_normalize.lua). Like
// CleanupClient, one call can raise any number of GAIN_STALE and GAIN_ITEM events before its one terminal summary
// event, so a request accumulates every event for its run before answering.
type LevelMatchClient struct {
	client *Client
	mu     sync.Mutex // guards everything below
	// +checklocks:mu
	timeout time.Duration
	// +checklocks:mu
	pending map[string]*levelMatchRun
	// +checklocks:mu
	next uint64
}

type levelMatchRun struct {
	// guarded by LevelMatchClient.mu (checklocks cannot name another type's lock)
	stale []StaleGainCandidate
	// guarded by LevelMatchClient.mu (checklocks cannot name another type's lock)
	changed []GainChange
	done    chan levelMatchAnswer
}

type levelMatchAnswer struct {
	stale   []StaleGainCandidate
	changed []GainChange
	err     error
}

// NewLevelMatchClient subscribes to the gain-change answers on client. With a nil client every request is
// ErrUnavailable.
func NewLevelMatchClient(client *Client) *LevelMatchClient {
	c := &LevelMatchClient{client: client, timeout: DefaultAnswerTimeout, pending: map[string]*levelMatchRun{}}
	if client != nil {
		client.Subscribe(Subscription{
			Tags:    []string{"GAIN_STALE", "GAIN_ITEM", "GAIN_APPLIED", "ERROR"},
			Owns:    c.owns,
			Handle:  c.handle,
			Invalid: c.invalid,
		})
	}
	return c
}

// SetTimeout changes how long a request waits for its answer.
func (c *LevelMatchClient) SetTimeout(timeout time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.timeout = timeout
}

// Apply asks REAPER to change every candidate's item volume by its own dB delta (apply_item_gain), in one undo
// block. A candidate GAIN_STALE reports is left untouched.
func (c *LevelMatchClient) Apply(ctx context.Context, candidates []GainCandidate) (ApplyGainResult, error) {
	if c.client == nil {
		return ApplyGainResult{}, ErrUnavailable
	}
	if len(candidates) == 0 {
		return ApplyGainResult{}, errors.New("no gain candidates were given")
	}
	runID, run, timeout := c.open()
	defer c.close(runID)
	path, err := c.writePayload(runID, candidates)
	if err != nil {
		return ApplyGainResult{}, err
	}
	if _, err := c.client.Send("apply_item_gain", []string{runID, path}); err != nil {
		return ApplyGainResult{}, fmt.Errorf("could not send apply_item_gain to REAPER: %w", err)
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case got := <-run.done:
		if got.err != nil {
			return ApplyGainResult{}, got.err
		}
		return ApplyGainResult{Changed: got.changed, Stale: got.stale}, nil
	case <-timer.C:
		return ApplyGainResult{}, ErrNoAnswer
	case <-ctx.Done():
		return ApplyGainResult{}, ctx.Err()
	}
}

// writePayload writes one `item_guid|delta_db|finding_id` row per candidate, refusing a candidate with no identity
// rather than sending REAPER a row it would silently drop.
func (c *LevelMatchClient) writePayload(runID string, candidates []GainCandidate) (string, error) {
	var payload strings.Builder
	for _, candidate := range candidates {
		if candidate.ItemGUID == "" || candidate.FindingID == "" {
			return "", errors.New("every gain candidate needs an item and a finding id")
		}
		payload.WriteString(candidate.ItemGUID)
		payload.WriteByte('|')
		payload.WriteString(formatSeconds(candidate.DeltaDB))
		payload.WriteByte('|')
		payload.WriteString(candidate.FindingID)
		payload.WriteByte('\n')
	}
	path := filepath.Join(c.client.sessionDir, "gain_"+runID+".txt")
	if err := os.WriteFile(path, []byte(payload.String()), 0o600); err != nil {
		return "", fmt.Errorf("could not write the gain candidate list: %w", err)
	}
	return path, nil
}

func (c *LevelMatchClient) open() (string, *levelMatchRun, time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.next++
	runID := fmt.Sprintf("gan%d-%d", time.Now().UnixNano(), c.next)
	run := &levelMatchRun{done: make(chan levelMatchAnswer, 1)}
	c.pending[runID] = run
	return runID, run, c.timeout
}

func (c *LevelMatchClient) close(runID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.pending, runID)
}

func (c *LevelMatchClient) owns(runID string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	_, ok := c.pending[runID]
	return ok
}

func (c *LevelMatchClient) handle(event Event) {
	switch event.Tag {
	case "ERROR":
		c.finish(event.RunID, levelMatchAnswer{err: errorAnswer(event)})
	case "GAIN_STALE":
		c.appendStale(event.RunID, StaleGainCandidate{FindingID: event.Fields[2], GUID: event.Fields[3], Reason: event.Fields[4]})
	case "GAIN_ITEM":
		c.appendChanged(event.RunID, GainChange{ItemGUID: event.Fields[2], BeforeVolume: numberAt(event.Fields, 3), AfterVolume: numberAt(event.Fields, 4)})
	case "GAIN_APPLIED":
		c.finish(event.RunID, levelMatchAnswer{})
	}
}

func (c *LevelMatchClient) appendStale(runID string, stale StaleGainCandidate) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if run, ok := c.pending[runID]; ok {
		run.stale = append(run.stale, stale)
	}
}

func (c *LevelMatchClient) appendChanged(runID string, change GainChange) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if run, ok := c.pending[runID]; ok {
		run.changed = append(run.changed, change)
	}
}

// finish hands a run its answer, once, with the stale and changed candidates it accumulated. An empty run ID is a
// session-level problem (an ERROR with no run) and answers every request in flight, like Navigator.settle.
func (c *LevelMatchClient) finish(runID string, got levelMatchAnswer) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for id, run := range c.pending {
		if runID != "" && id != runID {
			continue
		}
		answer := got
		answer.stale = append([]StaleGainCandidate(nil), run.stale...)
		answer.changed = append([]GainChange(nil), run.changed...)
		select {
		case run.done <- answer:
		default: // already answered
		}
	}
}

func (c *LevelMatchClient) invalid(event Event, reason error) {
	if event.RunID == "" {
		return
	}
	c.finish(event.RunID, levelMatchAnswer{err: fmt.Errorf("REAPER sent an answer this app could not read (%v): import the Narration Utils script from this app's REAPER folder again", reason)})
}
