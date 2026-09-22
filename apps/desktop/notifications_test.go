package main

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/hostlog"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

// fakeNotificationSender is the seam over the Wails notification API, so these tests never touch the real OS registry
// or notification center.
type fakeNotificationSender struct {
	initCalls int
	initErr   error
	sendCalls []string
	sendErr   error
}

func (f *fakeNotificationSender) Initialize() error {
	f.initCalls++
	return f.initErr
}

func (f *fakeNotificationSender) Send(title, body string) error {
	f.sendCalls = append(f.sendCalls, fmt.Sprintf("%s|%s", title, body))
	return f.sendErr
}

// newTestHostForNotify gives Store both a repo and a project temp dir (never the real machine-global settings file:
// Store.Save("global", ...) always writes %APPDATA%/narration-utils/global-settings.json, a real per-user file, so a
// test that wants notifications off saves at "project" scope instead, which Effective still finds ahead of the
// fallback).
func newTestHostForNotify(t *testing.T, sender *fakeNotificationSender) *Host {
	t.Helper()
	return &Host{
		ctx:          context.Background(),
		settings:     settings.New(t.TempDir(), t.TempDir()),
		log:          hostlog.New(filepath.Join(t.TempDir(), "host.log"), 0),
		notifySender: sender,
	}
}

func TestSystemNotifySendsOnceEnabledAndLazilyInitializes(t *testing.T) {
	sender := &fakeNotificationSender{}
	host := newTestHostForNotify(t, sender)

	if _, err := host.SystemNotify("story_bible", "Story Bible rebuilt", "12 entities"); err != nil {
		t.Fatalf("SystemNotify: %v", err)
	}

	if sender.initCalls != 1 {
		t.Fatalf("Initialize called %d times, want 1", sender.initCalls)
	}
	if len(sender.sendCalls) != 1 || sender.sendCalls[0] != "Story Bible rebuilt|12 entities" {
		t.Fatalf("Send calls = %v", sender.sendCalls)
	}

	if _, err := host.SystemNotify("story_bible", "Second", "call"); err != nil {
		t.Fatalf("SystemNotify: %v", err)
	}
	if sender.initCalls != 1 {
		t.Fatalf("Initialize called %d times on a second send, want 1 (lazy, once)", sender.initCalls)
	}
	if len(sender.sendCalls) != 2 {
		t.Fatalf("Send calls = %v, want 2", sender.sendCalls)
	}
}

func TestSystemNotifyDoesNothingWhenDisabled(t *testing.T) {
	sender := &fakeNotificationSender{}
	host := newTestHostForNotify(t, sender)
	if err := host.settings.Save("General", "project", map[string]*string{"notifications": strPtr("false")}); err != nil {
		t.Fatalf("Save: %v", err)
	}

	if _, err := host.SystemNotify("story_bible", "Story Bible rebuilt", "12 entities"); err != nil {
		t.Fatalf("SystemNotify: %v", err)
	}

	if sender.initCalls != 0 {
		t.Fatalf("Initialize called %d times while disabled, want 0 (no registry write, N2)", sender.initCalls)
	}
	if len(sender.sendCalls) != 0 {
		t.Fatalf("Send calls = %v, want none while disabled", sender.sendCalls)
	}
}

func TestSystemNotifySwallowsSenderErrors(t *testing.T) {
	sender := &fakeNotificationSender{initErr: fmt.Errorf("registry unavailable"), sendErr: fmt.Errorf("toast rejected")}
	host := newTestHostForNotify(t, sender)

	_, err := host.SystemNotify("story_bible", "Story Bible rebuilt", "12 entities")
	if err != nil {
		t.Fatalf("SystemNotify must never surface a sender error, got %v", err)
	}
}

func strPtr(s string) *string { return &s }
