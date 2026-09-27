// Package packager assembles one delivery profile's book checklist into a complete, correctly named package
// (render-encode-master PRD Phase 4): the encoded per-chapter files, credits and retail sample the profile's book
// rules ask for, copied - never moved, never touching a source file - into a narrator-chosen output folder (Q5),
// with a checklist saying which book rule each item satisfies. It never encodes anything itself: every input is
// already the Encoder port's own output (internal/encodeport); Assemble reads a deliveryprofile.Profile only to
// know what a complete book needs, never a concrete adapter, so a profile change needs no code change here for the
// rules it already recognizes.
//
// Per-file tag embedding, when a row is registered for a file's format (encodeport.Packagers, still empty in
// production - #509 D67: mock-first, a real row is a later swap), goes through that Packager port row; with none
// registered, Assemble copies the file as encoded and says so in the manifest, rather than guessing at tags itself.
package packager

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
	"github.com/countrymanprime/narration-utils/shell/internal/encodeport"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

// invalidTitleChars are characters Windows refuses in a file or path segment name, so a chapter title can never
// smuggle in a path segment of its own (mirrors internal/project's own project-name validation).
const invalidTitleChars = `<>:"/\|?*`

// Kind is what a delivery item is, for its place in the package and its checklist rule.
type Kind string

const (
	KindChapter        Kind = "chapter"
	KindCreditsOpening Kind = "credits_opening"
	KindCreditsClosing Kind = "credits_closing"
	KindRetailSample   Kind = "retail_sample"
)

// Item is one already-encoded delivery file (the Encoder port's own output) ready to package.
type Item struct {
	// Title names the item in the package: a chapter's title. Ignored for credits and the retail sample, which are
	// named for what they are, not narrator text.
	Title string
	// Path is the encoded source file. It is opened read-only and is never changed.
	Path string
}

// Request is what Assemble is asked to build: one profile's book checklist, the items the narrator has ready, and
// where to write the package.
type Request struct {
	Profile deliveryprofile.Profile
	// Chapters is one file per chapter, in book order (ACX's "one section per file" rule is satisfied by
	// construction: each chapter is already its own file).
	Chapters       []Item
	CreditsOpening *Item
	CreditsClosing *Item
	RetailSample   *Item
	// OutputDir is where the package is written: a narrator-chosen folder (Q5), never inside a project's own
	// narration-utils/ sidecar tree. Assemble creates it if it does not exist, and never overwrites a name already
	// in it.
	OutputDir string
	// Tags, when a Packager row exists for a file's format, are embedded into every file Assemble writes (title,
	// author, narrator, ...). Empty embeds none.
	Tags encodeport.Tags
	// Packagers is the registry Assemble asks for a row to embed Tags with, looked up by format, never by a
	// hard-coded name. Nil (or one with no matching row) copies files as encoded, unmodified, and says so in the
	// manifest (D67: mock-first; the registry is empty in production until a real row is added).
	Packagers *port.Registry[encodeport.Packager]
}

// ChecklistStatus is how one book-scope rule stands against what Assemble was given.
type ChecklistStatus string

const (
	ChecklistIncluded      ChecklistStatus = "included"
	ChecklistMissing       ChecklistStatus = "missing"
	ChecklistOff           ChecklistStatus = "off"
	ChecklistNotApplicable ChecklistStatus = "not_applicable"
)

// ChecklistItem is one book-scope rule's result against the package Assemble built or refused to build.
type ChecklistItem struct {
	RuleID string
	Label  string
	Status ChecklistStatus
	Detail string
}

// ManifestFile is one file Assemble wrote into the package.
type ManifestFile struct {
	Kind       Kind
	Name       string
	SourcePath string
	DestPath   string
	// Tagged is true when a Packager port row embedded Request.Tags into this file.
	Tagged bool
}

// Manifest is what one Assemble call wrote: the files, in the order written, and the book checklist they satisfy.
type Manifest struct {
	OutputDir string
	Files     []ManifestFile
	Checklist []ChecklistItem
}

// ErrMissingRequiredItem is Assemble's refusal when the profile's book checklist requires an item the request does
// not carry: it never ships an incomplete package silently.
var ErrMissingRequiredItem = errors.New("packager: a required delivery item is missing")

// ErrDestinationExists is Assemble's refusal when a name it would write is already in OutputDir: it never overwrites
// an earlier package.
var ErrDestinationExists = errors.New("packager: a file already exists at the destination")

// ErrSameFile is Assemble's refusal when a planned destination is the item's own source file.
var ErrSameFile = errors.New("packager: the packaged file would replace its own source")

// plannedFile is one item, already named and checked for a collision, waiting to be written.
type plannedFile struct {
	Kind Kind
	Name string
	Item Item
}

// Assemble builds one profile's complete delivery package from req's items, in req.OutputDir. It refuses, before
// writing anything, when a required book rule the profile has not turned off names an item req does not carry, when
// a planned name already exists in OutputDir, or when a planned destination is an item's own source file. Every file
// it writes is a new copy; no source file is ever changed.
func Assemble(ctx context.Context, req Request) (Manifest, error) {
	if len(req.Chapters) == 0 {
		return Manifest{}, errors.New("packager: at least one chapter is required")
	}
	if strings.TrimSpace(req.OutputDir) == "" {
		return Manifest{}, errors.New("packager: an output folder is required")
	}

	checklist := checklistFor(req)
	if missing := missingRequired(checklist); len(missing) > 0 {
		return Manifest{}, fmt.Errorf("%w: %s", ErrMissingRequiredItem, strings.Join(missing, "; "))
	}

	pending, err := plan(req)
	if err != nil {
		return Manifest{}, err
	}

	if err := os.MkdirAll(req.OutputDir, 0o755); err != nil {
		return Manifest{}, fmt.Errorf("could not create %q: %w", req.OutputDir, err)
	}

	manifest := Manifest{OutputDir: req.OutputDir, Checklist: checklist}
	for _, p := range pending {
		if err := ctx.Err(); err != nil {
			return Manifest{}, err
		}
		file, err := writeItem(ctx, req, p)
		if err != nil {
			return Manifest{}, err
		}
		manifest.Files = append(manifest.Files, file)
	}
	return manifest, nil
}

// checklistFor judges every book-scope rule of req.Profile against what req carries: off, included, missing, or not
// a packaging rule at all (judged by measurement instead, such as channels).
func checklistFor(req Request) []ChecklistItem {
	var out []ChecklistItem
	for _, rule := range req.Profile.Rules {
		if rule.Scope != deliveryprofile.ScopeBook {
			continue
		}
		out = append(out, checklistRule(req, rule))
	}
	return out
}

func checklistRule(req Request, rule deliveryprofile.Rule) ChecklistItem {
	item := ChecklistItem{RuleID: rule.ID, Label: rule.Label}
	switch {
	case rule.Off:
		item.Status, item.Detail = ChecklistOff, "Turned off in this profile: not required."
	case rule.Metric == "credits_files":
		if req.CreditsOpening == nil || req.CreditsClosing == nil {
			item.Status, item.Detail = ChecklistMissing, "Needs separate opening and closing credits files."
		} else {
			item.Status, item.Detail = ChecklistIncluded, "Opening and closing credits included as separate files."
		}
	case rule.Metric == "retail_sample_seconds":
		if req.RetailSample == nil {
			item.Status, item.Detail = ChecklistMissing, "Needs a retail sample file."
		} else {
			item.Status, item.Detail = ChecklistIncluded, "A retail sample is included."
		}
	case rule.Metric == "one_section_per_file":
		item.Status = ChecklistIncluded
		item.Detail = fmt.Sprintf("Each of the %d chapters is its own file.", len(req.Chapters))
	default:
		item.Status, item.Detail = ChecklistNotApplicable, "Not a packaging rule: judged by measurement, not by what files are present."
	}
	return item
}

// missingRequired is every required book rule's checklist line reading Missing, worded for a refusal.
func missingRequired(checklist []ChecklistItem) []string {
	var out []string
	for _, item := range checklist {
		if item.Status == ChecklistMissing {
			out = append(out, fmt.Sprintf("%s (%s)", item.Label, item.Detail))
		}
	}
	return out
}

// plan names every item Assemble would write and checks it for a collision, before anything is written: a
// destination already in OutputDir, or one that is an item's own source file.
func plan(req Request) ([]plannedFile, error) {
	var pending []plannedFile
	if req.CreditsOpening != nil {
		pending = append(pending, plannedFile{Kind: KindCreditsOpening, Name: "Credits, Opening" + ext(req.CreditsOpening.Path), Item: *req.CreditsOpening})
	}
	for i, chapter := range req.Chapters {
		name, err := chapterFileName(i+1, chapter.Title, ext(chapter.Path))
		if err != nil {
			return nil, err
		}
		pending = append(pending, plannedFile{Kind: KindChapter, Name: name, Item: chapter})
	}
	if req.CreditsClosing != nil {
		pending = append(pending, plannedFile{Kind: KindCreditsClosing, Name: "Credits, Closing" + ext(req.CreditsClosing.Path), Item: *req.CreditsClosing})
	}
	if req.RetailSample != nil {
		pending = append(pending, plannedFile{Kind: KindRetailSample, Name: "Retail Sample" + ext(req.RetailSample.Path), Item: *req.RetailSample})
	}
	for _, p := range pending {
		if p.Item.Path == "" {
			return nil, fmt.Errorf("packager: %s has no source file", p.Kind)
		}
		if err := checkDestination(req.OutputDir, p); err != nil {
			return nil, err
		}
	}
	return pending, nil
}

func checkDestination(outputDir string, p plannedFile) error {
	source, err := filepath.Abs(p.Item.Path)
	if err != nil {
		return err
	}
	dest, err := filepath.Abs(filepath.Join(outputDir, p.Name))
	if err != nil {
		return err
	}
	if source == dest || (runtime.GOOS == "windows" && strings.EqualFold(source, dest)) {
		return fmt.Errorf("%w: %s", ErrSameFile, p.Name)
	}
	if _, err := os.Stat(dest); err == nil {
		return fmt.Errorf("%w: %s", ErrDestinationExists, p.Name)
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// chapterFileName is a chapter's file name: its 1-based position, its title, then the source's own extension. The
// title is refused, not silently stripped, when it holds a character a file name cannot: a narrator who sees the
// name should always recognize it.
func chapterFileName(number int, title, extension string) (string, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return "", fmt.Errorf("packager: chapter %d has no title", number)
	}
	if strings.ContainsAny(title, invalidTitleChars) {
		return "", fmt.Errorf("packager: chapter %d's title %q cannot be used in a file name (it holds one of %s)", number, title, invalidTitleChars)
	}
	for _, r := range title {
		if r < 0x20 {
			return "", fmt.Errorf("packager: chapter %d's title cannot hold control characters", number)
		}
	}
	return fmt.Sprintf("%02d - %s%s", number, title, extension), nil
}

// writeItem writes one already-planned item: tagged through a Packager port row when one matches its format and
// req.Tags is not empty, otherwise copied as encoded. The item's own source file is only ever opened read-only.
func writeItem(ctx context.Context, req Request, p plannedFile) (ManifestFile, error) {
	dest, err := filepath.Abs(filepath.Join(req.OutputDir, p.Name))
	if err != nil {
		return ManifestFile{}, err
	}

	copyFrom := p.Item.Path
	tagged := false
	if entry, ok := packagerFor(req.Packagers, formatOf(p.Item.Path)); ok && len(req.Tags) > 0 {
		packaged, err := entry.New().Package(ctx, p.Item.Path, nil, req.Tags)
		if err != nil {
			return ManifestFile{}, fmt.Errorf("could not tag %q: %w", p.Name, err)
		}
		defer func() { _ = os.Remove(packaged) }() // the Packager row's own new copy is a scratch step; Assemble's own name at dest is the real output
		copyFrom, tagged = packaged, true
	}
	if err := copyFile(copyFrom, dest); err != nil {
		return ManifestFile{}, err
	}
	return ManifestFile{Kind: p.Kind, Name: p.Name, SourcePath: p.Item.Path, DestPath: dest, Tagged: tagged}, nil
}

// packagerFor is the first registered row that declares format, or false when none does (an empty or nil registry,
// D67: production ships with none registered yet).
func packagerFor(registry *port.Registry[encodeport.Packager], format string) (port.Entry[encodeport.Packager], bool) {
	if registry == nil {
		return port.Entry[encodeport.Packager]{}, false
	}
	for _, entry := range registry.Entries() {
		if entry.Descriptor.Supports(format) {
			return entry, true
		}
	}
	return port.Entry[encodeport.Packager]{}, false
}

// ext is path's extension, with its dot, as encodeport's own rows already write it (lower case); used to name a
// package's files after their source's own format.
func ext(path string) string { return filepath.Ext(path) }

// formatOf is path's extension, lower case and without its dot, matching a Packager row's Descriptor.Modes.
func formatOf(path string) string {
	return strings.ToLower(strings.TrimPrefix(filepath.Ext(path), "."))
}

// copyFile writes a new file at dst from src's bytes. src is opened read-only and is never changed; a failure part
// way through removes whatever copyFile itself had started writing at dst.
func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer func() { _ = in.Close() }() // read-only
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		_ = os.Remove(dst)
		return err
	}
	if err := out.Close(); err != nil {
		_ = os.Remove(dst)
		return err
	}
	return nil
}
