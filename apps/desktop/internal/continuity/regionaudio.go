package continuity

import (
	"errors"
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/character"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// waveSourceKind is the only source kind measured (ADR 0025).
const waveSourceKind = "WAVE"

// edgeTolerance absorbs float rounding in REAPER's saved positions.
const edgeTolerance = 1e-6

// RegionAudio resolves a reference's approved region to source audio in a
// parsed project. It resolves the snapshot taken at approval (Q2), so what
// is measured is what the narrator approved; a reference whose region has
// changed since is excluded before it gets here.
type RegionAudio struct {
	Project tracks.Project
}

// ResolveIn maps the reference's region onto the one item, on any track,
// that wholly contains it, through that item's active take. It refuses
// rather than approximates: no item, more than one (which recording is the
// reference would be a guess), a non-WAV or offline source, or a take whose
// source time is not a linear map of item time.
func (a RegionAudio) ResolveIn(reference character.Reference) (Clip, error) {
	start, end := reference.Snapshot.Start, reference.Snapshot.End
	var found []tracks.Item
	for _, track := range a.Project.Tracks {
		for _, item := range track.Items {
			if item.Position-edgeTolerance <= start && end <= item.Position+item.Length+edgeTolerance {
				found = append(found, item)
			}
		}
	}
	switch len(found) {
	case 0:
		return Clip{}, errors.New("no single item covers the whole region")
	case 1:
	default:
		return Clip{}, fmt.Errorf("%d items cover the region, so which recording is the reference is ambiguous", len(found))
	}
	item := found[0]
	index := activeTake(item)
	if index < 0 {
		return Clip{}, errors.New("the item under the region has no active take")
	}
	take := item.Takes[index]
	switch {
	case take.SourceKind != waveSourceKind:
		return Clip{}, fmt.Errorf("source format %q is not measured: only WAV is (ADR 0025)", take.SourceKind)
	case !take.SourceAvailable:
		return Clip{}, errors.New("the take's source file is not available")
	}
	source, err := measure.TakeSourceRange(item, index)
	if err != nil {
		return Clip{}, err
	}
	rate := take.PlayRate
	if rate == 0 {
		rate = 1
	}
	return Clip{File: source.File, Range: measure.Range{
		StartSeconds:  source.Range.StartSeconds + max(0, start-item.Position)*rate,
		LengthSeconds: (end - start) * rate,
	}}, nil
}

func activeTake(item tracks.Item) int {
	for i, take := range item.Takes {
		if take.Active {
			return i
		}
	}
	if len(item.Takes) == 1 {
		return 0
	}
	return -1
}

// SavedProjectAudio is the ReferenceAudio role over the saved REAPER
// project: Read parses it (for example a dawport.ProjectReader over the
// narrator's chosen .rpp) on every Resolve, so an edit saved between runs is
// seen.
type SavedProjectAudio struct {
	Read func() (tracks.Project, error)
}

// Resolve reads the saved project and resolves reference in it.
func (a SavedProjectAudio) Resolve(reference character.Reference) (Clip, error) {
	project, err := a.Read()
	if err != nil {
		return Clip{}, err
	}
	return RegionAudio{Project: project}.ResolveIn(reference)
}
