package runlog

import (
	"context"
	"log/slog"
	"regexp"
	"strings"
)

// maxEventMessage bounds one event message: a log line is a trace, not a transcript.
const maxEventMessage = 240

// App is the run that spans this process: the UI's calls, toasts and navigation and the host's connection changes are events of
// it, so one app session reads as one `run` id in the log. It starts on first use and is never ended; a nil Logger returns nil.
func (l *Logger) App() *Run {
	if l == nil {
		return nil
	}
	l.appOnce.Do(func() { l.app = l.Begin("app") })
	return l.app
}

// Event writes one record of this run at level: an event name (`ui.call`, `daw.state`, ...) and a message the caller has already
// kept free of content (ids, counts, outcomes, error classes), plus attrs. The message is scrubbed of file paths and cut to a
// fixed length here as well, so a caller that forgets cannot put a path in the log. A no-op on a nil Run.
func (r *Run) Event(level slog.Level, event, msg string, attrs ...any) {
	if r == nil {
		return
	}
	r.logger.LogAttrs(context.Background(), level, Scrub(msg), asAttrs(append([]any{"event", event}, attrs...))...)
}

var (
	windowsPath = regexp.MustCompile(`(?i)(?:\b[a-z]:[\\/]|\\\\)[^\s"'<>|]*`)
	unixPath    = regexp.MustCompile(`(?:^|[\s"'(=])(/(?:[^\s"'<>|/]+/)+[^\s"'<>|/]*)`)
)

// Scrub replaces every file path in s with "<path>" (a Windows drive or UNC path, or an absolute Unix path of two or more parts)
// and cuts the result to a fixed length, so an error message that embeds a location, which holds the user's name and the book's
// title, is safe to log.
func Scrub(s string) string {
	s = windowsPath.ReplaceAllString(s, "<path>")
	s = unixPath.ReplaceAllStringFunc(s, func(match string) string {
		trimmed := strings.TrimLeft(match, " \t\"'(=")
		return strings.Replace(match, trimmed, "<path>", 1)
	})
	if len(s) > maxEventMessage {
		s = s[:maxEventMessage] + "…"
	}
	return s
}
