package takecompare

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

// manifestSchemaVersion is the --take-divergence manifest schema this package writes.
const manifestSchemaVersion = 1

// notHeardReason is why an aligned take that matched none of the span's words is left out of the comparison: it does
// not read this part of the script, so setting its evidence beside the others would compare different text.
const notHeardReason = "None of this part of the script was heard in this take, so it is not compared with the others."

// Request is one comparison's inputs, all from the host: the group as the store holds it, the project as it is saved,
// and the manuscript chapter the group's span belongs to.
type Request struct {
	Group          findings.Finding
	Project        tracks.Project
	ProjectPath    string
	ManuscriptPath string
	// ChapterID is the canonical manuscript chapter id the group's sentence numbers belong to.
	ChapterID string
	Model     string
	Language  string
	// ProgressPath is handed to the sidecar for its real progress (ADR 0015); empty runs it without.
	ProgressPath string
	// SessionDir is where the manifest is written.
	SessionDir string
}

// Comparer compares a group's takes and saves the comparison.
type Comparer struct {
	Runner SidecarRunner
	Store  *findings.Store
}

// Compare runs one comparison and answers the saved take_comparison finding (with any decision carried forward).
func (c *Comparer) Compare(ctx context.Context, req Request) (findings.Finding, error) {
	if c.Store == nil || c.Runner == nil {
		return findings.Finding{}, fmt.Errorf("takecompare: the comparison is not configured")
	}
	group, err := GroupOf(req.Group)
	if err != nil {
		return findings.Finding{}, err
	}
	reads := make([]resolvedRead, len(group.Reads))
	var compared []int
	for i, read := range group.Reads {
		reads[i] = resolveRead(req.Project, read)
		if reads[i].Reason == "" {
			compared = append(compared, i)
		}
	}
	if len(compared) < minReads {
		return findings.Finding{}, fmt.Errorf("fewer than two of this group's reads are still in the saved REAPER project as the scan found them; save the project in REAPER and scan the chapter again")
	}

	results, err := c.align(ctx, req, group, reads, compared)
	if err != nil {
		return findings.Finding{}, err
	}
	evidence := buildEvidence(group, reads, compared, results)
	manuscript := group.Manuscript
	manuscript.ChapterID, manuscript.ChapterTitle = results.Header.ChapterID, results.Header.ChapterTitle
	finding, err := ToFinding(group, req.ProjectPath, manuscript, evidence)
	if err != nil {
		return findings.Finding{}, fmt.Errorf("takecompare: the comparison is not a valid finding: %w", err)
	}
	saved, err := c.Store.SaveAnalyzerFindings(AnalyzerName, group.ID, []findings.Finding{finding})
	if err != nil {
		return findings.Finding{}, err
	}
	for _, f := range saved {
		if f.ID == finding.ID {
			return f, nil
		}
	}
	return finding, nil
}

// align writes the manifest for the compared reads, runs the sidecar and checks its answer is about the same span and
// the same takes, in the same order (same-span validation, second half).
func (c *Comparer) align(ctx context.Context, req Request, group Group, reads []resolvedRead, compared []int) (Results, error) {
	manifestPath, cleanup, err := writeManifest(req.SessionDir, req.ChapterID, group, reads, compared)
	if err != nil {
		return Results{}, err
	}
	defer cleanup()
	raw, err := c.Runner.TakeDivergence(ctx, SidecarRequest{
		ManifestPath: manifestPath, ManuscriptPath: req.ManuscriptPath, Model: req.Model, Language: req.Language, ProgressPath: req.ProgressPath,
	})
	if err != nil {
		return Results{}, err
	}
	results, err := ParseResults(raw)
	if err != nil {
		return Results{}, fmt.Errorf("takecompare: %w", err)
	}
	span := results.Header.Span
	switch {
	case span.FirstUnit != group.FirstUnit || span.LastUnit != group.LastUnit:
		return Results{}, fmt.Errorf("takecompare: the takes were aligned to sentences %d-%d, not the group's %d-%d", span.FirstUnit, span.LastUnit, group.FirstUnit, group.LastUnit)
	case len(results.Takes) != len(compared):
		return Results{}, fmt.Errorf("takecompare: the aligner answered for %d takes, not %d", len(results.Takes), len(compared))
	}
	for position, index := range compared {
		read, take := reads[index].Read, results.Takes[position]
		if take.ItemGUID != read.ItemGUID || take.TakeGUID != read.TakeGUID {
			return Results{}, fmt.Errorf("takecompare: the aligner's take %d is not the take that was asked for", position+1)
		}
	}
	return results, nil
}

type manifestTake struct {
	ItemGUID    string  `json:"itemGuid"`
	TakeGUID    string  `json:"takeGuid"`
	SourceFile  string  `json:"sourceFile"`
	StartOffset float64 `json:"startOffset"`
	Length      float64 `json:"length"`
}

// writeManifest writes the --take-divergence manifest into the session folder. Every take in it comes from the saved
// project (its own GUIDs, file, offset and length), never from the finding's text or the UI (threat model 4f).
func writeManifest(dir, chapterID string, group Group, reads []resolvedRead, compared []int) (string, func(), error) {
	takes := make([]manifestTake, 0, len(compared))
	for _, index := range compared {
		read := reads[index]
		take := read.Item.Takes[read.TakeIndex]
		rate := take.PlayRate
		if rate == 0 {
			rate = 1
		}
		takes = append(takes, manifestTake{ItemGUID: read.Item.GUID, TakeGUID: take.GUID, SourceFile: take.SourceFile, StartOffset: take.SOFFS, Length: read.Item.Length * rate})
	}
	manifest := map[string]any{
		"schemaVersion": manifestSchemaVersion,
		"chapterId":     chapterID,
		"span":          map[string]int{"firstUnit": group.FirstUnit, "lastUnit": group.LastUnit},
		"takes":         takes,
	}
	encoded, err := json.Marshal(manifest)
	if err != nil {
		return "", nil, fmt.Errorf("takecompare: could not write the comparison manifest: %w", err)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", nil, fmt.Errorf("takecompare: could not create the comparison session folder: %w", err)
	}
	file, err := os.CreateTemp(dir, "take-comparison-manifest-*.json")
	if err != nil {
		return "", nil, fmt.Errorf("takecompare: could not create the comparison manifest: %w", err)
	}
	cleanup := func() { _ = os.Remove(file.Name()) }
	_, err = file.Write(encoded)
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		cleanup()
		return "", nil, fmt.Errorf("takecompare: could not write the comparison manifest: %w", err)
	}
	return file.Name(), cleanup, nil
}

// buildEvidence sets each read's alignment and measurements beside the others, in the group's order.
func buildEvidence(group Group, reads []resolvedRead, compared []int, results Results) Evidence {
	evidence := Evidence{
		SourceFindingID: group.ID,
		Span:            SpanEvidence{FirstUnit: results.Header.Span.FirstUnit, LastUnit: results.Header.Span.LastUnit, Words: results.Header.Span.Words},
		Model:           results.Header.Model,
		Members:         make([]TakeEvidence, len(reads)),
	}
	for i, read := range reads {
		evidence.Members[i] = notCompared(read.Read, read.Reason)
	}
	levels := neighborLevels{}
	for position, index := range compared {
		take := results.Takes[position]
		if take.Counts.Matched == 0 {
			evidence.Members[index] = notCompared(reads[index].Read, notHeardReason)
			continue
		}
		evidence.Members[index] = comparedTake(reads[index], take, results.Header.Span, levels)
		evidence.Compared++
	}
	return evidence
}

func notCompared(read Read, reason string) TakeEvidence {
	return TakeEvidence{
		ItemGUID: read.ItemGUID, TakeGUID: read.TakeGUID, SourceFile: read.SourceFile, SourceStart: read.SourceStart, SourceLength: read.SourceLength,
		NotComparedReason: reason, Words: []WordEvidence{}, Divergences: []DivergenceEvidence{},
	}
}

func comparedTake(read resolvedRead, take TakeDivergence, span Span, levels neighborLevels) TakeEvidence {
	evidence := notCompared(read.Read, "")
	fidelity := take.Fidelity
	evidence.Compared, evidence.Fidelity = true, &fidelity
	evidence.Counts, evidence.Words, evidence.Divergences = alignmentEvidence(take)
	metrics, err := measure.MeasureTake(measure.TakeInput{
		Item: read.Item, TakeIndex: read.TakeIndex, Words: takeWords(span, take), Neighbors: levels.around(read.Track, read.Item),
	})
	if err == nil {
		evidence.Metrics = &metrics
	}
	return evidence
}

// takeWords are the span words the take has a time for, as MeasureTake reads a transcript: from the start of the take's
// range, in order. They are the words of this part of the script, so the pause profile is the take's pauses over it.
func takeWords(span Span, take TakeDivergence) []measure.Word {
	words := []measure.Word{}
	for _, state := range take.Words {
		if state.Start == nil || state.End == nil {
			continue
		}
		start, end := max(0, *state.Start-take.StartOffset), max(0, *state.End-take.StartOffset)
		words = append(words, measure.Word{Text: span.Words[state.Index].Text, StartSeconds: start, EndSeconds: max(start, end)})
	}
	sort.SliceStable(words, func(i, j int) bool { return words[i].StartSeconds < words[j].StartSeconds })
	return words
}

// neighborLevels measures, once per item, the integrated loudness of the items either side of a take's item on its
// track (their active takes), the reference level consistency is measured against (ADR 0140).
type neighborLevels map[string]*float64

func (levels neighborLevels) around(track tracks.Track, item tracks.Item) []measure.NeighborLevel {
	items := append([]tracks.Item(nil), track.Items...)
	sort.SliceStable(items, func(i, j int) bool { return items[i].Position < items[j].Position })
	var neighbors []measure.NeighborLevel
	for i, candidate := range items {
		if candidate.GUID != item.GUID {
			continue
		}
		for _, j := range []int{i - 1, i + 1} {
			if j >= 0 && j < len(items) && items[j].GUID != "" {
				neighbors = append(neighbors, measure.NeighborLevel{ItemGUID: items[j].GUID, IntegratedLUFS: levels.of(items[j])})
			}
		}
		break
	}
	return neighbors
}

func (levels neighborLevels) of(item tracks.Item) *float64 {
	if level, ok := levels[item.GUID]; ok {
		return level
	}
	levels[item.GUID] = integratedLoudness(item)
	return levels[item.GUID]
}

// integratedLoudness is an item's active take's integrated loudness, or nil when it cannot be measured.
func integratedLoudness(item tracks.Item) *float64 {
	if item.ActiveTake < 0 || item.ActiveTake >= len(item.Takes) {
		return nil
	}
	take := item.Takes[item.ActiveTake]
	source, err := measure.TakeSourceRange(item, item.ActiveTake)
	if err != nil || source.Kind != "WAVE" || !take.SourceAvailable {
		return nil
	}
	report, err := measure.AnalyzeFileRange(filepath.Clean(source.File), source.Range)
	if err != nil {
		return nil
	}
	return report.IntegratedLUFS
}
