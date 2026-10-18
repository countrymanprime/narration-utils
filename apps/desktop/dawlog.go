package main

import (
	"fmt"
	"log/slog"
	"path/filepath"

	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

// logConfigure records what this app was given to connect with: whether a bridge session came with the launch and which one (the
// session folder's own name, a generated id with no personal part), the DAW it was told, and whether a project is open. It runs on
// startup and on every attach, so "the app never saw REAPER's session" is a line in the log, not a guess.
func (h *Host) logConfigure() {
	session := ""
	if h.config.sessionDir != "" {
		session = filepath.Base(h.config.sessionDir)
	}
	h.runLog.App().Event(slog.LevelInfo, "app.configure", "the app was given its launch settings",
		"bridge_session", session, "daw_arg", h.config.daw, "has_project", h.config.projectFolder != "", "has_project_file", h.config.projectFile != "")
}

// logDawState writes one record when the project's DAW state changes: the state the Booth and Production read ("connected",
// "not_running", "linked", ...), whether the bridge exists and answers, and whether a REAPER project file is linked. A repeat of the
// last state writes nothing, so a poll costs no log lines.
func (h *Host) logDawState(choice DawChoice, bridge bool) {
	key := fmt.Sprintf("%s|%s|%t|%t|%t", choice.Daw, choice.State, choice.Reachable, bridge, choice.LinkedFile != nil)
	h.dawStateLogMu.Lock()
	changed := key != h.dawStateLogged
	h.dawStateLogged = key
	h.dawStateLogMu.Unlock()
	if !changed {
		return
	}
	h.runLog.App().Event(slog.LevelInfo, "daw.state", "the project's DAW state changed",
		"daw", choice.Daw, "state", choice.State, "source", choice.Source, "reachable", choice.Reachable, "bridge", bridge, "linked", choice.LinkedFile != nil)
}

// logDawCapabilities writes one record each time the DAW picture the pages read changes (the host pushes it as an event): whether
// the DAW is reachable and whether a bridge exists, so a banner that disagrees with the bridge can be traced to a missed push.
func (h *Host) logDawCapabilities(runtime dawport.Runtime) {
	h.runLog.App().Event(slog.LevelInfo, "daw.capabilities", "the DAW capabilities changed and were pushed to the pages",
		"reachable", runtime.Reachable, "bridge", runtime.Bridge)
}
