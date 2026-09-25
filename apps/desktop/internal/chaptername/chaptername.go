// Package chaptername formats a chapter's name as plain text by the app's one rule (chapter-title-display-consistency
// PRD, ADR 0191): the title and the subtitle join with " — " in the book's own casing. It mirrors
// apps/ui/src/chapterName.ts and narration_common.chapter_names; tests/fixtures/chapter-names.json, written by this
// package's test, pins all three to the same output. Plain-text outputs that a consumer may not take an em dash in
// (file names, some tags) use the Plain form, " - " (owner decision D34).
package chaptername

import (
	"regexp"
	"strings"
)

// Form is how a name is written. Full is "Title — Subtitle" (the title alone without a subtitle); Short is the title
// alone; Plain is Full with " - " in place of the em dash. A context prefix is Context("Read aloud").
type Form struct {
	kind   string
	prefix string
}

var (
	Full  = Form{kind: "full"}
	Short = Form{kind: "short"}
	Plain = Form{kind: "plain"}
)

// Context is "Prefix: Title — Subtitle".
func Context(prefix string) Form { return Form{kind: "context", prefix: prefix} }

// trailingSeparator is a separator the title already ends with, so joining a subtitle cannot double up
// ("CHAPTER ONE: — Subtitle").
var trailingSeparator = regexp.MustCompile(`[:—–-]\s*$`)

func squash(text string) string { return strings.Join(strings.Fields(text), " ") }

// splitLegacyNewline reads a title that still holds its subtitle after a line break, as the importers split a heading:
// the first line is the title and every later line joins into the subtitle.
func splitLegacyNewline(title string) (string, string) {
	first, rest, found := strings.Cut(title, "\n")
	if !found {
		return squash(title), ""
	}
	return squash(first), squash(strings.ReplaceAll(rest, "\n", " "))
}

func joined(title, subtitle, separator string) string {
	if subtitle == "" {
		return title
	}
	stripped := strings.TrimSpace(trailingSeparator.ReplaceAllString(title, ""))
	if stripped == "" {
		return subtitle
	}
	return stripped + separator + subtitle
}

// Name writes a chapter's name. subtitle is nil when the chapter has no subtitle field, and then a title holding a
// line break gives its later lines as the subtitle; a subtitle that is set (even empty) is the subtitle.
func Name(title string, subtitle *string, form Form) string {
	name, legacy := splitLegacyNewline(title)
	sub := legacy
	if subtitle != nil {
		sub = squash(*subtitle)
	}
	switch form.kind {
	case "short":
		return name
	case "plain":
		return joined(name, sub, " - ")
	case "context":
		return form.prefix + ": " + joined(name, sub, " — ")
	}
	return joined(name, sub, " — ")
}
