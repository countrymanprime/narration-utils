package teleprompter

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

// Punch and roll's word-to-time anchors (teleprompter-manuscript-integration.prd.md Phase 12, ADR 0246, owner decision
// 2026-09-23: live anchors first, offline alignment as the fallback). While a live session reads a chapter, the host
// polls REAPER's play position (bridge.Puncher.PlayPosition, from apps/desktop's own poll loop, never from this
// DAW-agnostic package) and pairs it with the word the reader is on, appending an Anchor here. "Punch from here" on a
// flag then asks ResolveWordTime for that word's project time before moving the cursor.
//
// This file only reads and writes the anchors file and resolves a word from what it holds; it has no REAPER
// dependency, so a fake project directory is enough to test it.

// anchorsSchemaVersion is an anchors file's version. A file with another version reads as empty (no anchors), the
// same "drop rather than misplace" rule reading.go uses for a Reading.
const anchorsSchemaVersion = 1

// Anchor pairs a script word index (a position event's `read`/`committed` index space) with the REAPER project time,
// in seconds, the host measured for it (bridge.PlayPosition.Heard, the position the narrator hears, per spike 1's
// still-open choice of which play position to sample; see teleprompter-manuscript-integration.prd.md Phase 12).
type Anchor struct {
	Word     int     `json:"word"`
	Position float64 `json:"position"`
}

// anchorsFile is what AnchorsPath holds for one chapter.
type anchorsFile struct {
	Version   int      `json:"version"`
	ChapterID string   `json:"chapterId"`
	Anchors   []Anchor `json:"anchors"`
}

// AnchorsDir is where a project's anchors files live, beside its readings (reading.go's ReadingDir).
func AnchorsDir(project string) string {
	return ReadingDir(project)
}

// anchorsFileName is chapterID's anchors file name, the same plain-or-hashed naming reading.go uses for a Reading, so
// no chapter id, whatever its characters, ever names a path.
func anchorsFileName(chapterID string) string {
	if plainID.MatchString(chapterID) {
		return chapterID + ".anchors.json"
	}
	return "id-" + hashedChapterID(chapterID) + ".anchors.json"
}

// LoadAnchors returns chapterID's anchors, oldest word first, or none when there is no file, a corrupt one or one of
// another version. Only an unreadable-but-present file is an error, as LoadReading does for a Reading.
func LoadAnchors(project, chapterID string) ([]Anchor, error) {
	raw, err := os.ReadFile(filepath.Join(AnchorsDir(project), anchorsFileName(chapterID)))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("could not read the punch anchors: %w", err)
	}
	var file anchorsFile
	if json.Unmarshal(raw, &file) != nil || file.Version != anchorsSchemaVersion || file.ChapterID != chapterID {
		return nil, nil
	}
	return file.Anchors, nil
}

// writeAnchors replaces chapterID's anchors file with anchors, through a temp file and a rename (WriteReading's own
// pattern). An empty list still writes a (near-empty) file, so DropAnchorsFrom can clear a punched word's anchors
// rather than leaving stale ones behind.
func writeAnchors(project, chapterID string, anchors []Anchor) error {
	if project == "" {
		return errors.New("no project is open")
	}
	file := anchorsFile{Version: anchorsSchemaVersion, ChapterID: chapterID, Anchors: anchors}
	bytes, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	dir := AnchorsDir(project)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("could not create the teleprompter folder: %w", err)
	}
	path := filepath.Join(dir, anchorsFileName(chapterID))
	temp := path + ".tmp"
	if err := os.WriteFile(temp, bytes, 0o600); err != nil {
		return fmt.Errorf("could not write the punch anchors: %w", err)
	}
	if err := os.Rename(temp, path); err != nil {
		return fmt.Errorf("could not activate the punch anchors: %w", err)
	}
	return nil
}

// AppendAnchor adds one (word, position) anchor for chapterID: a later anchor for a word already held replaces it
// (the poll's freshest reading of that word wins), and the file stays sorted by word and capped at maxAnchors so a
// long chapter's file never grows without bound (the oldest anchors are dropped first, since ResolveWordTime only
// ever needs the ones nearest the word being resolved).
func AppendAnchor(project, chapterID string, anchor Anchor) error {
	anchors, err := LoadAnchors(project, chapterID)
	if err != nil {
		return err
	}
	replaced := false
	for i, existing := range anchors {
		if existing.Word == anchor.Word {
			anchors[i] = anchor
			replaced = true
			break
		}
	}
	if !replaced {
		anchors = append(anchors, anchor)
	}
	sort.Slice(anchors, func(i, j int) bool { return anchors[i].Word < anchors[j].Word })
	if len(anchors) > maxAnchors {
		anchors = anchors[len(anchors)-maxAnchors:]
	}
	return writeAnchors(project, chapterID, anchors)
}

// maxAnchors bounds an anchors file: about ten minutes of polling at the poll loop's own interval (punchPollInterval,
// apps/desktop's own poller), comfortably more than ResolveWordTime ever needs to bracket or extrapolate from.
const maxAnchors = 400

// DropAnchorsFrom removes every anchor at or after word: a punch to word is the narrator about to re-record from
// there, so an anchor recorded during the take being replaced would misplace the next punch (teleprompter-manuscript-
// integration.prd.md Phase 12, "anchors at or after word N dropped after a punch at N").
func DropAnchorsFrom(project, chapterID string, word int) error {
	anchors, err := LoadAnchors(project, chapterID)
	if err != nil {
		return err
	}
	kept := anchors[:0]
	for _, anchor := range anchors {
		if anchor.Word < word {
			kept = append(kept, anchor)
		}
	}
	return writeAnchors(project, chapterID, kept)
}

// Anchor and alignment are ResolveWordTime's two sources, matching Phase 12's "resolved time, its source (anchor or
// alignment) and pre-roll" UI requirement.
const (
	SourceAnchor    = "anchor"
	SourceAlignment = "alignment"
)

// ResolveWordTime finds word's project time from anchors. An exact anchor, or one interpolated between the anchors
// immediately before and after word, is SourceAnchor. A word outside every anchor's range is extrapolated from the
// anchors' overall pace (SourceAlignment): a stand-in for a real offline re-decode with word-level timestamps, which
// needs a sidecar mode this phase does not build (see the PRD's Phase 12 "offline alignment... over the resolved
// range" and its remaining-scope note); the extrapolation at least keeps "Punch from here" working between and
// slightly beyond anchors, while a genuine offline pass is a documented follow-up. ok is false with fewer than two
// anchors (nothing to interpolate or extrapolate from): the caller falls back to "Pick a word" instead of guessing.
func ResolveWordTime(anchors []Anchor, word int) (position float64, source string, ok bool) {
	if len(anchors) == 0 {
		return 0, "", false
	}
	sorted := append([]Anchor(nil), anchors...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Word < sorted[j].Word })

	var before, after *Anchor
	for i := range sorted {
		if sorted[i].Word == word {
			return sorted[i].Position, SourceAnchor, true
		}
		if sorted[i].Word < word {
			before = &sorted[i]
		}
		if sorted[i].Word > word && after == nil {
			after = &sorted[i]
		}
	}
	if before != nil && after != nil {
		fraction := float64(word-before.Word) / float64(after.Word-before.Word)
		return before.Position + fraction*(after.Position-before.Position), SourceAnchor, true
	}
	if len(sorted) < 2 {
		return 0, "", false
	}
	first, last := sorted[0], sorted[len(sorted)-1]
	if first.Word == last.Word {
		return 0, "", false
	}
	pace := (last.Position - first.Position) / float64(last.Word-first.Word)
	var anchor Anchor
	if before != nil {
		anchor = *before
	} else {
		anchor = *after
	}
	position = anchor.Position + pace*float64(word-anchor.Word)
	if position < 0 {
		position = 0
	}
	return position, SourceAlignment, true
}
