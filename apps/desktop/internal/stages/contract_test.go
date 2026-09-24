package stages

import (
	"slices"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
)

// Every cause an unknown signal can carry, pinned so the UI's schema lists the same words (ADR 0069).
func TestContractUnknownCauses(t *testing.T) {
	causes := make([]string, 0, len(knownCauses))
	for cause := range knownCauses {
		causes = append(causes, string(cause))
	}
	slices.Sort(causes)
	contractfile.Check(t, "stages-causes", causes)
}
