package teleprompter

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/process"
)

// runFakeDeviceLister stands in for the sidecar's `--list-devices` mode. It is checked before runFakeSidecar's normal
// "echo the args, then stream events" behavior because `--list-devices` prints exactly one JSON line and exits - it
// must never be preceded by the args-echo line the streaming tests rely on, or Devices()'s json.Unmarshal would see
// two lines and fail every case, not just the ones meant to exercise a failure.
func runFakeDeviceLister(mode string) bool {
	if len(os.Args) < 2 || os.Args[1] != "--list-devices" {
		return false
	}
	switch mode {
	case "list-devices-reported-error":
		fmt.Println(`{"type":"devices","devices":[],"error":"Could not list input devices: no dshow backend"}`)
	case "list-devices-crash":
		fmt.Fprintln(os.Stderr, "loading dshow")
		fmt.Fprintln(os.Stderr, "Traceback: the dshow module is missing")
		os.Exit(3)
	case "list-devices-garbage":
		fmt.Println("not json at all")
	case "list-devices-hang":
		time.Sleep(time.Minute)
	default:
		fmt.Println(`{"type":"devices","devices":[{"name":"Microphone Array (Realtek(R) Audio)"},{"name":"Analogue 1 + 2 (Focusrite USB Audio)"}],"error":null}`)
	}
	return true
}

func newDevicesFixture(t *testing.T, mode string) *Service {
	t.Helper()
	t.Setenv(fakeSidecarEnv, mode)
	supervisor := process.NewSupervisor()
	t.Cleanup(func() { _ = supervisor.Close() })
	return New(Config{Project: t.TempDir(), SessionDir: t.TempDir(), Python: os.Args[0]}, supervisor, nil, nil)
}

func TestDevicesReturnsEveryDeviceTheSidecarListedByName(t *testing.T) {
	service := newDevicesFixture(t, "list-devices-ok")

	devices, message, err := service.Devices(context.Background())

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if message != "" {
		t.Fatalf("message = %q, want empty", message)
	}
	want := []Device{{Name: "Microphone Array (Realtek(R) Audio)"}, {Name: "Analogue 1 + 2 (Focusrite USB Audio)"}}
	if len(devices) != len(want) || devices[0] != want[0] || devices[1] != want[1] {
		t.Fatalf("devices = %+v, want %+v", devices, want)
	}
}

func TestDevicesReturnsTheSidecarsOwnErrorFieldAsTheMessageNotAGoError(t *testing.T) {
	service := newDevicesFixture(t, "list-devices-reported-error")

	devices, message, err := service.Devices(context.Background())

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(devices) != 0 {
		t.Fatalf("devices = %+v, want none", devices)
	}
	if message != "Could not list input devices: no dshow backend" {
		t.Fatalf("message = %q", message)
	}
}

// A listing must never fail loudly (block Start): a bad exit code becomes a message, not a returned error.
func TestDevicesTurnsACrashedSidecarIntoAMessageInsteadOfFailing(t *testing.T) {
	service := newDevicesFixture(t, "list-devices-crash")

	devices, message, err := service.Devices(context.Background())

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(devices) != 0 {
		t.Fatalf("devices = %+v, want none", devices)
	}
	if message != "Traceback: the dshow module is missing" {
		t.Fatalf("message = %q", message)
	}
}

func TestDevicesTurnsUnreadableOutputIntoAMessageInsteadOfFailing(t *testing.T) {
	service := newDevicesFixture(t, "list-devices-garbage")

	devices, message, err := service.Devices(context.Background())

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(devices) != 0 {
		t.Fatalf("devices = %+v, want none", devices)
	}
	if message == "" {
		t.Fatal("expected a message explaining the unreadable output")
	}
}

// The binding passes a caller-owned deadline (apps/desktop/bindings.go's teleprompterDevicesTimeout) precisely so a
// hung or slow listing cannot block Start; this proves a short deadline is actually honored, not just accepted.
func TestDevicesRespectsTheCallersDeadlineInsteadOfHanging(t *testing.T) {
	service := newDevicesFixture(t, "list-devices-hang")
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	started := time.Now()
	devices, message, err := service.Devices(ctx)
	elapsed := time.Since(started)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(devices) != 0 {
		t.Fatalf("devices = %+v, want none", devices)
	}
	if message == "" {
		t.Fatal("expected a message explaining the timeout")
	}
	if elapsed > 10*time.Second {
		t.Fatalf("Devices took %s, the deadline should have cut it off almost immediately", elapsed)
	}
}

func TestDevicesFailsWithAGoErrorOnlyWhenTheServiceIsNotConfigured(t *testing.T) {
	service := New(Config{}, process.NewSupervisor(), nil, nil)

	devices, message, err := service.Devices(context.Background())

	if err == nil {
		t.Fatal("expected an error for an unconfigured service")
	}
	if devices != nil || message != "" {
		t.Fatalf("devices = %+v, message = %q, want both zero on error", devices, message)
	}
}
