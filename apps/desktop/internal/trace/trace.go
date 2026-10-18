// Package trace is the host's activity trace (docs/prds/activity-trace.prd.md): JSON lines that say how the app behaved,
// never what the narrator's content was. A record is built from an Event's registered, typed fields (fields.go) and
// nothing else, so there is no way to hand it a sentence, a name or a raw path: a path is reduced to a class, an
// extension and a salted hash, an error to a class, a text to a length bucket. The package imports neither fmt nor
// log/slog, and a test fails if it ever does.
//
// The trace is off by default. While it is off nothing reaches the disk; the last RingSize records are still kept in
// memory (never written) so an export can include what led up to a failure. A nil *Tracer accepts every call and drops
// it, like runlog.Logger and hostlog.Log.
package trace

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	// DefaultMaxBytes caps the trace file; two backups are kept, so the trace never holds more than about three times it.
	DefaultMaxBytes int64 = 10 << 20
	// DefaultRingSize is how many records the in-memory ring keeps.
	DefaultRingSize = 2000
	// RedactionVersion changes when what a path, an error or a text is reduced to changes, so an export can say which rules
	// wrote the lines in it.
	RedactionVersion = 1

	timeLayout           = "2006-01-02T15:04:05.000Z07:00"
	defaultFlushInterval = time.Second
)

// Level orders events. Debug records are written only after SetDebug(true).
type Level uint8

const (
	// LevelDebug is detail that only a diagnosis needs.
	LevelDebug Level = iota
	// LevelInfo is the normal record of what happened.
	LevelInfo
	// LevelWarn is something that went wrong and was handled.
	LevelWarn
	// LevelError is something that failed.
	LevelError
)

func (l Level) String() string {
	switch l {
	case LevelDebug:
		return "debug"
	case LevelWarn:
		return "warn"
	case LevelError:
		return "error"
	default:
		return "info"
	}
}

// reservedKeys are the envelope's own names; an event's field may not reuse one.
var reservedKeys = map[string]bool{"ts": true, "seq": true, "level": true, "sess": true, "area": true, "event": true, "run": true, "cid": true}

var (
	registryMu sync.Mutex
	registry   = map[string]*Event{}
)

// Event is one registered kind of record: where it comes from, what it is called, how loud it is and which fields it may
// carry.
type Event struct {
	area, name string
	level      Level
	fields     map[string]FieldDef
}

// Define registers an event at package initialisation. It panics on a bad or repeated name, because a registry that
// loads wrong is a build error and not something to recover from.
func Define(area, name string, level Level, fields ...FieldDef) *Event {
	if !namePattern.MatchString(area) || !namePattern.MatchString(name) {
		panic("trace: bad event name " + area + "." + name)
	}
	event := &Event{area: area, name: name, level: level, fields: map[string]FieldDef{}}
	for _, def := range fields {
		if !namePattern.MatchString(def.name) || reservedKeys[def.name] {
			panic("trace: bad field name " + def.name + " in " + area + "." + name)
		}
		if _, dup := event.fields[def.name]; dup {
			panic("trace: field " + def.name + " declared twice in " + area + "." + name)
		}
		event.fields[def.name] = def
	}
	registryMu.Lock()
	defer registryMu.Unlock()
	key := area + "." + name
	if _, dup := registry[key]; dup {
		panic("trace: event " + key + " defined twice")
	}
	registry[key] = event
	return event
}

// Options configures New. Every field has a default, so a test sets only what it checks.
type Options struct {
	// Path is the trace file. Required to write anything.
	Path string
	// MaxBytes caps the file (DefaultMaxBytes).
	MaxBytes int64
	// RingSize is the in-memory ring's length (DefaultRingSize).
	RingSize int
	// Now is the clock (time.Now), a test seam.
	Now func() time.Time
	// SessionID names this launch (random).
	SessionID string
	// Home is the user profile folder, which classes a path as user_profile (os.UserHomeDir).
	Home string
	// ProjectRoot is the open project's folder, which classes a path as project. SetProjectRoot changes it.
	ProjectRoot string
	// SaltPath is where the per-install salt lives (beside Path, trace.salt).
	SaltPath string
	// FlushInterval is how often buffered lines reach the file (one second).
	FlushInterval time.Duration
}

// Tracer writes records. It is safe for concurrent use.
type Tracer struct {
	mu          sync.Mutex
	opts        Options
	enabled     bool
	debug       bool
	seq         uint64
	dropped     int64
	ring        [][]byte
	ringNext    int
	ringFull    bool
	out         *sink
	salt        []byte
	saltSaved   bool
	home        string
	projectRoot string
	stop        chan struct{}
	done        chan struct{}
}

// New returns a disabled tracer.
func New(opts Options) *Tracer {
	if opts.MaxBytes <= 0 {
		opts.MaxBytes = DefaultMaxBytes
	}
	if opts.RingSize <= 0 {
		opts.RingSize = DefaultRingSize
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}
	if opts.SessionID == "" {
		opts.SessionID = randomHex(4)
	}
	if opts.Home == "" {
		opts.Home, _ = os.UserHomeDir()
	}
	if opts.SaltPath == "" && opts.Path != "" {
		opts.SaltPath = filepath.Join(filepath.Dir(opts.Path), "trace.salt")
	}
	if opts.FlushInterval <= 0 {
		opts.FlushInterval = defaultFlushInterval
	}
	t := &Tracer{opts: opts, ring: make([][]byte, opts.RingSize), home: normPath(opts.Home), projectRoot: normPath(opts.ProjectRoot)}
	if opts.Path != "" {
		t.out = newSink(opts.Path, opts.MaxBytes)
	}
	return t
}

// Path is the trace file, for messages that tell the narrator where to look.
func (t *Tracer) Path() string {
	if t == nil {
		return ""
	}
	return t.opts.Path
}

// SessionID is this launch's id, the `sess` on every record.
func (t *Tracer) SessionID() string {
	if t == nil {
		return ""
	}
	return t.opts.SessionID
}

// Enabled reports whether records are being written to the file.
func (t *Tracer) Enabled() bool {
	if t == nil {
		return false
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.enabled
}

// SetEnabled turns writing to the file on or off. Turning it on saves the per-install salt if it has not been saved and
// starts the flush timer; turning it off flushes and stops it. The ring keeps filling either way.
func (t *Tracer) SetEnabled(enabled bool) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if enabled == t.enabled {
		return
	}
	t.enabled = enabled
	if enabled {
		t.ensureSaltLocked()
		t.startFlusherLocked()
		return
	}
	t.stopFlusherLocked()
	if t.out != nil {
		_ = t.out.flush()
	}
}

// SetDebug turns debug-level records on or off.
func (t *Tracer) SetDebug(debug bool) {
	if t == nil {
		return
	}
	t.mu.Lock()
	t.debug = debug
	t.mu.Unlock()
}

// SetProjectRoot tells the tracer which folder is the open project, so a path inside it is classed as project.
func (t *Tracer) SetProjectRoot(root string) {
	if t == nil {
		return
	}
	t.mu.Lock()
	t.projectRoot = normPath(root)
	t.mu.Unlock()
}

// Dropped is how many fields were refused for not matching their definition (an unknown name, the wrong kind, a value
// outside the enum, an id that is not opaque). A rising count is a bug at an emit site.
func (t *Tracer) Dropped() int64 {
	if t == nil {
		return 0
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.dropped
}

// Emit writes one record: the envelope, then each value that matches the event's definition. A value that does not is
// dropped and counted, and the rest of the record is still written.
func (t *Tracer) Emit(event *Event, values ...Value) {
	if t == nil || event == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if event.level == LevelDebug && !t.debug {
		return
	}
	t.seq++
	record := map[string]any{
		"ts": t.opts.Now().UTC().Format(timeLayout), "seq": t.seq, "level": event.level.String(),
		"sess": t.opts.SessionID, "area": event.area, "event": event.name,
	}
	for _, value := range values {
		key, out, ok := t.renderLocked(event, value)
		if !ok {
			t.dropped++
			continue
		}
		record[key] = out
	}
	line, err := json.Marshal(record)
	if err != nil {
		t.dropped++
		return
	}
	t.ring[t.ringNext] = line
	t.ringNext = (t.ringNext + 1) % len(t.ring)
	if t.ringNext == 0 {
		t.ringFull = true
	}
	if t.enabled && t.out != nil {
		_ = t.out.write(append(append(make([]byte, 0, len(line)+1), line...), '\n'))
	}
}

// renderLocked checks value against its definition and turns it into what is written.
func (t *Tracer) renderLocked(event *Event, value Value) (string, any, bool) {
	def, ok := event.fields[value.name]
	if !ok || def.kind != value.kind {
		return "", nil, false
	}
	switch value.kind {
	case KindEnum:
		for _, allowed := range def.enum {
			if allowed == value.s {
				return value.name, value.s, true
			}
		}
		return "", nil, false
	case KindInt:
		return value.name, value.n, true
	case KindBool:
		return value.name, value.n == 1, true
	case KindDuration:
		return value.name + "_ms", value.n, true
	case KindID:
		if idPattern.MatchString(value.s) {
			return value.name, value.s, true
		}
		return "", nil, false
	case KindPath:
		return value.name, t.redactPathLocked(value.s), true
	case KindErr:
		return value.name, value.s, true
	case KindLen:
		return value.name + "_len", value.s, true
	}
	return "", nil, false
}

// Snapshot is the in-memory ring, oldest first. Each element is one record without its newline.
func (t *Tracer) Snapshot() [][]byte {
	if t == nil {
		return nil
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	var lines [][]byte
	if t.ringFull {
		lines = append(lines, t.ring[t.ringNext:]...)
	}
	lines = append(lines, t.ring[:t.ringNext]...)
	out := make([][]byte, 0, len(lines))
	for _, line := range lines {
		if line != nil {
			out = append(out, append([]byte(nil), line...))
		}
	}
	return out
}

// Flush writes buffered lines to the file.
func (t *Tracer) Flush() {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.out != nil {
		_ = t.out.flush()
	}
}

// Close flushes, stops the flush timer and closes the file. It is safe to call twice.
func (t *Tracer) Close() {
	if t == nil {
		return
	}
	t.mu.Lock()
	t.enabled = false
	t.stopFlusherLocked()
	if t.out != nil {
		_ = t.out.close()
	}
	t.mu.Unlock()
}

// startFlusherLocked runs a timer that flushes the buffered lines, so a crash loses about a second at most.
func (t *Tracer) startFlusherLocked() {
	if t.stop != nil || t.out == nil {
		return
	}
	stop, done := make(chan struct{}), make(chan struct{})
	t.stop, t.done = stop, done
	interval := t.opts.FlushInterval
	go func() {
		defer close(done)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				t.Flush()
			}
		}
	}()
}

func (t *Tracer) stopFlusherLocked() {
	if t.stop == nil {
		return
	}
	stop, done := t.stop, t.done
	t.stop, t.done = nil, nil
	// The flusher takes the lock in Flush, so it is released while waiting for the goroutine to leave.
	t.mu.Unlock()
	close(stop)
	<-done
	t.mu.Lock()
}

// redactPathLocked reduces a path to {class, ext, h}. Nothing of the raw path is kept.
func (t *Tracer) redactPathLocked(raw string) map[string]string {
	norm := normPath(raw)
	class := "other"
	switch {
	case strings.HasPrefix(norm, "//"):
		class = "network"
	case inside(norm, t.projectRoot):
		class = "project"
	case inside(norm, t.home):
		class = "user_profile"
	}
	last := norm[strings.LastIndex(norm, "/")+1:]
	ext := ""
	if dot := strings.LastIndex(last, "."); dot > 0 && extPattern.MatchString(last[dot:]) {
		ext = last[dot:]
	}
	t.ensureSaltLocked()
	mac := hmac.New(sha256.New, t.salt)
	mac.Write([]byte(norm))
	return map[string]string{"class": class, "ext": ext, "h": hex.EncodeToString(mac.Sum(nil)[:4])}
}

// ensureSaltLocked loads the per-install salt, or makes one. It is written to disk only once the trace is enabled, so a
// tracer that is off leaves no file; until then a new salt lives in memory.
func (t *Tracer) ensureSaltLocked() {
	if t.salt == nil && t.opts.SaltPath != "" {
		if data, err := os.ReadFile(t.opts.SaltPath); err == nil {
			if salt, err := hex.DecodeString(strings.TrimSpace(string(data))); err == nil && len(salt) >= 16 {
				t.salt, t.saltSaved = salt, true
			}
		}
	}
	if t.salt == nil {
		t.salt = make([]byte, 16)
		_, _ = rand.Read(t.salt)
	}
	if t.enabled && !t.saltSaved && t.opts.SaltPath != "" {
		if err := os.MkdirAll(filepath.Dir(t.opts.SaltPath), 0o755); err == nil {
			t.saltSaved = os.WriteFile(t.opts.SaltPath, []byte(hex.EncodeToString(t.salt)+"\n"), 0o600) == nil
		}
	}
}

// ResetSalt forgets the per-install salt, so the hashes of earlier records can no longer be matched to new ones.
func (t *Tracer) ResetSalt() {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.salt, t.saltSaved = nil, false
	if t.opts.SaltPath != "" {
		_ = os.Remove(t.opts.SaltPath)
	}
}

var multiSlash = regexp.MustCompile(`/{2,}`)

// normPath folds a path to one spelling: lower case, forward slashes, no repeated or trailing slash. A leading pair of
// slashes (a network share) is kept. It does not touch the file system, so it behaves the same on every platform.
func normPath(raw string) string {
	if raw == "" {
		return ""
	}
	norm := strings.ToLower(strings.ReplaceAll(raw, `\`, "/"))
	prefix := ""
	if strings.HasPrefix(norm, "//") {
		prefix, norm = "/", norm[1:]
	}
	norm = prefix + multiSlash.ReplaceAllString(norm, "/")
	if len(norm) > 1 {
		norm = strings.TrimRight(norm, "/")
	}
	return norm
}

func inside(norm, root string) bool {
	return root != "" && (norm == root || strings.HasPrefix(norm, root+"/"))
}

func randomHex(n int) string {
	buf := make([]byte, n)
	_, _ = rand.Read(buf)
	return hex.EncodeToString(buf)
}
