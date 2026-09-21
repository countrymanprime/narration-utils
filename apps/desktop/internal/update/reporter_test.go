package update

import "github.com/countrymanprime/narration-utils/shell/internal/persist"

// nilReporterCapturing is a reporter that appends "kind: message" for every line the update package writes to the host log.
func nilReporterCapturing(lines *[]string) *persist.Reporter {
	return &persist.Reporter{Log: func(kind, message string) { *lines = append(*lines, kind+": "+message) }}
}
