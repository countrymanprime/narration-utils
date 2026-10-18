package trace

// The registry of events the host writes. Every event the app can record is declared here, with the fields it may carry
// and the values an enum may take; an Emit that strays from its definition loses the field and counts a drop. Add an
// event by adding a line, not by formatting a message (docs/prds/activity-trace.prd.md).

var dawKinds = []string{"reaper", "audacity", "builtin", "none"}

var (
	// AppStart is the first record of a launch.
	AppStart = Define("app", "start", LevelInfo,
		IDField("version"), EnumField("os", "windows", "linux", "darwin"), EnumField("arch", "amd64", "arm64", "386"),
		BoolField("dev"), IntField("host_api"))
	// AppStop is the last record of a clean shutdown.
	AppStop = Define("app", "stop", LevelInfo, DurField("uptime"))

	// DawClient says whether the REAPER file bridge was opened for the project and, when it was not, why.
	DawClient = Define("daw", "client", LevelInfo,
		EnumField("kind", dawKinds...), BoolField("configured"),
		EnumField("reason", "ok", "no_session_dir", "audacity_project", "bridge_new_failed"), PathField("session"))
	// DawReachableChanged is every flip of "the DAW answers", and the first look: how old the last heartbeat was and the
	// age it was judged against.
	DawReachableChanged = Define("daw", "reachable_changed", LevelInfo,
		EnumField("kind", dawKinds...), BoolField("reachable"), BoolField("heard"), IntField("age_ms"), IntField("timeout_ms"))
	// DawCapsChanged summarizes the capability report whenever it changes.
	DawCapsChanged = Define("daw", "caps_changed", LevelInfo,
		EnumField("kind", dawKinds...), BoolField("reachable"), IntField("available"), IntField("unavailable"))
	// DawCapUnavailable is one capability the report calls unavailable, and its reason code, written with each change.
	DawCapUnavailable = Define("daw", "cap_unavailable", LevelInfo, IDField("capability"), IDField("reason"))
	// DawLinkFacts is what Bootstrap told the page about the DAW project, and why it is not a match when it is not.
	DawLinkFacts = Define("daw", "link_facts", LevelInfo,
		BoolField("linked"), BoolField("reachable"), BoolField("matches"),
		EnumField("reason", "ok", "no_link", "stale", "no_project", "unsaved", "path_differs", "no_heartbeat"),
		BoolField("heard"), IntField("age_ms"))
	// DawDispatchError is the bridge's event reader failing, or recovering ("none"), written when its class changes.
	DawDispatchError = Define("daw", "dispatch_error", LevelWarn, ErrField("err"))
	// DawEventRejected is an event from the REAPER script that the app could not read.
	DawEventRejected = Define("daw", "event_rejected", LevelWarn, EnumField("kind", "reaper_event_invalid"))
)
