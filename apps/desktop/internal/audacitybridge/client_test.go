package audacitybridge_test

import (
	"context"
	"errors"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/audacitybridge"
	abt "github.com/countrymanprime/narration-utils/shell/internal/audacitybridge/audacitybridgetest"
)

func newClient(t *testing.T, timeout time.Duration) (*audacitybridge.Client, *abt.Server) {
	t.Helper()
	server := abt.NewServer()
	client := audacitybridge.New(server.Transport(), audacitybridge.Options{Timeout: timeout})
	t.Cleanup(func() { _ = client.Close() })
	return client, server
}

func TestPingEchoes(t *testing.T) {
	client, server := newClient(t, time.Second)
	if client.Reachable() {
		t.Fatal("reachable before any request")
	}
	if err := client.Ping(context.Background()); err != nil {
		t.Fatalf("Ping: %v", err)
	}
	if !client.Reachable() || client.LastSeen().IsZero() {
		t.Error("a complete reply must mark the client reachable")
	}
	if got := server.Log(); !reflect.DeepEqual(got, []string{`Message: Text="narration-utils ping"`}) {
		t.Errorf("sent %q", got)
	}
}

// One connection serves every request until something goes wrong.
func TestRequestsShareOneConnection(t *testing.T) {
	client, server := newClient(t, time.Second)
	for range 3 {
		if err := client.Ping(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if server.Dials() != 1 {
		t.Errorf("dials = %d, want 1", server.Dials())
	}
}

func TestFailures(t *testing.T) {
	cases := []struct {
		name    string
		setup   func(*abt.Server)
		want    error
		redials bool // the connection was dropped, so the next request dials again
	}{
		{"Audacity closed or scripting off", func(s *abt.Server) { s.SetDown(true) }, audacitybridge.ErrNotReachable, true},
		{"the command failed", func(s *abt.Server) { s.Script(abt.FaultFail) }, audacitybridge.ErrCommandFailed, false},
		{"Audacity hangs", func(s *abt.Server) { s.Script(abt.FaultHang) }, audacitybridge.ErrTimeout, true},
		{"an unknown terminator", func(s *abt.Server) { s.Script(abt.FaultGarbage) }, audacitybridge.ErrProtocol, true},
		{"no empty line after the terminator", func(s *abt.Server) { s.Script(abt.FaultNoBlankLine) }, audacitybridge.ErrProtocol, true},
		{"Audacity hangs up mid-answer", func(s *abt.Server) { s.Script(abt.FaultHangUp) }, audacitybridge.ErrProtocol, true},
		{"no project window open", func(s *abt.Server) { s.With(func(p *abt.Project) { p.NoProject = true }) }, audacitybridge.ErrNoProject, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			client, server := newClient(t, 200*time.Millisecond)
			if err := client.Ping(context.Background()); err != nil {
				t.Fatal(err)
			}
			tc.setup(server)
			err := client.Ping(context.Background())
			if !errors.Is(err, tc.want) {
				t.Fatalf("Ping = %v, want %v", err, tc.want)
			}
			// Recover and check the client is usable again, reconnecting only when the connection was in doubt.
			server.SetDown(false)
			server.With(func(p *abt.Project) { p.NoProject = false })
			if err := client.Ping(context.Background()); err != nil {
				t.Fatalf("after recovery: %v", err)
			}
			wantDials := 1
			if tc.redials {
				wantDials = 2
			}
			if server.Dials() != wantDials {
				t.Errorf("dials = %d, want %d", server.Dials(), wantDials)
			}
		})
	}
}

func TestACommandErrorCarriesAudacitysReason(t *testing.T) {
	client, _ := newClient(t, time.Second)
	err := client.SetLabel(context.Background(), 7, audacitybridge.LabelEdit{})
	var ce *audacitybridge.CommandError
	if !errors.As(err, &ce) || ce.Command != "SetLabel" || len(ce.Lines) == 0 {
		t.Fatalf("err = %#v, want a *CommandError from SetLabel with a reason", err)
	}
	if !client.Reachable() {
		t.Error("a Failed! is still a complete answer: the client stays reachable")
	}
}

func TestTimeoutMarksUnreachable(t *testing.T) {
	client, server := newClient(t, 100*time.Millisecond)
	server.Script(abt.FaultHang)
	start := time.Now()
	if err := client.Ping(context.Background()); !errors.Is(err, audacitybridge.ErrTimeout) {
		t.Fatalf("err = %v", err)
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Errorf("the timeout took %v", elapsed)
	}
	if client.Reachable() {
		t.Error("a timed-out request must mark the client unreachable")
	}
}

func TestACancelledContextSendsNothing(t *testing.T) {
	client, server := newClient(t, time.Second)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := client.Ping(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v", err)
	}
	if len(server.Log()) != 0 {
		t.Errorf("sent %q", server.Log())
	}
}

func TestAnInvalidValueSendsNothing(t *testing.T) {
	client, server := newClient(t, time.Second)
	text := `bad " text`
	err := client.SetLabel(context.Background(), 0, audacitybridge.LabelEdit{Text: &text})
	if !errors.Is(err, audacitybridge.ErrInvalidValue) {
		t.Fatalf("err = %v", err)
	}
	if len(server.Log()) != 0 || server.Dials() != 0 {
		t.Errorf("sent %q over %d dials", server.Log(), server.Dials())
	}
}

// Concurrent callers are serialised over the one pipe: every answer reaches its own caller (run with -race).
func TestConcurrentRequestsAreSerialised(t *testing.T) {
	client, server := newClient(t, 2*time.Second)
	server.With(func(p *abt.Project) { p.AddWaveTrack("Chapter 1", 0, 60) })
	var wg sync.WaitGroup
	errs := make(chan error, 40)
	for i := range 20 {
		wg.Add(2)
		go func() {
			defer wg.Done()
			errs <- client.Ping(context.Background())
		}()
		go func() {
			defer wg.Done()
			tracks, err := client.Tracks(context.Background())
			if err == nil && (len(tracks) != 1 || tracks[0].Name != "Chapter 1") {
				err = errors.New("a Tracks answer went to the wrong caller")
			}
			_ = i
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Error(err)
		}
	}
}

func TestPipeTransportOutsideWindows(t *testing.T) {
	if audacitybridge.PipeTransport() == nil {
		t.Fatal("PipeTransport is nil")
	}
}
