package credits

import (
	"path/filepath"
	"sort"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/importer"
)

// tokenOrder is a fixed, deterministic order Detect's result is sorted into, so its JSON is stable for the golden
// contract test regardless of Go's randomized map iteration.
var tokenOrder = []string{TokenTitle, TokenSubtitle, TokenAuthor, TokenSeries, TokenBookNumber, TokenYear, TokenCopyrightHolder, TokenPublisher}

// machineDefaultValues are document-property values that name the software or a generic role rather than a real
// person (CS6): Word's own placeholder when no account name is set, and other generic labels seen in the wild.
var machineDefaultValues = map[string]bool{
	"microsoft office user": true, "author": true, "title": true, "user": true, "owner": true, "unknown": true, "administrator": true,
}

// looksLikeMachineDefault reports whether value is a known placeholder or simply the stored file's own name (with or
// without its extension) - what Word writes when nothing else was ever set - rather than a title or an author a
// person actually typed.
func looksLikeMachineDefault(value, sourceFileName string) bool {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return true
	}
	lower := strings.ToLower(trimmed)
	if machineDefaultValues[lower] {
		return true
	}
	if sourceFileName == "" {
		return false
	}
	base := strings.ToLower(strings.TrimSuffix(sourceFileName, filepath.Ext(sourceFileName)))
	return lower == strings.ToLower(sourceFileName) || (base != "" && lower == base)
}

// Detect returns one candidate per credits token it can find from the current project's imported manuscript
// (credits-token-setup-and-front-matter-detection.prd.md, Phase 1): the front matter of its opening chapters, and the
// stored source file's own metadata (EPUB OPF <metadata>, or DOCX core properties filtered for machine defaults).
// Precedence when sources disagree (CS6): EPUB metadata beats the front matter; the front matter beats DOCX
// properties; DOCX properties are used only when the front matter found nothing for that token, and never when the
// value looks like a machine default. It never writes anything; every candidate is only ever offered.
func Detect(projectFolder string) []Candidate {
	doc, ok := readManuscriptDoc(projectFolder)
	if !ok {
		return []Candidate{}
	}

	byToken := map[string]Candidate{}
	for _, candidate := range ParseFrontMatter(openingChapterLines(doc)) {
		byToken[candidate.Token] = candidate
	}

	sourcePath, hasSource := storedSourcePath(projectFolder, doc.Source.StoredPath)
	switch strings.ToLower(doc.Importer.Format) {
	case "epub":
		if hasSource {
			if metadata, ok := importer.ReadEPUBMetadata(sourcePath); ok {
				mergeEPUBMetadata(byToken, metadata)
			}
		}
	case "docx":
		if hasSource {
			if title, author, ok := importer.ReadCoreProps(sourcePath); ok {
				mergeDocxProperties(byToken, title, author, doc.Source.FileName)
			}
		}
	}

	candidates := make([]Candidate, 0, len(byToken))
	for _, candidate := range byToken {
		candidates = append(candidates, candidate)
	}
	sortCandidates(candidates)
	return candidates
}

// mergeEPUBMetadata overwrites byToken with the EPUB's own metadata, which beats the front matter outright (CS6):
// publishers fill it in on purpose. dc:creator with role "aut" is an explicit marker (High, per the confidence table),
// as is the title itself; a value that already agrees with the front matter stays High either way.
func mergeEPUBMetadata(byToken map[string]Candidate, metadata importer.EPUBMetadata) {
	set := func(token, value, source string, confidence Confidence) {
		if value == "" {
			return
		}
		byToken[token] = Candidate{Token: token, Value: value, Source: source, Confidence: confidence}
	}
	set(TokenTitle, metadata.Title, "the EPUB's own metadata", ConfidenceHigh)
	set(TokenSubtitle, metadata.Subtitle, "the EPUB's own metadata", ConfidenceMedium)
	set(TokenAuthor, metadata.Author, "the EPUB's own metadata", ConfidenceHigh)
	set(TokenPublisher, metadata.Publisher, "the EPUB's own metadata", ConfidenceMedium)
	set(TokenSeries, metadata.Series, "the EPUB's own metadata", ConfidenceMedium)
	set(TokenBookNumber, metadata.BookNumber, "the EPUB's own metadata", ConfidenceMedium)
	if metadata.Year != "" {
		set(TokenYear, metadata.Year, "the EPUB's own metadata", ConfidenceMedium)
	}
	if year, holder, ok := parseCopyrightLine(metadata.Rights); ok {
		if year != "" {
			set(TokenYear, year, "the EPUB's own rights statement", ConfidenceMedium)
		}
		if holder != "" {
			set(TokenCopyrightHolder, holder, "the EPUB's own rights statement", ConfidenceMedium)
		}
	}
}

// mergeDocxProperties adds a DOCX's own docProps/core.xml title/creator, but only for a token the front matter found
// nothing for, and never a value that looks like a machine default (CS6).
func mergeDocxProperties(byToken map[string]Candidate, title, author, sourceFileName string) {
	if _, exists := byToken[TokenTitle]; !exists && !looksLikeMachineDefault(title, sourceFileName) {
		byToken[TokenTitle] = Candidate{Token: TokenTitle, Value: title, Source: "the document's own properties", Confidence: ConfidenceLow}
	}
	if _, exists := byToken[TokenAuthor]; !exists && !looksLikeMachineDefault(author, sourceFileName) {
		byToken[TokenAuthor] = Candidate{Token: TokenAuthor, Value: author, Source: "the document's own properties", Confidence: ConfidenceLow}
	}
}

func sortCandidates(candidates []Candidate) {
	rank := make(map[string]int, len(tokenOrder))
	for i, token := range tokenOrder {
		rank[token] = i
	}
	sort.Slice(candidates, func(i, j int) bool { return rank[candidates[i].Token] < rank[candidates[j].Token] })
}
