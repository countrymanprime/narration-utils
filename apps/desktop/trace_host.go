package main

import (
	"runtime"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/daw"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/project"
	"github.com/countrymanprime/narration-utils/shell/internal/trace"
)

// The host's side of the activity trace (docs/prds/activity-trace.prd.md): what the host records about the DAW bridge and
// its own launch. Nothing here formats a message; every record is a registered event with typed fields (internal/trace).

// startTrace turns the trace on for a build run from source and records the launch. A published release carries a stamped
// version (version.go), so it never matches developmentVersion and starts with the trace off; the narrator's switch
// (a later change) is the only way on there. The in-memory ring records either way.
func (h *Host) startTrace() {
	dev := h.version == developmentVersion
	if dev {
		h.tracer.SetEnabled(true)
	}
	h.tracer.Emit(trace.AppStart,
		trace.IDValue("version", h.version), trace.EnumValue("os", runtime.GOOS), trace.EnumValue("arch", runtime.GOARCH),
		trace.BoolValue("dev", dev), trace.IntValue("host_api", hostAPIVersion))
}

// stopTrace records a clean shutdown and flushes the file.
func (h *Host) stopTrace() {
	h.tracer.Emit(trace.AppStop, trace.DurValue("uptime", time.Since(h.launched)))
	h.tracer.Flush()
}

// traceDawKind is the trace's name for a DAW kind.
func traceDawKind(kind dawport.Kind) string {
	switch kind {
	case dawport.KindREAPER:
		return "reaper"
	case dawport.KindAudacity:
		return "audacity"
	case dawport.KindBuiltIn:
		return "builtin"
	default:
		return "none"
	}
}

// concreteReachability is the live tracker behind the Heartbeat role, or nil when there is none (a launch with no bridge, or a
// test double): the trace reads the age and the match reason only the tracker keeps.
func concreteReachability(heartbeat dawport.Heartbeat) *daw.Reachability {
	reach, _ := heartbeat.(*daw.Reachability)
	return reach
}

// heartbeatAge is how old the last heartbeat is in milliseconds, and whether there has been one. reach may be nil.
func heartbeatAge(reach *daw.Reachability) (int64, bool) {
	if reach == nil {
		return -1, false
	}
	age, heard := reach.LastSeenAge()
	if !heard {
		return -1, false
	}
	return age.Milliseconds(), true
}

// traceDawBridge records how the project's REAPER file bridge was set up (configureLocked): opened, or not and why.
func (h *Host) traceDawBridge(kind dawport.Kind, sessionDir string, opened bool, openErr error) {
	reason := "ok"
	switch {
	case sessionDir == "":
		reason = "no_session_dir"
	case kind == dawport.KindAudacity:
		reason = "audacity_project"
	case openErr != nil:
		reason = "bridge_new_failed"
	}
	h.tracer.Emit(trace.DawClient,
		trace.EnumValue("kind", traceDawKind(kind)), trace.BoolValue("configured", opened),
		trace.EnumValue("reason", reason), trace.PathValue("session", sessionDir))
}

// traceDawPoll is the trace's part of one pollDawCapabilities tick: the first look and every flip of reachability, and,
// when the capability report changed, its summary and each capability that is unavailable with its reason.
func (h *Host) traceDawPoll(reach *daw.Reachability, resolver *dawport.Resolver, runtime dawport.Runtime, capsChanged bool) {
	kind := traceDawKind(resolver.Kind())
	state := int8(2)
	if runtime.Reachable {
		state = 1
	}
	h.mu.Lock()
	flipped := h.dawTracedReach != state || h.dawTracedKind != kind
	h.dawTracedReach, h.dawTracedKind = state, kind
	h.mu.Unlock()
	if flipped {
		age, heard := heartbeatAge(reach)
		h.tracer.Emit(trace.DawReachableChanged,
			trace.EnumValue("kind", kind), trace.BoolValue("reachable", runtime.Reachable), trace.BoolValue("heard", heard),
			trace.IntValue("age_ms", age), trace.IntValue("timeout_ms", daw.HeartbeatTimeout().Milliseconds()))
	}
	if !capsChanged {
		return
	}
	var unavailable []dawport.Capability
	all := resolver.All()
	for _, spec := range dawport.Capabilities() {
		if !all[spec.Capability].Available {
			unavailable = append(unavailable, spec.Capability)
		}
	}
	h.tracer.Emit(trace.DawCapsChanged,
		trace.EnumValue("kind", kind), trace.BoolValue("reachable", runtime.Reachable),
		trace.IntValue("available", int64(len(all)-len(unavailable))), trace.IntValue("unavailable", int64(len(unavailable))))
	for _, capability := range unavailable {
		h.tracer.Emit(trace.DawCapUnavailable, trace.IDValue("capability", string(capability)), trace.IDValue("reason", string(all[capability].Reason)))
	}
}

// traceDrain records the bridge event reader failing or recovering. It writes only when the error's class changes, since
// the reader runs every 150 ms and the same failure would otherwise fill the file.
func (h *Host) traceDrain(err error) {
	class := trace.ErrorClass(err)
	h.mu.Lock()
	previous := h.drainErrClass
	h.drainErrClass = class
	h.mu.Unlock()
	if class == previous || (previous == "" && class == "none") {
		return
	}
	h.tracer.Emit(trace.DawDispatchError, trace.ErrValue("err", err))
}

// traceBridgeLog is the bridge client's report callback beside the host log: a rejected REAPER event is also a trace record.
func (h *Host) traceBridgeLog(kind string) {
	if kind == "reaper_event_invalid" {
		h.tracer.Emit(trace.DawEventRejected, trace.EnumValue("kind", kind))
	}
}

// traceDawLink records the DAW facts Bootstrap just gave the page, with the reason a project is not a match: the question
// the Production page asked of the host. It reads the project's manifest the same way dawLinkFacts does.
func (h *Host) traceDawLink(folder string, reach *daw.Reachability, linked, reachable, matches bool) {
	age, heard := heartbeatAge(reach)
	reason := "no_heartbeat"
	if reach != nil {
		reason = "no_link"
		if manifest, ok, err := project.Load(h.persist, folder); err == nil && ok && manifest != nil && manifest.DawProjectFile != nil {
			if path, resolved := manifest.DawProjectFile.Resolve(folder); resolved {
				reason = reach.MatchReason(path)
			}
		}
	}
	h.tracer.Emit(trace.DawLinkFacts,
		trace.BoolValue("linked", linked), trace.BoolValue("reachable", reachable), trace.BoolValue("matches", matches),
		trace.EnumValue("reason", reason), trace.BoolValue("heard", heard), trace.IntValue("age_ms", age))
}
