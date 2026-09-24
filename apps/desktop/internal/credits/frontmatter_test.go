package credits

import (
	"testing"
	"testing/quick"
)

func candidateValue(candidates []Candidate, token string) (string, bool) {
	for _, candidate := range candidates {
		if candidate.Token == token {
			return candidate.Value, true
		}
	}
	return "", false
}

func candidateConfidence(candidates []Candidate, token string) Confidence {
	for _, candidate := range candidates {
		if candidate.Token == token {
			return candidate.Confidence
		}
	}
	return ""
}

// TestParseFrontMatterOwnersBook is the Success Metrics case: the owner's own book (credits-token-setup-and-front-
// matter-detection.prd.md, "Owner's book"), whose split, all-capitals title, bare-name byline and copyright line
// together must give Title and Author at high confidence, plus Year and Copyright Holder.
func TestParseFrontMatterOwnersBook(t *testing.T) {
	lines := []string{"AFTER", "THE", "APPLAUSE", "A Novel", "Adrian Crow", "Copyright © 2026 Adrian Crow", "All rights reserved."}

	candidates := ParseFrontMatter(lines)

	if title, ok := candidateValue(candidates, TokenTitle); !ok || title != "After the Applause" {
		t.Fatalf("Title = %q, %v, want \"After the Applause\"", title, ok)
	}
	if got := candidateConfidence(candidates, TokenTitle); got != ConfidenceHigh {
		t.Fatalf("Title confidence = %q, want high", got)
	}
	if author, ok := candidateValue(candidates, TokenAuthor); !ok || author != "Adrian Crow" {
		t.Fatalf("Author = %q, %v, want \"Adrian Crow\"", author, ok)
	}
	if got := candidateConfidence(candidates, TokenAuthor); got != ConfidenceHigh {
		t.Fatalf("Author confidence = %q, want high (agrees with the copyright holder)", got)
	}
	if year, ok := candidateValue(candidates, TokenYear); !ok || year != "2026" {
		t.Fatalf("Year = %q, %v, want \"2026\"", year, ok)
	}
	if holder, ok := candidateValue(candidates, TokenCopyrightHolder); !ok || holder != "Adrian Crow" {
		t.Fatalf("CopyrightHolder = %q, %v, want \"Adrian Crow\"", holder, ok)
	}
	if _, ok := candidateValue(candidates, TokenSubtitle); ok {
		t.Fatal("\"A Novel\" must not become a Subtitle (CS5)")
	}
}

func TestParseFrontMatterPatternCoverage(t *testing.T) {
	tests := []struct {
		name  string
		lines []string
		want  map[string]string
	}{
		{"mixed-case title stays as written", []string{"The Midnight Orchard", "by Jane Doe"}, map[string]string{TokenTitle: "The Midnight Orchard", TokenAuthor: "Jane Doe"}},
		{"Title: prefix stripped", []string{"Title: The Long Way Home"}, map[string]string{TokenTitle: "The Long Way Home"}},
		{"title with inline subtitle splits at the colon", []string{"The Long Way Home: A Novel of the Sea"}, map[string]string{TokenTitle: "The Long Way Home", TokenSubtitle: "A Novel of the Sea"}},
		{"written by", []string{"The Long Way Home", "Written by Jane Doe"}, map[string]string{TokenAuthor: "Jane Doe"}},
		{"a novel by", []string{"The Long Way Home", "A novel by Jane Doe"}, map[string]string{TokenAuthor: "Jane Doe"}},
		{"multiple authors joined by and", []string{"The Long Way Home", "A Novel", "Jane Doe and John Smith"}, map[string]string{TokenAuthor: "Jane Doe and John Smith"}},
		{"book one of the series", []string{"The Long Way Home", "Book One of the Ember Trilogy"}, map[string]string{TokenSeries: "Ember Trilogy", TokenBookNumber: "One"}},
		{"series comma book", []string{"The Long Way Home", "Ember Trilogy, Book 3"}, map[string]string{TokenSeries: "Ember Trilogy", TokenBookNumber: "3"}},
		{"series hash", []string{"The Long Way Home", "Ember Trilogy Series #2"}, map[string]string{TokenSeries: "Ember Trilogy", TokenBookNumber: "2"}},
		{"volume with no series name", []string{"The Long Way Home", "Volume II"}, map[string]string{TokenBookNumber: "II"}},
		{"the x trilogy alone", []string{"The Long Way Home", "The Ember Trilogy"}, map[string]string{TokenSeries: "Ember"}},
		{"descriptor derived series", []string{"The Long Way Home", "A Wonderland Novel"}, map[string]string{TokenSeries: "Wonderland"}},
		{"copyright c by name", []string{"The Long Way Home", "Copyright (c) 2020 by Jane Doe"}, map[string]string{TokenYear: "2020", TokenCopyrightHolder: "Jane Doe"}},
		{"text copyright name year", []string{"The Long Way Home", "Text copyright © Jane Doe 2020"}, map[string]string{TokenYear: "2020", TokenCopyrightHolder: "Jane Doe"}},
		{"copyright symbol name comma year", []string{"The Long Way Home", "© Jane Doe, 2020"}, map[string]string{TokenYear: "2020", TokenCopyrightHolder: "Jane Doe"}},
		{"copyright with all rights reserved stripped", []string{"The Long Way Home", "Copyright © 2020 Jane Doe. All rights reserved."}, map[string]string{TokenYear: "2020", TokenCopyrightHolder: "Jane Doe"}},
		{"published by", []string{"The Long Way Home", "Published by Lighthouse Books"}, map[string]string{TokenPublisher: "Lighthouse Books"}},
		{"publisher by suffix", []string{"The Long Way Home", "Lighthouse Press"}, map[string]string{TokenPublisher: "Lighthouse Press"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			candidates := ParseFrontMatter(test.lines)
			for token, want := range test.want {
				got, ok := candidateValue(candidates, token)
				if !ok || got != want {
					t.Fatalf("%s = %q, %v, want %q (candidates: %+v)", token, got, ok, want, candidates)
				}
			}
		})
	}
}

// TestParseFrontMatterNoCandidateLayouts covers layouts that must produce nothing (Success Metrics: "Pattern
// coverage").
func TestParseFrontMatterNoCandidateLayouts(t *testing.T) {
	tests := []struct {
		name  string
		lines []string
	}{
		{"a dedication alone", []string{"For my mother."}},
		{"an epigraph alone", []string{"“To be or not to be.”"}},
		{"a fiction disclaimer alone", []string{"This is a work of fiction. Names, characters, places, and incidents are products of the author's imagination or are used fictitiously."}},
		{"a lone ISBN", []string{"ISBN 978-3-16-148410-0"}},
		{"empty input", []string{}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := ParseFrontMatter(test.lines); len(got) != 0 {
				t.Fatalf("candidates = %+v, want none", got)
			}
		})
	}
}

func TestParseFrontMatterNeverPanicsOnHostileInput(t *testing.T) {
	check := func(lines []string) bool {
		ParseFrontMatter(lines)
		return true
	}
	if err := quick.Check(check, &quick.Config{MaxCount: 2000}); err != nil {
		t.Fatal(err)
	}
}

func FuzzParseFrontMatter(f *testing.F) {
	f.Add("AFTER\nTHE\nAPPLAUSE\nA Novel\nAdrian Crow\nCopyright © 2026 Adrian Crow\nAll rights reserved.")
	f.Add("")
	f.Add("“Quote”\nFor Mom\nISBN 123\n© 2020 A, B, C")
	f.Fuzz(func(t *testing.T, blob string) {
		lines := splitFuzzLines(blob)
		ParseFrontMatter(lines)
	})
}

func splitFuzzLines(blob string) []string {
	var lines []string
	start := 0
	for i, r := range blob {
		if r == '\n' {
			lines = append(lines, blob[start:i])
			start = i + 1
		}
	}
	lines = append(lines, blob[start:])
	return lines
}
