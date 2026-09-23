package importer

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"testing"
)

// headingMisreadCase is one entry of tests/fixtures/heading-misreads/cases.json: a constructed manuscript whose chapter heading
// exercises the title/subtitle heuristic, what the author meant, and what the importer produced when the case was written
// (story-bible-and-import-ux-briefs PRD, Phase 4; docs/research/import-heading-misreads.md).
type headingMisreadCase struct {
	ID       string `json:"id"`
	File     string `json:"file"`
	Mode     string `json:"mode"`
	Intended struct {
		Title    string `json:"title"`
		Subtitle string `json:"subtitle"`
	} `json:"intended"`
	Observed struct {
		ChapterTitles  []string `json:"chapterTitles"`
		Title          string   `json:"title"`
		Subtitle       string   `json:"subtitle"`
		FirstParagraph string   `json:"firstParagraph"`
	} `json:"observed"`
	// Override is the per-heading subtitle choice that reads the case as intended (Phase 5), on the cases it can fix.
	Override *struct {
		SecondLineIsSubtitle bool   `json:"secondLineIsSubtitle"`
		FirstParagraph       string `json:"firstParagraph"`
	} `json:"override"`
}

const headingMisreadsDir = "heading-misreads"

func loadHeadingMisreadCases(t *testing.T) []headingMisreadCase {
	t.Helper()
	raw, err := os.ReadFile(fixture(headingMisreadsDir + "/cases.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		Cases []headingMisreadCase `json:"cases"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	return manifest.Cases
}

// TestHeadingMisreadFixtures pins the importer's current reading of every constructed heading case, so the failure modes the
// research note documents stay real: a heuristic change that alters one of them fails here, and the case, the note and (for a
// fix) the subtitle override's own tests move together.
func TestHeadingMisreadFixtures(t *testing.T) {
	cases := loadHeadingMisreadCases(t)
	if len(cases) == 0 {
		t.Fatal("cases.json lists no cases")
	}
	for _, testCase := range cases {
		t.Run(testCase.ID, func(t *testing.T) {
			draft, err := BuildDraft(fixture(headingMisreadsDir+"/"+testCase.File), 1)
			if err != nil {
				t.Fatal(err)
			}
			observed := testCase.Observed
			if !slices.Equal(draft.ChapterTitles, observed.ChapterTitles) {
				t.Fatalf("chapter titles = %q, want %q", draft.ChapterTitles, observed.ChapterTitles)
			}
			title, subtitle := firstChapterHeading(draft, observed.ChapterTitles[0])
			if title != observed.Title || subtitle != observed.Subtitle {
				t.Fatalf("heading = %q / %q, want %q / %q", title, subtitle, observed.Title, observed.Subtitle)
			}
			if first := firstParagraphOf(draft, observed.ChapterTitles[0]); first != observed.FirstParagraph {
				t.Fatalf("first paragraph = %q, want %q", first, observed.FirstParagraph)
			}
			isControl := testCase.Mode == "control"
			readCorrectly := title == testCase.Intended.Title && subtitle == testCase.Intended.Subtitle
			if isControl != readCorrectly {
				t.Fatalf("mode %q but the heading was read as %q / %q against the intended %q / %q", testCase.Mode, title, subtitle, testCase.Intended.Title, testCase.Intended.Subtitle)
			}
		})
	}
}

// TestHeadingMisreadOverrides applies each case's subtitle override the way the commit does and expects what the author meant: the
// wrapped titles (F1) join back together and the plain-text epigraph (F3) is narrated again. Every other case, the controls included,
// is left exactly as the importer read it when no override is chosen (Phase 5's "importer fixtures unchanged for correct headings").
func TestHeadingMisreadOverrides(t *testing.T) {
	fixed := 0
	for _, testCase := range loadHeadingMisreadCases(t) {
		t.Run(testCase.ID, func(t *testing.T) {
			draft, err := BuildDraft(fixture(headingMisreadsDir+"/"+testCase.File), 1)
			if err != nil {
				t.Fatal(err)
			}
			unchanged, err := ApplySubtitleOverrides(draft, nil)
			if err != nil || !reflect.DeepEqual(unchanged, draft) {
				t.Fatalf("no override changed the draft (err %v)", err)
			}
			if testCase.Override == nil {
				return
			}
			fixed++
			chapter := testCase.Observed.ChapterTitles[0]
			id := ""
			for _, section := range draft.Sections {
				if section.Title == chapter {
					id = section.ID
				}
			}
			corrected, err := ApplySubtitleOverrides(draft, map[string]bool{id: testCase.Override.SecondLineIsSubtitle})
			if err != nil {
				t.Fatal(err)
			}
			intended := testCase.Intended
			title, subtitle := firstChapterHeading(corrected, intended.Title)
			if title != intended.Title || subtitle != intended.Subtitle {
				t.Fatalf("heading after the override = %q / %q, want %q / %q (sections %+v)", title, subtitle, intended.Title, intended.Subtitle, corrected.Sections)
			}
			if first := firstParagraphOf(corrected, intended.Title); first != testCase.Override.FirstParagraph {
				t.Fatalf("first paragraph after the override = %q, want %q", first, testCase.Override.FirstParagraph)
			}
		})
	}
	if fixed != 4 {
		t.Fatalf("%d cases carry an override, want the 3 wrapped titles (F1) and the plain-text epigraph (F3)", fixed)
	}
}

// TestHeadingMisreadFixturesAreAllListed keeps the fixture folder and cases.json in step: a generated file with no case would
// be an unpinned, undocumented fixture, and a case whose file is missing would fail only with a confusing read error.
func TestHeadingMisreadFixturesAreAllListed(t *testing.T) {
	listed := map[string]bool{}
	for _, testCase := range loadHeadingMisreadCases(t) {
		listed[testCase.File] = true
	}
	entries, err := os.ReadDir(fixture(headingMisreadsDir))
	if err != nil {
		t.Fatal(err)
	}
	onDisk := map[string]bool{}
	for _, entry := range entries {
		switch filepath.Ext(entry.Name()) {
		case ".docx", ".epub", ".md", ".txt":
			onDisk[entry.Name()] = true
			if !listed[entry.Name()] {
				t.Errorf("%s has no case in cases.json", entry.Name())
			}
		}
	}
	for name := range listed {
		if !onDisk[name] {
			t.Errorf("cases.json lists %s, which is not in the fixture folder", name)
		}
	}
}

func firstChapterHeading(draft Draft, chapter string) (title, subtitle string) {
	for _, section := range draft.Sections {
		if section.Title == chapter {
			return section.Title, section.Subtitle
		}
	}
	return "", ""
}

func firstParagraphOf(draft Draft, chapter string) string {
	for _, paragraph := range draft.Paragraphs {
		if paragraph.Chapter == chapter {
			return paragraph.Text
		}
	}
	return ""
}
