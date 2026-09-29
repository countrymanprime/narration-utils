package packager

import (
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
)

// The one place a package's file names are written. plan (what Assemble writes) and Preview (what Master & QC lists
// before anything is built) both call these, so the list a narrator reads cannot disagree with the package.
func creditsOpeningName(extension string) string { return "Credits, Opening" + extension }
func creditsClosingName(extension string) string { return "Credits, Closing" + extension }
func retailSampleName(extension string) string   { return "Retail Sample" + extension }

// PlannedFile is one file a package will hold, named before any source exists.
type PlannedFile struct {
	Kind Kind
	// Title is the chapter's title for a chapter, empty for credits and the retail sample.
	Title string
	// Name is the file name, empty when Problem says the title cannot be used in one.
	Name    string
	Problem string
}

// Preview names every file profile's package will hold for chapterTitles in book order, encoded as extension (with
// its dot): the opening credits, one file per chapter, the closing credits and the retail sample, leaving out the
// credits or sample when the profile turned that rule off. It applies the same rules as Assemble's plan, so a chapter
// whose title Assemble would refuse comes back with a Problem instead of a Name.
func Preview(profile deliveryprofile.Profile, chapterTitles []string, extension string) []PlannedFile {
	wants := func(metric string) bool {
		for _, rule := range profile.Rules {
			if rule.Scope == deliveryprofile.ScopeBook && rule.Metric == metric && !rule.Off {
				return true
			}
		}
		return false
	}
	var files []PlannedFile
	credits := wants("credits_files")
	if credits {
		files = append(files, PlannedFile{Kind: KindCreditsOpening, Name: creditsOpeningName(extension)})
	}
	for i, title := range chapterTitles {
		file := PlannedFile{Kind: KindChapter, Title: title}
		name, err := chapterFileName(i+1, title, extension)
		if err != nil {
			file.Problem = strings.TrimPrefix(err.Error(), "packager: ")
		} else {
			file.Name = name
		}
		files = append(files, file)
	}
	if credits {
		files = append(files, PlannedFile{Kind: KindCreditsClosing, Name: creditsClosingName(extension)})
	}
	if wants("retail_sample_seconds") {
		files = append(files, PlannedFile{Kind: KindRetailSample, Name: retailSampleName(extension)})
	}
	return files
}
