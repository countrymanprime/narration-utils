package bridge

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Event is one decoded line of events.log. The tag is Fields[0]; by convention of every bridge event, the first
// argument (Fields[1]) is the run ID of the command that caused it, or empty when the event belongs to no run.
type Event struct {
	Tag    string
	RunID  string
	Fields []string
}

// Subscription selects the events one consumer receives and says where they go.
type Subscription struct {
	// Tags are the event tags the consumer handles: an exact name, or a prefix ending in "*" ("COMPARE_*").
	Tags []string
	// Owns reports whether the consumer owns a run ID. An event that carries a run ID reaches only consumers whose
	// tags match and whose Owns is nil or returns true; an event with an empty run ID reaches every consumer whose
	// tags match. It is called while events are dispatched, so it must not call Dispatch.
	Owns func(runID string) bool
	// Handle receives the consumer's events, in log order, on the goroutine that called Dispatch. It runs while every
	// other consumer waits, so it should be quick (hand slow work to a goroutine), and it must not call Dispatch.
	Handle func(Event)
	// Invalid, when set, receives an event of a tag this consumer handles that failed the table in wire.go (too few fields, or a number
	// that is not a number), with the reason. The event is never given to Handle. It is called like Handle, and only for a run the
	// consumer owns, so it can tell the narrator that REAPER's script and this app disagree (ADR 0069).
	Invalid func(Event, error)
}

type subscriber struct {
	id  uint64
	sub Subscription
}

// events is the fan-out half of Client: one cursor over events.log and the consumers it feeds. Before it existed
// every consumer read the log through the same cursor, so a second consumer stole the first one's events.
type events struct {
	dispatchMu  sync.Mutex // one Dispatch at a time, so delivery order is log order
	mu          sync.Mutex // guards everything below
	eventOffset int64
	nextID      uint64
	subscribers []subscriber
	undelivered int
	malformed   int
	invalid     int
	report      func(kind, message string)
}

// Subscribe registers a consumer and returns the function that removes it. Events already read are not replayed. An
// unsubscribe that races a Dispatch already delivering may still see that one dispatch's remaining events.
func (c *Client) Subscribe(sub Subscription) (unsubscribe func()) {
	c.events.mu.Lock()
	defer c.events.mu.Unlock()
	c.events.nextID++
	id := c.events.nextID
	c.events.subscribers = append(c.events.subscribers, subscriber{id: id, sub: sub})
	return func() {
		c.events.mu.Lock()
		defer c.events.mu.Unlock()
		for index, existing := range c.events.subscribers {
			if existing.id == id {
				c.events.subscribers = append(c.events.subscribers[:index:index], c.events.subscribers[index+1:]...)
				return
			}
		}
	}
}

// Dispatch reads the events appended to events.log since the last call and delivers each to the consumers it
// belongs to. Only whole lines are consumed: a line REAPER is still writing waits for the next call. It is safe to
// call from several goroutines; calls are serialised, so every consumer sees the log in order and once.
func (c *Client) Dispatch() error {
	c.events.dispatchMu.Lock()
	defer c.events.dispatchMu.Unlock()
	lines, err := c.newEventLines()
	if err != nil {
		return err
	}
	for _, line := range lines {
		fields, err := DecodeFields(line)
		if err != nil || len(fields) == 0 || fields[0] == "" {
			c.countMalformed()
			continue
		}
		event := newEvent(fields)
		if checkErr := CheckEvent(fields); checkErr != nil {
			c.reportInvalid(event, checkErr)
			continue
		}
		c.deliver(event)
	}
	return nil
}

// Invalid is how many events failed the table in wire.go and were reported instead of delivered. It only grows.
func (c *Client) Invalid() int {
	c.events.mu.Lock()
	defer c.events.mu.Unlock()
	return c.events.invalid
}

// SetLog says where to write a line for an event that failed its table (the host log). It is optional.
func (c *Client) SetLog(report func(kind, message string)) {
	c.events.mu.Lock()
	defer c.events.mu.Unlock()
	c.events.report = report
}

// reportInvalid counts and logs an event that failed its table, and tells each consumer that handles its tag and owns its run. The
// log line names the tag and the reason (never a field value, since a field can hold the narrator's words).
func (c *Client) reportInvalid(event Event, reason error) {
	c.events.mu.Lock()
	c.events.invalid++
	count := c.events.invalid
	report := c.events.report
	snapshot := append([]subscriber(nil), c.events.subscribers...)
	c.events.mu.Unlock()
	// The first few are logged, then one in a hundred: a script that keeps sending a bad line must not fill the log.
	if report != nil && (count <= 3 || count%100 == 0) {
		report("reaper_event_invalid", fmt.Sprintf("the REAPER script sent an event this app could not read (%d so far): %s", count, reason.Error()))
	}
	for _, existing := range snapshot {
		if existing.sub.Invalid != nil && existing.sub.wants(event) {
			existing.sub.Invalid(event, reason)
		}
	}
}

// Undelivered is how many events reached no consumer (no matching tag, or a run ID nobody owns). An event a consumer
// received and then ignored counts as delivered. Malformed is how many lines could not be decoded. Both only grow.
func (c *Client) Undelivered() int {
	c.events.mu.Lock()
	defer c.events.mu.Unlock()
	return c.events.undelivered
}

func (c *Client) Malformed() int {
	c.events.mu.Lock()
	defer c.events.mu.Unlock()
	return c.events.malformed
}

func (c *Client) countMalformed() {
	c.events.mu.Lock()
	c.events.malformed++
	c.events.mu.Unlock()
}

func newEvent(fields []string) Event {
	event := Event{Tag: fields[0], Fields: fields}
	if len(fields) > 1 {
		event.RunID = fields[1]
	}
	return event
}

func (c *Client) deliver(event Event) {
	c.events.mu.Lock()
	snapshot := append([]subscriber(nil), c.events.subscribers...)
	c.events.mu.Unlock()
	delivered := false
	for _, existing := range snapshot {
		if !existing.sub.wants(event) {
			continue
		}
		delivered = true
		existing.sub.Handle(event)
	}
	if !delivered {
		c.events.mu.Lock()
		c.events.undelivered++
		c.events.mu.Unlock()
	}
}

func (s Subscription) wants(event Event) bool {
	matched := false
	for _, tag := range s.Tags {
		if prefix, isPrefix := strings.CutSuffix(tag, "*"); (isPrefix && strings.HasPrefix(event.Tag, prefix)) || tag == event.Tag {
			matched = true
			break
		}
	}
	if !matched || s.Handle == nil {
		return false
	}
	return event.RunID == "" || s.Owns == nil || s.Owns(event.RunID)
}

// newEventLines returns the complete lines appended since the last call and advances the cursor past them.
func (c *Client) newEventLines() ([]string, error) {
	content, err := os.ReadFile(filepath.Join(c.sessionDir, "events.log"))
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	c.events.mu.Lock()
	defer c.events.mu.Unlock()
	offset := c.events.eventOffset
	if offset < 0 || offset > int64(len(content)) {
		// The log is shorter than what was already read, so it was replaced: read the new one from its start.
		offset = 0
	}
	end := strings.LastIndexByte(string(content[offset:]), '\n')
	if end < 0 {
		c.events.eventOffset = offset
		return nil, nil
	}
	consumed := offset + int64(end) + 1
	c.events.eventOffset = consumed
	var lines []string
	for _, line := range strings.Split(string(content[offset:consumed]), "\n") {
		if line = strings.TrimSuffix(line, "\r"); line != "" {
			lines = append(lines, line)
		}
	}
	return lines, nil
}
