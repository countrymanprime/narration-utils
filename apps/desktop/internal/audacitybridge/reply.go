package audacitybridge

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"strings"
)

// The reply terminator lines (docs/research/audacity-4-scripting-spec.md, "Reply framing"). Each is followed by one empty line.
const (
	terminatorPrefix = "BatchCommand finished: "
	terminatorOK     = terminatorPrefix + "OK"
	terminatorFailed = terminatorPrefix + "Failed!"
)

// Limits on one reply, so a runaway or hostile answer cannot grow memory without bound.
const (
	maxReplyLineBytes = 1 << 20 // one GetInfo JSON line for a long project fits easily
	maxReplyBytes     = 8 << 20
)

// Reply is one command's answer: the lines Audacity wrote before the terminator, without their line endings.
type Reply struct {
	Lines []string
}

// Text is the body joined with "\n".
func (r Reply) Text() string { return strings.Join(r.Lines, "\n") }

// CommandError is a command Audacity ran and reported as failed. Lines is what it wrote before "BatchCommand finished: Failed!"
// (often a sentence saying why).
type CommandError struct {
	Command string
	Lines   []string
}

func (e *CommandError) Error() string {
	detail := strings.TrimSpace(strings.Join(e.Lines, " "))
	if detail == "" {
		return fmt.Sprintf("Audacity could not run %s", e.Command)
	}
	return fmt.Sprintf("Audacity could not run %s: %s", e.Command, detail)
}

func (e *CommandError) Is(target error) bool { return target == ErrCommandFailed }

// ProtocolError is an answer that broke the framing: Detail says how.
type ProtocolError struct{ Detail string }

func (e *ProtocolError) Error() string { return ErrProtocol.Error() + ": " + e.Detail }
func (e *ProtocolError) Is(target error) bool {
	return target == ErrProtocol
}

// readReply reads one framed reply from r. It is strict: a terminator must be exactly one of the two documented lines and must be
// followed by an empty line; any other "BatchCommand finished:" line, a line past maxReplyLineBytes, a reply past maxReplyBytes,
// a NUL byte, or the stream ending before the empty line is a *ProtocolError. The returned bool is whether Audacity reported OK.
// A line ending may be "\n" or "\r\n". An empty first line is ErrNoProject: a real answer never starts with one.
func readReply(r *bufio.Reader) (Reply, bool, error) {
	var lines []string
	total := 0
	for {
		line, err := readLine(r)
		if err != nil {
			if errors.Is(err, io.EOF) {
				return Reply{}, false, &ProtocolError{"the pipe closed before the answer ended"}
			}
			return Reply{}, false, err
		}
		total += len(line) + 1
		if total > maxReplyBytes {
			return Reply{}, false, &ProtocolError{fmt.Sprintf("the answer is longer than %d bytes", maxReplyBytes)}
		}
		if strings.ContainsRune(line, 0) {
			return Reply{}, false, &ProtocolError{"the answer contains a NUL byte"}
		}
		if line == "" && len(lines) == 0 {
			// Audacity's whole answer when no project window is open: an empty line and nothing after it.
			return Reply{}, false, ErrNoProject
		}
		if strings.HasPrefix(line, terminatorPrefix) {
			var ok bool
			switch line {
			case terminatorOK:
				ok = true
			case terminatorFailed:
				ok = false
			default:
				return Reply{}, false, &ProtocolError{fmt.Sprintf("unknown terminator %q", line)}
			}
			blank, err := readLine(r)
			if err != nil {
				if errors.Is(err, io.EOF) {
					return Reply{}, false, &ProtocolError{"the pipe closed before the empty line after the terminator"}
				}
				return Reply{}, false, err
			}
			if blank != "" {
				return Reply{}, false, &ProtocolError{fmt.Sprintf("expected an empty line after the terminator, got %q", blank)}
			}
			return Reply{Lines: lines}, ok, nil
		}
		lines = append(lines, line)
	}
}

// readLine reads one line without its "\n" or "\r\n", refusing one longer than maxReplyLineBytes.
func readLine(r *bufio.Reader) (string, error) {
	var b []byte
	for {
		chunk, err := r.ReadSlice('\n')
		b = append(b, chunk...)
		if len(b) > maxReplyLineBytes+2 {
			return "", &ProtocolError{fmt.Sprintf("a line is longer than %d bytes", maxReplyLineBytes)}
		}
		if err == nil {
			break
		}
		if errors.Is(err, bufio.ErrBufferFull) {
			continue
		}
		if errors.Is(err, io.EOF) && len(b) > 0 {
			return "", &ProtocolError{"the pipe closed in the middle of a line"}
		}
		return "", err
	}
	line := strings.TrimSuffix(string(b), "\n")
	return strings.TrimSuffix(line, "\r"), nil
}
