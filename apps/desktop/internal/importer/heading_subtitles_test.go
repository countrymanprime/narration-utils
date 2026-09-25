package importer

import (
	"slices"
	"strings"
	"testing"
)

// The heading-misread fixes of #387 and #388 read a subtitle set apart from its heading, and a wider glued heading, without
// taking a heading or a word that is something else. These pin the edges the fixtures do not.

func TestGluedHeadingRepairReachesOneLetterWordsAndTwoWordNumbersOnly(t *testing.T) {
	for heading, want := range map[string][2]string{
		"Chapter TwoA Night on the Levee": {"Chapter Two", "A Night on the Levee"},
		"Chapter Twenty OneThe Storm":     {"Chapter Twenty One", "The Storm"},
		"Chapter OneI Remember":           {"Chapter One", "I Remember"},
		"Chapter XI The Storm":            {"Chapter XI The Storm", ""}, // XI is a number, not X and "I"
		"Chapter IIA Night":               {"Chapter IIA Night", ""},    // no split after a roman numeral before a lone letter
		"Chapter Twenty One":              {"Chapter Twenty One", ""},
		"Chapter One The Storm":           {"Chapter One The Storm", ""},
		"Chapter TwoA":                    {"Chapter TwoA", ""}, // no words after the letter
		"Chapter OneBad Ideas":            {"Chapter One", "Bad Ideas"},
	} {
		title, subtitle, _ := splitGluedHeading(heading)
		if title != want[0] || subtitle != want[1] {
			t.Errorf("splitGluedHeading(%q) = %q / %q, want %q / %q", heading, title, subtitle, want[0], want[1])
		}
	}
}

func TestADeeperHeadingIsASubtitleOnlyWhenItIsOne(t *testing.T) {
	cases := map[string]struct {
		body      string
		titles    []string
		chapter   string
		subtitle  string
		firstText string
	}{
		"a part and its first chapter": {
			body:    wordParagraph("Heading1", wordRun("Part One")) + wordParagraph("Heading2", wordRun("The Beginning")) + wordParagraph("", wordRun("Text.")),
			titles:  []string{"Part One", "The Beginning"},
			chapter: "The Beginning", firstText: "Text.",
		},
		"a book title and its prologue": {
			body:    wordParagraph("Title", wordRun("My Book")) + wordParagraph("Heading1", wordRun("Prologue")) + wordParagraph("", wordRun("Text.")),
			titles:  []string{"My Book", "Prologue"},
			chapter: "Prologue", firstText: "Text.",
		},
		"a chapter heading under a chapter": {
			body:    wordParagraph("Heading1", wordRun("Introduction")) + wordParagraph("Heading2", wordRun("Chapter One")) + wordParagraph("", wordRun("Text.")),
			titles:  []string{"Introduction", "Chapter One"},
			chapter: "Chapter One", firstText: "Text.",
		},
		"scenes under a chapter": {
			body: wordParagraph("Heading1", wordRun("Chapter One")) + wordParagraph("Heading2", wordRun("Morning")) + wordParagraph("", wordRun("A.")) +
				wordParagraph("Heading2", wordRun("Evening")) + wordParagraph("", wordRun("B.")),
			titles:  []string{"Chapter One", "Morning", "Evening"},
			chapter: "Morning", firstText: "A.",
		},
		"text before the deeper heading": {
			body:    wordParagraph("Heading1", wordRun("Chapter One")) + wordParagraph("", wordRun("Text.")) + wordParagraph("Heading2", wordRun("Later")) + wordParagraph("", wordRun("More.")),
			titles:  []string{"Chapter One", "Later"},
			chapter: "Chapter One", firstText: "Text.",
		},
		"a subtitle already on the heading": {
			body:    wordParagraph("Heading1", wordRun("Chapter One"), "<w:r><w:br/></w:r>", wordRun("The Storm")) + wordParagraph("Subtitle", wordRun("Another")) + wordParagraph("", wordRun("Text.")),
			titles:  []string{"Chapter One"},
			chapter: "Chapter One", subtitle: "The Storm", firstText: "Another",
		},
	}
	for name, c := range cases {
		draft := importDocx(t, c.body)
		if !slices.Equal(draft.ChapterTitles, c.titles) {
			t.Errorf("%s: ChapterTitles = %q, want %q", name, draft.ChapterTitles, c.titles)
			continue
		}
		if _, subtitle := firstChapterHeading(draft, c.chapter); subtitle != c.subtitle {
			t.Errorf("%s: %q's subtitle = %q, want %q", name, c.chapter, subtitle, c.subtitle)
		}
		if first := firstParagraphOf(draft, c.chapter); first != c.firstText {
			t.Errorf("%s: %q's first paragraph = %q, want %q", name, c.chapter, first, c.firstText)
		}
	}
}

func TestMarkdownScenesStayScenesAndALoneSubheadingIsTheSubtitle(t *testing.T) {
	draft := importMarkdown(t, "# Chapter One\n## Morning\nA.\n\n## Evening\nB.\n\n# Chapter Two\n## The Storm\nC.\n")
	if _, subtitle := firstChapterHeading(draft, "Chapter One"); subtitle != "" {
		t.Fatalf("Chapter One's subtitle = %q; its first scene is a scene", subtitle)
	}
	if section := draft.Paragraphs[0].Section; section == nil || *section != "Morning" {
		t.Fatalf("the first paragraph's section = %v, want Morning", section)
	}
	if _, subtitle := firstChapterHeading(draft, "Chapter Two"); subtitle != "The Storm" {
		t.Fatalf("Chapter Two's subtitle = %q, want its lone subheading", subtitle)
	}
}

func TestEPUBKeepsAHeadingThatStartsNoChapterAsText(t *testing.T) {
	files := baseEPUBFiles(
		`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`+
			`<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>`,
		`<itemref idref="ch1"/>`,
	)
	files["OEBPS/nav.xhtml"] = `<?xml version="1.0" encoding="UTF-8"?>` +
		`<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">` +
		`<body><nav epub:type="toc"><ol><li><a href="ch1.xhtml#c1">One</a></li></ol></nav></body></html>`
	files["OEBPS/ch1.xhtml"] = `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1 id="c1">Chapter One</h1>` +
		`<p>The first part.</p><h2>Later That Night</h2><p>The second part.</p><h2>Dawn</h2><p>The end.</p></body></html>`

	draft, err := epubWithProgress(epubFixture(t, files), nil)
	if err != nil {
		t.Fatal(err)
	}
	text := chapterText(t, draft, "Chapter One")
	for _, want := range []string{"Later That Night", "Dawn", "The second part."} {
		if !strings.Contains(text, want) {
			t.Fatalf("chapter text %q lost %q (#388)", text, want)
		}
	}
	if _, subtitle := firstChapterHeading(draft, "Chapter One"); subtitle != "" {
		t.Fatalf("subtitle = %q; a heading after the chapter's text is not its subtitle", subtitle)
	}
}
