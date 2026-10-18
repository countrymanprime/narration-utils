package main

import (
	"testing"
	"time"
)

func TestDecideAutoConnect(t *testing.T) {
	now := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	ready := autoConnectFacts{HasProject: true, ReaperProject: true, Linked: true, ReaperRunning: true, Now: now}
	cases := []struct {
		name string
		edit func(*autoConnectFacts)
		want autoConnectAction
		hub  string
	}{
		{"a connected app does nothing", func(f *autoConnectFacts) { f.Reachable = true }, autoConnectNone, ""},
		{"no project does nothing", func(f *autoConnectFacts) { f.HasProject = false }, autoConnectNone, ""},
		{"a project that records elsewhere does nothing", func(f *autoConnectFacts) { f.ReaperProject = false }, autoConnectNone, ""},
		{"an unlinked project does nothing", func(f *autoConnectFacts) { f.Linked = false }, autoConnectNone, ""},
		{"a REAPER that is not running is not started", func(f *autoConnectFacts) { f.ReaperRunning = false }, autoConnectNone, ""},
		{"a running REAPER with no bridge gets the launcher", func(f *autoConnectFacts) {}, autoConnectLaunch, ""},
		{"a live bridge session is attached, not started again", func(f *autoConnectFacts) { f.LiveHub = "hub_1" }, autoConnectAttach, "hub_1"},
		{"a live bridge session is attached even if REAPER's process is not seen", func(f *autoConnectFacts) { f.LiveHub = "hub_1"; f.ReaperRunning = false }, autoConnectAttach, "hub_1"},
		{"the session this app already has is not attached again", func(f *autoConnectFacts) { f.LiveHub = "hub_1"; f.CurrentHub = "hub_1" }, autoConnectLaunch, ""},
		{"a recent launch attempt waits", func(f *autoConnectFacts) { f.LastLaunch = now.Add(-10 * time.Second) }, autoConnectNone, ""},
		{"an old launch attempt may be repeated", func(f *autoConnectFacts) { f.LastLaunch = now.Add(-2 * time.Minute) }, autoConnectLaunch, ""},
	}
	for _, c := range cases {
		facts := ready
		c.edit(&facts)
		got, hub := decideAutoConnect(facts)
		if got != c.want || hub != c.hub {
			t.Errorf("%s: got (%v, %q), want (%v, %q)", c.name, got, hub, c.want, c.hub)
		}
	}
}
