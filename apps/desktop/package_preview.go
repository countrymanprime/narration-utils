package main

import (
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
	"github.com/countrymanprime/narration-utils/shell/internal/packager"
)

// PackagePreviewFile is one file the package will create, as Master & QC lists it before anything is built. Kind is one of
// packager.Kind's values, kept a plain string on the wire (see PackageItem). Name is empty when Problem says why the chapter's
// title cannot be used in a file name.
type PackagePreviewFile struct {
	Kind    string `json:"kind"`
	Title   string `json:"title"`
	Name    string `json:"name"`
	Problem string `json:"problem"`
}

// PackagePreviewAnswer is the package a delivery profile would build for this project: the format its files are encoded in and
// every file with the name it will have. Files is empty, with Problem saying why, when the project has no manuscript to name
// chapters from.
type PackagePreviewAnswer struct {
	Profile  string               `json:"profile"`
	Platform string               `json:"platform"`
	Format   string               `json:"format"`
	Files    []PackagePreviewFile `json:"files"`
	Problem  string               `json:"problem"`
}

// packagePreview names the files profile's package will hold for the project's narration chapters. It calls packager.Preview,
// the same naming Assemble writes with, so the list cannot disagree with the package. A chapter is named by its subtitle when it
// has one ("Down the Rabbit-Hole") and by its title otherwise ("Chapter 2"), the way the delivery mock reads.
func (h *Host) packagePreview(profileID, profileVersion string) (PackagePreviewAnswer, error) {
	resolve := h.resolveProfile
	if resolve == nil {
		resolve = h.profileStore().Resolve
	}
	profile, found, err := resolve(deliveryprofile.Ref{ID: profileID, Version: profileVersion})
	if err != nil {
		return PackagePreviewAnswer{}, err
	}
	if !found {
		return PackagePreviewAnswer{}, fmt.Errorf("there is no delivery profile %q", profileID)
	}
	format := requiredFormat(profile)
	answer := PackagePreviewAnswer{Profile: profile.ID, Platform: profile.Platform, Format: format, Files: []PackagePreviewFile{}}
	data, err := h.services().manuscript.Load()
	if err != nil {
		answer.Problem = err.Error()
		return answer, nil
	}
	var titles []string
	for _, chapter := range narrationChapters(data) {
		title := chapter.Subtitle
		if title == "" {
			title = chapter.Heading
		}
		titles = append(titles, title)
	}
	if len(titles) == 0 {
		answer.Problem = "the manuscript has no narration chapters"
		return answer, nil
	}
	for _, file := range packager.Preview(profile, titles, "."+format) {
		answer.Files = append(answer.Files, PackagePreviewFile{Kind: string(file.Kind), Title: file.Title, Name: file.Name, Problem: file.Problem})
	}
	return answer, nil
}
