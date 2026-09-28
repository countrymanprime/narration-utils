// Package audacitybridgetest is a fake Audacity scripting pipe for tests: an in-memory server that reads command lines the way
// mod-script-pipe does, keeps a small project (tracks, labels, the selection, the transport, what was exported and opened), and
// answers with the replies the published scripting reference documents (docs/research/audacity-4-scripting-spec.md). It can also
// misbehave on purpose (Script), so the client's timeout, reconnect and strict-parser paths are exercised.
//
// It is only as faithful as the spec it replays. What the owner's verification pass finds a real Audacity doing differently is
// corrected here, with a test, the way the REAPER harness's fake is corrected (ADR 0066).
package audacitybridgetest

import (
	"bufio"
	"context"
	"io"
	"strings"
	"sync"

	"github.com/countrymanprime/narration-utils/shell/internal/audacitybridge"
)

// Fault is a scripted misbehaviour for one command.
type Fault int

const (
	// Answer normally.
	FaultNone Fault = iota
	// FaultHang reads the command and never answers (a modal dialog, a hung Audacity).
	FaultHang
	// FaultGarbage answers with an unknown terminator.
	FaultGarbage
	// FaultNoBlankLine answers with a terminator followed by text instead of the empty line.
	FaultNoBlankLine
	// FaultHangUp closes the pipe mid-answer.
	FaultHangUp
	// FaultFail answers "BatchCommand finished: Failed!" with a reason line, whatever the command.
	FaultFail
)

// Server is the fake. The zero value is not usable; call NewServer.
type Server struct {
	mu sync.Mutex
	// Project is the fake's state, read and changed under mu by the handlers.
	project *Project
	// down: Dial answers ErrNotReachable (Audacity closed, or scripting off).
	down bool
	// faults are consumed one per command, in order; an empty queue answers normally.
	faults []Fault
	// log is every command line received, in order.
	log []string
	// dials counts successful connections.
	dials int
	conns []*pipeEnd
}

// NewServer is a fake Audacity with an empty project (no tracks, nothing selected).
func NewServer() *Server { return &Server{project: NewProject()} }

// Transport dials this server.
func (s *Server) Transport() audacitybridge.Transport {
	return audacitybridge.TransportFunc(func(ctx context.Context) (audacitybridge.Conn, error) {
		s.mu.Lock()
		if s.down {
			s.mu.Unlock()
			return nil, audacitybridge.ErrNotReachable
		}
		client, server := pipePair()
		s.dials++
		s.conns = append(s.conns, server)
		s.mu.Unlock()
		go s.serve(server)
		return client, nil
	})
}

// SetDown makes the pipe disappear (true) or come back (false). Going down also hangs up every open connection.
func (s *Server) SetDown(down bool) {
	s.mu.Lock()
	s.down = down
	conns := s.conns
	if down {
		s.conns = nil
	}
	s.mu.Unlock()
	if down {
		for _, c := range conns {
			_ = c.Close()
		}
	}
}

// Script queues faults for the next commands, one each.
func (s *Server) Script(faults ...Fault) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.faults = append(s.faults, faults...)
}

// Log is every command line received so far.
func (s *Server) Log() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.log...)
}

// Dials is how many connections were opened.
func (s *Server) Dials() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.dials
}

// With runs f on the project under the server's lock, to set up or inspect state.
func (s *Server) With(f func(p *Project)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f(s.project)
}

func (s *Server) serve(conn *pipeEnd) {
	defer func() { _ = conn.Close() }()
	r := bufio.NewReader(conn)
	for {
		line, err := readCommand(r)
		if err != nil {
			return
		}
		s.mu.Lock()
		s.log = append(s.log, line)
		fault := FaultNone
		if len(s.faults) > 0 {
			fault, s.faults = s.faults[0], s.faults[1:]
		}
		var body []string
		ok := true
		noProject := s.project.NoProject
		if fault == FaultNone && !noProject {
			body, ok = s.project.handle(line)
		}
		s.mu.Unlock()
		if fault == FaultNone && noProject {
			if _, err := conn.Write([]byte("\n")); err != nil {
				return
			}
			continue
		}
		var out string
		switch fault {
		case FaultHang:
			// Keep reading nothing until the client hangs up.
			_, _ = io.Copy(io.Discard, conn)
			return
		case FaultGarbage:
			out = "BatchCommand finished: Maybe\n\n"
		case FaultNoBlankLine:
			out = "BatchCommand finished: OK\nstray\n"
		case FaultHangUp:
			_, _ = conn.Write([]byte("partial answer"))
			return
		case FaultFail:
			out = "Something went wrong.\nBatchCommand finished: Failed!\n\n"
		default:
			out = frame(body, ok)
		}
		if _, err := conn.Write([]byte(out)); err != nil {
			return
		}
	}
}

// frame writes a reply as mod-script-pipe does: the body lines, the terminator, an empty line.
func frame(body []string, ok bool) string {
	var b strings.Builder
	for _, l := range body {
		b.WriteString(l)
		b.WriteByte('\n')
	}
	if ok {
		b.WriteString("BatchCommand finished: OK\n\n")
	} else {
		b.WriteString("BatchCommand finished: Failed!\n\n")
	}
	return b.String()
}

// readCommand reads one command as the client frames it on Windows (CR LF NUL), also accepting a bare LF (Audacity's own
// Linux/macOS framing), and returns it without the line ending.
func readCommand(r *bufio.Reader) (string, error) {
	line, err := r.ReadString('\n')
	if err != nil {
		return "", err
	}
	// The NUL after the previous command's LF arrives at the start of this line (peeking for it would block until the client
	// writes again). Audacity deletes every CR and LF it reads (ScripterCallback).
	line = strings.TrimPrefix(line, "\x00")
	return strings.NewReplacer("\r", "", "\n", "").Replace(line), nil
}

// pipeEnd is one end of an in-memory, synchronous duplex pipe (two io.Pipes), standing in for the two named pipes: Close unblocks
// a Read or Write waiting on either side, as the Windows transport's Close does.
type pipeEnd struct {
	r *io.PipeReader
	w *io.PipeWriter
}

func pipePair() (client, server *pipeEnd) {
	toServerR, toServerW := io.Pipe()
	toClientR, toClientW := io.Pipe()
	return &pipeEnd{r: toClientR, w: toServerW}, &pipeEnd{r: toServerR, w: toClientW}
}

func (p *pipeEnd) Read(b []byte) (int, error)  { return p.r.Read(b) }
func (p *pipeEnd) Write(b []byte) (int, error) { return p.w.Write(b) }

func (p *pipeEnd) Close() error {
	_ = p.r.CloseWithError(io.ErrClosedPipe)
	return p.w.Close() // the peer reads io.EOF, as from a pipe the other side hung up
}
