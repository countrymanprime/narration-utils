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

// CleanupCandidate is one silence-cleanup candidate ready to send to REAPER (integrations/reaper/
// narration_cleanup_preview.lua, diagnostics-delivery-and-cleanup-tools PRD Phase 10, ADR 0251): the item (and,
// optionally, the take - empty means the active one) cleanupmap.ForFile resolved, and the cut range in source-file-
// relative seconds, the same units measure.CleanupCandidate reports. Cut times are turned into project time inside
// REAPER, the same mapping narration_navigation.lua's own project_time already applies, so a candidate stays
// correctly placed even if the item moved since cleanupmap.ForFile last read the project.
type CleanupCandidate struct {
	ItemGUID, TakeGUID             string
	Class                          string
	CutStartSeconds, CutEndSeconds float64
	// FindingID identifies the candidate in every answer (StaleCandidate, and the take marker preview adds), so a
	// caller can match an answer back to the finding it asked about.
	FindingID string
}

// StaleCandidate is one candidate CLEANUP_STALE reported: its finding id, the GUID that failed and why ("item",
// "take" or "range" - the same vocabulary as StaleError).
type StaleCandidate struct {
	FindingID, GUID, Reason string
}

// PreviewResult is preview_cleanup_markers' answer: how many take markers were newly added, how many already existed
// (a repeat preview call never doubles a marker, ADR 0121's dedup convention), and which candidates were stale.
type PreviewResult struct {
	Added, Existing int
	Stale           []StaleCandidate
}

// ApplyResult is apply_cleanup_trims' answer: how many candidates were actually trimmed (a split at each end of the
// cut, the middle piece removed with DeleteTrackMediaItem, all in one undo block) and which were stale and so left
// untouched.
type ApplyResult struct {
	Applied int
	Stale   []StaleCandidate
}

// CleanupClient sends cleanup candidates to REAPER for preview or approval. Unlike Navigator's single-event answers,
// one call can raise any number of CLEANUP_STALE events before its one terminal summary event, so a request
// accumulates every event for its run before answering.
type CleanupClient struct {
	client *Client
	mu     sync.Mutex // guards everything below
	// +checklocks:mu
	timeout time.Duration
	// +checklocks:mu
	pending map[string]*cleanupRun
	// +checklocks:mu
	next uint64
}

type cleanupRun struct {
	// +checklocks:CleanupClient.mu
	stale []StaleCandidate
	done  chan cleanupAnswer
}

type cleanupAnswer struct {
	event Event
	stale []StaleCandidate
	err   error
}

// NewCleanupClient subscribes to the cleanup preview and apply answers on client. With a nil client every request is
// ErrUnavailable.
func NewCleanupClient(client *Client) *CleanupClient {
	c := &CleanupClient{client: client, timeout: DefaultAnswerTimeout, pending: map[string]*cleanupRun{}}
	if client != nil {
		client.Subscribe(Subscription{
			Tags:    []string{"CLEANUP_STALE", "CLEANUP_PREVIEWED", "CLEANUP_APPLIED", "ERROR"},
			Owns:    c.owns,
			Handle:  c.handle,
			Invalid: c.invalid,
		})
	}
	return c
}

// SetTimeout changes how long a request waits for its answer.
func (c *CleanupClient) SetTimeout(timeout time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.timeout = timeout
}

// Preview asks REAPER to mark every candidate's cut range (preview_cleanup_markers). Nothing here changes an item's
// content: it only adds take markers, and a repeat call over the same candidates changes nothing further.
func (c *CleanupClient) Preview(ctx context.Context, candidates []CleanupCandidate) (PreviewResult, error) {
	event, stale, err := c.send(ctx, "preview_cleanup_markers", candidates)
	if err != nil {
		return PreviewResult{}, err
	}
	return PreviewResult{Added: int(numberAt(event.Fields, 2)), Existing: int(numberAt(event.Fields, 3)), Stale: stale}, nil
}

// Apply asks REAPER to remove every candidate's cut range (apply_cleanup_trims). A candidate CLEANUP_STALE reports is
// left untouched; the source file on disk is never rendered, trimmed or deleted, so approving a mistake is undone
// like any other REAPER edit.
func (c *CleanupClient) Apply(ctx context.Context, candidates []CleanupCandidate) (ApplyResult, error) {
	event, stale, err := c.send(ctx, "apply_cleanup_trims", candidates)
	if err != nil {
		return ApplyResult{}, err
	}
	return ApplyResult{Applied: int(numberAt(event.Fields, 2)), Stale: stale}, nil
}

func (c *CleanupClient) send(ctx context.Context, command string, candidates []CleanupCandidate) (Event, []StaleCandidate, error) {
	if c.client == nil {
		return Event{}, nil, ErrUnavailable
	}
	if len(candidates) == 0 {
		return Event{}, nil, errors.New("no cleanup candidates were given")
	}
	runID, run, timeout := c.open()
	defer c.close(runID)
	path, err := c.writePayload(runID, candidates)
	if err != nil {
		return Event{}, nil, err
	}
	if _, err := c.client.Send(command, []string{runID, path}); err != nil {
		return Event{}, nil, fmt.Errorf("could not send %s to REAPER: %w", command, err)
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case got := <-run.done:
		return got.event, got.stale, got.err
	case <-timer.C:
		return Event{}, nil, ErrNoAnswer
	case <-ctx.Done():
		return Event{}, nil, ctx.Err()
	}
}

// writePayload writes one `item_guid|take_guid|class|cut_start|cut_end|finding_id` row per candidate (the payload-
// file convention lineidentity.Service.Stamp also uses), refusing a candidate with no identity rather than sending
// REAPER a row it would silently drop.
func (c *CleanupClient) writePayload(runID string, candidates []CleanupCandidate) (string, error) {
	var payload strings.Builder
	for _, candidate := range candidates {
		if candidate.ItemGUID == "" || candidate.FindingID == "" {
			return "", errors.New("every cleanup candidate needs an item and a finding id")
		}
		if !(candidate.CutEndSeconds > candidate.CutStartSeconds) {
			return "", fmt.Errorf("cleanup candidate %s has no usable cut range", candidate.FindingID)
		}
		payload.WriteString(candidate.ItemGUID)
		payload.WriteByte('|')
		payload.WriteString(candidate.TakeGUID)
		payload.WriteByte('|')
		payload.WriteString(candidate.Class)
		payload.WriteByte('|')
		payload.WriteString(formatSeconds(candidate.CutStartSeconds))
		payload.WriteByte('|')
		payload.WriteString(formatSeconds(candidate.CutEndSeconds))
		payload.WriteByte('|')
		payload.WriteString(candidate.FindingID)
		payload.WriteByte('\n')
	}
	path := filepath.Join(c.client.sessionDir, "cleanup_"+runID+".txt")
	if err := os.WriteFile(path, []byte(payload.String()), 0o600); err != nil {
		return "", fmt.Errorf("could not write the cleanup candidate list: %w", err)
	}
	return path, nil
}

func (c *CleanupClient) open() (string, *cleanupRun, time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.next++
	runID := fmt.Sprintf("cln%d-%d", time.Now().UnixNano(), c.next)
	run := &cleanupRun{done: make(chan cleanupAnswer, 1)}
	c.pending[runID] = run
	return runID, run, c.timeout
}

func (c *CleanupClient) close(runID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.pending, runID)
}

func (c *CleanupClient) owns(runID string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	_, ok := c.pending[runID]
	return ok
}

func (c *CleanupClient) handle(event Event) {
	switch event.Tag {
	case "ERROR":
		c.finish(event.RunID, cleanupAnswer{err: errorAnswer(event)})
	case "CLEANUP_STALE":
		c.appendStale(event.RunID, StaleCandidate{FindingID: event.Fields[2], GUID: event.Fields[3], Reason: event.Fields[4]})
	case "CLEANUP_PREVIEWED", "CLEANUP_APPLIED":
		c.finish(event.RunID, cleanupAnswer{event: event})
	}
}

func (c *CleanupClient) appendStale(runID string, stale StaleCandidate) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if run, ok := c.pending[runID]; ok {
		run.stale = append(run.stale, stale)
	}
}

// finish hands a run its answer, once, with the stale candidates it accumulated. An empty run ID is a session-level
// problem (an ERROR with no run) and answers every request in flight, like Navigator.settle.
func (c *CleanupClient) finish(runID string, got cleanupAnswer) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for id, run := range c.pending {
		if runID != "" && id != runID {
			continue
		}
		answer := got
		answer.stale = append([]StaleCandidate(nil), run.stale...)
		select {
		case run.done <- answer:
		default: // already answered
		}
	}
}

func (c *CleanupClient) invalid(event Event, reason error) {
	if event.RunID == "" {
		return
	}
	c.finish(event.RunID, cleanupAnswer{err: fmt.Errorf("REAPER sent an answer this app could not read (%v): import the Narration Utils script from this app's REAPER folder again", reason)})
}
