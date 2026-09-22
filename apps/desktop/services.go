package main

import (
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/guide"
	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
	"github.com/countrymanprime/narration-utils/shell/internal/teleprompter"
	"github.com/countrymanprime/narration-utils/shell/internal/transcript"
)

// hostServices is one consistent view of the project-scoped state of a Host:
// the launch config and the service pointers that configureLocked replaces
// whenever a project is attached (the picker, "open recent", and a REAPER
// second launch). A service can legitimately be nil, so callers keep their
// nil checks. The asset managers are not here: they are not project-scoped,
// and the registry that holds them is built once (assetregistry.go).
type hostServices struct {
	config       config
	findings     *findings.Store
	guide        *guide.Service
	manuscript   *manuscript.Service
	settings     *settings.Store
	teleprompter *teleprompter.Service
	transcript   *transcript.Service
}

// services returns a snapshot of the swappable services. It is the only way a
// binding or helper reads them:
//
//	svc := h.services()
//	if svc.guide == nil { ... }
//	svc.guide.Entities()
//
// Use one snapshot for the whole call, so a call that needs several services
// (GuidePreview uses guide, settings and tts) sees one project even if the user
// switches while it runs, and pass the snapshot, not the Host, to goroutines
// that outlive the call.
//
// The lock is taken to copy and released before the snapshot is returned. Never
// hold h.mu across a service call: the emit callbacks re-enter h.mu.RLock, and a
// recursive read lock behind a queued writer (a project switch) deadlocks. For
// the same reason never call services() while holding h.mu yourself: with the
// write lock held (configureLocked and every unexported ...Locked function, ProjectSwitch
// and onSecondInstance between Lock and Unlock) it deadlocks on itself; use
// h.config there, or take the snapshot before locking.
//
// hostguard_test.go fails `go test` on any other read of these fields, so a new
// binding cannot regress this by accident. h.recents and h.sidecars are set once
// in NewHost and never reassigned, so they are read directly.
func (h *Host) services() hostServices {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return hostServices{
		config:       h.config,
		findings:     h.findings,
		guide:        h.guide,
		manuscript:   h.manuscript,
		settings:     h.settings,
		teleprompter: h.teleprompter,
		transcript:   h.transcript,
	}
}
