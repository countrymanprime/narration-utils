// Package takecompare compares the takes of one take-review group
// (take-review-pickups-duplicates-take-intelligence.prd.md Phase 10): it checks every read of the group against the
// saved project, aligns each one that is still there to the group's one manuscript span with the sidecar's
// --take-divergence mode (ADR 0141), measures each with internal/measure's MeasureTake (ADR 0140), and saves the
// result as one take_comparison finding. The finding holds evidence per take and per category, side by side; nothing
// here adds categories up, orders the takes or names a best one (PRD Q9), and nothing changes the active take (Q8).
package takecompare

import (
	"encoding/json"
	"fmt"
	"math"
	"path/filepath"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// AnalyzerName is Finding.Analyzer for a comparison and the store folder it is saved under.
const AnalyzerName = "take-comparison"

// groupAnalyzer is the analyzer whose groups can be compared (internal/repeats.AnalyzerName).
const groupAnalyzer = "take-review"

// minReads is the fewest reads a comparison compares.
const minReads = 2

// rangeTolerance absorbs the rounding of a read's range: the scan writes it to three decimals.
const rangeTolerance = 0.002

// Read is one read of a take-review group, as internal/repeats writes it into evidence.members.
type Read struct {
	ItemGUID     string  `json:"item_guid"`
	TakeGUID     string  `json:"take_guid"`
	SourceFile   string  `json:"source_file"`
	SourceStart  float64 `json:"source_start"`
	SourceLength float64 `json:"source_length"`
}

// Group is the part of a take-review finding a comparison needs: its id, its span and its reads.
type Group struct {
	ID         string
	FirstUnit  int
	LastUnit   int
	Reads      []Read
	Manuscript findings.Manuscript
}

// GroupOf reads a take-review finding as a group to compare, or says why it cannot be compared.
func GroupOf(finding findings.Finding) (Group, error) {
	if finding.Analyzer != groupAnalyzer {
		return Group{}, fmt.Errorf("only a group of repeated reads from Find pickups and duplicates can be compared")
	}
	var evidence struct {
		First   *int   `json:"matched_span_first"`
		Last    *int   `json:"matched_span_last"`
		Members []Read `json:"members"`
	}
	encoded, err := json.Marshal(finding.Evidence)
	if err == nil {
		err = json.Unmarshal(encoded, &evidence)
	}
	switch {
	case err != nil:
		return Group{}, fmt.Errorf("this group's reads could not be read: %w", err)
	case evidence.First == nil || evidence.Last == nil || *evidence.First < 0 || *evidence.Last < *evidence.First:
		return Group{}, fmt.Errorf("this group has no part of the script to compare its reads over")
	case len(evidence.Members) < minReads:
		return Group{}, fmt.Errorf("this group has fewer than two reads, so there is nothing to compare")
	}
	group := Group{ID: finding.ID, FirstUnit: *evidence.First, LastUnit: *evidence.Last, Reads: evidence.Members}
	if finding.Manuscript != nil {
		group.Manuscript = *finding.Manuscript
	}
	return group, nil
}

// resolvedRead is a read found in the saved project as the scan found it, or the reason it was not.
type resolvedRead struct {
	Read      Read
	Track     tracks.Track
	Item      tracks.Item
	TakeIndex int
	Reason    string
}

// resolveRead finds read's item and take in project and checks it still plays the same range of the same file, so
// every take compared is the audio the scan grouped (same-span validation, first half: the second is the alignment).
func resolveRead(project tracks.Project, read Read) resolvedRead {
	resolved := resolvedRead{Read: read, TakeIndex: -1}
	track, item, ok := project.ItemByGUID(read.ItemGUID)
	if read.ItemGUID == "" || !ok {
		resolved.Reason = "This read's item is not in the saved REAPER project any more. Save the project in REAPER, then scan the chapter again."
		return resolved
	}
	resolved.Track, resolved.Item = track, item
	for index, take := range item.Takes {
		if take.GUID == read.TakeGUID {
			resolved.TakeIndex = index
		}
	}
	if resolved.TakeIndex < 0 {
		resolved.Reason = "This read's take is not on its item in the saved REAPER project any more. Scan the chapter again."
		return resolved
	}
	take := item.Takes[resolved.TakeIndex]
	rate := take.PlayRate
	if rate == 0 {
		rate = 1
	}
	switch {
	case !sameFile(take.SourceFile, read.SourceFile):
		resolved.Reason = "This read's take plays a different file now than when the chapter was scanned. Scan the chapter again."
	case math.Abs(take.SOFFS-read.SourceStart) > rangeTolerance || math.Abs(item.Length*rate-read.SourceLength) > rangeTolerance:
		resolved.Reason = "This read's item was moved or trimmed since the chapter was scanned, so it may not hold the same words. Scan the chapter again."
	case !take.SourceAvailable:
		resolved.Reason = "This read's audio file is missing, so it cannot be heard or measured."
	}
	return resolved
}

func sameFile(a, b string) bool {
	return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
}
