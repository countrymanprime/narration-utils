package main

import (
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
)

func previewNames(answer PackagePreviewAnswer) []string {
	var names []string
	for _, file := range answer.Files {
		names = append(names, file.Name)
	}
	return names
}

func TestPackagePreviewNamesTheACXFilesForTheProjectsNarrationChapters(t *testing.T) {
	host := hostWithExtras(t, 10)
	acx := deliveryprofile.ACX()

	answer, err := host.packagePreview(acx.ID, acx.Version)
	if err != nil {
		t.Fatal(err)
	}

	want := "Credits, Opening.mp3|01 - Down the Rabbit-Hole.mp3|02 - Chapter 2.mp3|Credits, Closing.mp3|Retail Sample.mp3"
	if got := strings.Join(previewNames(answer), "|"); got != want {
		t.Fatalf("names = %s, want %s (front matter and reference chapters are not files)", got, want)
	}
	if answer.Format != "mp3" || answer.Platform != acx.Platform || answer.Problem != "" {
		t.Fatalf("answer = %+v", answer)
	}
}

func TestPackagePreviewWithoutAManuscriptListsNothingAndSaysWhy(t *testing.T) {
	host := hostWithCredits(t)
	host.manuscript.SetProject(host.config.projectFolder)
	acx := deliveryprofile.ACX()

	answer, err := host.packagePreview(acx.ID, acx.Version)
	if err != nil {
		t.Fatal(err)
	}
	if len(answer.Files) != 0 || !strings.Contains(answer.Problem, "manuscript") {
		t.Fatalf("answer = %+v, want no files and a manuscript problem", answer)
	}
}

func TestPackagePreviewRefusesAnUnknownProfile(t *testing.T) {
	host := hostWithExtras(t, 10)
	if _, err := host.packagePreview("no-such-profile", ""); err == nil {
		t.Fatal("want an error for an unknown profile")
	}
}

func TestPackagePreviewFollowsTheProfilesFormat(t *testing.T) {
	host := hostWithExtras(t, 10)
	host.resolveProfile = resolverFor(m4bProfile("m4b"))

	answer, err := host.packagePreview("m4b", "")
	if err != nil {
		t.Fatal(err)
	}
	if answer.Format != "m4b" || strings.Join(previewNames(answer), "|") != "01 - Down the Rabbit-Hole.m4b|02 - Chapter 2.m4b" {
		t.Fatalf("answer = %+v", answer)
	}
}

func TestContractPackagePreview(t *testing.T) {
	host := hostWithExtras(t, 10)
	acx := deliveryprofile.ACX()
	answer, err := host.packagePreview(acx.ID, acx.Version)
	if err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "package-preview", answer)

	empty := hostWithCredits(t)
	empty.manuscript.SetProject(empty.config.projectFolder)
	none, err := empty.packagePreview(acx.ID, acx.Version)
	if err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "package-preview-no-manuscript", none)
}
