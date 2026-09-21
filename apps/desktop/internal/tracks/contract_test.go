package tracks

import (
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
)

// The Tracks page's project as TracksList sends it (ADR 0069), parsed from the fixture .rpp with its resolved media. The absolute
// folder of the checkout is replaced so the file reads the same on every machine.
func TestContractTracksProject(t *testing.T) {
	folder, err := filepath.Abs("testdata")
	if err != nil {
		t.Fatal(err)
	}
	project, err := Parse(filepath.Join(folder, "basic.rpp"))
	if err != nil {
		t.Fatal(err)
	}
	stable, err := contractfile.PortablePaths(project, folder, "C:/Projects/Alice")
	if err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "tracks-project", stable)
}
