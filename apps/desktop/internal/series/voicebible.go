package series

import (
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/character"
	"github.com/countrymanprime/narration-utils/shell/internal/guide"
)

// VoiceBibleClip is one approved reference clip shown in the series voice bible (Phase 11): the fields the UI needs
// to list it and say which book it came from, flattened from character.Reference rather than embedding it, so a
// sibling clip (read cross-project, ChangedSinceApproval unknown) and the current project's own clip (annotated by
// character.Service.References, Q2) share one shape on the wire.
type VoiceBibleClip struct {
	ID          string `json:"id"`
	ProjectPath string `json:"projectPath"`
	// Book is the source project folder's own base name - a plain, always-available label (Phase 11's "source
	// book"). Nothing here reads a project's credits/front-matter title: that is a narrator-editable free-text
	// field for a different purpose (front-matter Series/Book Number tokens) and reading it cross-project would be
	// its own, unscoped feature.
	Book             string    `json:"book"`
	IsCurrentProject bool      `json:"isCurrentProject"`
	RegionGUID       string    `json:"regionGuid"`
	Name             string    `json:"name"`
	Start            float64   `json:"start"`
	End              float64   `json:"end"`
	ApprovedAt       time.Time `json:"approvedAt"`
	Note             string    `json:"note,omitempty"`
	// ChangedSinceApproval is only known for the current project's own clip (character.Service.References already
	// verifies it against the saved project); nil for a sibling book's clip, which this read-only path never
	// verifies against that book's own saved REAPER project.
	ChangedSinceApproval *bool `json:"changedSinceApproval,omitempty"`
}

// VoiceBibleCharacter is one character's approved reference clips pooled across every book of the series that has
// approved one, grouped by character id (a hash of the normalized name, stable across books - manuscript_guide.py's
// entity_id).
type VoiceBibleCharacter struct {
	CharacterID string           `json:"characterId"`
	Name        string           `json:"name"`
	Clips       []VoiceBibleClip `json:"clips"`
}

// VoiceBible is the Series tab's whole view of the current project's series (Phase 11). Characters is nil, not an
// empty list, whenever there is nothing to show - not in a series, or in one with no other book yet - so the UI can
// render one honest "no other books in this series yet" state instead of an empty table.
type VoiceBible struct {
	InSeries   bool   `json:"inSeries"`
	SeriesID   string `json:"seriesId,omitempty"`
	SeriesName string `json:"seriesName,omitempty"`
	// BookCount is the series' own member count, including the current project.
	BookCount  int                   `json:"bookCount"`
	Characters []VoiceBibleCharacter `json:"characters,omitempty"`
	// UnreadableBooks names (by their own book label) any member project whose reference data exists but could not
	// be decoded (Siblings' own Unreadable, Phase 9's "reported, not fatal" rule) - never fatal to the whole view.
	UnreadableBooks []string `json:"unreadableBooks,omitempty"`
}

// VoiceBibleConfig is what BuildVoiceBible needs. CurrentReferences and CurrentNames are nil-safe: a project with
// no character.Service or guide.Service configured (host wiring predates a project being attached) simply
// contributes no own-project clips or names, rather than erroring the whole view.
type VoiceBibleConfig struct {
	SeriesStore       *Store
	CurrentProject    string
	CurrentReferences func() ([]character.ApprovedReference, error)
	CurrentNames      func() (map[string]string, error)
}

// BuildVoiceBible resolves the current project's series (Q10) and, only once a second book actually has data to
// share, pools every member project's approved references by character (Q11, narrowed by D87 to reference data
// only - see internal/series's own package doc). A project not in any series, or in a series with only itself as a
// member so far, is the same honest empty state (Phase 11's own success signal): Characters stays nil and no
// sibling is read at all.
func BuildVoiceBible(cfg VoiceBibleConfig) (VoiceBible, error) {
	series, inSeries, err := cfg.SeriesStore.ForProject(cfg.CurrentProject)
	if err != nil {
		return VoiceBible{}, err
	}
	if !inSeries {
		return VoiceBible{InSeries: false}, nil
	}
	bookCount := len(series.MemberProjectPaths)
	if bookCount <= 1 {
		return VoiceBible{InSeries: true, SeriesID: series.ID, SeriesName: series.Name, BookCount: bookCount}, nil
	}

	names := map[string]string{}
	if cfg.CurrentNames != nil {
		if own, err := cfg.CurrentNames(); err == nil {
			for id, name := range own {
				names[id] = name
			}
		}
	}

	byCharacter := map[string]*VoiceBibleCharacter{}
	order := make([]string, 0, len(names))
	addClip := func(characterID string, clip VoiceBibleClip) {
		row, ok := byCharacter[characterID]
		if !ok {
			row = &VoiceBibleCharacter{CharacterID: characterID}
			byCharacter[characterID] = row
			order = append(order, characterID)
		}
		row.Clips = append(row.Clips, clip)
	}

	if cfg.CurrentReferences != nil {
		if refs, err := cfg.CurrentReferences(); err == nil {
			for _, r := range refs {
				changed := r.ChangedSinceApproval
				addClip(r.CharacterID, voiceBibleClip(r.Reference, cfg.CurrentProject, true, &changed))
			}
		}
	}

	var unreadable []string
	for _, sibling := range Siblings(series, cfg.CurrentProject) {
		if sibling.Unreadable != "" {
			unreadable = append(unreadable, filepath.Base(sibling.ProjectPath))
			continue
		}
		if siblingNames, err := guide.ReadOnlyNames(sibling.ProjectPath); err == nil {
			for id, name := range siblingNames {
				if _, already := names[id]; !already {
					names[id] = name
				}
			}
		}
		for _, r := range sibling.References {
			addClip(r.CharacterID, voiceBibleClip(r, sibling.ProjectPath, false, nil))
		}
	}

	characters := make([]VoiceBibleCharacter, 0, len(order))
	for _, id := range order {
		row := byCharacter[id]
		row.Name = names[id]
		if row.Name == "" {
			row.Name = id
		}
		sort.Slice(row.Clips, func(i, j int) bool { return row.Clips[i].ApprovedAt.Before(row.Clips[j].ApprovedAt) })
		characters = append(characters, *row)
	}
	sort.Slice(characters, func(i, j int) bool {
		return strings.ToLower(characters[i].Name) < strings.ToLower(characters[j].Name)
	})

	return VoiceBible{
		InSeries: true, SeriesID: series.ID, SeriesName: series.Name, BookCount: bookCount,
		Characters: characters, UnreadableBooks: unreadable,
	}, nil
}

func voiceBibleClip(r character.Reference, projectPath string, isCurrentProject bool, changedSinceApproval *bool) VoiceBibleClip {
	return VoiceBibleClip{
		ID: r.ID, ProjectPath: projectPath, Book: filepath.Base(projectPath), IsCurrentProject: isCurrentProject,
		RegionGUID: r.RegionGUID, Name: r.Snapshot.Name, Start: r.Snapshot.Start, End: r.Snapshot.End,
		ApprovedAt: r.ApprovedAt, Note: r.Note, ChangedSinceApproval: changedSinceApproval,
	}
}
