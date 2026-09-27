package dawport

import (
	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/daw"
)

// Today's implementations already have each synchronous role's method set, so the REAPER adapter can hand them out as they are
// (the PRD's capability table, checked against the code). The asynchronous roles are new method sets over bridge commands and are
// checked by the adapter's conformance run instead. The REAPER review session's own type (internal/dawport/reaper) is checked
// there, where it lives, to avoid an import cycle.
var (
	_ Navigator        = (*bridge.Navigator)(nil)
	_ MarkerWriter     = (*bridge.Navigator)(nil)
	_ Heartbeat        = (*daw.Reachability)(nil)
	_ TrackStateReader = (*bridge.Actions)(nil)
	_ Recorder         = (*bridge.Actions)(nil)
	_ Puncher          = (*bridge.Actions)(nil)
	_ RegionWriter     = (*bridge.Actions)(nil)
	_ TakeSelector     = (*bridge.Actions)(nil)
	_ FXManager        = (*bridge.Actions)(nil)
	_ SilenceTrimmer   = (*bridge.CleanupClient)(nil)
	_ GainAdjuster     = (*bridge.LevelMatchClient)(nil)
)
