// Package audacitybridge drives Audacity over its scripting pipe, mod-script-pipe (audacity-integration PRD Phase 4, ADR 0355).
//
// The protocol is the one Audacity publishes (docs/research/audacity-4-scripting-spec.md): the client writes one command line to
// the pipe Audacity reads (ToSrvPipe) and reads Audacity's answer from the pipe it writes (FromSrvPipe). An answer is any number of
// lines, then a terminator line ("BatchCommand finished: OK" or "BatchCommand finished: Failed!"), then an empty line. Nothing in
// this package runs a shell or starts a program: the only thing it does is exchange those lines with a pipe on this machine.
//
// Every value the host puts into a command (label text, a path, a number) goes through Command's encoder, which quotes strings and
// refuses a value the documented syntax cannot carry (a double quote, a line break, a control character) instead of letting it
// change the command. The client is built from, and tested against, the published spec and a fake pipe server (audacitybridgetest);
// what only a real Audacity can prove is the owner's verification pass (docs/operations/audacity-verification-pass.md).
package audacitybridge

import (
	"context"
	"io"
)

// Conn is one open connection to Audacity's two pipes. Write sends bytes to the pipe Audacity reads; Read receives bytes from the
// pipe it writes. Close releases both and must unblock a Read that is waiting, so a timed-out request never leaves a reader hung.
type Conn interface {
	io.Reader
	io.Writer
	Close() error
}

// Transport opens connections. On Windows it is the named-pipe transport (PipeTransport); tests use a fake server's transport. A
// Dial that finds no pipe (Audacity closed, or scripting not enabled) returns an error that errors.Is ErrNotReachable.
type Transport interface {
	Dial(ctx context.Context) (Conn, error)
}

// TransportFunc adapts a function to Transport.
type TransportFunc func(ctx context.Context) (Conn, error)

func (f TransportFunc) Dial(ctx context.Context) (Conn, error) { return f(ctx) }

// Sentence is an error whose text is a whole sentence for the narrator, which is why it is a type rather than an errors.New
// lower-case fragment (as dawport/audacity's NotAvailableError). A Sentence constant is comparable, so errors.Is matches it through
// any wrapping.
type Sentence string

func (s Sentence) Error() string { return string(s) }

// The sentinel errors every failure is one of, so a caller can word it for the narrator without parsing text.
const (
	// ErrNotReachable: there is no scripting pipe to open. Audacity is closed, or mod-script-pipe is not enabled in
	// Preferences > Modules (and Audacity restarted), or this Audacity has no scripting pipe at all (Audacity 4.0, ADR 0355).
	ErrNotReachable = Sentence("Audacity is not reachable: open Audacity and enable mod-script-pipe in Preferences > Modules, then restart Audacity")
	// ErrTimeout: Audacity took the command but did not finish answering in time (it is busy, showing a dialog, or hung).
	ErrTimeout = Sentence("Audacity did not answer in time: check that Audacity is not showing a dialog, then try again")
	// ErrProtocol: Audacity's answer did not follow the documented framing. The connection is dropped and the next request
	// reconnects.
	ErrProtocol = Sentence("Audacity's answer was not in the expected form")
	// ErrNoProject: Audacity answered with a bare empty line and no terminator, which is what it does when no project window is
	// open (the spec note, "Concurrency"; audacity/audacity#11471). Nothing was done. The connection stays usable.
	ErrNoProject = Sentence("Audacity has no project open: open the chapter's project in Audacity, then try again")
	// ErrCommandFailed is what every *CommandError is: Audacity ran the command and reported "BatchCommand finished: Failed!".
	ErrCommandFailed = Sentence("Audacity could not do that")
	// ErrInvalidValue: a value cannot be put into a command safely (a double quote, a line break or a control character in a
	// string, a number that is not finite, an empty or malformed name). Nothing was sent.
	ErrInvalidValue = Sentence("that value cannot be sent to Audacity")
	// ErrUnsupportedPlatform: this build has no pipe transport (the app is Windows-only, D74).
	ErrUnsupportedPlatform = Sentence("Audacity scripting is only supported on Windows")
)
