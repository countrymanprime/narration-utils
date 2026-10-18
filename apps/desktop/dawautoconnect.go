package main

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/daw"
)

// The app connects to the REAPER the narrator already has open without a click. A project that records with REAPER and has its
// project file linked is attached to REAPER's live bridge session when one is running (REAPER's launcher was run before the app
// opened), and otherwise the launcher is run inside the open REAPER (launchReaper). A REAPER that is not running is never started
// here: that stays the narrator's choice (Start REAPER). A launch is repeated only after autoConnectRetry.
const (
	autoConnectEvery  = 5 * time.Second
	autoConnectFirst  = 2 * time.Second
	autoConnectRetry  = time.Minute
	autoConnectHubAge = 15 * time.Second
)

type autoConnectAction int

const (
	autoConnectNone autoConnectAction = iota
	autoConnectAttach
	autoConnectLaunch
)

// autoConnectFacts is everything decideAutoConnect weighs, read by the loop and fed in by the tests.
type autoConnectFacts struct {
	HasProject, ReaperProject, Linked, Reachable, ReaperRunning bool
	// LiveHub is the name of a bridge session folder REAPER wrote to a moment ago; CurrentHub is the one this app already uses.
	LiveHub, CurrentHub string
	LastLaunch, Now     time.Time
}

// decideAutoConnect is the whole policy: nothing unless a REAPER project with a linked file is not reachable; then attach to a
// live session this app does not use yet, else run the launcher in a REAPER that is open and not tried in the last minute.
func decideAutoConnect(f autoConnectFacts) (autoConnectAction, string) {
	if !f.HasProject || !f.ReaperProject || !f.Linked || f.Reachable {
		return autoConnectNone, ""
	}
	if f.LiveHub != "" && f.LiveHub != f.CurrentHub {
		return autoConnectAttach, f.LiveHub
	}
	if !f.ReaperRunning || (!f.LastLaunch.IsZero() && f.Now.Sub(f.LastLaunch) < autoConnectRetry) {
		return autoConnectNone, ""
	}
	return autoConnectLaunch, ""
}

// autoConnectLoop checks every few seconds until ctx ends. It changes nothing while the app is connected.
func (h *Host) autoConnectLoop(ctx context.Context) {
	var lastLaunch time.Time
	timer := time.NewTimer(autoConnectFirst)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		lastLaunch = h.autoConnectOnce(lastLaunch)
		timer.Reset(autoConnectEvery)
	}
}

func (h *Host) autoConnectOnce(lastLaunch time.Time) time.Time {
	svc := h.services()
	if svc.config.projectFolder == "" || svc.settings == nil {
		return lastLaunch
	}
	pd := h.projectDaw(svc)
	facts := autoConnectFacts{
		Now: time.Now(), LastLaunch: lastLaunch, HasProject: true,
		ReaperProject: pd.kind.LinksProjectFile(), Linked: pd.folder.linkedPath != "",
		Reachable: svc.reachability != nil && svc.reachability.Reachable(),
	}
	if svc.config.sessionDir != "" {
		facts.CurrentHub = filepath.Base(svc.config.sessionDir)
	}
	if !facts.ReaperProject || !facts.Linked || facts.Reachable {
		return lastLaunch
	}
	facts.LiveHub = liveBridgeSession(facts.Now)
	if h.reaperRunning != nil {
		facts.ReaperRunning = h.reaperRunning()
	} else {
		facts.ReaperRunning = daw.IsRunning("reaper.exe")
	}
	action, hub := decideAutoConnect(facts)
	switch action {
	case autoConnectAttach:
		h.runLog.App().Event(slog.LevelInfo, "daw.autoconnect", "attaching to REAPER's live bridge session", "action", "attach", "bridge_session", hub)
		h.attachBridgeSession(hub, pd.folder.linkedPath)
	case autoConnectLaunch:
		_, err := launchReaper(svc, h.persist, h.reaperLocate, h.reaperLaunch, h.reaperRunning)
		h.runLog.App().Event(slog.LevelInfo, "daw.autoconnect", "ran the launcher in the open REAPER", "action", "launch", "ok", err == nil, "error", errText(err))
		return facts.Now
	}
	return lastLaunch
}

func errText(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

// liveBridgeSession is the newest session folder under REAPER's resource folder whose event log changed within autoConnectHubAge: the
// launcher's loop writes a status every second or so, so a recent write means a bridge is running now. "" when none is.
func liveBridgeSession(now time.Time) string {
	root := bridgeSessionsRoot()
	if root == "" {
		return ""
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return ""
	}
	type hub struct {
		name string
		at   time.Time
	}
	var live []hub
	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasPrefix(entry.Name(), "hub_") {
			continue
		}
		info, err := os.Stat(filepath.Join(root, entry.Name(), "events.log"))
		if err == nil && now.Sub(info.ModTime()) < autoConnectHubAge {
			live = append(live, hub{entry.Name(), info.ModTime()})
		}
	}
	sort.Slice(live, func(i, j int) bool { return live[i].at.After(live[j].at) })
	if len(live) == 0 {
		return ""
	}
	return live[0].name
}

// bridgeSessionsRoot is where REAPER's launcher creates its session folders (NarrationUtils_Launcher.lua: <resource path>/NarrationUtils/sessions).
func bridgeSessionsRoot() string {
	appData := os.Getenv("APPDATA")
	if appData == "" {
		return ""
	}
	return filepath.Join(appData, "REAPER", "NarrationUtils", "sessions")
}

// attachBridgeSession gives this app the named bridge session by attaching the open project again with that session folder, the
// same path a second launch from REAPER's launcher takes (onSecondInstance).
func (h *Host) attachBridgeSession(hub, rppPath string) {
	h.mu.Lock()
	next := h.config
	next.sessionDir = filepath.Join(bridgeSessionsRoot(), hub)
	next.daw = "REAPER"
	if next.projectFile == "" {
		next.projectFile = rppPath
	}
	attached, _ := h.attachProjectLocked(next)
	h.mu.Unlock()
	if attached {
		emitEvent("system:attached", map[string]any{"attached": true})
	}
}
