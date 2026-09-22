package main

import (
	"context"
	"fmt"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// notificationSender is the seam over the Wails notification API (ADR 0097), so tests substitute a fake instead of
// touching the OS notification center or, on Windows, writing the per-user registry key InitializeNotifications needs.
type notificationSender interface {
	Initialize() error
	Send(title, body string) error
}

// realNotificationSender is the production notificationSender: the Wails runtime notification calls, bound to the
// host's context.
type realNotificationSender struct{ ctx context.Context }

func (s realNotificationSender) Initialize() error { return runtime.InitializeNotifications(s.ctx) }

func (s realNotificationSender) Send(title, body string) error {
	return runtime.SendNotification(s.ctx, runtime.NotificationOptions{Title: title, Body: body})
}

// SystemNotify raises one OS notification when General.notifications is on (N1-N4). It never surfaces an error to the
// caller: a notification is a courtesy, never load-bearing, so a failed or unavailable sender is logged and swallowed
// (docs/architecture/notifications.md). Which job qualifies (the window must be unfocused and the job must have taken
// about 10s or more) is decided in the webview, which is the only side that knows whether the window has focus
// (N1: no focus query exists in the Wails v2.16 host API).
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
		sender = realNotificationSender{ctx: ctx}
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
