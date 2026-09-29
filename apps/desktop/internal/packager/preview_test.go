package packager

import (
	"context"
	"reflect"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
)

// The preview must never disagree with the build: the same profile and chapters name the same files, in the same order.
func TestPreviewNamesTheFilesAssembleWrites(t *testing.T) {
	req := acxRequest(t)
	manifest, err := Assemble(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	var built []string
	for _, file := range manifest.Files {
		built = append(built, file.Name)
	}
	planned := Preview(req.Profile, []string{"Chapter One", "Chapter Two"}, ".mp3")
	var names []string
	for _, file := range planned {
		if file.Problem != "" {
			t.Fatalf("unexpected problem on %q: %s", file.Name, file.Problem)
		}
		names = append(names, file.Name)
	}
	if !reflect.DeepEqual(names, built) {
		t.Fatalf("preview = %q, build = %q", names, built)
	}
}

func TestPreviewOrdersOpeningChaptersClosingThenSample(t *testing.T) {
	planned := Preview(deliveryprofile.ACX(), []string{"Down the Rabbit-Hole", "The Pool of Tears"}, ".mp3")
	var kinds []Kind
	for _, file := range planned {
		kinds = append(kinds, file.Kind)
	}
	want := []Kind{KindCreditsOpening, KindChapter, KindChapter, KindCreditsClosing, KindRetailSample}
	if !reflect.DeepEqual(kinds, want) {
		t.Fatalf("kinds = %v, want %v", kinds, want)
	}
	if planned[1].Name != "01 - Down the Rabbit-Hole.mp3" || planned[2].Name != "02 - The Pool of Tears.mp3" {
		t.Fatalf("chapter names = %q, %q", planned[1].Name, planned[2].Name)
	}
	if planned[1].Title != "Down the Rabbit-Hole" || planned[0].Title != "" {
		t.Fatalf("titles = %q, %q", planned[1].Title, planned[0].Title)
	}
}

func TestPreviewLeavesOutWhatTheProfileTurnedOffAndFlagsAnUnusableTitle(t *testing.T) {
	profile := deliveryprofile.ACX()
	for i := range profile.Rules {
		if profile.Rules[i].Metric == "credits_files" || profile.Rules[i].Metric == "retail_sample_seconds" {
			profile.Rules[i].Off = true
		}
	}
	planned := Preview(profile, []string{"Fine", "Bad: title", ""}, ".mp3")
	if len(planned) != 3 {
		t.Fatalf("got %d files, want the 3 chapters only: %+v", len(planned), planned)
	}
	if planned[0].Problem != "" || planned[0].Name != "01 - Fine.mp3" {
		t.Fatalf("first = %+v", planned[0])
	}
	for _, file := range planned[1:] {
		if file.Problem == "" || !strings.Contains(file.Problem, "chapter") {
			t.Fatalf("expected a chapter problem, got %+v", file)
		}
	}
	if planned[1].Name != "" {
		t.Fatalf("a refused title keeps no name: %+v", planned[1])
	}
}
