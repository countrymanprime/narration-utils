package process

import (
	"fmt"
	"strconv"
	"strings"
)

// ParseProgress reads one line of a sidecar's progress file, `STAGE|percent|message` (libs/python/narration_common/progress.py). The
// message is optional. A line that is not in that shape, or whose percent is not a number from 0 to 100, is an error and never a
// silent 0: a caller keeps the last good progress and says so (ADR 0069).
func ParseProgress(line string) (stage string, percent float64, message string, err error) {
	parts := strings.SplitN(strings.TrimSpace(line), "|", 3)
	if len(parts) < 2 {
		return "", 0, "", fmt.Errorf("a progress line needs a stage and a percent")
	}
	percent, parseErr := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
	if parseErr != nil || percent < 0 || percent > 100 {
		return "", 0, "", fmt.Errorf("a progress line's percent must be a number from 0 to 100")
	}
	if len(parts) == 3 {
		message = strings.TrimSpace(parts[2])
	}
	return strings.TrimSpace(parts[0]), percent, message, nil
}
