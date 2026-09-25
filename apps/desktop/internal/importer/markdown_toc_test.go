package importer

import (
	"slices"
	"strings"
	"testing"
)

// A Markdown table of contents is a list of links to the manuscript's own headings (import-structure PRD, Phase 4). It is
// matched as a docx's is (ADR 0089): by anchor, then normalised text, then position, and becomes the chapter list when 80%
// of its entries match.

func tocNotices(draft Draft) []string {
	out := []string{}
	for _, notice := range draft.Notices {
		if strings.Contains(notice, "table of contents") {
			out = append(out, notice)
		}
	}
	return out
}

func TestMarkdownTOCBecomesTheChapterList(t *testing.T) {
	draft := importMarkdown(t, `# My Book

# Contents

- [Prologue](#prologue)
- [The Storm Arrives](#chapter-one-the-storm)
- [Chapter Two](#chapter-two)

# Prologue
Before.

# Chapter One: The Storm
First.

# Chapter Two
Second.
`)
	// "My Book" is a chapter to the heading heuristic; the TOC does not list it, so it is not proposed. The second entry's text
	// differs from its heading, and its anchor still finds it.
	if want := []string{"Prologue", "Chapter One: The Storm", "Chapter Two"}; !slices.Equal(draft.ChapterTitles, want) {
		t.Fatalf("ChapterTitles = %#v, want %#v", draft.ChapterTitles, want)
	}
	if notices := tocNotices(draft); len(notices) != 0 {
		t.Fatalf("notices = %#v, want none when every entry matched", notices)
	}
	if got := sectionNamed(t, draft, "Chapter Two").ParagraphCount; got != 1 {
		t.Fatalf("Chapter Two holds %d paragraphs; the TOC must not change the sections", got)
	}
}

func TestMarkdownTOCAnchorsFollowTheDuplicateSuffixAndPercentEncoding(t *testing.T) {
	draft := importMarkdown(t, `# Contents

1. [Épilogue](#%C3%A9pilogue)
2. [Interlude](#interlude)
3. [Second interlude](#interlude-1)

# Interlude
One.

# Épilogue
Two.

# Interlude
Three.
`)
	// The TOC's order wins: Épilogue first, then the two interludes, the second found only by its "-1" anchor.
	if want := []string{"Épilogue", "Interlude", "Interlude"}; !slices.Equal(draft.ChapterTitles, want) {
		t.Fatalf("ChapterTitles = %#v, want %#v", draft.ChapterTitles, want)
	}
	if notices := tocNotices(draft); len(notices) != 0 {
		t.Fatalf("notices = %#v, want none", notices)
	}
}

func TestMarkdownStaleTOCFallsBackToTheHeadingsWithANotice(t *testing.T) {
	draft := importMarkdown(t, `# Contents

- [Chapter One](#chapter-one)
- [A Cut Chapter](#a-cut-chapter)
- [Another Cut One](#another-cut-one)
- [And Another](#and-another)

# Chapter One
First.

# Chapter Two
Second.
`)
	if want := []string{"Chapter One", "Chapter Two"}; !slices.Equal(draft.ChapterTitles, want) {
		t.Fatalf("ChapterTitles = %#v, want the headings' own list %#v", draft.ChapterTitles, want)
	}
	if notices := tocNotices(draft); len(notices) != 1 || notices[0] != "The table of contents listed 4 entries; 2 matched a chapter in the manuscript." {
		t.Fatalf("notices = %#v, want the mismatch notice", notices)
	}
}

func TestMarkdownListsThatAreNotATableOfContentsAreIgnored(t *testing.T) {
	for name, content := range map[string]string{
		"a single link":       "# Chapter One\n- [see Chapter Two](#chapter-two)\n\n# Chapter Two\nText.\n",
		"links to elsewhere":  "# Chapter One\n- [Site](https://example.com)\n- [Other](other.md#top)\n\n# Chapter Two\nText.\n",
		"links inside prose":  "# Chapter One\n- Read [Chapter Two](#chapter-two) first\n- then [Chapter One](#chapter-one)\n\n# Chapter Two\nText.\n",
		"a list broken apart": "# Chapter One\n- [Chapter Two](#chapter-two)\n\nSome prose.\n\n- [Chapter One](#chapter-one)\n\n# Chapter Two\nText.\n",
	} {
		draft := importMarkdown(t, content)
		if want := []string{"Chapter One", "Chapter Two"}; !slices.Equal(draft.ChapterTitles, want) {
			t.Errorf("%s: ChapterTitles = %#v, want the headings' list", name, draft.ChapterTitles)
		}
		if notices := tocNotices(draft); len(notices) != 0 {
			t.Errorf("%s: notices = %#v, want none", name, notices)
		}
	}
}

func TestMarkdownTOCKeepsItsLinesAsTheContentsText(t *testing.T) {
	draft := importMarkdown(t, "# Contents\n\n- [Chapter One](#chapter-one)\n- [Chapter Two](#chapter-two)\n\n# Chapter One\nA.\n\n# Chapter Two\nB.\n")
	if got := sectionNamed(t, draft, "Contents").ParagraphCount; got == 0 {
		t.Fatal("the Contents lines were dropped; they stay as the Contents section's text")
	}
}

func TestMarkdownSlugFollowsGitHubHeadingAnchors(t *testing.T) {
	for heading, want := range map[string]string{
		"Chapter One: The Storm": "chapter-one-the-storm",
		"Épilogue — Encore!":     "épilogue--encore",
		"A_b c-d":                "a_b-c-d",
		"  What's  Next?  ":      "whats--next",
		"1. Numbers (2024)":      "1-numbers-2024",
	} {
		if got := markdownSlug(heading); got != want {
			t.Errorf("markdownSlug(%q) = %q, want %q", heading, got, want)
		}
	}
}

func TestMarkdownNestedTOCIsReadAtItsOutermostLevel(t *testing.T) {
	draft := importMarkdown(t, `# Contents

- [Chapter One](#chapter-one)
  - [The Harbour](#the-harbour)
  - [The Storm](#the-storm)
- [Chapter Two](#chapter-two)
  * [Aftermath](#aftermath)

# Chapter One
## The Harbour
Text.
## The Storm
Text.

# Chapter Two
## Aftermath
Text.
`)
	if want := []string{"Chapter One", "Chapter Two"}; !slices.Equal(draft.ChapterTitles, want) {
		t.Fatalf("ChapterTitles = %#v, want %#v", draft.ChapterTitles, want)
	}
	if notices := tocNotices(draft); len(notices) != 0 {
		t.Fatalf("notices = %#v, want none: the nested section links are not chapter entries", notices)
	}
}

func TestPercentDecodedKeepsAMalformedAnchorAsWritten(t *testing.T) {
	for anchor, want := range map[string]string{
		"%C3%A9pilogue": "épilogue",
		"plain":         "plain",
		"50%-off":       "50%-off",
		"cut%C":         "cut%C",
		"bad%FF":        "bad%FF",
	} {
		if got := percentDecoded(anchor); got != want {
			t.Errorf("percentDecoded(%q) = %q, want %q", anchor, got, want)
		}
	}
}
