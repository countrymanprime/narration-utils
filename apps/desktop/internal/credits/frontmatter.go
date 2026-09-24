package credits

import (
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// Confidence is how sure a Candidate is (credits-token-setup-and-front-matter-detection.prd.md, Solution Detail's
// confidence table): High when two sources agree or an explicit marker was seen ("by", "Title:", an EPUB role of
// "aut"); Medium for one pattern with a positional cue; Low for a descriptor-derived guess or a lone, unconfirmed
// source.
type Confidence string

const (
	ConfidenceHigh   Confidence = "high"
	ConfidenceMedium Confidence = "medium"
	ConfidenceLow    Confidence = "low"
)

// Candidate is one detected credits token value, with where it came from and how sure the detector is. Nothing here is
// ever written to the manifest on its own: it is only ever offered (ADR 0019's "detected is offered, not imported").
type Candidate struct {
	Token      string     `json:"token"`
	Value      string     `json:"value"`
	Source     string     `json:"source"`
	Confidence Confidence `json:"confidence"`
	Lines      []string   `json:"lines,omitempty"`
}

// Token names Candidate.Token uses; they match credits.Values' fields (Subtitle, BookNumber and CopyrightHolder use
// their Go field spelling here, not the token's [Bracket] form, since a candidate is a suggestion for a Values field,
// not a render token).
const (
	TokenTitle           = "Title"
	TokenSubtitle        = "Subtitle"
	TokenAuthor          = "Author"
	TokenSeries          = "Series"
	TokenBookNumber      = "BookNumber"
	TokenYear            = "Year"
	TokenCopyrightHolder = "CopyrightHolder"
	TokenPublisher       = "Publisher"
)

// maxFrontMatterLines and maxFrontMatterChars bound how much of the opening chapters ParseFrontMatter reads (Solution
// Detail: "stopping at the first 60 lines or 2,000 characters"), so a hostile or enormous front matter section cannot
// make detection slow.
const (
	maxFrontMatterLines = 60
	maxFrontMatterChars = 2000
)

var smallTitleWords = map[string]bool{
	"a": true, "an": true, "and": true, "as": true, "at": true, "but": true, "by": true, "for": true, "in": true,
	"nor": true, "of": true, "on": true, "or": true, "the": true, "to": true, "up": true, "yet": true, "via": true,
}

var descriptorExact = map[string]bool{
	"a novel": true, "a novella": true, "a memoir": true, "stories": true, "a thriller": true, "a mystery": true,
}

var (
	reAdjectiveNovel     = regexp.MustCompile(`(?i)^a (\w+) novel$`)
	reBookOfSeries       = regexp.MustCompile(`(?i)^book\s+(\w+)\s+of\s+(?:the\s+)?(.+)$`)
	reSeriesCommaBook    = regexp.MustCompile(`(?i)^(.+),\s*book\s+(\w+)$`)
	reSeriesHash         = regexp.MustCompile(`(?i)^(.+)\s+series\s*#?\s*(\w+)$`)
	reVolume             = regexp.MustCompile(`(?i)^volume\s+(\w+)$`)
	reTrilogySaga        = regexp.MustCompile(`(?i)^the\s+(.+)\s+(?:trilogy|saga)$`)
	reBylineBy           = regexp.MustCompile(`(?i)^by\s+(.+)$`)
	reBylineWrittenBy    = regexp.MustCompile(`(?i)^written\s+by\s+(.+)$`)
	reBylineNovelBy      = regexp.MustCompile(`(?i)^a\s+novel\s+by\s+(.+)$`)
	reTextCopyrightFirst = regexp.MustCompile(`(?i)^text\s+copyright\s*(?:©|\(c\))?\s*(.+?),?\s+(\d{4})$`)
	reCopyrightYearBy    = regexp.MustCompile(`(?i)^copyright\s*(?:©|\(c\))?\s*(\d{4})\s+by\s+(.+)$`)
	reCopyrightYearName  = regexp.MustCompile(`(?i)^copyright\s*(?:©|\(c\))?\s*(\d{4})\s+(.+)$`)
	reCopyrightSymYear   = regexp.MustCompile(`^©\s*(\d{4})\s+(.+)$`)
	reCopyrightSymComma  = regexp.MustCompile(`^©\s*(.+?),\s*(\d{4})$`)
	rePublishedBy        = regexp.MustCompile(`(?i)^published\s+by\s+(.+)$`)
	reTitlePrefix        = regexp.MustCompile(`(?i)^title:\s*(.+)$`)
)

var ignoredExact = map[string]bool{
	"all rights reserved": true, "all rights reserved.": true, "contents": true,
}

var ignoredPrefixes = []string{
	"isbn", "first edition", "first published", "printed in", "cover design by", "this is a work of fiction",
	"illustrations copyright", "illustration copyright", "cover art", "translation copyright",
}

// ParseFrontMatter reads the paragraphs of a manuscript's opening chapters, in order, and returns every credits token
// candidate it can find (Solution Detail's ordered pattern list). It is a pure function over already-imported text, so
// it can be table- and fuzz-tested with no manuscript or project on disk.
func ParseFrontMatter(rawLines []string) []Candidate {
	lines := normalizeFrontMatterLines(rawLines)
	var candidates []Candidate

	titleLines, index := collectTitleBlock(lines)
	if len(titleLines) > 0 {
		candidates = append(candidates, titleCandidates(titleLines)...)
	}

	bylineFound := false
	afterTitle := len(titleLines) > 0
	for ; index < len(lines); index++ {
		line := lines[index]
		if line == "" || isIgnoredLine(line) || isDedicationOrEpigraph(line) {
			continue
		}
		if series, ok := parseDescriptorLine(line); ok {
			// A descriptor line ("A Novel") is transparent to the "right after the title block" positional cue: the
			// owner's own book has exactly this shape (title block, "A Novel", then the bare-name byline).
			if series != "" {
				candidates = append(candidates, Candidate{Token: TokenSeries, Value: series, Source: "the descriptor line", Confidence: ConfidenceLow, Lines: []string{line}})
			}
			continue
		}
		if series, book, ok := parseSeriesLine(line); ok {
			afterTitle = false
			if series != "" {
				candidates = append(candidates, Candidate{Token: TokenSeries, Value: series, Source: "a series line", Confidence: ConfidenceMedium, Lines: []string{line}})
			}
			if book != "" {
				candidates = append(candidates, Candidate{Token: TokenBookNumber, Value: book, Source: "a series line", Confidence: ConfidenceMedium, Lines: []string{line}})
			}
			continue
		}
		if author, ok := parseExplicitByline(line); ok {
			candidates = append(candidates, Candidate{Token: TokenAuthor, Value: author, Source: "the byline", Confidence: ConfidenceHigh, Lines: []string{line}})
			bylineFound = true
			afterTitle = false
			continue
		}
		if !bylineFound && afterTitle {
			if author, ok := parseBareNameByline(line); ok {
				candidates = append(candidates, Candidate{Token: TokenAuthor, Value: author, Source: "a name line after the title", Confidence: ConfidenceMedium, Lines: []string{line}})
				bylineFound = true
				afterTitle = false
				continue
			}
		}
		afterTitle = false
		if year, holder, ok := parseCopyrightLine(line); ok {
			if year != "" {
				candidates = append(candidates, Candidate{Token: TokenYear, Value: year, Source: "the copyright line", Confidence: ConfidenceMedium, Lines: []string{line}})
			}
			if holder != "" {
				candidates = append(candidates, Candidate{Token: TokenCopyrightHolder, Value: holder, Source: "the copyright line", Confidence: ConfidenceMedium, Lines: []string{line}})
			}
			continue
		}
		if publisher, confidence, ok := parsePublisherLine(line); ok {
			candidates = append(candidates, Candidate{Token: TokenPublisher, Value: publisher, Source: "a publisher line", Confidence: confidence, Lines: []string{line}})
			continue
		}
	}

	upgradeAgreeingCandidates(candidates)
	return candidates
}

// normalizeFrontMatterLines trims each line, folds Unicode whitespace to plain spaces, and stops at the first
// maxFrontMatterLines lines or maxFrontMatterChars characters, whichever comes first.
func normalizeFrontMatterLines(rawLines []string) []string {
	out := make([]string, 0, len(rawLines))
	total := 0
	for i, raw := range rawLines {
		if i >= maxFrontMatterLines || total >= maxFrontMatterChars {
			break
		}
		line := foldSpaces(raw)
		out = append(out, line)
		total += len(line) + 1
	}
	return out
}

func foldSpaces(s string) string {
	var b strings.Builder
	for _, r := range s {
		if unicode.IsSpace(r) {
			b.WriteRune(' ')
		} else {
			b.WriteRune(r)
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

// collectTitleBlock reads the first run of 1 to 6 consecutive short lines (Solution Detail point 2), stopping before
// any line that another pattern would claim, before a long line, or once 6 lines are collected.
func collectTitleBlock(lines []string) (titleLines []string, next int) {
	index := 0
	for index < len(lines) && len(titleLines) < 6 {
		line := lines[index]
		if line == "" {
			break
		}
		if isTerminatingLine(line) {
			break
		}
		if !isShortTitleLine(line) {
			break
		}
		titleLines = append(titleLines, line)
		index++
	}
	return titleLines, index
}

// isTerminatingLine reports whether line is a descriptor, byline, copyright, series, publisher, ignored, dedication or
// epigraph line - any of the line types that end a title block in progress (Solution Detail point 2: "before a
// descriptor, byline, copyright or ignored line").
func isTerminatingLine(line string) bool {
	if isIgnoredLine(line) || isDedicationOrEpigraph(line) {
		return true
	}
	if _, ok := parseDescriptorLine(line); ok {
		return true
	}
	if _, _, ok := parseSeriesLine(line); ok {
		return true
	}
	if _, ok := parseExplicitByline(line); ok {
		return true
	}
	if _, _, ok := parseCopyrightLine(line); ok {
		return true
	}
	if _, _, ok := parsePublisherLine(line); ok {
		return true
	}
	return false
}

// isShortTitleLine reports whether line qualifies as a title-block line. A line with a same-line ": Subtitle" (point
// 2's last bullet) is judged on the part before the colon, since the title and the subtitle together may run past the
// single-line limits that keep an ordinary sentence from being mistaken for a title.
func isShortTitleLine(line string) bool {
	check := line
	if index := strings.Index(line, ":"); index >= 0 && index < len(line)-1 {
		check = line[:index]
	}
	if utf8.RuneCountInString(check) > 40 {
		return false
	}
	words := strings.Fields(check)
	if len(words) == 0 || len(words) > 6 {
		return false
	}
	trimmed := strings.TrimRight(check, "\"'”’")
	return !strings.HasSuffix(trimmed, ".")
}

// titleCandidates joins the title block's lines, strips a "Title:" prefix, splits off a same-line ": Subtitle", and
// recases an all-capitals block per CS3.
func titleCandidates(titleLines []string) []Candidate {
	joined := strings.Join(titleLines, " ")
	if m := reTitlePrefix.FindStringSubmatch(joined); m != nil {
		joined = strings.TrimSpace(m[1])
	}
	title, subtitle := joined, ""
	if index := strings.Index(joined, ":"); index >= 0 && index < len(joined)-1 {
		title, subtitle = strings.TrimSpace(joined[:index]), strings.TrimSpace(joined[index+1:])
	}
	if allCapsBlock(titleLines) {
		title = titleCase(title)
	}
	candidates := []Candidate{{Token: TokenTitle, Value: title, Source: "the title page", Confidence: ConfidenceHigh, Lines: titleLines}}
	if subtitle != "" {
		candidates = append(candidates, Candidate{Token: TokenSubtitle, Value: subtitle, Source: "the title page", Confidence: ConfidenceMedium, Lines: titleLines})
	}
	return candidates
}

func allCapsBlock(lines []string) bool {
	sawLetter := false
	for _, line := range lines {
		for _, r := range line {
			if unicode.IsLetter(r) {
				sawLetter = true
				if !unicode.IsUpper(r) {
					return false
				}
			}
		}
	}
	return sawLetter
}

// titleCase recases text as "After the Applause": every word capitalized except a short closed-class list of small
// words, which stay lower case unless they are the first or last word.
func titleCase(text string) string {
	words := strings.Fields(strings.ToLower(text))
	for i, word := range words {
		if i == 0 || i == len(words)-1 || !smallTitleWords[word] {
			words[i] = capitalizeWord(word)
		}
	}
	return strings.Join(words, " ")
}

func capitalizeWord(word string) string {
	if word == "" {
		return word
	}
	r := []rune(word)
	return strings.ToUpper(string(r[0])) + string(r[1:])
}

func parseDescriptorLine(line string) (series string, ok bool) {
	lower := strings.ToLower(line)
	if descriptorExact[lower] {
		return "", true
	}
	if m := reAdjectiveNovel.FindStringSubmatch(line); m != nil {
		return m[1], true
	}
	return "", false
}

func parseSeriesLine(line string) (series, book string, ok bool) {
	if m := reBookOfSeries.FindStringSubmatch(line); m != nil {
		return strings.TrimSpace(m[2]), m[1], true
	}
	if m := reSeriesCommaBook.FindStringSubmatch(line); m != nil {
		return strings.TrimSpace(m[1]), m[2], true
	}
	if m := reTrilogySaga.FindStringSubmatch(line); m != nil {
		return strings.TrimSpace(m[1]), "", true
	}
	if m := reSeriesHash.FindStringSubmatch(line); m != nil {
		return strings.TrimSpace(m[1]), m[2], true
	}
	if m := reVolume.FindStringSubmatch(line); m != nil {
		return "", m[1], true
	}
	return "", "", false
}

// parseExplicitByline matches only the markers with an explicit "by" (High confidence, Solution Detail point 5).
func parseExplicitByline(line string) (author string, ok bool) {
	for _, re := range []*regexp.Regexp{reBylineNovelBy, reBylineWrittenBy, reBylineBy} {
		if m := re.FindStringSubmatch(line); m != nil {
			return strings.TrimSpace(m[1]), true
		}
	}
	return "", false
}

// parseBareNameByline matches a bare line of 2 to 5 name-shaped words, joined by "and", "&" or "," (Solution Detail
// point 5, Medium confidence: only tried directly after the title block, before any byline is found).
func parseBareNameByline(line string) (string, bool) {
	if line == "" || isTerminatingLine(line) {
		return "", false
	}
	parts := splitAuthorNames(line)
	if len(parts) == 0 {
		return "", false
	}
	total := 0
	for _, part := range parts {
		words := strings.Fields(part)
		if len(words) == 0 {
			return "", false
		}
		for _, word := range words {
			if !isNameShapedWord(word) {
				return "", false
			}
		}
		total += len(words)
	}
	if total < 2 || total > 5 {
		return "", false
	}
	return line, true
}

func splitAuthorNames(line string) []string {
	replaced := strings.NewReplacer(" & ", ",", " and ", ",").Replace(line)
	var parts []string
	for _, part := range strings.Split(replaced, ",") {
		part = strings.TrimSpace(part)
		if part != "" {
			parts = append(parts, part)
		}
	}
	return parts
}

func isNameShapedWord(word string) bool {
	lower := strings.ToLower(word)
	switch lower {
	case "de", "van", "von", "der", "la", "le", "di", "da":
		return true
	}
	runes := []rune(word)
	if len(runes) == 0 || unicode.IsDigit(runes[0]) {
		return false
	}
	if !unicode.IsUpper(runes[0]) {
		return false
	}
	for _, r := range runes[1:] {
		if unicode.IsDigit(r) {
			return false
		}
	}
	return true
}

// parseCopyrightLine matches the copyright line forms of Solution Detail point 6, ignoring illustration, cover and
// translation copyrights (handled by isIgnoredLine, which parseCopyrightLine's caller checks first).
func parseCopyrightLine(line string) (year, holder string, ok bool) {
	if m := reTextCopyrightFirst.FindStringSubmatch(line); m != nil {
		return normalizeYear(m[2]), cleanHolder(m[1]), true
	}
	if m := reCopyrightYearBy.FindStringSubmatch(line); m != nil {
		return normalizeYear(m[1]), cleanHolder(m[2]), true
	}
	if m := reCopyrightSymComma.FindStringSubmatch(line); m != nil {
		return normalizeYear(m[2]), cleanHolder(m[1]), true
	}
	if m := reCopyrightYearName.FindStringSubmatch(line); m != nil {
		return normalizeYear(m[1]), cleanHolder(m[2]), true
	}
	if m := reCopyrightSymYear.FindStringSubmatch(line); m != nil {
		return normalizeYear(m[1]), cleanHolder(m[2]), true
	}
	return "", "", false
}

// normalizeYear accepts a year only within 1800 and next year (Success Metrics), otherwise reports no year at all
// rather than a value that is obviously wrong.
func normalizeYear(raw string) string {
	year, err := strconv.Atoi(raw)
	if err != nil {
		return ""
	}
	if year < 1800 || year > time.Now().Year()+1 {
		return ""
	}
	return raw
}

func cleanHolder(raw string) string {
	holder := strings.TrimSpace(raw)
	holder = strings.TrimSuffix(holder, ".")
	lower := strings.ToLower(holder)
	if index := strings.Index(lower, "all rights reserved"); index >= 0 {
		holder = strings.TrimSpace(holder[:index])
		holder = strings.TrimRight(holder, ".,;")
	}
	holder = strings.TrimPrefix(holder, "by ")
	holder = strings.TrimPrefix(holder, "By ")
	return strings.TrimSpace(holder)
}

func parsePublisherLine(line string) (publisher string, confidence Confidence, ok bool) {
	if m := rePublishedBy.FindStringSubmatch(line); m != nil {
		return strings.TrimSpace(m[1]), ConfidenceMedium, true
	}
	words := strings.Fields(line)
	if len(words) == 0 || len(words) > 6 {
		return "", "", false
	}
	for _, suffix := range []string{"Press", "Books", "Publishing", "Publishers"} {
		if strings.HasSuffix(line, suffix) {
			return line, ConfidenceLow, true
		}
	}
	return "", "", false
}

func isDedicationOrEpigraph(line string) bool {
	if isQuotedEpigraph(line) {
		return true
	}
	words := strings.Fields(line)
	if len(words) == 0 || len(words) > 8 {
		return false
	}
	switch words[0] {
	case "For", "To":
		return true
	}
	return false
}

func isQuotedEpigraph(line string) bool {
	runes := []rune(line)
	if len(runes) < 2 {
		return false
	}
	const quoteChars = "\"'“”‘’"
	return strings.ContainsRune(quoteChars, runes[0]) && strings.ContainsRune(quoteChars, runes[len(runes)-1])
}

func isIgnoredLine(line string) bool {
	lower := strings.ToLower(line)
	if lower == "" {
		return false
	}
	if ignoredExact[lower] {
		return true
	}
	for _, prefix := range ignoredPrefixes {
		if strings.HasPrefix(lower, prefix) {
			return true
		}
	}
	if strings.Contains(lower, "http://") || strings.Contains(lower, "https://") || strings.Contains(lower, "www.") {
		return true
	}
	if utf8.RuneCountInString(line) > 120 {
		return true
	}
	return false
}

// upgradeAgreeingCandidates raises Author and CopyrightHolder to High confidence when they agree (Confidence table:
// "the byline or a bare name equals the Copyright Holder, the owner's case"), rewriting their Source to say so.
func upgradeAgreeingCandidates(candidates []Candidate) {
	authorIndex, holderIndex := -1, -1
	for i, candidate := range candidates {
		switch candidate.Token {
		case TokenAuthor:
			authorIndex = i
		case TokenCopyrightHolder:
			holderIndex = i
		}
	}
	if authorIndex < 0 || holderIndex < 0 {
		return
	}
	if !strings.EqualFold(candidates[authorIndex].Value, candidates[holderIndex].Value) {
		return
	}
	candidates[authorIndex].Confidence = ConfidenceHigh
	candidates[authorIndex].Source = "the byline and the copyright line"
	candidates[holderIndex].Confidence = ConfidenceHigh
	candidates[holderIndex].Source = "the copyright line, matching the byline"
}
