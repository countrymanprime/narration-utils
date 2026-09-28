// Package passagetakes finds the alternate takes of a chapter passage for the workspace's Takes panel
// (edit-and-proof-workspace.prd.md Phase 6, EP6, ADR 0700): the other takes on the item the passage was heard on, the
// other retakes of its line on a fixed-lane track, and the reads a take-review group set beside it. Everything is read
// from the saved project, the chapter's stored alignment and the findings store, never from the page: the page names
// a chapter and a range of tokens, and a candidate is chosen by an id this package offered (Resolved.Choice), so a GUID,
// a file or a time never comes from the UI (threat model 5l).
package passagetakes

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/coverage"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
	"github.com/countrymanprime/narration-utils/shell/internal/retakelanes"
	"github.com/countrymanprime/narration-utils/shell/internal/takecompare"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// Where a candidate comes from (EP6's three sources) and what choosing it does (EP7).
const (
	SourceItemTake   = "item_take"
	SourceLaneRetake = "lane_retake"
	SourceTakeReview = "take_review"

	// ActionMakeActive makes the take the item's active one (set_active_take, one undo step).
	ActionMakeActive = "make_active"
	// ActionPickLane makes the retake's lane the only one playing (pick_retake_lane, one undo step).
	ActionPickLane = "pick_lane"
	// ActionAddAndActivate adds a read from another item as a new take and makes it active: two REAPER steps, so the
	// narrator confirms it (EP7).
	ActionAddAndActivate = "add_and_activate"
)

const takeReviewAnalyzer = "take-review"

// Candidate is one take the narrator can hear against the passage and choose.
type Candidate struct {
	ID     string `json:"id"`
	Source string `json:"source"`
	Action string `json:"action"`
	// Confirm is set only for ActionAddAndActivate.
	Confirm bool   `json:"confirm"`
	Label   string `json:"label"`
	Detail  string `json:"detail"`
	// Active is set for what plays now.
	Active   bool   `json:"active"`
	ItemGUID string `json:"itemGuid"`
	TakeGUID string `json:"takeGuid"`
	// SourceFile, SourceStart and SourceLength are the range of its own file the take plays, for the in-app A/B.
	SourceFile   string  `json:"sourceFile"`
	SourceStart  float64 `json:"sourceStart"`
	SourceLength float64 `json:"sourceLength"`
	// Usable is false when the take cannot be heard or chosen, and Reason says why.
	Usable            bool     `json:"usable"`
	Reason            string   `json:"reason,omitempty"`
	Compared          bool     `json:"compared"`
	Fidelity          *float64 `json:"fidelity,omitempty"`
	NotComparedReason string   `json:"notComparedReason,omitempty"`
}

// Alternates is the Takes panel's read: the passage as the host snapped it and every candidate for it.
type Alternates struct {
	ChapterID  string `json:"chapterId"`
	FirstToken int    `json:"firstToken"`
	LastToken  int    `json:"lastToken"`
	// FirstParagraph and LastParagraph are the passage snapped out to whole paragraphs, in the chapter's order: the
	// span a comparison aligns every take to.
	FirstParagraph int `json:"firstParagraph"`
	LastParagraph  int `json:"lastParagraph"`
	// Words is how many words of the chapter's alignment the asked range holds.
	Words int `json:"words"`
	// PassageID names the passage and the item it was heard on; empty when there is none.
	PassageID string `json:"passageId"`
	ItemGUID  string `json:"itemGuid"`
	// Message says why there are no candidates, when there are none.
	Message string `json:"message,omitempty"`
	// ComparisonID is the saved take_comparison finding for this passage, if one was made.
	ComparisonID string      `json:"comparisonId,omitempty"`
	Candidates   []Candidate `json:"candidates"`
}

// Choice is everything acting on a candidate needs, all from the saved project and the findings store.
type Choice struct {
	Candidate      Candidate
	TargetItemGUID string
	// LineID and FindingID are set for a lane pick and for an add-and-activate.
	LineID    string
	FindingID string
	// SourceFile, RangeStart and RangeEnd are the read's own range (add-and-activate): create_take's inputs.
	SourceFile string
	RangeStart float64
	RangeEnd   float64
}

// Input is what Resolve reads.
type Input struct {
	ChapterID  string
	View       coverage.AlignmentView
	FirstToken int
	LastToken  int
	Project    tracks.Project
	// Groups are the chapter's take-review findings.
	Groups []findings.Finding
	// Comparison finds the saved comparison of a passage; nil means none are kept.
	Comparison func(passageID string) (findings.Finding, bool)
}

// Resolved is Alternates plus what is needed to act on a candidate and to compare them.
type Resolved struct {
	View    Alternates
	choices map[string]Choice
	reads   []takecompare.Read
}

// Choice is the offered candidate named id, or false: nothing but an offered candidate can be chosen.
func (r Resolved) Choice(id string) (Choice, bool) {
	choice, ok := r.choices[id]
	return choice, ok
}

// Reads are the usable candidates as the reads a comparison aligns, one per take.
func (r Resolved) Reads() []takecompare.Read { return r.reads }

// Resolve reads the alternates of the passage [FirstToken, LastToken] of the chapter's alignment. It errors only for a
// range outside the alignment (the caller's copy of it is out of date); every other problem is the view's Message.
func Resolve(in Input) (Resolved, error) {
	tokens := in.View.Tokens
	if in.FirstToken < 0 || in.LastToken >= len(tokens) || in.FirstToken > in.LastToken {
		return Resolved{}, fmt.Errorf("tokens %d to %d are not in this chapter's alignment; reload the workspace", in.FirstToken, in.LastToken)
	}
	view := Alternates{ChapterID: in.ChapterID, FirstToken: in.FirstToken, LastToken: in.LastToken, Words: in.LastToken - in.FirstToken + 1, Candidates: []Candidate{}}
	resolved := Resolved{View: view, choices: map[string]Choice{}}

	view.FirstParagraph, view.LastParagraph = paragraphSpan(in.View, in.FirstToken, in.LastToken)
	itemIndex, heard := majorityItem(tokens[in.FirstToken : in.LastToken+1])
	if !heard {
		view.Message = "This passage wasn't heard in the recording, so there are no takes to set beside it. Run the check again if the chapter has changed."
		resolved.View = view
		return resolved, nil
	}
	alignmentItem, ok := alignmentItemAt(in.View.Items, itemIndex)
	if !ok || !alignmentItem.Live || alignmentItem.ItemGUID == "" {
		view.Message = "The item this passage was heard on is no longer in the saved REAPER project. Save the project in REAPER and run the check again."
		resolved.View = view
		return resolved, nil
	}
	track, item, ok := in.Project.ItemByGUID(alignmentItem.ItemGUID)
	if !ok {
		view.Message = "The item this passage was heard on is no longer in the saved REAPER project. Save the project in REAPER and run the check again."
		resolved.View = view
		return resolved, nil
	}
	view.ItemGUID = item.GUID
	view.PassageID = "passage-" + findings.StableID("passage", in.ChapterID, strconv.Itoa(view.FirstParagraph), strconv.Itoa(view.LastParagraph), item.GUID)

	b := &builder{in: in, target: item, seen: map[string]bool{}}
	b.itemTakes(item)
	b.laneRetakes(track, item)
	b.takeReviewReads(item)

	if in.Comparison != nil {
		if saved, found := in.Comparison(view.PassageID); found {
			view.ComparisonID = saved.ID
			markCompared(b.candidates, saved)
		}
	}
	view.Candidates = b.candidates
	for i := range view.Candidates {
		candidate := view.Candidates[i]
		choice := b.choices[candidate.ID]
		choice.Candidate = candidate
		resolved.choices[candidate.ID] = choice
	}
	resolved.View = view
	resolved.reads = b.reads
	return resolved, nil
}

type builder struct {
	in         Input
	target     tracks.Item
	seen       map[string]bool
	candidates []Candidate
	choices    map[string]Choice
	reads      []takecompare.Read
}

func (b *builder) add(candidate Candidate, choice Choice) {
	key := candidate.ItemGUID + "|" + candidate.TakeGUID
	if b.seen[key] {
		return
	}
	b.seen[key] = true
	if b.choices == nil {
		b.choices = map[string]Choice{}
	}
	choice.TargetItemGUID = b.target.GUID
	b.choices[candidate.ID] = choice
	b.candidates = append(b.candidates, candidate)
	if candidate.Usable {
		b.reads = append(b.reads, takecompare.Read{
			ItemGUID: candidate.ItemGUID, TakeGUID: candidate.TakeGUID, SourceFile: candidate.SourceFile,
			SourceStart: candidate.SourceStart, SourceLength: candidate.SourceLength,
		})
	}
}

// takeRange is a take's played range of its own file, or why it cannot be derived or heard.
func takeRange(item tracks.Item, index int) (file string, start, length float64, reason string) {
	take := item.Takes[index]
	if !take.SourceAvailable {
		return take.SourceFile, 0, 0, "This take's audio file is missing, so it cannot be heard or measured."
	}
	source, err := measure.TakeSourceRange(item, index)
	if err != nil {
		return take.SourceFile, 0, 0, "This take's range cannot be told exactly (" + err.Error() + ")."
	}
	return take.SourceFile, source.Range.StartSeconds, source.Range.LengthSeconds, ""
}

func (b *builder) itemTakes(item tracks.Item) {
	if len(item.Takes) < 2 {
		return
	}
	for index, take := range item.Takes {
		file, start, length, reason := takeRange(item, index)
		detail := fmt.Sprintf("Take %d of %d on this item · %s", index+1, len(item.Takes), fileName(file))
		b.add(Candidate{
			ID: "take:" + item.GUID + ":" + take.GUID, Source: SourceItemTake, Action: ActionMakeActive,
			Label: fmt.Sprintf("Take %d", index+1), Detail: detail, Active: index == item.ActiveTake,
			ItemGUID: item.GUID, TakeGUID: take.GUID, SourceFile: file, SourceStart: start, SourceLength: length,
			Usable: reason == "", Reason: reason,
		}, Choice{})
	}
}

func (b *builder) laneRetakes(track tracks.Track, target tracks.Item) {
	if !track.FixedLanes {
		return
	}
	line, _, ok := findLine(b.in.Project, target)
	if !ok {
		return
	}
	for _, retake := range line.Retakes {
		if retake.ItemGUID == target.GUID {
			continue
		}
		_, item, found := b.in.Project.ItemByGUID(retake.ItemGUID)
		if !found || len(item.Takes) == 0 || item.ActiveTake < 0 || item.ActiveTake >= len(item.Takes) {
			continue
		}
		file, start, length, reason := takeRange(item, item.ActiveTake)
		b.add(Candidate{
			ID: "lane:" + line.LineID + ":" + item.GUID, Source: SourceLaneRetake, Action: ActionPickLane,
			Label: fmt.Sprintf("Retake on lane %d", retake.Lane+1), Detail: fmt.Sprintf("%s · lane %d of %s · %s", item.Name, retake.Lane+1, line.TrackName, fileName(file)),
			Active: retake.Plays, ItemGUID: item.GUID, TakeGUID: item.Takes[item.ActiveTake].GUID,
			SourceFile: file, SourceStart: start, SourceLength: length, Usable: reason == "", Reason: reason,
		}, Choice{LineID: line.LineID})
	}
}

// findLine is the fixed-lane line item belongs to (retakelanes.Lines lists only lines on two or more lanes).
func findLine(project tracks.Project, item tracks.Item) (retakelanes.Line, retakelanes.Retake, bool) {
	lineID := item.Ext[retakelanes.LineIDKey]
	if lineID == "" {
		return retakelanes.Line{}, retakelanes.Retake{}, false
	}
	return retakelanes.Lines(project).Find(lineID, item.GUID)
}

func (b *builder) takeReviewReads(target tracks.Item) {
	for _, group := range b.in.Groups {
		members, ok := groupMembers(group)
		if !ok || !hasMemberOn(members, target.GUID) {
			continue
		}
		kind, _ := group.Evidence["kind"].(string)
		for index, member := range members {
			if member.ItemGUID == target.GUID || member.ItemGUID == "" || member.TakeGUID == "" {
				continue
			}
			read := takecompare.Read{ItemGUID: member.ItemGUID, TakeGUID: member.TakeGUID, SourceFile: member.SourceFile, SourceStart: member.SourceStart, SourceLength: member.SourceLength}
			reason := takecompare.CheckRead(b.in.Project, read)
			file := member.SourceFile
			if reason == "" {
				if _, item, found := b.in.Project.ItemByGUID(member.ItemGUID); found {
					for _, take := range item.Takes {
						if take.GUID == member.TakeGUID {
							file = take.SourceFile
						}
					}
				}
			}
			b.add(Candidate{
				ID: "read:" + group.ID + ":" + strconv.Itoa(index), Source: SourceTakeReview, Action: ActionAddAndActivate, Confirm: true,
				Label: "Read from another item", Detail: fmt.Sprintf("%s · found by Find pickups and duplicates%s", fileName(member.SourceFile), kindSuffix(kind)),
				ItemGUID: member.ItemGUID, TakeGUID: member.TakeGUID, SourceFile: file, SourceStart: member.SourceStart, SourceLength: member.SourceLength,
				Usable: reason == "", Reason: reason,
			}, Choice{FindingID: group.ID, SourceFile: file, RangeStart: member.SourceStart, RangeEnd: member.SourceStart + member.SourceLength})
		}
	}
}

func kindSuffix(kind string) string {
	if kind == "" {
		return ""
	}
	return " (" + strings.ReplaceAll(kind, "_", " ") + ")"
}

func groupMembers(group findings.Finding) ([]takecompare.Read, bool) {
	if group.Analyzer != takeReviewAnalyzer {
		return nil, false
	}
	var evidence struct {
		Members []takecompare.Read `json:"members"`
	}
	encoded, err := json.Marshal(group.Evidence)
	if err != nil || json.Unmarshal(encoded, &evidence) != nil {
		return nil, false
	}
	return evidence.Members, len(evidence.Members) > 0
}

func hasMemberOn(members []takecompare.Read, itemGUID string) bool {
	for _, member := range members {
		if member.ItemGUID == itemGUID {
			return true
		}
	}
	return false
}

// markCompared copies a saved comparison's per-take answer onto the candidates it covered.
func markCompared(candidates []Candidate, saved findings.Finding) {
	var evidence struct {
		Members []struct {
			ItemGUID          string   `json:"item_guid"`
			TakeGUID          string   `json:"take_guid"`
			Compared          bool     `json:"compared"`
			NotComparedReason string   `json:"not_compared_reason"`
			Fidelity          *float64 `json:"fidelity"`
		} `json:"members"`
	}
	encoded, err := json.Marshal(saved.Evidence)
	if err != nil || json.Unmarshal(encoded, &evidence) != nil {
		return
	}
	for i := range candidates {
		for _, member := range evidence.Members {
			if member.ItemGUID != candidates[i].ItemGUID || member.TakeGUID != candidates[i].TakeGUID {
				continue
			}
			candidates[i].Compared, candidates[i].Fidelity, candidates[i].NotComparedReason = member.Compared, member.Fidelity, member.NotComparedReason
		}
	}
}

// paragraphSpan is the range of the chapter's paragraphs the tokens [first, last] touch, in the paragraphs' order.
func paragraphSpan(view coverage.AlignmentView, first, last int) (int, int) {
	index := map[string]int{}
	for i, paragraph := range view.Paragraphs {
		index[paragraph.ID] = i
	}
	low, high := -1, -1
	for _, token := range view.Tokens[first : last+1] {
		if token.ParagraphID == nil {
			continue
		}
		i, ok := index[*token.ParagraphID]
		if !ok {
			continue
		}
		if low == -1 || i < low {
			low = i
		}
		if i > high {
			high = i
		}
	}
	return max(low, 0), max(high, 0)
}

// majorityItem is the item index most of the heard tokens sit on (the lowest when they tie), or false when none were heard.
func majorityItem(tokens []coverage.TokenLine) (int, bool) {
	counts := map[int]int{}
	for _, token := range tokens {
		if token.Item != nil {
			counts[*token.Item]++
		}
	}
	best, bestCount := -1, 0
	for item, count := range counts {
		if count > bestCount || (count == bestCount && item < best) {
			best, bestCount = item, count
		}
	}
	return best, bestCount > 0
}

func alignmentItemAt(items []coverage.AlignmentItem, index int) (coverage.AlignmentItem, bool) {
	for _, item := range items {
		if item.Index == index {
			return item, true
		}
	}
	return coverage.AlignmentItem{}, false
}

func fileName(path string) string {
	name := filepath.Base(strings.ReplaceAll(path, "\\", "/"))
	if name == "." || name == "/" {
		return path
	}
	return name
}
