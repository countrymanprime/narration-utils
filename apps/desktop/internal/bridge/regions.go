package bridge

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Region is one region the host asks REAPER for: a chapter or a credits row, in project seconds, named as the chapter
// table names it (create_regions, narration_regions.lua; follow-through PRD Phase 7 and credits-in-chapter-table Phase 4).
type Region struct {
	Start, End float64
	Title      string
}

// RegionsCreated counts what create_regions did: regions added, rows that already had their region, rows REAPER could
// not read, regions moved to a chapter's new bounds (update), titles held by several regions and left alone, and regions
// REAPER refused to add. An older script sends only the first three.
type RegionsCreated struct {
	Created, Existing, Invalid, Updated, Ambiguous, Failed int
}

var hexColour = regexp.MustCompile(`^[0-9A-Fa-f]{6}$`)

// ErrBadRegions: a row or the colour is one REAPER would refuse, so nothing was sent.
var ErrBadRegions = errors.New("the regions to create are not valid")

// CreateRegions writes rows to a payload file in the session folder and asks REAPER to create one region per row in one
// undo step, skipping any that already exist. colour is RRGGBB or empty for REAPER's default. With update, a row whose
// title one region already has, with other bounds, moves that region instead of adding a second.
func (a *Actions) CreateRegions(ctx context.Context, rows []Region, colour string, update bool) (RegionsCreated, error) {
	if len(rows) == 0 || (colour != "" && !hexColour.MatchString(colour)) {
		return RegionsCreated{}, ErrBadRegions
	}
	var payload strings.Builder
	for _, row := range rows {
		if !finite(row.Start) || !finite(row.End) || row.Start < 0 || row.End <= row.Start || strings.TrimSpace(row.Title) == "" || strings.ContainsAny(row.Title, "\r\n") {
			return RegionsCreated{}, fmt.Errorf("%w: %q", ErrBadRegions, row.Title)
		}
		fmt.Fprintf(&payload, "%s|%s|%s\n", formatSeconds(row.Start), formatSeconds(row.End), row.Title)
	}
	if err := a.allowed("create_regions"); err != nil {
		return RegionsCreated{}, err
	}
	path := filepath.Join(a.client.sessionDir, fmt.Sprintf("regions-%d.txt", time.Now().UnixNano()))
	if err := os.WriteFile(path, []byte(payload.String()), 0o600); err != nil {
		return RegionsCreated{}, fmt.Errorf("could not write the region list: %w", err)
	}
	defer func() { _ = os.Remove(path) }()
	flag := "0"
	if update {
		flag = "1"
	}
	events, err := a.request(ctx, "create_regions", []string{"REGIONS_CREATED"}, path, colour, flag)
	if err != nil {
		return RegionsCreated{}, err
	}
	fields := events[len(events)-1].Fields
	return RegionsCreated{
		Created: int(numberAt(fields, 2)), Existing: int(numberAt(fields, 3)), Invalid: int(numberAt(fields, 4)),
		Updated: int(numberAt(fields, 5)), Ambiguous: int(numberAt(fields, 6)), Failed: int(numberAt(fields, 7)),
	}, nil
}
