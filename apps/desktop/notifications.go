package main

import (
	"context"
	"fmt"
	"sync/atomic"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

// notificationSender is the seam over the Wails notification API (ADR 0090), so tests substitute a fake instead of
// touching the OS notification center or, on Windows, writing the per-user registry key InitializeNotifications needs.
type notificationSender interface {
	Initialize() error
	Send(title, body string) error
}

// realNotificationSender is the production notificationSender: Wails v3's notification service. It is started here, by hand, and
// never registered with application.Options.Services, because a registered service's methods become bindings the page can call
// (docs/adr/0200): the page asks for a notification only through SystemNotify, which checks the setting first.
type realNotificationSender struct {
	ctx     context.Context
	service *notifications.NotificationService
}

// notifications.New returns the one service of the process, so a sender per call shares its state.
func newRealNotificationSender(ctx context.Context) realNotificationSender {
	return realNotificationSender{ctx: ctx, service: notifications.New()}
}

// notificationCount numbers the notifications of this run; Wails v3 requires an id on each.
var notificationCount atomic.Uint64

func nextNotificationID() uint64 { return notificationCount.Add(1) }

func (s realNotificationSender) Initialize() error {
	return s.service.ServiceStartup(s.ctx, application.ServiceOptions{})
}

// Send gives each notification its own id: Wails v3 replaces a shown notification that has the same id.
func (s realNotificationSender) Send(title, body string) error {
	return s.service.SendNotification(notifications.NotificationOptions{ID: fmt.Sprintf("narration-utils-%d", nextNotificationID()), Title: title, Body: body})
}

// SystemNotify raises one OS notification when General.notifications is on (N1-N4). It never surfaces an error to the
// caller: a notification is a courtesy, never load-bearing, so a failed or unavailable sender is logged and swallowed
// (docs/architecture/notifications.md). Which job qualifies (the window must be unfocused and the job must have taken
// about 10s or more) is decided in the webview, which is the only side that knows whether the window has focus
// (N1: this is still so on Wails v3, whose window focus is not asked for here).
//
// The Wails notification service is initialized lazily, on the first call that reaches here with the setting on, so a
// narrator who has notifications off never gets the per-user registry key Windows notifications need (N2).
func (h *Host) SystemNotify(kind, title, body string) (string, error) {
	h.mu.RLock()
	ctx := h.ctx
	h.mu.RUnlock()
	if ctx == nil {
		return encodeBinding(nil, nil)
	}
	store := h.services().settings
	enabled, _ := store.Effective("General", "notifications", "true")
	if enabled != "true" {
		return encodeBinding(nil, nil)
	}
	sender := h.notifySender
	if sender == nil {
		sender = newRealNotificationSender(ctx)
	}
	h.notifyInitOnce.Do(func() {
		if err := sender.Initialize(); err != nil {
			_ = h.log.Report("notify_init_failed", err.Error())
		}
	})
	if err := sender.Send(title, body); err != nil {
		_ = h.log.Report("notify_send_failed", fmt.Sprintf("%s: %s", kind, err.Error()))
	}
	return encodeBinding(nil, nil)
}
